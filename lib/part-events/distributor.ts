/**
 * lib/part-events/distributor.ts — the distributor a part was sourced from.
 *
 * Client request, 2026-08-11: "Distributor property is still not visible
 * anywhere. It should be visible on Part page. It gives us idea from where we
 * sourced that item… Should have following values as selectable -
 * LCSC/Digikey/Mouser/Unikey/Element14/Other. For 'Other' selection - there
 * should be text box for manual entry."
 *
 * A closed list with an escape hatch, rather than free text, because the
 * imported column is genuinely messy: alongside the five real distributors it
 * holds manufacturer names (`ANALOG DEVICES`, `FTDI`), packaging notes (`2Reel`,
 * `BOX`), a dimension (`208mil`) and colours (`Black`, `Green`). The client's
 * own `Import_Guide.md` calls this out. Offering the five he actually buys from
 * makes the common case one tap and keeps the facet list from growing a new
 * spelling every time someone types.
 *
 * Nothing is rewritten on import: a part whose distributor is `RS` opens with
 * "Other" chosen and `RS` in the box, so the existing value is visible, editable
 * and preserved unless he changes it.
 */

/** The distributors the client buys from, in the order he listed them. */
export const DISTRIBUTOR_CHOICES = ["LCSC", "Digikey", "Mouser", "Unikey", "Element14"] as const;

export const DISTRIBUTOR_OTHER = "Other";

export type DistributorChoice = (typeof DISTRIBUTOR_CHOICES)[number] | typeof DISTRIBUTOR_OTHER | "";

export interface DistributorSelection {
  /** "" = not set. */
  choice: DistributorChoice;
  /** Only meaningful when `choice` is "Other". */
  other: string;
}

/**
 * Splits a stored value into the dropdown + text box the form shows.
 * Matching is case-insensitive so `digikey`, `DigiKey` and `Digikey` all land on
 * the same option instead of falling through to Other.
 */
export function splitDistributor(stored: string | null | undefined): DistributorSelection {
  const text = (stored ?? "").trim();
  if (text === "") return { choice: "", other: "" };

  const known = DISTRIBUTOR_CHOICES.find((d) => d.toLowerCase() === text.toLowerCase());
  if (known) return { choice: known, other: "" };

  return { choice: DISTRIBUTOR_OTHER, other: text };
}

/** The value to store. `null` clears the field. */
export function joinDistributor(selection: DistributorSelection): string | null {
  if (selection.choice === "") return null;
  if (selection.choice !== DISTRIBUTOR_OTHER) return selection.choice;
  const other = selection.other.trim();
  return other === "" ? null : other;
}
