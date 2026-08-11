/**
 * The id-list chunker behind `/shelves`.
 *
 * `.in("id", […])` is serialised into the query string, so a list long enough
 * makes a URL long enough for PostgREST to answer `400 Bad Request` — which is
 * exactly how the Shelves page died once the real catalog landed (~1,750 part
 * ids behind the staging box's locations). These assert the two properties the
 * page depends on: no request ever carries more than the chunk size, and every
 * row still comes back.
 */

import { describe, expect, test } from "bun:test";
import { IN_FILTER_CHUNK, chunk, selectByIds } from "@/lib/supabase/select-all";

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `id-${i}`);
}

describe("chunk", () => {
  test("splits into runs of at most the chunk size", () => {
    expect(chunk(ids(5), 2)).toEqual([["id-0", "id-1"], ["id-2", "id-3"], ["id-4"]]);
  });

  test("an empty list produces no chunks", () => {
    expect(chunk([], 2)).toEqual([]);
  });

  test("defaults to IN_FILTER_CHUNK", () => {
    expect(chunk(ids(450)).map((c) => c.length)).toEqual([IN_FILTER_CHUNK, IN_FILTER_CHUNK, 50]);
  });
});

describe("selectByIds", () => {
  test("never sends more than IN_FILTER_CHUNK ids in one request", async () => {
    const sizes: number[] = [];
    await selectByIds(ids(1745), (idChunk) => {
      sizes.push(idChunk.length);
      return Promise.resolve({ data: [], error: null });
    });

    expect(Math.max(...sizes)).toBeLessThanOrEqual(IN_FILTER_CHUNK);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(1745);
  });

  test("returns every row across every chunk, in order", async () => {
    const rows = await selectByIds(ids(500), (idChunk) =>
      Promise.resolve({ data: idChunk.map((id) => ({ id })), error: null }),
    );

    expect(rows).toHaveLength(500);
    expect(rows[0]).toEqual({ id: "id-0" });
    expect(rows[499]).toEqual({ id: "id-499" });
  });

  test("makes no request at all for an empty id list", async () => {
    let calls = 0;
    const rows = await selectByIds([], () => {
      calls += 1;
      return Promise.resolve({ data: [], error: null });
    });

    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  test("throws on the first failing chunk rather than returning a partial list", async () => {
    let calls = 0;
    const attempt = selectByIds(ids(600), () => {
      calls += 1;
      return Promise.resolve(
        calls === 2 ? { data: null, error: { message: "Bad Request" } } : { data: [], error: null },
      );
    });

    await expect(attempt).rejects.toThrow("Bad Request");
    expect(calls).toBe(2);
  });
});
