import { describe, expect, test } from "bun:test";
import {
  resolveDistributorSequence,
  toStoredSequence,
  type DistributorPreferenceRefRow,
  type DistributorRefRow,
} from "@/lib/runs/distributor-sequence";

/**
 * Pure distributor-sequence resolver (plan/tab-ordering-workspace.md §2.1;
 * lib/runs/distributor-sequence.ts module doc — this is the file's own
 * self-referenced test, tests/unit/runs-distributor-sequence.test.ts).
 */

const DIGIKEY: DistributorRefRow = { id: "d1", name: "Digikey", api_type: "rest", active: true };
const MOUSER: DistributorRefRow = { id: "d2", name: "Mouser", api_type: "rest", active: true };
const LCSC: DistributorRefRow = { id: "d3", name: "LCSC", api_type: "browse", active: true };
const UNIKEY: DistributorRefRow = { id: "d4", name: "Unikey", api_type: "browse", active: true };
const INACTIVE: DistributorRefRow = { id: "d5", name: "Retired Co", api_type: "rest", active: false };

const ALL = [DIGIKEY, MOUSER, LCSC, UNIKEY, INACTIVE];

const DEFAULT_PREFS: DistributorPreferenceRefRow[] = [
  { distributor_id: "d1", rank: 1, enabled: true },
  { distributor_id: "d2", rank: 2, enabled: true },
  { distributor_id: "d3", rank: 3, enabled: true },
  { distributor_id: "d4", rank: 4, enabled: true },
];

describe("resolveDistributorSequence — no saved sequence (BOM default)", () => {
  test("orders by global preference rank", () => {
    const rows = resolveDistributorSequence(null, ALL, DEFAULT_PREFS);
    expect(rows.map((r) => r.name)).toEqual(["Digikey", "Mouser", "LCSC", "Unikey"]);
  });

  test("every active distributor is enabled by default, Unikey included", () => {
    const rows = resolveDistributorSequence(null, ALL, DEFAULT_PREFS);
    expect(rows.every((r) => r.enabled)).toBe(true);
  });

  test("excludes inactive distributors entirely", () => {
    const rows = resolveDistributorSequence(null, ALL, DEFAULT_PREFS);
    expect(rows.some((r) => r.name === "Retired Co")).toBe(false);
  });

  test("unranked distributors sort last, stable by name", () => {
    const rows = resolveDistributorSequence(null, ALL, []);
    expect(rows.map((r) => r.name)).toEqual(["Digikey", "LCSC", "Mouser", "Unikey"]);
  });

  test("ranks are 1-based and sequential", () => {
    const rows = resolveDistributorSequence(null, ALL, DEFAULT_PREFS);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("resolveDistributorSequence — a saved per-BOM sequence", () => {
  test("saved order + toggles win outright, including re-enabling Unikey", () => {
    const saved = [
      { distributor_id: "d4", enabled: true }, // Unikey, re-enabled by the user
      { distributor_id: "d3", enabled: true }, // LCSC
      { distributor_id: "d1", enabled: false }, // Digikey, turned off
    ];
    const rows = resolveDistributorSequence(saved, ALL, DEFAULT_PREFS);
    expect(rows.map((r) => ({ name: r.name, enabled: r.enabled }))).toEqual([
      { name: "Unikey", enabled: true },
      { name: "LCSC", enabled: true },
      { name: "Digikey", enabled: false },
      { name: "Mouser", enabled: true }, // appended — not in the saved sequence, active
    ]);
  });

  test("a distributor referenced in the saved sequence but no longer active is dropped", () => {
    const saved = [
      { distributor_id: "d5", enabled: true }, // "Retired Co" — inactive
      { distributor_id: "d1", enabled: true },
    ];
    const rows = resolveDistributorSequence(saved, ALL, DEFAULT_PREFS);
    expect(rows.some((r) => r.name === "Retired Co")).toBe(false);
    expect(rows[0]?.name).toBe("Digikey");
  });

  test("a duplicate id in the saved sequence is not double-counted", () => {
    const saved = [
      { distributor_id: "d1", enabled: true },
      { distributor_id: "d1", enabled: false },
    ];
    const rows = resolveDistributorSequence(saved, ALL, DEFAULT_PREFS);
    expect(rows.filter((r) => r.name === "Digikey")).toHaveLength(1);
    expect(rows.find((r) => r.name === "Digikey")?.enabled).toBe(true); // first occurrence wins
  });

  test("an empty saved sequence array falls back to the global-preference default, not an empty list", () => {
    const rows = resolveDistributorSequence([], ALL, DEFAULT_PREFS);
    expect(rows.map((r) => r.name)).toEqual(["Digikey", "Mouser", "LCSC", "Unikey"]);
  });
});

describe("toStoredSequence", () => {
  test("round-trips id + enabled only (drops name/apiType/rank)", () => {
    const rows = resolveDistributorSequence(null, ALL, DEFAULT_PREFS);
    const stored = toStoredSequence(rows);
    expect(stored).toEqual([
      { distributor_id: "d1", enabled: true },
      { distributor_id: "d2", enabled: true },
      { distributor_id: "d3", enabled: true },
      { distributor_id: "d4", enabled: true },
    ]);
  });
});
