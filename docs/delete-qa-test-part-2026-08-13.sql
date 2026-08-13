-- Remove the one test part created while verifying Receive, 2026-08-13
--
-- SMK-001747, value `QA-TEST-DELETE-ME`, qty 1. Created deliberately on
-- production to prove the "Save" button works end to end after the duplicate-
-- guard fix: that a genuinely new part saves, that a blank package is now
-- accepted, and that Description and Distributor reach their real columns.
-- Verified via the CSV export, then left for removal here.
--
-- Run in the Supabase SQL editor on the production project.

-- 1. Confirm it is the only thing that will go.
select id, internal_pid, value, description, default_distributor, total_qty
from   smark_parts
where  internal_pid = 'SMK-001747';

-- 2. Remove it, children first (the same FK order as the wipe script).
begin;

delete from smark_qr_labels
where  target_type = 'part'
  and  target_id in (select id from smark_parts where internal_pid = 'SMK-001747');

delete from smark_part_events
where  part_id in (select id from smark_parts where internal_pid = 'SMK-001747');

delete from smark_movements
where  part_id in (select id from smark_parts where internal_pid = 'SMK-001747');

delete from smark_stock_locations
where  part_id in (select id from smark_parts where internal_pid = 'SMK-001747');

delete from smark_parts
where  internal_pid = 'SMK-001747';

-- 3. Expect 0, and the catalogue back to 1,746.
select (select count(*) from smark_parts where internal_pid = 'SMK-001747') as leftover,
       (select count(*) from smark_parts)                                   as total_parts;

commit;
