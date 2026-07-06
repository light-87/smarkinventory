-- ============================================================================
-- 0013_module_permissions.sql — per-employee module grants (RBAC).
--
-- Three modules bundle existing gateable Areas (lib/auth/roles.ts AREAS);
-- lib/rbac/types.ts's `MODULE_AREAS` is the app-side twin of this list:
--   inventory          — inventory, shelves, scan, bulk_takeout, receive, cart
--   project_management — projects only (project_dashboard stays owner-only
--                         always — never grantable, ROLE_MATRIX already
--                         hides it from employee/accountant outright)
--   attendance         — attendance
--
-- Only the `employee` role is ever narrowed by these grants
-- (lib/rbac/access.ts effectiveAreasForUser/effectiveCanSee) — owner and
-- accountant keep exactly the access ROLE_MATRIX already gives them,
-- unaffected by this table entirely. This is a UI/feature-gate layer, not a
-- new RLS/data boundary: it does not change what any existing table's RLS
-- policy allows a role to read/write, only whether the app SHOWS/lets an
-- employee reach a surface at all (nav + a handful of page-level guards that
-- already existed for canSee()/accessFor()).
-- ============================================================================

create table public.smark_user_module_grants (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.smark_app_users (id) on delete cascade,
  module      text not null check (module in ('inventory', 'project_management', 'attendance')),
  granted_by  uuid references public.smark_app_users (id),
  created_at  timestamptz not null default now(),
  unique (user_id, module)
);

comment on table public.smark_user_module_grants is
  'Per-employee module grants (RBAC, 0013). Owner grants/revokes bundles of Areas to an employee via Settings -> Users. Owner/accountant are never gated by this table (lib/rbac/access.ts) — grants only ever narrow the employee role.';

create index idx_smark_user_module_grants_user on public.smark_user_module_grants (user_id);

alter table public.smark_user_module_grants enable row level security;

-- Owner: full access — list/grant/revoke for any user.
create policy smark_user_module_grants_owner_select on public.smark_user_module_grants
  for select to authenticated
  using ((select public.smark_role()) = 'owner');

create policy smark_user_module_grants_owner_insert on public.smark_user_module_grants
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_user_module_grants_owner_delete on public.smark_user_module_grants
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- Self-read: the grantee may SELECT their own grants — this is what lets the
-- app compute an employee's own effective access (lib/auth/session.ts
-- getSessionUser) without requiring an owner-privileged client. Combined
-- with the owner SELECT policy above via Postgres's OR-of-permissive-
-- policies semantics (a caller who is both — impossible here, but harmless
-- either way — would just get the union).
create policy smark_user_module_grants_self_select on public.smark_user_module_grants
  for select to authenticated
  using (user_id = (select auth.uid()));

-- (no update policy: grant/revoke is insert/delete only, never an in-place
-- edit — see lib/rbac/actions.ts grantModuleAction/revokeModuleAction)
