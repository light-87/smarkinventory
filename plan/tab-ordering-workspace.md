# Ordering Workspace (pre-run setup)

**Route:** `#/order/setup` · **Spec:** FEATURES.md §5.3–§5.4 · **Prototype:** `isOrderSetup`.

## 1. Purpose (baseline)

Everything the user decides *before* spending agent money: site order, plain-English priorities, see
the rules + memory the AI will use, pick the effort tier, then Run.

## 2. Current behaviour (as prototyped)

Stacked cards, in order:
1. **Distributor sequence** — drag-reorder rows (LCSC, Digikey, Mouser, Element14, Unikey), per-site
   on/off toggles, "+ Add site". Single sequence per BOM; saved onto the BOM; defaults from global
   preferences. Unikey defaults OFF.
2. **Priorities** — free textarea (prefilled from the sheet's Overall-priorities cell) + read-only
   list of per-line notes (`C4 — "LCSC only"`).
3. **AI Memory added as context** — version pill `v{N}`, "{count} approved rules for this order",
   first few rules with scope pills + "+N more" (read-only digest preview).
4. **Standard search rules** — read-only ladder (MPN → LCSC-only → Value → **Package (required)** →
   Status → Qty → Cost + any custom rules) · "change in Settings".
5. **Agents per item** — Economy / Balanced / Thorough segmented control + tier descriptions
   (maps to fanout/depth/per-site-cap; dry-run cost estimate lives here per spec).
6. **Run ordering →** → Agent run console.

## 3. Data touched

| Read | Write |
|---|---|
| BOM + lines (notes), `smark_distributor_preferences`, `smark_ordering_rules`, `smark_learned_rules_doc` (version + digest), tier presets | `smark_boms.distributor_sequence`, priorities text, run config on the new `smark_agent_runs` row |

## 4. Talks to (edges)

- ← **Orders** hands in project + BOM (A2-1); → **Agent run** consumes the full config (A2-2).
- Rules card mirrors **Settings** (read-only here, editable there) — A2-18.
- Memory card mirrors **AI Memory** active rules + version (A2-9).
- Per-site cap: hard safety cap overrides the tier knob (invariant from §5.6/§13).

## 5. Round-2 changes

### R2-03 (ripple) — scoped to a named BOM 🟢
Workspace header now shows **project · BOM name** (e.g. `Acme TMCS pilot · Mainboard v1.2`).
Distributor sequence, priorities, and tier are saved **per BOM** (was per project's single BOM —
structurally same `smark_boms` row, but a project now has many). Entry point = the BOM row's
"Set up ordering →" in the project hub.

### R2-27 — Build quantity field 🟢

New card (top of the workspace, before distributor sequence): **"Builds required"** — numeric
stepper, default 1, e.g. `10` = ordering values go 10×. Effects, all downstream:
- **Reconcile split recomputed:** need = line qty × build_qty; a line that was in-stock at ×1 can
  flip to to-order at ×10 (skip-buy checks stock ≥ multiplied need).
- **Agent plan:** min-qty per line = multiplied need; dry-run cost estimate scales.
- **Cart demand (R2-10):** `v_part_demand` uses qty × build_qty for this BOM's lines.
- **Bulk takeout (R2-26):** takeout quantities multiply the same way.
- Stored on `smark_boms.build_qty`; changing it after a run flags the saved run "stale — re-run
  recommended" (results were computed for the old quantity).

## 6. Open questions on this tab

*(none yet)*
