-- ============================================================================
-- 0005_views_fks.sql — SmarkStock: deferred cross-domain FKs + derived views
--
-- Owns:       (no new tables) — closes out FK debt left by 0001–0004, closes
--             out table-level GRANT debt left by 0001/0003/0004 (see Part B),
--             then adds the three read-only derived views: v_part_demand,
--             v_daily_activity, v_expense_rollups.
-- Depends on: 0001_users_team, 0002_catalog_location, 0003_projects_boms,
--             0004_ordering_finance — every table referenced below now exists.
--
-- Part A — deferred FK ALTERs. Migrations 0001–0003 declared several columns
-- as plain `uuid` (no FK) because the table they point at didn't exist yet at
-- that point in the apply order; each was left with a `-- FK added in 0005`
-- comment. All eight are closed out here. ON DELETE choice per column:
--   · NOT NULL, "belongs entirely to its parent" child rows (project_members,
--     time_entries) → CASCADE, matching the sibling project-owned tables
--     from 0003 (phases/documents/activities/boms already cascade).
--   · Nullable "which BOM/project/order/run is this about" tags on rows that
--     must themselves survive regardless (attendance, movements, the
--     append-only smark_part_events, smark_boms.saved_run_id) → SET NULL.
--   No CASCADE ever reaches an append-only or financial-history row — see
--   inline comments.
--
-- Part B — table-level GRANTs. Same root cause as the FKs above but for
-- privileges, not references: 0002 diagnosed it and fixed its own tables;
-- this closes the gap for every table 0001/0003/0004 left ungranted (see
-- that section's header for the full story) in one pass.
--
-- Part C — views. All three use `security_invoker = true` (PG15+) so they
-- re-check the CALLING role's RLS on every underlying table rather than the
-- view owner's — e.g. an employee querying v_expense_rollups still sees
-- ZERO rows (smark_expenses RLS = owner/accountant only), and an employee
-- querying v_daily_activity sees only their OWN smark_attendance/
-- smark_time_entries rows (per-actor RLS on those two tables) alongside the
-- broadly-readable operational tables — no view-level role logic needed.
-- Views need their own SELECT grant too (same ACL root cause) — added at the
-- end of Part C.
-- ============================================================================


-- ============================================================================
-- Part A — deferred FK ALTERs
-- ============================================================================

-- 0001: smark_attendance.current_project_id → smark_projects(id)
-- Nullable "what are you working on" tag — SET NULL so a hard-deleted
-- project never deletes someone's attendance day.
alter table public.smark_attendance
  add constraint smark_attendance_current_project_id_fkey
  foreign key (current_project_id) references public.smark_projects (id) on delete set null;

-- 0001: smark_time_entries.project_id → smark_projects(id)
-- NOT NULL, wholly-owned-by-the-project row (a per-project hour log) — CASCADE,
-- matching smark_boms/phases/documents/activities from 0003.
alter table public.smark_time_entries
  add constraint smark_time_entries_project_id_fkey
  foreign key (project_id) references public.smark_projects (id) on delete cascade;

-- 0001: smark_project_members.project_id → smark_projects(id)
-- NOT NULL, wholly-owned-by-the-project row — CASCADE (same reasoning).
alter table public.smark_project_members
  add constraint smark_project_members_project_id_fkey
  foreign key (project_id) references public.smark_projects (id) on delete cascade;

-- 0002: smark_movements.bom_id → smark_boms(id)
-- Nullable audit-trail tag — SET NULL so a deleted BOM never deletes
-- movement history (total_qty rollup correctness doesn't depend on bom_id).
alter table public.smark_movements
  add constraint smark_movements_bom_id_fkey
  foreign key (bom_id) references public.smark_boms (id) on delete set null;

-- 0002: smark_part_events.project_id → smark_projects(id)
-- Append-only living record (0002: "No UPDATE/DELETE policies by design") —
-- SET NULL so the row itself is NEVER at risk from a project deletion.
alter table public.smark_part_events
  add constraint smark_part_events_project_id_fkey
  foreign key (project_id) references public.smark_projects (id) on delete set null;

-- 0002: smark_part_events.order_id → smark_orders(id) [0004, R2-13]
-- Same append-only reasoning — SET NULL.
alter table public.smark_part_events
  add constraint smark_part_events_order_id_fkey
  foreign key (order_id) references public.smark_orders (id) on delete set null;

-- 0002: smark_part_events.source_run_id → smark_agent_runs(id) [0004]
-- Same append-only reasoning — SET NULL.
alter table public.smark_part_events
  add constraint smark_part_events_source_run_id_fkey
  foreign key (source_run_id) references public.smark_agent_runs (id) on delete set null;

-- 0003: smark_boms.saved_run_id → smark_agent_runs(id) [0004]
-- Nullable "which run is currently saved on this BOM" pointer — SET NULL so
-- a run cleanup never silently deletes the BOM that references it.
alter table public.smark_boms
  add constraint smark_boms_saved_run_id_fkey
  foreign key (saved_run_id) references public.smark_agent_runs (id) on delete set null;


-- ============================================================================
-- Part B — table-level GRANTs (closes out debt flagged by 0002)
--
-- 0002_catalog_location.sql diagnosed and fixed this for its own eight
-- tables, and left this exact note: "tables created by CLI migrations
-- (`supabase db reset` / `supabase start`) are owned by the `postgres` role,
-- which carries a MUCH narrower default ACL than `supabase_admin`... objects
-- created as `postgres` give anon/authenticated/service_role only
-- TRUNCATE/REFERENCES/TRIGGER — no SELECT/INSERT/UPDATE/DELETE. Without an
-- explicit GRANT, every query... fails at 'permission denied for table ...'
-- BEFORE Postgres ever reaches the RLS policies... for every role, INCLUDING
-- service_role (BYPASSRLS skips policy evaluation, not the coarser
-- table-level privilege check)." — and explicitly asked for "a follow-up
-- migration [to] grant every smark_ table in one pass".
--
-- Verified locally (`supabase db reset` + `SET ROLE authenticated`): 0001's
-- and 0003's tables have the SAME missing grants as 0002 had before its own
-- fix — i.e. right now smark_app_users, smark_projects, smark_boms, etc. are
-- 100% unreachable via PostgREST regardless of how correct their RLS is.
-- This migration is the "follow-up migration" 0002 asked for: it closes the
-- gap for every remaining table (0001, 0003, and this file's own 0004
-- dependency) in one pass, using the exact same grant shape as 0002.
--
-- `authenticated` gets full CRUD at the GRANT layer for every table that has
-- at least one authenticated-facing RLS policy (0001/0003, and 0004's tables
-- EXCEPT the three deliberately service-role-only ones) — the RLS policies
-- already defined in each owning migration are what actually restrict by
-- role/row; a grant is inert for any command with no matching policy (RLS
-- default-denies). `anon` gets nothing (no anonymous surface exists yet;
-- the future client portal reads only through SECURITY DEFINER functions,
-- which run as the function owner, not the caller — FEATURES.md §11).
--
-- smark_order_jobs / smark_agent_results / smark_ai_aliases are the
-- exception: granted to `service_role` ONLY, not `authenticated` — this is
-- intentional belt-and-suspenders on top of their empty RLS policy set
-- (0004 §RLS): a direct client query against these now fails LOUDLY
-- ("permission denied") at the grant layer instead of silently returning
-- zero rows, which is a clearer signal that server-mediated access
-- (Route Handler / Server Action using the service-role client) is required.
-- ============================================================================

-- ---- 0001_users_team.sql tables --------------------------------------------
grant select, insert, update, delete on public.smark_app_users       to authenticated, service_role;
grant select, insert, update, delete on public.smark_attendance      to authenticated, service_role;
grant select, insert, update, delete on public.smark_time_entries    to authenticated, service_role;
grant select, insert, update, delete on public.smark_project_members to authenticated, service_role;
grant select, insert, update, delete on public.smark_notifications   to authenticated, service_role;

-- ---- 0003_projects_boms.sql tables -----------------------------------------
grant select, insert, update, delete on public.smark_projects           to authenticated, service_role;
grant select, insert, update, delete on public.smark_project_phases     to authenticated, service_role;
grant select, insert, update, delete on public.smark_project_documents  to authenticated, service_role;
grant select, insert, update, delete on public.smark_project_activities to authenticated, service_role;
grant select, insert, update, delete on public.smark_boms               to authenticated, service_role;
grant select, insert, update, delete on public.smark_bom_lines          to authenticated, service_role;
grant select, insert, update, delete on public.smark_bom_templates      to authenticated, service_role;

-- ---- 0004_ordering_finance.sql tables (normal RLS) -------------------------
grant select, insert, update, delete on public.smark_distributors             to authenticated, service_role;
grant select, insert, update, delete on public.smark_distributor_preferences  to authenticated, service_role;
grant select, insert, update, delete on public.smark_ordering_rules           to authenticated, service_role;
grant select, insert, update, delete on public.smark_agent_runs               to authenticated, service_role;
grant select, insert, update, delete on public.smark_cart_items               to authenticated, service_role;
grant select, insert, update, delete on public.smark_orders                   to authenticated, service_role;
grant select, insert, update, delete on public.smark_order_lines              to authenticated, service_role;
grant select, insert, update, delete on public.smark_agent_feedback           to authenticated, service_role;
grant select, insert, update, delete on public.smark_learned_rules            to authenticated, service_role;
grant select, insert, update, delete on public.smark_learned_rules_doc        to authenticated, service_role;
grant select, insert, update, delete on public.smark_expense_accounts         to authenticated, service_role;
grant select, insert, update, delete on public.smark_expenses                 to authenticated, service_role;

-- ---- 0004_ordering_finance.sql tables (service-role only — see above) -----
grant select, insert, update, delete on public.smark_order_jobs      to service_role;
grant select, insert, update, delete on public.smark_agent_results   to service_role;
grant select, insert, update, delete on public.smark_ai_aliases      to service_role;


-- ============================================================================
-- Part C — derived views
-- ============================================================================

-- ----------------------------------------------------------------------------
-- v_part_demand [R2-10 · Q-05 FINAL] — SCHEMA.md §8:
--   demand = Σ (line qty × bom.build_qty) over matched, non-DNP lines of
--   non-archived projects; available = total_qty; shortfall = GREATEST(demand
--   − available, 0). Permanent fixture (TESTING.md §16): 500 avail, A needs
--   400 + B needs 200 → shortfall exactly 100.
--
-- Design notes:
--   · "matched lines" = INNER JOIN on matched_part_id — a BOM that has never
--     been reconciled (matched_part_id still null on every line) naturally
--     contributes nothing, so no separate "reconciled" flag/column is needed.
--   · dnp=false and qty>0 are added filters (not populated → not demand).
--   · Demand does NOT stop counting once a BOM is "ordered" — SCHEMA.md's
--     lifecycle only releases it via bulk takeout of that line, arrival
--     allocation, or project archive (Q-05) — never by placing an order.
--   · One row per part that has ANY current demand (INNER JOIN throughout);
--     a part with zero demand simply has no row — callers treat "no row" as
--     demand=0/shortfall=0.
--   · `group by p.id` alone licenses selecting p.total_qty un-aggregated
--     (functional dependency on smark_parts' primary key, PG 9.1+).
-- ----------------------------------------------------------------------------
create view public.v_part_demand
with (security_invoker = true) as
select
  p.id as part_id,
  sum(bl.qty * b.build_qty)::integer as demand,
  p.total_qty as available,
  greatest(sum(bl.qty * b.build_qty) - p.total_qty, 0)::integer as shortfall,
  jsonb_agg(
    jsonb_build_object(
      'project_id', pr.id,
      'bom_id', b.id,
      'bom_line_id', bl.id,
      'qty', bl.qty * b.build_qty
    )
    order by pr.id, b.id, bl.id
  ) as breakdown
from public.smark_parts p
join public.smark_bom_lines bl
  on bl.matched_part_id = p.id
  and bl.dnp = false
  and bl.qty > 0
join public.smark_boms b
  on b.id = bl.bom_id
join public.smark_projects pr
  on pr.id = b.project_id
  and pr.archived_at is null
group by p.id;

comment on view public.v_part_demand is
  '[R2-10 · Q-05] Cross-project demand/shortfall per part over matched, non-DNP lines of non-archived projects (demand persists through ordering — only bulk takeout, arrival allocation, or project archive releases it). Fixture: 500 avail / 400+200 demanded → shortfall 100.';
comment on column public.v_part_demand.breakdown is
  'Per-project demand slices [{project_id,bom_id,bom_line_id,qty}] — same shape as smark_cart_items.demand.';


-- ----------------------------------------------------------------------------
-- v_daily_activity [R2-07] — SCHEMA.md §8: union skeleton powering Daily
-- Reports. (movements ∪ part_events ∪ run starts/finishes ∪ cart adds ∪
-- orders placed ∪ arrivals) + attendance/time_entries, one row per event.
-- Read-only; no new write path. Deliberately does NOT read smark_order_jobs
-- or smark_agent_results (both service-role-only, 0004 — and neither has
-- day/person "activity" meaning of its own; run lifecycle is represented via
-- smark_agent_runs' start/finish rows instead).
-- security_invoker means each branch's own RLS applies per caller: employee
-- gets only their own smark_attendance/smark_time_entries rows (per-actor
-- policies, 0001) alongside the broadly-readable operational branches —
-- matching FEATURES.md §5.13 "Employee sees self; owner all; accountant
-- read-all" without any role logic duplicated here.
-- ----------------------------------------------------------------------------
create view public.v_daily_activity
with (security_invoker = true) as
select * from (

  -- movement: every stock mutation (Scan/Bulk pick/Receive/adjust/undo)
  select
    (m.created_at)::date as work_date,
    m.created_at as occurred_at,
    m.actor as actor,
    'movement'::text as kind,
    m.id as ref_id,
    m.part_id as part_id,
    b.project_id as project_id,
    null::uuid as order_id,
    null::uuid as run_id,
    m.delta_qty::numeric as qty,
    -- reason_detail surfaces the guided-audit tag so an audit variance reads
    -- "adjust audit -3" vs a manual "adjust -3" in Daily Reports (FEATURES.md §5.4/§9).
    (m.reason || coalesce(' ' || m.reason_detail, '') || ' ' || m.delta_qty::text) as summary
  from public.smark_movements m
  left join public.smark_boms b on b.id = m.bom_id

  union all

  -- part_event: the living record (ordered/received/adjusted/note/picked/
  -- price_change/location_moved)
  select
    (pe.occurred_at)::date as work_date,
    pe.occurred_at as occurred_at,
    pe.actor as actor,
    'part_event'::text as kind,
    pe.id as ref_id,
    pe.part_id as part_id,
    pe.project_id as project_id,
    pe.order_id as order_id,
    pe.source_run_id as run_id,
    pe.qty::numeric as qty,
    (pe.event_type || coalesce(': ' || pe.reason, '')) as summary
  from public.smark_part_events pe

  union all

  -- run_started
  select
    (ar.created_at)::date as work_date,
    ar.created_at as occurred_at,
    ar.started_by as actor,
    'run_started'::text as kind,
    ar.id as ref_id,
    null::uuid as part_id,
    b.project_id as project_id,
    null::uuid as order_id,
    ar.id as run_id,
    null::numeric as qty,
    ('run started · ' || ar.concurrency_preset) as summary
  from public.smark_agent_runs ar
  join public.smark_boms b on b.id = ar.bom_id

  union all

  -- run_finished (done or failed; updated_at is stamped by the status-flip write)
  select
    (coalesce(ar.updated_at, ar.created_at))::date as work_date,
    coalesce(ar.updated_at, ar.created_at) as occurred_at,
    ar.started_by as actor,
    'run_finished'::text as kind,
    ar.id as ref_id,
    null::uuid as part_id,
    b.project_id as project_id,
    null::uuid as order_id,
    ar.id as run_id,
    null::numeric as qty,
    ('run ' || ar.status || coalesce(' · ₹' || ar.actual_cost::text, '')) as summary
  from public.smark_agent_runs ar
  join public.smark_boms b on b.id = ar.bom_id
  where ar.status in ('done', 'failed')

  union all

  -- cart_add
  select
    (ci.created_at)::date as work_date,
    ci.created_at as occurred_at,
    ci.created_by as actor,
    'cart_add'::text as kind,
    ci.id as ref_id,
    ci.part_id as part_id,
    null::uuid as project_id,
    null::uuid as order_id,
    null::uuid as run_id,
    ci.qty_to_order::numeric as qty,
    (ci.source || ' · ' || ci.status) as summary
  from public.smark_cart_items ci

  union all

  -- order_placed
  select
    (o.placed_at)::date as work_date,
    o.placed_at as occurred_at,
    o.placed_by as actor,
    'order_placed'::text as kind,
    o.id as ref_id,
    null::uuid as part_id,
    null::uuid as project_id,
    o.id as order_id,
    null::uuid as run_id,
    null::numeric as qty,
    ('PO ' || o.po_number) as summary
  from public.smark_orders o

  union all

  -- arrival (per order line; "who" isn't captured on order_lines today, so
  -- actor is null here — see smark_order_lines comment in 0004)
  select
    (ol.arrived_at)::date as work_date,
    ol.arrived_at as occurred_at,
    null::uuid as actor,
    'arrival'::text as kind,
    ol.id as ref_id,
    ol.part_id as part_id,
    ol.project_id as project_id,
    ol.order_id as order_id,
    null::uuid as run_id,
    ol.arrived_qty::numeric as qty,
    'arrived'::text as summary
  from public.smark_order_lines ol
  where ol.arrived_at is not null

  union all

  -- attendance: check-in
  select
    a.work_date as work_date,
    a.check_in as occurred_at,
    a.user_id as actor,
    'attendance'::text as kind,
    a.id as ref_id,
    null::uuid as part_id,
    a.current_project_id as project_id,
    null::uuid as order_id,
    null::uuid as run_id,
    null::numeric as qty,
    'checked in'::text as summary
  from public.smark_attendance a
  where a.check_in is not null

  union all

  -- attendance: check-out
  select
    a.work_date as work_date,
    a.check_out as occurred_at,
    a.user_id as actor,
    'attendance'::text as kind,
    a.id as ref_id,
    null::uuid as part_id,
    a.current_project_id as project_id,
    null::uuid as order_id,
    null::uuid as run_id,
    null::numeric as qty,
    'checked out'::text as summary
  from public.smark_attendance a
  where a.check_out is not null

  union all

  -- time_entry: manual hour logs (logged-at instant; work_date is the day
  -- the hours are FOR, which can differ from when it was typed in)
  select
    te.work_date as work_date,
    te.created_at as occurred_at,
    te.user_id as actor,
    'time_entry'::text as kind,
    te.id as ref_id,
    null::uuid as part_id,
    te.project_id as project_id,
    null::uuid as order_id,
    null::uuid as run_id,
    te.hours::numeric as qty,
    (te.hours::text || 'h logged') as summary
  from public.smark_time_entries te

) d;

comment on view public.v_daily_activity is
  '[R2-07] Read-only union feeding Daily Reports: movements ∪ part_events ∪ run start/finish ∪ cart_add ∪ order_placed ∪ arrival ∪ attendance(in/out) ∪ time_entry. security_invoker=true so per-role/per-actor RLS on each underlying table applies exactly as if queried directly.';


-- ----------------------------------------------------------------------------
-- v_expense_rollups [R2-21] — monthly/quarterly/yearly sums by type,
-- category, account, project. Excludes soft-deleted (deleted_at) and
-- unconfirmed draft (is_draft=true) rows — a PO-auto-drafted entry shouldn't
-- inflate charts until the owner confirms it's real (Q-09).
-- security_invoker means employee (no smark_expenses SELECT policy) gets
-- ZERO rows through this view too — matches "Expenses | full | hidden |
-- read+write".
-- ----------------------------------------------------------------------------
create view public.v_expense_rollups
with (security_invoker = true) as
select
  'month'::text as bucket,
  to_char(e.entry_date, 'YYYY-MM') as period,
  e.entry_type,
  e.category,
  e.account_id,
  e.project_id,
  sum(e.amount) as total,
  count(*)::integer as entry_count
from public.smark_expenses e
where e.deleted_at is null and e.is_draft = false
group by to_char(e.entry_date, 'YYYY-MM'), e.entry_type, e.category, e.account_id, e.project_id

union all

select
  'quarter'::text as bucket,
  to_char(e.entry_date, 'YYYY') || '-Q' || to_char(e.entry_date, 'Q') as period,
  e.entry_type,
  e.category,
  e.account_id,
  e.project_id,
  sum(e.amount) as total,
  count(*)::integer as entry_count
from public.smark_expenses e
where e.deleted_at is null and e.is_draft = false
group by to_char(e.entry_date, 'YYYY') || '-Q' || to_char(e.entry_date, 'Q'), e.entry_type, e.category, e.account_id, e.project_id

union all

select
  'year'::text as bucket,
  to_char(e.entry_date, 'YYYY') as period,
  e.entry_type,
  e.category,
  e.account_id,
  e.project_id,
  sum(e.amount) as total,
  count(*)::integer as entry_count
from public.smark_expenses e
where e.deleted_at is null and e.is_draft = false
group by to_char(e.entry_date, 'YYYY'), e.entry_type, e.category, e.account_id, e.project_id;

comment on view public.v_expense_rollups is
  '[R2-21] Monthly/quarterly/yearly sums by (entry_type, category, account, project) — powers the Expenses charts + AI-spend tiles. Excludes soft-deleted and unconfirmed-draft rows.';


-- ----------------------------------------------------------------------------
-- View grants — same ACL root cause as Part B (views are relations too, with
-- their own independent grant list separate from the tables they select
-- from). `security_invoker = true` makes each view re-check the CALLING
-- role's RLS on the underlying tables, but the caller ALSO needs base SELECT
-- on the view itself, or PostgREST gets "permission denied for view ...".
-- ----------------------------------------------------------------------------
grant select on public.v_part_demand     to authenticated, service_role;
grant select on public.v_daily_activity  to authenticated, service_role;
grant select on public.v_expense_rollups to authenticated, service_role;

-- ============================================================================
-- End of 0005_views_fks.sql
-- ============================================================================
