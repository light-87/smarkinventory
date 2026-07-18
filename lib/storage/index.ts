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
 *    CLAUDE.md's `{appname}-files` convention). The constructor is env-gated
 *    (throws immediately if `CLOUDFLARE_R2_*` isn't fully configured, so a
 *    bad deploy fails at boot, not on the first upload). Talks to R2's
 *    S3-compatible API via `aws4fetch` (SigV4 signing over plain `fetch`,
 *    no AWS SDK) — path-style addressing (`{endpoint}/{bucket}/{key}`),
 *    region always `"auto"` per Cloudflare's S3-compatibility docs.
 *
 * `getStorageAdapter()` picks R2 when `CLOUDFLARE_R2_*` env is fully set,
 * else falls back to `LocalDiskAdapter` — the same code path in dev/CI and
 * prod, just backed by a different adapter.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { AwsClient } from "aws4fetch";

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
 * R2Adapter
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

const R2_SERVICE = "s3";
/** R2 has no AWS regions — `aws4fetch` just needs a non-empty scope string, and "auto" is what Cloudflare's docs use. */
const R2_REGION = "auto";
/** Mirrors `SignedUrlOptions`' documented default (`LocalDiskAdapter` ignores this — it can't expire). */
const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 3600;

/** First ~200 chars of a response body, for error messages — never swallow the reason a request failed. */
async function readResponseExcerpt(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}

async function throwForResponse(method: string, key: string, response: Response): Promise<never> {
  const excerpt = await readResponseExcerpt(response);
  throw new Error(
    `R2Adapter.${method}("${key}") failed: ${response.status} ${response.statusText}${excerpt ? ` — ${excerpt}` : ""}`,
  );
}

/**
 * Cloudflare R2 adapter — env-gated: the constructor throws immediately
 * unless `CLOUDFLARE_R2_ENDPOINT` / `_ACCESS_KEY` / `_SECRET_KEY` / `_BUCKET`
 * are all set (see `.env.local.example`), so a misconfigured deploy fails at
 * boot rather than on the first upload.
 */
export class R2Adapter implements StoragePort {
  private readonly config: R2Config;
  private readonly client: AwsClient;

  constructor(config?: R2Config) {
    const resolved = config ?? readR2ConfigFromEnv();
    if (!resolved) {
      throw new StorageConfigError(
        "R2Adapter requires CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_ACCESS_KEY, " +
          "CLOUDFLARE_R2_SECRET_KEY and CLOUDFLARE_R2_BUCKET to be set (see .env.local.example).",
      );
    }
    this.config = resolved;
    this.client = new AwsClient({
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      service: R2_SERVICE,
      region: R2_REGION,
      // aws4fetch defaults to 10 retries with exponential backoff on 5xx/429 — a single
      // failing call could then take tens of seconds before surfacing. Fail fast instead;
      // callers that need resilience retry at the application level.
      retries: 0,
    });
  }

  /** Path-style object URL: `{endpoint}/{bucket}/{key}`. Validates the key (shared with `LocalDiskAdapter`). */
  private objectUrl(key: string): string {
    assertSafeKey(key);
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return `${this.config.endpoint.replace(/\/+$/, "")}/${this.config.bucket}/${encodedKey}`;
  }

  async put(input: StoragePutInput): Promise<StoragePutResult> {
    const url = this.objectUrl(input.key);
    const buffer = await toBuffer(input.body);
    const contentType = input.contentType ?? null;
    // R2 (unlike AWS S3) REQUIRES an explicit Content-Length and rejects a
    // streaming/chunked PUT with `411 MissingContentLength`. aws4fetch never
    // adds it (Content-Length is an UNSIGNABLE header, and it signs the body as
    // UNSIGNED-PAYLOAD), so set it ourselves — the body is already fully
    // buffered here, so the length is free. Being unsignable, it's excluded
    // from the SigV4 signature but still forwarded on the wire, so the
    // signature stays valid.
    const headers: HeadersInit = {
      ...(contentType ? { "content-type": contentType } : {}),
      "content-length": String(buffer.byteLength),
    };

    // Zero-copy view over the same bytes: TS's BodyInit wants Uint8Array<ArrayBuffer>
    // specifically, not Node's Buffer (typed Uint8Array<ArrayBufferLike>) — the cast is
    // safe because toBuffer() only ever produces Node Buffers backed by a real ArrayBuffer.
    const bodyView = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) as Uint8Array<ArrayBuffer>;
    const response = await this.client.fetch(url, { method: "PUT", body: bodyView, headers });
    if (!response.ok) await throwForResponse("put", input.key, response);

    return { key: input.key, url, size: buffer.byteLength, contentType };
  }

  async get(key: string): Promise<StorageGetResult> {
    const url = this.objectUrl(key);
    const response = await this.client.fetch(url, { method: "GET" });
    if (response.status === 404) throw new StorageNotFoundError(key);
    if (!response.ok) await throwForResponse("get", key, response);

    const body = new Uint8Array(await response.arrayBuffer());
    return { key, body, contentType: response.headers.get("content-type"), size: body.byteLength };
  }

  /**
   * Presigned GET via SigV4 query signing — no network call. Deliberately
   * does NOT check the key exists first (unlike `LocalDiskAdapter`): a real
   * presigned URL is a signature over a request that hasn't happened yet
   * (S3/R2 presigned PUTs routinely target keys that don't exist yet), and
   * an existence check would cost an extra signed round-trip on every call.
   * A signed URL for a missing key fails when it's actually fetched (404),
   * not at signing time.
   */
  async signedUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    const expiresInSeconds = options?.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;
    const url = new URL(this.objectUrl(key));
    url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

    const signedRequest = await this.client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
    return signedRequest.url;
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
