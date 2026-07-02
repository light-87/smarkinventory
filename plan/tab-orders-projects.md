# Projects (was "Orders") — Projects list + Project hub

**Route:** `#/order` → renamed `#/projects` (R2-03) · **Spec:** FEATURES.md §5.1–§5.2 ·
**Prototype:** `isOrder` (`orderProjectsView` / `orderWorkspaceView`, round-1 change 20).

> **R2-03 reframes this tab:** no longer just the entry to ordering — a project is the client-job
> hub holding **multiple named BOMs** (each with its own sourcing pipeline), **team + hours**
> (R2-04), **timeline** (R2-05), and **notes/tasks** (R2-06). Baseline sections below describe the
> one-BOM prototype; §5 describes the v2 shape.

## 1. Purpose (baseline)

Every order lives in a named **project**. Create/open a project → upload its BOM (standard template)
→ server reconciles against stock → in-stock/to-order split → hand off to the Ordering workspace.
Saved runs stay on the project.

## 2. Current behaviour (as prototyped)

### Projects list (root)
- **New project** card: name (required) + client (optional) → Create.
- **Project cards:** name · client · status pill (`draft` / `sourced`) · BOM chip · created date.
  Click opens the workspace. Projects persist (sessionStorage in proto; DB in real app).

### Project workspace (inside a project)
- Header: ← All projects · project name · client · **Download template ↓** (the standard `.xlsx`:
  BOM columns `# Reference Qty Value Footprint DNP Description MPN Manufacturer PartLink LCSC PN` +
  per-line `Priority / Notes` + one `Overall priorities` cell).
- **Empty:** dashed drop zone + sample BOMs (TMCS_96x32 / GCU_V1.1).
- **Loaded (reconciled):** priorities-from-sheet quote card · stat trio (lines / in stock / to
  order) · lines table (# · Reference · Qty · Value · Footprint · MPN · status tag `In stock ·
  Shelf B · Box B-12` or orange `To order`) · **Set up ordering →**.
- Reconcile ladder (server): MPN → LCSC PN → value+package fuzzy; in-stock lines show location and
  are never searched by agents.

## 3. Data touched

| Read | Write |
|---|---|
| projects, parts (reconcile) | `smark_projects` (create), `smark_boms` + `smark_bom_lines` (parse upload, match_state), R2 source file |

## 4. Talks to (edges)

- → **Ordering workspace** with the active project + BOM (A2-1).
- ← **Agent run** persists the run on the project; card status `draft → sourced` (A2-4).
- ← **Bulk pick** "To order →" lands here with unresolved lines (A2-12).
- ← **Part detail** "Order more" (single-part entry).
- Reconcile shares the matcher with Bulk pick; priorities text flows through to the planner.

## 5. Round-2 changes

### R2-03 — Projects tab with multiple named BOMs per project 🟢

- **Nav rename:** "Orders" → **"Projects"** (rail + mobile tab + screen title). Route `#/projects`.
- **Projects list:** unchanged card grid, but the BOM chip becomes a **BOM count** (`3 BOMs`) and
  status pill derives across the project (see below).
- **Project hub (replaces single-BOM workspace)** — section layout inside a project:
  1. **Overview** — client, status, timeline strip (R2-05), quick stats.
  2. **BOMs** — list of uploaded BOMs, **each with a user-given name** (e.g. "Mainboard v1.2",
     "Display panel rev B"): name · line count · in-stock/to-order split · sourcing status
     (`draft / sourced / ordered`) · uploaded date/by. **Upload BOM** (name required, template
     download stays) adds to the list — never replaces. Open a BOM → reconcile table view (baseline
     behaviour, now per-BOM) → **Set up ordering →** for THAT BOM.
  3. **Team & hours** (R2-04) · 4. **Documents** (R2-16) · 5. **Notes & tasks** (R2-06) ·
  timeline + progress strip in Overview (R2-05/R2-14); payments strip parked (R2-15 🔵).
- **Pipeline scoping:** ordering workspace / agent run / review / saved runs all hang off a
  **(project, BOM)** pair, not the project. Each BOM keeps its own distributor sequence, priorities,
  and saved run. Re-entering shows that BOM's saved state.
- **Project status pill** now derived: `draft` (no BOM sourced) / `sourcing` (any run active) /
  `sourced` (≥1 BOM sourced) — refine when client reacts.

### R2-08/R2-10 (ripple) — BOM view: stored reviews + contested stock 🟢

- A sourced BOM's row opens its **stored review** (R2-08) — selections/cart-adds as left.
- Reconcile table: in-stock lines whose part is **contested across projects** (combined demand >
  stock, R2-10) get an orange "shortfall in cart ×100" chip instead of a plain in-stock tag.

### R2-04 — Team & hours section 🟡 (mechanics → Q-03)

- **Assign employees:** **owner-only** (confirmed by R2-18: "owner should be able to assign
  engineers") — adds/removes members from `smark_app_users`; member chips with display name + role.
- **Hours table:** per member — hours this week / total on this project; expandable to dated
  entries. Data = `smark_time_entries`; whether entries are derived from attendance check-ins or
  typed manually is **Q-03** — UI shells planned either way.
- Assignment list feeds Attendance's "working-on" selector (`tab-attendance.md`).

### R2-05 — ⚪ superseded by R2-30 (phase timeline builder below)

Was: minimal start/delivery dates + note, sharing parked on Q-04. Q-04 closed with the estimate
sheet → full phase timeline (R2-30) + client portal (R2-38).

### R2-14 — Performance & completion tracking 🟢 (Q-07 closed)

Progress derives from the **phase timeline (R2-30)**: completion % = **duration-weighted done
phases**; on-track chip = today vs the ACTIVE phase's end date (buffer rows absorb delay before
"late" shows); parallel rows sit outside the math; project "done" = final phase done + owner
confirm (stamps `completed_at`). No manual slider. Same % + chip render on the client portal.

### R2-15 — Payments per project 🟢 (activated by Q-09)

Payments = **income entries with this project's link** (entered in Expenses). The hub Overview
gains a **Payments strip**: total received · entry list (date, amount, account) · owner/accountant
only (matrix). No separate payments table — one finance ledger, two views.

### R2-30 — Phase timeline builder 🟢 (replaces R2-05's two-date minimal)

Modeled directly on their real estimate sheet ("Estimated timeline for Multi-Channel Acoustic
Sensing System, V1.1"):

- **Phase table editor** on the Overview: rows of **Phase name · Start date · End date · Duration
  (free text — their sheet has "9-10 days", "Running parallel with design") · Tasks/Notes**;
  add/remove/reorder; special row kinds supported: **parallel** phases (no own dates), **buffer**
  rows, and **footnotes** (their "Note1: enclosure scope not included…" pattern).
- **"The project will proceed according to it":** each phase has status (pending / active / done);
  exactly one active at a time (owner advances it); the active phase + its end date drive the
  on-track chip and (per Q-07) completion %.
- Version label (their V1.1 habit): editing dates bumps a small `v` counter; timeline edits are
  logged in the activity feed as `change` entries — the client-visible history of slips.
- Rendered on the **client portal** (R2-38) — same table, read-only, current phase highlighted.
- Est. delivery date = last phase's end (replaces the standalone `est_delivery_date` input).

### R2-32 — Archive / close project 🟢 (approved I-02, "give a warning")

**Archive** action on the hub (owner-only): warning dialog spelling out consequences — *"releases
all cart demand from this project's BOMs, freezes activity/tasks, hides it from active lists and
pickers; portal link stops resolving"* — confirm to proceed; **unarchive** reverses. Archived
projects live under a filter on the Projects list. Supplies the archive-release half of Q-05.

### R2-16 — Documents section 🟢

New hub section **Documents**: upload any file with a **required display name** ("store everything
with its name") → R2 bucket; list = name · type icon · size · uploaded by/at · download/preview ·
delete (owner or uploader). Files also linkable from activity entries (a meeting note can reference
a document). Schema: `smark_project_documents`.

### R2-19 — Create a BOM in-app (+ remembered structure) 🟢

Next to "Upload BOM": **"Create BOM"** — spreadsheet-like grid editor:

- Starts from the **standard columns** (# · Reference · Qty · Value · Footprint · DNP · Description
  · MPN · Manufacturer · PartLink · LCSC PN · Priority/Notes) with required-field validation
  (Reference, Qty, Value at minimum — mirrors template rules).
- **"+ Add field"** appends a custom column (name + type text/number) — sheet-like.
- **Structure memory:** on save, the column set (incl. custom columns, order, requireds) is stored
  as the company's **BOM template** (`smark_bom_templates`) and prefills the next Create-BOM (and
  the downloadable xlsx template gains the custom columns too — one structure everywhere).
- Saved BOM enters the exact same path as an upload: named per R2-03, reconciled, sourceable.
  Custom-column values ride along in `smark_bom_lines.extra` and show in the lines table.

### R2-06 — Notes, changes & tasks per project 🟢

- **Notes & tasks section:** chronological feed of typed entries — **Note · Meeting · Change ·
  Task** — each: title/body, author, timestamp. Owner **and** employee can add (accountant → Q-01).
- **Tasks** additionally get: optional assignee (project member), optional due date, open/done
  toggle; open-task count badges on the section header and project card.
- **"Change" type** = client-requested change record (fits their review-driven workflow); shows an
  orange chip so scope changes stand out in the feed.
- Feed is append-only with edit-window for the author (default 15 min) — keeps it audit-friendly
  without heavy versioning.

## 6. Open questions on this tab

*(none — all questions closed)*
