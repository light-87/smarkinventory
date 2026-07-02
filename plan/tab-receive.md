# Receive Stock (+ labels + onboarding queue)

**Route:** `#/receive` · **Spec:** FEATURES.md §6.2–§6.6, §12 · **Prototype:** `isReceive`.

## 1. Purpose (baseline)

Every way stock enters the building, all obeying the print rule: **existing part → top-up, never
reprint; new part → one ESD label + suggested home.** Also hosts label printing + the ~2000-part
location-onboarding queue.

## 2. Current behaviour (as prototyped)

Two top-level segments:

### A. "Add a part" (walk-in stock, no order behind it)
- **New part:** category chip picker (required) + Value*, Package*, Qty*, MPN (opt), Manufacturer
  (opt) → **AI-suggested storage** chip (`→ B-12 · Capacitors 0603 · Shelf B`, category+package
  driven, overridable) → **Save & print ESD label**.
- **Existing part:** scan/type PID → Find → part card (identity, location, current qty) → add qty →
  **Add to stock** — appends a `received / top-up` history row, **no reprint**.

### B. "Receive against an order"
- List = only lines **marked arrived** on the On-order screen; each row: radio, PID/ref, EXISTING/NEW
  pill, distributor, ×qty. Empty state points at On-order's "Mark arrived".
- Selecting a line shows the branch text: existing → "top up Box …, no reprint"; new → "print 1 ESD
  label · suggested Box …". Enter arrived qty → **Confirm & put away** → qty + history + movement.

### C. Printable label sheet (always visible)
- Light card mocking the printed sheet: Smark logo + one **ESD-plastic label** (QR = PID + human
  text) + one **Big-Box label** (QR = box id + `BOX C-04 · Capacitors · 38 types · Shelf B`).

### D. Batch generate for existing stock (onboarding queue)
- "{N} need a location" — rows of imported parts (MPN, value, pkg, suggested box) with **Assign &
  print**; drains the Stock-List import backlog (§12: source has zero location data).

## 3. Data touched

| Read | Write |
|---|---|
| arrived order lines, parts (PID resolve), big boxes (suggestion), onboarding queue | `smark_parts` (new), `smark_stock_locations` (new/top-up), `smark_part_events`, `smark_movements` (receive), `smark_order_lines.line_status→arrived` close-out, `smark_qr_labels` (+R2 PDF) |

## 4. Talks to (edges)

- Fed by **On-order** "Mark arrived" (A2-6); closes the ordering pipeline (A2-7).
- Storage suggestion ← **Shelves** big-box categories (A2-16); "Receive into this box" from Scan
  presets the box.
- New-part MPN → AI normalize/complete specs (§6.5) — small Claude call, user confirms.
- Labels consistent with Part detail preview + Settings label size; label PDFs land in R2.
- Print rule + one-QR-per-box are invariants A3 — any R2 change here re-checks them.

## 5. Round-2 changes

### R2-12 (ripple) — put-away list grouped by PO 🟢
"Receive against an order" rows now carry the **PO number** (+ `project · BOM` chip per line);
filter by PO. Confirm & put away also stamps `smark_parts.last_unit_price` from the order line
(R2-11) and records the PO in the part's history event.

### R2-23 — Simplify + rememberable custom fields on New part 🟢

- **Simplicity directive (client: "make it simple to use"):** flatten the two nested toggle rows
  (Add-a-part / Receive-against-order × New / Existing) into **three flat action cards** at the top
  — "New part" · "Top up existing (scan)" · "Put away arrivals" — one tap to the right form, no
  toggle archaeology. Big inputs, numeric keypads on mobile, AI storage suggestion inline.
- **"+ Add custom field"** on the New-part form: name + type (text/number) → saved to
  `smark_part_field_templates` and **offered automatically on every future New-part form**
  ("save that custom field for later"). Values land in `parts.attributes` jsonb (deep-filterable
  like any attribute). Owner can retire remembered fields in Settings.
- Same remember-structure pattern as the BOM builder (R2-19) — one mental model.

### R2-24 (ripple) — Voltage as its own input 🟢
New-part form: **Voltage** field separate from Value (e.g. Value `0.1µF` · Voltage `50V`), shown
for relevant categories (caps, some others); import mapping splits combined strings.

### R2-31 — Duplicate-part guard 🟢 (approved I-01)
On New-part save: run the reconcile matcher (MPN exact → LCSC → value+package+voltage) against the
catalog; on a hit show a warning card — "Looks like **SMK-000101** (0.1µF · 0603 · Box B-12,
qty 2,568). **Top up instead?**" — one tap switches to the top-up flow with the part preloaded;
"Create anyway" stays available (marks the new part `needs_review`). Merge tool = future (I-09).

### R2-35 — Batch label print queue 🟢 (approved I-06)
Labels no longer print one-by-one: every "Save & print" / onboarding assign **queues** the label
(`smark_qr_labels.print_status = queued`). A **Print queue** strip on this tab shows the count →
"Print sheet" renders all queued labels onto one Avery-layout PDF (size from Settings) → mark
printed. Onboarding 2000 parts becomes sheet-batched instead of 2000 dialogs.

## 6. Open questions on this tab

*(none yet)*
