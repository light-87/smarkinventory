# Bulk Takeout (was "Bulk Pick") — from a BOM

**Route:** `#/pick` (label renamed, R2-26) · **Spec:** FEATURES.md §8 (bulk pick) ·
**Prototype:** `isPick`.

> **R2-26:** display name is **"Bulk takeout"** everywhere (rail, mobile More sheet, screen title,
> "Finish takeout" button). Internal keys (`bulk_pick` movement reason, route) unchanged.

## 1. Purpose (baseline)

Take a full BOM's worth of parts out in one pass: upload → every line resolved to its physical spot →
walk the rack checking lines off → one confirm logs all movements.

## 2. Current behaviour (as prototyped)

- **Empty state:** drop/upload zone + sample buttons (GCU_V1.1, TMCS_96x32).
- **Loaded:** progress bar `checked/total` + table: checkbox (in-stock lines only) · Reference · Pick
  qty · Value · **Location chip** (`Shelf B · Box B-12`) for in-stock lines, or orange **"To order →"**
  chip for missing lines (deep-links to Orders).
- Checked rows fade (opacity) — a live done-list while walking the rack.
- **Finish pick:** toasts "movements logged"; each checked line = a movement `reason=bulk_pick`
  linked to the BOM.

## 3. Data touched

| Read | Write |
|---|---|
| BOM lines (parsed upload), part match + locations | `smark_movements` (bulk_pick, bom_id), qty decrements, rollups |

## 4. Talks to (edges)

- Line resolution reuses the Orders reconcile ladder (MPN → LCSC → value+package) — keep ONE matcher.
- "To order →" → **Orders** tab with the unresolved lines (A2-12).
- Finish → Dashboard movements, Inventory/Shelves/Part detail qty (A2-7 chain).
- Undo story: prototype has none post-finish — real app spec: movements are individually reversible
  (`undo_of`), surfaced via Part detail / movement feed.

## 5. Round-2 changes

### R2-03 (ripple) — pick from a project's named BOM 🟢
Empty state gains "Pick a project BOM" — project → named BOM picker (reuses the uploaded
`smark_boms` rows) alongside the existing ad-hoc upload. Movements then link `bom_id` as before,
which now implies project attribution for the dashboard's usage-by-project.

### R2-26 — Renamed "Bulk takeout" 🟢
Labels only (see header note).

### R2-27 (ripple) — build quantity multiplies takeout amounts 🟢
When taking out a project BOM with `build_qty > 1`, the Pick column shows **line qty × build qty**
(a "×10 builds" banner at top, adjustable before starting). Ad-hoc uploads keep an optional ×N
input. Stock checks + to-order links use the multiplied need.

## 6. Open questions on this tab

*(none yet)*
