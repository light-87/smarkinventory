/**
 * lib/storage/index.ts — StoragePort: the ONE file-storage seam.
 *
 * CLAUDE.md / FEATURES.md §3: every upload (BOM source files, QR label
 * PDFs/PNGs, receipts, project documents, exports) goes to Cloudflare R2,
 * NEVER Supabase Storage. Feature packages depend on `StoragePort`, never on
 * R2/disk APIs directly — that keeps "swap the backend" a one-file change
 * and makes upload code testable without any network.
 *
 * Two adapters:
 *  - `LocalDiskAdapter` — dev/test default. Writes under `.storage/` (repo
 *    root, gitignored). Returns `file://` URLs: real and resolvable on the
 *    machine that wrote them, but NOT servable over HTTP — fine for local
 *    dev and unit tests, wrong for anything user-facing.
 *  - `R2Adapter` — the production target (bucket `smarkstock-files` per
 *    CLAUDE.md's `{appname}-files` convention). STUBBED: the constructor is
 *    env-gated (throws immediately if `CLOUDFLARE_R2_*` isn't fully
 *    configured, so a bad deploy fails at boot, not on the first upload),
 *    but every operation throws a clear "not implemented" error until an
 *    S3-compatible client is wired in — R2 is S3-compatible, so
 *    `@aws-sdk/client-s3` (+ `@aws-sdk/s3-request-presigner` for
 *    `signedUrl`) is the intended implementation. Not installed yet: no
 *    feature package should need real R2 to build against this seam.
 *
 * `getStorageAdapter()` picks R2 when `CLOUDFLARE_R2_*` env is fully set,
 * else falls back to `LocalDiskAdapter` — the same code path in dev/CI and
 * prod, just backed by a different adapter.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/* ────────────────────────────────────────────────────────────────────────────
 * Port
 * ──────────────────────────────────────────────────────────────────────────── */

/** Anything JS can turn into bytes — callers hand over whatever they already have. */
export type StorageBody = Uint8Array | ArrayBuffer | Blob | string;

export interface StoragePutInput {
  /** Bucket-relative path, e.g. `receipts/2026/07/order-482.pdf`. No leading slash, no `..` segments. */
  key: string;
  body: StorageBody;
  contentType?: string;
}

export interface StoragePutResult {
  key: string;
  url: string;
  size: number;
  contentType: string | null;
}

export interface StorageGetResult {
  key: string;
  body: Uint8Array;
  contentType: string | null;
  size: number;
}

export interface SignedUrlOptions {
  /** Default 3600 (1 hour). Adapters that can't expire (local disk) ignore this. */
  expiresInSeconds?: number;
}

/** The one seam every feature package's storage call goes through. */
export interface StoragePort {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  get(key: string): Promise<StorageGetResult>;
  signedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
}

export class StorageNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Storage object not found: "${key}"`);
    this.name = "StorageNotFoundError";
  }
}

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

async function toBuffer(body: StorageBody): Promise<Buffer> {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  throw new StorageConfigError("Unsupported storage body type — expected Uint8Array, ArrayBuffer, Blob, or string.");
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT",
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * LocalDiskAdapter — dev/test default
 * ──────────────────────────────────────────────────────────────────────────── */

function assertSafeKey(key: string): void {
  if (!key || key.startsWith("/") || key.includes("..")) {
    throw new StorageConfigError(`Unsafe storage key: "${key}"`);
  }
}

const DEFAULT_LOCAL_ROOT = resolve(process.cwd(), ".storage");

/**
 * Writes to `<root>/<key>` (default root: `.storage/` at the repo root,
 * gitignored) plus a `<key>.meta.json` sidecar carrying `contentType`/`size`
 * (plain files have no content-type header to read back otherwise). Node-only
 * (`node:fs/promises`) — import from server code paths, never a Client
 * Component.
 */
export class LocalDiskAdapter implements StoragePort {
  private readonly root: string;

  constructor(root: string = DEFAULT_LOCAL_ROOT) {
    this.root = resolve(root);
  }

  private resolvePath(key: string): string {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new StorageConfigError(`Storage key escapes the storage root: "${key}"`);
    }
    return full;
  }

  private metaPath(filePath: string): string {
    return `${filePath}.meta.json`;
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    const filePath = this.resolvePath(input.key);
    const buffer = await toBuffer(input.body);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);

    const contentType = input.contentType ?? null;
    await writeFile(this.metaPath(filePath), JSON.stringify({ contentType, size: buffer.byteLength }), "utf8");

    return { key: input.key, url: pathToFileURL(filePath).toString(), size: buffer.byteLength, contentType };
  }

  async get(key: string): Promise<StorageGetResult> {
    const filePath = this.resolvePath(key);
    let body: Buffer;
    try {
      body = await readFile(filePath);
    } catch (error) {
      if (isNotFoundError(error)) throw new StorageNotFoundError(key);
      throw error;
    }
    return { key, body: new Uint8Array(body), contentType: await this.readContentType(filePath), size: body.byteLength };
  }

  /**
   * No real signing scheme exists on local disk (no expiry, no auth) — this
   * is dev/test convenience only, returning the same `file://` URL as
   * `put()`. Still checks the object exists, mirroring the real contract
   * (a signed URL for a missing key is a caller bug, not a silent success).
   * `options` (expiry) is part of the `StoragePort` contract but has no
   * meaning here, so it's intentionally omitted from this implementation's
   * signature rather than kept as an unused parameter.
   */
  async signedUrl(key: string): Promise<string> {
    const filePath = this.resolvePath(key);
    try {
      await stat(filePath);
    } catch (error) {
      if (isNotFoundError(error)) throw new StorageNotFoundError(key);
      throw error;
    }
    return pathToFileURL(filePath).toString();
  }

  private async readContentType(filePath: string): Promise<string | null> {
    try {
      const raw = await readFile(this.metaPath(filePath), "utf8");
      const meta = JSON.parse(raw) as { contentType?: string | null };
      return meta.contentType ?? null;
    } catch {
      return null;
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * R2Adapter — stub
 * ──────────────────────────────────────────────────────────────────────────── */

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function readR2ConfigFromEnv(): R2Config | null {
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

/**
 * Cloudflare R2 adapter — STUB. Env-gated: the constructor throws
 * immediately unless `CLOUDFLARE_R2_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY`
 * / `_BUCKET` are all set (see `.env.local.example`), so a misconfigured
 * deploy fails at boot rather than on the first upload.
 *
 * TODO (before Receive/labels/documents ship for real — CROSS-FEATURE R2-25
 * items 1/2/3/12): implement `put`/`get`/`signedUrl` against R2's
 * S3-compatible API. `@aws-sdk/client-s3` for put/get,
 * `@aws-sdk/s3-request-presigner` for signedUrl, path-style addressing per
 * Cloudflare's S3-compatibility docs. Every method below throws until then.
 */
export class R2Adapter implements StoragePort {
  private readonly config: R2Config;

  constructor(config?: R2Config) {
    const resolved = config ?? readR2ConfigFromEnv();
    if (!resolved) {
      throw new StorageConfigError(
        "R2Adapter requires CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY, " +
          "CLOUDFLARE_R2_SECRET_KEY and CLOUDFLARE_R2_BUCKET to be set (see .env.local.example).",
      );
    }
    this.config = resolved;
  }

  async put(): Promise<StoragePutResult> {
    return this.notImplemented("put");
  }

  async get(): Promise<StorageGetResult> {
    return this.notImplemented("get");
  }

  async signedUrl(): Promise<string> {
    return this.notImplemented("signedUrl");
  }

  private notImplemented(method: string): never {
    throw new Error(
      `R2Adapter.${method}() is not implemented yet. Wire up an S3-compatible client (e.g. ` +
        `@aws-sdk/client-s3) against bucket "${this.config.bucket}" at ${this.config.endpoint} — see lib/storage/index.ts.`,
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */

/** Picks R2 when fully configured, else LocalDiskAdapter. Pure — no caching, safe to call anywhere. */
export function createStorageAdapter(): StoragePort {
  const r2Config = readR2ConfigFromEnv();
  return r2Config ? new R2Adapter(r2Config) : new LocalDiskAdapter();
}

let cachedAdapter: StoragePort | null = null;

/**
 * Lazily-constructed, memoized default adapter for convenience:
 * `import { getStorageAdapter } from "@/lib/storage"`. Not evaluated at
 * import time (so importing this module never throws in an unconfigured
 * test/CI env) — call it inside request/handler code.
 */
export function getStorageAdapter(): StoragePort {
  if (!cachedAdapter) cachedAdapter = createStorageAdapter();
  return cachedAdapter;
}
