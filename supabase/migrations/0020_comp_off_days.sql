-- 0020_comp_off_days.sql
--
-- Compensatory time off moves from an HOURS balance to a DAYS ledger.
--
-- Before: the balance was recomputed on every read as
--   Σ approved overtime hours + approved comp-work days × 8 − Σ comp_hours
-- which could only ever express what those three tables happened to hold. It
-- had no way to record a yearly entitlement, an admin correction, or a
-- year-end reset, and it spoke in hours while the business speaks in days
-- ("half day", "full day").
--
-- After: `smark_comp_ledger` is the single source of truth. Balance = the sum
-- of its `delta_days`. Every event that moves the balance is a row:
--   overtime approved  → +0.5 (worked under 4h) or +1 (4h or more)
--   comp work approved → +1
--   comp leave approved→ −0.5 (half day) or −1 per day
--   grant              → +N on 1 Jan for staff flagged as entitled
--   reset              → the negative that zeroes last year's leftover
--   manual             → an owner correction, including the opening balances
--                        carried over from however things were tracked before
--
-- Why a ledger rather than a stored number: an owner correcting a balance, the
-- January reset, and an approval all become the same kind of auditable entry,
-- each attributable to a person and a date, and any of them can be reversed by
-- deleting one row instead of recomputing everything.

-- ----------------------------------------------------------------------------
-- 1. smark_comp_ledger — every movement of the comp-off balance, in days.
-- ----------------------------------------------------------------------------
create table if not exists public.smark_comp_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.smark_app_users (id) on delete cascade,
  entry_date   date not null,
  -- Half-day granularity, both directions. Never 0: an entry that moves
  -- nothing is noise in an audit trail.
  delta_days   numeric(4, 1) not null check (delta_days <> 0 and delta_days >= -366 and delta_days <= 366),
  source_kind  text not null check (source_kind in ('overtime', 'comp_work', 'leave', 'grant', 'reset', 'manual')),
  -- The approved request this entry came from, so approving twice can't credit
  -- twice and un-approving can find its entry again. Null for grant/reset/manual.
  source_id    uuid,
  -- Set on 'grant'/'reset' only — the calendar year they belong to, which is
  -- what makes the annual job idempotent.
  period_year  integer,
  note         text,
  created_by   uuid references public.smark_app_users (id),
  created_at   timestamptz not null default now()
);

comment on table public.smark_comp_ledger is
  'Append-only comp-off movements in DAYS. Balance = sum(delta_days). Replaces the derived hours balance (0018).';

-- One entry per approved request: the guard against double-crediting a
-- re-approval (lib/attendance/core.ts deletes then re-inserts on each decide).
create unique index if not exists idx_smark_comp_ledger_source
  on public.smark_comp_ledger (source_kind, source_id)
  where source_id is not null;

-- One grant and one reset per person per year, so the January job can run
-- every day in January (or twice) without stacking entitlements.
create unique index if not exists idx_smark_comp_ledger_period
  on public.smark_comp_ledger (user_id, source_kind, period_year)
  where period_year is not null;

create index if not exists idx_smark_comp_ledger_user on public.smark_comp_ledger (user_id, entry_date);

-- ----------------------------------------------------------------------------
-- 2. smark_comp_settings — per-employee annual entitlement.
--
-- Stored as a NUMBER of days rather than a boolean so the figure (16 today)
-- can change without a migration, and so an individual arrangement is
-- expressible. The owner-facing control is still a simple on/off toggle.
--
-- Deliberately its own table, not a column on smark_app_users: that table is
-- world-readable by design (SELECT using(true)), and an entitlement is
-- nobody else's business.
-- ----------------------------------------------------------------------------
create table if not exists public.smark_comp_settings (
  user_id      uuid primary key references public.smark_app_users (id) on delete cascade,
  annual_days  numeric(4, 1) not null default 0 check (annual_days >= 0 and annual_days <= 60),
  updated_by   uuid references public.smark_app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on column public.smark_comp_settings.annual_days is
  'Days granted each 1 January (0 = not entitled). The owner UI toggles this between 0 and the standard 16.';

drop trigger if exists trg_smark_comp_settings_updated_at on public.smark_comp_settings;
create trigger trg_smark_comp_settings_updated_at
  before update on public.smark_comp_settings
  for each row execute function public.smark_set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. smark_leave_requests.half_day — a half-day comp leave costs 0.5.
-- ----------------------------------------------------------------------------
alter table public.smark_leave_requests
  add column if not exists half_day boolean not null default false;

comment on column public.smark_leave_requests.half_day is
  'A single-day leave taken as a half day — debits 0.5 comp days instead of 1. Only meaningful when start_date = end_date.';

-- ----------------------------------------------------------------------------
-- 4. RLS — employees read their own history; only the owner writes.
--
-- Every credit is created inside an owner-only approval action, so employees
-- never need INSERT. That also means an employee cannot mint themselves days.
-- ----------------------------------------------------------------------------
alter table public.smark_comp_ledger enable row level security;

drop policy if exists smark_comp_ledger_select on public.smark_comp_ledger;
create policy smark_comp_ledger_select on public.smark_comp_ledger
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

drop policy if exists smark_comp_ledger_insert on public.smark_comp_ledger;
create policy smark_comp_ledger_insert on public.smark_comp_ledger
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

drop policy if exists smark_comp_ledger_update on public.smark_comp_ledger;
create policy smark_comp_ledger_update on public.smark_comp_ledger
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

drop policy if exists smark_comp_ledger_delete on public.smark_comp_ledger;
create policy smark_comp_ledger_delete on public.smark_comp_ledger
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

alter table public.smark_comp_settings enable row level security;

drop policy if exists smark_comp_settings_select on public.smark_comp_settings;
create policy smark_comp_settings_select on public.smark_comp_settings
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

drop policy if exists smark_comp_settings_write on public.smark_comp_settings;
create policy smark_comp_settings_write on public.smark_comp_settings
  for all to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

-- ----------------------------------------------------------------------------
-- 5. Grants — RLS gates the rows, privileges gate the table (see 0019).
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.smark_comp_ledger   to authenticated, service_role;
grant select, insert, update, delete on public.smark_comp_settings to authenticated, service_role;
