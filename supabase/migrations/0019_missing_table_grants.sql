-- 0019_missing_table_grants.sql
--
-- Repairs a provisioning gap: migrations 0009–0018 create tables and enable
-- RLS with policies written `to authenticated`, but never issue the matching
-- table-level GRANTs. RLS and privileges are two separate gates in Postgres —
-- a policy that permits a row is irrelevant if the role can't touch the table
-- at all — so on any database built purely from this migration chain, every
-- Project-Management, attendance-extras, onboarding, reminder and
-- module-grant table answers `permission denied for table …`.
--
-- 0002_catalog_location.sql established the convention this restores: grant
-- select/insert/update/delete to `authenticated` + `service_role` and let RLS
-- do the actual gating, per-row and per-role.
--
-- Deliberately NOT granted (service-role-only surfaces, no `authenticated`
-- policies exist for them — see lib/supabase/server.ts's header):
--   smark_agent_results, smark_order_jobs, smark_ai_aliases
--
-- GRANT is idempotent, so this is a no-op wherever the privileges are already
-- present (production, where they were applied out-of-band).

-- Project management (0010_pm.sql)
grant select, insert, update, delete on public.smark_tasks               to authenticated, service_role;
grant select, insert, update, delete on public.smark_task_assignees      to authenticated, service_role;
grant select, insert, update, delete on public.smark_time_logs           to authenticated, service_role;
grant select, insert, update, delete on public.smark_bugs                to authenticated, service_role;
grant select, insert, update, delete on public.smark_change_requests     to authenticated, service_role;
grant select, insert, update, delete on public.smark_task_holds          to authenticated, service_role;

-- Client reminders (0012_client_reminders.sql)
grant select, insert, update, delete on public.smark_task_reminders      to authenticated, service_role;

-- Attendance: leave, holidays, overtime + comp-off (0009, 0018)
grant select, insert, update, delete on public.smark_leave_requests      to authenticated, service_role;
grant select, insert, update, delete on public.smark_holidays            to authenticated, service_role;
grant select, insert, update, delete on public.smark_overtime            to authenticated, service_role;
grant select, insert, update, delete on public.smark_comp_work           to authenticated, service_role;

-- Employee onboarding + private details (0011, 0016)
grant select, insert, update, delete on public.smark_employee_documents  to authenticated, service_role;
grant select, insert, update, delete on public.smark_employee_private    to authenticated, service_role;

-- Per-employee module permissions (0013_module_permissions.sql)
grant select, insert, update, delete on public.smark_user_module_grants  to authenticated, service_role;
