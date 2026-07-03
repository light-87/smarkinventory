/**
 * lib/timezone.ts — the ONE IST day-boundary helper (finding #4).
 *
 * `lib/dashboard/compute.ts`'s `todayBoundsIso()` and `lib/daily/compute.ts`'s
 * `todayDateOnly()`/`dateRangeToIsoBounds()` used to compute the day window
 * from server-local `new Date()` + `.toISOString()` (UTC). On the Vercel/UTC
 * runtime, "today" became 00:00–24:00 UTC = 05:30 IST → 05:30 IST the NEXT
 * day, so every movement/attendance clock-in/cart-add/order/run/expense that
 * happens between midnight and 05:30 IST was mis-bucketed into the PREVIOUS
 * day everywhere (dashboard "movements today" tile, the daily digest, day/
 * range export).
 *
 * Fixed here instead: every "day" computed anywhere in the app is the
 * Asia/Kolkata calendar day (fixed +05:30 — India observes no DST, so a
 * fixed offset is exact, no IANA tz database needed), derived purely from
 * the instant's epoch millis (`.getTime()`) and UTC getters/`Date.UTC` — never
 * from the running process's own local timezone, which is what made the old
 * code correct on a dev machine set to IST and wrong on a UTC server.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The IST calendar-date {year, month (0-11), day} containing the instant
 * `reference` — via the standard fixed-offset trick: shift the epoch by the
 * offset, then read UTC (not local) getters off the shifted instant.
 */
function istDateParts(reference: Date): { year: number; month: number; day: number } {
  const shifted = new Date(reference.getTime() + IST_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/** `YYYY-MM-DD` for the IST calendar day containing `reference` (default now). */
export function istDateOnly(reference: Date = new Date()): string {
  const { year, month, day } = istDateParts(reference);
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/** The UTC epoch millis for `00:00 IST` on the literal `year`-`month`(0-11)-`day`. */
function istMidnightMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - IST_OFFSET_MS;
}

export interface IstBoundsIso {
  /** Inclusive start instant (IST midnight), ISO/UTC. */
  start: string;
  /** Exclusive end instant (next IST midnight), ISO/UTC. */
  end: string;
}

/** `[IST midnight, next IST midnight)` as UTC ISO instants for the IST calendar day containing `reference` (default now). */
export function istDayBoundsIso(reference: Date = new Date()): IstBoundsIso {
  const { year, month, day } = istDateParts(reference);
  const startMs = istMidnightMs(year, month, day);
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 24 * 60 * 60_000).toISOString() };
}

function parseDateOnlyParts(dateOnly: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return { year: y!, month: (m ?? 1) - 1, day: d ?? 1 };
}

/**
 * `[from 00:00 IST, to+1day 00:00 IST)` as UTC ISO instants for a `YYYY-MM-DD`
 * date-only day or range (`from`/`to` are literal calendar dates — no
 * timezone attached to the strings themselves, they're always read as IST).
 */
export function istDateRangeToIsoBounds(from: string, to: string): IstBoundsIso {
  const fromParts = parseDateOnlyParts(from);
  const toParts = parseDateOnlyParts(to);
  const startMs = istMidnightMs(fromParts.year, fromParts.month, fromParts.day);
  // `Date.UTC` normalizes day-overflow (`day + 1` past month-end rolls into
  // the next month/year), so this is exactly "the day after `to`".
  const endMs = istMidnightMs(toParts.year, toParts.month, toParts.day + 1);
  return { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };
}
