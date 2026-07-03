/**
 * lib/expenses/chart-theme.ts — recharts color/mark constants for every
 * Expenses chart (plan/tab-expenses.md R2-21).
 *
 * Palette derivation (dataviz skill): the 6 REAL categorical hues below
 * (every category except "Other", which is deliberately a neutral gray —
 * see below) are the skill's reference dark palette (references/palette.md),
 * re-validated in THIS exact order against THIS app's actual card surface
 * (#141414, one step darker than the skill's own #1a1a19 default) with
 * `scripts/validate_palette.js` —
 *
 *   node validate_palette.js "#3987e5,#199e70,#c98500,#9085e9,#e66767,#d55181" \
 *     --mode dark --surface "#141414"
 *   → ALL CHECKS PASS — lightness band, chroma floor, contrast, AND CVD
 *     separation (worst adjacent ΔE 23.7, well clear of the ≥12 target).
 *     Dropping the palette's "green" slot (too close to `smk.success`, this
 *     app's reserved positive/success hue — see INCOME_COLOR below) both
 *     avoids that semantic clash and happens to improve worst-case CVD
 *     separation among the remaining six.
 *
 * "Other" gets a plain neutral gray, not a 7th hue: it's the catch-all
 * bucket ("unclassified"), and a gray reads as exactly that rather than
 * implying a real category identity.
 *
 * The brand orange (`smk.accent`) is deliberately EXCLUDED from this
 * categorical set (it's the app's one CTA/accent color, reserved below for
 * "expense" as a semantic — not identity — encoding) and the hue order is
 * FIXED (never cycled/reassigned) per category, matching FEATURES.md's fixed
 * category list.
 */

import { smk } from "@/lib/theme";
import type { ExpenseCategory } from "@/types/db";

/** Fixed hue order — do not reorder without re-running the validator above. */
export const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  Materials: "#3987e5", // blue
  Salaries: "#199e70", // aqua
  Rent: "#c98500", // amber
  Utilities: "#9085e9", // violet
  Tools: "#e66767", // red
  "Client payment": "#d55181", // magenta
  Other: smk.graphite, // neutral — catch-all, deliberately not a hue
};

/** Fallback for a category value the map above doesn't recognize (shouldn't happen — DB CHECK constrains it). */
export const CATEGORY_FALLBACK_COLOR = smk.textFaint;

export function colorForCategory(category: string): string {
  return (CATEGORY_COLORS as Record<string, string>)[category] ?? CATEGORY_FALLBACK_COLOR;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Semantic (not identity) colors — money in vs money out
 * ──────────────────────────────────────────────────────────────────────────── */

export const INCOME_COLOR = smk.success; // money in — the app's one "positive" green
export const EXPENSE_COLOR = smk.accent; // money out — the app's one accent, used deliberately to draw the eye to spend
export const NET_COLOR = smk.accent;
export const THIS_YEAR_COLOR = smk.accent;
export const LAST_YEAR_COLOR = smk.graphite;
export const MAGNITUDE_COLOR = smk.textSecondary; // single-hue ranked bars (by-account, ai-spend) — identity already carries via the axis label
export const PROJECT_INCOME_COLOR = smk.success;

/* ────────────────────────────────────────────────────────────────────────────
 * Chrome shared by every chart (grid/axis/tooltip)
 * ──────────────────────────────────────────────────────────────────────────── */

export const CHART_GRID_COLOR = smk.borderHairline;
export const CHART_AXIS_COLOR = smk.textFaint;
export const CHART_TICK_COLOR = smk.textTertiary;
export const CHART_TOOLTIP_BG = smk.surfaceRaised;
export const CHART_TOOLTIP_BORDER = smk.border;

export const CHART_TICK_STYLE = {
  fill: CHART_TICK_COLOR,
  fontSize: 11,
  fontFamily: smk.fontMono,
} as const;

/** Mark specs (dataviz skill references/marks-and-anatomy.md): ≤24px bars, 4px rounded data-end. */
export const BAR_MAX_SIZE = 24;
export const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];
export const BAR_RADIUS_HORIZONTAL: [number, number, number, number] = [0, 4, 4, 0];
export const LINE_STROKE_WIDTH = 2;
export const AREA_FILL_OPACITY = 0.1;
