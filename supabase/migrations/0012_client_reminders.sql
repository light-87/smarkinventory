-- ============================================================================
-- 0012_client_reminders.sql — email infra support: `smark_projects.client_email`
-- (owner-entered, no client account exists — the portal is anon token-link
-- only) + `smark_task_reminders` (recurring "still waiting on you" emails for
-- a task that's on an open smark_task_holds "awaiting client input" hold).
--
-- ARCHITECTURAL RULES:
--   * This is an OWNER TOOL, not a client-portal surface — every policy below
--     gates on smark_role() = 'owner' (0001), same "owner-only table"
--     shape as 0010_pm.sql's smark_change_requests.
--   * First send is owner-driven (lib/reminders/actions.ts
--     composeAndSendReminderAction sends immediately + upserts this row);
--     recurrence after that is the app/api/cron/client-reminders route,
--     bumping next_send_at by frequency_days each run.
--   * A reminder is deactivated (active=false) the moment its task's hold
--     closes — either in-app (lib/pm/actions.ts endHoldAction) or via the
--     client portal's portal_mark_input_provided RPC (0010) — the cron route
--     also deactivates belt-and-suspenders on every run, since the portal
--     path has no app-code hook to call into.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. smark_projects — owner-entered client contact for reminder emails. The
--    client has no account (portal is anon token-link, app/p/[token]) — this
--    is the ONLY place a client's email address is stored.
-- ----------------------------------------------------------------------------
alter table public.smark_projects
  add column client_email text;

comment on column public.smark_projects.client_email is
  'Owner-entered client contact for reminder emails (smark_task_reminders). The client has no account — this is the only email address on file for them.';


-- ----------------------------------------------------------------------------
-- 1. smark_task_reminders — one active reminder per task at a time (app-level
--    upsert, not a unique constraint — a task could reasonably have a history
--    of superseded reminders if that's ever wanted later).
-- ----------------------------------------------------------------------------
create table public.smark_task_reminders (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.smark_tasks (id) on delete cascade,
  subject         text not null,
  body            text not null,
  frequency_days  int not null check (frequency_days > 0),
  last_sent_at    timestamptz,
  next_send_at    timestamptz not null,
  active          boolean not null default true,
  created_by      uuid references public.smark_app_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.smark_task_reminders is
  'Recurring "client input still needed" email for a task with an open smark_task_holds row. Owner composes + sends the first email (lib/reminders/actions.ts composeAndSendReminderAction); app/api/cron/client-reminders resends every frequency_days while active=true and the hold stays open, and deactivates the row the moment the hold closes.';

create index idx_smark_task_reminders_task on public.smark_task_reminders (task_id);
create index idx_smark_task_reminders_due on public.smark_task_reminders (next_send_at) where (active);

create trigger trg_smark_task_reminders_updated_at
  before update on public.smark_task_reminders
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- RLS — owner-only surface (reminders are an owner tool, not part of the
-- FEATURES §2 "projects" area matrix's employee/accountant access).
-- ============================================================================
alter table public.smark_task_reminders enable row level security;

create policy smark_task_reminders_select on public.smark_task_reminders
  for select to authenticated
  using ((select public.smark_role()) = 'owner');

create policy smark_task_reminders_insert on public.smark_task_reminders
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_task_reminders_update on public.smark_task_reminders
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_task_reminders_delete on public.smark_task_reminders
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');
