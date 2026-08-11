# Filter Specification — Per-Category Filter Design

This is the authoritative, column-by-column filter spec for every CSV in this folder,
meant to be implemented directly — no re-deriving needed. It supersedes/expands on the
general "Filter design guidance" section in `Import_Guide.md`; that doc still has the
underlying unit-conversion math for range filters, referenced below rather than repeated.

Built by inspecting the actual distinct-value counts and content of every column across
all 30 files (2026-08-11), not guessed from column names — cardinality and caveats noted
per column come from the real data.

---

## 0. Filter type legend

| Type | UI pattern | Use when |
|---|---|---|
| **Range** | Min box + Max box (+ unit dropdown for engineering values) | Column is a true numeric quantity with a meaningful min/max, and values are already parsed into a clean base-unit number |
| **Dropdown (single)** | Plain `<select>`, one choice at a time | Low cardinality (roughly ≤15 distinct values), values are mutually exclusive per row |
| **Dropdown (multi)** | Checkbox list or multi-select | Low-to-medium cardinality, user plausibly wants "resistors OR capacitors of these 3 packages" |
| **Typeahead / searchable dropdown** | Multi-select with a search-as-you-type box | Medium-to-high cardinality (15+ distinct values) where a plain scrollable list is unusable, but the values are still a closed-ish set worth offering as suggestions |
| **Text search** | Plain search box, contains/starts-with | High cardinality, effectively free text (part numbers, descriptions) |
| **Toggle** | On/off switch or pill | Binary/near-binary state, framed as a yes/no question (e.g. "In stock only") |
| **Excluded** | Not shown in the filter UI at all | Internal/traceability fields, or columns confirmed to carry no usable filter value |

Populate every dropdown/typeahead's option list from `SELECT DISTINCT` on the actual
imported data, not a hardcoded list — several of the value sets below will drift as the
underlying spreadsheet is updated.

---

## 1. Global filters — apply the same way on every file that has the column

| Column | Filter Type | Notes |
|---|---|---|
| `MPN` | Text search | Free text, extremely high cardinality everywhere. |
| `Description` | Text search | Same — see `Import_Guide.md` §1 for which files actually populate it. |
| `Distributor` | Dropdown (multi) | Cardinality is low almost everywhere (2–14 distinct values per file, `ic_smd.csv` is the high end at 14). Safe as a straightforward multi-select checkbox list per file. |
| `LCSC_Part` | Text search (exact-match friendly) | Users look this up to confirm a specific part, not to browse — a search box that also matches on exact string works better than "contains." |
| `Qty_In_Stock` | Range **+** a companion `In stock` **Toggle** | Range for power users; add a one-click "In stock only" toggle (`Qty_In_Stock > 0`) as the fast path — most searches will just want that. Note some rows store this as text (e.g. `"16 strip"`, `"15Mtr"`) instead of a plain number — range filtering on those rows will need to either parse the leading number or exclude non-numeric rows from the range comparison (don't crash/error on them). |
| `Source_Sheet`, `Source_Row` | **Excluded** | Internal build/QA traceability only. **Do not import these columns into the tool at all**, and do not expose them as filters or as visible fields — see `Import_Guide.md` §1. |

Every per-file table below lists **only the columns specific to that file** — assume the
row above applies in addition, wherever that column is present in the file.

---

## 2. Per-file filter tables

### `resistors.csv` (425 rows) / `resistor_networks.csv` (23 rows)
Identical schema — filter them identically (or as one combined "Resistors" filter set if
your UI lets users pick both files as one search scope).

| Column | Filter Type | Notes |
|---|---|---|
| `Resistance_Ohms` | **Range**, unit dropdown Ω/kΩ/MΩ | Base unit Ohms. See `Import_Guide.md` §2 for the unit-multiplier table. Display with `Value_Display`, not this raw column. |
| `Mount_Type` | Toggle/2-way pill (`SMD` / `TH`) | Only 2 values, always populated — a toggle reads cleaner than a dropdown here. |
| `Tolerance_Percent` | Dropdown (single or multi) | Only 5 distinct values in the data (`0.5`, `1.0`, `5.0`, `10.0`, `50.0`) — treat as fixed tolerance classes (±1%, ±5%, etc.), not a range slider. Only populated on ~15% of rows; the `50.0` value is unusual for a resistor tolerance — worth a spot-check via `Source_Row` if it looks wrong to your team, but shipping as-is since it's what the source has. Always blank on `resistor_networks.csv` (not in source data for those rows) — omit this filter there or show it disabled. |
| `Power_Watts` | Text search only (not range) | Stored as original text (`"0.25W"`, `"1/4W"`, `"0.125w"` — inconsistent capitalization/format), not a parsed number. Don't build a range filter against it without normalizing first. |
| `Package` | Dropdown (multi) | Low cardinality: 9 distinct on resistors.csv, 4 on resistor_networks.csv. |
| `PPM` | **Excluded** | Always blank — not in source data. Don't build a filter for it. |

### `capacitors.csv` (277 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Capacitance_Farads` | **Range**, unit dropdown pF/nF/µF | Base unit Farads. |
| `Mount_Type` | Toggle/2-way pill (`SMD` / `TH`) | Same as resistors. |
| `Voltage_Rating` | Text search only (not range) | Original text (e.g. `"50V"`, `"16V"`), not parsed. Only ~4% blank though, so worth having as a search field even without a range. |
| `Tolerance_Percent` | **Excluded** | Column exists in the schema but is **always blank on every row** — the extraction never populates it for capacitors (unlike resistors). Don't offer this filter for capacitors at all; showing an always-empty filter is worse than not showing one. |
| `Package` | Typeahead | 29 distinct values — too many for a flat dropdown, use searchable multi-select. |
| `Color` | **Caveat — reconsider before using as-is** | The source column is literally headed "COLOUR" but the data in it is physical case dimensions (`"6.3 x 5.8 mm"`, `"10x10.2mm"`, etc.), not color names — a data-entry mismatch in the *original* spreadsheet, not a script issue. Don't build a color-swatch picker; if you want this filterable, treat it as a free-text/dimension field (rename the UI label to something like "Case Size" rather than "Color") or drop it from the filter UI until confirmed useful. |
| `Manufacturer` | **Excluded** | Only 1 non-blank value in the whole file (`PANASONIC/Semtech`) — not enough data to be a useful filter yet. |

### `inductors.csv` (79 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Inductance_Henries` | **Range**, unit dropdown nH/µH/mH | Base unit Henries. |
| `Current_Rating` | Text search only (not range) | Original text, often compound (e.g. `"1.1A 280mΩ"` mixing current + DCR in one cell). |
| `Package_Size` | Typeahead | 45 distinct values (dimension strings like `"10x10 mm"`) — searchable multi-select, not a flat dropdown. |
| `Manufacturer` | Dropdown (multi) | 6 distinct values, but only populated on 7 of 79 rows — low value as a primary filter, fine as a secondary one. |

### `ferrites.csv` (7 rows)

| Column | Filter Type | Notes |
|---|---|---|
| — | — | **No numeric value filter exists for this file by design.** Ferrite specs (impedance @ frequency, current, DCR) are all mixed into one free-text `Description` (e.g. `"30Ω @ 100MHz 4A 14mΩ"`) with inconsistent formatting across rows — not split into columns. Rely on `Description` text search as the primary filter. |
| `Current_Rating` | Text search only | Same caveat as inductors — original text, not parsed. |
| `Package_Size` | Dropdown (multi) | Only 4 distinct values, small file — plain dropdown is fine. |
| `Manufacturer` | **Excluded** | Only 1 non-blank value across 7 rows. |

### `diodes.csv` (136 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Diode_Type` | Text search | This is where the descriptive text actually lives for this file (not `Description`, which is always blank here — see `Import_Guide.md` §1). Only ~72% populated; genuine source gap on the rest. |
| `Rating` | Text search only (not range) | Compound text, e.g. `"1A/40V"` mixes current + voltage in one cell — don't attempt a range filter without normalizing first. |
| `Package` | Typeahead | 30 distinct values. |
| `Mount_Type` | Toggle/2-way pill (`SMD` / `TH`) | |
| `Manufacturer` | Dropdown (multi) | 12 distinct, but only ~15% of rows populated — secondary filter, not primary. |

### `ic_smd.csv` (505 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Sub_Category` | **Dropdown (multi) — primary filter for this file** | 37 clean distinct values (ADC, DAC, Comparator, EEPROM, Battery Management, CAN, etc.), populated on every row. This should be the headline filter for ICs, the way "chip type" is on Digikey. |
| `Package` | Typeahead | 186 distinct values — must be searchable, not a flat list. Only ~80% populated. |
| `Manufacturer` | Typeahead, with a data-quality caveat | 104 distinct values, but several are clearly not manufacturer names (e.g. `"1 -desoldered"`, `"36V, LOW-RON, 2:1 (SPDT) TWO-CHA"` — spec text or notes that ended up in this column in the source). Usable as a rough filter but expect some noise in the option list; not worth cleaning up unless it becomes a real pain point. |
| `Project` | Dropdown (multi) | Only 3 distinct values and 5 populated rows — low value, optional/secondary filter. |

### `ic_th.csv` (32 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Package` | **Excluded** | Confirmed 100% blank across all 32 rows in the *source* data (not a parsing gap) — don't build this filter. |

*(`Description` here is populated from the sheet's own "WORKING" column, ~16% of rows — treat via the global text-search rule.)*

### `discrete_semiconductors_th.csv` (2 rows)
Only the global columns apply — too few rows (2) to warrant category-specific filters.

### `modules.csv` (54 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Module_Name` | Text search | This is effectively the description field for this file — free text, often quite specific (e.g. "3-axis Electronic Compass Module Magnetic Field Sensor"). `Description` itself is always blank here (see `Import_Guide.md` §1) — don't build a separate filter for it. |

### `misc_fuse.csv` (24 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Current_Rating` | Text search only (not range) | Original text. |
| `Package` | Dropdown (multi) | 7 distinct values. |

### `misc_crystal.csv` (17 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Package` | Dropdown (multi) | 9 distinct values. |

### `misc_led.csv` (32 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Package` | Dropdown (multi) | 11 distinct values. |

### `misc_thermistor_varistor.csv` (12 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Rating` | Text search only (not range) | Compound text (voltage/current/energy mixed per row for the varistor entries, e.g. `"420V 840V 6KA"`). |
| `Package` | Dropdown (multi) | 6 distinct values. |

### `misc_ir.csv`, `misc_photosensor.csv`, `dev_kits.csv`, `misc_switch.csv`, `misc_current_transformer.csv`, `misc_dcdc_converter.csv`, `misc_rocker_switch.csv`, `misc_oled_display.csv`
Only the global columns apply (MPN/Description search, Distributor, Qty_In_Stock) — no
category-specific columns beyond those, and row counts are small enough (1–30 rows each)
that dedicated filters wouldn't add much value.

### `misc_lcd_display.csv` (2 rows), `misc_battery.csv` (4 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `MPN` | **Excluded (always blank)** | Per the MPN-rules exception in `Import_Guide.md` §1 — the identifying text lives in `Description` instead for these files. Don't show an MPN filter/field for these two files. |
| `Rating` (`misc_battery.csv` only) | Dropdown (multi) | Small set of voltage ratings (`"3V"`, `"9V"`). |

### `misc_relay.csv` (7 rows), `misc_transformer.csv` (8 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `MPN` | **Excluded (always blank)** | Same exception as above — see `Import_Guide.md` §1. |
| `Voltage`, `Current` | Text search only (not range) | Compound/inconsistent text (e.g. `"7A,250V AC"`, `"15V/0.7A"`) — not parsed numbers. |

### `material_list.csv` (31 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Group` | Dropdown (multi) | 6 distinct values (`18650 Battery Holders`, `Antenna`, `Hardware`, `SIM/SD Card Holder`, etc.) — good primary filter for this file. |
| `Value` | Text search | Free text, sparsely populated. |
| `CP`, `SP_MOQ100`, `SP_MOQ25` | Range (numeric) | These are genuinely numeric (cost price / selling price at MOQ 100 / selling price at MOQ 25, based on column position in source) — safe to range-filter as-is. Confirm the exact business meaning of each with whoever owns pricing before labeling them in the UI, since the source sheet's own header only says "SP" without fully spelling out the MOQ tiers. |

### `smps.csv` (10 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Output_Spec` | Text search | Free text (e.g. `"5V 700mA"`). |
| `Dimension`, `Height` | Text search only (not range) | Original text/dimension strings, not parsed numbers. |
| `Status` | Dropdown (single) | Only 2 distinct values (`"Ready to ship"`, `"incomplete"`) — good candidate for a toggle instead of a dropdown if the UI prefers that. |
| `Updated_On` | **Date range** | This is the one column across the whole dataset that's an actual date (ISO format `YYYY-MM-DD`) — use a real date-range picker, not a text/numeric range. |

### `voltage_protector.csv` (4 rows)

| Column | Filter Type | Notes |
|---|---|---|
| `Type` | Dropdown (single) | 4 distinct values, all populated — small enough that a plain dropdown is fine. |

### `stencils.csv` (43 rows)
This file has no `MPN`/`Distributor`/`LCSC_Part`/`Qty_In_Stock` at all (not a parts list —
see `Import_Guide.md` §1), so **none of the global filters in §1 apply here**. Its own
columns:

| Column | Filter Type | Notes |
|---|---|---|
| `Project` | Dropdown (multi) — **primary filter for this file** | 14 distinct values, populated on ~98% of rows. |
| `Board` | Typeahead | Board names per project — moderate cardinality, pair with the `Project` filter (cascading: pick a project, then see its boards). |
| `Versions` | Text search | Comma-separated version list per row (e.g. `"V1, V2.1, V2.2"`) — a simple "contains" search is more useful here than trying to split it into a real multi-select. |

---

## 3. Suggested filter UI priority (if you can't build all of them at once)

Highest-value filters to build first, based on cardinality/population quality across the
whole dataset:

1. **Distributor** (global, clean data everywhere)
2. **Resistance_Ohms / Capacitance_Farads / Inductance_Henries** range filters (the whole
   point of normalizing these — see `Import_Guide.md` §2 for the math)
3. **Sub_Category** on `ic_smd.csv` (clean, high-value, largest file at 505 rows)
4. **Package** typeahead on resistors/capacitors/inductors/diodes/ic_smd
5. **MPN/Description/Module_Name** text search everywhere it's populated
6. **In stock** toggle (global convenience filter on `Qty_In_Stock`)

Lower priority / defer: anything marked **Excluded** above, and any "Text search only
(not range)" field until there's appetite to invest in parsing those compound text
columns the same way the three engineering-value columns were parsed.
