-- Move hand-entered descriptions out of `attributes` and into the column
-- 2026-08-13
--
-- Before the Receive form had a Description field, the client added one himself
-- through "+ add custom field". Custom fields write into `smark_parts.attributes`,
-- so the text landed at `attributes->>'description'` and the Inventory grid's
-- Description column — which reads the real `description` column — stayed empty.
-- That is the "description is not present while adding stock, the custom field
-- doesn't show outside" report.
--
-- Receive now has a proper Description field, and the part page no longer draws
-- the attribute copy alongside the column. This moves what he already typed to
-- where it now belongs, so nothing he entered is stranded.
--
-- Run in the Supabase SQL editor on the production project.

-- 1. What will move. Expect a small number — only parts received by hand.
select internal_pid,
       description                     as current_column,
       attributes->>'description'      as from_custom_field
from   smark_parts
where  attributes ? 'description'
order  by internal_pid;

-- 2. Apply: fill the column where it is empty, then drop the attribute either way.
begin;

update smark_parts
set    description = coalesce(nullif(btrim(description), ''), attributes->>'description'),
       attributes  = attributes - 'description',
       updated_at  = now()
where  attributes ? 'description';

-- 3. Expect zero.
select count(*) as still_in_attributes
from   smark_parts
where  attributes ? 'description';

commit;
