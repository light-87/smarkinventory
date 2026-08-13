/**
 * Which BOM lines a desktop run actually sends to the distributors.
 *
 * This is the rule that decides how long a run takes and what it costs the
 * operator in their own Claude usage, so it is worth pinning down. Until
 * 2026-08-13 a desktop run sourced every line including ones already in stock;
 * on the client's own BOM that was 113 lines of work where 40 were needed.
 *
 * The agent never re-checks our inventory — it only talks to distributors — so
 * every line included here is a line genuinely searched online.
 */

import { describe, expect, test } from "bun:test";
import { sourceableLines } from "@/lib/runs/enqueue";

const line = (id: string, match_state: string, dnp = false) => ({ id, match_state, dnp });

const BOM = [
  line("a", "in_stock"),
  line("b", "to_order"),
  line("c", "unresolved"),
  line("d", "in_stock"),
  line("e", "to_order", true), // do-not-populate: need is zero
];

describe("sourceableLines", () => {
  test("skips lines already in stock", () => {
    expect(sourceableLines(BOM, false).map((l) => l.id)).toEqual(["b", "c"]);
  });

  test("keeps unresolved lines — an undecided line still has to be priced", () => {
    expect(sourceableLines(BOM, false).some((l) => l.id === "c")).toBe(true);
  });

  test("skips DNP lines, whose need is zero", () => {
    expect(sourceableLines(BOM, false).some((l) => l.id === "e")).toBe(false);
  });

  test('"re-source all" overrides everything, including DNP', () => {
    expect(sourceableLines(BOM, true)).toHaveLength(BOM.length);
  });

  test("a fully stocked BOM has nothing to source", () => {
    expect(sourceableLines([line("a", "in_stock"), line("b", "in_stock")], false)).toEqual([]);
  });

  test("does not mutate the input", () => {
    const input = [...BOM];
    sourceableLines(input, true);
    expect(input).toEqual(BOM);
  });
});
