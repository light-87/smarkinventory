import { expect, test } from "bun:test";
import { approveRule } from "@/lib/ai";
import { enqueueRun } from "@/lib/runs/enqueue";
import { TABLES } from "@/types/db";
import type { WorkerRunConfig } from "@/types/worker";
import { createServiceClient, describeWithDb } from "../helpers/supabase";

/**
 * tests/integration/bom-pipeline-enqueue-alias-leak.test.ts — regression for
 * this package's report findings #1/#3: `lib/runs/enqueue.ts`'s
 * `buildAliasedRunContext` used to alias the GLOBAL rules digest against
 * only the CURRENT run's own project/client mapping
 * (`ensureAliases('project', [ctx.project.name])` + the run's own client).
 *
 * But `getDigestForInjection` returns `smark_learned_rules_doc.content`,
 * built from ALL active rules across EVERY project, in REAL names
 * (lib/ai/digest.ts `buildDigestContent`) — a whole-order rule stores
 * `subject = <that OTHER run's project's real name>` (lib/runs/feedback.ts
 * `submitOrderRemark`), and every rule's free-text `value.text` may name any
 * client verbatim. Aliasing that global digest with only the current run's
 * narrow mapping left every OTHER project/client name un-aliased, shipping
 * it verbatim into `config.rulesDigest` — which the worker injects straight
 * into the Opus master prompt AND every Sonnet item prompt (FEATURES §12
 * hard rule: "every Claude-bound payload passes the alias layer").
 *
 * Repro: approve an active rule naming "Project A" directly, then enqueue a
 * run for an unrelated "Project B" — assert the enqueued run's stored
 * `config.rulesDigest` contains ZERO occurrences of Project A's real name.
 */
describeWithDb("bom-pipeline — enqueue alias-leak regression (R2-17 / FEATURES §12)", () => {
  test("a run enqueued for Project B never leaks Project A's real name from the global rules digest", async () => {
    const service = createServiceClient();
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    // Throwaway actor — FK target for smark_agent_runs.started_by / smark_learned_rules.created_by.
    const email = `aliasleak-${suffix}@smark.internal`;
    const { data: authUser, error: authError } = await service.auth.admin.createUser({
      email,
      password: "AliasLeak-Test-Pass-1!",
      email_confirm: true,
    });
    if (authError || !authUser.user) throw new Error(`could not create test actor: ${authError?.message}`);
    const actorId = authUser.user.id;

    const { error: profileError } = await service
      .from("smark_app_users")
      .insert({ id: actorId, username: `aliasleak_${suffix}`, display_name: "Alias Leak Test Actor", role: "owner", active: true });
    if (profileError) throw new Error(`could not seed smark_app_users: ${profileError.message}`);

    const projectAName = `Alias Leak Project A ${suffix}`;
    const projectBName = `Alias Leak Project B ${suffix}`;

    const { data: projectA, error: projectAError } = await service
      .from(TABLES.projects)
      .insert({ name: projectAName })
      .select("id")
      .single();
    if (projectAError || !projectA) throw new Error(`could not seed Project A: ${projectAError?.message}`);

    const { data: projectB, error: projectBError } = await service
      .from(TABLES.projects)
      .insert({ name: projectBName, client: `Alias Leak Client B ${suffix}` })
      .select("id")
      .single();
    if (projectBError || !projectB) throw new Error(`could not seed Project B: ${projectBError?.message}`);

    // Free-text priorities naming Project A DIRECTLY — the exact shape report
    // finding #2 flags: a priorities field on an UNRELATED BOM (this one's own
    // project is B) that names some OTHER in-system project verbatim (e.g.
    // "expedite like the Power Breezer order").
    const { data: bom, error: bomError } = await service
      .from(TABLES.boms)
      .insert({ project_id: projectB.id, name: `Alias leak BOM ${suffix}`, build_qty: 1, priority_notes: `Expedite like the ${projectAName} order.` })
      .select("id")
      .single();
    if (bomError || !bom) throw new Error(`could not seed BOM: ${bomError?.message}`);

    const { error: lineError } = await service.from(TABLES.bom_lines).insert({
      bom_id: bom.id,
      line_no: 1,
      mpn: `ALIASLEAK-${suffix}`,
      value: "10K",
      footprint: "R0603",
      qty: 10,
      match_state: "to_order",
      priority_note: `Same distributor as ${projectAName} used.`,
    });
    if (lineError) throw new Error(`could not seed BOM line: ${lineError.message}`);

    // A whole-order rule naming Project A DIRECTLY — mirrors
    // lib/runs/feedback.ts submitOrderRemark's real shape (subject = the run's
    // OWN project's real name; free text may also mention it).
    const { data: rule, error: ruleError } = await service
      .from(TABLES.learned_rules)
      .insert({
        scope: "project",
        subject: projectAName,
        rule_type: "prefer_distributor",
        value: { text: `Always expedite ${projectAName} orders via Digikey.` },
        status: "suggested",
        created_by: actorId,
      })
      .select("id")
      .single();
    if (ruleError || !rule) throw new Error(`could not seed the rule: ${ruleError?.message}`);

    // suggested → active, bumping smark_learned_rules_doc so the digest
    // Project B's run reads back INCLUDES this Project-A-naming line.
    await approveRule(service, rule.id, actorId);

    try {
      const result = await enqueueRun(service, service, { bomId: bom.id, tier: "balanced", actorId });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: run, error: runError } = await service
        .from(TABLES.agent_runs)
        .select("plan")
        .eq("id", result.runId)
        .single();
      if (runError || !run) throw new Error(`could not read back the enqueued run: ${runError?.message}`);

      const config = (run.plan as { config?: WorkerRunConfig } | null)?.config;
      expect(config).toBeTruthy();
      // The regression: the un-fixed code only aliased against Project B's
      // own name, so Project A's name (this rule's subject AND its
      // value.text) sailed through into config.rulesDigest untouched.
      expect(config?.rulesDigest ?? "").not.toContain(projectAName);
      // Sanity — the digest DID pick up this rule (just aliased), proving
      // the assertion above isn't vacuously true because the rule never
      // made it into the injected digest at all.
      expect(config?.rulesDigest ?? "").toContain("Digikey");

      // Report finding #2's own regression: `buildPlannerContext` used to
      // alias free-text priorities/per-line notes against ONLY the current
      // run's own project/client — Project A's name here (mentioned in BOTH
      // the BOM's priorities AND this line's own note) used to sail through
      // un-aliased into `config.overallPriorities`/`config.lines[].priorityNote`.
      expect(config?.overallPriorities ?? "").not.toContain(projectAName);
      expect(config?.overallPriorities ?? "").toContain("Expedite");
      const line = config?.lines.find((l) => l.mpn === `ALIASLEAK-${suffix}`);
      expect(line?.priorityNote ?? "").not.toContain(projectAName);
      expect(line?.priorityNote ?? "").toContain("Same distributor");

      await service.from(TABLES.order_jobs).delete().eq("run_id", result.runId);
      await service.from(TABLES.agent_runs).delete().eq("id", result.runId);
    } finally {
      await service.from(TABLES.learned_rules).delete().eq("id", rule.id);
      await service.from(TABLES.bom_lines).delete().eq("bom_id", bom.id);
      await service.from(TABLES.boms).delete().eq("id", bom.id);
      await service.from(TABLES.projects).delete().eq("id", projectB.id);
      await service.from(TABLES.projects).delete().eq("id", projectA.id);
      await service.from("smark_app_users").delete().eq("id", actorId);
      await service.auth.admin.deleteUser(actorId);
    }
  });
});
