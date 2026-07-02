-- ============================================================================
-- seed.sql — SmarkStock deterministic reference/config data
--
-- NOT demo/test data (that's fixture-seeded separately per TESTING.md §4 —
-- "the prototype's mock dataset... promoted to canonical fixtures"). This
-- file holds only fixed, spec-derived CONFIG rows the app needs to function
-- at all from a fresh `supabase db reset`. Extend this file, don't replace
-- it — each block below is independently re-runnable (ON CONFLICT DO NOTHING).
--
-- Currently seeded (0004_ordering_finance.sql tables only — see that
-- migration's header for ownership):
--   · smark_ordering_rules — the standard search ladder (FEATURES.md §7).
--     The 'package' row is what 0004's trigger/check protect — seeded here
--     so that protection has a row to protect.
--   · smark_distributors — the baseline five integrations (FEATURES.md §15).
--     base_url deliberately left NULL: only name + api_type + region are
--     given exact values in the spec text; real site URLs/keys are added
--     via Settings (server-side), not fabricated here.
--   · smark_distributor_preferences — default sequence (REST/API distributors
--     ranked ahead of browser-only ones, per FEATURES.md §15 "prefer API
--     distributors when the part exists there").
--
-- smark_expense_accounts / smark_distributor_preferences ranks beyond the
-- above are real client data (bank/UPI names, owner's preferred order) —
-- intentionally NOT seeded here; they come from onboarding, not this file.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- smark_ordering_rules — FEATURES.md §7 standard search ladder.
-- ----------------------------------------------------------------------------
insert into public.smark_ordering_rules (key, enabled, mandatory, rank, params)
values
  ('mpn',     true, false, 1, null),
  ('lcsc',    true, false, 2, null),
  ('value',   true, false, 3, null),
  ('package', true, true,  4, null), -- mandatory, never substitutable — protected by trigger + check (0004)
  ('status',  true, false, 5, null),
  ('qty',     true, false, 6, null),
  ('cost',    true, false, 7, null)
-- Unqualified (no conflict target): catches a violation of the partial
-- unique index idx_smark_ordering_rules_standard_key (0004) without having
-- to restate its WHERE predicate here.
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- smark_distributors — FEATURES.md §15 baseline five.
-- ----------------------------------------------------------------------------
insert into public.smark_distributors (name, api_type, default_region, active)
values
  ('Digikey',   'rest',   'IN', true),
  ('Mouser',    'rest',   'IN', true),
  ('element14', 'rest',   'IN', true),
  ('LCSC',      'browse', 'IN', true),
  ('Unikey',    'browse', 'IN', true)
on conflict (name) do nothing;


-- ----------------------------------------------------------------------------
-- smark_distributor_preferences — default rank order the per-BOM sequence
-- editor starts from (API distributors first, per §15).
-- ----------------------------------------------------------------------------
insert into public.smark_distributor_preferences (distributor_id, rank, enabled)
select d.id, x.rank, true
from public.smark_distributors d
join (values
  ('Digikey', 1),
  ('Mouser', 2),
  ('element14', 3),
  ('LCSC', 4),
  ('Unikey', 5)
) as x (name, rank) on x.name = d.name
on conflict (distributor_id) do nothing;

-- ============================================================================
-- End of seed.sql
-- ============================================================================
