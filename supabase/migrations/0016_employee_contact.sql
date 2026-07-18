-- ============================================================================
-- 0016_employee_contact.sql — employee email + phone (owner/self-private)
--
-- Krunal/owner: "add email and phone number in the employee profile", and the
-- owner should be able to set them for any employee. These are PERSONAL contact
-- fields — not as sensitive as PAN/bank, but the owner chose "owner/self only"
-- visibility, so they go on smark_employee_private (0011), whose RLS already
-- gates EVERY verb to self-or-owner-or-accountant. They must NOT go on
-- smark_app_users, whose SELECT is `using(true)` (world-readable to every
-- authed user).
--
-- Purely additive: two nullable columns on an existing table. The existing RLS
-- on smark_employee_private covers all columns (RLS is row-level), so no policy
-- change is needed. Reversible: drop the columns to roll back.
-- ============================================================================

alter table public.smark_employee_private
  add column if not exists email text,
  add column if not exists phone text;

comment on column public.smark_employee_private.email is
  'Employee personal email (owner/self/accountant-visible only, via this table''s RLS). Optional.';
comment on column public.smark_employee_private.phone is
  'Employee personal phone (owner/self/accountant-visible only). Optional.';

-- ============================================================================
-- End of 0016_employee_contact.sql
-- ============================================================================
