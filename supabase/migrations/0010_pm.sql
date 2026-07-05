-- ============================================================================
-- 0010_pm.sql — Project-Management module: tasks, per-engineer estimated
-- hours, mandatory-description time logs, bugs (client/owner/engineer
-- reported), change requests, "awaiting client input" holds, client-portal
-- PM RPCs, notification kinds.
--
-- ARCHITECTURAL RULES:
--   * `smark_time_entries` (0001) is UNTOUCHED and stays the home of LEGACY
--     Clockify-imported hours (no estimate, no KPI, by design). The NEW
--     per-task hour logs created here (`smark_time_logs`, mandatory
--     description) are a SEPARATE table — the two are never merged.
--   * Efficiency/effectiveness KPI math lives in app code (lib/pm/kpi.ts,
--     pure + unit-tested) — nothing here computes or stores a KPI value.
--     `portal_get_pm`'s `progress` field duplicates the same percent formula
--     as `lib/pm/kpi.ts` `projectProgress` in SQL (same reasoning + comment
--     style as 0006_portal_fns.sql's `portal_get_project` duplicating
--     phase-math: the portal is anon-reachable and cannot call back into
--     app code, so the formula is intentionally small and kept in lockstep
--     by comment cross-reference, not by import).
--   * `smark_task_holds` — an OPEN hold (`ended_at is null`) means the task's
--     clock doesn't count against the estimate; `lib/pm/kpi.ts` callers
--     (lib/pm/queries.ts) exclude logged hours that fall inside an open (or
--     since-closed) hold window from the efficiency calculation.
--   * Reuses `smark_projects` (0003 — `client` free-text column already
--     there), `smark_project_members`, `smark_time_entries` (0001), and
--     `smark_notifications` + `lib/notifications/fanout.ts` for fan-out.
--
-- HARD FENCE (do not touch — live sourcing pipeline, unrelated to this
-- module): smark_agent_runs / smark_order_jobs / smark_boms* / smark_cart_*
-- and everything under app/(app)/projects/[projectId]/{boms,ordering,runs}.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. smark_projects — client-portal hours visibility + legacy-import flag.
-- ----------------------------------------------------------------------------
alter table public.smark_projects
  add column show_time_to_client boolean not null default false,
  add column imported_at timestamptz;

comment on column public.smark_projects.show_time_to_client is
  'Owner toggle: when true, portal_get_pm() includes estimated/actual hours per task; when false (default) hours are NEVER included in the portal payload.';
comment on column public.smark_projects.imported_at is
  'Non-null = this project was created by scripts/import-clockify.ts from legacy Clockify data. Legacy projects have no task estimates → no KPI, by design.';


-- ----------------------------------------------------------------------------
-- 1. smark_tasks — the unit of work under a project. `origin_change_request_id`
--    is a plain uuid here (FK added below, after smark_change_requests exists
--    later in this same file — circular reference: a change request can spawn
--    a task, and a task can record which change request it came from).
-- ----------------------------------------------------------------------------
create table public.smark_tasks (
  id                       uuid primary key default gen_random_uuid(),
  project_id               uuid not null references public.smark_projects (id) on delete cascade,
  title                    text not null,
  description              text,
  status                   text not null default 'open'
                             check (status in ('open', 'awaiting_client_input', 'submitted', 'done')),
  source                   text not null default 'manual'
                             check (source in ('manual', 'change_request')),
  origin_change_request_id uuid, -- References smark_change_requests(id) — FK added below (§4b), table doesn't exist yet.
  submitted_at             timestamptz,
  done_at                  timestamptz,
  created_by               uuid references public.smark_app_users (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz
);

comment on table public.smark_tasks is
  'Unit of work under a project. status lifecycle: open -> awaiting_client_input <-> open -> submitted -> done. source=change_request tasks trace back to the accepted request via origin_change_request_id.';
comment on column public.smark_tasks.origin_change_request_id is
  'References smark_change_requests(id) — FK added later in this migration (§4b) once that table exists (circular: change request -> resulting_task_id -> task -> origin_change_request_id).';

create index idx_smark_tasks_project on public.smark_tasks (project_id);
create index idx_smark_tasks_status on public.smark_tasks (project_id, status);
create index idx_smark_tasks_origin_change_request on public.smark_tasks (origin_change_request_id);
create index idx_smark_tasks_created_by on public.smark_tasks (created_by);

create trigger trg_smark_tasks_updated_at
  before update on public.smark_tasks
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- 2. smark_task_assignees — per-engineer assignment + THEIR OWN estimated
--    hours (owner sets this per engineer, per task — not a whole-task total).
-- ----------------------------------------------------------------------------
create table public.smark_task_assignees (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.smark_tasks (id) on delete cascade,
  user_id         uuid not null references public.smark_app_users (id),
  estimated_hours numeric(6, 1) not null,
  assigned_by     uuid references public.smark_app_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  constraint smark_task_assignees_unique unique (task_id, user_id)
);

comment on table public.smark_task_assignees is
  'Per-task, per-engineer assignment + THEIR estimated_hours (owner-set). lib/pm/kpi.ts efficiency() compares each engineer''s own estimated_hours against their own logged hours (smark_time_logs), never a whole-task total.';

create index idx_smark_task_assignees_user on public.smark_task_assignees (user_id);
create index idx_smark_task_assignees_assigned_by on public.smark_task_assignees (assigned_by);

create trigger trg_smark_task_assignees_updated_at
  before update on public.smark_task_assignees
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- 3. smark_time_logs — NEW task-based hour logs, MANDATORY description.
--    Distinct from legacy `smark_time_entries` (0001, project-level, no
--    description requirement) — the two are never merged (prompt directive).
-- ----------------------------------------------------------------------------
create table public.smark_time_logs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.smark_tasks (id) on delete cascade,
  user_id     uuid not null references public.smark_app_users (id),
  work_date   date not null,
  hours       numeric(5, 1) not null check (hours > 0),
  description text not null,
  created_by  uuid references public.smark_app_users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

comment on table public.smark_time_logs is
  'Per-task hour logs. description is MANDATORY ("what I did"). Distinct from legacy smark_time_entries (0001) — never merged. lib/pm/actions.ts BLOCKS a log while the task has an open smark_task_holds row.';

create index idx_smark_time_logs_task on public.smark_time_logs (task_id);
create index idx_smark_time_logs_user_date on public.smark_time_logs (user_id, work_date);
create index idx_smark_time_logs_date on public.smark_time_logs (work_date);

create trigger trg_smark_time_logs_updated_at
  before update on public.smark_time_logs
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- 4a. smark_bugs — task-scoped defect/CR reports. Only
--     status='confirmed' AND classification='bug' counts toward effectiveness
--     (lib/pm/kpi.ts effectiveness()) — every other combination is excluded.
-- ----------------------------------------------------------------------------
create table public.smark_bugs (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.smark_tasks (id) on delete cascade,
  description    text not null,
  classification text not null default 'bug' check (classification in ('bug', 'change_request')),
  status         text not null default 'open' check (status in ('open', 'confirmed', 'dismissed', 'resolved')),
  reported_source text not null check (reported_source in ('client', 'owner', 'engineer')),
  reported_by    uuid references public.smark_app_users (id), -- null when reported via the client portal
  decided_by     uuid references public.smark_app_users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

comment on table public.smark_bugs is
  'Task-scoped bug/CR reports. Owner triages (confirm/dismiss/reclassify -> spawns a smark_change_requests row). ONLY status=confirmed AND classification=bug counts toward lib/pm/kpi.ts effectiveness(); reported_by is null for client-portal reports (no smark_app_users identity for an anon client).';

create index idx_smark_bugs_task on public.smark_bugs (task_id);
create index idx_smark_bugs_status on public.smark_bugs (status);
create index idx_smark_bugs_classification_status on public.smark_bugs (classification, status);

create trigger trg_smark_bugs_updated_at
  before update on public.smark_bugs
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- 4b. smark_change_requests — owner-decided; acceptance spawns a smark_tasks
--     row (resulting_task_id) with source='change_request'.
-- ----------------------------------------------------------------------------
create table public.smark_change_requests (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.smark_projects (id) on delete cascade,
  description       text not null,
  status            text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  requested_source  text not null check (requested_source in ('client', 'owner')),
  resulting_task_id uuid references public.smark_tasks (id) on delete set null,
  decided_by        uuid references public.smark_app_users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

comment on table public.smark_change_requests is
  'Owner-decided change requests (client-portal or owner-originated). Accepting one creates a smark_tasks row (source=change_request), assigns it, and stamps resulting_task_id + the new task''s origin_change_request_id both ways.';

create index idx_smark_change_requests_project on public.smark_change_requests (project_id);
create index idx_smark_change_requests_status on public.smark_change_requests (project_id, status);
create index idx_smark_change_requests_resulting_task on public.smark_change_requests (resulting_task_id);

create trigger trg_smark_change_requests_updated_at
  before update on public.smark_change_requests
  for each row execute function public.smark_set_updated_at();

-- Close the circular reference opened in §1: smark_tasks.origin_change_request_id -> smark_change_requests.id.
alter table public.smark_tasks
  add constraint smark_tasks_origin_change_request_fk
  foreign key (origin_change_request_id) references public.smark_change_requests (id) on delete set null;


-- ----------------------------------------------------------------------------
-- 5. smark_task_holds — an OPEN row (ended_at is null) means the task is
--    "awaiting client input": time logged during the hold's window is
--    excluded from the efficiency calculation (lib/pm/queries.ts).
-- ----------------------------------------------------------------------------
create table public.smark_task_holds (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.smark_tasks (id) on delete cascade,
  reason       text not null default 'awaiting_client_input',
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  started_by   uuid references public.smark_app_users (id),
  ended_source text check (ended_source in ('client', 'owner')),
  ended_by     uuid references public.smark_app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint smark_task_holds_end_after_start check (ended_at is null or ended_at >= started_at)
);

comment on table public.smark_task_holds is
  'A hold with ended_at IS NULL = the task is currently awaiting client input; logging time against the task is blocked (lib/pm/actions.ts) while one is open. ended_source distinguishes an owner override from the client portal (portal_mark_input_provided) closing it.';

create index idx_smark_task_holds_task on public.smark_task_holds (task_id);
create index idx_smark_task_holds_open on public.smark_task_holds (task_id) where (ended_at is null);

create trigger trg_smark_task_holds_updated_at
  before update on public.smark_task_holds
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- 6. smark_notifications.kind — extend the CHECK with the three PM kinds
--    (0009's own drop+recreate pattern; keep EVERY existing kind, add ours).
-- ----------------------------------------------------------------------------
alter table public.smark_notifications
  drop constraint smark_notifications_kind_check;

alter table public.smark_notifications
  add constraint smark_notifications_kind_check check (kind in (
    'arrival', 'task_assigned', 'rule_pending', 'low_stock',
    'run_done', 'expense_draft', 'portal_comment',
    'comp_pending', 'leave_pending', 'comp_decided', 'leave_decided',
    'bug_reported', 'change_requested', 'client_input_provided'
  ));


-- ============================================================================
-- RLS — FEATURES.md §2 "Projects" area matrix (owner full / employee full /
-- accountant read) is the baseline; the PM tables carry finer per-row scoping
-- noted per policy below. smark_role() (0001) backs every check.
-- ============================================================================

-- ---- smark_tasks ------------------------------------------------------------
-- All authed roles read every task (owner/employee/accountant); owner writes
-- freely; an assigned employee may UPDATE (status transitions enforced in
-- lib/pm/actions.ts, not by column-level RLS).
alter table public.smark_tasks enable row level security;

create policy smark_tasks_select on public.smark_tasks
  for select to authenticated
  using ((select public.smark_role()) is not null);

create policy smark_tasks_insert on public.smark_tasks
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_tasks_update on public.smark_tasks
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_tasks.id and ta.user_id = (select auth.uid())
      )
    )
  )
  with check (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_tasks.id and ta.user_id = (select auth.uid())
      )
    )
  );

create policy smark_tasks_delete on public.smark_tasks
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_task_assignees ---------------------------------------------------
-- All authed read (assignee lists render everywhere); owner sets estimated_hours.
alter table public.smark_task_assignees enable row level security;

create policy smark_task_assignees_select on public.smark_task_assignees
  for select to authenticated
  using ((select public.smark_role()) is not null);

create policy smark_task_assignees_insert on public.smark_task_assignees
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_task_assignees_update on public.smark_task_assignees
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_task_assignees_delete on public.smark_task_assignees
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_time_logs ---------------------------------------------------------
-- Employee inserts/updates OWN logs; owner full; accountant read-only.
alter table public.smark_time_logs enable row level security;

create policy smark_time_logs_select on public.smark_time_logs
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_time_logs_insert on public.smark_time_logs
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and user_id = (select auth.uid())
      and created_by = (select auth.uid())
    )
  );

create policy smark_time_logs_update on public.smark_time_logs
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_time_logs_delete on public.smark_time_logs
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_bugs ---------------------------------------------------------------
-- Owner triages (update/delete). Read: owner, accountant, and an employee
-- assigned to the bug's task. Insert: owner, or an assigned employee
-- (reported_source='engineer') — the client-portal path bypasses this policy
-- entirely via the SECURITY DEFINER portal_report_bug() function.
alter table public.smark_bugs enable row level security;

create policy smark_bugs_select on public.smark_bugs
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_bugs.task_id and ta.user_id = (select auth.uid())
      )
    )
  );

create policy smark_bugs_insert on public.smark_bugs
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_bugs.task_id and ta.user_id = (select auth.uid())
      )
    )
  );

create policy smark_bugs_update on public.smark_bugs
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_bugs_delete on public.smark_bugs
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_change_requests ------------------------------------------------
-- Owner-only table surface; the client-portal path bypasses this policy
-- entirely via the SECURITY DEFINER portal_request_change() function.
alter table public.smark_change_requests enable row level security;

create policy smark_change_requests_select on public.smark_change_requests
  for select to authenticated
  using ((select public.smark_role()) = 'owner');

create policy smark_change_requests_insert on public.smark_change_requests
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_change_requests_update on public.smark_change_requests
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_change_requests_delete on public.smark_change_requests
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_task_holds ---------------------------------------------------------
-- All authed read (task status context); owner or the task's assigned
-- employee may start/end a hold. The client-portal path (ending a hold) goes
-- through the SECURITY DEFINER portal_mark_input_provided() function instead.
alter table public.smark_task_holds enable row level security;

create policy smark_task_holds_select on public.smark_task_holds
  for select to authenticated
  using ((select public.smark_role()) is not null);

create policy smark_task_holds_insert on public.smark_task_holds
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_task_holds.task_id and ta.user_id = (select auth.uid())
      )
    )
  );

create policy smark_task_holds_update on public.smark_task_holds
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_task_holds.task_id and ta.user_id = (select auth.uid())
      )
    )
  )
  with check (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and exists (
        select 1 from public.smark_task_assignees ta
        where ta.task_id = smark_task_holds.task_id and ta.user_id = (select auth.uid())
      )
    )
  );

create policy smark_task_holds_delete on public.smark_task_holds
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');


-- ============================================================================
-- Client-portal SECURITY DEFINER RPCs — mirror 0006_portal_fns.sql exactly:
-- anon gets ZERO grants on any table above; every surface anon can reach is
-- one of these four functions, `set search_path = ''`, hand-picking columns.
-- Same "identical NULL on bad/archived/mismatched token" contract as 0006 for
-- the read function; the three write functions raise a plain-text exception
-- (insert has to fail loudly) that never distinguishes a bad token from a
-- legitimate rejection. Rate limit (write functions only, mirroring
-- portal_add_comment): <=5 client-originated PM actions per project per
-- rolling hour, counted across bug reports + change requests + hold-closes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- portal_get_pm — project header + task list. Hours (estimated/actual) are
-- included ONLY when smark_projects.show_time_to_client is true — NEVER
-- otherwise, even to a well-behaved client UI (the leak-prevention rule is
-- enforced here, at the one function the portal calls, not client-side).
-- `progress` duplicates lib/pm/kpi.ts's projectProgress() formula in SQL
-- (percent of tasks with status='done'; 0 when there are no tasks) — see this
-- migration's header comment for why it's duplicated rather than imported.
-- ----------------------------------------------------------------------------
create or replace function public.portal_get_pm(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.smark_projects%rowtype;
  v_tasks jsonb;
  v_progress numeric;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  select * into v_project
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null
  limit 1;

  if not found then
    return null;
  end if;

  select case when count(*) = 0 then 0
    else round(100.0 * count(*) filter (where t.status = 'done') / count(*))
  end
  into v_progress
  from public.smark_tasks t
  where t.project_id = v_project.id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'title', t.title,
      'status', t.status,
      'assignees', (
        select coalesce(jsonb_agg(u.display_name order by u.display_name), '[]'::jsonb)
        from public.smark_task_assignees ta
        join public.smark_app_users u on u.id = ta.user_id
        where ta.task_id = t.id
      ),
      'estimated_hours', case when v_project.show_time_to_client then (
        select sum(ta2.estimated_hours) from public.smark_task_assignees ta2 where ta2.task_id = t.id
      ) else null end,
      'actual_hours', case when v_project.show_time_to_client then (
        select coalesce(sum(tl.hours), 0) from public.smark_time_logs tl where tl.task_id = t.id
      ) else null end
    )
    order by t.created_at
  ), '[]'::jsonb)
  into v_tasks
  from public.smark_tasks t
  where t.project_id = v_project.id;

  return jsonb_build_object(
    'project_id', v_project.id,
    'name', v_project.name,
    'progress', v_progress,
    'tasks', v_tasks
  );
end;
$$;

comment on function public.portal_get_pm(text) is
  'Client portal PM view: project + tasks (title, status, progress %, assignee display_names). Hours included ONLY when show_time_to_client=true. NULL for unknown/regenerated/archived-project tokens (same non-distinguishing contract as portal_get_project).';

revoke all on function public.portal_get_pm(text) from public;
grant execute on function public.portal_get_pm(text) to anon;

-- ----------------------------------------------------------------------------
-- portal_report_bug — client flags an issue on a SUBMITTED task only.
-- ----------------------------------------------------------------------------
create or replace function public.portal_report_bug(p_token text, p_task_id uuid, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_task public.smark_tasks%rowtype;
  v_body text;
  v_recent_count int;
  v_bug_id uuid;
begin
  v_body := btrim(coalesce(p_description, ''));
  if v_body = '' then
    raise exception 'A description is required.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Description is too long (max 2000 characters).';
  end if;

  select p.id into v_project_id
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null;

  if v_project_id is null then
    raise exception 'This link is no longer available.';
  end if;

  select * into v_task
  from public.smark_tasks t
  where t.id = p_task_id
    and t.project_id = v_project_id;

  if not found or v_task.status <> 'submitted' then
    raise exception 'This task is not available for feedback.';
  end if;

  select count(*) into v_recent_count
  from (
    select b.created_at from public.smark_bugs b
      join public.smark_tasks t on t.id = b.task_id
      where t.project_id = v_project_id and b.reported_source = 'client'
    union all
    select cr.created_at from public.smark_change_requests cr
      where cr.project_id = v_project_id and cr.requested_source = 'client'
    union all
    select h.created_at from public.smark_task_holds h
      join public.smark_tasks t2 on t2.id = h.task_id
      where t2.project_id = v_project_id and h.ended_source = 'client'
  ) recent
  where recent.created_at > (now() - interval '1 hour');

  if v_recent_count >= 5 then
    raise exception 'Too many messages from this link in the last hour — please try again later.';
  end if;

  insert into public.smark_bugs (task_id, description, classification, status, reported_source, reported_by)
  values (p_task_id, v_body, 'bug', 'open', 'client', null)
  returning id into v_bug_id;

  insert into public.smark_notifications (user_id, kind, title, body, link)
  select u.id, 'bug_reported', 'Client reported an issue', left(v_body, 140), ('/projects/' || v_project_id::text)
  from public.smark_app_users u
  where u.role = 'owner' and u.active;

  return jsonb_build_object('ok', true, 'bug_id', v_bug_id);
end;
$$;

comment on function public.portal_report_bug(text, uuid, text) is
  'Client portal: reports a bug on a task, only if the task belongs to the token''s project AND is currently submitted. Rate-limited (<=5/project/hour across all client PM actions). Fans out bug_reported to active owners.';

revoke all on function public.portal_report_bug(text, uuid, text) from public;
grant execute on function public.portal_report_bug(text, uuid, text) to anon;

-- ----------------------------------------------------------------------------
-- portal_request_change — client requests a change on the project as a whole.
-- ----------------------------------------------------------------------------
create or replace function public.portal_request_change(p_token text, p_project_id uuid, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_body text;
  v_recent_count int;
  v_cr_id uuid;
begin
  v_body := btrim(coalesce(p_description, ''));
  if v_body = '' then
    raise exception 'A description is required.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Description is too long (max 2000 characters).';
  end if;

  select p.id into v_project_id
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null;

  if v_project_id is null or v_project_id <> p_project_id then
    raise exception 'This link is no longer available.';
  end if;

  select count(*) into v_recent_count
  from (
    select b.created_at from public.smark_bugs b
      join public.smark_tasks t on t.id = b.task_id
      where t.project_id = v_project_id and b.reported_source = 'client'
    union all
    select cr.created_at from public.smark_change_requests cr
      where cr.project_id = v_project_id and cr.requested_source = 'client'
    union all
    select h.created_at from public.smark_task_holds h
      join public.smark_tasks t2 on t2.id = h.task_id
      where t2.project_id = v_project_id and h.ended_source = 'client'
  ) recent
  where recent.created_at > (now() - interval '1 hour');

  if v_recent_count >= 5 then
    raise exception 'Too many messages from this link in the last hour — please try again later.';
  end if;

  insert into public.smark_change_requests (project_id, description, status, requested_source)
  values (v_project_id, v_body, 'pending', 'client')
  returning id into v_cr_id;

  insert into public.smark_notifications (user_id, kind, title, body, link)
  select u.id, 'change_requested', 'Client requested a change', left(v_body, 140), ('/projects/' || v_project_id::text)
  from public.smark_app_users u
  where u.role = 'owner' and u.active;

  return jsonb_build_object('ok', true, 'change_request_id', v_cr_id);
end;
$$;

comment on function public.portal_request_change(text, uuid, text) is
  'Client portal: files a change request against the project. p_project_id must match the token''s project (defense in depth). Rate-limited (<=5/project/hour across all client PM actions). Fans out change_requested to active owners.';

revoke all on function public.portal_request_change(text, uuid, text) from public;
grant execute on function public.portal_request_change(text, uuid, text) to anon;

-- ----------------------------------------------------------------------------
-- portal_mark_input_provided — client closes the open hold on a task.
-- ----------------------------------------------------------------------------
create or replace function public.portal_mark_input_provided(p_token text, p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_hold_id uuid;
  v_recent_count int;
begin
  select p.id into v_project_id
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null;

  if v_project_id is null then
    raise exception 'This link is no longer available.';
  end if;

  select count(*) into v_recent_count
  from (
    select b.created_at from public.smark_bugs b
      join public.smark_tasks t on t.id = b.task_id
      where t.project_id = v_project_id and b.reported_source = 'client'
    union all
    select cr.created_at from public.smark_change_requests cr
      where cr.project_id = v_project_id and cr.requested_source = 'client'
    union all
    select h.created_at from public.smark_task_holds h
      join public.smark_tasks t2 on t2.id = h.task_id
      where t2.project_id = v_project_id and h.ended_source = 'client'
  ) recent
  where recent.created_at > (now() - interval '1 hour');

  if v_recent_count >= 5 then
    raise exception 'Too many messages from this link in the last hour — please try again later.';
  end if;

  update public.smark_task_holds h
  set ended_at = now(), ended_source = 'client'
  from public.smark_tasks t
  where h.task_id = p_task_id
    and h.ended_at is null
    and t.id = h.task_id
    and t.project_id = v_project_id
  returning h.id into v_hold_id;

  if v_hold_id is null then
    raise exception 'No open hold found for this task.';
  end if;

  insert into public.smark_notifications (user_id, kind, title, body, link)
  select u.id, 'client_input_provided', 'Client provided requested input', null, ('/projects/' || v_project_id::text)
  from public.smark_app_users u
  where u.active and (
    u.role = 'owner'
    or u.id in (select ta.user_id from public.smark_task_assignees ta where ta.task_id = p_task_id)
  );

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.portal_mark_input_provided(text, uuid) is
  'Client portal: closes the open smark_task_holds row for a task (ended_source=client). Rate-limited (<=5/project/hour across all client PM actions). Fans out client_input_provided to active owners + the task''s assignees.';

revoke all on function public.portal_mark_input_provided(text, uuid) from public;
grant execute on function public.portal_mark_input_provided(text, uuid) to anon;
