/**
 * lib/attendance/comp-days.ts — the day-based comp-off rules (migration 0020).
 *
 * Pure functions only: no Supabase, no React, no clock reads, so
 * tests/unit/attendance-comp-days.test.ts can exercise every branch without a
 * database — same convention as lib/attendance/status.ts and lib/pm/kpi.ts.
 *
 * Replaces the HOURS arithmetic in status.ts (computeCompBalanceHours), which
 * could express neither a yearly entitlement nor an owner correction. The
 * business speaks in half and whole days; so does this.
 */

/** Hours worked at or above which extra work is worth a whole comp day rather than a half. */
export const FULL_DAY_THRESHOLD_HOURS = 4;

/** The standard yearly entitlement for staff flagged as entitled. Stored per-user in smark_comp_settings, so this is only the default the owner's toggle writes. */
export const STANDARD_ANNUAL_COMP_DAYS = 16;

/**
 * What approved extra work is worth, in comp days.
 *
 * The client's rule, verbatim: "if they work less than 4 hours it will be 0.5
 * compensatory leave, if they have worked more than 4 hours it will be 1".
 * Exactly 4 hours counts as the full day — the boundary has to fall somewhere
 * and rounding a full half-shift down to a half day is the reading an employee
 * would dispute.
 *
 * Returns 0 for a non-positive claim so a bad input can never credit anyone.
 */
export function compDaysForHours(hoursApproved: number | null | undefined): number {
  if (hoursApproved == null || !Number.isFinite(hoursApproved) || hoursApproved <= 0) return 0;
  return hoursApproved >= FULL_DAY_THRESHOLD_HOURS ? 1 : 0.5;
}

/**
 * What a compensatory leave costs, in comp days: 0.5 for a half day, otherwise
 * one per calendar day of the request (inclusive of both ends).
 *
 * `halfDay` is only meaningful on a single-day request — the UI enforces that,
 * and so does this: a multi-day range ignores the flag rather than quietly
 * charging half a day for a week off.
 */
export function compDaysForLeave(dayCount: number, halfDay: boolean): number {
  if (!Number.isFinite(dayCount) || dayCount <= 0) return 0;
  const days = Math.floor(dayCount);
  if (halfDay && days === 1) return 0.5;
  return days;
}

/** Inclusive day count between two `YYYY-MM-DD` dates; 0 if the range is inverted or unparseable. */
export function inclusiveDayCount(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export interface CompLedgerEntryInput {
  deltaDays: number;
}

/** Balance = the sum of every movement. Rounded to one decimal so repeated 0.5s can't drift. */
export function compBalanceDays(entries: readonly CompLedgerEntryInput[]): number {
  const total = entries.reduce((sum, e) => sum + e.deltaDays, 0);
  return Math.round(total * 10) / 10;
}

/**
 * The 1 January movements for one employee: zero whatever is left, then grant
 * the new year's entitlement.
 *
 * The owner chose "reset to the grant, unused lost" — so last year's leftover
 * is cleared rather than carried. Both parts are expressed as deltas against
 * the running balance, which keeps the ledger append-only and makes the reset
 * reversible by deleting two rows.
 *
 * Returns only the movements that are non-zero: a balance that is already 0
 * needs no reset row, and an employee who isn't entitled gets no grant row.
 */
export function annualResetEntries(balanceBeforeReset: number, annualDays: number): { reset: number; grant: number } {
  // `|| 0` collapses -0, which negating a zero balance produces. It compares
  // equal to 0 so it would never be written, but it reads as "-0 days" in a
  // log line and trips strict equality in tests.
  const reset = Math.round(-balanceBeforeReset * 10) / 10 || 0;
  const grant = annualDays > 0 ? annualDays : 0;
  return { reset, grant };
}

/** Is this leave request spendable against the balance? Blocks over-spending before anything is written. */
export function canSpendCompDays(balanceDays: number, costDays: number): boolean {
  return costDays > 0 && balanceDays >= costDays;
}

/** "1.5 days" / "1 day" / "0.5 days" — one place so every screen phrases a balance the same way. */
export function formatCompDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${rounded === 1 ? "day" : "days"}`;
}
