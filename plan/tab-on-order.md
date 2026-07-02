# Cart (was "On-order & Arrivals") — R2-09 rename + rework

**Route:** `#/on-order` → renamed `#/cart` (R2-09) · **Spec:** FEATURES.md §5.7 status walk ·
**Prototype:** `isOnOrder` (baseline below).

> **R2-09/R2-10/R2-12 reframe this tab:** stage 1 becomes a real **smart cart** (fed by review
> add-to-cart, auto-shortfall detection, and manual adds); checkout creates **one global purchase
> across all projects** with a required **PO number**; Ordered/Arrived tracking stays here below the
> cart. Old per-line "Mark ordered" flow is gone (removed from Review by R2-08).

## 1. Purpose (v2)

Everything between "we want it" and "it's on the shelf": collect needed items from every project in
one place, catch cross-project stock conflicts automatically, order it all at once under a PO,
track arrival.

## 2. Baseline (what the prototype had — kept for diff context)

Three status groups (To order / Ordered / Arrived), rows with PID·MPN·dist·qty, "Mark arrived"
button; lines created by Review's "Mark ordered". Toast on arrival branch (existing→no label,
new→print label). This survives as §3-C/D below; the "To order" group becomes the cart.

## 3. Planned behaviour (v2)

### A. Cart (R2-09) — stage 1
- **Cart line:** part (PID or new-part ref) · MPN · **demand breakdown** (`TMCS Mainboard 400 ·
  GCU rev B 200`) · available in stock · **qty to order** (editable, prefilled = shortfall or
  review qty) · chosen distributor + link (from review's selected option, changeable) · **unit
  price input** ("we will ask them to add price for it" — manual now, receipt-extract later fills
  gaps R2-12) · line source chip: `review` / `auto` / `manual` · remove.
- Lines **aggregate per part** across projects: same part demanded by 2 projects = ONE line with
  the breakdown, not two lines (client: "order the items for all the projects at once").
- **Manual add:** search any part → add with qty (covers non-BOM needs).

### B. Smart shortfall detection (R2-10) 🟡 Q-05
- Watches **combined demand across all active project BOMs vs available stock**. Example (client's):
  item A avail 500, project A needs 400, project B needs 200 → combined 600 > 500 → **auto cart
  line for the extra 100**, source `auto`, breakdown shown.
- Triggers: BOM reconcile, BOM upload/archive, stock movements, **build_qty changes (R2-27 — demand
  = line qty × build qty)** (recompute shortfall view).
- Auto lines are suggestions — user can bump qty up/down or dismiss. **Lifecycle FINAL (Q-05
  closed):** demand registers when an ACTIVE BOM is reconciled; released per-line by bulk takeout,
  arrival allocation, or project archive (R2-32); dismissed auto-lines resurrect only if the
  shortfall grows beyond the dismissed qty.
- In-stock-but-contested items also flagged back in each **project BOM view** ("500 avail but 600
  demanded across projects — 100 in cart").

### C. Checkout → orders grouped by distributor (R2-12, amended by Q-06)
- **Q-06 closed:** the PO number is the **distributor website's order number** — entered so
  deliveries can be matched to what was placed. So checkout groups selected cart lines **by
  distributor**; each group becomes ONE `smark_orders` row with its own required **order number**
  (still unique), lines from any projects mixed within it.
- Checkout flow: select lines → review groups (LCSC: 12 lines · Digikey: 3 lines) → place each on
  the website → paste its order number → confirm. A group without an order number stays in cart.
- **Upload order details / receipt** (per order, optional, "separate but we will save this"):
  file → R2; **AI extraction** (Claude, per stack rules) parses line prices/qtys → user confirms →
  fills missing `unit_price`s and corrects typed ones. Stored as `receipt_url` +
  `receipt_extracted jsonb` on the order.
- **PO → draft expense (Q-09):** placing an order auto-creates a **draft expense entry** (total,
  vendor = distributor, project links from lines) — owner confirms it in Expenses (notification,
  R2-36).

### D. Ordered / Arrived (baseline flow, now grouped by PO)
- **Ordered:** grouped by PO number — PO header (number, date, placed-by, receipt chip, total ₹) →
  lines with `project · BOM` chips · **Mark arrived** per line (partial arrivals OK).
- **Arrived:** unchanged hand-off → appears in **Receive → against an order** for put-away
  (existing part → top-up no reprint; new → print 1 ESD label). Arrival also stamps the part's
  `last_unit_price` from the order line (R2-11).

## 4. Data touched

| Read | Write |
|---|---|
| demand/shortfall view (active BOM lines vs `total_qty`), `smark_agent_results` (chosen options), parts | `smark_cart_items` (add/edit/dismiss), `smark_orders` (PO, receipt fields), `smark_order_lines` (status walk), `smark_parts.last_unit_price` (on arrival) |

## 5. Round-2 changes

- **R2-09** — rename + cart mechanics (§3-A) 🟢
- **R2-10** — smart shortfall (§3-B) 🟢 (Q-05 closed)
- **R2-12** — checkout per distributor group + order numbers + receipt extraction (§3-C/D) 🟢

## 6. Open questions on this tab

*(none — Q-05 and Q-06 closed)*
