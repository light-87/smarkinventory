-- ============================================================================
-- 0018_attendance_overtime.sql — self-reported overtime → owner approval →
-- HOURS-based compensatory-off ledger.
--
-- Owner request: at mark-out an employee reports extra hours worked; the owner
-- approves (possibly adjusting the hours); approved hours bank as a comp-off
-- balance measured in HOURS; when the owner grants a compensatory leave they
-- deduct their chosen number of hours from that balance.
--
-- The comp balance stays DERIVED (never stored), same as 0009 — but now in
-- HOURS: Σ approved smark_overtime.hours_approved
--        + Σ approved smark_comp_work days × 8   (existing holiday-comp folded in)
--        − Σ approved compensatory smark_leave_requests.comp_hours.
--
-- Creates:  smark_overtime  — self-reported extra hours, owner-decided
-- Alters:   smark_leave_requests += comp_hours (the debit side)
--           smark_notifications kind CHECK += overtime_pending/decided
--
-- Written idempotently (create-if-not-exists / drop-if-exists) so it is safe to
-- re-run after a partial apply.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. smark_overtime — employee submits "I worked N extra hours on this date",
--    owner decides (and may set hours_approved ≠ hours_claimed). Mirrors
--    smark_comp_work's shape + RLS exactly. One claim per (user, date).
-- ----------------------------------------------------------------------------
create table if not exists public.smark_overtime (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.smark_app_users (id),
  work_date      date not null,
  hours_claimed  numeric(4, 1) not null check (hours_claimed > 0 and hours_claimed <= 24),
  hours_approved numeric(4, 1) check (hours_approved >= 0 and hours_approved <= 24),
  note           text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by     uuid references public.smark_app_users (id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,
  constraint smark_overtime_user_day unique (user_id, work_date)
);

comment on table public.smark_overtime is
  'Employee-submitted extra-hours claims, owner-decided. APPROVED rows (hours_approved) are the credit side of the derived HOURS comp balance (lib/attendance/queries.ts getCompBalance).';

create index if not exists idx_smark_overtime_user on public.smark_overtime (user_id);
create index if not exists idx_smark_overtime_date on public.smark_overtime (work_date);
create index if not exists idx_smark_overtime_status on public.smark_overtime (status);

drop trigger if exists trg_smark_overtime_updated_at on public.smark_overtime;
create trigger trg_smark_overtime_updated_at
  before update on public.smark_overtime
  for each row execute function public.smark_set_updated_at();

alter table public.smark_overtime enable row level security;

drop policy if exists smark_overtime_select on public.smark_overtime;
create policy smark_overtime_select on public.smark_overtime
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

drop policy if exists smark_overtime_insert on public.smark_overtime;
create policy smark_overtime_insert on public.smark_overtime
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

drop policy if exists smark_overtime_update on public.smark_overtime;
create policy smark_overtime_update on public.smark_overtime
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()) and status = 'pending')
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()) and status = 'pending')
  );

drop policy if exists smark_overtime_delete on public.smark_overtime;
create policy smark_overtime_delete on public.smark_overtime
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ----------------------------------------------------------------------------
-- 2. smark_leave_requests.comp_hours — hours the owner deducts from the comp-off
--    balance when APPROVING a compensatory leave. Null for non-comp leaves or
--    while pending. The debit side of the HOURS ledger.
-- ----------------------------------------------------------------------------
alter table public.smark_leave_requests
  add column if not exists comp_hours numeric(5, 1) check (comp_hours is null or comp_hours >= 0);

comment on column public.smark_leave_requests.comp_hours is
  'Hours debited from the comp-off balance when the owner approves a compensatory leave (owner-chosen, default suggestion = days×8). Null otherwise.';

-- ----------------------------------------------------------------------------
-- 3. smark_notifications.kind — add the two overtime kinds. The full list must
--    carry EVERY kind already allowed (0001 base + 0009 attendance + 0010 PM),
--    or existing rows with a dropped kind would violate the recreated CHECK.
-- ----------------------------------------------------------------------------
alter table public.smark_notifications
  drop constraint if exists smark_notifications_kind_check;

alter table public.smark_notifications
  add constraint smark_notifications_kind_check check (kind in (
    'arrival', 'task_assigned', 'rule_pending', 'low_stock',
    'run_done', 'expense_draft', 'portal_comment',
    'comp_pending', 'leave_pending', 'comp_decided', 'leave_decided',
    'bug_reported', 'change_requested', 'client_input_provided',
    'overtime_pending', 'overtime_decided'
  ));

-- ============================================================================
-- End of 0018_attendance_overtime.sql
-- ============================================================================
