/**
 * lib/format.ts — ₹ INR currency, en-IN numbers, and date/time display helpers.
 *
 * The one place every feature package formats money/numbers/dates, so a
 * rupee is never rendered "$1,234.00"-style and every screen agrees on
 * "2 Jul 2026" vs "07/02/2026" (FEATURES.md: Indian SMB users, mobile-first,
 * English-first with a Marathi/Hindi seam — §18). Pure, no I/O.
 */

import { format as formatDateFns, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

/* ────────────────────────────────────────────────────────────────────────────
 * Currency (₹ INR)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface FormatInrOptions {
  /** Prefix the ₹ symbol. Default true. */
  showSymbol?: boolean;
  /** Fixed decimal places. Default 2. */
  decimals?: number;
  /** Returned for null/undefined/NaN input. Default "—". */
  fallback?: string;
}

/**
 * "₹1,23,456.00" — Indian digit grouping (lakh/crore places, not plain
 * thousands), via `Intl.NumberFormat("en-IN")` so the platform's ICU locale
 * data does the grouping rather than a hand-rolled (and easy to get subtly
 * wrong) comma-insertion regex.
 */
export function formatINR(amount: number | null | undefined, options: FormatInrOptions = {}): string {
  const { showSymbol = true, decimals = 2, fallback = "—" } = options;
  if (amount === null || amount === undefined || Number.isNaN(amount)) return fallback;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return showSymbol ? `₹${formatted}` : formatted;
}

const LAKH = 100_000;
const CRORE = 10_000_000;

function trimTrailingZeros(fixed: string): string {
  return fixed.replace(/\.?0+$/, "");
}

/**
 * Compact dashboard-tile form: "₹4.5L", "₹1.2Cr", "₹850" (below a lakh,
 * falls back to plain grouped rupees, never "₹0.01L"). Hand-rolled rather
 * than `Intl`'s `notation: "compact"` so the lakh/crore thresholds and
 * rounding are exact and stable across Node/ICU versions — deterministic
 * for tests, not dependent on the runtime's compact-notation locale data.
 */
export function formatINRCompact(
  amount: number | null | undefined,
  options: Pick<FormatInrOptions, "fallback"> = {},
): string {
  const { fallback = "—" } = options;
  if (amount === null || amount === undefined || Number.isNaN(amount)) return fallback;
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (abs >= CRORE) return `${sign}₹${trimTrailingZeros((abs / CRORE).toFixed(2))}Cr`;
  if (abs >= LAKH) return `${sign}₹${trimTrailingZeros((abs / LAKH).toFixed(2))}L`;
  return `${sign}${formatINR(abs, { decimals: 0 })}`;
}

/**
 * "N unpriced" honesty label (FEATURES §5.1 — dashboard inventory value:
 * "Σ qty × last price, 'N unpriced' honesty label"). Empty string when
 * everything is priced, so callers can drop it straight into JSX with `&&`.
 */
export function formatUnpricedNote(unpricedCount: number): string {
  if (unpricedCount <= 0) return "";
  return `${formatNumber(unpricedCount)} unpriced`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Plain numbers (en-IN grouping, no currency)
 * ──────────────────────────────────────────────────────────────────────────── */

export function formatNumber(
  value: number | null | undefined,
  options: { decimals?: number; fallback?: string } = {},
): string {
  const { decimals = 0, fallback = "—" } = options;
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dates — accepts `date`/`timestamptz` columns as returned by PostgREST
 * (plain `YYYY-MM-DD`, or ISO datetime with offset), a `Date`, or epoch ms.
 * ──────────────────────────────────────────────────────────────────────────── */

export type DateInput = string | number | Date | null | undefined;

/**
 * `parseISO` (not `new Date(str)`) is deliberate: the native constructor
 * treats a bare `YYYY-MM-DD` as UTC midnight, which renders as the PREVIOUS
 * day in any timezone behind UTC (most of the Americas) — a classic
 * off-by-one. `date-fns`' `parseISO` parses date-only strings as local time
 * instead, which is what a `date`-typed column (phase dates, `entry_date`…)
 * means here.
 */
function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined) return null;
  const date = input instanceof Date ? input : typeof input === "number" ? new Date(input) : parseISO(input);
  return isValid(date) ? date : null;
}

/** "2 Jul 2026" — date-only display (phase dates, `entry_date`, `work_date`…). */
export function formatDate(input: DateInput, fallback = "—"): string {
  const date = toDate(input);
  return date ? formatDateFns(date, "d MMM yyyy") : fallback;
}

/** "2 Jul 2026, 4:32 PM" — timestamptz display (movements, part events, notifications…). */
export function formatDateTime(input: DateInput, fallback = "—"): string {
  const date = toDate(input);
  return date ? formatDateFns(date, "d MMM yyyy, h:mm a") : fallback;
}

/** "4:32 PM" — time-only (attendance check-in/out chips). */
export function formatTime(input: DateInput, fallback = "—"): string {
  const date = toDate(input);
  return date ? formatDateFns(date, "h:mm a") : fallback;
}

/** "2 hours ago" / "in 3 days" — activity feed / notification timestamps. */
export function formatRelativeTime(input: DateInput, fallback = "—"): string {
  const date = toDate(input);
  return date ? formatDistanceToNowStrict(date, { addSuffix: true }) : fallback;
}

/** `YYYY-MM-DD` for a `date`-typed column — local calendar day, no time/zone drift. */
export function toDateOnlyString(input: DateInput): string | null {
  const date = toDate(input);
  return date ? formatDateFns(date, "yyyy-MM-dd") : null;
}
