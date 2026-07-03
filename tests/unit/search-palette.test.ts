import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bomHref,
  boxHref,
  isEmptyPaletteResults,
  looksLikeScanCode,
  orderHref,
  partHref,
  projectHref,
  searchBoms,
  searchOrders,
  searchPalette,
  searchParts,
  searchProjects,
} from "@/lib/search/queries";
import { TABLES, type Database } from "@/types/db";

/**
 * lib/search/queries — the Ctrl-K palette's query shaping + the scan-code
 * short-circuit's pattern check (FEATURES.md §5 header spec; plan/tab-login-
 * shell.md R2-34). `looksLikeScanCode` is pure; the section-search functions
 * are exercised against a small hand-rolled fake of the PostgREST
 * query-builder shape they call — same convention as
 * tests/unit/scan-resolve.test.ts (docs/OWNERSHIP.md reserves
 * tests/helpers/** for the integrator, so this fake stays local).
 */

describe("looksLikeScanCode — the scan-code short-circuit's pattern check", () => {
  test("an exact SMK- PID shape short-circuits", () => {
    expect(looksLikeScanCode("SMK-000101")).toBe(true);
    expect(looksLikeScanCode("smk-101")).toBe(true); // case-insensitive
    expect(looksLikeScanCode("  SMK-000101  ")).toBe(true); // surrounding whitespace tolerated
  });

  test("a uuid-shaped box code (the raw QR-encoded row id) short-circuits", () => {
    expect(looksLikeScanCode("11111111-2222-3333-4444-555555555555")).toBe(true);
  });

  test("free-text palette queries do NOT short-circuit", () => {
    expect(looksLikeScanCode("10k resistor")).toBe(false);
    expect(looksLikeScanCode("STM32")).toBe(false);
    expect(looksLikeScanCode("Mainboard v1.2")).toBe(false);
    expect(looksLikeScanCode("A-03")).toBe(false); // a box's free-text name, not its QR-encoded id
  });

  test("empty/whitespace-only input never short-circuits", () => {
    expect(looksLikeScanCode("")).toBe(false);
    expect(looksLikeScanCode("   ")).toBe(false);
  });
});

describe("deep-link href builders", () => {
  test("build the routes each owning package registers per docs/OWNERSHIP.md", () => {
    expect(partHref("SMK-000101")).toBe("/part/SMK-000101");
    expect(boxHref("11111111-1111-1111-1111-111111111111")).toBe(
      "/shelves?box=11111111-1111-1111-1111-111111111111",
    );
    expect(projectHref("proj-1")).toBe("/projects/proj-1");
    expect(bomHref("proj-1", "bom-1")).toBe("/projects/proj-1/boms/bom-1");
    expect(orderHref("order-1")).toBe("/cart?order=order-1");
  });
});

describe("searchPalette / section search — query shaping", () => {
  test("below the minimum length, every section is empty and no query runs", async () => {
    const client = makeFakeClient(fixtures());
    const result = await searchPalette(client, "s");
    expect(isEmptyPaletteResults(result)).toBe(true);
  });

  test("parts match by PID, MPN, or value — merged and deduped by id", async () => {
    const client = makeFakeClient(fixtures());
    const hits = await searchParts(client, "0101");
    expect(hits.map((h) => h.internal_pid)).toEqual(["SMK-000101"]);
  });

  test("a part matching on two searched columns at once is not returned twice", async () => {
    // Fixture part-2's mpn AND value both contain "10k" — searchParts runs one
    // ilike per column in parallel and must dedupe the merged result by id.
    const client = makeFakeClient(fixtures());
    const hits = await searchParts(client, "10k");
    expect(hits.filter((h) => h.internal_pid === "SMK-000201")).toHaveLength(1);
  });

  test("projects match by name or client", async () => {
    const client = makeFakeClient(fixtures());
    const byName = await searchProjects(client, "widget");
    expect(byName.map((h) => h.id)).toEqual(["proj-1"]);
    const byClient = await searchProjects(client, "acme");
    expect(byClient.map((h) => h.id)).toEqual(["proj-1"]);
  });

  test("BOMs carry their parent project's name for display", async () => {
    const client = makeFakeClient(fixtures());
    const hits = await searchBoms(client, "mainboard");
    expect(hits).toEqual([{ id: "bom-1", name: "Mainboard v1.2", project_id: "proj-1", project_name: "Acme Widget" }]);
  });

  test("orders match by PO number and carry the distributor's name", async () => {
    const client = makeFakeClient(fixtures());
    const hits = await searchOrders(client, "po-2026");
    expect(hits).toEqual([
      { id: "order-1", po_number: "PO-2026-001", status: "ordered", distributor_id: "dist-1", distributor_name: "Mouser" },
    ]);
  });

  test("a query with no matches anywhere returns all-empty sections, not an error", async () => {
    const client = makeFakeClient(fixtures());
    const result = await searchPalette(client, "zzz-nothing-here");
    expect(isEmptyPaletteResults(result)).toBe(true);
  });

  test("a full palette search runs all four sections in parallel", async () => {
    const client = makeFakeClient(fixtures());
    const result = await searchPalette(client, "0101");
    expect(result.parts.map((h) => h.internal_pid)).toEqual(["SMK-000101"]);
    expect(result.projects).toEqual([]);
    expect(result.boms).toEqual([]);
    expect(result.orders).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Minimal fake Supabase client — just enough of the PostgREST query-builder
 * chain lib/search/queries.ts actually calls (select/ilike/limit, plus plain
 * `await` on the unresolved chain). Local to this file per docs/OWNERSHIP.md
 * ("tests/helpers/** reserved for the integrator").
 * ──────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

interface Fixtures {
  parts: Row[];
  projects: Row[];
  boms: Row[];
  orders: Row[];
  distributors: Row[];
}

function fixtures(): Fixtures {
  return {
    parts: [
      {
        id: "part-1",
        internal_pid: "SMK-000101",
        mpn: "CL10B104MB8NNNC",
        value: "0.1uF",
        package: "0603",
        description: "Ceramic cap",
        total_qty: 250,
      },
      {
        id: "part-2",
        internal_pid: "SMK-000201",
        mpn: "RC0402JR-10k-RL",
        value: "10k",
        package: "0402",
        description: "10k resistor 1%",
        total_qty: 900,
      },
    ],
    projects: [{ id: "proj-1", name: "Acme Widget", client: "Acme Co", archived_at: null }],
    boms: [{ id: "bom-1", name: "Mainboard v1.2", project_id: "proj-1" }],
    distributors: [{ id: "dist-1", name: "Mouser" }],
    orders: [{ id: "order-1", po_number: "PO-2026-001", status: "ordered", distributor_id: "dist-1" }],
  };
}

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private limitN: number | undefined;
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

  /** Real ILIKE '%pattern%' is a case-insensitive substring test — mirrored here directly. */
  ilike(col: string, pattern: string) {
    const needle = pattern.replace(/^%/, "").replace(/%$/, "").toLowerCase();
    this.filters.push((row) => typeof row[col] === "string" && (row[col] as string).toLowerCase().includes(needle));
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  private embed(row: Row): Row {
    let result = row;
    if (this.table === TABLES.boms && this.cols.includes("project:")) {
      const project = this.fx.projects.find((p) => p.id === row.project_id) ?? null;
      result = { ...result, project };
    }
    if (this.table === TABLES.orders && this.cols.includes("distributor:")) {
      const distributor = this.fx.distributors.find((d) => d.id === row.distributor_id) ?? null;
      result = { ...result, distributor };
    }
    return result;
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const matched = this.rows.filter((row) => this.filters.every((f) => f(row))).map((row) => this.embed(row));
    const rows = this.limitN !== undefined ? matched.slice(0, this.limitN) : matched;
    return Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected);
  }
}

function makeFakeClient(fx: Fixtures): SupabaseClient<Database> {
  const from = (table: string) => {
    switch (table) {
      case TABLES.parts:
        return new FakeQuery(table, fx.parts, fx);
      case TABLES.projects:
        return new FakeQuery(table, fx.projects, fx);
      case TABLES.boms:
        return new FakeQuery(table, fx.boms, fx);
      case TABLES.orders:
        return new FakeQuery(table, fx.orders, fx);
      default:
        throw new Error(`fake client: unexpected table "${table}"`);
    }
  };
  return { from } as unknown as SupabaseClient<Database>;
}
