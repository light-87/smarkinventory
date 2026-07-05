-- 04-fix-distributor-api-types.sql — run once in the cloud Supabase SQL editor.
--
-- F-008: the cloud smark_distributors seed marked ALL five distributors
-- api_type = 'browse'. Digikey / Mouser / Element14 have REST clients in the
-- worker (worker/src/distributors/) and NO scraper URL pattern — as 'browse'
-- they contribute nothing (the driver logs "no search URL pattern" and
-- returns 0 listings). As 'rest' they use real APIs once their keys are set
-- (until then they fall back to the deterministic mock, so keep them
-- DISABLED in a BOM's distributor sequence when testing real accuracy).
--
-- LCSC and Unikey stay 'browse' — that's correct; they have no public API.

update smark_distributors set api_type = 'rest' where name in ('Digikey', 'Mouser', 'Element14');

-- verify
select name, api_type, active from smark_distributors order by name;
