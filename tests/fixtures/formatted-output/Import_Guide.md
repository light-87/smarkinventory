# Inventory Import Guide

This folder contains the electronics stock list (`Stock List.xlsx`) reshaped into
**30 category CSV files**, one per component/product type, ready to import into the
inventory platform. This guide explains the column structure, what each field means,
how filtering should be implemented per field type, and known data-quality caveats to
watch for during import.

*Last updated 2026-08-11, after a rebuild that fixed a root-cause merge-cell parsing bug
(recovered most previously-blank values), split resistor-network/array parts and ferrite
beads into their own files, and moved varistor rows out of the resistor tables. Connectors/
terminal-blocks/FFC-FPC/cable-assemblies are temporarily removed pending rework — see
section 4.*

All files are UTF-8 (with BOM) — this preserves special characters like `Ω`, `µ`, `℃`
correctly. Open them in Excel/Sheets/your import tool as UTF-8, not ANSI/Windows-1252,
or those symbols will show as garbled text.

---

## 1. Columns every file shares

Every file (except `stencils.csv`, see note below) ends with the same trailing columns:

| Column | Meaning |
|---|---|
| `MPN` | Manufacturer Part Number, or the closest available part identifier. See **MPN rules** below — it's not always a strict "manufacturer" part number. **Deliberately left blank** in `misc_lcd_display.csv`, `misc_battery.csv`, `misc_relay.csv`, `misc_transformer.csv` — see the note under MPN rules. |
| `Description` | Freeform text. Populated with real data where the source sheet had one (ICs, fuses, crystals, LEDs, switches, resistor-network pin-count notes, capacitor dielectric/type text, ferrite bead specs, and the 4 files noted above, etc.); left blank where the source genuinely had nothing extra to record, or where the same text already lives in a differently-named column (e.g. `diodes.csv` → `Diode_Type`, `modules.csv` → `Module_Name`) — safe to treat as a free-text field the team can fill in later where blank. |
| `Distributor` | Normalized to `Digikey`, `Mouser`, `Element14`, or `LCSC` when recognized; otherwise the source's own label (e.g. `Robu`, `RS`, `Arrow`) is kept as-is. `Shenzhen`/`Chinese`/`Shenzen` (typo in source) are all normalized to `China`. Blank if unknown. |
| `LCSC_Part` | Only populated when the code genuinely looks like an LCSC catalog number (`C` followed by digits, e.g. `C105882`). Never contains a Digikey/Mouser/element14/RS code. |
| `Qty_In_Stock` | Quantity on hand, as entered in the source sheet. Occasionally a text value instead of a number (e.g. `"16 strip"`) if that's what the original sheet had. |
| `Source_Sheet` | Which tab of `Stock List.xlsx` this row came from. **Internal reference only — do NOT import this column into the inventory tool.** |
| `Source_Row` | The exact row number in that tab. **Internal reference only — do NOT import this column into the inventory tool.** |

> **`Source_Sheet`/`Source_Row` are not inventory data.** They exist purely so we (or
> anyone auditing this export) can trace a row back to its exact cell in
> `Stock List.xlsx` while building/QA-ing these CSVs. They carry no meaning for an end
> user of the inventory platform and should be dropped at import time — don't create
> fields for them in the tool, and don't expose them as filters (see the Filter
> Specification doc).

`stencils.csv` is the one exception — it's PCB project/version tracking, not a parts
list, so it has no `MPN`/`Distributor`/`LCSC_Part`/`Qty_In_Stock` (nothing in the
source maps to those concepts there).

### MPN rules
- If the source sheet had its own manufacturer part number column, that value is used directly.
- If not, but there was a non-LCSC code sitting in a distributor/order-code column that
  looks like a genuine part number (not a distributor SKU), it gets promoted into `MPN`.
  A code is treated as a distributor SKU (and *not* promoted) if it's pure digits, ends in `-ND`
  (Digikey's suffix), or starts with a short digit-dash prefix (Mouser/Digikey catalog style,
  e.g. `649-...`).
- Left blank if nothing usable was found. **Don't assume a blank MPN means "no part" —
  many passive components (generic resistors/capacitors) never had a manufacturer part
  number in the source sheet at all**, only value/package/tolerance.
- **Exception**: in `misc_lcd_display.csv`, `misc_battery.csv`, `misc_relay.csv`, and
  `misc_transformer.csv`, the source column that would normally feed `MPN` is genuinely
  headed "Description" in the sheet and mixes real part numbers (e.g. `HF46F/5-HS1`) with
  generic labels (e.g. `"Relay"`, `"20 X 4"`) with no reliable way to tell them apart — by
  request, that text goes into `Description` only for these 4 files, and `MPN` is always
  blank there, even on rows where the text happens to be a real part number.

### Distributor caveat
A handful of rows (mostly in `ic_smd.csv`) have a **manufacturer name** (e.g. `ANALOG DEVICES`,
`SPMICRO`, `FTDI`) sitting in the `Distributor` column instead of an actual distributor —
this is how the original spreadsheet author filled it in for those specific rows, not a
processing error. If exact distributor accuracy matters for a given row, cross-check
against `Source_Row`.

---

## 2. Filter design guidance

This is the part that matters most for making the catalog actually filterable, matching
how sites like Digikey/Mouser let you filter parts. This section covers the general
patterns; for the exact filter type to use on every single column in every file, see
**`Filter_Specification.md`** in this same folder — it's the authoritative, column-by-column
spec built directly from the actual data (cardinality, caveats, etc.), meant to be
implemented as-is.

### Numeric engineering values → Min/Max range filter + unit dropdown
Three fields are stored as **plain numbers in the base SI unit**, specifically so they can
power a proper range filter:

| Column | File | Base unit |
|---|---|---|
| `Resistance_Ohms` | resistors.csv, resistor_networks.csv | Ohms (Ω) |
| `Capacitance_Farads` | capacitors.csv | Farads (F) |
| `Inductance_Henries` | inductors.csv | Henries (H) |

`ferrites.csv` deliberately has **no** numeric filter column — ferrite beads are rated by
impedance-at-frequency plus current plus DCR all mixed into one free-text spec (e.g.
`"30Ω @ 100MHz 4A 14mΩ"`), and the formats aren't consistent enough across rows to split
into reliable numeric columns. Treat `Description` there as search-only (see below).

**Do not filter directly against these raw numbers in the UI** — `0.0000001` is unreadable.
Build the filter the way Digikey does: a Min box, a Max box, and a unit dropdown
(e.g. pF / nF / µF for capacitance; Ω / kΩ / MΩ for resistance). When the user picks a
unit and types a value, multiply by that unit's power-of-ten factor *before* comparing
against the stored base-unit column:

```
p = ×10⁻¹²   n = ×10⁻⁹   µ = ×10⁻⁶   m = ×10⁻³   (base) = ×1   k = ×10³   M = ×10⁶   G = ×10⁹
```

For **display** in the results table/list, use the `Value_Display` column instead
(present alongside every one of these — e.g. `4.7 kΩ`, `100 nF`) — it's already
formatted in clean engineering notation, so you don't need to reformat the raw number
yourselves.

### Categorical / dropdown filters
These should be single- or multi-select dropdowns, built from the distinct values
present in each column (query `SELECT DISTINCT` after import to populate the dropdown
options — don't hardcode a list, since it varies per category):

- `Distributor` — every file
- `Package` / `Package_Size` — resistors, resistor_networks, capacitors, diodes, inductors, ferrites, misc_fuse/crystal/led/thermistor
- `Mount_Type` (`SMD` / `TH`) — resistors, resistor_networks, capacitors, diodes
- `Tolerance_Percent` — resistors, capacitors (always blank on resistor_networks — not in source data)
- `Sub_Category` — ic_smd.csv (37 distinct values: ADC, DAC, Comparator, EEPROM, etc.)
- `Type` — voltage_protector.csv (free-text category label, treat as a filterable tag rather than a strict enum since it's hand-typed)

### Text search fields
`MPN`, `Description`, `Value_Display`, `Diode_Type`, `Module_Name` — these should just be
plain search-box (contains/starts-with) fields, not dropdowns; too many distinct values
for a dropdown to be useful. This is the primary/only useful filter field on `ferrites.csv`
(via `Description`), since it has no numeric or dropdown-friendly columns of its own.

### Range filters (non-engineering-unit numbers)
`Qty_In_Stock` and `Current_Rating`/`Voltage_Rating`/`Power_Watts` (where present) are
useful as simple numeric range filters too, but note the rating fields are stored as the
**original text** (e.g. `"140mA"`, `"1A/40V"`) rather than parsed numbers — they weren't
normalized the way resistance/capacitance/inductance were, since the source text mixes
multiple specs per cell inconsistently (e.g. diode `Rating` = `"1A/40V"` combining current
+ voltage). If range filtering on these becomes a priority later, they'd need the same
kind of parsing treatment as the three engineering-value columns above.

---

## 3. File-by-file reference

| File | Category | Rows | Category-specific columns |
|---|---|---:|---|
| `resistors.csv` | Resistors | 425 | `Mount_Type`, `Resistance_Ohms`, `Value_Display`, `Tolerance_Percent`, `Power_Watts`, `Package`, `PPM` (always blank — not in source data) |
| `resistor_networks.csv` | Resistor networks / arrays (multi-pin SMD/TH packs) | 23 | Same columns as `resistors.csv`. `Description` carries the pin-count/network note (e.g. `"9P N/W"`) split out of the value cell |
| `capacitors.csv` | Capacitors | 277 | `Mount_Type`, `Capacitance_Farads`, `Value_Display`, `Voltage_Rating`, `Tolerance_Percent`, `Package`, `Color`, `Manufacturer` |
| `inductors.csv` | Inductors | 79 | `Inductance_Henries`, `Value_Display`, `Current_Rating`, `Package_Size`, `Manufacturer` |
| `ferrites.csv` | Ferrite beads (impedance-rated, split out of Inductors) | 7 | `Current_Rating`, `Package_Size`, `Manufacturer` — no numeric value column, see filter guidance above |
| `diodes.csv` | Diodes (SMD + TH) | 136 | `Diode_Type`, `Rating`, `Package`, `Mount_Type`, `Manufacturer` |
| `ic_smd.csv` | SMD ICs | 505 | `Sub_Category` (ADC, DAC, Comparator, etc.), `Manufacturer`, `Package`, `Project` |
| `ic_th.csv` | Through-hole ICs | 32 | `Package` (always blank — not in source data) |
| `discrete_semiconductors_th.csv` | TH transistors/regulators | 2 | — |
| `modules.csv` | SMD modules & sensors | 54 | `Module_Name` |
| `misc_fuse.csv` | Fuses / PTC resettable fuses | 24 | `Current_Rating`, `Package` |
| `misc_crystal.csv` | Crystals / oscillators | 17 | `Package` |
| `misc_led.csv` | LEDs | 32 | `Package` |
| `misc_thermistor_varistor.csv` | Thermistors / varistors / MOV (incl. 2 varistor rows moved out of the resistor tables) | 12 | `Rating`, `Package` |
| `misc_ir.csv` | Infrared LEDs/receivers | 3 | — |
| `misc_photosensor.csv` | Photosensors | 1 | — |
| `dev_kits.csv` | Dev boards/kits | 8 | — |
| `misc_switch.csv` | Switches (incl. potentiometers, float switches) | 30 | — |
| `misc_current_transformer.csv` | Current transformers (incl. temp sensors) | 2 | — |
| `misc_dcdc_converter.csv` | DC-DC converters | 1 | — |
| `misc_rocker_switch.csv` | Rocker switches | 4 | — |
| `misc_lcd_display.csv` | LCD displays | 2 | `MPN` always blank — see MPN rules exception above |
| `misc_oled_display.csv` | OLED displays | 5 | — |
| `misc_battery.csv` | Batteries (incl. 1 antenna item) | 4 | `Rating`; `MPN` always blank — see MPN rules exception above |
| `misc_relay.csv` | Relays | 7 | `Voltage`, `Current`; `MPN` always blank — see MPN rules exception above |
| `misc_transformer.csv` | Transformers / bobbins / coil parts | 8 | `Voltage`, `Current`; `MPN` always blank — see MPN rules exception above |
| `material_list.csv` | Battery holders, hardware, antennas | 31 | `Group`, `Value`, `CP`, `SP_MOQ100`, `SP_MOQ25` (pricing tiers, not distributor pricing) |
| `smps.csv` | Finished SMPS power modules | 10 | `Output_Spec`, `Dimension`, `Height`, `Status`, `Updated_On` |
| `voltage_protector.csv` | Adjustable voltage protectors | 4 | `Type` |
| `stencils.csv` | PCB project/version reference (not stock) | 43 | `Project`, `Board`, `Versions` — no `MPN`/`Distributor`/`Qty_In_Stock` |

**Not currently in this folder**: `connectors.csv`, `spring_terminal_blocks.csv`,
`ffc_fpc_connectors.csv`, `cable_assemblies.csv` were removed pending a rework — see
section 4.

---

## 4. Known limitations / things to spot-check

- **Connectors are temporarily removed.** `connectors.csv`, `spring_terminal_blocks.csv`,
  `ffc_fpc_connectors.csv`, and `cable_assemblies.csv` existed in an earlier version of
  this folder but have been pulled pending a rework: the source sheet's "Green Connector"
  sub-block uses a genuinely different 3-level column layout than the rest of the
  connectors table (a category label, a product family, and a variant, vs. the usual
  Type+MPN pair elsewhere), which the old extraction mapped incorrectly — it dropped the
  category label entirely and mislabeled a variant string as `MPN`. There's also an open
  decision on whether these four should stay separate or merge into one unified
  connectors file. Ask if you need this data before it's back.
- **A root-cause bug in the conversion script was found and fixed** (2026-08-11): merged
  cells in the source spreadsheet (e.g. one "0R" value cell spanning several package-size
  rows below it) weren't propagating due to an off-by-one row-indexing bug, which is why
  earlier exports of this folder had far more blank `Resistance_Ohms`/`Capacitance_Farads`/
  `Inductance_Henries` cells than the source data actually justified. If you're comparing
  against an older copy of these CSVs, expect many previously-blank rows to now be filled in.
- **`smps.csv`** only contains the 10 rows that are genuinely finished, sellable SMPS
  modules. The source "SMPS" tab also has a large embedded table (~130 rows) tracking
  spare parts used *inside* those boards (resistor/capacitor values, restock dates) —
  that's a fundamentally different kind of data (a repair BOM, not sellable stock) and was
  intentionally left out. Say the word if you want that pulled into its own file too.
- **A few one-off rows** across the sheet had columns typed in the wrong cell by whoever
  maintained the original spreadsheet (e.g. an LCSC code typed into the "Distributor" cell
  instead of "LCSC"). Common patterns like that were caught and corrected automatically;
  rarer ones may still show an odd value — `Source_Sheet`/`Source_Row` let you jump back
  to the original to verify anything that looks off.
- **Blank fields mean "no data in the source,"** not zero — don't default blanks to 0 or
  "N/A" on import; leave them null so filters correctly exclude/include them.
- `category_index.csv` in this same folder lists every file with its row count and source
  tab in one place — useful as a quick manifest when wiring up the import script.
- `Filter_Specification.md` in this same folder is the detailed, per-file filter design —
  use it, not this section, when actually building the filter UI.
