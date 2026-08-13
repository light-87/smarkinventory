# SmarkStock — First-Time Stockroom Setup: a few decisions

Right now all the stock sits in one place and nothing is labeled: no items, no boxes, no shelves. We are going to fix that in one pass. We will go through everything, give each item type a home (a shelf and a box), print a label, and stick it on. After this one-time exercise, day-to-day work moves to scanning (receive, pick, count), which is already built.

Before we build the setup tool, we need your call on a few things so it matches how you want the stockroom laid out. Each question has options. Just reply with the letter you prefer, or tell us your own. Our recommendation is marked.

One thing is already decided, so it is not a question: **you enter each item type once, with a quantity.** If you have 50 of the same resistor, you enter it once as quantity 50, we print one label, and all 50 go in the same box. You do not label every single piece.

---

## 1. What goes on a shelf together?

How should we group items across the shelves?

- **A) By component type** (recommended). Resistors on one shelf, capacitors on another, ICs and modules on another, connectors on another, and so on. The most common layout, and the easiest to find things by kind.
- **B) By project or product.** All the parts for a given build kept together. Good if you mostly build a few fixed products.
- **C) By how often you use them.** Fast-moving parts up front, rarely-used ones further back.
- **D) Something else.** Tell us how you would like it.

## 2. Inside a shelf, how do we split the boxes?

Once a shelf holds, say, all resistors, how do we divide them into boxes?

- **A) By size / package** (recommended for small parts). For example, resistors split into a 0402 box, a 0603 box, an 0805 box. Quick to grab the right size.
- **B) By value range.** For example, 0 to 1 kΩ in one box, 1 kΩ to 100 kΩ in another.
- **C) One box per type.** All resistors in a single box. Fewest boxes, but more digging.
- **D) By part family or part number.** Group by the specific part.

You can also mix, for example size-based for the small passives and one box each for connectors. Tell us if so.

## 3. What should we record for each item?

When labeling an item, what information do we capture?

- **A) Type + value + size + quantity** (recommended). The minimum to find it and know how many you have.
- **B) The above, plus the manufacturer part number (MPN).** Handy for reordering the exact part.
- **C) The above, plus manufacturer and a short note.** The most detail, and a bit more typing per item.

## 4. How many labels per A4 sheet?

We print labels a sheet at a time. Bigger labels mean fewer per page, but they are easier to read.

- **A) 8 per sheet.** Biggest, readable from across the room.
- **B) 12 per sheet** (recommended). Big and clear, fewer sheets.
- **C) 15 per sheet.** Medium.
- **D) 24 per sheet.** Smaller.
- **E) 65 per sheet.** Tiny, and needs the pre-cut Avery sticker sheets.

You will enter a batch of items (as many as fit a sheet), print them together, and place that batch. So this number is also your batch size.

## 5. What prints on each item label?

- **A) QR code + value + size + item code** such as SMK-000123 (recommended).
- **B) The above, plus where it lives** (its shelf and box), printed right on the label so you can see its home at a glance.
- **C) The above, plus the MPN.**

The QR code is what the scanner reads later. The text is for people.

## 6. Should we label the shelves and boxes too?

- **A) Yes, shelf labels and box labels first** (recommended). We print and stick the shelf and box labels before filling them, so the whole rack is labeled up front.
- **B) Boxes only.** Label the boxes, identify shelves by position.
- **C) Item labels only.** No shelf or box labels.

---

## How to reply

Send back your pick for each question, for example: **"1-A, 2-A, 3-B, 4-B, 5-B, 6-A"**, and note anything you would do differently.

Once we have your answers, we build the setup tool to match. You enter each item, it suggests the right shelf and box automatically, and prints the batch of labels for you to stick and place. From then on, everything runs off the scanner.
