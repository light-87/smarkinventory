# Shelves (rack browser)

**Route:** `#/shelves` · **Spec:** FEATURES.md §7 · **Prototype:** `isShelves` (immersive rack from
round-1 change 17).

## 1. Purpose (baseline)

The physical room on screen: Shelf → Big Box → ESD plastics, two-way with scanning. Find where things
are without reading a table.

## 2. Current behaviour (as prototyped)

- **Rack view (root):** one horizontal band per shelf (A Passives · B Passives/Caps · C ICs & Modules
  · D Power & Connectors), header = shelf code tile + name + box count; thick bottom border = the
  shelf plank. Inside: horizontal row of **big-box cards** — box code (mono), name, category chip,
  first 5 part chips (dot colored by stock state, PID, qty) + "+N more types", orange low dot on the
  card when anything inside is low/out. Card click → box detail.
- **Box detail:** breadcrumb (← All shelves / Box B-12); left card = box code, name, shelf, **Big-Box
  QR** (encodes box id), label text (`BOX B-12 · Capacitors · 38 types · Shelf B`), **Print Big-Box
  label**; right = **Live contents** table (PID · MPN · value · qty, low = orange) — rows open the
  part drawer.
- Big-box categories drive Receive's storage suggestion.

## 3. Data touched

| Read | Write |
|---|---|
| `smark_shelves`, `smark_big_boxes`, `smark_stock_locations` + parts (contents, low states), `smark_qr_labels` (box label) | label print event |

## 4. Talks to (edges)

- Box scan (Scan tab / global modal) lands on the same live-contents view (A2-11, A2-17).
- Contents row → **Part detail** (A2-13).
- Low dots share `stockState` with Dashboard/Inventory.
- Box QR + label text must match Receive's printable sheet and SCHEMA `smark_qr_labels`.
- "Receive into this box" entry (from Scan's box card) pre-selects this box in Receive.

## 5. Round-2 changes

### R2-25 / Q-10 — Box audit flow (spec'd, approved) 🟢
"Count / audit" (here + scan-box card) becomes a **guided count**: box contents list → per ESD
confirm the on-screen qty or type the counted one → variance rows become `adjust` movements tagged
`audit` (undoable like any movement) → `last_counted_at` stamped per location. Partial audits
allowed — progress saved, resumable; box header shows "last audited {date}".

## 6. Open questions on this tab

*(none — Q-10 closed)*
