import { expect, test } from "bun:test";
import { ensureAliases } from "@/lib/ai";
import { getRunConsoleData, getRunSnapshot } from "@/lib/runs/queries";
import { TABLES } from "@/types/db";
import { createServiceClient, describeWithDb } from "../helpers/supabase";

/**
 * tests/integration/bom-pipeline-run-dealias.test.ts — regression for this
 * package's report finding #1: `lib/runs/queries.ts` computed real read
 * models (master narration, skip reasons, per-result "why") straight from
 * `smark_agent_runs.plan`/`smark_agent_results.raw` WITHOUT ever calling
 * `deAliasText` — so in live mode (a real `ANTHROPIC_API_KEY`), where those
 * strings are model-authored text generated FROM aliased context
 * (`config.aliasedProjectLabel` = "PROJ-03 (CLIENT-A)", the aliased
 * `rulesDigest`/`overallPriorities`), an echoed alias code would surface raw
 * on the run console / SSE snapshot / order review — exactly what the
 * alias-leak invariant (tests/invariants/alias-leak.test.ts) says never
 * happens.
 *
 * This is "live-mode-shaped": it seeds `raw.why` / `masterPlan.narration` /
 * `masterPlan.skip[].reason` with a real alias code (as a live Sonnet/Opus
 * call would echo it back) WITHOUT going through the worker or a real Claude
 * call at all, then asserts `getRunConsoleData`/`getRunSnapshot` render the
 * REAL project/client name, never the code — proving the de-aliasing this
 * package's report demanded is actually wired into the query layer, not just
 * defined and re-exported.
 */
describeWithDb("bom-pipeline — run console/SSE de-aliasing regression (report finding #1)", () => {
  test("master narration, skip reasons, and result 'why' are de-aliased before they leave getRunConsoleData/getRunSnapshot", async () => {
    const service = createServiceClient();
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    const email = `dealias-${suffix}@smark.internal`;
    const { data: authUser, error: authError } = await service.auth.admin.createUser({
      email,
      password: "Dealias-Test-Pass-1!",
      email_confirm: true,
    });
    if (authError || !authUser.user) throw new Error(`could not create test actor: ${authError?.message}`);
    const actorId = authUser.user.id;

    const { error: profileError } = await service
      .from("smark_app_users")
      .insert({ id: actorId, username: `dealias_${suffix}`, display_name: "De-alias Test Actor", role: "owner", active: true });
    if (profileError) throw new Error(`could not seed smark_app_users: ${profileError.message}`);

    const clientName = `Dealias Client ${suffix}`;
    const projectName = `Dealias Project ${suffix}`;

    const { data: project, error: projectError } = await service
      .from(TABLES.projects)
      .insert({ name: projectName, client: clientName })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`could not seed project: ${projectError?.message}`);

    const { data: bom, error: bomError } = await service
      .from(TABLES.boms)
      .insert({ project_id: project.id, name: `Dealias BOM ${suffix}`, build_qty: 1 })
      .select("id")
      .single();
    if (bomError || !bom) throw new Error(`could not seed BOM: ${bomError?.message}`);

    const { data: sourcedLine, error: sourcedLineError } = await service
      .from(TABLES.bom_lines)
      .insert({ bom_id: bom.id, line_no: 1, mpn: `DEALIAS-${suffix}`, value: "10K", footprint: "R0603", qty: 10, match_state: "to_order" })
      .select("id")
      .single();
    if (sourcedLineError || !sourcedLine) throw new Error(`could not seed sourced line: ${sourcedLineError?.message}`);

    const { data: skippedLine, error: skippedLineError } = await service
      .from(TABLES.bom_lines)
      .insert({ bom_id: bom.id, line_no: 2, mpn: `DEALIAS2-${suffix}`, value: "1uF", footprint: "C0603", qty: 5, match_state: "to_order" })
      .select("id")
      .single();
    if (skippedLineError || !skippedLine) throw new Error(`could not seed skipped line: ${skippedLineError?.message}`);

    // The SAME alias codes `buildGlobalAliasMapping` would mint for this
    // project/client — mirrors what `lib/runs/enqueue.ts` stamps into
    // `config.aliasedProjectLabel` and the aliased digest/priorities at
    // enqueue time, and what a live Claude call would then be able to echo
    // straight back in its own generated text.
    const clientMapping = await ensureAliases("client", [clientName], service);
    const projectMapping = await ensureAliases("project", [projectName], service);
    const clientCode = clientMapping.get(clientName)!;
    const projectCode = projectMapping.get(projectName)!;
    expect(clientCode).toMatch(/^CLIENT-/);
    expect(projectCode).toMatch(/^PROJ-/);

    const { data: digikey, error: digikeyError } = await service.from(TABLES.distributors).select("id").eq("name", "Digikey").single();
    if (digikeyError || !digikey) throw new Error(`could not read seeded Digikey distributor: ${digikeyError?.message}`);

    const runId = crypto.randomUUID();
    const narration = `Plan drafted for ${projectCode} (${clientCode}) — prioritizing exact MPN matches.`;
    const skipReason = `Already fully stocked for ${clientCode} — no search dispatched.`;
    const resultWhy = `Recommended — ${clientCode} usually prefers Digikey for this part per the active rules digest.`;

    const { error: runInsertError } = await service.from(TABLES.agent_runs).insert({
      id: runId,
      bom_id: bom.id,
      status: "review",
      concurrency_preset: "balanced",
      fanout_width: 3,
      depth_per_item: 3,
      per_site_cap: 2,
      est_cost: 1,
      actual_cost: 1,
      plan: {
        config: null,
        masterPlan: {
          narration,
          searches: [],
          skip: [{ bomLineId: skippedLine.id, reason: skipReason, ruleHit: null }],
        },
        appMeta: { buildQtyAtRun: 1 },
      },
      rules_doc_version: null,
      started_by: actorId,
    });
    if (runInsertError) throw new Error(`could not seed run: ${runInsertError.message}`);

    const { error: jobsError } = await service.from(TABLES.order_jobs).insert([
      { run_id: runId, bom_line_id: sourcedLine.id, plan: null, status: "done" },
      { run_id: runId, bom_line_id: skippedLine.id, plan: null, status: "done" },
    ]);
    if (jobsError) throw new Error(`could not seed order jobs: ${jobsError.message}`);

    const { error: resultError } = await service.from(TABLES.agent_results).insert({
      run_id: runId,
      bom_line_id: sourcedLine.id,
      distributor_id: digikey.id,
      price: 1.5,
      stock_qty: 100,
      mpn_match: "exact",
      package_match: true,
      part_status: "active",
      order_link: null,
      is_recommended: true,
      confidence: 92,
      selected: false,
      raw: { why: resultWhy },
    });
    if (resultError) throw new Error(`could not seed agent result: ${resultError.message}`);

    try {
      const console_ = await getRunConsoleData(service, service, runId);
      expect(console_).not.toBeNull();
      if (!console_) return;

      // Master narration — de-aliased (report finding #1: `toRunHeader`).
      expect(console_.run.narration).toContain(projectName);
      expect(console_.run.narration).toContain(clientName);
      expect(console_.run.narration ?? "").not.toContain(projectCode);
      expect(console_.run.narration ?? "").not.toContain(clientCode);

      const sourcedLane = console_.sourcingLanes.find((l) => l.bomLineId === sourcedLine.id);
      expect(sourcedLane).toBeTruthy();
      const resultRow = sourcedLane?.rows.find((r) => r.distributorId === digikey.id);
      expect(resultRow?.why).toContain(clientName);
      expect(resultRow?.why ?? "").not.toContain(clientCode);

      const skippedLane = console_.sourcingLanes.find((l) => l.bomLineId === skippedLine.id);
      expect(skippedLane?.aiSkipReason).toContain(clientName);
      expect(skippedLane?.aiSkipReason ?? "").not.toContain(clientCode);

      // Same requirement holds for the SSE snapshot (report finding #1: `getRunSnapshot`).
      const snapshot = await getRunSnapshot(service, runId);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.narration).toContain(projectName);
      expect(snapshot?.narration ?? "").not.toContain(projectCode);
      const snapshotResultRow = snapshot?.sourcingLanes
        .find((l) => l.bomLineId === sourcedLine.id)
        ?.rows.find((r) => r.distributorId === digikey.id);
      expect(snapshotResultRow?.why).toContain(clientName);
      expect(snapshotResultRow?.why ?? "").not.toContain(clientCode);
    } finally {
      await service.from(TABLES.agent_results).delete().eq("run_id", runId);
      await service.from(TABLES.order_jobs).delete().eq("run_id", runId);
      await service.from(TABLES.agent_runs).delete().eq("id", runId);
      await service.from(TABLES.bom_lines).delete().eq("bom_id", bom.id);
      await service.from(TABLES.boms).delete().eq("id", bom.id);
      await service.from(TABLES.projects).delete().eq("id", project.id);
      await service.from("smark_app_users").delete().eq("id", actorId);
      await service.auth.admin.deleteUser(actorId);
    }
  });
});
