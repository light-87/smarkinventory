# SCHEMA.md — Supabase data model (living)

> Baseline = FEATURES.md §11, restated here so schema edits happen in ONE place from now on.
> Conventions (global standards): every table prefixed `smark_`, `uuid` PK `id`,
> `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ`, RLS ON, `created_by` on mutating
> tables. Files → R2, never Supabase storage.
>
> **Editing rule:** every change is tagged `[R2-NN]` inline. New columns go under their table with the
> tag; new tables get a tag in the heading. Removals are struck through, not deleted, until build.

## Change ledger (schema-only view)

| R2 id | Delta | Tables |
|---|---|---|
| R2-01 | New users/roles table; RLS baseline rewritten around owner/employee/accountant; all `actor`/`created_by`/`started_by`/`uploaded_by`/`placed_by` columns now FK → `smark_app_users.id` | `smark_app_users` (new), RLS §, every mutating table's actor columns |
| R2-02 | Attendance records (check-in/out + current-project tag) — field set draft until Q-03 | `smark_attendance` (new) |
| R2-03 | Many named BOMs per project — `name` required + unique per project; per-BOM sequence/priorities/run already structurally supported; project status derived | `smark_boms` |
| R2-04 | Project team membership + per-project hour logs (source model pending Q-03) | `smark_project_members`, `smark_time_entries` (new) |
| R2-05 | Minimal timeline columns on projects (sharing mechanics parked → Q-04) | `smark_projects` |
| R2-06 | Project activity feed — note/meeting/change/task entries, tasks with assignee/due/done | `smark_project_activities` (new) |
| R2-07 | Day-digest read model (attendance + movements + ordering per day/person) — view only, no new table | `v_daily_activity` view |
| R2-08 | Review persists with the run: selection + cart-add stamps on results | `smark_agent_results` |
| R2-09 | Cart lines (review/auto/manual sources, per-project demand breakdown, editable qty, price) | `smark_cart_items` (new) |
| R2-10 | Cross-project demand + shortfall computation (lifecycle → Q-05) | `v_part_demand` view |
| R2-11 | Per-part last price + inventory value | `smark_parts` |
| R2-12 | Orders go global: `bom_id` dropped from orders, required unique `po_number`, receipt upload + AI extraction fields | `smark_orders`, `smark_order_lines` |
| R2-13 | Living record enriched: `price_change` + `location_moved` event types, `price_old/new`, `order_id` ref; client shown via project join | `smark_part_events` |
| R2-14 | Completion/performance columns (draft until Q-07) | `smark_projects` |
| R2-16 | Named per-project document uploads | `smark_project_documents` (new) |
| R2-17 | AI pseudonym map (client/project/product → code) | `smark_ai_aliases` (new) |
| R2-19 | In-app BOM builder: remembered column structure + custom line values | `smark_bom_templates` (new), `smark_bom_lines.extra` |
| R2-20 | Owner expense/income entries (fields DRAFT until Q-09) | `smark_expenses` (new) |
| R2-21 | Monthly/yearly/category rollups for expense charts | `v_expense_rollups` view |
| R2-23 | Remembered custom part-form fields; values → attributes jsonb | `smark_part_field_templates` (new) |
| R2-24 | Voltage promoted to a typed column (split from value strings) | `smark_parts.voltage` |
| R2-27 | Build-quantity multiplier per BOM (all needs × build_qty) | `smark_boms.build_qty`, `v_part_demand` |
| R2-28 | Expense accounts (cash/bank/UPI); distributors become addable with keys | `smark_expense_accounts` (new), `smark_expenses.account_id` |
| R2-30 | Phase timeline per project (estimate-sheet model) + portal share token | `smark_project_phases` (new), `smark_projects.share_token` |
| R2-32 | Archive/close project (releases demand, freezes activity) | `smark_projects.archived_at` |
| R2-35 | Label print queue | `smark_qr_labels.print_status` |
| R2-36 | In-app notifications | `smark_notifications` (new) |
| Q&A r3 | Q-01/02/03/06/09 closures: RLS matrix FINAL (accountant writes expenses); time entries manual-only; orders per distributor (PO = website order number); expenses fields FINAL (+vendor, GST) | RLS §, `smark_time_entries`, `smark_orders`, `smark_expenses` |

---

## 0. Users & auth `[R2-01]`

### `smark_app_users` `[R2-01]`
Profile row per login; `id` = `auth.users.id` (Supabase Auth email+password; username maps to a
synthetic email `{username}@smark.internal` so the visible identity stays a plain username).

| Column | Type / notes |
|---|---|
| `id` | uuid PK = `auth.users.id` |
| `username` | text UNIQUE — login handle shown in UI |
| `display_name` | text |
| `role` | text CHECK IN (`owner`, `employee`, `accountant`) — matrix per role pending **Q-01** |
| `active` | bool default true — deactivate blocks login, never hard-delete (history FKs) |
| `created_by` | uuid → smark_app_users (the owner who added them) |

Helper for policies: `smark_role()` = SQL function reading the caller's role from this table (or
mirrored into JWT `app_metadata` on change for cheaper policy checks — decide at build).

**Actor columns everywhere:** `smark_movements.actor`, `smark_part_events.actor`,
`smark_agent_runs.started_by`, `smark_boms.uploaded_by`, `smark_orders.placed_by`, all `created_by`
→ FK `smark_app_users.id` (replaces the prototype's hardcoded "SA"/"RT" initials).

## 1. Catalog & reference

### `smark_parts`
| Column | Type / notes |
|---|---|
| `internal_pid` | short QR value, `SMK-000482`; unique |
| `mpn`, `manufacturer`, `lcsc_pn`, `description` | text |
| `category` | typed facet (Capacitor / Resistor / IC / Module / SMPS / Connector / Inductor…) |
| `value`, `package` | typed facets; package participates in mandatory match |
| `voltage` `[R2-24]` | typed facet, split out of combined value strings (`0.1µF/50V` → `0.1µF` + `50V`); import + reconcile mappers updated |
| `part_status` | active / nrnd / eol |
| `datasheet_url`, `default_distributor` | text |
| `attributes` | jsonb (tolerance, voltage, dielectric, wattage, current, pin count…) GIN-indexed |
| `total_qty` | denormalized rollup over `smark_stock_locations` |
| `reorder_point` | low-stock threshold per part |
| `source_sheet`, `needs_review` | import provenance + onboarding flag |
| `last_unit_price` `[R2-11]` | numeric(12,2) ₹ — stamped on arrival from the order line (manual entry R2-09 or receipt extraction R2-12); price history stays in `smark_part_events.unit_price` |
| `currency` `[R2-11]` | text default `INR` |

### `smark_distributors`
`name`, `api_type` (rest / browse / none), `base_url`, `default_region`, `active`.

### `smark_projects`
`name`, `code`, `notes` — plus round-1 additions used by the prototype: `client` (owner label),
`status` (draft / sourced), `saved_run` snapshot reference (see `smark_agent_runs`).

`[R2-03]` `status` becomes **derived** across the project's BOM runs (draft / sourcing / sourced) —
no stored column needed beyond a cached value; `saved_run` moves to per-BOM (see `smark_boms`).
`[R2-05]` add `est_start_date date`, `est_delivery_date date`, `timeline_note text` — minimal until
Q-04 resolves the client-sharing mechanics (no share/portal columns yet).
`[R2-14 · Q-07 FINAL]` `completed_at date nullable`; `completion_pct` column DROPPED — completion %
is derived: duration-weighted done phases (see `smark_project_phases`); on-track = today vs active
phase's end date (buffer rows absorb delay first); done = last phase done + owner confirm.
`[R2-30]` `share_token text unique nullable` — capability token for the client portal (regenerate =
revoke). `[R2-32]` `archived_at timestamptz nullable` — archive releases cart demand, freezes
activity, hides from active lists/pickers; portal link stops resolving while archived.

### `smark_project_phases` `[R2-30]` (new — the estimate-sheet timeline)
| Column | Type / notes |
|---|---|
| `project_id`, `sort_order` | FK + row order |
| `name` | "Schematic Design + Review", "Buffer/Delays"… |
| `start_date`, `end_date` | date, nullable (parallel rows have none) |
| `duration_text` | free text — their sheet says "9-10 days", "Running parallel with design" |
| `notes` | tasks/notes column ("3 PCBs", vendor lead time…) |
| `row_kind` | `phase` \| `parallel` \| `buffer` \| `footnote` (their Note1 pattern) |
| `status` | `pending` \| `active` (exactly one) \| `done` — owner advances; drives on-track + completion (Q-07) |
| `version_label` | small `v` counter bumped on date edits; edits also logged as `change` activities |

## 2. Physical location — Shelf → Big Box → ESD plastic

### `smark_shelves`
`code` (`A`…), `name`, `location_note`.

### `smark_big_boxes`
`shelf_id`, `name`, `category` (drives storage suggestion), `notes`, `qr_label_id`.

### `smark_stock_locations` — the ESD plastic
`part_id`, `big_box_id`, `qty`, `esd_note`, `last_counted_at`. One home per part normally; a second
row allowed for the bulk (reel + working box) case. Carries the part QR.

## 3. BOMs & reconciliation

### `smark_boms`
`name`, `project_id`, `source_file_url` (R2), `uploaded_by`, `line_count`,
`distributor_sequence jsonb` (single per BOM, set in-app), `priority_notes` (overall, from template).

`[R2-03]` a project now holds **many** BOMs: `name` is the user-given label ("Mainboard v1.2"),
**required + UNIQUE per project** (`UNIQUE(project_id, name)`). Add `sourcing_status`
(draft / sourced / ordered) + `saved_run_id → smark_agent_runs` so each BOM keeps its own pipeline
state (replaces the project-level saved run).
`[R2-19]` add `created_in_app bool` (built with the grid editor vs uploaded file).
`[R2-27]` add `build_qty int default 1` — units to build; every need = line qty × build_qty
(reconcile, skip-buy, agent min-qty, demand view, takeout). Changing it after a run marks the saved
run stale.

### `smark_bom_templates` `[R2-19]` (new — remembered Create-BOM structure)
`columns jsonb` (`[{key, label, type, required, is_custom}]` — standard set + user-added columns,
order preserved), `created_by`, `last_used_at`. One active template for the company (v1); Create-BOM
prefills from it and re-saves on change; the downloadable xlsx template renders the same columns.
Custom-column **values** live in `smark_bom_lines.extra jsonb` `[R2-19]`.

### `smark_bom_lines`
`bom_id`, `line_no`, `references` (raw `C3,C69…`), `qty`, `value`, `footprint` (raw), `dnp bool`,
`description`, `mpn`, `manufacturer`, `part_link`, `lcsc_pn`, `priority_note`,
`matched_part_id`, `match_state` (in_stock / to_order / unresolved), `match_confidence`.

## 4. Ordering — runs, results, orders

### `smark_order_jobs` (worker queue)
`run_id`, `bom_line_id`, `plan jsonb`, `status` (queued / claimed / done / failed), `claimed_at`,
`attempts`. Claimed atomically (`FOR UPDATE SKIP LOCKED`).

### `smark_agent_runs`
`bom_id`, `status` (planning / running / review / done / failed), `concurrency_preset`,
`fanout_width`, `depth_per_item`, `per_site_cap`, `est_cost`, `actual_cost`, `plan jsonb`,
`rules_doc_version`, `started_by`.

### `smark_agent_results` (streamed to UI)
One row per (run, bom_line, distributor option): `run_id`, `bom_line_id`, `part_id`,
`distributor_id`, `price`, `qty_breaks jsonb`, `stock_qty`, `mpn_match` (exact / approx / none),
`package_match bool`, `part_status`, `order_link`, `is_recommended`, `raw jsonb`, `confidence`.

`[R2-08]` add `selected bool` + `selected_by/at` — the review's chosen option persists with the run
so a stored review reopens exactly as left (cart-adds referenced from `smark_cart_items`).

### `smark_cart_items` `[R2-09]` (new — the smart cart, stage before an order)
| Column | Type / notes |
|---|---|
| `part_id` | FK, nullable for never-catalogued parts (then `descriptor jsonb` carries mpn/value/pkg) |
| `source` | `review_add` \| `auto_shortfall` \| `manual` |
| `demand jsonb` | per-project breakdown `[{project_id, bom_id, bom_line_id, qty}]` — one cart line per part, aggregated across projects `[R2-10/12]` |
| `qty_to_order` | editable; prefill = shortfall or review qty |
| `chosen_result_id` | → smark_agent_results (distributor + link), changeable |
| `unit_price` | numeric — typed at cart stage ("ask them to add price"), receipt-extract can overwrite `[R2-12]` |
| `status` | `open` \| `dismissed` (auto lines only; dismissal remembered until demand changes, Q-05) \| `ordered` (moved into an order) |

### `smark_orders` `[R2-12 rework · Q-06 final]`
~~`bom_id`~~ dropped — an order is **global across projects**; traceability lives on lines.
`[Q-06]` checkout groups cart lines **by distributor** → one row per distributor group:
`distributor_id` + `po_number` = **the website's order number** (required, UNIQUE — used to match
deliveries). `status` (ordered / partially_arrived / arrived) · `placed_by`, `placed_at`, `notes` ·
`receipt_url` (R2 file) · `receipt_extracted jsonb` (AI-parsed, user-confirmed) `[R2-12]` ·
placing an order auto-creates a **draft `smark_expenses` row** (owner confirms) `[Q-09]`.

### `smark_order_lines`
`order_id`, `cart_item_id` `[R2-09]`, `bom_line_id` (nullable — traceability), `project_id`
`[R2-12]` (denorm for grouping), `part_id`, `chosen_distributor_id`, `chosen_result_id`,
`qty_ordered`, `unit_price`, `line_status` (ordered / arrived), `arrived_qty`, `arrived_at`.
`to_order` state now lives in the cart, not here `[R2-09]`.

## 5. Learning loop

### `smark_agent_feedback`
`result_id`, `comment`, `feedback_tag` (wrong_package / prefer_distributor / already_stocked /
price_wrong / other), `created_by`, `converted_rule_id`. Whole-order remarks attach at run level
(result_id nullable, run_id set).

### `smark_learned_rules`
`scope` (global / category / part / project / distributor), `subject`, `rule_type`
(prefer_distributor / avoid_distributor / already_stocked / package_correction / status_preference /
price_source_note), `value jsonb`, `confidence`, `source_feedback_id`, `status`
(suggested / active / retired), `superseded_by`.

### `smark_learned_rules_doc`
`version` (v1, v2…), `content` (human-readable digest of active rules → injected into Opus prompt),
`change_summary`.

### `smark_distributor_preferences`
`distributor_id`, `rank`, `enabled` — the global default the per-BOM sequence editor starts from.

### `smark_ordering_rules` (standard search ladder)
`key` (mpn / lcsc / value / package / status / qty / cost / custom), `enabled`, `mandatory bool`
(package = true, non-disableable), `params jsonb`, `rank`. Settings "Add rule" inserts `custom` rows.

## 6. History, movements, labels

### `smark_part_events` (append-only living record)
`part_id`, `event_type` (ordered / received / adjusted / note), `distributor`, `order_link`,
`project_id`, `reason`, `qty`, `unit_price`, `location_big_box_id`, `actor`, `source_run_id`,
`occurred_at`.

`[R2-13]` enrichment — "everything written on it with timestamps":
- `event_type` extended: + `picked` (formalized) + `price_change` (auto-logged when
  `last_unit_price` changes) + `location_moved`.
- `price_old`, `price_new` numeric nullable — populated on `price_change` rows.
- `order_id` → `smark_orders` — PO chip + "where it was ordered from" (with `distributor`).
- Client attribution = render-time join `project_id → smark_projects.client` (no denormalized copy).

### `smark_movements`
`part_id`, `big_box_id`, `delta_qty`, `reason` (pick / receive / adjust / bulk_pick / undo),
`bom_id`, `actor`, `undo_of` (nullable → powers Undo).

### `smark_qr_labels`
`target_type` (part | big_box), `target_id`, `code_value` (PID or big-box id), `human_text`,
`png_url` (R2), `label_pdf_url`, `printed_at`, `batch_id`.

## 7. Team & project management `[R2-02 / R2-04 / R2-06]`

### `smark_attendance` `[R2-02]` — self-marked confirmed by R2-07 (Q-03(a) closed); hours model still Q-03(b)
| Column | Type / notes |
|---|---|
| `user_id` | → smark_app_users |
| `work_date` | date — one logical row per user per day (`UNIQUE(user_id, work_date)`) |
| `check_in`, `check_out` | timestamptz — model assumes tap-in/tap-out (Q-03 may change) |
| `current_project_id` | → smark_projects — "what they're working on", switchable during the day |
| `note` | text (late reason etc.) |

### `smark_project_members` `[R2-04]`
`project_id`, `user_id`, `assigned_by`, `active bool` — `UNIQUE(project_id, user_id)`. Feeds the
attendance "working-on" picker and the task assignee list (R2-06).

### `smark_time_entries` `[R2-04 · Q-03 FINAL]` — manual entry only
| Column | Type / notes |
|---|---|
| `project_id`, `user_id` | FKs |
| `work_date` | date |
| `hours` | numeric(4,1) |
| `note` | text |
| `entered_by` | self or owner (owner can add/correct anyone's) — ~~source derived model~~ dropped per Q-03 |

### `smark_project_activities` `[R2-06]`
| Column | Type / notes |
|---|---|
| `project_id` | FK |
| `type` | `note` \| `meeting` \| `change` \| `task` |
| `title`, `body` | text |
| `task_assignee` | → smark_app_users, nullable (task only) |
| `task_due` | date, nullable |
| `task_done`, `task_done_at` | bool + timestamptz, nullable |
| `created_by` | → smark_app_users (owner or employee; accountant per Q-01) |

Append-only; author edit-window enforced in app (default 15 min), not in schema.

### `smark_project_documents` `[R2-16]`
`project_id`, `display_name` (required — "with its name"), `file_url` (R2), `mime_type`,
`size_bytes`, `note`, `uploaded_by`. Delete = owner or uploader; row kept soft-deleted.

### `smark_ai_aliases` `[R2-17]` (pseudonym map — server-side only, never sent to clients)
`entity_type` (`client` | `project` | `product` | `custom`), `entity_id uuid`, `alias` (e.g.
`CLIENT-A`, `PROJ-03`; UNIQUE), `created_at`. Applied to every Claude call carrying business
context; de-aliased server-side on the way back. **Explicit exception:** MPN / LCSC PN / package /
distributor names pass through real (public catalog identifiers — search breaks without them).
Project descriptions & notes are excluded from AI context entirely. Purpose/scope of the
"all-context model" → Q-08.

### `smark_expenses` `[R2-20 · Q-09 FINAL]`
| Column | Type / notes |
|---|---|
| `entry_type` | `expense` \| `income` |
| `amount` | numeric(14,2), `currency` default INR |
| `entry_date` | date |
| `category` | Materials / Salaries / Rent / Utilities / Tools / Client payment / Other |
| `account_id` `[R2-28]` | → smark_expense_accounts |
| `vendor` `[Q-09]` | text — party/distributor |
| `gstin`, `tax_amount` `[Q-09]` | optional GST fields |
| `project_id` | nullable — set = this IS a project payment (R2-15 🟢) |
| `note`, `attachment_url` | text / R2 file |
| `is_draft` `[Q-09]` | bool — PO-auto-created entries start true until owner confirms |
| `source_order_id` `[Q-09]` | nullable → smark_orders (the PO that spawned it) |
| `created_by` | **owner or accountant** writes (Q-01 final); soft delete for audit |

### `smark_expense_accounts` `[R2-28]`
`name` (e.g. "HDFC current", "Cash box", "Owner UPI"), `account_type` (`cash` | `bank` | `upi`),
`active`. Owner-only CRUD (Settings card); entries reference an account.

### `smark_part_field_templates` `[R2-23]` (remembered custom part-form fields)
`label`, `field_key` (slug), `field_type` (`text` | `number`), `active`, `created_by`. Offered on
every New-part form after first save; values stored in `smark_parts.attributes` jsonb (GIN-indexed
→ deep-filterable). Retire in Settings.

### `smark_notifications` `[R2-36]`
`user_id` (recipient), `kind` (arrival / task_assigned / rule_pending / low_stock / run_done /
expense_draft / portal_comment), `title`, `body`, `link` (deep link), `read_at nullable`.
Fan-out per role matrix; bell badge = unread count.

`[R2-35]` `smark_qr_labels.print_status` (`queued` | `printed`) — batch sheet printing; "Print
sheet" renders all queued onto one Avery PDF and flips them printed.

## 8. Derived views `[R2-07 / R2-10 / R2-21]`

### `v_daily_activity` `[R2-07]`
Union view powering Daily Reports: (movements ∪ part events ∪ run starts/finishes ∪ cart adds ∪
orders placed ∪ arrivals) × (actor, occurred_at, day) + attendance/time entries joined per person.
Read-only; no new write path.

### `v_part_demand` `[R2-10 · Q-05 FINAL]`
Per part: `demand` = Σ (line qty × `bom.build_qty` `[R2-27]`) over matched lines in **active,
reconciled** BOMs of **non-archived** projects (per-project breakdown), `available` = `total_qty`,
`shortfall` = GREATEST(demand − available, 0). Lifecycle: registers at reconcile; released per-line
by bulk takeout of that line, arrival allocation, or project archive (R2-32). Shortfall > 0 with no
open auto line → insert `smark_cart_items` (source `auto_shortfall`); dismissed lines resurrect
only if shortfall grows beyond the dismissed qty. Recompute on reconcile, BOM upload/archive,
movements, build_qty change.

### `v_expense_rollups` `[R2-21]`
Monthly/quarterly/yearly sums by type, category, account, project — powers the Expenses charts and
the owner tiles. Shape finalizes with Q-09.

---

## RLS matrix — FINAL `[Q-01 closed]`

Roles: **owner / employee / accountant** (`smark_app_users.role` via `smark_role()`).
~~Manager/Admin + Technician (FEATURES.md v1)~~ superseded. Matrix (canonical copy in
`tab-login-shell.md`; enforced as tests per TESTING.md):

- **owner:** full everything.
- **employee:** read+write all operational tables (parts, locations, movements, receives, BOMs,
  runs, cart, feedback, activities, own attendance/time entries); **no** Settings tables, learned-
  rule approval, user mgmt, expenses (no read), others' daily data.
- **accountant:** read-only operational tables; **read+WRITE `smark_expenses`** (client amendment)
  + expense accounts read; read all daily/attendance/time data; no mutations elsewhere, no Settings.
- `smark_app_users`: readable by all authed (names in history); INSERT/UPDATE owner-only.
- Client portal (R2-38): anonymous role via `share_token` — SELECT only through dedicated
  security-definer functions (phases, shared activities/documents); INSERT limited to portal
  comments. Token never grants table-level access.
- Single tenant; `tenant_id` seam deferred.

## Derived / denormalized values to keep in sync

| Value | Source of truth | Sync point |
|---|---|---|
| `smark_parts.total_qty` | sum of its `smark_stock_locations.qty` | every movement / receive / adjust |
| Project card status (draft/sourcing/sourced) `[R2-03]` | its BOMs' `sourcing_status` + active runs | run persist / BOM upload |
| BOM `sourcing_status` `[R2-03]` | latest `smark_agent_runs` for that BOM | run persist / mark-ordered |
| Project hours rollup `[R2-04]` | sum `smark_time_entries` per project/member | entry write (Q-03 model) |
| Open-task badge `[R2-06]` | count `smark_project_activities` type=task, not done | activity write |
| `last_unit_price` `[R2-11]` | most recent arrived order line (or receipt extraction) | arrival confirm |
| Inventory value ₹ `[R2-11]` | Σ `total_qty × last_unit_price` (unpriced excluded) | read-time (dashboard) |
| Auto-shortfall cart lines `[R2-10]` | `v_part_demand.shortfall` | demand recompute triggers (Q-05) |
| Rules digest `v{N}` | active `smark_learned_rules` | every approve / retire |
| Dashboard stats | plain queries/views over the above | read-time |
