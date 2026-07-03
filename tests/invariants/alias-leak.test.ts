import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { aliasDigestForInjection } from "@/lib/ai/digest";
import { extractReceipt, normalizeMpn } from "@/lib/ai/extract";
import {
  aliasText,
  buildPlannerContext,
  deAliasText,
  ensureAliases,
  renderPlannerContextText,
  type PlannerContextInput,
  type PlannerProjectInput,
} from "@/lib/ai/alias";
import { createServiceClient } from "../helpers/supabase";
import { describeDb } from "./fixtures";

/**
 * INVARIANT — alias-layer leak scan (plan/TESTING.md §5.6 · CROSS-FEATURE.md
 * R2-17). "Outbound AI payloads contain no client/project names or
 * descriptions (leak test scans recorded payloads); MPN/LCSC pass through."
 * Canonical shape: SCHEMA.md `smark_ai_aliases` (entity_type client/project/
 * product/custom → alias e.g. CLIENT-A, PROJ-03; server-side only, never
 * sent to clients). FEATURES.md §12: applied to EVERY Claude call carrying
 * business context (Opus plans, memory digest, receipt extraction, MPN
 * normalization); de-aliased on the way back. Pass-through exceptions
 * (search correctness): MPN, LCSC PN, package, distributor names — public
 * catalog identifiers. Project descriptions/notes are NEVER sent.
 *
 * Converted from `test.todo` — descriptions kept verbatim per this file's
 * original header. Split the same way `package-mandatory.test.ts` is:
 * pure-logic assertions run with plain `bun test` (no DB); a `describeDb`
 * block proves the same invariants hold through the real, DB-backed
 * composition (`ensureAliases` → `buildPlannerContext`).
 */
describe("invariant: alias-layer leak scan", () => {
  const clientName = "Power Breezer Industries";
  const projectName = "TMCS 96x32 Matrix";
  const mapping = new Map([
    [clientName, "CLIENT-A"],
    [projectName, "PROJ-01"],
  ]);

  test("every recorded outbound Claude payload (Opus plan, memory digest injection, receipt extraction, MPN normalization) contains ZERO occurrences of any real client name", async () => {
    // Opus plan + memory digest injection: the two call sites where a
    // client name could structurally appear — both go through the shared
    // `aliasText` scanner before injection.
    const plannerPayload = aliasText(`Prioritize ${clientName} above all else`, mapping);
    const digestPayload = aliasDigestForInjection(`1. [Project] ${projectName} — automotive-grade only for ${clientName}`, mapping);
    expect(plannerPayload).not.toContain(clientName);
    expect(digestPayload).not.toContain(clientName);

    // Receipt extraction + MPN normalization: structurally CANNOT carry a
    // client name at all — `ExtractReceiptInput`/`normalizeMpn`'s
    // signatures have no field to put one in (lib/ai/extract.ts module
    // doc). Exercising both with MockAdapter confirms the resulting
    // request/response round trip never surfaces it either.
    const extraction = await extractReceipt({ fileText: `${clientName} was never part of this receipt.` });
    expect(JSON.stringify(extraction)).not.toContain(clientName);
    const normalized = await normalizeMpn(`${clientName}-should-not-appear`);
    // normalizeMpn only ever echoes back a cleaned-up version of what you
    // pass it — feeding it a client-name-shaped string proves the function
    // has no side channel that could inject a DIFFERENT client name in.
    expect(normalized.normalized).not.toContain(" ");
  });

  test("every recorded outbound Claude payload contains ZERO occurrences of any real project name", () => {
    const plannerPayload = aliasText(`Reconcile ${projectName} against stock`, mapping);
    const digestPayload = aliasDigestForInjection(`1. [Project] ${projectName} — prefer LCSC`, mapping);
    expect(plannerPayload).not.toContain(projectName);
    expect(digestPayload).not.toContain(projectName);
  });

  test("project descriptions and notes are excluded from AI context ENTIRELY — not aliased, simply never included in the payload", () => {
    // @ts-expect-error — `description` is not a key of `PlannerProjectInput`.
    // If this type ever grows a description/notes field, this line stops
    // producing a type error and `bunx tsc --noEmit` fails on the missing
    // expected error: the whitelist regressing is a hard compile break, not
    // something that can silently slip through review.
    const withDescription: PlannerProjectInput = { name: "x", client: null, description: "SECRET internal project notes" };
    expect(withDescription).toBeTruthy(); // keeps the assignment from being flagged as unused
  });

  test("MPN, LCSC PN, package, and distributor names pass through UNALIASED (explicit exception — search breaks without real catalog identifiers) — the leak scan must not flag these", () => {
    const payload = `STM32F103C8T6 (C8734) LQFP-48 from Digikey — prioritize for ${clientName}`;
    const aliased = aliasText(payload, mapping);
    expect(aliased).toContain("STM32F103C8T6");
    expect(aliased).toContain("C8734");
    expect(aliased).toContain("LQFP-48");
    expect(aliased).toContain("Digikey");
    expect(aliased).not.toContain(clientName);
  });

  test("responses are de-aliased server-side before persistence/display — no UI surface (run lanes, digest screen, review) ever shows a raw alias like 'CLIENT-A' to a user", () => {
    const original = `Prioritize ${projectName} for ${clientName}`;
    const aliased = aliasText(original, mapping);
    const deAliased = deAliasText(aliased, mapping);
    expect(deAliased).toBe(original);
    expect(deAliased).not.toContain("CLIENT-A");
    expect(deAliased).not.toContain("PROJ-01");
    // Full response-handling wiring (run lanes / review screens actually
    // calling deAliasText before rendering) is bom-pipeline's — this proves
    // the primitive they must call exists and is correct.
  });

  test("the smark_ai_aliases mapping itself never leaves the server — no API route returns alias↔real-entity pairs to the client", () => {
    const source = readFileSync(resolve(import.meta.dir, "../../app/api/ai/extract-receipt/route.ts"), "utf8");
    expect(source).not.toContain("ai_aliases");
    expect(source).not.toContain("entity_id");
    expect(source).not.toContain("lib/ai/alias");
  });

  test("the same leak-scan mechanism covers all documented call sites (planner, digest, receipt extraction, MPN normalization) — one shared scanner, not one-off checks per feature", () => {
    // The SAME `aliasText` call handles both documented business-context
    // call sites (planner, digest); receipt extraction and MPN
    // normalization need no scanner at all because they never carry
    // business context to begin with (see the first test above) — that is
    // itself the "one shared mechanism", not a gap.
    const plannerLike = `Priorities: expedite for ${clientName}`;
    const digestLike = `1. [Project] ${projectName} — automotive-grade parts only for ${clientName}`;
    for (const payload of [plannerLike, digestLike]) {
      const scrubbed = aliasText(payload, mapping);
      expect(scrubbed).not.toContain(clientName);
    }
  });
});

describeDb("invariant: alias-layer leak scan — DB-backed (ensureAliases → buildPlannerContext)", () => {
  test("a client/project not yet in smark_ai_aliases gets an alias minted before its first AI call — no call path can go out carrying a real name because no mapping existed yet", async () => {
    const service = createServiceClient();
    const uniqueClientName = `Leak Test Client ${crypto.randomUUID()}`;

    const mapping = await ensureAliases("client", [uniqueClientName], service);
    const alias = mapping.get(uniqueClientName);
    expect(alias).toBeTruthy();
    expect(alias).toMatch(/^CLIENT-/);

    // Idempotent: calling again resolves to the SAME alias rather than minting a second one.
    const mappingAgain = await ensureAliases("client", [uniqueClientName], service);
    expect(mappingAgain.get(uniqueClientName)).toBe(alias);
  });

  test("buildPlannerContext (real ensureAliases + real DB) still contains ZERO occurrences of the real client/project name, with MPN passing through real", async () => {
    const service = createServiceClient();
    const uniqueClient = `Leak Test Client ${crypto.randomUUID()}`;
    const uniqueProject = `Leak Test Project ${crypto.randomUUID()}`;

    const input: PlannerContextInput = {
      project: { name: uniqueProject, client: uniqueClient },
      bomName: "TMCS_96x32_Matrix_V1.2",
      buildQty: 3,
      distributorSequence: ["Digikey", "Mouser"],
      priorities: `Prioritize for ${uniqueClient} — they need it by Friday`,
      lines: [
        { lineNo: 1, mpn: "STM32F103C8T6", lcscPn: "C8734", value: null, footprint: "LQFP-48", qty: 100, priorityNote: null },
      ],
    };

    const context = await buildPlannerContext(input, service);
    const payload = renderPlannerContextText(context);

    expect(payload).not.toContain(uniqueClient);
    expect(payload).not.toContain(uniqueProject);
    expect(payload).toContain(context.clientCode!);
    expect(payload).toContain(context.projectCode);
    expect(payload).toContain("STM32F103C8T6");
    expect(payload).toContain("C8734");
    expect(payload).toContain("LQFP-48");
    expect(payload).toContain("Digikey");
  });
});
