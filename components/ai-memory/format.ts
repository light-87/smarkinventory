/**
 * components/ai-memory/format.ts — small display-only helpers for the AI
 * Memory screen. `smark_learned_rules.confidence` is `numeric` with no
 * documented scale beyond "0-100 / high-med colored" (prototype baseline);
 * this package's convention is a 0-1 probability (matches `lib/ai/extract.ts`'s
 * `normalizeMpn` confidence), rendered as a percentage.
 *
 * Deliberately does NOT import from `@/lib/ai/digest` (or anything under
 * `@/lib/ai` beyond plain types) even though `scopeLabel` already exists
 * there — this file is rendered inside `AiMemoryClient` ("use client"),
 * and `lib/ai/digest.ts` transitively imports `lib/ai/alias.ts` →
 * `lib/supabase/server.ts` → `next/headers`, which cannot be bundled for
 * the browser. Keep every helper this package's client components use
 * free of that chain; server-only rendering (`renderRuleText`) already
 * happens once in `lib/ai/queries.ts` and reaches the client as a plain
 * `ruleText` string on `RuleListItem`.
 */

import type { ChipTone } from "@/components/ui/chip";
import type { LearnedRuleRow } from "@/types/db";

export function formatConfidence(confidence: number | null): string {
  if (confidence == null) return "—";
  return `${Math.round(confidence * 100)}%`;
}

export function confidenceTone(confidence: number | null): ChipTone {
  if (confidence == null) return "default";
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "accent";
  return "neutral";
}

/** Client-safe copy of `lib/ai/digest.ts`'s `scopeLabel` — see module doc for why this isn't a re-export. */
export function scopeLabel(scope: LearnedRuleRow["scope"]): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}
