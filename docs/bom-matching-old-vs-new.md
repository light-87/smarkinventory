# BOM matching: what changed on 13 August 2026

Measured on the real ordering sheet `XE-U6632_V1.1-Ordering.xlsx` (113 stock lines)
against the live catalogue (1,746 parts).

| | Before | After |
|---|---:|---:|
| Lines matched to stock | **47** | **76** |
| Offered as a choice | 0 | **7** |
| Left unmatched | 66 | 30 |

Nothing in the sheet changed and no stock was added. The same lines and the same
shelves, read more carefully.

---

## What we were matching on before

Three rungs, tried in order. The first one to hit wins.

1. **Manufacturer part number.** Exact, after stripping punctuation and case.
2. **LCSC part number.** Same.
3. **Value + package.** The value had to be *identical* after unit conversion —
   `0.1uF` and `100 nF` are the same capacitor and matched, `100K` and `115kΩ`
   did not — and the package had to be the same physical size, so
   `C0603` from the BOM matched `0603 (1608 Metric)` in the stock sheet.

Rung 3 carries most of this catalogue. 880 of the parts have no manufacturer
part number and no LCSC number at all, because generic passives never had one,
so rungs 1 and 2 can never reach them.

**And if two stock rows tied on rung 3, the line matched nothing.** That was a
deliberate rule: silently picking one of two identical-looking rows would charge
the whole line's demand to an arbitrary half of the stock, so the shortfall and
the to-order list would both be wrong.

## Why 66 lines missed

| Cause | Lines |
|---|---:|
| The voltage was written *inside* the value | 24 |
| The footprint is a KiCad library name, not a package size | 26 |
| Two stock rows tied, so nothing was picked | 11 |
| A qualifier like `/DNP` on the end of the value | 3 |
| Genuinely not in stock | 2 |

### The voltage-inside-the-value problem

The BOMs write `0.1uF/100V`, `10nF/50V`, `10uF/6.3V`. The matcher tried to read
that whole string as one quantity, failed, and gave up — so these lines found
**no candidate at all**. Not a wrong match. No match, while the part sat on the
shelf.

### The tie problem — the one that was reported

Line 9 of this sheet is `100nF`, footprint `C0603`. The catalogue holds it twice:

| Part | Value | Package | Voltage | In stock |
|---|---|---|---|---:|
| SMK-000002 | 100 nF | 0603 | 25V | 104 |
| SMK-000003 | 100 nF | 0603 | 50V | 1,500 |

Both are exact matches on value and package. Two candidates, so the rule refused
to choose, and the line was reported as **To order** with 1,604 pieces in the box.

---

## What we match on now

The three rungs are unchanged. Two things feed them better, and a fourth
outcome exists that didn't before.

### 1. The value and the voltage are separated

`0.1uF/100V` is now read as a `0.1uF` part rated `100V`. A trailing qualifier
that isn't a voltage, like `/DNP`, is dropped and the value in front of it is
used. A part number that happens to contain a slash — `24AA025E48T-E/OT` — is
left alone, because its suffix is part of its name.

This alone recovers the 24 lines that previously found nothing.

### 2. Voltage breaks ties

The rating is taken from the value if it's there, and otherwise **read out of
the line's own description**: `CAP CER 100nF 25V X7R 0603` says 25V in plain
text, and every one of these BOMs carries it.

Line 9 now resolves to SMK-000003. Line 8 — same value, same package, whose
description says 25V — resolves to SMK-000002. Two lines that look identical in
the value column go to two different reels, correctly.

One important limit, and it is deliberate: **voltage only ranks candidates, it
never rejects one.** An exact value match with an unfamiliar voltage still
matches. Making the voltage part of the pass/fail test would have turned working
matches into missing ones, which is how this was first written and what the
tests now guard against.

### 3. A surviving tie becomes a question, not a verdict

Where two rows still tie — typically resistors that differ only by tolerance or
which reel they came from — the line no longer reads "To order". It reads:

> **In stock · 3 options**

Clicking it lists the candidates with their part code, rating, package and stock
on hand, and the operator picks the one the design means. Seven lines on this
sheet land here.

That choice is **remembered**. It's written to the line in a way that re-running
the match treats as fixed, so changing the build quantity later re-does all the
arithmetic without undoing anyone's decisions. A line matched this way carries a
`chosen` badge, so it's clear at a glance which links a person stands behind.

Demand is not attributed until the choice is made, so the shortfall numbers stay
honest in the meantime — which was the whole reason for refusing to guess.

### 4. Existing BOMs can be re-checked

Matching used to run only when a BOM was uploaded or its build quantity changed,
so a BOM's statuses were frozen at whatever the matcher knew that day. There's
now a **Re-check stock** button on the BOM. Press it after stock arrives, or
after an improvement like this one, and the whole sheet is re-read.

---

## What still doesn't match, and why

**30 lines.** Most of them cannot match yet, for reasons outside the matcher:

- **Connectors, headers and terminal blocks.** The footprints are KiCad library
  names (`PinHeader_1x2_P2.54mm`, `KICADP:PHOENIX_1841539`) rather than package
  sizes, and more to the point there are **zero connector rows in stock** — they
  were removed pending a corrected file. Nothing can match them until that
  arrives.
- **Crystals, inductors and resistor networks** with footprints like
  `XTAL_NX2012SA-32.768K-STD-MUB-1` or `CAT16-1206_8L`. A package size can be
  extracted from some of these; it's the next worthwhile piece of work.
- **Two parts genuinely not stocked**: 2.7nF 0603 and 1.96K 0603.

---

## How to check it yourself

1. Open the BOM and press **Re-check stock**.
2. Line 9 (`100nF`, C0603) should read In stock and point at SMK-000003.
3. Line 1 (`0R`, R0603) should read **In stock · 3 options** — click it and pick
   one; it should turn green and gain a `chosen` badge.
4. Change the build quantity and press Save. Your choice should survive.
