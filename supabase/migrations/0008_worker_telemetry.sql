-- 0008_worker_telemetry.sql — worker heartbeat/metrics for the /ai_orc
-- observatory (manual-testing request: watch run progress AND the worker
-- machine's RAM/CPU from one page; the worker box may have as little as
-- 2 GB RAM, so capacity has to be observable).
--
-- One row per worker PROCESS (worker_id = "hostname#pid"), upserted every
-- few seconds by worker/src/telemetry.ts with a jsonb metrics snapshot
-- (rss/heap/system memory, cpu %, active item agents, runs in flight, mock
-- vs live mode). A worker that stops beating simply goes stale — the page
-- greys it out by last_seen_at; no delete path needed.

create table public.smark_worker_heartbeats (
  id           uuid primary key default gen_random_uuid(),
  worker_id    text not null,
  hostname     text,
  pid          integer,
  started_at   timestamptz,
  last_seen_at timestamptz not null default now(),
  metrics      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,
  constraint smark_worker_heartbeats_worker_id_unique unique (worker_id)
);

comment on table public.smark_worker_heartbeats is
  'Browser-worker process heartbeats + machine metrics (worker/src/telemetry.ts → /ai_orc observatory).';
comment on column public.smark_worker_heartbeats.worker_id is
  'Stable per process: "hostname#pid" — upsert key, so a restart replaces its own row.';
comment on column public.smark_worker_heartbeats.metrics is
  'Snapshot jsonb: rssMb/heapUsedMb/sysFreeMb/sysTotalMb/cpuPercent/uptimeSec/activeItemAgents/runsInFlight/mode/browserDriver/models.';

create index idx_smark_worker_heartbeats_last_seen on public.smark_worker_heartbeats (last_seen_at desc);

alter table public.smark_worker_heartbeats enable row level security;

-- Table privileges are granted explicitly in this schema (0001 revokes the
-- public defaults): authenticated may only SELECT (RLS narrows to owner);
-- the worker's service_role does the writes.
grant select on public.smark_worker_heartbeats to authenticated;
grant select, insert, update, delete on public.smark_worker_heartbeats to service_role;

-- Writes: service role only (the worker) — no authenticated write policy on
-- purpose. Reads: owner only; /ai_orc is an owner-facing operations surface.
create policy "smark_worker_heartbeats_select_owner"
  on public.smark_worker_heartbeats
  for select
  to authenticated
  using (public.smark_role() = 'owner');
