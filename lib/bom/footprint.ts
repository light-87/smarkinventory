/**
 * lib/bom/footprint.ts — reconcile-only helpers that turn a raw BOM line's
 * free-text `footprint`/`value` cells into the shape `lib/matcher` expects
 * (`package`, split `value`+`voltage`).
 *
 * Real BOM exports (tests/fixtures/TMCS_96x32_Matrix_V1.2.xlsx,
 * GCU_V1.1_BOM.xlsx — see tests/unit/import-bom.test.ts) carry KiCad-style
 * footprint strings like `"SMARKKicadLib:CAP_AE_10x10.5"` or
 * `"SMARKKicadLib:C0805"`, and combined value/voltage cells like
 * `"220uF/50V"` — neither matches `smark_parts.package`/`.value`/`.voltage`
 * (plain facets like `"0805"`, `"220uF"`, `"50V"`) directly. These are
 * best-effort extractors feeding the fuzzy value+package rung (FEATURES §7
 * rung 3) — `lib/matcher`'s own `normalizePackage`/`valueSimilarity` still do
 * the actual comparison, so a miss here just means that rung doesn't fire
 * (falls through to `unresolved`), never a false match.
 *
 * Deliberately NOT part of `lib/import/bom.ts` (integrator-shared, owned by
 * the `import` package per docs/OWNERSHIP.md) — this is reconcile-specific
 * shaping that only bom-pipeline needs.
 */

/** Bare SMD passive package sizes seen in the demo catalog (tests/fixtures/canonical-seed-data.ts). */
const SMD_SIZE_PATTERN = /(0201|0402|0603|0805|1008|1206|1210|1806|1812|2010|2512|2920)(?!\d)/i;

/**
 * Named through-hole/SMD package families — matched loosely, `lib/matcher`
 * normalizes both sides anyway. Deliberately NOT `\b`-wrapped: real KiCad
 * footprint names glue a trailing size straight onto the package
 * (`"LQFP-48_7x7mm"`), and `_`/digits count as "word" characters to regex's
 * `\b`, so a boundary assertion there never fires — this is a best-effort
 * extraction, not a strict token match.
 */
const NAMED_PACKAGE_PATTERN =
  /(SOT-?\d+[A-Z]?|SOD-?\d+[A-Z]?|SOP-?\d+|SSOP-?\d+|TSSOP-?\d+|MSOP-?\d+|QFN-?\d+|QFP-?\d+|LQFP-?\d+|BGA-?\d+|TO-?\d+[A-Z]?|DIP-?\d+|SMA|SMB|SMC)/i;

/**
 * Best-effort package token from a raw footprint string, or `null` when
 * nothing recognizable is found (e.g. `"CAP_AE_10x10.5"` — an electrolytic
 * can size, not a catalog package facet). Strips any `Library:` prefix first.
 */
export function derivePackageFromFootprint(footprint: string | null | undefined): string | null {
  if (!footprint) return null;
  const afterPrefix = footprint.includes(":") ? footprint.slice(footprint.lastIndexOf(":") + 1) : footprint;

  const smd = SMD_SIZE_PATTERN.exec(afterPrefix);
  if (smd) return smd[1]!;

  const named = NAMED_PACKAGE_PATTERN.exec(afterPrefix);
  if (named) return named[1]!;

  return null;
}

export interface SplitValueVoltage {
  value: string | null;
  voltage: string | null;
}

/**
 * Splits a combined `"220uF/50V"`-style BOM value cell into `value` +
 * `voltage`, mirroring the split `smark_parts.value`/`.voltage` already
 * carries [R2-24] so the fuzzy rung compares like with like. A cell with no
 * `/` (most resistor/simple values) passes through as `value` with
 * `voltage: null`.
 */
export function splitValueVoltage(raw: string | null | undefined): SplitValueVoltage {
  if (!raw) return { value: null, voltage: null };
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, voltage: null };

  const slash = trimmed.indexOf("/");
  if (slash === -1) return { value: trimmed, voltage: null };

  const value = trimmed.slice(0, slash).trim();
  const voltage = trimmed.slice(slash + 1).trim();
  return { value: value || trimmed, voltage: voltage || null };
}
