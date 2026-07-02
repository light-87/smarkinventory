-- ============================================================================
-- 0002_catalog_location.sql — SmarkStock: catalog & physical location
--
-- Owns:       smark_parts, smark_part_field_templates, smark_shelves,
--             smark_qr_labels, smark_big_boxes, smark_stock_locations,
--             smark_movements, smark_part_events
--             + smark_recompute_part_total_qty() / smark_sync_part_total_qty()
--               (trigger-maintained smark_parts.total_qty rollup)
-- Depends on: 0001_users_team (smark_app_users, smark_role(),
--             smark_set_updated_at() — shared trigger fn, reused here)
-- Deferred (plain uuid, FK added in 0005 once the tables exist):
--   smark_movements.bom_id            → smark_boms (0003)
--   smark_part_events.project_id      → smark_projects (0003)
--   smark_part_events.order_id        → smark_orders (0004)         [R2-13]
--   smark_part_events.source_run_id   → smark_agent_runs (0004)
--
-- Canonical spec: plan/SCHEMA.md §1 (catalog), §2 (Shelf → Big Box → ESD),
-- §6 (history/movements/labels), §7 (part field templates R2-23).
-- RLS per FEATURES.md §2 matrix — all eight tables are OPERATIONAL:
--   owner = full · employee = read+write · accountant = read-only.
-- ============================================================================


-- ============================================================================
-- 1. smark_parts — the catalog (SCHEMA.md §1 · R2-11 price · R2-24 voltage)
-- ============================================================================

create table public.smark_parts (
  id                  uuid primary key default gen_random_uuid(),
  internal_pid        text not null,               -- short QR value, e.g. 'SMK-000482'
  mpn                 text,
  manufacturer        text,
  lcsc_pn             text,
  description         text,
  category            text,                        -- Capacitor / Resistor / IC / Module / SMPS / Connector / Inductor / ... (open set)
  value               text,                        -- typed facet
  package             text,                        -- typed facet; participates in the MANDATORY package match
  voltage             text,                        -- [R2-24] typed facet, split out of combined value strings ('0.1µF/50V' → '0.1µF' + '50V')
  part_status         text not null default 'active'
                        constraint smark_parts_status_check
                        check (part_status in ('active', 'nrnd', 'eol')),
  datasheet_url       text,
  default_distributor text,
  attributes          jsonb not null default '{}'::jsonb, -- tolerance, dielectric, wattage, current, pin count, custom-field values...
  total_qty           integer not null default 0
                        constraint smark_parts_total_qty_nonnegative
                        check (total_qty >= 0),    -- denormalized Σ smark_stock_locations.qty — trigger-maintained
  reorder_point       integer,                     -- low-stock threshold; NULL = use global Settings default
  source_sheet        text,                        -- import provenance (Stock List sheet name)
  needs_review        boolean not null default false, -- onboarding flag from import
  last_unit_price     numeric(12,2),               -- [R2-11] ₹, stamped on arrival (order line / receipt extraction)
  currency            text not null default 'INR', -- [R2-11]
  created_by          uuid references public.smark_app_users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz,

  constraint smark_parts_internal_pid_unique unique (internal_pid)
);

comment on table public.smark_parts is
  'Part catalog. total_qty is a trigger-maintained rollup of smark_stock_locations.qty; price history lives in smark_part_events.';
comment on column public.smark_parts.total_qty is
  'Denormalized Σ smark_stock_locations.qty for this part — kept in sync by trigger on smark_stock_locations. Do not write directly.';
comment on column public.smark_parts.attributes is
  'Long-tail typed facets (dielectric, tolerance, wattage...) + values of remembered custom fields keyed by smark_part_field_templates.field_key.';

create index idx_smark_parts_mpn                 on public.smark_parts (mpn);
create index idx_smark_parts_lcsc_pn             on public.smark_parts (lcsc_pn);
create index idx_smark_parts_category            on public.smark_parts (category);
create index idx_smark_parts_package             on public.smark_parts (package);
create index idx_smark_parts_voltage             on public.smark_parts (voltage);
create index idx_smark_parts_part_status         on public.smark_parts (part_status);
create index idx_smark_parts_default_distributor on public.smark_parts (default_distributor);
create index idx_smark_parts_total_qty           on public.smark_parts (total_qty);           -- Stock facet (low / out)
create index idx_smark_parts_needs_review        on public.smark_parts (needs_review) where needs_review;
create index idx_smark_parts_attributes_gin      on public.smark_parts using gin (attributes);
create index idx_smark_parts_created_by          on public.smark_parts (created_by);

create trigger trg_smark_parts_updated_at
  before update on public.smark_parts
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 2. smark_part_field_templates — remembered custom part-form fields [R2-23]
-- ============================================================================

create table public.smark_part_field_templates (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  field_key  text not null,                        -- slug; key into smark_parts.attributes
  field_type text not null
               constraint smark_part_field_templates_type_check
               check (field_type in ('text', 'number')),
  active     boolean not null default true,        -- retire in Settings (owner)
  created_by uuid references public.smark_app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,

  constraint smark_part_field_templates_field_key_unique unique (field_key)
);

comment on table public.smark_part_field_templates is
  '[R2-23] Custom fields added from the New-part form ("+ add custom field"), offered on every future form. Values live in smark_parts.attributes.';

create index idx_smark_part_field_templates_active     on public.smark_part_field_templates (active) where active;
create index idx_smark_part_field_templates_created_by on public.smark_part_field_templates (created_by);

create trigger trg_smark_part_field_templates_updated_at
  before update on public.smark_part_field_templates
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 3. smark_shelves — Shelf (top of Shelf → Big Box → ESD plastic)
-- ============================================================================

create table public.smark_shelves (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,                     -- 'A', 'B', ...
  name          text,
  location_note text,
  created_by    uuid references public.smark_app_users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,

  constraint smark_shelves_code_unique unique (code)
);

comment on table public.smark_shelves is
  'Physical shelf (rack band). Created during Receive / onboarding flows.';

create index idx_smark_shelves_created_by on public.smark_shelves (created_by);

create trigger trg_smark_shelves_updated_at
  before update on public.smark_shelves
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 4. smark_qr_labels — smart labels + print queue [R2-35]
--    (created before smark_big_boxes: big_boxes.qr_label_id references it;
--     label→target link is polymorphic, so no FK back the other way)
-- ============================================================================

create table public.smark_qr_labels (
  id            uuid primary key default gen_random_uuid(),
  target_type   text not null
                  constraint smark_qr_labels_target_type_check
                  check (target_type in ('part', 'big_box')),
  target_id     uuid not null,                     -- polymorphic → smark_parts.id | smark_big_boxes.id (no FK by design)
  code_value    text not null,                     -- QR payload: internal PID or big-box id
  human_text    text,
  png_url       text,                              -- R2
  label_pdf_url text,                              -- R2 (batch Avery sheet)
  print_status  text not null default 'queued'
                  constraint smark_qr_labels_print_status_check
                  check (print_status in ('queued', 'printed')), -- [R2-35]
  printed_at    timestamptz,
  batch_id      uuid,                              -- groups labels rendered onto one Avery PDF
  created_by    uuid references public.smark_app_users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,

  -- Print-rule invariant (FEATURES.md §8 / CROSS-FEATURE A3 / TESTING.md §5):
  -- one label per ESD plastic / per big box, never per unit; existing parts
  -- never get reprints — at most ONE label row per target, enforced here.
  constraint smark_qr_labels_one_per_target unique (target_type, target_id)
);

comment on table public.smark_qr_labels is
  '[R2-35] Label rows queue (print_status=queued) and batch-print onto one Avery PDF. Invariant: exactly one label per target, never reprints.';
comment on column public.smark_qr_labels.target_id is
  'Polymorphic: smark_parts.id when target_type=part, smark_big_boxes.id when target_type=big_box. No FK on purpose.';

create index idx_smark_qr_labels_target       on public.smark_qr_labels (target_type, target_id);
create index idx_smark_qr_labels_print_status on public.smark_qr_labels (print_status) where print_status = 'queued';
create index idx_smark_qr_labels_batch_id     on public.smark_qr_labels (batch_id);
create index idx_smark_qr_labels_created_by   on public.smark_qr_labels (created_by);

create trigger trg_smark_qr_labels_updated_at
  before update on public.smark_qr_labels
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 5. smark_big_boxes — Big Box on a shelf
-- ============================================================================

create table public.smark_big_boxes (
  id          uuid primary key default gen_random_uuid(),
  shelf_id    uuid not null references public.smark_shelves (id),
  name        text not null,                       -- e.g. 'A-03'
  category    text,                                -- drives AI storage suggestion (boxByCategory)
  notes       text,
  qr_label_id uuid references public.smark_qr_labels (id),
  created_by  uuid references public.smark_app_users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

comment on table public.smark_big_boxes is
  'Big Box (middle of Shelf → Big Box → ESD plastic). Carries exactly one box QR label.';

create index idx_smark_big_boxes_shelf_id    on public.smark_big_boxes (shelf_id);
create index idx_smark_big_boxes_category    on public.smark_big_boxes (category);
create index idx_smark_big_boxes_qr_label_id on public.smark_big_boxes (qr_label_id);
create index idx_smark_big_boxes_created_by  on public.smark_big_boxes (created_by);

create trigger trg_smark_big_boxes_updated_at
  before update on public.smark_big_boxes
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 6. smark_stock_locations — the ESD plastic (leaf of the hierarchy)
-- ============================================================================

create table public.smark_stock_locations (
  id              uuid primary key default gen_random_uuid(),
  part_id         uuid not null references public.smark_parts (id),
  big_box_id      uuid not null references public.smark_big_boxes (id),
  qty             integer not null default 0
                    constraint smark_stock_locations_qty_nonnegative
                    check (qty >= 0),
  esd_note        text,
  last_counted_at timestamptz,                     -- stamped by the guided box audit
  created_by      uuid references public.smark_app_users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.smark_stock_locations is
  'ESD plastic holding a part in a big box. One home per part normally; a second row allowed for the bulk (reel + working box) case — enforced in app, not schema.';

create index idx_smark_stock_locations_part_id    on public.smark_stock_locations (part_id);
create index idx_smark_stock_locations_big_box_id on public.smark_stock_locations (big_box_id);
create index idx_smark_stock_locations_created_by on public.smark_stock_locations (created_by);

create trigger trg_smark_stock_locations_updated_at
  before update on public.smark_stock_locations
  for each row execute function public.smark_set_updated_at();

-- ----------------------------------------------------------------------------
-- total_qty rollup sync — SCHEMA.md "Derived values": smark_parts.total_qty =
-- Σ its locations' qty at every movement / receive / adjust. Trigger-maintained
-- so the invariant (TESTING.md §5, property-tested) can't drift from app bugs.
-- SECURITY DEFINER: the internal UPDATE on smark_parts runs as the migration
-- role (table owner → not subject to RLS), so any role allowed to write
-- stock_locations keeps the rollup correct.
-- ----------------------------------------------------------------------------

create or replace function public.smark_recompute_part_total_qty(p_part_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.smark_parts p
     set total_qty = coalesce(
       (select sum(sl.qty) from public.smark_stock_locations sl where sl.part_id = p_part_id), 0)
   where p.id = p_part_id
     and p.total_qty is distinct from coalesce(
       (select sum(sl.qty) from public.smark_stock_locations sl where sl.part_id = p_part_id), 0);
$$;

comment on function public.smark_recompute_part_total_qty(uuid) is
  'Recomputes smark_parts.total_qty from smark_stock_locations for one part. Called by the sync trigger; safe to call directly (self-healing no-op when already correct).';

revoke execute on function public.smark_recompute_part_total_qty(uuid) from public, anon;

create or replace function public.smark_sync_part_total_qty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.smark_recompute_part_total_qty(new.part_id);
  elsif tg_op = 'DELETE' then
    perform public.smark_recompute_part_total_qty(old.part_id);
  else
    perform public.smark_recompute_part_total_qty(new.part_id);
    if new.part_id is distinct from old.part_id then
      perform public.smark_recompute_part_total_qty(old.part_id);
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.smark_sync_part_total_qty() from public, anon;

create trigger trg_smark_stock_locations_sync_total_qty
  after insert or update or delete on public.smark_stock_locations
  for each row execute function public.smark_sync_part_total_qty();


-- ============================================================================
-- 7. smark_movements — every stock mutation, undoable (SCHEMA.md §6)
-- ============================================================================

create table public.smark_movements (
  id         uuid primary key default gen_random_uuid(),
  part_id    uuid not null references public.smark_parts (id),
  big_box_id uuid references public.smark_big_boxes (id),
  delta_qty  integer not null,
  reason     text not null
               constraint smark_movements_reason_check
               check (reason in ('pick', 'receive', 'adjust', 'bulk_pick', 'undo')),
  -- [FEATURES.md §5.4 / §9] Guided box-audit variances are `adjust` movements
  -- TAGGED `audit`. This nullable qualifier distinguishes them from manual
  -- adjustments (queryable in Daily Reports / part history) WITHOUT adding a
  -- sixth value to the reason enum — SCHEMA.md §6 keeps reason=adjust. The
  -- cross-column CHECK (table level, below) pins the tag to adjust rows and to
  -- the single documented value.
  reason_detail text,
  bom_id     uuid,                                 -- → smark_boms (0003). Plain uuid ON PURPOSE: FK deferred to 0005.
  actor      uuid not null references public.smark_app_users (id),
  undo_of    uuid references public.smark_movements (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,

  -- Invariant (TESTING.md §5): every movement is undoable exactly ONCE.
  constraint smark_movements_undo_of_unique unique (undo_of),
  -- Pairing: undo rows point at their target; non-undo rows never carry undo_of.
  constraint smark_movements_undo_pairing
    check ((reason = 'undo') = (undo_of is not null)),
  -- [FEATURES.md §5.4/§9] the 'audit' tag is only valid on an adjust movement.
  constraint smark_movements_reason_detail_check
    check (reason_detail is null
           or (reason_detail = 'audit' and reason = 'adjust'))
);

comment on table public.smark_movements is
  'Audit trail of every stock mutation. Undo = a NEW row with reason=undo pointing at the original via undo_of (unique → undoable once). Guided box-audit variances land as reason=adjust tagged reason_detail=''audit'' (FEATURES.md §5.4/§9) — distinguishable from manual adjusts in Daily Reports/history.';
comment on column public.smark_movements.reason_detail is
  '[FEATURES.md §5.4/§9] Nullable qualifier on reason. ''audit'' marks a guided box-audit variance (reason must then be ''adjust''); null for every other movement. Lets Daily Reports/history separate audit variances from manual adjustments without a sixth reason enum value.';
comment on column public.smark_movements.bom_id is
  'References smark_boms.id (created in 0003_projects_boms) — deliberately no FK constraint here to keep the 0001→0005 apply order acyclic; FK added in 0005.';

create index idx_smark_movements_part_id    on public.smark_movements (part_id);
create index idx_smark_movements_big_box_id on public.smark_movements (big_box_id);
create index idx_smark_movements_actor      on public.smark_movements (actor);
create index idx_smark_movements_bom_id     on public.smark_movements (bom_id);
create index idx_smark_movements_created_at on public.smark_movements (created_at desc); -- dashboard recent / movements-today / daily reports

create trigger trg_smark_movements_updated_at
  before update on public.smark_movements
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 8. smark_part_events — append-only living record (SCHEMA.md §6 + R2-13)
-- ============================================================================

create table public.smark_part_events (
  id                  uuid primary key default gen_random_uuid(),
  part_id             uuid not null references public.smark_parts (id),
  event_type          text not null
                        constraint smark_part_events_type_check
                        check (event_type in (
                          'ordered', 'received', 'adjusted', 'note',   -- base set
                          'picked', 'price_change', 'location_moved'   -- [R2-13] extensions
                        )),
  distributor         text,
  order_link          text,
  project_id          uuid,                        -- → smark_projects (0003). Plain uuid ON PURPOSE: FK deferred to 0005.
  reason              text,
  qty                 integer,
  unit_price          numeric(12,2),
  price_old           numeric(12,2),               -- [R2-13] populated on price_change rows (old → new)
  price_new           numeric(12,2),               -- [R2-13]
  order_id            uuid,                        -- [R2-13] → smark_orders (0004). Plain uuid ON PURPOSE: FK deferred to 0005.
  location_big_box_id uuid references public.smark_big_boxes (id),
  actor               uuid references public.smark_app_users (id), -- nullable: system-generated rows (auto price_change)
  source_run_id       uuid,                        -- → smark_agent_runs (0004). Plain uuid ON PURPOSE: FK deferred to 0005.
  occurred_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

comment on table public.smark_part_events is
  '[R2-13] Append-only living record per part ("everything written on it with timestamps"). No UPDATE/DELETE policies by design. Client attribution = render-time join project_id → smark_projects.client (no denormalized copy).';
comment on column public.smark_part_events.project_id is
  'References smark_projects.id (created in 0003_projects_boms) — deliberately no FK constraint here; FK added in 0005.';
comment on column public.smark_part_events.order_id is
  '[R2-13] References smark_orders.id (created in 0004_ordering_finance) — deliberately no FK constraint here; FK added in 0005. Powers the PO chip + "where it was ordered from".';
comment on column public.smark_part_events.source_run_id is
  'References smark_agent_runs.id (created in 0004_ordering_finance) — deliberately no FK constraint here; FK added in 0005.';

create index idx_smark_part_events_part_timeline on public.smark_part_events (part_id, occurred_at desc); -- part-detail timeline
create index idx_smark_part_events_occurred_at   on public.smark_part_events (occurred_at desc);          -- daily reports day slice
create index idx_smark_part_events_event_type    on public.smark_part_events (event_type);
create index idx_smark_part_events_project_id    on public.smark_part_events (project_id);
create index idx_smark_part_events_order_id      on public.smark_part_events (order_id);
create index idx_smark_part_events_actor         on public.smark_part_events (actor);
create index idx_smark_part_events_location_box  on public.smark_part_events (location_big_box_id);
create index idx_smark_part_events_source_run_id on public.smark_part_events (source_run_id);

create trigger trg_smark_part_events_updated_at
  before update on public.smark_part_events
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- RLS — matrix FINAL (Q-01; FEATURES.md §2, SCHEMA.md RLS §)
-- All eight tables here are OPERATIONAL:
--   owner → full · employee → read + write · accountant → read-only.
-- Encoding decisions:
--   · DELETE is owner-only everywhere (history/FK safety; employee "write" =
--     INSERT + UPDATE — stock corrections go through adjust/undo movements).
--   · smark_movements: UPDATE/DELETE owner-only escape hatch (undo is a new
--     row, so nobody edits movements in normal operation).
--   · smark_part_events: append-only — NO update/delete policy for ANY role.
--   · smark_part_field_templates: INSERT from the Receive form (employee ok);
--     retire (UPDATE) is a Settings action → owner-only.
-- Worker/service role bypasses RLS by definition.
-- ============================================================================

-- ---- smark_parts ------------------------------------------------------------
alter table public.smark_parts enable row level security;

create policy smark_parts_select on public.smark_parts
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_parts_insert on public.smark_parts
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_parts_update on public.smark_parts
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_parts_delete on public.smark_parts
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_part_field_templates ----------------------------------------------
alter table public.smark_part_field_templates enable row level security;

create policy smark_part_field_templates_select on public.smark_part_field_templates
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_part_field_templates_insert on public.smark_part_field_templates
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_part_field_templates_update on public.smark_part_field_templates
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_part_field_templates_delete on public.smark_part_field_templates
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_shelves ------------------------------------------------------------
alter table public.smark_shelves enable row level security;

create policy smark_shelves_select on public.smark_shelves
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_shelves_insert on public.smark_shelves
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_shelves_update on public.smark_shelves
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_shelves_delete on public.smark_shelves
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_qr_labels -----------------------------------------------------------
alter table public.smark_qr_labels enable row level security;

create policy smark_qr_labels_select on public.smark_qr_labels
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_qr_labels_insert on public.smark_qr_labels
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_qr_labels_update on public.smark_qr_labels
  for update to authenticated -- batch print flips queued → printed (Receive surface, employee ok)
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_qr_labels_delete on public.smark_qr_labels
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_big_boxes -----------------------------------------------------------
alter table public.smark_big_boxes enable row level security;

create policy smark_big_boxes_select on public.smark_big_boxes
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_big_boxes_insert on public.smark_big_boxes
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_big_boxes_update on public.smark_big_boxes
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_big_boxes_delete on public.smark_big_boxes
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_stock_locations -----------------------------------------------------
alter table public.smark_stock_locations enable row level security;

create policy smark_stock_locations_select on public.smark_stock_locations
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_stock_locations_insert on public.smark_stock_locations
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_stock_locations_update on public.smark_stock_locations
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_stock_locations_delete on public.smark_stock_locations
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_movements -----------------------------------------------------------
alter table public.smark_movements enable row level security;

create policy smark_movements_select on public.smark_movements
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_movements_insert on public.smark_movements
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_movements_update on public.smark_movements
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_movements_delete on public.smark_movements
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_part_events (append-only: NO update/delete policies) -----------------
alter table public.smark_part_events enable row level security;

create policy smark_part_events_select on public.smark_part_events
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_part_events_insert on public.smark_part_events
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));


-- ============================================================================
-- Table-level GRANTs — required before any RLS policy above can matter.
--
-- Local-stack verified gotcha: tables created by CLI migrations (`supabase db
-- reset` / `supabase start`) are owned by the `postgres` role, which carries a
-- MUCH narrower default ACL than `supabase_admin` (the role Supabase's own
-- dashboard/internal schemas use). Confirmed via `pg_default_acl`: objects
-- created as `postgres` give anon/authenticated/service_role only
-- TRUNCATE/REFERENCES/TRIGGER — no SELECT/INSERT/UPDATE/DELETE. Without an
-- explicit GRANT, every query against these tables fails at
-- "permission denied for table ..." BEFORE Postgres ever reaches the RLS
-- policies above — for every role, INCLUDING service_role (BYPASSRLS skips
-- policy evaluation, not the coarser table-level privilege check; verified
-- with `SET ROLE service_role` locally).
--
-- `authenticated` gets full CRUD at the GRANT layer; the policies above are
-- what actually restrict by role/row (e.g. smark_part_events has no
-- update/delete POLICY, so the grant is inert for those commands — RLS
-- default-denies any command with no matching policy). `anon` gets NOTHING on
-- these eight operational tables: the client portal (FEATURES.md §11) reads
-- ONLY through SECURITY DEFINER functions (DEFERRED to Phase 4 — FEATURES.md
-- §19; NOT defined in 0005, which adds only the three read-only views), which
-- run with the function owner's privileges, not the caller's, so they will
-- need no table-level grant to anon here.
--
-- NOTE for the migration owning 0001/0003/0004: `smark_app_users`,
-- `smark_projects`, `smark_boms`, etc. were verified to have the SAME missing
-- grants (same root cause — every table in this project inherits `postgres`'s
-- narrow default ACL, not just this file's). Each domain migration should
-- grant its own tables the same way, or a follow-up migration should grant
-- every smark_ table in one pass — otherwise the app is fully non-functional
-- (every PostgREST call denied) regardless of how correct the RLS is.
-- ============================================================================

grant select, insert, update, delete on public.smark_parts                to authenticated, service_role;
grant select, insert, update, delete on public.smark_part_field_templates to authenticated, service_role;
grant select, insert, update, delete on public.smark_shelves              to authenticated, service_role;
grant select, insert, update, delete on public.smark_qr_labels            to authenticated, service_role;
grant select, insert, update, delete on public.smark_big_boxes            to authenticated, service_role;
grant select, insert, update, delete on public.smark_stock_locations      to authenticated, service_role;
grant select, insert, update, delete on public.smark_movements            to authenticated, service_role;
grant select, insert, update, delete on public.smark_part_events          to authenticated, service_role;

-- ============================================================================
-- End of 0002_catalog_location.sql
-- ============================================================================
