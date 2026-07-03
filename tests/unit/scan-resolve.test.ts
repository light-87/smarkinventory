import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyScanCode, normalizeScanCode, resolveScanCode } from "@/lib/scan/resolve";
import { TABLES, type Database } from "@/types/db";

/**
 * lib/scan/resolve — code → part/box resolution (FEATURES.md §5.5 · §8,
 * plan/tab-scan.md). `classifyScanCode`/`normalizeScanCode` are pure;
 * `resolveScanCode` is exercised against a small hand-rolled fake of the
 * PostgREST query-builder shape it calls, so this covers the actual
 * resolution logic (PID-first, then box by id/name, `null` on no match)
 * without a live Supabase instance.
 */

describe("classifyScanCode / normalizeScanCode", () => {
  test("empty / whitespace-only input classifies as empty", () => {
    expect(classifyScanCode("")).toBe("empty");
    expect(classifyScanCode("   ")).toBe("empty");
  });

  test("a uuid-shaped code classifies as uuid, case-insensitively", () => {
    expect(classifyScanCode("11111111-2222-3333-4444-555555555555")).toBe("uuid");
    expect(classifyScanCode("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe("uuid");
  });

  test("a PID or box-name code classifies as text", () => {
    expect(classifyScanCode("SMK-000101")).toBe("text");
    expect(classifyScanCode("A-03")).toBe("text");
  });

  test("normalizeScanCode trims surrounding whitespace only", () => {
    expect(normalizeScanCode("  SMK-000101  ")).toBe("SMK-000101");
  });
});

describe("resolveScanCode", () => {
  test("resolves a known PID to a part with its locations (big_box + shelf embedded)", async () => {
    const client = makeFakeClient(fixtures());
    const result = await resolveScanCode(client, "smk-000101"); // lowercase — case-insensitive
    expect(result?.type).toBe("part");
    if (result?.type !== "part") throw new Error("expected a part resolution");
    expect(result.data.part.internal_pid).toBe("SMK-000101");
    expect(result.data.locations).toHaveLength(1);
    expect(result.data.locations[0]?.big_box?.name).toBe("A-03");
    expect(result.data.locations[0]?.big_box?.shelf?.code).toBe("A");
  });

  test("resolves a box by its raw uuid id (the QR-encoded value) with contents joined to their parts", async () => {
    const client = makeFakeClient(fixtures());
    const result = await resolveScanCode(client, BOX_ID);
    expect(result?.type).toBe("box");
    if (result?.type !== "box") throw new Error("expected a box resolution");
    expect(result.data.box.name).toBe("A-03");
    expect(result.data.shelf?.code).toBe("A");
    expect(result.data.contents).toHaveLength(1);
    expect(result.data.contents[0]?.part.internal_pid).toBe("SMK-000101");
  });

  test("resolves a box by a case-insensitive exact name match (typed convenience fallback)", async () => {
    const client = makeFakeClient(fixtures());
    const result = await resolveScanCode(client, "a-03");
    expect(result?.type).toBe("box");
    if (result?.type !== "box") throw new Error("expected a box resolution");
    expect(result.data.box.id).toBe(BOX_ID);
  });

  test("an unknown code resolves to null (the 'No match' toast case) rather than throwing", async () => {
    const client = makeFakeClient(fixtures());
    const result = await resolveScanCode(client, "NOTHING-HERE-999");
    expect(result).toBeNull();
  });

  test("a PID match always wins even if it happens to also look box-shaped", async () => {
    const client = makeFakeClient({
      ...fixtures(),
      bigBoxes: [{ id: "box-1", shelf_id: "shelf-1", name: "SMK-000101", category: null, notes: null, qr_label_id: null, created_by: null, created_at: "", updated_at: null }],
    });
    const result = await resolveScanCode(client, "SMK-000101");
    expect(result?.type).toBe("part");
  });

  test("empty input resolves to null without querying anything", async () => {
    const client = makeFakeClient(fixtures());
    expect(await resolveScanCode(client, "   ")).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Minimal fake Supabase client — just enough of the PostgREST query-builder
 * chain `lib/scan/resolve.ts` actually calls (select/eq/ilike/limit/
 * maybeSingle, plus plain `await` on an unresolved chain for array results).
 * Local to this test file: docs/OWNERSHIP.md reserves `tests/helpers/**` for
 * the integrator, so a shared fake-client factory doesn't belong there.
 * ──────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

interface Fixtures {
  parts: Row[];
  stockLocations: Row[];
  bigBoxes: Row[];
  shelves: Row[];
}

/** Big-box QR labels encode the raw row id (SCHEMA.md §6) — a real uuid shape matters for classifyScanCode. */
const BOX_ID = "11111111-1111-1111-1111-111111111111";

function fixtures(): Fixtures {
  return {
    parts: [
      {
        id: "part-1",
        internal_pid: "SMK-000101",
        mpn: "STM32F103C8T6",
        manufacturer: null,
        lcsc_pn: null,
        description: null,
        category: null,
        value: "0.1uF",
        package: "0603",
        voltage: null,
        part_status: "active",
        datasheet_url: null,
        default_distributor: null,
        attributes: {},
        total_qty: 250,
        reorder_point: null,
        source_sheet: null,
        needs_review: false,
        last_unit_price: null,
        currency: "INR",
        created_by: null,
        created_at: "",
        updated_at: null,
      },
    ],
    stockLocations: [
      {
        id: "loc-1",
        part_id: "part-1",
        big_box_id: BOX_ID,
        qty: 250,
        esd_note: null,
        last_counted_at: null,
        created_by: null,
        created_at: "",
        updated_at: null,
      },
    ],
    bigBoxes: [
      {
        id: BOX_ID,
        shelf_id: "shelf-1",
        name: "A-03",
        category: "Capacitor",
        notes: null,
        qr_label_id: null,
        created_by: null,
        created_at: "",
        updated_at: null,
      },
    ],
    shelves: [{ id: "shelf-1", code: "A", name: "Passives", location_note: null, created_by: null, created_at: "", updated_at: null }],
  };
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private limitN: number | undefined;
  private isSingle = false;
  private cols = "*";

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly fx: Fixtures,
  ) {}

  select(cols: string) {
    this.cols = cols;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((row) => row[col] === val);
    return this;
  }
  ilike(col: string, val: string) {
    this.filters.push((row) => typeof row[col] === "string" && (row[col] as string).toLowerCase() === val.toLowerCase());
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    this.isSingle = true;
    return this;
  }
  single() {
    this.isSingle = true;
    return this;
  }

  private embed(row: Row): Row {
    let result = row;
    if (this.table === TABLES.stock_locations && this.cols.includes("big_box:")) {
      const box = this.fx.bigBoxes.find((b) => b.id === row.big_box_id) ?? null;
      const shelf = box ? (this.fx.shelves.find((s) => s.id === box.shelf_id) ?? null) : null;
      result = { ...result, big_box: box ? { ...box, shelf } : null };
    }
    if (this.table === TABLES.stock_locations && this.cols.includes("part:")) {
      const part = this.fx.parts.find((p) => p.id === row.part_id) ?? null;
      result = { ...result, part };
    }
    return result;
  }

  private resolveRows(): Row[] {
    const matched = this.rows.filter((row) => this.filters.every((f) => f(row))).map((row) => this.embed(row));
    return this.limitN !== undefined ? matched.slice(0, this.limitN) : matched;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const rows = this.resolveRows();
    const value = { data: this.isSingle ? (rows[0] ?? null) : rows, error: null };
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

function makeFakeClient(fx: Fixtures): SupabaseClient<Database> {
  const from = (table: string) => {
    switch (table) {
      case TABLES.parts:
        return new FakeQuery(table, fx.parts, fx);
      case TABLES.stock_locations:
        return new FakeQuery(table, fx.stockLocations, fx);
      case TABLES.big_boxes:
        return new FakeQuery(table, fx.bigBoxes, fx);
      case TABLES.shelves:
        return new FakeQuery(table, fx.shelves, fx);
      default:
        throw new Error(`fake client: unexpected table "${table}"`);
    }
  };
  return { from } as unknown as SupabaseClient<Database>;
}
