# SmarkStock — update of 13 August 2026

---

## 1. The short version

Everything from your list is done and live. One item needs an answer from you;
it's at the end of this section.

**BOM matching is the big change.** On your `XE-U6632 V1.1` sheet the app was
finding 47 of 113 lines in stock. It now finds **76**, and offers you a choice
on **7 more**. Nothing was added to the shelves — the same lines, the same
stock, read more carefully.

Two things had been going wrong:

- Where the voltage is written into the value, like `0.1uF/100V`, the app
  couldn't read it at all. 24 lines found nothing even though the part was on
  the shelf.
- Where the same value and package exist at two voltages, it refused to guess
  and marked the line "to order". That was your 100nF example: 0603, held at
  25V and 50V, reported as out of stock with 1,604 pieces in the box.

It now reads the voltage from the value, or from the line's own description
(`CAP CER 100nF 25V X7R 0603`), so those go to the right reel.

When two items are genuinely indistinguishable, the line reads **"In stock ·
3 options"**. Click it, you see the part codes with their quantities, and you
pick the one you meant. It remembers your choice, survives re-checks, and can be
changed or cleared later. There's a new **Re-check stock** button on every BOM —
press it after receiving stock, or on any existing BOM to pick up this
improvement.

**Receive.** The Save button wasn't broken; it was being blocked. The duplicate
check was too loose, so almost any new part looked like an existing one, and the
"top up instead?" question appeared at the top of the page while you were
looking at the button at the bottom. The check is exact now and the question
appears right above the button.

Description is a proper field. The custom field you created was writing
somewhere else, which is why it never appeared in the inventory list. Only value
and quantity are required now — package is optional. The form shows the fields
for whichever category you pick, the same ones you see as columns. Distributor
and an image link are there too. The button just says **Save**, since nothing
was printing from it anyway.

**Print queue** no longer empties when you open the sheet. Printing and clearing
are separate buttons.

**Opening a part is much faster.** Clicking a row was quietly reloading the whole
1,745-part list to show one panel — that's why it dragged on the office
computers.

**Categories** can be renamed from Settings, and it updates every part at once.
New ones are created by typing them while receiving. **IC 555 has been removed
from all 72 parts** as you asked. **Boxes** can be renamed and moved between
shelves. **Tolerance** and **Distributor** are now columns on the main list.

**The metric notation is gone from package names** — `0603 (1608 Metric)` now
reads `0603`, across every category rather than only resistors and capacitors,
so the package filter no longer splits the same size into two options. Matching
was never affected by it either way: the app already compared package sizes with
the bracket ignored.

**One thing I couldn't do: PPM.** It's blank in every row of every file you've
sent, so there is nothing to display. Where should it come from?

Sections 2 and 3 below explain how the matching works now, and — more usefully —
what makes a line match, in case it helps when you export the next BOM.

---

## 2. How matching works: before and after

Measured on `XE-U6632_V1.1-Ordering.xlsx`, 113 stock lines, against the live
catalogue of 1,746 parts, and re-checked after the package clean-up above.

| | Before | After |
|---|---:|---:|
| Matched to stock | **47** | **76** |
| Offered as a choice | 0 | **7** |
| Left unmatched | 66 | 30 |

### The ladder

A line is compared against stock on three rungs, in order. The first one to hit
wins, and the ones above are more trustworthy than the ones below.

1. **Manufacturer part number** — exact, ignoring punctuation and case.
2. **LCSC part number** — exact.
3. **Value + package** — the value must be *identical* after unit conversion
   (`0.1uF` and `100 nF` are the same capacitor and match), and the package must
   be the same physical size (`C0603` in the BOM matches `0603 (1608 Metric)` in
   stock).

Rung 3 carries most of your catalogue. **880 parts have no manufacturer part
number and no LCSC number at all**, because generic passives never had one, so
rungs 1 and 2 can never reach them.

### Why 66 lines missed before

| Cause | Lines |
|---|---:|
| Voltage written inside the value | 24 |
| Footprint is a KiCad library name, not a package size | 26 |
| Two stock rows tied, so nothing was picked | 11 |
| A qualifier like `/DNP` on the end of the value | 3 |
| Genuinely not in stock | 2 |

### What's different now

**The value and voltage are separated.** `0.1uF/100V` is read as a `0.1uF` part
rated `100V`. A trailing qualifier that isn't a voltage, like `/DNP`, is dropped
and the value in front of it is used. A part number that happens to contain a
slash, like `24AA025E48T-E/OT`, is left alone — its suffix is part of its name.

**Voltage breaks ties.** Taken from the value if it's there, otherwise read out
of the line's own description. Your line 9 (`100nF`, C0603) now resolves to
SMK-000003; line 8, the same value and package, resolves to SMK-000002 because
its description says 25V. Two lines that look identical in the value column go
to two different reels, correctly.

One deliberate limit: **voltage only ranks candidates, it never rejects one.** An
exact value match with an unfamiliar voltage still matches. Making the voltage
part of the pass/fail test would turn working matches into missing ones.

**A surviving tie becomes a question, not a verdict.** "In stock · 3 options",
with the part codes and quantities, and your pick is remembered.

**Existing BOMs can be re-checked.** Matching used to run only on upload or when
the build quantity changed, so a sheet's statuses were frozen at whatever the
app knew that day.

---

## 3. Why the remaining 30 don't match — and what can be fixed where

This is the part worth reading, because most of what's left can't be fixed by us
alone.

### The honest division of labour

There are three different reasons a line fails, and they need three different
responses.

**a) The information is there, but written in a form we didn't read.**
This is our problem and we fix it in code. The voltage-inside-the-value case was
exactly this — the sheet always said `0.1uF/100V`, we just weren't parsing it.
Fixed, and it recovered 24 lines. If you find another pattern like this, tell us
and we'll read it.

**b) The information isn't in the sheet at all.**
No algorithm can invent it. If a line says `100nF`, `C0603` and nothing else,
and the shelf holds 100nF 0603 at 25V and at 50V, there is nothing anywhere in
that row that says which one the board needs. We could pick the one with more
stock, or the cheaper one, or the first one — but that is a guess wearing a
confident face, and the cost of being wrong is not small: the line's whole demand
gets charged to the wrong reel, so the shortfall figure is wrong and the purchase
list is wrong, and nobody finds out until the parts don't arrive.

So we ask you instead. That's what "3 options" is. It takes one click, and only
where the sheet genuinely doesn't say.

**c) The part isn't in stock.**
Two lines here (2.7nF 0603, 1.96K 0603). That's the app working correctly, and
the answer is a purchase order, not a change to the sheet.

### "Why not just make the matching smarter?"

We tried the looser version, and it caused a worse problem than it solved.

Before, the value comparison accepted a close resemblance rather than an exact
match. That put `115kΩ` on a line asking for `100K`, showed it as in stock with
a shelf location, and quietly removed it from the to-order list. It looked
right. It was wrong, and the shortage only surfaced at build time.

So exact matching isn't laziness — it's the safety property. **A missing match
costs you one click. A wrong match costs you a build.** Everything above is
built around that: we'll do any amount of work to read what your sheet actually
says, and we won't guess at what it doesn't.

The same reasoning applies to the KiCad footprints. We could write a lookup table
mapping `PinHeader_1x2_P2.54mm` and friends onto package sizes, and for a few
patterns like `CAT16-1206_8L` we can genuinely extract the `1206` — that's on our
list. But a hand-maintained table of library names is a guess-list that goes
stale the moment anyone edits the library, and it would silently start producing
wrong answers rather than obvious ones. The reliable fix is one character in the
export settings, which is the next section.

### And one thing that's on us, not you

**Connectors, headers and terminal blocks cannot match at all right now** —
there are **zero connector rows in stock**, since they were removed pending your
corrected file. That's roughly half of what's still unmatched. Once that data
lands, those lines should resolve like everything else.

---

## 4. What to change in the BOM export, in order of how much it helps

### 1. Put the package size in the Footprint column, not the library path

**The biggest one — 26 lines on this sheet.**

KiCad exports the full library path: `PinHeader_1x2_P2.54mm`,
`INDM6965X300N`, `CAT16-1206_8L`, `XTAL_NX2012SA-32.768K-STD-MUB-1`. None of
those states a package size, so there's nothing to compare against `0603` on the
shelf.

These all work: `R0603`, `C0805`, `SOT-23-6`, `SMA` — including with a library
prefix, so `SMARKKicadLib:R0603` is fine. It's the size on the end that matters.

If the library naming can't be changed, adding a separate column with just the
package size would do the same job.

### 2. Keep the voltage with the value, or in the description

Both of these work now:

- `0.1uF/100V` in the Value column
- `0.1uF` in Value, with `CAP CER 100nF 100V X7R 0603` in Description

Without a voltage anywhere, a capacitor stocked at two ratings can only be
offered as a choice — nothing in the line says which it is.

### 3. An LCSC or manufacturer part number beats everything

A line with either matches instantly and exactly, with no value or package
needed at all. Worth filling in for anything you order repeatedly — it's the one
change that makes a line immune to every formatting question above.

### 4. Write values the way the stock sheet does

Units are converted, so `0.1uF` and `100nF` are the same part and both match.
`4k7`, `4.7k` and `4700` are all understood.

What won't match is a genuinely different value: `100K` and `115kΩ` are
different resistors, and the app will not treat them as equal.

### 5. Mark DNP in the DNP column, not in the value

`0R/DNP` works, but `0R` with the DNP column set is cleaner, and it's what the
build-quantity calculation reads.

---

## 5. How to check it yourself

1. Open the BOM and press **Re-check stock**. The in-stock count should jump.
2. Line 9 (`100nF`, C0603) should read In stock, pointing at SMK-000003.
3. Line 1 (`0R`, R0603) should read **In stock · 3 options** — click it, pick
   one, and it should turn green with a "chosen" mark.
4. Change the build quantity and save. Your choice should still be there.
5. On Receive: pick a category, and the form should change to that category's
   fields. Fill in value and quantity only, and Save should work.
6. On Receive: press **Print sheet**, then check the queue is still there.
   **Clear queue** is what empties it.
