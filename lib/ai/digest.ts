/**
 * lib/ai/digest.ts — the rules-digest builder (plan/tab-ai-memory.md §3/§4,
 * SCHEMA.md §5 `smark_learned_rules` / `smark_learned_rules_doc`).
 *
 * `smark_learned_rules.value` is `jsonb not null` with no narrower DB
 * contract (types/db.ts types it `z.unknown()`). This package's convention
 * (documented for whoever writes the future "feedback → suggested rule"
 * drafting step): `value.text` always carries the single plain-English rule
 * line shown in the UI (prototype `r.rule` — "prefer LCSC for GCU 0.1µF
 * caps", "Unikey only if cheaper AND in stock", ...); everything else in
 * `value` is optional structured detail for future automation. Rendering
 * falls back to a generic `rule_type` label if `value.text` is ever absent
 * (e.g. a hand-inserted row) so the digest never prints "undefined".
 *
 * IMPORTANT: the digest built here uses REAL names — this is what's stored
 * in `smark_learned_rules_doc.content` and shown on the AI Memory screen
 * (plan/tab-ai-memory.md: "the AI-Memory SCREEN keeps real names — it's
 * internal UI"). Aliasing happens separately, only on the copy injected
 * into a planner prompt — see `aliasDigestForInjection` at the bottom, which
 * callers (bom-pipeline) run the stored content through right before it
 * goes into a Claude request.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LearnedRuleRow, LearnedRuleType } from "@/types/db";
import { TABLES } from "@/types/db";
import { aliasText } from "./alias";

export interface LearnedRuleValue {
  /** Always present by convention — the single human-readable rule line. */
  text?: string;
  distributor?: string;
  threshold?: number;
  [key: string]: unknown;
}

const RULE_TYPE_LABELS: Record<LearnedRuleType, string> = {
  prefer_distributor: "Prefer distributor",
  avoid_distributor: "Avoid distributor",
  already_stocked: "Already stocked",
  package_correction: "Package correction",
  status_preference: "Status preference",
  price_source_note: "Price source note",
};

export function scopeLabel(scope: LearnedRuleRow["scope"]): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export function renderRuleText(rule: Pick<LearnedRuleRow, "rule_type" | "value" | "subject">): string {
  const value = rule.value as LearnedRuleValue | null | undefined;
  if (value && typeof value.text === "string" && value.text.trim()) return value.text.trim();

  const label = RULE_TYPE_LABELS[rule.rule_type];
  const distributor = value?.distributor;
  return distributor ? `${label} — ${distributor}` : label;
}

/**
 * Compact numbered digest of ACTIVE rules, in REAL names — this is the
 * `smark_learned_rules_doc.content` value and what the AI Memory screen
 * shows. Pure — no I/O, unit-testable directly.
 */
export function buildDigestContent(rules: Array<Pick<LearnedRuleRow, "scope" | "subject" | "rule_type" | "value">>): string {
  if (rules.length === 0) return "No active rules yet.";
  return rules
    .map((rule, i) => {
      const subject = rule.subject ?? "All";
      return `${i + 1}. [${scopeLabel(rule.scope)}] ${subject} — ${renderRuleText(rule)}`;
    })
    .join("\n");
}

/** `v3 → v4: +1 rule (prefer LCSC for GCU 0.1µF caps)` / `v4 → v5: -1 rule (Unikey only if cheaper AND in stock)`. */
export function buildChangeSummary(
  prevVersion: number,
  action: "approve" | "retire",
  rule: Pick<LearnedRuleRow, "rule_type" | "value" | "subject">,
): string {
  const nextVersion = prevVersion + 1;
  const sign = action === "approve" ? "+1 rule" : "-1 rule";
  return `v${prevVersion} → v${nextVersion}: ${sign} (${renderRuleText(rule)})`;
}

/** Aliases a stored (real-names) digest for injection into a planner prompt — see module doc. `mapping` is whatever `ensureAliases`/`buildPlannerContext` resolved for the run's project + client. */
export function aliasDigestForInjection(content: string, mapping: Map<string, string> | Record<string, string>): string {
  return aliasText(content, mapping);
}

/* ────────────────────────────────────────────────────────────────────────────
 * I/O — reading the current doc/active rules, and the approve/reject/retire
 * transitions (owner-only; gated by lib/auth/roles's canApproveRules at the
 * Server Action layer, not here — this module assumes the caller already
 * checked).
 * ──────────────────────────────────────────────────────────────────────────── */

type DB = SupabaseClient<Database>;

export interface RuleTransitionResult {
  ruleId: string;
  /** Null when the transition didn't touch the active set (reject on a still-suggested rule — see note below). */
  docVersion: number | null;
}

async function currentDocVersion(client: DB): Promise<number> {
  const { data, error } = await client
    .from(TABLES.learned_rules_doc)
    .select("version")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`digest: failed to read smark_learned_rules_doc: ${error.message}`);
  return data?.version ?? 0;
}

async function activeRules(client: DB): Promise<LearnedRuleRow[]> {
  const { data, error } = await client.from(TABLES.learned_rules).select("*").eq("status", "active");
  if (error) throw new Error(`digest: failed to read active smark_learned_rules: ${error.message}`);
  return (data ?? []) as LearnedRuleRow[];
}

/**
 * Writes a new `smark_learned_rules_doc` row (version = prevVersion+1) with
 * the rebuilt digest + a diff line. No dedicated Postgres function backs
 * this (schema is frozen for this package per docs/OWNERSHIP.md — a true
 * single-statement transaction would need one); callers get "best-effort
 * atomicity": the rule-status update happens first, this bump happens
 * second, and `approveRule`/`retireRule` below revert the status update if
 * this fails. A concurrent version-number race is handled by one retry.
 */
async function bumpDigest(client: DB, actorId: string | null, changeSummary: string): Promise<number> {
  const prevVersion = await currentDocVersion(client);
  const rules = await activeRules(client);
  const content = buildDigestContent(rules);
  const nextVersion = prevVersion + 1;

  const { error } = await client
    .from(TABLES.learned_rules_doc)
    .insert({ version: nextVersion, content, change_summary: changeSummary, created_by: actorId });

  if (error) {
    // Unique(version) race — another approval landed first. Retry once against the fresh max.
    const retryVersion = (await currentDocVersion(client)) + 1;
    const { error: retryError } = await client
      .from(TABLES.learned_rules_doc)
      .insert({ version: retryVersion, content, change_summary: changeSummary, created_by: actorId });
    if (retryError) throw new Error(`digest: failed to write smark_learned_rules_doc: ${retryError.message}`);
    return retryVersion;
  }
  return nextVersion;
}

/**
 * suggested → active. Bumps the digest version (the active set grew) with
 * a `+1 rule` diff line. Caller must already have verified `canApproveRules`
 * (owner-only — A3 invariant: suggested never auto-activates).
 */
export async function approveRule(client: DB, ruleId: string, actorId: string): Promise<RuleTransitionResult> {
  const { data: rule, error: readError } = await client.from(TABLES.learned_rules).select("*").eq("id", ruleId).maybeSingle();
  if (readError) throw new Error(`approveRule: failed to read rule: ${readError.message}`);
  if (!rule) throw new Error("approveRule: rule not found.");
  const row = rule as LearnedRuleRow;
  if (row.status !== "suggested") throw new Error(`approveRule: rule is '${row.status}', not 'suggested'.`);

  const { error: updateError } = await client
    .from(TABLES.learned_rules)
    .update({ status: "active" })
    .eq("id", ruleId)
    .eq("status", "suggested"); // guards a concurrent double-approve
  if (updateError) throw new Error(`approveRule: failed to activate rule: ${updateError.message}`);

  try {
    const prevVersion = await currentDocVersion(client);
    const docVersion = await bumpDigest(client, actorId, buildChangeSummary(prevVersion, "approve", row));
    return { ruleId, docVersion };
  } catch (err) {
    // Best-effort revert — see module doc on atomicity.
    await client.from(TABLES.learned_rules).update({ status: "suggested" }).eq("id", ruleId);
    throw err;
  }
}

/**
 * suggested → retired. A suggested rule was never in an active digest, so
 * rejecting it does not change which rules are active — no version bump,
 * no diff line (a documented deviation from a literal "every action bumps
 * the version" reading; bumping here would falsely claim the active set
 * changed). It also never re-surfaces: `smark_learned_rules.status` has no
 * "suggested" path back from "retired".
 */
export async function rejectRule(client: DB, ruleId: string): Promise<RuleTransitionResult> {
  const { error } = await client
    .from(TABLES.learned_rules)
    .update({ status: "retired" })
    .eq("id", ruleId)
    .eq("status", "suggested");
  if (error) throw new Error(`rejectRule: failed to reject rule: ${error.message}`);
  return { ruleId, docVersion: null };
}

/**
 * active → retired. Bumps the digest version (the active set shrank) with
 * a `-1 rule` diff line — takes effect on the NEXT run's plan (plan/tab-ai-memory.md §4), never retroactively.
 */
export async function retireRule(client: DB, ruleId: string, actorId: string): Promise<RuleTransitionResult> {
  const { data: rule, error: readError } = await client.from(TABLES.learned_rules).select("*").eq("id", ruleId).maybeSingle();
  if (readError) throw new Error(`retireRule: failed to read rule: ${readError.message}`);
  if (!rule) throw new Error("retireRule: rule not found.");
  const row = rule as LearnedRuleRow;
  if (row.status !== "active") throw new Error(`retireRule: rule is '${row.status}', not 'active'.`);

  const { error: updateError } = await client
    .from(TABLES.learned_rules)
    .update({ status: "retired" })
    .eq("id", ruleId)
    .eq("status", "active");
  if (updateError) throw new Error(`retireRule: failed to retire rule: ${updateError.message}`);

  try {
    const prevVersion = await currentDocVersion(client);
    const docVersion = await bumpDigest(client, actorId, buildChangeSummary(prevVersion, "retire", row));
    return { ruleId, docVersion };
  } catch (err) {
    await client.from(TABLES.learned_rules).update({ status: "active" }).eq("id", ruleId);
    throw err;
  }
}
