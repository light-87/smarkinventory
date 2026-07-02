-- ============================================================================
-- 0001_users_team.sql — SmarkStock: users, roles, team, attendance, notifications
-- Canonical spec: plan/SCHEMA.md §0 + §7; FEATURES.md §2 (role matrix), §13.
--
-- Creates:
--   smark_set_updated_at()  — shared updated_at trigger fn (later migrations reuse)
--   smark_app_users         — profile row per login; id = auth.users.id
--   smark_role()            — SECURITY DEFINER helper: role of auth.uid(); all RLS
--                             policies in migrations 0001–0005 reference this
--   smark_attendance        — self-marked day attendance [R2-02]
--   smark_time_entries      — manual per-project hour logs [R2-04 · Q-03 FINAL]
--   smark_project_members   — project team membership [R2-04]
--   smark_notifications     — in-app notification fan-out [R2-36]
--
-- Cross-domain FKs deferred (smark_projects is created in 0003):
--   smark_attendance.current_project_id / smark_time_entries.project_id /
--   smark_project_members.project_id are plain uuid here — FK added in 0005.
--
-- App creates smark_app_users rows explicitly (server-side, service role) right
-- after auth admin createUser — NO trigger syncing from auth.users.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0.1 Shared trigger function: stamp updated_at on every UPDATE.
--     Later migrations (0002–0004) attach this same function to their tables.
-- ----------------------------------------------------------------------------
create or replace function public.smark_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.smark_set_updated_at() is
  'Shared BEFORE UPDATE trigger: sets updated_at = now(). Defined in 0001, reused by all smark_ tables.';

revoke execute on function public.smark_set_updated_at() from public, anon;


-- ----------------------------------------------------------------------------
-- 0.2 smark_app_users [R2-01] — one profile row per login.
--     id deliberately has NO default: it must equal auth.users.id
--     (username maps to synthetic email {username}@smark.internal).
--     Deactivate, never delete — history FKs point here. No DELETE policy.
-- ----------------------------------------------------------------------------
create table public.smark_app_users (
  id           uuid primary key references auth.users (id),
  username     text not null unique,
  display_name text,
  role         text not null check (role in ('owner', 'employee', 'accountant')),
  active       boolean not null default true,
  created_by   uuid references public.smark_app_users (id), -- the owner who added them; null for bootstrap owner
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.smark_app_users is
  'Profile per login; id = auth.users.id. Deactivate (active=false), never delete.';

create index idx_smark_app_users_created_by on public.smark_app_users (created_by);

create trigger trg_smark_app_users_updated_at
  before update on public.smark_app_users
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- 0.3 smark_role() — the RLS helper every policy uses.
--     SECURITY DEFINER (owner = migration role, bypasses RLS on smark_app_users,
--     so policies on smark_app_users itself cannot recurse).
--     Returns NULL for anon, unknown, or DEACTIVATED users → every role-gated
--     policy denies immediately when a user is deactivated, even with a live JWT.
--     Decision (SCHEMA.md left it open): read from the table, not JWT app_metadata
--     — always current, and STABLE + (select ...) wrapping keeps it one call/query.
-- ----------------------------------------------------------------------------
create or replace function public.smark_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.smark_app_users
  where id = auth.uid()
    and active
$$;

comment on function public.smark_role() is
  'Role (owner|employee|accountant) of auth.uid(); NULL if anon/deactivated. Reference as (select public.smark_role()) in policies.';

revoke execute on function public.smark_role() from public, anon;
grant execute on function public.smark_role() to authenticated, service_role;


-- RLS: smark_app_users — readable by all authed (names render everywhere in
-- history); INSERT/UPDATE owner-only (bootstrap owner row is inserted by the
-- server with service role, which bypasses RLS); no DELETE ever.
alter table public.smark_app_users enable row level security;

create policy smark_app_users_select on public.smark_app_users
  for select to authenticated
  using (true);

create policy smark_app_users_insert on public.smark_app_users
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_app_users_update on public.smark_app_users
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

-- (no delete policy: deactivate, never delete)


-- ----------------------------------------------------------------------------
-- 1. smark_attendance [R2-02] — one logical row per user per day.
--    Self clock-in/out + "working on" project tag, switchable during the day.
-- ----------------------------------------------------------------------------
create table public.smark_attendance (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.smark_app_users (id),
  work_date          date not null,
  check_in           timestamptz,
  check_out          timestamptz,
  current_project_id uuid, -- smark_projects: FK added in 0005 (projects created in 0003)
  note               text, -- late reason etc.
  created_at         timestamptz not null default now(),
  updated_at         timestamptz,
  constraint smark_attendance_user_day unique (user_id, work_date),
  constraint smark_attendance_out_after_in
    check (check_out is null or (check_in is not null and check_out >= check_in))
);

comment on table public.smark_attendance is
  'Self-marked attendance: one row per user per day (check_in/out + current project).';
comment on column public.smark_attendance.current_project_id is
  'References smark_projects(id) — FK added in 0005.';

create index idx_smark_attendance_date on public.smark_attendance (work_date);
create index idx_smark_attendance_project on public.smark_attendance (current_project_id);

create trigger trg_smark_attendance_updated_at
  before update on public.smark_attendance
  for each row execute function public.smark_set_updated_at();

-- RLS: employee writes/reads OWN rows only; owner full; accountant read-all.
alter table public.smark_attendance enable row level security;

create policy smark_attendance_select on public.smark_attendance
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_attendance_insert on public.smark_attendance
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_attendance_update on public.smark_attendance
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_attendance_delete on public.smark_attendance
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');


-- ----------------------------------------------------------------------------
-- 2. smark_time_entries [R2-04 · Q-03 FINAL] — MANUAL hours only.
--    entered_by = the real actor (self, or owner adding/correcting anyone's).
-- ----------------------------------------------------------------------------
create table public.smark_time_entries (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null, -- smark_projects: FK added in 0005 (projects created in 0003)
  user_id    uuid not null references public.smark_app_users (id),
  work_date  date not null,
  hours      numeric(4,1) not null check (hours > 0 and hours <= 24),
  note       text,
  entered_by uuid not null references public.smark_app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.smark_time_entries is
  'Manual per-project hour logs (no timer). entered_by = self or owner.';
comment on column public.smark_time_entries.project_id is
  'References smark_projects(id) — FK added in 0005.';

create index idx_smark_time_entries_project on public.smark_time_entries (project_id);
create index idx_smark_time_entries_user_date on public.smark_time_entries (user_id, work_date);
create index idx_smark_time_entries_date on public.smark_time_entries (work_date);
create index idx_smark_time_entries_entered_by on public.smark_time_entries (entered_by);

create trigger trg_smark_time_entries_updated_at
  before update on public.smark_time_entries
  for each row execute function public.smark_set_updated_at();

-- RLS: employee writes/reads OWN entries (entered_by pinned to self on insert);
-- owner full (can add/correct anyone's); accountant read-all.
alter table public.smark_time_entries enable row level security;

create policy smark_time_entries_select on public.smark_time_entries
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_time_entries_insert on public.smark_time_entries
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or (
      (select public.smark_role()) = 'employee'
      and user_id = (select auth.uid())
      and entered_by = (select auth.uid())
    )
  );

create policy smark_time_entries_update on public.smark_time_entries
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );

create policy smark_time_entries_delete on public.smark_time_entries
  for delete to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) = 'employee' and user_id = (select auth.uid()))
  );


-- ----------------------------------------------------------------------------
-- 3. smark_project_members [R2-04] — owner assigns employees to projects.
--    Feeds the attendance "working-on" picker and the task assignee list.
-- ----------------------------------------------------------------------------
create table public.smark_project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null, -- smark_projects: FK added in 0005 (projects created in 0003)
  user_id     uuid not null references public.smark_app_users (id),
  assigned_by uuid references public.smark_app_users (id),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  constraint smark_project_members_unique unique (project_id, user_id)
);

comment on table public.smark_project_members is
  'Project team membership; owner assigns (FEATURES.md §5.8 Team & hours).';
comment on column public.smark_project_members.project_id is
  'References smark_projects(id) — FK added in 0005.';

create index idx_smark_project_members_user on public.smark_project_members (user_id);
create index idx_smark_project_members_assigned_by on public.smark_project_members (assigned_by);

create trigger trg_smark_project_members_updated_at
  before update on public.smark_project_members
  for each row execute function public.smark_set_updated_at();

-- RLS: readable by every active role (pickers/assignee lists); writes owner-only.
alter table public.smark_project_members enable row level security;

create policy smark_project_members_select on public.smark_project_members
  for select to authenticated
  using ((select public.smark_role()) is not null);

create policy smark_project_members_insert on public.smark_project_members
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_project_members_update on public.smark_project_members
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_project_members_delete on public.smark_project_members
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');


-- ----------------------------------------------------------------------------
-- 4. smark_notifications [R2-36] — in-app fan-out; bell badge = unread count.
--    Kinds per FEATURES.md §5 header spec. System events insert mostly via
--    service role (bypasses RLS); in-app actor-driven events (e.g. task assign)
--    may insert as the acting user.
-- ----------------------------------------------------------------------------
create table public.smark_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.smark_app_users (id), -- recipient
  kind       text not null check (kind in (
               'arrival', 'task_assigned', 'rule_pending', 'low_stock',
               'run_done', 'expense_draft', 'portal_comment'
             )),
  title      text not null,
  body       text,
  link       text, -- deep link into the app
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table public.smark_notifications is
  'In-app notifications [R2-36]; fan-out respects the role matrix; unread = read_at is null.';

create index idx_smark_notifications_user_created
  on public.smark_notifications (user_id, created_at desc);
create index idx_smark_notifications_unread
  on public.smark_notifications (user_id) where read_at is null;

create trigger trg_smark_notifications_updated_at
  before update on public.smark_notifications
  for each row execute function public.smark_set_updated_at();

-- RLS: recipients see + mark-read their own; owner full; any active user may
-- insert (covers in-app actor-driven fan-out); delete owner-only.
alter table public.smark_notifications enable row level security;

create policy smark_notifications_select on public.smark_notifications
  for select to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) is not null and user_id = (select auth.uid()))
  );

create policy smark_notifications_insert on public.smark_notifications
  for insert to authenticated
  with check ((select public.smark_role()) is not null);

create policy smark_notifications_update on public.smark_notifications
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) is not null and user_id = (select auth.uid()))
  )
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) is not null and user_id = (select auth.uid()))
  );

create policy smark_notifications_delete on public.smark_notifications
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');
