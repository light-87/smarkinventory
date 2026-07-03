/**
 * lib/ai/types.ts — shared shapes for the AI Memory surface
 * (plan/tab-ai-memory.md). Package-local VIEW shapes, not DB row contracts
 * (those live in types/db.ts, integrator-owned).
 */

import type { LearnedRuleRow } from "@/types/db";

/** Result envelope shared by every mutating Server Action (mirrors lib/expenses/types.ts). */
export type ActionResult<T extends Record<string, unknown> = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

/** A rule row with its single plain-English line already resolved (see lib/ai/digest.ts's `value.text` convention). */
export interface RuleListItem extends LearnedRuleRow {
  ruleText: string;
}

export type SuggestedRuleItem = RuleListItem;
export type ActiveRuleItem = RuleListItem;

export interface RulesDigestSummary {
  /** 0 when no digest has ever been written yet (screen shows "Rules v0"). */
  version: number;
  /** Latest `change_summary` line, e.g. "v3 → v4: +1 rule (...)" — null before the first approve/retire. */
  latestDiff: string | null;
}

/** One row of the run-log section — "which rule hit which line" (plan/tab-ai-memory.md §4). Best-effort from feedback provenance until bom-pipeline/worker start writing per-line rule citations onto `smark_agent_results` (see lib/ai/queries.ts doc comment). */
export interface RuleRunLogItem {
  ruleId: string;
  ruleText: string;
  runId: string;
  /** Null for a whole-order remark (no single BOM line). */
  bomLineId: string | null;
  lineDescriptor: string | null;
  occurredAt: string;
}

export interface AiMemoryScreenData {
  digest: RulesDigestSummary;
  suggested: SuggestedRuleItem[];
  active: ActiveRuleItem[];
  runLog: RuleRunLogItem[];
}
