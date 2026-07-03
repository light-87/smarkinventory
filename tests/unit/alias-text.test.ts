import { describe, expect, test } from "bun:test";
import { aliasText, deAliasText } from "@/lib/ai/alias";

/**
 * lib/ai/alias.ts — `aliasText`/`deAliasText`. Pure, no DB: given a
 * (real name → alias code) mapping (whatever `ensureAliases` resolved for
 * the names relevant to one call), these do the actual text substitution
 * that keeps a Claude-bound payload leak-free (FEATURES.md §12).
 */

describe("aliasText", () => {
  test("replaces every occurrence of a known real name with its code", () => {
    const mapping = new Map([["Power Breezer Industries", "CLIENT-A"]]);
    const result = aliasText("Prioritize for Power Breezer Industries — Power Breezer Industries needs it Friday", mapping);
    expect(result).toBe("Prioritize for CLIENT-A — CLIENT-A needs it Friday");
    expect(result).not.toContain("Power Breezer");
  });

  test("is case-insensitive", () => {
    const mapping = new Map([["Acme Corp", "CLIENT-A"]]);
    expect(aliasText("ship to ACME CORP please", mapping)).toBe("ship to CLIENT-A please");
  });

  test("replaces the longest name first so a shorter name sharing a prefix doesn't partially clobber it", () => {
    const mapping = new Map([
      ["Power Breezer", "CLIENT-A"],
      ["Power Breezer Industries", "CLIENT-B"],
    ]);
    const result = aliasText("Contact Power Breezer Industries this week", mapping);
    expect(result).toBe("Contact CLIENT-B this week");
  });

  test("text with no known names passes through unchanged", () => {
    const mapping = new Map([["Acme Corp", "CLIENT-A"]]);
    expect(aliasText("STM32F103C8T6 x100 from Digikey", mapping)).toBe("STM32F103C8T6 x100 from Digikey");
  });

  test("empty/blank names in the mapping are ignored (no accidental blanket replace)", () => {
    const mapping = new Map([["", "CLIENT-A"]]);
    expect(aliasText("anything at all", mapping)).toBe("anything at all");
  });

  test("accepts a plain Record as well as a Map", () => {
    const result = aliasText("for Acme Corp", { "Acme Corp": "CLIENT-A" });
    expect(result).toBe("for CLIENT-A");
  });

  test("word-boundary matched — a short client/project name that is a SUBSTRING of a real, pass-through catalog identifier is NOT rewritten (report finding #3)", () => {
    const mapping = new Map([["Digi", "CLIENT-A"]]);
    // "Digi" is a real substring of "Digikey" (a distributor name — §12 pass-through
    // exception) — the un-fixed regex (no boundaries) rewrote it to "CLIENT-Akey".
    expect(aliasText("prefer LCSC over Digikey for this part", mapping)).toBe("prefer LCSC over Digikey for this part");
    // Still replaces the name when it truly appears as its own whole token.
    expect(aliasText("prefer Digi for this part", mapping)).toBe("prefer CLIENT-A for this part");
  });

  test("word-boundary matched — a project/client name that is a substring of a real MPN is NOT rewritten (report finding #3)", () => {
    const mapping = new Map([["C87", "PROJ-01"]]);
    // "C87" is a substring of the real MPN "C8734" (an LCSC PN — §12 pass-through exception).
    expect(aliasText("STM32F103C8T6 (C8734) LQFP-48", mapping)).toBe("STM32F103C8T6 (C8734) LQFP-48");
  });

  test("tolerates whitespace variants in the matched text (double space, newline) — not just the exact stored spacing", () => {
    const mapping = new Map([["Power Breezer", "CLIENT-A"]]);
    expect(aliasText("ship to Power  Breezer today", mapping)).toBe("ship to CLIENT-A today");
    expect(aliasText("ship to Power\nBreezer today", mapping)).toBe("ship to CLIENT-A today");
    expect(aliasText("ship to Power\tBreezer today", mapping)).toBe("ship to CLIENT-A today");
  });
});

describe("deAliasText — the reverse of aliasText", () => {
  test("replaces a code back to its real name", () => {
    const mapping = new Map([["Power Breezer Industries", "CLIENT-A"]]);
    expect(deAliasText("Ship to CLIENT-A by Friday", mapping)).toBe("Ship to Power Breezer Industries by Friday");
  });

  test("round-trips: aliasText then deAliasText returns the original text", () => {
    const mapping = new Map([
      ["Power Breezer Industries", "CLIENT-A"],
      ["TMCS 96x32 Matrix", "PROJ-01"],
    ]);
    const original = "Power Breezer Industries needs TMCS 96x32 Matrix expedited";
    const aliased = aliasText(original, mapping);
    expect(deAliasText(aliased, mapping)).toBe(original);
  });

  test("word-boundary matched — a shorter code can't eat into a longer one that happens to share a prefix", () => {
    const mapping = new Map([
      ["Project One", "PROJ-1"],
      ["Project Ten", "PROJ-10"],
    ]);
    expect(deAliasText("see PROJ-10 for details", mapping)).toBe("see Project Ten for details");
  });
});
