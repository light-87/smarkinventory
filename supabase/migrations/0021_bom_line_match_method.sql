-- 0021_bom_line_match_method.sql
--
-- Persists WHICH rung of the matcher ladder linked a BOM line to a part.
--
-- `lib/bom/reconcile.ts` has always computed this (`ReconcileLineOutcome.
-- matchMethod`) but `lib/bom/service.ts` had nowhere to put it, so it was
-- dropped on the floor. That was harmless while reconcile only ever matched on
-- keyed identity (MPN → LCSC PN): every link was equally trustworthy.
--
-- It stopped being harmless when reconcile started feeding rung 3 (exact value
-- + package). Most of the real catalog is generic passives with no MPN and no
-- LCSC number, so rung 3 is the only way those lines ever resolve — but a link
-- inferred from "0.1uF + C0402" is a different KIND of claim from one asserted
-- by a part number, and the person reading the BOM has to be able to tell them
-- apart. Manual-test finding F-002 was hard to spot precisely because it wasn't
-- visible which links had been inferred.
--
-- Nullable with no default and no backfill: existing rows genuinely don't know
-- how they were matched, and null reads as "unknown", not as a method. The next
-- reconcile of any BOM fills its own lines in.

alter table public.smark_bom_lines
  add column match_method text
    constraint smark_bom_lines_match_method_check
    check (match_method is null or match_method in ('mpn', 'lcsc', 'value_pkg'));

comment on column public.smark_bom_lines.match_method is
  'Which matcher rung produced matched_part_id: mpn / lcsc (keyed identity, confidence 100) or value_pkg (exact value + package, confidence < 100 — badged in the BOM view). Null = matched before this column existed, or not matched.';

-- Partial: the BOM view only ever asks for the inferred ones, to badge them.
create index idx_smark_bom_lines_match_method
  on public.smark_bom_lines (match_method)
  where match_method = 'value_pkg';
