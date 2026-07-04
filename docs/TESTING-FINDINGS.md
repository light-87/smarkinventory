# TESTING-FINDINGS.md — manual-test findings log

> Fill this in while working through `docs/MANUAL-TESTING.md`. One block per issue, copy the
> template. Don't self-censor — "button feels cramped" is a valid finding. When ready, tell
> Claude **"process the findings"**: each OPEN item becomes a fix (with a regression test where
> it's a real bug), severities drive order, and STATUS gets updated back into this file.

**Severity:** `S1` broken/wrong data/blocks the client demo · `S2` works but wrong behavior or
confusing enough to embarrass us · `S3` polish (spacing, copy, speed) · `IDEA` not a defect —
something the client will probably ask for (gets an R2-NN and goes through the plan folder,
NOT silently built).

**Status:** `OPEN` → `FIXED (commit)` / `WONTFIX (why)` / `PLANNED (R2-NN)`.

---

## Template (copy me)

```
### F-001 · S2 · OPEN
Surface: (e.g. Receive → Top up)
Role/device: (owner / employee / accountant · desktop / phone / PWA)
What happened:
What I expected:
Steps to reproduce: (if not obvious)
Screenshot: docs/testing-screenshots/f-001.png (optional)
```

---

## Findings

<!-- newest at the top -->

---

## Processed log

<!-- Claude moves resolved entries here with commit hashes, so the Findings section stays short -->

### F-004 · S2 · FIXED (see commit)
Surface: BOM detail page + AI ordering pipeline
Decision: the BOM page is a pure sheet mirror and the AI reads the complete file.
- Removed from the BOM page: Lines/In stock/To order stat trio, per-line Status chips,
  Re-reconcile button — stock checking is the agents' job during a run. Reconcile still runs
  silently on upload/×N change (feeds cross-project demand + which lines skip the worker).
- Agents now receive the COMPLETE uploaded line: line #, references, qty(×N), value, raw
  footprint, derived package, voltage (now split from "100uF/63V"-style cells — was always
  null before), description, manufacturer, MPN, LCSC, PartLink URL, per-line note, custom
  extra columns. Description/notes/extra string values pass the same global alias scrub
  (leak tests extended + green).
- DNP lines: qty forced to 0, flagged to the planner, mock + live planner skip them ("DNP —
  not populated"). Previously they were sent as buyable with full qty.
- The master planner also sees already-in-stock lines as read-only context (no jobs, no
  free text), so it reads the whole file the way the user does.
Note: the "footprint — on every row" report was NOT a bug — the uploaded file was the
user-modified GCU_V1.1_BOM_removed.xlsx, which genuinely has no Footprint column.

### F-003 · S2 · FIXED (see commit)
Surface: Projects → BOMs → BOM detail table
What happened: the table hid half the uploaded file — Description, Manufacturer, PartLink,
LCSC, per-line notes and custom extra columns were parsed + stored but never rendered.
Decision recorded: the BOM screen mirrors the uploaded file as-is; Status is informational
only (exact MPN/LCSC), and the AI pipeline receives every non-in-stock line raw.
Fix: BOM detail now renders all parsed columns (conditional LCSC/Note, dynamic extras,
PartLink as a clickable link); long references/descriptions truncate with full-text tooltips.

### F-001 · S2 · FIXED (a85963b)
Surface: Projects → BOMs list
What happened: no way to delete a BOM.
Fix: per-row delete button (owner/employee) with confirm dialog; lines cascade-delete; a BOM
that already has AI sourcing runs is not deletable by design (run/cost history is protected) —
the button explains and points to archiving the project instead.

### F-002 · S1 · FIXED (a85963b)
Surface: Projects → BOMs → upload GCU_V1.1_BOM.xlsx
What happened: Status column showed wrong inventory matches (e.g. "10uF/25V 1206" pinned to a
part in "Capacitors 0603") — the fuzzy value+package matcher rung was guessing identities for
BOM lines whose MPN isn't in the catalog. Note: the parse itself was faithful — rows 94–100
(blank refs, repeated C1/C2/H1/J1/U1) genuinely exist in the file (second board section).
Fix: BOM reconcile now matches on exact MPN/LCSC identity only; everything else stays
unresolved ("To order") and goes to AI sourcing as-is. Fuzzy matching still serves Receive's
duplicate guard and bulk takeout, where a person confirms the hit.
