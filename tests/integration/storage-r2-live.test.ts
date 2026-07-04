import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AwsClient } from "aws4fetch";
import { afterAll, describe, expect, test } from "bun:test";
import { R2Adapter, StorageNotFoundError, type R2Config } from "@/lib/storage";

/**
 * Live round-trip proof against a real R2 bucket — this is what turns green
 * the day real `CLOUDFLARE_R2_*` keys land (see lib/storage/index.ts). Gated
 * on those four env vars, mirroring tests/helpers/supabase.ts's
 * `describeWithDb` gate (same idea, R2 instead of the local Supabase stack):
 * self-skips everywhere the keys aren't configured, at zero cost.
 *
 * Adapter construction happens in `beforeAll`-equivalent (inline, but only
 * reached when the describe actually runs) — never at describe-body top
 * level, because Bun still executes a skipped describe's callback body to
 * collect its tests, and `new R2Adapter()` throws immediately when
 * unconfigured (same reasoning as tests/integration/db-schema.test.ts).
 */

function loadDotEnvLocalForR2Tests(): void {
  if (
    process.env.CLOUDFLARE_R2_ENDPOINT &&
    process.env.CLOUDFLARE_R2_ACCESS_KEY &&
    process.env.CLOUDFLARE_R2_SECRET_KEY &&
    process.env.CLOUDFLARE_R2_BUCKET
  ) {
    return;
  }

  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvLocalForR2Tests();

function readR2ConfigFromEnv(): R2Config | null {
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

const r2Config = readR2ConfigFromEnv();
const describeWithR2 = r2Config ? describe : describe.skip;

/**
 * Cleanup only — `StoragePort` intentionally has no `delete` (not a
 * capability any feature package needs), so this signs a raw DELETE
 * directly against R2's S3-compatible API rather than adding one to the
 * port for a single test's sake.
 */
async function deleteObject(config: R2Config, key: string): Promise<void> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const url = `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const response = await client.fetch(url, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`storage-r2-live cleanup: DELETE failed for "${key}": ${response.status} ${response.statusText}`);
  }
}

describeWithR2("R2Adapter — live round-trip (real bucket, real keys)", () => {
  const testKey = `smarkstock-test/storage-r2-live-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  const body = `smarkstock R2 live round-trip proof — ${new Date().toISOString()}`;

  afterAll(async () => {
    await deleteObject(r2Config as R2Config, testKey);
  });

  test("put -> get -> signedUrl -> fetch round-trips real bytes through the real bucket", async () => {
    const adapter = new R2Adapter(r2Config as R2Config);

    const putResult = await adapter.put({ key: testKey, body, contentType: "text/plain" });
    expect(putResult.key).toBe(testKey);
    expect(putResult.size).toBe(Buffer.byteLength(body, "utf8"));
    expect(putResult.contentType).toBe("text/plain");

    const getResult = await adapter.get(testKey);
    expect(new TextDecoder().decode(getResult.body)).toBe(body);

    const url = await adapter.signedUrl(testKey, { expiresInSeconds: 300 });
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe(body);
  });

  test("get on a missing key throws StorageNotFoundError against the real bucket", async () => {
    const adapter = new R2Adapter(r2Config as R2Config);
    await expect(adapter.get(`${testKey}-does-not-exist`)).rejects.toBeInstanceOf(StorageNotFoundError);
  });
});
