# Daily Reports (NEW tab — R2-07, absorbs Attendance R2-02/R2-04)

**Route (proposed):** `#/daily` · **Introduced by:** R2-07 · **No baseline — new tab.**
"Everything done by everyone today gets tracked."

## 1. Purpose

One page per day answering: who was in, what did they work on and for how long, what stock moved
(who took/added what), and what ordering activity happened. Self-serve attendance marking lives
here too (moved from the planned standalone Attendance tab — see `tab-attendance.md` stub).

## 2. Planned behaviour

### Day header
- Date picker (default today) + prev/next arrows; person filter (owner sees all, employee defaults
  to self — visibility per Q-01).

### Section 1 — Attendance & work (Q-03 CLOSED: clock-in/out + MANUAL hours)
- **My row (employee):** Clock-in / Clock-out tap + "working on" project selector.
- **My hours (manual — client: "manually is doable"):** simple day-end entry — per project worked:
  pick project (from my assignments) + hours + optional note → `smark_time_entries`
  (`source=manual` only; the derived model is dropped). Prompted at clock-out if nothing logged;
  owner can add/correct anyone's entries.
- **Team table (owner; accountant read):** per person — present chip · in/out · logged hours ·
  project(s).

### Section 2 — Inventory movements today
- Feed grouped by person: `Suresh — took 145 × SMK-000101 (Box B-12) · bulk pick · TMCS Mainboard`,
  `added 500 × SMK-000203 · receive · PO-2026-014`. Data = `smark_movements` + actor + reason +
  bom/order refs. Totals strip: items out · items in · adjustments.

### Section 3 — Ordering activity today
- BOM uploads, agent runs (who started, BOM, cost), review sessions, cart adds, orders placed
  (PO number), arrivals marked. Data = runs / cart / orders / part-events timestamps + actors.

### Section 4 — Expenses today (R2-20 ripple, OWNER-ONLY)
- Entries added today from the Expenses tab: type · amount · category · note. Section entirely
  hidden for non-owner roles (client: "show this in the daily report as well" + "owner only").

### Notes
- Read model = **derived** from existing tables (movements, part events, runs, orders, attendance,
  time entries) via a `v_daily_activity` union view — no new write path except attendance itself.
- History: any past day viewable; per-person drill = same view filtered.
- Export/print daily report (PDF) — assumed nice-to-have, not promised; confirm before building.

## 3. Data touched

| Read | Write |
|---|---|
| `v_daily_activity` (union view), `smark_attendance`, `smark_time_entries` | `smark_attendance` (check-in/out, project tag) — everything else read-only |

## 4. Talks to (edges)

- Attendance/hours data shared with **project hub Team & hours** (R2-04).
- Movement rows deep-link to **Part detail**; ordering rows to **project · BOM** or **Cart**.
- **Dashboard** stays the at-a-glance summary; Daily Reports is the per-day/per-person audit. No
  duplication: dashboard cards may link "see today's report →".
- Nav: rail Team group (replaces Attendance entry); mobile role-aware slot (per Q-01).

## 5. Round-2 changes

### R2-07 — This tab 🟢
Q-03 fully closed: attendance self clock-in/out; hours manual per project per day, owner-editable.
Visibility per final matrix: employee self-only, owner all, accountant read-all.

### R2-33 (ripple) — day export 🟢
Export a day (or range) as CSV/xlsx — movements + attendance + hours (+ expenses for owner).

## 6. Open questions on this tab

*(none — Q-03 and Q-01 closed)*
