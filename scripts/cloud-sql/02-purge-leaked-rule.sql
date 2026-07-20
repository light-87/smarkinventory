-- 02-purge-leaked-rule.sql — remove the orphaned "Alias Leak Project A" learned
-- rule that leaks into every sourcing run's "Buyer's standing rules".
--
-- Background: tests/integration/bom-pipeline-enqueue-alias-leak.test.ts approves
-- a rule ("Always expedite Alias Leak Project A <suffix> orders via Digikey")
-- against the SHARED Supabase and cleans up in a finally. If that test ever died
-- mid-run, the APPROVED (status='active') rule survives while its subject project
-- gets deleted. buildGlobalAliasMapping only knows names still in smark_projects,
-- so the orphaned rule's real name can no longer be aliased and leaks verbatim
-- into the desktop agent's CLAUDE.md (confirmed by the live agent, 2026-07-20).
--
-- The injected digest is a CACHED doc (getDigestForInjection reads the latest
-- smark_learned_rules_doc.content), so retiring the rule ALONE is not enough —
-- a fresh doc version must be written from the remaining active rules.
--
-- PREFERRED FIX (no SQL): open the app → AI Memory screen → find the "Alias Leak
-- Project A ..." rule → click Retire. retireRule() flips it to 'retired' AND
-- writes a new digest version (lib/ai/digest.ts). Use the SQL below only if the
-- rule doesn't render on that screen (its deleted project can break the row) or
-- you prefer to do it directly. Run in the Supabase dashboard SQL editor.


-- A) INSPECT — find the offending rule(s). Expect status='active'.
select id, scope, subject, rule_type, status, value, created_at
from public.smark_learned_rules
where value::text ilike '%Alias Leak Project A%'
   or value::text ilike '%expedite%digikey%';

-- A2) What the injected digest currently says (the leaked line lives here).
select version, change_summary, content
from public.smark_learned_rules_doc
order by version desc
limit 1;


-- B) RETIRE the orphaned rule(s). ('retired' is the terminal status; there is no
--    path back, mirroring retireRule(). Adjust the WHERE to the exact id from A
--    if you want to be surgical.)
update public.smark_learned_rules
set status = 'retired'
where status = 'active'
  and (value::text ilike '%Alias Leak Project A%'
       or value::text ilike '%expedite%digikey%');


-- C) REBUILD the digest doc from the remaining ACTIVE rules, mirroring
--    buildDigestContent()/bumpDigest() so getDigestForInjection() serves a clean
--    copy on the next run. Inserts version = max+1.
with active_numbered as (
  select
    row_number() over (order by created_at, id) as n,
    initcap(scope)                              as scope_label,
    coalesce(subject, 'All')                    as subj,
    coalesce(
      nullif(btrim(value->>'text'), ''),
      case rule_type
        when 'prefer_distributor' then 'Prefer distributor'
        when 'avoid_distributor'  then 'Avoid distributor'
        when 'already_stocked'    then 'Already stocked'
        when 'package_correction' then 'Package correction'
        when 'status_preference'  then 'Status preference'
        when 'price_source_note'  then 'Price source note'
        else rule_type
      end
    ) as rule_text
  from public.smark_learned_rules
  where status = 'active'
)
insert into public.smark_learned_rules_doc (version, content, change_summary, created_by)
select
  coalesce((select max(version) from public.smark_learned_rules_doc), 0) + 1,
  coalesce(
    (select string_agg('' || n || '. [' || scope_label || '] ' || subj || ' — ' || rule_text, E'\n' order by n)
     from active_numbered),
    'No active rules yet.'
  ),
  'cleanup: retired orphaned test rule (Alias Leak Project A) + rebuilt digest',
  null;


-- D) VERIFY — A should now return no 'active' rows, and the newest digest must
--    NOT contain "Alias Leak Project A".
select version, change_summary, content
from public.smark_learned_rules_doc
order by version desc
limit 1;
