import { describe, expect, test } from "bun:test";
import { buildChangeSummary, buildDigestContent, renderRuleText, scopeLabel } from "@/lib/ai/digest";

/**
 * lib/ai/digest.ts — the pure digest-text + version-diff builders (no DB).
 * `smark_learned_rules.value` convention: `value.text` is the single
 * plain-English rule line (see that module's doc comment) — these tests
 * lock that convention in, plus the fallback for a row without it.
 */

describe("buildDigestContent", () => {
  test("numbers active rules 1., 2., ... with scope + subject + rule text", () => {
    const content = buildDigestContent([
      { scope: "category", subject: "GCU 0.1µF caps", rule_type: "prefer_distributor", value: { text: "Prefer LCSC for GCU 0.1µF caps" } },
      { scope: "part", subject: "C14663", rule_type: "already_stocked", value: { text: "Already stocked — don't reorder below 500" } },
    ]);
    expect(content).toBe(
      "1. [Category] GCU 0.1µF caps — Prefer LCSC for GCU 0.1µF caps\n" +
        "2. [Part] C14663 — Already stocked — don't reorder below 500",
    );
  });

  test("global-scope rules with no subject render 'All'", () => {
    const content = buildDigestContent([
      { scope: "global", subject: null, rule_type: "package_correction", value: { text: "Package is never substitutable" } },
    ]);
    expect(content).toContain("[Global] All — Package is never substitutable");
  });

  test("empty active-rule set renders a plain empty message, not an empty string or 'undefined'", () => {
    expect(buildDigestContent([])).toBe("No active rules yet.");
  });

  test("falls back to a generic rule_type label when value.text is absent (e.g. a hand-inserted row)", () => {
    const content = buildDigestContent([{ scope: "distributor", subject: "Unikey", rule_type: "avoid_distributor", value: {} }]);
    expect(content).toContain("[Distributor] Unikey — Avoid distributor");
    expect(content).not.toContain("undefined");
  });
});

describe("renderRuleText", () => {
  test("prefers value.text verbatim over any generated label", () => {
    const text = renderRuleText({ rule_type: "prefer_distributor", value: { text: "Unikey only if cheaper AND in stock" }, subject: null });
    expect(text).toBe("Unikey only if cheaper AND in stock");
  });
});

describe("scopeLabel", () => {
  test("title-cases the scope enum for display", () => {
    expect(scopeLabel("global")).toBe("Global");
    expect(scopeLabel("distributor")).toBe("Distributor");
  });
});

describe("buildChangeSummary — the digest diff line", () => {
  test("approve reads as a version bump with a +1 rule line", () => {
    const summary = buildChangeSummary(3, "approve", {
      rule_type: "prefer_distributor",
      value: { text: "prefer LCSC for GCU 0.1µF caps" },
      subject: null,
    });
    expect(summary).toBe("v3 → v4: +1 rule (prefer LCSC for GCU 0.1µF caps)");
  });

  test("retire reads as a version bump with a -1 rule line", () => {
    const summary = buildChangeSummary(4, "retire", {
      rule_type: "prefer_distributor",
      value: { text: "Unikey only if cheaper AND in stock" },
      subject: null,
    });
    expect(summary).toBe("v4 → v5: -1 rule (Unikey only if cheaper AND in stock)");
  });

  test("starting from v0 (no digest ever written) bumps to v1", () => {
    const summary = buildChangeSummary(0, "approve", { rule_type: "already_stocked", value: { text: "x" }, subject: null });
    expect(summary.startsWith("v0 → v1:")).toBe(true);
  });
});
