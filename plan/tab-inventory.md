# Inventory (list + deep filter)

**Route:** `#/inventory` · **Spec:** FEATURES.md §9 (deep filter) · **Prototype:** `isInventory`.

## 1. Purpose (baseline)

Find any of ~2000 parts fast: full-text search + faceted filters over the typed columns and
attributes; row click opens the part drawer.

## 2. Current behaviour (as prototyped)

- **Facet sidebar (desktop):** collapsible groups — Category, Package, Stock (In stock/Low/Out),
  Status (active/nrnd/eol), plus Dielectric, Distributor, Project, Shelf. Checkbox values show live
  counts computed against the currently filtered set; "Clear all".
- **Search field:** matches PID, MPN, value, package, category, manufacturer, LCSC PN.
- **Active filter chips** under the search box, removable one by one; result count label.
- **Table columns:** PID · MPN · Value · Package · Category · Qty (pill; orange when low/out) ·
  Location (`Shelf B · Box B-12`) · Status. Left tick border colors by stock state. Row click →
  part drawer (`#/part/:pid`).
- Mobile: sidebar hidden (facets not reachable — accepted prototype gap), table scrolls.

## 3. Data touched

| Read | Write |
|---|---|
| `smark_parts` (typed facets + attributes jsonb + total_qty), `smark_stock_locations` (location column), facet counts | — |

## 4. Talks to (edges)

- Row → **Part detail** drawer (A2-14).
- Stock facet logic shared with Dashboard stats + Shelves low dots (single `stockState`).
- Project facet ← projects a part was used in (movement/pick history).
- Distributor facet ← the part's order history (living record).

## 5. Round-2 changes

### R2-11 (ripple) — optional price column 🟢
Table gains an optional **Price** column (last unit price; hidden by default on mobile widths).
Not explicitly asked — flag to client before build; the asked-for surfaces are Dashboard value +
per-part price (part detail).

### R2-24 — Voltage as a separate field 🟢
**V (voltage)** becomes its own table column + facet group (was embedded in the value string,
`0.1µF/50V`). Schema: promoted `smark_parts.voltage` typed column; Stock-List import and BOM
reconcile split combined value strings (`0.1µF/50V` → value `0.1µF`, voltage `50V`); facet counts
like any other group. *(Interpreted "the field for V" = voltage — flag if wrong.)*

### R2-33 (ripple) — export 🟢
**Export** button: current filtered view → CSV/xlsx (all columns incl. price, location, voltage).

## 6. Open questions on this tab

*(none yet)*
