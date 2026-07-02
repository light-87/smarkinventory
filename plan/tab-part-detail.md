# Part Detail (drawer)

**Route:** `#/part/:pid` — right-side drawer over any screen · **Spec:** FEATURES.md §6.4, §6.5 ·
**Prototype:** `drawerOpen` block.

## 1. Purpose (baseline)

Everything about one part in one place: identity, specs, where it physically lives, its smart label,
and its **living history** (every order/receive/pick appended forever). Scan a label → land here.

## 2. Current behaviour (as prototyped)

- **Header:** PID (mono, large) · MPN · manufacturer · status pill (active green / nrnd / eol) · ×.
- **Specifications grid:** value, package, dielectric/tolerance/voltage etc. from attributes;
  Datasheet ↗ link.
- **Locations table:** rows of Shelf · Big Box · ESD plastic id · qty + last-counted date. Supports
  the rare two-location (reel + working box) case.
- **ESD-plastic label preview:** QR (encodes PID only) + human text (`PID · value · package · MPN ·
  category`) + **Print label** button.
- **History timeline (living record):** dot-line per event — received (+qty, distributor, project,
  price, reason like "top-up (existing box, no reprint)", by), picked (−qty, project), ordered…
  Newest events appended by Receive/Review/Scan flows.
- **Footer actions:** **Order more** (→ Orders with this part) · **Adjust qty**.
- Deep-linkable; closing restores the underlying route.

## 3. Data touched

| Read | Write |
|---|---|
| `smark_parts`, `smark_stock_locations`, `smark_part_events`, `smark_qr_labels` | `smark_part_events` (adjust/note), qty via Adjust (movement row) |

## 4. Talks to (edges)

- Opened from Inventory rows, Shelves box contents, Scan resolution, top-bar/global scan (A2-10/13/14/17).
- **Order more** → Orders/project flow; history rows written by Receive (A2-7) and Review (ordered).
- Label preview must stay consistent with Receive's printable sheet + Settings label size.

## 5. Round-2 changes

### R2-11 (ripple) — price on the part 🟢
Specs grid gains **Last price** (₹, from most recent arrival/order line) and **Stock value**
(qty × last price). History timeline already showed per-event `unit_price` — unchanged, now the
feed for `last_unit_price`. Prices arrive via cart ordering (manual, R2-09) or receipt extraction
(R2-12).

### R2-10 (ripple) — contested-stock flag 🟢
When combined active-BOM demand exceeds this part's stock, show an orange strip: "demanded 600
across 2 projects · 500 available · 100 in cart →" linking to the cart line.

### R2-13 — Living record goes fully detailed 🟢

Client wants "everything written on it with timestamps". Timeline events now render, per event:
**timestamp · event type · qty · unit price · employee (display name) · project → client name ·
distributor + PO number + order link · reason/note**. Additions over baseline:

- **`price_change` events** — auto-logged whenever `last_unit_price` changes (arrival or receipt
  extraction): shows **old price → new price**, source (PO / receipt / manual), who triggered.
- **`location_moved` events** — part's ESD moved to another big box.
- **Client attribution** — each ordered/received/picked event shows which client's project drove it
  (join through `project → client`; no denormalized copy).
- **"Where it was ordered from"** — distributor + PO chip on ordered/received events (PO links to
  the Cart tab's order group, R2-12).
- Timeline gains filters (event type, project) — 2000-part histories stay readable.

## 6. Open questions on this tab

*(none yet)*
