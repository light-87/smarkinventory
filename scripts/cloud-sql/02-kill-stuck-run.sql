-- 02-kill-stuck-run.sql — abort the newest agent run (and its queued jobs).
-- Use when a run was started by mistake (wrong file / worker not up / cost
-- concern). Safe: only touches the single newest run and only its
-- queued/claimed jobs; results already written stay for inspection.

with newest as (
  select id from public.smark_agent_runs
  order by created_at desc
  limit 1
)
update public.smark_order_jobs j
set status = 'failed'
from newest
where j.run_id = newest.id
  and j.status in ('queued', 'claimed');

with newest as (
  select id from public.smark_agent_runs
  order by created_at desc
  limit 1
)
update public.smark_agent_runs r
set status = 'failed'
from newest
where r.id = newest.id
  and r.status in ('planning', 'running');

-- Verify:
select id, status, est_cost, actual_cost, created_at
from public.smark_agent_runs
order by created_at desc
limit 3;
