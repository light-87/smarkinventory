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

---

# Everything else that changed on 13 August

The BOM work above is one of eight items. The rest, in the order they were
reported.

## Receive

**"Save & print ESD label" did nothing.** It was never broken — it was being
blocked. Before saving, the form checks whether the part already exists, and
that check was tuned when the catalogue held a handful of parts: it accepted a
60% value resemblance as a match. Against 1,746 parts almost any new passive
resembled something, so nearly every save came back as a suspected duplicate,
and the "looks like SMK-000002, top up instead?" question appeared at the *top*
of the card while the operator watched the button at the bottom.

The check is exact now — the same standard the BOM matcher uses — and the
question appears directly above the button.

**Description was missing.** The form had no Description box, so a custom field
of that name had been added by hand. Custom fields write into a general-purpose
attributes bag, not the real Description column, which is why the Inventory
grid's Description column stayed empty. Description is a proper field now, and
`docs/move-custom-description-2026-08-13.sql` moves the already-typed text into
the column so none of it is lost.

**Only Value and Quantity are required.** Package is optional. So are MPN,
manufacturer, description, distributor and the rest.

**The form follows the category.** Pick Capacitor and it asks for voltage and
case size; pick Resistor and it asks for tolerance and power rating. These are
the same fields that category shows as columns in Inventory, from one shared
definition — so anything visible in the grid can be captured here, and nothing
is called one name in one place and something else in another.

**Distributor and an image link** are on the form, and on the part page.

**The button says Save.** Nothing printed from it; the label is queued.

## Print queue

Opening the sheet used to mark every label printed, so looking at what was
waiting was enough to lose it. Rendering and clearing are separate now: **Print
sheet** produces the PDF and leaves the queue alone, **Clear queue** empties it
once the labels are physically printed.

## Speed

Clicking a row in Inventory used to re-send the entire catalogue to show one
panel: 1,805 KB for about 8 KB of detail, which is why it crawled on the office
machines. The panel is fetched on its own now — **2 KB**, and it opens in well
under a second. Shareable `?pid=` links still work.

## Categories

Settings → Categories lists every category and sub-category with a part count.
Renaming one moves every part carrying it, in a single step, so a filter can
never end up split across an old and a new spelling. Sub-categories can also be
removed.

New categories are created by typing one on a part — the "+ New" chip on the
Receive form. There is no separate "create" step, because a category exists
precisely when some part says so; a name registered without any parts would
appear in every filter and match nothing.

**"IC 555" has been removed** from all 72 parts that carried it, and is gone
from the sub-category list.

## Boxes

A box can be renamed and moved to another shelf from its own page. A shelf that
doesn't exist yet is created. The stock inside moves with the box.

## Inventory grid

**Tolerance** and **Distributor** are now columns. Status was already gone.

**PPM is not there, and cannot be** — the column exists in the source files but
is blank in every row of every one of them. If it should hold something, it
needs to come from somewhere before it can be displayed.

---

# Getting more BOM lines to match

The matcher will never beat the information in the sheet. These are, in rough
order of how much they would help, the things that make a line matchable.

## 1. Put the package in the Footprint column, not the library name

This is the single biggest remaining cause — 26 lines on this sheet.

KiCad exports the library path: `PinHeader_1x2_P2.54mm`,
`INDM6965X300N`, `CAT16-1206_8L`, `XTAL_NX2012SA-32.768K-STD-MUB-1`. None of
those states a package size, so there is nothing to compare against
`0603` in stock.

`R0603`, `C0805`, `SOT-23-6`, `SMA` all work — including with a library prefix,
so `SMARKKicadLib:R0603` is fine. It is the size at the end that matters.

## 2. Keep the voltage with the value, or in the description

Both of these now work:

- `0.1uF/100V` in the Value column
- `0.1uF` in Value with `CAP CER 100nF 100V X7R 0603` in Description

Without a voltage anywhere, a capacitor stocked at two ratings can only be
offered as a choice, because nothing in the line says which one it is.

## 3. An LCSC or manufacturer part number beats everything

A line with either matches instantly and exactly, no value or package needed.
Worth filling in for anything ordered repeatedly.

## 4. Write values the way the stock sheet does

Units are converted, so `0.1uF` and `100nF` are the same part and both match.
What does not match is a different value: `100K` and `115kΩ` are genuinely
different resistors and the matcher will not treat them as equal — deliberately,
because pretending otherwise once put the wrong part on a line and hid a real
shortage.

`4k7`, `4.7k` and `4700` are all understood.

## 5. Mark DNP in the DNP column, not in the value

`0R/DNP` works, but `0R` with the DNP column set is cleaner and is what the
build-quantity maths reads.

## 6. Tell us when a part is genuinely new

Two lines on this sheet — 2.7nF 0603 and 1.96K 0603 — simply are not in stock.
That is the matcher working correctly, and the answer is a purchase, not a
change to the sheet.

## And one from our side

Connectors, headers and terminal blocks cannot match at all at the moment:
there are **zero connector rows in stock**, because they were removed pending a
corrected file. That accounts for roughly half of what is still unmatched. Once
that data lands, those lines should resolve like everything else.
