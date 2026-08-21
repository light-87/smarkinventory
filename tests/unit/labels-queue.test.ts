import { describe, expect, test } from "bun:test";
import { buildBigBoxHumanText, buildPartHumanText, isUniqueViolation } from "@/lib/labels/queue";

/** Pure label-text helpers from lib/labels/queue.ts (DB-touching parts are covered by the print-rule invariant suite). */

describe("buildPartHumanText", () => {
  test("joins PID, MPN, and value · package on separate lines", () => {
    const text = buildPartHumanText({ id: "p1", internal_pid: "SMK-000101", mpn: "GRM188R71H104KA93D", value: "100nF", package: "0603" });
    expect(text).toBe("SMK-000101\nGRM188R71H104KA93D\n100nF · 0603");
  });

  test("drops missing fields instead of leaving blank lines", () => {
    const text = buildPartHumanText({ id: "p2", internal_pid: "SMK-000102", mpn: null, value: null, package: "0805" });
    expect(text).toBe("SMK-000102\n0805");
  });
});

// One fact per line since 2026-08-21. The old single line, joined with " · ",
// could not fit the text space beside the QR, so the renderer cut it — the client
// photographed a box label reading "BOX Conne…". Per-line content is covered in
// tests/unit/labels-content.test.ts; this just pins the newline join.
describe("buildBigBoxHumanText", () => {
  test("puts the box name, category and shelf on their own lines", () => {
    const text = buildBigBoxHumanText({ id: "b1", name: "C-04", category: "Capacitors", shelfCode: "B" });
    expect(text).toBe("BOX C-04\nCapacitors\nShelf B");
  });

  test("omits a missing category", () => {
    const text = buildBigBoxHumanText({ id: "b2", name: "A-01", category: null, shelfCode: "A" });
    expect(text).toBe("BOX A-01\nShelf A");
  });
});

describe("isUniqueViolation", () => {
  test("recognizes Postgres SQLSTATE 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  test("rejects other shapes", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
