-- ============================================================================
-- 0015_bom_archive.sql — soft-archive a BOM (hide + release demand, keep history)
--
-- A BOM with AI sourcing runs can't be hard-deleted (smark_agent_runs.bom_id is
-- RESTRICT, 0004) so run/cost history stays traceable. This adds a reversible
-- soft-archive instead: smark_boms.archived_at hides the BOM from the project's
-- BOM list and the takeout picker, and releases its cross-project cart demand —
-- exactly the way project archive (smark_projects.archived_at, 0003/0005) works.
--
-- Two parts:
--   1. Add smark_boms.archived_at (nullable) + a partial-ish index.
--   2. Recreate v_part_demand with `and b.archived_at is null` so an archived
--      BOM's lines stop contributing demand/shortfall (self-heals on the next
--      cart render via recomputeShortfallCartItems, like deleteBom does).
--
-- Purely additive + reversible: drop the column (view reverts on a re-run of
-- 0005's body) to roll back. The existing owner/employee UPDATE RLS policy on
-- smark_boms (0003) already permits setting archived_at — no new policy needed.
-- ============================================================================

alter table public.smark_boms
  add column if not exists archived_at timestamptz;

comment on column public.smark_boms.archived_at is
  'Soft-archive timestamp — non-null hides the BOM from lists/takeout and releases its cart demand (v_part_demand filters it out). Reversible (set back to null to un-archive). Run/cost history is retained regardless.';

create index if not exists idx_smark_boms_archived_at
  on public.smark_boms (archived_at);

-- ----------------------------------------------------------------------------
-- Recreate v_part_demand to also exclude archived BOMs. Column shape is
-- unchanged, but a view's FROM/JOIN list can't be altered via `create or
-- replace` here, so drop + recreate (identical to 0005 except the new
-- `and b.archived_at is null` guard on the smark_boms join) and re-grant.
-- ----------------------------------------------------------------------------
drop view if exists public.v_part_demand;

create view public.v_part_demand
with (security_invoker = true) as
select
  p.id as part_id,
  sum(bl.qty * b.build_qty)::integer as demand,
  p.total_qty as available,
  greatest(sum(bl.qty * b.build_qty) - p.total_qty, 0)::integer as shortfall,
  jsonb_agg(
    jsonb_build_object(
      'project_id', pr.id,
      'bom_id', b.id,
      'bom_line_id', bl.id,
      'qty', bl.qty * b.build_qty
    )
    order by pr.id, b.id, bl.id
  ) as breakdown
from public.smark_parts p
join public.smark_bom_lines bl
  on bl.matched_part_id = p.id
  and bl.dnp = false
  and bl.qty > 0
join public.smark_boms b
  on b.id = bl.bom_id
  and b.archived_at is null
join public.smark_projects pr
  on pr.id = b.project_id
  and pr.archived_at is null
group by p.id;

comment on view public.v_part_demand is
  '[R2-10 · Q-05 · 0015] Cross-project demand/shortfall per part over matched, non-DNP lines of non-archived BOMs of non-archived projects (demand persists through ordering — only bulk takeout, arrival allocation, BOM archive, or project archive releases it). Fixture: 500 avail / 400+200 demanded → shortfall 100.';
comment on column public.v_part_demand.breakdown is
  'Per-project demand slices [{project_id,bom_id,bom_line_id,qty}] — same shape as smark_cart_items.demand.';

grant select on public.v_part_demand to authenticated, service_role;

-- ============================================================================
-- End of 0015_bom_archive.sql
-- ============================================================================
