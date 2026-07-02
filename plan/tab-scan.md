# Scan (take-out / add)

**Route:** `#/scan` · **Spec:** FEATURES.md §8 · **Prototype:** `isScan`.

## 1. Purpose (baseline)

The technician's fastest loop: scan an ESD label → adjust quantity in seconds, with undo. Scan a box
label → audit or receive into it. HID scanner + phone camera in the real app.

## 2. Current behaviour (as prototyped)

- **Scanner zone:** camera-frame mock + focused code input (Enter resolves) + "Simulate part scan" /
  "Simulate box scan" demo buttons.
- **Part scan result card:** PID · MPN · value · location · current qty; **stepper** (−/+, min 1);
  **Take out** (orange, decrements) / **Add** (outline, increments). Both toast with **Undo**
  (reverses the movement) and reset the card.
- **Box scan result card:** box code/name/shelf + live contents preview; actions **Count / audit**
  and **Receive into this box**.
- Unknown code → "No match" toast.
- Real-app notes (spec): HID = focus-trapped debounced keystroke buffer ending in Enter; camera =
  `BarcodeDetector` with html5-qrcode/ZXing fallback; offline queue for movements.

## 3. Data touched

| Read | Write |
|---|---|
| part by PID, box by code, locations | `smark_movements` (pick/receive/adjust + `undo_of`), `smark_stock_locations.qty`, `smark_parts.total_qty` rollup |

## 4. Talks to (edges)

- Every ± here surfaces in Dashboard movements, Inventory qty, Shelves chips, Part detail history
  (A2-7 chain).
- Box card "Receive into this box" → **Receive** with box preset (A2-16); "Count / audit" → Shelves
  live contents.
- Same code-resolution helper as top-bar scan / global modal (shell).

## 5. Round-2 changes

*(none logged yet)*

## 6. Open questions on this tab

*(none yet)*
