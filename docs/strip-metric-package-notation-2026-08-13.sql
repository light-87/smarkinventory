-- Strip the metric restatement from package names, 2026-08-13
--
-- Client: "packages should not include metric notations for resistors and
-- capacitors. Remove metric notations in bracket (like 1005 Metric) from all
-- such data."
--
-- Applied to EVERY category, not only resistors and capacitors. Inductors,
-- diodes and LEDs carry the same "(1608 Metric)" suffix, and leaving them means
-- the Package filter lists `0603` and `0603 (1608 Metric)` as two separate
-- options that each match half the stock — the exact split-filter problem that
-- `canonicalPackage` was written to solve for the facets.
--
-- Matching is unaffected either way: `packageKey` in lib/matcher already drops
-- any parenthetical before comparing, so `0603 (1608 Metric)` and `0603` have
-- always keyed the same. This is about what a person reads on screen.
--
-- Run in the Supabase SQL editor on the production project.

-- 1. What will change, and to what. Expect ~1,100 rows across chip packages.
select   package as before,
         btrim(regexp_replace(package, '\s*\([^)]*\)\s*', '', 'g')) as after,
         count(*) as parts
from     smark_parts
where    package ~ '\([^)]*[Mm]etric[^)]*\)'
group by 1, 2
order by parts desc;

-- 2. Apply.
begin;

update smark_parts
set    package = btrim(regexp_replace(package, '\s*\([^)]*\)\s*', '', 'g')),
       updated_at = now()
where  package ~ '\([^)]*[Mm]etric[^)]*\)';

-- 3. Expect zero rows.
select count(*) as still_with_metric
from   smark_parts
where  package ~ '\([^)]*[Mm]etric[^)]*\)';

commit;

-- Note: only the parenthetical is removed. A package that is nothing BUT a
-- parenthetical would become empty, so this deliberately uses btrim + a guard
-- on the WHERE clause rather than blanking anything; check step 1's output for
-- an `after` column that is empty before committing.
