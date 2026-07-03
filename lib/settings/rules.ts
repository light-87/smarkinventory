/**
 * lib/settings/rules.ts — pure guard logic for the Standard search rules
 * card (FEATURES.md §7, plan/tab-settings.md). Kept dependency-free (no
 * Supabase import) so it's unit-testable without the local stack — the DB
 * ALSO refuses (migration 0004's `smark_ordering_rules_package_locked`
 * CHECK + `trg_smark_ordering_rules_protect_package` BEFORE DELETE trigger),
 * this is the friendly app-level layer in front of that, same idiom as
 * lib/auth/roles's `canWrite` in front of RLS.
 */

import { isRulePinned } from "./types";
import type { OrderingRuleRow } from "@/types/db";

export interface RuleRemovalCheck {
  removable: boolean;
  reason?: string;
}

/** The Package rung (`key="package"`, `mandatory=true`) can never be removed — package match is never substitutable. */
export function checkRuleRemovable(row: Pick<OrderingRuleRow, "key" | "mandatory">): RuleRemovalCheck {
  if (isRulePinned(row)) {
    return {
      removable: false,
      reason: "The Package rule is mandatory and can't be removed — package match is never substitutable.",
    };
  }
  return { removable: true };
}

/** Next `rank` for a newly-appended row — max existing + 1 (ranks may have gaps after deletions). */
export function nextRank(existingRanks: readonly number[]): number {
  return existingRanks.length === 0 ? 1 : Math.max(...existingRanks) + 1;
}
