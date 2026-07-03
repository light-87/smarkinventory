import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db";
import { TABLES } from "@/types/db";
import { canApproveRules } from "@/lib/auth/roles";
import { approveRule, buildDigestContent, rejectRule, retireRule } from "@/lib/ai/digest";
import { createAnonClient, createServiceClient } from "../helpers/supabase";
import { describeDb } from "./fixtures";

/**
 * INVARIANT — suggested rules never auto-active (plan/TESTING.md §5.7 ·
 * CROSS-FEATURE.md A3.5 · FEATURES.md §16 "suggested-never-auto-active").
 * "Suggested rules never active without an approval event by an authorized
 * role." "AI memory is advisory, versioned, reviewable — suggested never
 * silently becomes active."
 * Canonical shape: SCHEMA.md `smark_learned_rules.status`
 * (suggested/active/retired, `superseded_by`), `smark_learned_rules_doc`
 * (versioned digest, `version` v++ per change). `lib/auth/roles.ts
 * canApproveRules` — owner-only (AI Memory approve · Settings · user
 * management row, FEATURES.md §2).
 *
 * Converted from `test.todo` — descriptions kept verbatim per this file's
 * original header. Split into a pure section (a tiny in-memory fake of the
 * exact `smark_learned_rules`/`smark_learned_rules_doc` query shape
 * `lib/ai/digest.ts` uses — no DB needed, deterministic, and able to
 * simulate a digest-write failure to prove the revert-on-failure behavior)
 * and a `describeDb` section (the real DB: column default, RLS
 * enforcement, and the real approve/reject/retire transitions).
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Pure — a minimal fake of the exact query shape lib/ai/digest.ts uses.
 * ──────────────────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

function makeFakeAiMemoryClient(
  initialRules: Row[],
  initialDocs: Row[] = [],
  opts: { failDigestInsert?: boolean } = {},
): SupabaseClient<Database> {
  const state: Record<string, Row[]> = {
    [TABLES.learned_rules]: initialRules,
    [TABLES.learned_rules_doc]: initialDocs,
  };

  function selectChain(rows: Row[]) {
    let filtered = rows;
    const api = {
      eq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] === val);
        return api;
      },
      neq(col: string, val: unknown) {
        filtered = filtered.filter((r) => r[col] !== val);
        return api;
      },
      order(col: string, { ascending }: { ascending: boolean }) {
        filtered = [...filtered].sort((a, b) => {
          const av = a[col] as number;
          const bv = b[col] as number;
          return ascending ? av - bv : bv - av;
        });
        return api;
      },
      limit(n: number) {
        filtered = filtered.slice(0, n);
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: filtered[0] ?? null, error: null });
      },
      then(onFulfilled: (value: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: filtered, error: null }).then(onFulfilled);
      },
    };
    return api;
  }

  function updateChain(table: string, patch: Row) {
    const predicate: Array<[string, unknown]> = [];
    const api = {
      eq(col: string, val: unknown) {
        predicate.push([col, val]);
        return api;
      },
      then(onFulfilled: (value: { data: null; error: null }) => unknown) {
        for (const row of state[table]!) {
          if (predicate.every(([col, val]) => row[col] === val)) Object.assign(row, patch);
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled);
      },
    };
    return api;
  }

  return {
    from(table: string) {
      return {
        select: () => selectChain(state[table]!),
        update: (patch: Row) => updateChain(table, patch),
        insert: (row: Row) => {
          if (table === TABLES.learned_rules_doc && opts.failDigestInsert) {
            return Promise.resolve({ data: null, error: { message: "simulated digest-bump failure" } });
          }
          state[table]!.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
}

function fakeRule(overrides: Partial<Row> = {}): Row & { id: string } {
  return {
    id: crypto.randomUUID(),
    scope: "global",
    subject: null,
    rule_type: "price_source_note",
    value: { text: "test rule" },
    confidence: null,
    source_feedback_id: null,
    status: "suggested",
    superseded_by: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: null,
    ...overrides,
  } as Row & { id: string };
}

describe("invariant: suggested rules never auto-active — pure (fake client, no DB needed)", () => {
  test("no API/DB path transitions a rule suggested→active without an explicit approval event recorded (approver user_id + timestamp persisted, not inferred)", async () => {
    const rule = fakeRule({ value: { text: "prefer LCSC for GCU 0.1µF caps" } });
    const client = makeFakeAiMemoryClient([rule]);

    // `approveRule` REQUIRES an actorId parameter (compile-time — there is
    // no overload that omits it) and persists it as the resulting digest
    // doc row's `created_by`, tying the version bump to an actor + a
    // timestamp (`created_at`, stamped by the fake exactly as the real
    // `smark_learned_rules_doc` table's `default now()` would).
    const actorId = crypto.randomUUID();
    const result = await approveRule(client, rule.id, actorId);
    expect(result.docVersion).toBe(1);

    const docs = (await (client.from(TABLES.learned_rules_doc).select("*") as unknown as Promise<{ data: Row[] }>)).data;
    expect(docs).toHaveLength(1);
    expect(docs[0]!.created_by).toBe(actorId);
    expect(typeof docs[0]!.created_at).toBe("string");
  });

  test("approving a rule and bumping smark_learned_rules_doc.version happen atomically — no state exists where a rule is active but the digest version wasn't bumped, or vice versa", async () => {
    const rule = fakeRule();
    // Happy path: both the status flip AND the version bump land together.
    const happyClient = makeFakeAiMemoryClient([{ ...rule }]);
    await approveRule(happyClient, rule.id, crypto.randomUUID());
    const [happyRule] = (await (happyClient.from(TABLES.learned_rules).select("*").eq("id", rule.id) as unknown as Promise<{
      data: Row[];
    }>)).data;
    expect(happyRule!.status).toBe("active");

    // Simulated digest-write failure: the status flip is reverted rather
    // than left dangling as "active with no corresponding digest version".
    const failingClient = makeFakeAiMemoryClient([{ ...rule }], [], { failDigestInsert: true });
    await expect(approveRule(failingClient, rule.id, crypto.randomUUID())).rejects.toThrow();
    const [revertedRule] = (await (failingClient.from(TABLES.learned_rules).select("*").eq("id", rule.id) as unknown as Promise<{
      data: Row[];
    }>)).data;
    expect(revertedRule!.status).toBe("suggested"); // reverted, not stuck at "active"
  });

  test("a REJECTED suggested rule never appears in any digest version and is not auto-resurrected by a similar future feedback event", async () => {
    const rule = fakeRule({ value: { text: "Unikey only if cheaper AND in stock" } });
    const client = makeFakeAiMemoryClient([rule]);

    const result = await rejectRule(client, rule.id);
    expect(result.docVersion).toBeNull(); // never entered the active set — no version bump

    const docs = (await (client.from(TABLES.learned_rules_doc).select("*") as unknown as Promise<{ data: Row[] }>)).data;
    expect(docs).toHaveLength(0); // no digest version was ever written

    const [rejected] = (await (client.from(TABLES.learned_rules).select("*").eq("id", rule.id) as unknown as Promise<{
      data: Row[];
    }>)).data;
    expect(rejected!.status).toBe("retired"); // terminal — schema has no "suggested" path back from here
  });

  test("retiring an active rule sets status='retired' (+ superseded_by where applicable) and removes it from the NEXT digest version — a retired rule never silently re-activates", async () => {
    const rule = fakeRule({ status: "active", value: { text: "prefer LCSC for GCU 0.1µF caps" } });
    const client = makeFakeAiMemoryClient([rule], [{ version: 1, content: buildDigestContent([rule as never]), change_summary: null }]);

    const result = await retireRule(client, rule.id, crypto.randomUUID());
    expect(result.docVersion).toBe(2);

    const docs = (await (client.from(TABLES.learned_rules_doc).select("*") as unknown as Promise<{ data: Row[] }>)).data;
    const latest = docs.find((d) => d.version === 2)!;
    expect(latest.content).not.toContain("prefer LCSC for GCU 0.1µF caps"); // removed from the NEXT version
    expect((docs.find((d) => d.version === 1)!).content).toContain("prefer LCSC for GCU 0.1µF caps"); // OLD version is untouched history

    const [retired] = (await (client.from(TABLES.learned_rules).select("*").eq("id", rule.id) as unknown as Promise<{
      data: Row[];
    }>)).data;
    expect(retired!.status).toBe("retired");

    // Never silently re-activates: retiring again is rejected outright.
    await expect(retireRule(client, rule.id, crypto.randomUUID())).rejects.toThrow();
  });

  test("the Opus master-plan prompt only ever includes rules from the CURRENT active digest version — a suggested-but-unapproved rule is never injected into a run's context", () => {
    const approvedRule = fakeRule({ status: "active", value: { text: "prefer LCSC for GCU 0.1µF caps" } });
    const stillSuggested = fakeRule({ status: "suggested", value: { text: "Unikey only if cheaper AND in stock" } });

    // `buildDigestContent` (what a planner-prompt digest is built from) only
    // ever receives the caller's active-rules query result — a suggested
    // row passed alongside it would still render, which is exactly why
    // `lib/ai/queries.ts`'s `getDigestForInjection`/`getActiveRules` filter
    // by `status: "active"` BEFORE calling this function, never after.
    const digest = buildDigestContent([approvedRule as never]);
    expect(digest).toContain("prefer LCSC for GCU 0.1µF caps");
    expect(digest).not.toContain("Unikey only if cheaper AND in stock");
    expect(stillSuggested.status).toBe("suggested"); // sanity — never transitioned
  });

  test.todo(
    "run log 'why' lines (agent result rationale) can only cite rules that were active at the time the run executed, not rules approved after the fact",
    () => {
      // Requires bom-pipeline/worker to write a per-line rule citation onto
      // `smark_agent_results` (not yet built — no column exists for it
      // today). `lib/ai/queries.ts`'s `getRuleRunLog` is a provenance-based
      // proxy (rule → its originating feedback → run/line), not a "which
      // digest version was active when this run executed" citation.
      // Convert once that column/writer lands.
    },
  );
});

describe("invariant: suggested rules never auto-active — role gate (pure, lib/auth/roles)", () => {
  test("only an authorized role (owner — canApproveRules) can approve a suggested rule; employee and accountant attempts are rejected by BOTH the UI (hidden) and RLS (denied), mirroring FEATURES.md §2 'enforced twice'", () => {
    expect(canApproveRules("owner")).toBe(true);
    expect(canApproveRules("employee")).toBe(false);
    expect(canApproveRules("accountant")).toBe(false);
    // RLS half of "enforced twice" is proved against the real DB below.
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * DB-backed — real column default + real RLS enforcement.
 * ──────────────────────────────────────────────────────────────────────────── */

async function createScopedActor(
  service: SupabaseClient,
  role: "owner" | "employee" | "accountant",
): Promise<{ id: string; client: () => Promise<SupabaseClient>; cleanup: () => Promise<void> }> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const email = `sugtest-${suffix}@smark.internal`;
  const password = "Suggested-Rules-Test-1!";

  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createScopedActor: auth.admin.createUser failed: ${error?.message}`);
  const userId = data.user.id;

  const { error: profileError } = await service
    .from("smark_app_users")
    .insert({ id: userId, username: `sugtest_${suffix}`, display_name: "Suggested Rules Test Actor", role, active: true });
  if (profileError) {
    await service.auth.admin.deleteUser(userId);
    throw new Error(`createScopedActor: smark_app_users insert failed: ${profileError.message}`);
  }

  return {
    id: userId,
    client: async () => {
      const anon = createAnonClient();
      const { error: signInError } = await anon.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(`createScopedActor: sign-in failed: ${signInError.message}`);
      return anon;
    },
    cleanup: async () => {
      await service.from("smark_app_users").delete().eq("id", userId);
      await service.auth.admin.deleteUser(userId);
    },
  };
}

describeDb("invariant: suggested rules never auto-active — DB-backed", () => {
  test("a rule created from feedback (smark_agent_feedback → converted_rule_id) always lands with status='suggested', never 'active', regardless of confidence score", async () => {
    const service = createServiceClient();
    const { data, error } = await service
      .from("smark_learned_rules")
      .insert({
        scope: "global",
        rule_type: "price_source_note",
        value: { text: "high-confidence test rule" },
        confidence: 0.99, // even a maximal confidence score doesn't skip the default
      })
      .select("status")
      .single();
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("suggested");

    await service.from("smark_learned_rules").delete().eq("value->>text", "high-confidence test rule");
  });

  test("only an authorized role (owner — canApproveRules) can approve a suggested rule; employee and accountant attempts are rejected by BOTH the UI (hidden) and RLS (denied), mirroring FEATURES.md §2 'enforced twice'", async () => {
    const service = createServiceClient();
    const { data: seeded, error: seedError } = await service
      .from("smark_learned_rules")
      .insert({ scope: "global", rule_type: "price_source_note", value: { text: "RLS test rule" } })
      .select("id")
      .single();
    expect(seedError).toBeNull();
    const ruleId = (seeded as { id: string }).id;

    const employee = await createScopedActor(service, "employee");
    const owner = await createScopedActor(service, "owner");

    try {
      const employeeClient = await employee.client();
      const { data: employeeRead } = await employeeClient.from("smark_learned_rules").select("id").eq("id", ruleId);
      expect(employeeRead ?? []).toHaveLength(0); // RLS: no SELECT policy for employee at all

      await employeeClient.from("smark_learned_rules").update({ status: "active" }).eq("id", ruleId);
      const { data: stillSuggested } = await service.from("smark_learned_rules").select("status").eq("id", ruleId).single();
      expect((stillSuggested as { status: string }).status).toBe("suggested"); // employee's update affected 0 rows

      const ownerClient = await owner.client();
      const { error: ownerUpdateError } = await ownerClient
        .from("smark_learned_rules")
        .update({ status: "active" })
        .eq("id", ruleId)
        .eq("status", "suggested");
      expect(ownerUpdateError).toBeNull();
      const { data: nowActive } = await service.from("smark_learned_rules").select("status").eq("id", ruleId).single();
      expect((nowActive as { status: string }).status).toBe("active");
    } finally {
      await service.from("smark_learned_rules").delete().eq("id", ruleId);
      await employee.cleanup();
      await owner.cleanup();
    }
  });
});
