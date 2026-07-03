/**
 * lib/ai/queries.ts — server-only data fetching for the AI Memory screen
 * (plan/tab-ai-memory.md). Every function takes an already-created request
 * Supabase client (lib/supabase/server.ts `createClient()`) so it runs
 * under the caller's session + RLS (owner-only on `smark_learned_rules*`,
 * per migration 0004) — never the service-role client.
 *
 * Style matches the sibling packages already landed (lib/expenses/queries.ts):
 * hand-joins via follow-up `.in()` queries instead of PostgREST embedded
 * selects (types/db.ts's `Database` generic carries no `Relationships`
 * metadata for supabase-js to type embeds against).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LearnedRuleRow } from "@/types/db";
import { TABLES } from "@/types/db";
import { buildDigestContent, renderRuleText } from "./digest";
import type { AiMemoryScreenData, RuleListItem, RuleRunLogItem, RulesDigestSummary } from "./types";

type DB = SupabaseClient<Database>;

function assertNoError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`[ai-memory] ${context}: ${error.message}`);
}

function toListItem(row: LearnedRuleRow): RuleListItem {
  return { ...row, ruleText: renderRuleText(row) };
}

export async function getSuggestedRules(supabase: DB): Promise<RuleListItem[]> {
  const { data, error } = await supabase
    .from(TABLES.learned_rules)
    .select("*")
    .eq("status", "suggested")
    .order("created_at", { ascending: true });
  assertNoError(error, "smark_learned_rules (suggested)");
  return ((data ?? []) as LearnedRuleRow[]).map(toListItem);
}

export async function getActiveRules(supabase: DB): Promise<RuleListItem[]> {
  const { data, error } = await supabase
    .from(TABLES.learned_rules)
    .select("*")
    .eq("status", "active")
    .order("scope", { ascending: true })
    .order("created_at", { ascending: true });
  assertNoError(error, "smark_learned_rules (active)");
  return ((data ?? []) as LearnedRuleRow[]).map(toListItem);
}

/** Header pill ("Rules v{N}") + latest diff line. `version: 0` / `latestDiff: null` before the first approve/retire ever happens. */
export async function getDigestSummary(supabase: DB): Promise<RulesDigestSummary> {
  const { data, error } = await supabase
    .from(TABLES.learned_rules_doc)
    .select("version, change_summary")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError(error, "smark_learned_rules_doc");
  return { version: data?.version ?? 0, latestDiff: data?.change_summary ?? null };
}

/**
 * Run-log section — "which rule hit which line" (plan/tab-ai-memory.md §4).
 * No `smark_agent_results` column yet records "which active rule this
 * recommendation cited" (that's a bom-pipeline/worker addition, not built
 * as of this package) — so today this is a best-effort proxy built from
 * rule PROVENANCE instead: every active/retired rule that originated from
 * feedback (`source_feedback_id`) is traced back to the run + BOM line that
 * feedback was left on. Real-time "this run's recommendation cited rule X"
 * citations should replace this once that column exists. Empty result is a
 * valid, expected state (plan/tab-ai-memory.md: "empty-state OK").
 */
export async function getRuleRunLog(supabase: DB): Promise<RuleRunLogItem[]> {
  const { data: rules, error: rulesError } = await supabase
    .from(TABLES.learned_rules)
    .select("id, rule_type, value, subject, source_feedback_id")
    .not("source_feedback_id", "is", null)
    .neq("status", "suggested");
  assertNoError(rulesError, "smark_learned_rules (provenance)");
  const ruleRows = (rules ?? []) as Array<Pick<LearnedRuleRow, "id" | "rule_type" | "value" | "subject" | "source_feedback_id">>;
  if (ruleRows.length === 0) return [];

  const feedbackIds = Array.from(new Set(ruleRows.map((r) => r.source_feedback_id).filter((v): v is string => v != null)));
  const { data: feedback, error: feedbackError } = await supabase
    .from(TABLES.agent_feedback)
    .select("id, run_id, result_id, created_at")
    .in("id", feedbackIds);
  assertNoError(feedbackError, "smark_agent_feedback (join)");
  const feedbackById = new Map((feedback ?? []).map((f) => [f.id as string, f]));

  const resultIds = Array.from(new Set((feedback ?? []).map((f) => f.result_id).filter((v): v is string => v != null)));
  const { data: results, error: resultsError } =
    resultIds.length > 0
      ? await supabase.from(TABLES.agent_results).select("id, bom_line_id").in("id", resultIds)
      : { data: [] as Array<{ id: string; bom_line_id: string }>, error: null };
  assertNoError(resultsError, "smark_agent_results (join)");
  const resultById = new Map((results ?? []).map((r) => [r.id as string, r]));

  const bomLineIds = Array.from(new Set((results ?? []).map((r) => r.bom_line_id).filter((v): v is string => v != null)));
  const { data: bomLines, error: bomLinesError } =
    bomLineIds.length > 0
      ? await supabase.from(TABLES.bom_lines).select("id, mpn, value, footprint").in("id", bomLineIds)
      : { data: [] as Array<{ id: string; mpn: string | null; value: string | null; footprint: string | null }>, error: null };
  assertNoError(bomLinesError, "smark_bom_lines (join)");
  const bomLineById = new Map((bomLines ?? []).map((l) => [l.id as string, l]));

  const items: RuleRunLogItem[] = [];
  for (const rule of ruleRows) {
    const fb = rule.source_feedback_id ? feedbackById.get(rule.source_feedback_id) : null;
    if (!fb) continue;
    const result = fb.result_id ? resultById.get(fb.result_id) : null;
    const line = result?.bom_line_id ? bomLineById.get(result.bom_line_id) : null;
    items.push({
      ruleId: rule.id,
      ruleText: renderRuleText(rule),
      runId: fb.run_id,
      bomLineId: result?.bom_line_id ?? null,
      lineDescriptor: line ? (line.mpn ?? ([line.value, line.footprint].filter(Boolean).join(" ") || null)) : null,
      occurredAt: fb.created_at,
    });
  }
  return items.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

/**
 * The full current digest (version + REAL-names content) — what
 * bom-pipeline's planner-prompt assembly should read, then alias via
 * `aliasDigestForInjection` right before it goes into a Claude request.
 * Falls back to an empty-rules digest (version 0) before the first
 * approve/retire ever happens, rather than requiring callers to
 * null-check.
 */
export async function getDigestForInjection(supabase: DB): Promise<{ version: number; content: string }> {
  const { data, error } = await supabase
    .from(TABLES.learned_rules_doc)
    .select("version, content")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError(error, "smark_learned_rules_doc (injection)");
  if (data) return { version: data.version, content: data.content };
  return { version: 0, content: buildDigestContent([]) };
}

/** Everything the `/ai-memory` page needs, fetched in parallel. */
export async function getAiMemoryScreenData(supabase: DB): Promise<AiMemoryScreenData> {
  const [digest, suggested, active, runLog] = await Promise.all([
    getDigestSummary(supabase),
    getSuggestedRules(supabase),
    getActiveRules(supabase),
    getRuleRunLog(supabase),
  ]);
  return { digest, suggested, active, runLog };
}
