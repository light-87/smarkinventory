import { describe, expect, test } from "bun:test";

// Scaffold smoke test — keeps `bun test` green until real suites land
// (see plan/TESTING.md for the layered test plan).
describe("scaffold", () => {
  test("bun test runner is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
