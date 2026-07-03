/**
 * lib/runs/rule-classify.ts — best-effort, deterministic keyword classifier
 * turning a free-text review comment (plan/tab-order-review.md §2: "wrong
 * package · prefer LCSC · we already stock this") into one of the fixed
 * `smark_learned_rules.rule_type` values (types/db.ts `LearnedRuleTypeSchema`)
 * — the prototype/spec only shows a single free-text box, no tag picker, so
 * there is no explicit `feedback_tag` to key off. Pure — no I/O — so it's
 * directly unit-testable; not real NLP, just keyword buckets in a fixed
 * priority order (first match wins).
 */

import type { LearnedRuleType } from "@/types/db";

const KEYWORD_RULES: ReadonlyArray<{ type: LearnedRuleType; pattern: RegExp }> = [
  { type: "package_correction", pattern: /\b(package|pkg|footprint)\b/i },
  { type: "already_stocked", pattern: /\b(already (have|stock|in stock)|we stock|in-house)\b/i },
  { type: "avoid_distributor", pattern: /\b(avoid|never (use|buy)|don'?t (use|buy)|no longer)\b/i },
  { type: "prefer_distributor", pattern: /\b(prefer|only|instead of|rather than|always (use|buy))\b/i },
  { type: "price_source_note", pattern: /\b(price|cost|₹|rs\.?|expensive|cheap(er)?)\b/i },
  { type: "status_preference", pattern: /\b(nrnd|eol|obsolete|active part|status)\b/i },
];

/** First matching bucket wins; falls back to `status_preference` as the generic "note" bucket. */
export function classifyFeedbackRuleType(comment: string): LearnedRuleType {
  for (const { type, pattern } of KEYWORD_RULES) {
    if (pattern.test(comment)) return type;
  }
  return "status_preference";
}
