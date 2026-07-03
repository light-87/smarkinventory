import { describe, expect, test } from "bun:test";
import { computeAliasAssignments, deterministicEntityId, type AliasRow } from "@/lib/ai/alias";

/**
 * lib/ai/alias.ts — `computeAliasAssignments` + `deterministicEntityId`.
 * Pure, no DB — see that module's doc comment for why `entity_id` is a
 * deterministic hash rather than a real foreign-key id (client/product/
 * custom have no backing table; `smark_ai_aliases.entity_id` is
 * "polymorphic, no FK by design" per migration 0004).
 */

describe("deterministicEntityId", () => {
  test("same (kind, name) always yields the same uuid", () => {
    const a = deterministicEntityId("client", "Power Breezer Industries");
    const b = deterministicEntityId("client", "Power Breezer Industries");
    expect(a).toBe(b);
  });

  test("is case- and whitespace-insensitive", () => {
    const a = deterministicEntityId("client", "Power Breezer Industries");
    const b = deterministicEntityId("client", "  power breezer industries  ");
    expect(a).toBe(b);
  });

  test("different kinds for the same name never collide", () => {
    const client = deterministicEntityId("client", "Acme");
    const project = deterministicEntityId("project", "Acme");
    expect(client).not.toBe(project);
  });

  test("different names never collide", () => {
    const a = deterministicEntityId("project", "TMCS 96x32 Matrix");
    const b = deterministicEntityId("project", "GCU V1.1");
    expect(a).not.toBe(b);
  });

  test("produces a well-formed RFC 4122 v5 uuid", () => {
    const id = deterministicEntityId("project", "Anything");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("computeAliasAssignments", () => {
  test("mints CLIENT-A, CLIENT-B, ... in the order names are given, starting fresh", () => {
    const { mapping, newRows } = computeAliasAssignments("client", ["Power Breezer Industries", "Acme Corp"], []);
    expect(mapping.get("Power Breezer Industries")).toBe("CLIENT-A");
    expect(mapping.get("Acme Corp")).toBe("CLIENT-B");
    expect(newRows).toHaveLength(2);
  });

  test("mints PROJ-01, PROJ-02, ... (zero-padded numbers, not letters) for the project kind", () => {
    const { mapping } = computeAliasAssignments("project", ["TMCS 96x32 Matrix", "GCU V1.1"], []);
    expect(mapping.get("TMCS 96x32 Matrix")).toBe("PROJ-01");
    expect(mapping.get("GCU V1.1")).toBe("PROJ-02");
  });

  test("is idempotent — a name that already has a row reuses its alias instead of minting a new one", () => {
    const existing: AliasRow[] = [{ entity_id: deterministicEntityId("client", "Acme Corp"), alias: "CLIENT-A" }];
    const { mapping, newRows } = computeAliasAssignments("client", ["Acme Corp"], existing);
    expect(mapping.get("Acme Corp")).toBe("CLIENT-A");
    expect(newRows).toHaveLength(0);
  });

  test("new names continue the sequence AFTER the highest existing suffix, never reusing or restarting it", () => {
    const existing: AliasRow[] = [
      { entity_id: deterministicEntityId("client", "Acme Corp"), alias: "CLIENT-A" },
      { entity_id: deterministicEntityId("client", "Beta LLP"), alias: "CLIENT-B" },
    ];
    const { mapping, newRows } = computeAliasAssignments("client", ["Gamma Ltd"], existing);
    expect(mapping.get("Gamma Ltd")).toBe("CLIENT-C");
    expect(newRows).toEqual([{ entity_id: deterministicEntityId("client", "Gamma Ltd"), alias: "CLIENT-C" }]);
  });

  test("rolls over from Z to AA past the 26th client (spreadsheet-column style)", () => {
    // Build up 26 existing rows by feeding each mint's output back in as the
    // next call's `existingRows` — mirrors how `ensureAliases` accumulates
    // rows across many real calls over time.
    let existing: AliasRow[] = [];
    for (let i = 0; i < 26; i += 1) {
      const { newRows } = computeAliasAssignments("client", [`Client ${i}`], existing);
      existing = [...existing, ...newRows];
    }
    // Sanity: the 26th minted alias really is CLIENT-Z before we test rollover.
    expect(existing[25]!.alias).toBe("CLIENT-Z");

    const { mapping } = computeAliasAssignments("client", ["Client 26"], existing);
    expect(mapping.get("Client 26")).toBe("CLIENT-AA");
  });

  test("duplicate names in the SAME call resolve to one alias, not two", () => {
    const { mapping, newRows } = computeAliasAssignments("project", ["Same Project", "Same Project"], []);
    expect(mapping.get("Same Project")).toBe("PROJ-01");
    expect(newRows).toHaveLength(1);
  });

  test("blank/whitespace-only names are skipped entirely", () => {
    const { mapping, newRows } = computeAliasAssignments("project", ["", "   ", "Real Project"], []);
    expect(mapping.size).toBe(1);
    expect(mapping.get("Real Project")).toBe("PROJ-01");
    expect(newRows).toHaveLength(1);
  });
});
