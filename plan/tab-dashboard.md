# Dashboard

**Route:** `#/dashboard` · **Spec:** FEATURES.md §9 · **Prototype:** `isDashboard` block.

## 1. Purpose (baseline)

One-glance health: how much stock, what's low/out, what's on order, what moved today, what the AI is
doing, which projects consume parts.

## 2. Current behaviour (as prototyped)

- **Stat cards (6):** Units in stock · Distinct SKUs · Low stock (orange) · Out of stock (orange) ·
  On order · Movements today. Values computed live from parts + on-order state.
- **Recent movements list:** time · PID · ±delta chip (green/red border) · reason (`pick ·
  TMCS_96x32`, `receive · LCSC`) · box chip.
- **Agent activity card:** currently-running run (name, detail, progress bar, orange border) + last
  completed run (name, detail).
- **Usage by project:** horizontal bars (Power Breezer, DAQ, TMCS…, count of part types used).
- Responsive: stat grid collapses on mobile; two-column body → single column.

## 3. Data touched

| Read | Write |
|---|---|
| `smark_parts` (total_qty, reorder_point), `smark_movements` (today feed), `smark_order_lines` (on-order count), `smark_agent_runs` (running/last), project usage rollup | — (read-only screen) |

## 4. Talks to (edges)

- Consumes every mutation made by Scan / Bulk pick / Receive (movements + qty) — A2-7, A2-12.
- Agent-activity card mirrors **Agent run** state; deep-link target = the run's project (A2-15).
- Low/out counts must agree with Inventory's Stock facet and Shelves' low dots (same
  `stockState` rule: 0 = out, ≤ reorder_point = low).

## 5. Round-2 changes

### R2-11 — Inventory value stat 🟢
New stat card **"Inventory value ₹"** = Σ(part `total_qty` × `last_unit_price`) — parts without a
price excluded + a small "N parts unpriced" sub-label so the number is honest. Stat grid grows to 7
cards (layout reflows; mobile stacks).

### R2-07 (ripple) — link to Daily Reports 🟢
"Movements today" card header gains **"today's report →"** link → `#/daily`. No data duplication:
dashboard stays the at-a-glance summary; the per-person/per-day audit lives in Daily Reports.

## 6. Open questions on this tab

- Unpriced parts: exclude from value (default) vs estimate — confirm once prices start flowing.
