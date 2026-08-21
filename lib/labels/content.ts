/**
 * lib/labels/content.ts — what goes ON a label, per category (FEATURES.md §8).
 *
 * Split out of `lib/labels/queue.ts` (which owns the DB writes) because the
 * client's requirement is about the label's *content*, not about when one is
 * created:
 *
 *   > Resistor:  Value, Package, Voltage, Power, Part No.
 *   > Capacitor: Value, Package, Voltage, Power, Part No.
 *   > IC:        MPN, Description, Part No.
 *   > The Required details show information required on Label for that category.
 *   — client, 2026-08-21
 *
 * Every part used to get the same three lines (PID / MPN / value · package),
 * which is wrong in both directions: a resistor label showed neither its
 * voltage nor its power rating, and an IC — which has no value and often no
 * package in this catalogue — printed a PID and nothing else useful, because
 * its description was never a candidate.
 *
 * Pure and category-driven so the mapping is one table to read and change
 * (tests/unit/labels-content.test.ts), not conditionals spread through the
 * renderer.
 */

/** A field a label can carry. Ordered per category by `FIELDS_BY_CATEGORY`. */
export type LabelField = "mpn" | "value" | "package" | "voltage" | "power" | "description";

export interface LabelPartInput {
  internal_pid: string;
  mpn?: string | null;
  value?: string | null;
  package?: string | null;
  voltage?: string | null;
  description?: string | null;
  category?: string | null;
  attributes?: Record<string, unknown> | null;
}

/**
 * The client's spec, verbatim. `Part No.` is not listed here because the
 * internal PID leads every label unconditionally — it is what the QR beside it
 * encodes, so a label without it can't be reconciled to a scan.
 */
const FIELDS_BY_CATEGORY: Record<string, readonly LabelField[]> = {
  Resistor: ["value", "package", "voltage", "power"],
  Capacitor: ["value", "package", "voltage", "power"],
  IC: ["mpn", "description"],
};

/**
 * Everything the client did not name a rule for.
 *
 * Deliberately the union rather than a guess: connectors, diodes and inductors
 * each keep their identity in a different column (a diode in `description`, an
 * inductor in `value`, a connector in both), and a label that omits the one
 * field a category actually populates is the bug being fixed here. Empty
 * fields cost nothing — they are dropped, not printed blank.
 */
const DEFAULT_FIELDS: readonly LabelField[] = ["mpn", "value", "package", "voltage", "description"];

/**
 * Fields that share a line when both are present, to keep the block short on a
 * 38×21mm label. Value and package read as one spec ("1 kΩ · 0805"), as do the
 * two ratings ("400V · 500mW").
 */
const LINE_PARTNER: ReadonlyMap<LabelField, LabelField> = new Map([
  ["value", "package"],
  ["voltage", "power"],
]);

/** Attribute keys the catalogue has used for a power rating, most specific first. */
const POWER_KEYS = ["power_watts", "wattage", "power", "power_rating"] as const;

export function fieldsForCategory(category: string | null | undefined): readonly LabelField[] {
  return FIELDS_BY_CATEGORY[(category ?? "").trim()] ?? DEFAULT_FIELDS;
}

/**
 * `400` → `400V`, `50V` → `50V`.
 *
 * The imported resistors carry voltage as a bare number (`voltage: "400"`)
 * while the capacitors carry it with the unit (`"50V"`). On a label a lone
 * "400" beside "0805" reads as another package code.
 */
function formatVoltage(raw: unknown): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  return /^\d+(\.\d+)?$/.test(text) ? `${text}V` : text;
}

/** `0.125` → `0.125W`; `"500mW"` and `"0.25W"` are already units and pass through. */
function formatPower(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  return /^\d+(\.\d+)?$/.test(text) ? `${text}W` : text;
}

function fieldValue(part: LabelPartInput, field: LabelField): string | null {
  switch (field) {
    case "mpn":
      return part.mpn?.trim() || null;
    case "value":
      return part.value?.trim() || null;
    case "package":
      return part.package?.trim() || null;
    case "voltage":
      return formatVoltage(part.voltage);
    case "power": {
      const attributes = part.attributes ?? {};
      for (const key of POWER_KEYS) {
        const found = formatPower(attributes[key]);
        if (found) return found;
      }
      return null;
    }
    case "description":
      return part.description?.trim() || null;
  }
}

/**
 * The lines of an ESD-plastic label, PID first.
 *
 * Returns lines, not a blob: the renderer wraps each one independently so a
 * long description flows onto a second line instead of pushing the part number
 * off the label.
 */
export function partLabelLines(part: LabelPartInput): string[] {
  const fields = fieldsForCategory(part.category);
  const lines = [part.internal_pid];
  const consumed = new Set<LabelField>();

  for (const field of fields) {
    if (consumed.has(field)) continue;
    consumed.add(field);

    const partner = LINE_PARTNER.get(field);
    const values = [fieldValue(part, field)];
    if (partner && fields.includes(partner)) {
      consumed.add(partner);
      values.push(fieldValue(part, partner));
    }

    const line = values.filter(Boolean).join(" · ");
    if (line) lines.push(line);
  }

  return lines;
}

export interface LabelBoxInput {
  name: string;
  category?: string | null;
  shelfCode: string;
}

/**
 * Big-Box label lines (FEATURES §8: "encodes box id → live contents").
 *
 * One line each rather than the old ` · `-joined single line, which is what the
 * client photographed as "BOX Conne…" — three facts on one line could never fit
 * the ~15mm of text width beside the QR, so the box's own name was the part
 * that got cut.
 */
export function boxLabelLines(box: LabelBoxInput): string[] {
  const lines = [`BOX ${box.name}`];
  const category = box.category?.trim();
  // Boxes created off a category are named for it ("Resistor 1206" /
  // "Resistor"); repeating it would spend a line saying nothing.
  if (category && !box.name.toLowerCase().includes(category.toLowerCase())) lines.push(category);
  lines.push(`Shelf ${box.shelfCode}`);
  return lines;
}
