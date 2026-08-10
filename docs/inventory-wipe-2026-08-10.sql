-- inventory-wipe-2026-08-10.sql
--
-- Clears the demo/test part catalog so the client's real stock list can be
-- imported (`scripts/import-formatted-csvs.ts`). Run in the Supabase SQL editor
-- on the prod project (pqairngbvhkxtqxqmsbr) — same process as
-- docs/cleanup-test-data-2026-07-31.sql; this repo has no `supabase db push`.
--
-- SCOPE — inventory only:
--   WIPED  parts · stock locations · big boxes · shelves · part events ·
--          movements · part/box QR labels · cart lines pointing at parts
--   KEPT   projects · BOMs · orders (their part links are nulled, the rows and
--          their money stay) · attendance · users · agent runs · ordering rules
--
-- THIS IS IRREVERSIBLE. Run section 1, read the numbers, take the backup in
-- section 2, and only then run section 3.

-- ── 1. Census: what is actually in there right now ──────────────────────────
-- Run this FIRST and eyeball it. If `parts` is ~15 you are looking at the
-- canonical demo seed (scripts/seed-canonical-demo.ts, the SMK-000101 family).
-- Anything much larger means real data got in and this script must not run.

select 'parts'                as table_name, count(*) from public.smark_parts
union all
select 'stock_locations',     count(*) from public.smark_stock_locations
union all
select 'big_boxes',           count(*) from public.smark_big_boxes
union all
select 'shelves',             count(*) from public.smark_shelves
union all
select 'part_events',         count(*) from public.smark_part_events
union all
select 'movements',           count(*) from public.smark_movements
union all
select 'qr_labels (part)',    count(*) from public.smark_qr_labels where target_type = 'part'
union all
select 'qr_labels (big_box)', count(*) from public.smark_qr_labels where target_type = 'big_box'
union all
-- The four references below are RESTRICT/NO ACTION and will BLOCK the delete
-- until they are cleared. Non-zero here is expected, not a problem.
select 'cart_items → part',   count(*) from public.smark_cart_items  where part_id is not null
union all
select 'order_lines → part',  count(*) from public.smark_order_lines where part_id is not null
union all
-- These two self-heal (ON DELETE SET NULL); listed so the blast radius is visible.
select 'bom_lines matched',   count(*) from public.smark_bom_lines    where matched_part_id is not null
union all
select 'agent_results → part',count(*) from public.smark_agent_results where part_id is not null
order by table_name;

-- Eyeball the catalog itself before deleting it.
select internal_pid, mpn, category, value, package, total_qty, source_sheet, needs_review, created_at
from public.smark_parts
order by internal_pid
limit 50;

-- ── 2. Backup ───────────────────────────────────────────────────────────────
-- Run this and use the SQL editor's "Download CSV" button. Do NOT use
-- /inventory/export for the backup — that route is subject to PostgREST's
-- 1000-row cap and would silently give you a partial file.

select * from public.smark_parts order by internal_pid;

-- ── 3. Delete ───────────────────────────────────────────────────────────────
-- Children first. smark_parts has seven inbound FK columns and four of them
-- have no ON DELETE clause (NO ACTION), so the order below is mandatory —
-- `delete from smark_parts` on its own just errors.

begin;

-- QR labels first: target_id is polymorphic with NO foreign key by design
-- (migration 0002), so these rows would otherwise survive as orphans pointing
-- at dead uuids, and `unique (target_type, target_id)` would then collide with
-- freshly minted labels later.
delete from public.smark_qr_labels where target_type in ('part', 'big_box');

-- Append-only by design: smark_part_events has no DELETE policy for any role,
-- which is exactly why this has to run as the SQL editor / service role.
delete from public.smark_part_events;

delete from public.smark_movements;

-- Each row fires an AFTER trigger that takes a per-part advisory lock and
-- recomputes total_qty. Expect this statement to be the slow one.
delete from public.smark_stock_locations;

-- Cart lines are deleted rather than unlinked: smark_cart_items carries
-- `check (part_id is not null or descriptor is not null)`, so nulling part_id
-- would violate it — and an open cart line for a part that no longer exists
-- has no meaning anyway.
delete from public.smark_cart_items where part_id is not null;

-- Order lines are KEPT — they are financial history (the migration 0004 comment
-- calls traceability something that "must never be lost"). Only the pointer at
-- the dead test part goes.
update public.smark_order_lines set part_id = null where part_id is not null;

delete from public.smark_parts;
delete from public.smark_big_boxes;
delete from public.smark_shelves;

-- smark_bom_lines.matched_part_id and smark_agent_results.part_id are
-- ON DELETE SET NULL, so they cleared themselves above — but match_state would
-- be left claiming 'in_stock' while pointing at nothing. Reset it so every BOM
-- re-reconciles honestly against the new catalog.
update public.smark_bom_lines
   set match_state = 'unresolved', match_confidence = null
 where matched_part_id is null and match_state <> 'unresolved';

-- Read the row counts above, then:
commit;
-- (or `rollback;` to abort — nothing is written until you commit)

-- ── 4. Verify ───────────────────────────────────────────────────────────────
-- Every count must be 0.

select 'parts' as table_name, count(*) from public.smark_parts
union all
select 'stock_locations', count(*) from public.smark_stock_locations
union all
select 'big_boxes',       count(*) from public.smark_big_boxes
union all
select 'shelves',         count(*) from public.smark_shelves
union all
select 'part_events',     count(*) from public.smark_part_events
union all
select 'movements',       count(*) from public.smark_movements
union all
select 'qr_labels',       count(*) from public.smark_qr_labels
union all
select 'stale bom_lines', count(*) from public.smark_bom_lines
  where matched_part_id is null and match_state <> 'unresolved'
order by table_name;

-- Projects, BOMs, orders, attendance and users must be untouched — sanity check.
select 'projects' as table_name, count(*) from public.smark_projects
union all
select 'boms',        count(*) from public.smark_boms
union all
select 'bom_lines',   count(*) from public.smark_bom_lines
union all
select 'orders',      count(*) from public.smark_orders
union all
select 'order_lines', count(*) from public.smark_order_lines
union all
select 'app_users',   count(*) from public.smark_app_users
order by table_name;

-- ── 5. Then import ──────────────────────────────────────────────────────────
--   bun --env-file=.env.cloud.local run scripts/import-formatted-csvs.ts --dry-run
--   bun --env-file=.env.cloud.local run scripts/import-formatted-csvs.ts
--
-- Afterwards this should return ~1999, with ~1855 at total_qty > 0:
--   select count(*) as parts,
--          count(*) filter (where total_qty > 0) as with_stock,
--          count(*) filter (where needs_review)  as queued_for_onboarding
--     from public.smark_parts;
