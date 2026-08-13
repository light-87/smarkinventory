-- cleanup-test-data-2026-07-31.sql
--
-- Removes everything Claude created in PRODUCTION while verifying the PM bug
-- fixes on 2026-07-31. Run in the Supabase SQL editor (prod project).
--
-- Scope: ONE project and everything hanging off it. Nothing else was created,
-- and no pre-existing row was modified — the only other write attempted was a
-- deliberately invalid 30-hour time log on the AEM-150DC8-ETH project, which
-- the server rejected, so nothing was stored there.
--
-- The project is already ARCHIVED (hidden from the active list), so running
-- this is optional — it is the hard delete if you want the rows gone.

-- ── 1. Confirm what will be deleted ──────────────────────────────────────────
-- Run this first and check it returns exactly one project ("ZZ TEST — delete
-- me (Claude)"), one task ("Test task — hold + submit flow"), one time log
-- ("Test log — 2 hours", 2h) and one hold.

select 'project' as kind, p.id::text, p.name as detail, p.created_at
from public.smark_projects p
where p.id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
union all
select 'task', t.id::text, t.title, t.created_at
from public.smark_tasks t
where t.project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
union all
select 'time_log', l.id::text, l.description || ' (' || l.hours || 'h)', l.created_at
from public.smark_time_logs l
join public.smark_tasks t on t.id = l.task_id
where t.project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
union all
select 'hold', h.id::text, h.reason, h.started_at
from public.smark_task_holds h
join public.smark_tasks t on t.id = h.task_id
where t.project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
order by kind, created_at;

-- ── 2. Delete ────────────────────────────────────────────────────────────────
-- Children first, then the project. smark_tasks.project_id and the task-child
-- FKs are ON DELETE CASCADE (migration 0010), so deleting the project alone
-- would be enough — the explicit statements below just make the blast radius
-- visible and let you stop after any step.

begin;

delete from public.smark_time_logs
where task_id in (
  select id from public.smark_tasks
  where project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
);

delete from public.smark_task_holds
where task_id in (
  select id from public.smark_tasks
  where project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
);

delete from public.smark_task_assignees
where task_id in (
  select id from public.smark_tasks
  where project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66'
);

delete from public.smark_tasks
where project_id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66';

delete from public.smark_projects
where id = 'a85f7cae-80b5-4eea-b323-ed35b733dd66';

-- Inspect the row counts above, then:
commit;
-- (or `rollback;` to abort)

-- ── 3. Verify ────────────────────────────────────────────────────────────────
-- Should return 0 rows.
select id, name, archived_at
from public.smark_projects
where name ilike '%ZZ TEST%';
