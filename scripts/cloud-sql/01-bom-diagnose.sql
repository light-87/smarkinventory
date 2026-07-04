-- 01-bom-diagnose.sql — why does the uploaded GCU BOM show only row 1?
-- Run in the Supabase dashboard SQL editor and paste the results back.

-- A) Every BOM: what the upload THOUGHT it parsed (line_count, stamped at
--    insert time) vs how many line rows actually exist in the DB.
select
  b.id,
  b.name,
  b.line_count      as parsed_line_count,
  count(bl.id)      as rows_in_db,
  b.created_in_app,
  b.created_at
from public.smark_boms b
left join public.smark_bom_lines bl on bl.bom_id = b.id
group by b.id
order by b.created_at desc
limit 10;

-- B) The lines that DID land for the newest BOM — which ones survived?
select bl.line_no, bl.references, bl.qty, bl.value, bl.mpn, bl.match_state
from public.smark_bom_lines bl
join public.smark_boms b on b.id = bl.bom_id
where b.created_at = (select max(created_at) from public.smark_boms)
order by bl.line_no
limit 20;
