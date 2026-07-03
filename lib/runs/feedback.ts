/**
 * lib/runs/feedback.ts — Order Review's feedback → suggested-rule pipeline
 * (plan/tab-order-review.md §2/§3, FEATURES.md §10 anti-drift): per-item
 * feedback → `smark_agent_feedback` (scope Part) · whole-order remark →
 * `smark_agent_feedback` (scope Project — `smark_learned_rules.scope` has no
 * literal "order" value; FEATURES' "scope Order" maps onto the closest real
 * enum member, the run's own project, which IS what "the whole order"
 * concretely means here). Both funnel into a new SUGGESTED
 * `smark_learned_rules` row — NEVER active (A3 invariant: suggested rules
 * never auto-activate; the owner approves from AI Memory).
 *
 * `smark_learned_rules`/`smark_learned_rules_doc` are OWNER-ONLY RLS
 * (migration 0004): "Suggested-rule creation from review feedback (A2-8) is
 * likewise a server-side (service-role) side effect of the
 * smark_agent_feedback insert, not a direct employee INSERT" — so an
 * employee's feedback still produces a suggested rule even though they
 * couldn't write `smark_learned_rules` directly themselves.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LearnedRuleScope } from "@/types/db";
import { TABLES } from "@/types/db";
import { notifyRulePending } from "@/lib/notifications";
import { getProjectHeader } from "@/lib/bom/queries";
import { classifyFeedbackRuleType } from "./rule-classify";

type DB = SupabaseClient<Database>;

export type FeedbackResult = { ok: true; ruleId: string } | { ok: false; error: string };

async function pickAnchorResultId(service: DB, runId: string, bomLineId: string): Promise<string | null> {
  const { data } = await service
    .from(TABLES.agent_results)
    .select("id, selected, is_recommended")
    .eq("run_id", runId)
    .eq("bom_line_id", bomLineId);
  const rows = data ?? [];
  const selected = rows.find((r) => r.selected);
  if (selected) return selected.id;
  const recommended = rows.find((r) => r.is_recommended);
  if (recommended) return recommended.id;
  return rows[0]?.id ?? null;
}

async function createSuggestedRule(
  service: DB,
  params: { scope: LearnedRuleScope; subject: string | null; comment: string; feedbackId: string; actorId: string },
): Promise<{ ok: true; ruleId: string } | { ok: false; error: string }> {
  const ruleType = classifyFeedbackRuleType(params.comment);
  const { data: rule, error: ruleError } = await service
    .from(TABLES.learned_rules)
    .insert({
      scope: params.scope,
      subject: params.subject,
      rule_type: ruleType,
      value: { text: params.comment },
      confidence: null,
      source_feedback_id: params.feedbackId,
      status: "suggested",
      created_by: params.actorId,
    })
    .select("id")
    .single();
  if (ruleError || !rule) return { ok: false, error: ruleError?.message ?? "Could not create the suggested rule." };

  await service.from(TABLES.agent_feedback).update({ converted_rule_id: rule.id }).eq("id", params.feedbackId);
  return { ok: true, ruleId: rule.id };
}

export interface SubmitItemFeedbackParams {
  runId: string;
  bomLineId: string;
  comment: string;
  actorId: string;
}

/** Per-item feedback (💬 toggle on a review line) → suggested rule, scope Part. */
export async function submitItemFeedback(supabase: DB, service: DB, params: SubmitItemFeedbackParams): Promise<FeedbackResult> {
  const resultId = await pickAnchorResultId(service, params.runId, params.bomLineId);

  const { data: line } = await supabase.from(TABLES.bom_lines).select("mpn, references, line_no").eq("id", params.bomLineId).maybeSingle();
  const subject = line?.mpn ?? line?.references ?? (line?.line_no != null ? `Line ${line.line_no}` : null);

  const { data: feedback, error: feedbackError } = await supabase
    .from(TABLES.agent_feedback)
    .insert({ run_id: params.runId, result_id: resultId, comment: params.comment, feedback_tag: null, created_by: params.actorId })
    .select("id")
    .single();
  if (feedbackError || !feedback) return { ok: false, error: feedbackError?.message ?? "Could not save that feedback." };

  const ruleResult = await createSuggestedRule(service, {
    scope: "part",
    subject,
    comment: params.comment,
    feedbackId: feedback.id,
    actorId: params.actorId,
  });
  if (!ruleResult.ok) return ruleResult;

  await notifyRulePending(supabase, { ruleSummary: params.comment }).catch(() => undefined);
  return ruleResult;
}

export interface SubmitOrderRemarkParams {
  runId: string;
  comment: string;
  actorId: string;
}

/** Whole-order remark → suggested rule, scope Project ("scope Order" — see module doc). */
export async function submitOrderRemark(supabase: DB, service: DB, params: SubmitOrderRemarkParams): Promise<FeedbackResult> {
  const { data: run, error: runError } = await supabase.from(TABLES.agent_runs).select("bom_id").eq("id", params.runId).maybeSingle();
  if (runError) return { ok: false, error: runError.message };
  if (!run) return { ok: false, error: "That run no longer exists." };

  const { data: bom, error: bomError } = await supabase.from(TABLES.boms).select("project_id").eq("id", run.bom_id).maybeSingle();
  if (bomError) return { ok: false, error: bomError.message };
  if (!bom) return { ok: false, error: "That BOM no longer exists." };

  const project = await getProjectHeader(supabase, bom.project_id);

  const { data: feedback, error: feedbackError } = await supabase
    .from(TABLES.agent_feedback)
    .insert({ run_id: params.runId, result_id: null, comment: params.comment, feedback_tag: null, created_by: params.actorId })
    .select("id")
    .single();
  if (feedbackError || !feedback) return { ok: false, error: feedbackError?.message ?? "Could not save that remark." };

  const ruleResult = await createSuggestedRule(service, {
    scope: "project",
    subject: project?.name ?? null,
    comment: params.comment,
    feedbackId: feedback.id,
    actorId: params.actorId,
  });
  if (!ruleResult.ok) return ruleResult;

  await notifyRulePending(supabase, { ruleSummary: params.comment }).catch(() => undefined);
  return ruleResult;
}
