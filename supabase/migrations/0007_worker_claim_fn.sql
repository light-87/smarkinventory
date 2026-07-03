-- ============================================================================
-- 0007_worker_claim_fn.sql — atomic job-claim RPC for the Browser-Worker.
--
-- Requested by the `worker` package (docs/OWNERSHIP.md: worker owns worker/**
-- but NOT migrations — the integrator assigns numbers; 0007 is this).
-- worker/src/claim.ts calls `smark_claim_next_order_jobs(p_limit)` FIRST and
-- falls back to a provably race-free conditional-UPDATE loop when this
-- function is absent (see that file's header). This migration installs the
-- ideal single-statement path: SELECT ... FOR UPDATE SKIP LOCKED wrapped in
-- an UPDATE, which PostgREST cannot express directly (FEATURES.md §4/§6,
-- SCHEMA.md §4 "claimed atomically via FOR UPDATE SKIP LOCKED").
--
-- SECURITY: SECURITY DEFINER + empty search_path (Supabase lint Sxxxx) so the
-- function body is schema-qualified and cannot be hijacked by a caller's
-- search_path. Execute is granted to service_role ONLY — smark_order_jobs is
-- service-role-only by RLS (0004), and only the worker (service key) ever
-- claims jobs; anon/authenticated are explicitly revoked.
-- ============================================================================

create or replace function public.smark_claim_next_order_jobs(p_limit int default 1)
returns setof public.smark_order_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.smark_order_jobs
  set status = 'claimed', claimed_at = now(), attempts = attempts + 1
  where id in (
    select id from public.smark_order_jobs
    where status = 'queued' and plan is not null
    order by created_at asc
    for update skip locked
    limit greatest(p_limit, 0)
  )
  returning *;
end;
$$;

revoke all on function public.smark_claim_next_order_jobs(int) from public, anon, authenticated;
grant execute on function public.smark_claim_next_order_jobs(int) to service_role;

-- ============================================================================
-- End of 0007_worker_claim_fn.sql
-- ============================================================================
