import { expect, test } from "bun:test";
import { enqueueRun } from "@/lib/runs/enqueue";
import { TABLES } from "@/types/db";
import type { WorkerRunConfig } from "@/types/worker";
import { createServiceClient, describeWithDb } from "../helpers/supabase";

/**
 * tests/integration/ai-orc-sandbox-line-limit.test.ts — the /ai_orc sandbox's
 * `lineLimit` contract (lib/runs/enqueue.ts `EnqueueRunInput.lineLimit`):
 * a limited run must plan + queue ONLY the first N to-order lines by sheet
 * order — config.lines, the job rows, and appMeta.lineLimit all agree — so a
 * "test with 5 items" trial can never fan out over the whole BOM.
 */
describeWithDb("ai-orc sandbox — enqueue lineLimit", () => {
  test("a run enqueued with lineLimit 3 plans and queues exactly the first 3 lines by line_no", async () => {
    const service = createServiceClient();
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    const email = `linelimit-${suffix}@smark.internal`;
    const { data: authUser, error: authError } = await service.auth.admin.createUser({
      email,
      password: "LineLimit-Test-Pass-1!",
      email_confirm: true,
    });
    if (authError || !authUser.user) throw new Error(`could not create test actor: ${authError?.message}`);
    const actorId = authUser.user.id;

    const { error: profileError } = await service
      .from("smark_app_users")
      .insert({ id: actorId, username: `linelimit_${suffix}`, display_name: "Line Limit Test Actor", role: "owner", active: true });
    if (profileError) throw new Error(`could not seed smark_app_users: ${profileError.message}`);

    const { data: project, error: projectError } = await service
      .from(TABLES.projects)
      .insert({ name: `Line Limit Project ${suffix}` })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`could not seed project: ${projectError?.message}`);

    const { data: bom, error: bomError } = await service
      .from(TABLES.boms)
      .insert({ project_id: project.id, name: `Line limit BOM ${suffix}`, build_qty: 1 })
      .select("id")
      .single();
    if (bomError || !bom) throw new Error(`could not seed BOM: ${bomError?.message}`);

    // 6 to-order lines, inserted OUT of sheet order — the limit must pick by line_no, not insert order.
    const lineNos = [4, 1, 6, 3, 5, 2];
    const { error: linesError } = await service.from(TABLES.bom_lines).insert(
      lineNos.map((n) => ({
        bom_id: bom.id,
        line_no: n,
        mpn: `LINELIMIT-${suffix}-${n}`,
        value: "10K",
        footprint: "R0603",
        qty: 5,
        match_state: "to_order" as const,
      })),
    );
    if (linesError) throw new Error(`could not seed BOM lines: ${linesError.message}`);

    let runId: string | null = null;
    try {
      const result = await enqueueRun(service, service, { bomId: bom.id, tier: "economy", actorId, lineLimit: 3 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      runId = result.runId;

      const { data: run, error: runError } = await service
        .from(TABLES.agent_runs)
        .select("plan")
        .eq("id", result.runId)
        .single();
      if (runError || !run) throw new Error(`could not read back the run: ${runError?.message}`);

      const envelope = run.plan as { config?: WorkerRunConfig; appMeta?: { lineLimit?: number | null } } | null;
      const config = envelope?.config;
      expect(config?.lines.length).toBe(3);
      expect(config?.lines.map((l) => l.lineNo).sort()).toEqual([1, 2, 3]);
      expect(envelope?.appMeta?.lineLimit).toBe(3);

      const { data: jobs, error: jobsError } = await service
        .from(TABLES.order_jobs)
        .select("bom_line_id")
        .eq("run_id", result.runId);
      if (jobsError) throw new Error(`could not read back jobs: ${jobsError.message}`);
      expect(jobs?.length).toBe(3);
    } finally {
      if (runId) {
        await service.from(TABLES.order_jobs).delete().eq("run_id", runId);
        await service.from(TABLES.agent_runs).delete().eq("id", runId);
      }
      await service.from(TABLES.bom_lines).delete().eq("bom_id", bom.id);
      await service.from(TABLES.boms).delete().eq("id", bom.id);
      await service.from(TABLES.projects).delete().eq("id", project.id);
      await service.from("smark_app_users").delete().eq("id", actorId);
      await service.auth.admin.deleteUser(actorId);
    }
  });
});
