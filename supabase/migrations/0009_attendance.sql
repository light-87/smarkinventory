-- ============================================================================
-- 0009_attendance.sql — Attendance module: holidays, leave requests,
-- compensatory-work requests, birth_date, new notification kinds.
--
-- ARCHITECTURAL RULE preserved from 0001: `smark_attendance` has a row ONLY
-- when a user is present. This migration never stores "absent" anywhere —
-- absence is resolved app-side (lib/attendance/status.ts) from:
--   holidays (this migration) + smark_attendance (0001) + leave requests
--   (this migration, status='approved') + "none of the above, past day".
-- Comp balance is DERIVED (approved comp_work days − approved compensatory
-- leave days) — no stored balance column anywhere.
--
-- Creates:
--   smark_holidays        — company-wide specific dates + weekly-off weekdays
--   smark_leave_requests  — employee leave, owner-decided
--   smark_comp_work       — employee "I worked a holiday", owner-decided
-- Alters:
--   smark_app_users        — + birth_date (nullable, birthdays)
--   smark_notifications    — kind CHECK extended with comp/leave kinds
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. smark_app_users.birth_date — nullable, birthdays (no existing rows affected).
-- ----------------------------------------------------------------------------
alter table public.smark_app_users
  add column birth_date date;

comment on column public.smark_app_users.birth_date is
  'Optional DOB for birthday surfacing; nullable, no back-fill required.';


-- ----------------------------------------------------------------------------
-- 1. smark_holidays — company-wide; owner-managed. Either a `specific` date
--    (`holiday_date` set, `weekday` null) or a `weekly_off` weekday
--    (`weekday` 0-6, `holiday_date` null). Partial unique indexes stop
--    duplicate entries of either kind.
-- ----------------------------------------------------------------------------
create table public.smark_holidays (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('specific', 'weekly_off')),
  holiday_date date,
  weekday      int check (weekday between 0 and 6),
  name         text not null,
  created_by   uuid references public.smark_app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint smark_holidays_kind_shape check (
    (kind = 'specific'   and holiday_date is not null and weekday is null)
    or
    (kind = 'weekly_off' and weekday is not null and holiday_date is null)
  )
);

comment on table public.smark_holidays is
  'Company-wide holidays: specific dates or weekly-off weekdays. A day with no smark_attendance row on a holiday resolves to Holiday, not Absent (lib/attendance/status.ts).';

create unique index idx_smark_holidays_specific_date
  on public.smark_holidays (holiday_date) where kind = 'specific';
create unique index idx_smark_holidays_weekly_off_day
  on public.smark_holidays (weekday) where kind = 'weekly_off';
create index idx_smark_holidays_kind on public.smark_holidays (kind);

create trigger trg_smark_holidays_updated_at
  before update on public.smark_holidays
  for each row execute function public.smark_set_updated_at();

alter table public.smark_holidays enable row level security;

create policy smark_holidays_select on public.smark_holidays
  for select to authenticated
  using ((select public.smark_role()) is not null);

create policy smark_holidays_insert on public.smark_holidays
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_holidays_update on public.smark_holidays
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_holidays_delete on public.smark_holidays
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');


-- ----------------------------------------------------------------------------
-- 2. smark_leave_requests — employee submits for self, owner decides.
--    `reason = 'compensatory'` draws down the derived comp balance
--    (lib/attendance/actions.ts checks this BEFORE insert; there is no DB
--    constraint enforcing the balance — balance is derived, not stored).
-- ----------------------------------------------------------------------------
create table public.smark_leave_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.smark_app_users (id),
  start_date date not null,
  end_date   date not null,
  reason     text not null check (reason in ('personal', 'sick', 'compensatory')),
  note       text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.smark_app_users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint smark_leave_requests_date_order check (end_date >= start_date)
);

comment on table public.smark_leave_requests is
  'Employee leave requests, owner-decided. An APPROVED row covering a date resolves that date to Leave (lib/attendance/status.ts), rank 3 (below Holiday/Present).';

create index idx_smark_leave_requests_user on public.smark_leave_requests (user_id);
create index idx_smark_leave_requests_range on public.smark_leave_requests (start_date, end_date);
create index idx_smark_leave_requests_status on public.smark_leave_requests (status);

create trigger trg_smark_leave_requests_updated_at
  before update on public.smark_leave_requests
  for each row execute function public.smark_set_updated_at();

alter table public.smark_leave_requests enable row level security;

create policy smark_leave_requests_select on public.smark_leave_requests
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_leave_requests_insert on public.smark_leave_requests
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

-- Owner decides (approve/reject); employee may still edit their OWN row while
-- it is still pending (e.g. fixing a typo before the owner acts on it).
create policy smark_leave_requests_update on public.smark_leave_requests
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()) and status = 'pending')
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()) and status = 'pending')
  );

create policy smark_leave_requests_delete on public.smark_leave_requests
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');


-- ----------------------------------------------------------------------------
-- 3. smark_comp_work — employee submits "I worked this holiday", owner
--    decides. The attendance row for that date still records the actual
--    presence (Compensatory status = holiday + attendance row present,
--    lib/attendance/status.ts); this table only drives the approval +
--    the derived comp-balance count.
-- ----------------------------------------------------------------------------
create table public.smark_comp_work (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.smark_app_users (id),
  work_date  date not null,
  note       text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.smark_app_users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint smark_comp_work_user_day unique (user_id, work_date)
);

comment on table public.smark_comp_work is
  'Employee-submitted "worked a holiday" claims, owner-decided. APPROVED rows are the credit side of the derived comp balance (lib/attendance/queries.ts getCompBalance).';

create index idx_smark_comp_work_user on public.smark_comp_work (user_id);
create index idx_smark_comp_work_date on public.smark_comp_work (work_date);
create index idx_smark_comp_work_status on public.smark_comp_work (status);

create trigger trg_smark_comp_work_updated_at
  before update on public.smark_comp_work
  for each row execute function public.smark_set_updated_at();

alter table public.smark_comp_work enable row level security;

create policy smark_comp_work_select on public.smark_comp_work
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_comp_work_insert on public.smark_comp_work
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_comp_work_update on public.smark_comp_work
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()) and status = 'pending')
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()) and status = 'pending')
  );

create policy smark_comp_work_delete on public.smark_comp_work
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');


-- ----------------------------------------------------------------------------
-- 4. smark_notifications.kind — extend the CHECK with the four attendance
--    kinds (0001's inline CHECK auto-named itself `smark_notifications_kind_check`).
-- ----------------------------------------------------------------------------
alter table public.smark_notifications
  drop constraint smark_notifications_kind_check;

alter table public.smark_notifications
  add constraint smark_notifications_kind_check check (kind in (
    'arrival', 'task_assigned', 'rule_pending', 'low_stock',
    'run_done', 'expense_draft', 'portal_comment',
    'comp_pending', 'leave_pending', 'comp_decided', 'leave_decided'
  ));
