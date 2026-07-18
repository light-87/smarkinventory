-- ============================================================================
-- 0017_inventory_access_level.sql — per-employee inventory VIEW vs EDIT access
--
-- Owner request: some employees get view-only inventory, others can edit.
-- Extends the existing per-employee module grant (0013, smark_user_module_grants)
-- with an access level, rather than a parallel auth system. Unlike 0013 (which
-- is visibility-only and never touched RLS), THIS migration DOES move a data
-- boundary: it repoints the inventory WRITE policies so a view-only employee is
-- blocked at the database, not just in the UI.
--
--   * access defaults to 'edit' → every existing inventory grant keeps write,
--     so no employee loses access on apply.
--   * owner/accountant never appear in the grants table, so they're unaffected
--     (owner keeps full write via the helper's owner branch; accountant stays
--     read-only as before).
--   * Scope = the physical-inventory tables (parts, shelves, labels, boxes,
--     stock locations, movements, part events, field templates). CART is
--     deliberately NOT gated here — it's a separate ordering surface/table.
-- ============================================================================

-- 1. Access level on the grant. 'edit' default = zero disruption for existing rows.
alter table public.smark_user_module_grants
  add column if not exists access text not null default 'edit'
    check (access in ('view', 'edit'));

comment on column public.smark_user_module_grants.access is
  'For module=inventory: view (read-only) vs edit (can mutate stock). Ignored for other modules (they have no view/edit split). Default edit.';

-- 2. Owner can now UPDATE a grant (to flip access). 0013 had insert/delete only.
create policy smark_user_module_grants_owner_update on public.smark_user_module_grants
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

-- 3. The write-gate helper — the RLS + app twin of "can this caller edit stock".
--    owner OR an employee whose inventory grant is access='edit'. SECURITY
--    DEFINER (reads the grants table past its RLS) + empty search_path, exactly
--    like smark_role().
create or replace function public.smark_can_edit_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.smark_role()) = 'owner'
      or exists (
        select 1
        from public.smark_user_module_grants g
        where g.user_id = (select auth.uid())
          and g.module = 'inventory'
          and g.access = 'edit'
      )
$$;

grant execute on function public.smark_can_edit_inventory() to authenticated, service_role;

-- 4. Repoint every employee-writable inventory policy from the old
--    `smark_role() in ('owner','employee')` to the helper. SELECT policies and
--    the owner-only UPDATE/DELETE policies are left untouched. ALTER POLICY
--    swaps only the expression, preserving the policy name.
--
--    INSERT (all 8 physical-inventory tables):
alter policy smark_parts_insert on public.smark_parts
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_part_field_templates_insert on public.smark_part_field_templates
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_shelves_insert on public.smark_shelves
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_qr_labels_insert on public.smark_qr_labels
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_big_boxes_insert on public.smark_big_boxes
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_stock_locations_insert on public.smark_stock_locations
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_movements_insert on public.smark_movements
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_part_events_insert on public.smark_part_events
  with check ((select public.smark_can_edit_inventory()));

--    UPDATE (only the policies that were employee-eligible; parts/shelves/
--    qr_labels/big_boxes/stock_locations. field_templates + movements UPDATE
--    are owner-only already and stay that way):
alter policy smark_parts_update on public.smark_parts
  using ((select public.smark_can_edit_inventory()))
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_shelves_update on public.smark_shelves
  using ((select public.smark_can_edit_inventory()))
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_qr_labels_update on public.smark_qr_labels
  using ((select public.smark_can_edit_inventory()))
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_big_boxes_update on public.smark_big_boxes
  using ((select public.smark_can_edit_inventory()))
  with check ((select public.smark_can_edit_inventory()));
alter policy smark_stock_locations_update on public.smark_stock_locations
  using ((select public.smark_can_edit_inventory()))
  with check ((select public.smark_can_edit_inventory()));

-- ============================================================================
-- End of 0017_inventory_access_level.sql
-- ============================================================================
