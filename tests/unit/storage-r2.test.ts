import { afterEach, describe, expect, test } from "bun:test";
import { R2Adapter, StorageConfigError, StorageNotFoundError, type R2Config } from "@/lib/storage";

/**
 * `R2Adapter` — no network, no real keys. `aws4fetch` (used by the adapter)
 * calls the global `fetch`, so every test that needs to observe or fake a
 * request stubs `globalThis.fetch` and restores it in `afterEach` — never
 * leaking a mock into another test file (Bun runs all test files in one
 * process).
 */

const TEST_CONFIG: R2Config = {
  endpoint: "https://abc123.r2.cloudflarestorage.com",
  accessKeyId: "test-access-key-id",
  secretAccessKey: "test-secret-access-key",
  bucket: "smarkstock-files-test",
};

const R2_ENV_KEYS = [
  "CLOUDFLARE_R2_ENDPOINT",
  "CLOUDFLARE_R2_ACCESS_KEY",
  "CLOUDFLARE_R2_SECRET_KEY",
  "CLOUDFLARE_R2_BUCKET",
] as const;

/** Runs `fn` with the given R2 env vars cleared, restoring whatever was there before. */
function withClearedR2Env(fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of R2_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    fn();
  } finally {
    for (const key of R2_ENV_KEYS) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
    }
  }
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("R2Adapter — constructor env-gating", () => {
  test("throws StorageConfigError naming all four required vars when env is unset", () => {
    withClearedR2Env(() => {
      expect(() => new R2Adapter()).toThrow(StorageConfigError);
      try {
        new R2Adapter();
        throw new Error("expected R2Adapter() to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(StorageConfigError);
        const message = (error as Error).message;
        expect(message).toContain("CLOUDFLARE_R2_ENDPOINT");
        expect(message).toContain("CLOUDFLARE_R2_ACCESS_KEY");
        expect(message).toContain("CLOUDFLARE_R2_SECRET_KEY");
        expect(message).toContain("CLOUDFLARE_R2_BUCKET");
      }
    });
  });

  test("constructs fine from an explicit config, bypassing env entirely", () => {
    withClearedR2Env(() => {
      expect(() => new R2Adapter(TEST_CONFIG)).not.toThrow();
    });
  });
});

describe("R2Adapter — key validation", () => {
  test("put rejects an unsafe key before any network call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    await expect(adapter.put({ key: "../escape.txt", body: "x" })).rejects.toBeInstanceOf(StorageConfigError);
    expect(fetchCalled).toBe(false);
  });

  test("get rejects a leading-slash key before any network call", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    await expect(adapter.get("/etc/passwd")).rejects.toBeInstanceOf(StorageConfigError);
    expect(fetchCalled).toBe(false);
  });

  test("signedUrl rejects an unsafe key without signing anything", async () => {
    const adapter = new R2Adapter(TEST_CONFIG);
    await expect(adapter.signedUrl("nested/../../escape.txt")).rejects.toBeInstanceOf(StorageConfigError);
  });
});

describe("R2Adapter — put", () => {
  test("sends a signed PUT to the object URL with the given content-type", async () => {
    let captured: Request | null = null;
    globalThis.fetch = (async (input: Request) => {
      captured = input;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    const result = await adapter.put({ key: "labels/qr-42.png", body: "hello", contentType: "image/png" });

    expect(captured).not.toBeNull();
    const request = captured as unknown as Request;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(`${TEST_CONFIG.endpoint}/${TEST_CONFIG.bucket}/labels/qr-42.png`);
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.headers.get("authorization")).toContain("AWS4-HMAC-SHA256");

    expect(result).toEqual({
      key: "labels/qr-42.png",
      url: `${TEST_CONFIG.endpoint}/${TEST_CONFIG.bucket}/labels/qr-42.png`,
      size: Buffer.byteLength("hello", "utf8"),
      contentType: "image/png",
    });
  });

  test("omits the content-type header and returns contentType null when none is given", async () => {
    let captured: Request | null = null;
    globalThis.fetch = (async (input: Request) => {
      captured = input;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    const result = await adapter.put({ key: "no-type.bin", body: "x" });

    expect((captured as unknown as Request).headers.get("content-type")).toBeNull();
    expect(result.contentType).toBeNull();
  });

  test("a non-2xx response throws with the status and a body excerpt", async () => {
    globalThis.fetch = (async () =>
      new Response("access denied: bad signature", { status: 403, statusText: "Forbidden" })) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    await expect(adapter.put({ key: "x.txt", body: "x" })).rejects.toThrow(/403.*access denied: bad signature/s);
  });
});

describe("R2Adapter — get", () => {
  test("404 maps to StorageNotFoundError", async () => {
    globalThis.fetch = (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    await expect(adapter.get("missing.txt")).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  test("returns the body bytes and content-type on 200", async () => {
    globalThis.fetch = (async () =>
      new Response("hello world", { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    const result = await adapter.get("hello.txt");

    expect(new TextDecoder().decode(result.body)).toBe("hello world");
    expect(result.contentType).toBe("text/plain");
    expect(result.size).toBe(Buffer.byteLength("hello world", "utf8"));
    expect(result.key).toBe("hello.txt");
  });

  test("a non-404 non-2xx response throws with the status and a body excerpt", async () => {
    globalThis.fetch = (async () => new Response("internal error", { status: 500 })) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    await expect(adapter.get("x.txt")).rejects.toThrow(/500.*internal error/s);
  });
});

describe("R2Adapter — signedUrl", () => {
  test("produces a presigned GET URL carrying bucket/key, signature, and default expiry", async () => {
    const adapter = new R2Adapter(TEST_CONFIG);
    const url = await adapter.signedUrl("receipts/2026/07/order-482.pdf");

    expect(url.startsWith(`${TEST_CONFIG.endpoint}/${TEST_CONFIG.bucket}/receipts/2026/07/order-482.pdf?`)).toBe(true);
    expect(url).toContain("X-Amz-Signature=");
    expect(url).toContain("X-Amz-Expires=3600");
    expect(url).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
  });

  test("respects a custom expiresInSeconds", async () => {
    const adapter = new R2Adapter(TEST_CONFIG);
    const url = await adapter.signedUrl("x.txt", { expiresInSeconds: 60 });

    expect(url).toContain("X-Amz-Expires=60");
  });

  test("never calls fetch — signing is purely local", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new R2Adapter(TEST_CONFIG);
    await adapter.signedUrl("x.txt");

    expect(fetchCalled).toBe(false);
  });
});
