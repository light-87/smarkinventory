-- ============================================================================
-- 0011_onboarding_documents.sql — Employee onboarding + profile + document
-- uploads.
--
-- Creates:
--   smark_employee_private   — sensitive per-employee PII (PAN + bank details)
--                              in a SEPARATE, tightly-RLS'd table (see below)
--   smark_employee_documents — per-employee uploaded docs (NDA, Aadhaar, PAN
--                              card image, client-labeled NDA, other)
-- Alters:
--   smark_app_users — + date_of_joining, onboarded_at (NON-sensitive columns)
--
-- WHY A SEPARATE PRIVATE TABLE (security-critical):
--   Postgres RLS is ROW-level, not column-level. `smark_app_users`'s SELECT
--   policy (migration 0001) is `using (true)` — every authenticated user can
--   read every profile ROW (needed so names render everywhere in
--   history/attendance/etc). If PAN/bank columns lived on that row, ANY
--   employee could read EVERY other employee's PAN + bank account with a
--   direct client-side query
--   (`supabase.from('smark_app_users').select('bank_account_number')`) —
--   server-side app gating cannot stop a direct PostgREST call under
--   `using(true)`. So the five sensitive fields live in their OWN table
--   whose EVERY policy is gated to self-or-owner-or-accountant; a direct
--   client query as a random employee returns ZERO rows for anyone else.
--
--   `date_of_joining` and `onboarded_at` stay on `smark_app_users`: neither
--   is financial, and `onboarded_at` MUST stay readable by the caller's own
--   session for the layout onboarding gate (app/(app)/layout.tsx). PAN/bank
--   values are NEVER logged anywhere (app-side rule; see lib/employees/* and
--   lib/onboarding/* headers).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. smark_app_users — non-sensitive onboarding columns.
--    birth_date already exists (0009) — NOT re-added here. PAN/bank do NOT
--    live here (see header) — they're in smark_employee_private below.
-- ----------------------------------------------------------------------------
alter table public.smark_app_users
  add column date_of_joining date,
  add column onboarded_at    timestamptz;

comment on column public.smark_app_users.date_of_joining is
  'Onboarding-collected DOJ; nullable, no back-fill required. Non-sensitive (kept on the profile row deliberately — bank/PAN are in smark_employee_private).';
comment on column public.smark_app_users.onboarded_at is
  'Stamped when the employee completes first-login onboarding (DOB + DOJ + bank details). NULL = onboarding gate still active (app/(app)/layout.tsx redirects employees with role=employee and onboarded_at is null to /onboarding). Owners/accountants never gated regardless of this value.';


-- ----------------------------------------------------------------------------
-- 1. smark_app_users_update — extend so a user may update their OWN row
--    (onboarding writes birth_date/date_of_joining/onboarded_at to the
--    caller's own profile row; Settings → Profile edits DOB/DOJ too), in
--    addition to the existing owner-full-row-update grant (0001). The
--    existing owner clause is reproduced verbatim, not narrowed. (No
--    sensitive columns are on this table, so this grant exposes nothing
--    financial — it only lets a user set their own DOB/DOJ/onboarded_at.)
-- ----------------------------------------------------------------------------
drop policy smark_app_users_update on public.smark_app_users;

create policy smark_app_users_update on public.smark_app_users
  for update to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or id = (select auth.uid())
  )
  with check (
    (select public.smark_role()) = 'owner'
    or id = (select auth.uid())
  );

comment on policy smark_app_users_update on public.smark_app_users is
  'Owner: full-row update (unchanged from 0001). Any authenticated user: may update their OWN row (needed for onboarding + Settings → Profile self-edit of DOB/DOJ). Which COLUMNS a non-owner may change is enforced by the trg_smark_app_users_guard_privileged_update trigger below — RLS cannot express column-level rules, and the app layer alone is insufficient (PostgREST is reachable directly with the user JWT).';

-- Column-level guard for the self-update path above. RLS lets a user update
-- their OWN row but cannot restrict WHICH columns — so without this a non-owner
-- could escalate by `update smark_app_users set role='owner' where id=auth.uid()`
-- straight through PostgREST, bypassing every Server Action. This BEFORE UPDATE
-- trigger blocks a non-owner from changing any privileged/identity column;
-- owners are unaffected (they legitimately manage these).
create or replace function public.smark_app_users_guard_privileged_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.smark_role()) is distinct from 'owner' and (
    new.id         is distinct from old.id
    or new.username   is distinct from old.username
    or new.role       is distinct from old.role
    or new.active     is distinct from old.active
    or new.created_by is distinct from old.created_by
  ) then
    raise exception 'Not permitted to modify privileged columns of smark_app_users';
  end if;
  return new;
end;
$$;

create trigger trg_smark_app_users_guard_privileged_update
  before update on public.smark_app_users
  for each row execute function public.smark_app_users_guard_privileged_update();


-- ----------------------------------------------------------------------------
-- 2. smark_employee_private — sensitive PII (PAN + bank details), ONE row per
--    user (user_id is the PK, = smark_app_users.id). RLS: a row is readable/
--    writable ONLY by that user themselves, or by owner/accountant (payroll).
--    A direct client query by any OTHER employee returns zero rows — this is
--    the real self+owner+accountant boundary that a table on smark_app_users
--    (SELECT `using(true)`) could not provide.
-- ----------------------------------------------------------------------------
create table public.smark_employee_private (
  user_id             uuid primary key references public.smark_app_users (id) on delete cascade,
  pan_number          text,
  bank_account_name   text,
  bank_account_number text,
  bank_ifsc           text,
  bank_name           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

comment on table public.smark_employee_private is
  'Sensitive per-employee PII: PAN + bank details, one row per user. RLS-gated to self OR owner/accountant on EVERY verb (SELECT/INSERT/UPDATE/DELETE) — never readable by other employees, unlike the SELECT-all smark_app_users profile row. Never log these values.';

create trigger trg_smark_employee_private_updated_at
  before update on public.smark_employee_private
  for each row execute function public.smark_set_updated_at();

alter table public.smark_employee_private enable row level security;

-- Same predicate on every verb: the row's own user, or owner/accountant.
create policy smark_employee_private_select on public.smark_employee_private
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.smark_role()) in ('owner', 'accountant')
  );

create policy smark_employee_private_insert on public.smark_employee_private
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or (select public.smark_role()) in ('owner', 'accountant')
  );

create policy smark_employee_private_update on public.smark_employee_private
  for update to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.smark_role()) in ('owner', 'accountant')
  )
  with check (
    user_id = (select auth.uid())
    or (select public.smark_role()) in ('owner', 'accountant')
  );

create policy smark_employee_private_delete on public.smark_employee_private
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.smark_role()) in ('owner', 'accountant')
  );


-- ----------------------------------------------------------------------------
-- 3. smark_employee_documents — NDA / Aadhaar / PAN-card image / client-
--    labeled NDA / other, per employee. Employee sees + manages only their
--    own; owner full; accountant read-only (kept consistent with the
--    accountant-payroll-read rule applied to smark_employee_private).
-- ----------------------------------------------------------------------------
create table public.smark_employee_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.smark_app_users (id),
  doc_type     text not null check (doc_type in ('nda', 'aadhaar', 'pan_card', 'nda_client', 'other')),
  client_label text, -- client name for 'nda_client'; free label for 'other'
  display_name text not null,
  file_url     text not null, -- StoragePort key, NOT a public URL (see app/api/employees/documents/route.ts)
  mime_type    text,
  size_bytes   int,
  uploaded_by  uuid references public.smark_app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.smark_employee_documents is
  'Employee-uploaded documents (NDA, Aadhaar, PAN card image, per-client NDA, other). file_url is a StoragePort key — resolve via signedUrl(), never render directly.';

create index idx_smark_employee_documents_user on public.smark_employee_documents (user_id);
create index idx_smark_employee_documents_type on public.smark_employee_documents (doc_type);

create trigger trg_smark_employee_documents_updated_at
  before update on public.smark_employee_documents
  for each row execute function public.smark_set_updated_at();

alter table public.smark_employee_documents enable row level security;

create policy smark_employee_documents_select on public.smark_employee_documents
  for select to authenticated
  using (
    (select public.smark_role()) in ('owner', 'accountant')
    or user_id = (select auth.uid())
  );

create policy smark_employee_documents_insert on public.smark_employee_documents
  for insert to authenticated
  with check (
    (select public.smark_role()) = 'owner'
    or ((select public.smark_role()) is not null and user_id = (select auth.uid()))
  );

create policy smark_employee_documents_delete on public.smark_employee_documents
  for delete to authenticated
  using (
    (select public.smark_role()) = 'owner'
    or user_id = (select auth.uid())
  );

-- (no update policy: documents are immutable once uploaded — re-upload as a
-- new row / delete + re-add)
