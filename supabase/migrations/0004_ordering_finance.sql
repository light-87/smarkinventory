-- ============================================================================
-- 0004_ordering_finance.sql — SmarkStock: distributors, ordering pipeline,
--                              learning loop, AI aliases, finance
--
-- Owns:       smark_distributors, smark_distributor_preferences,
--             smark_ordering_rules, smark_agent_runs, smark_order_jobs,
--             smark_agent_results, smark_cart_items, smark_orders,
--             smark_order_lines, smark_agent_feedback, smark_learned_rules,
--             smark_learned_rules_doc, smark_ai_aliases, smark_expense_accounts,
--             smark_expenses
--             + smark_block_package_rule_delete() (protects the mandatory
--               package rung in smark_ordering_rules)
-- Depends on: 0001_users_team (smark_app_users, smark_role(), smark_set_updated_at())
--             0002_catalog_location (smark_parts)
--             0003_projects_boms (smark_projects, smark_boms, smark_bom_lines)
--
-- Intra-file forward reference: smark_agent_feedback.converted_rule_id and
-- smark_learned_rules.source_feedback_id reference EACH OTHER. Resolved by
-- creating smark_agent_feedback first with converted_rule_id as a plain uuid,
-- then smark_learned_rules with its FK declared normally, then an ALTER TABLE
-- at the end of §10/§11 adding the converted_rule_id FK once both exist.
--
-- Cross-domain FK left deferred to 0005 (tables below don't exist until this
-- file runs, so migrations 0001–0003 declared these columns as plain uuid):
--   smark_part_events.order_id / .source_run_id  → smark_orders / smark_agent_runs
--   smark_boms.saved_run_id                       → smark_agent_runs
--
-- RLS per FEATURES.md §2 matrix, SCHEMA.md RLS §, CROSS-FEATURE.md, with two
-- deliberate special cases (see inline comments at each table):
--   · smark_order_jobs / smark_agent_results / smark_ai_aliases — SERVICE
--     ROLE ONLY. RLS enabled, NO policies for authenticated/anon at all.
--     All client-facing reads/writes (streaming results to the review screen,
--     persisting the review's "selected" pick, the alias service) MUST go
--     through server-side code (Route Handlers / Server Actions) using the
--     service-role client — never a direct browser PostgREST/Realtime call.
--   · smark_learned_rules / smark_learned_rules_doc — OWNER ONLY (FEATURES.md
--     "AI Memory approve · Settings · user management | full | hidden | hidden").
--   · smark_expenses / smark_expense_accounts — owner + ACCOUNTANT (the one
--     role besides owner with write access anywhere in this schema);
--     employee gets NO policies (Expenses area is fully hidden from them).
-- Everything else follows "Projects (BOMs, runs, review, cart-add) · Cart &
-- checkout | full | full | read-only" (owner/employee/accountant) or the
-- Settings-reference-data pattern (read by all three, write owner-only).
-- ============================================================================


-- ============================================================================
-- 1. smark_distributors — addable via Settings [R2-28]
--    Keys are server-side env vars, never a column here (global standards +
--    tab-settings.md: "smark_distributors keys (server-side env in reality)").
-- ============================================================================
create table public.smark_distributors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  api_type       text not null
                   constraint smark_distributors_api_type_check
                   check (api_type in ('rest', 'browse', 'none')),
  base_url       text,
  default_region text,
  active         boolean not null default true,
  created_by     uuid references public.smark_app_users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,

  constraint smark_distributors_name_unique unique (name)
);

comment on table public.smark_distributors is
  'Order-search distributors (Digikey, Mouser, element14, LCSC, Unikey + Settings-added sites). "Baseline fixed-5 list is now just the seed set" (tab-settings.md R2-28).';

create index idx_smark_distributors_active     on public.smark_distributors (active);
create index idx_smark_distributors_api_type   on public.smark_distributors (api_type);
create index idx_smark_distributors_created_by on public.smark_distributors (created_by);

create trigger trg_smark_distributors_updated_at
  before update on public.smark_distributors
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 2. smark_distributor_preferences — global default sequence [SCHEMA §5]
--    The per-BOM `smark_boms.distributor_sequence` editor starts from this.
-- ============================================================================
create table public.smark_distributor_preferences (
  id             uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.smark_distributors (id) on delete cascade,
  rank           integer not null,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,

  constraint smark_distributor_preferences_distributor_unique unique (distributor_id)
);

comment on table public.smark_distributor_preferences is
  'One ranked row per distributor — the global default the per-BOM distributor_sequence editor starts from.';

create index idx_smark_distributor_preferences_rank on public.smark_distributor_preferences (rank);

create trigger trg_smark_distributor_preferences_updated_at
  before update on public.smark_distributor_preferences
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 3. smark_ordering_rules — the standard search ladder [FEATURES.md §7]
--    Package rung: mandatory=true, enabled=true, NEVER deletable — a CHECK
--    stops any UPDATE from weakening it (any role, no RLS escape); a BEFORE
--    DELETE trigger stops removal outright (CHECK cannot intercept DELETE).
--    Both guards fire regardless of role, including owner/service_role —
--    triggers and CHECK constraints are not subject to RLS bypass.
-- ============================================================================
create table public.smark_ordering_rules (
  id         uuid primary key default gen_random_uuid(),
  key        text not null
               constraint smark_ordering_rules_key_check
               check (key in ('mpn', 'lcsc', 'value', 'package', 'status', 'qty', 'cost', 'custom')),
  enabled    boolean not null default true,
  mandatory  boolean not null default false,
  params     jsonb,                              -- e.g. custom-rule free text: {"text": "Prefer RoHS-compliant parts"}
  rank       integer not null,
  created_by uuid references public.smark_app_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz,

  constraint smark_ordering_rules_package_locked
    check (key <> 'package' or (mandatory and enabled))
);

comment on table public.smark_ordering_rules is
  'The standard search ladder (FEATURES.md §7) + Settings-added custom rows. Read-only display in the Ordering workspace; edit (Settings) is owner-only.';
comment on column public.smark_ordering_rules.mandatory is
  'true ONLY for key=package (enforced by smark_ordering_rules_package_locked) — "package match is mandatory, never substitutable" (CROSS-FEATURE A3).';

-- One row per STANDARD rung (mpn/lcsc/value/package/status/qty/cost);
-- 'custom' rows (Settings "Add rule") are unrestricted in count.
create unique index idx_smark_ordering_rules_standard_key
  on public.smark_ordering_rules (key)
  where key <> 'custom';

create index idx_smark_ordering_rules_rank       on public.smark_ordering_rules (rank);
create index idx_smark_ordering_rules_created_by on public.smark_ordering_rules (created_by);

create trigger trg_smark_ordering_rules_updated_at
  before update on public.smark_ordering_rules
  for each row execute function public.smark_set_updated_at();

create or replace function public.smark_block_package_rule_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.key = 'package' then
    raise exception 'smark_ordering_rules: the package rule (key=package) is mandatory and cannot be deleted';
  end if;
  return old;
end;
$$;

comment on function public.smark_block_package_rule_delete() is
  'BEFORE DELETE guard: blocks removal of the package rung (FEATURES.md §7/§8 — package match is mandatory, never substitutable).';

revoke execute on function public.smark_block_package_rule_delete() from public, anon;

create trigger trg_smark_ordering_rules_protect_package
  before delete on public.smark_ordering_rules
  for each row execute function public.smark_block_package_rule_delete();


-- ============================================================================
-- 4. smark_agent_runs — one run per (project, BOM) invocation [R2-03 ripple]
-- ============================================================================
create table public.smark_agent_runs (
  id                 uuid primary key default gen_random_uuid(),
  bom_id             uuid not null references public.smark_boms (id), -- no ON DELETE clause (RESTRICT): protects run/cost history — archive/retire a BOM's project instead of deleting it once it has been run
  status             text not null default 'planning'
                        constraint smark_agent_runs_status_check
                        check (status in ('planning', 'running', 'review', 'done', 'failed')),
  concurrency_preset text not null default 'balanced'
                        constraint smark_agent_runs_concurrency_preset_check
                        check (concurrency_preset in ('economy', 'balanced', 'thorough')),
  fanout_width       integer not null,
  depth_per_item     integer not null,
  per_site_cap       integer not null,           -- hard cap; ALWAYS beats the concurrency preset (FEATURES.md §15 — never user-overridable)
  est_cost           numeric(12,2),
  actual_cost        numeric(12,2),               -- [R2-37] feeds the AI spend meter
  plan               jsonb,
  rules_doc_version  integer,                     -- version of smark_learned_rules_doc injected into this plan
  started_by         uuid references public.smark_app_users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

comment on table public.smark_agent_runs is
  'One ordering-pipeline run per (project, BOM) invocation. Opus plans only, never browses (FEATURES.md §4). Run + its review are one stored, reproducible artifact [R2-08].';
comment on column public.smark_agent_runs.per_site_cap is
  'Fixed small per-distributor concurrency cap that ALWAYS overrides the user-facing tier knob (FEATURES.md §15 ToS posture).';

create index idx_smark_agent_runs_bom_id     on public.smark_agent_runs (bom_id);
create index idx_smark_agent_runs_status     on public.smark_agent_runs (status);
create index idx_smark_agent_runs_started_by on public.smark_agent_runs (started_by);

create trigger trg_smark_agent_runs_updated_at
  before update on public.smark_agent_runs
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 5. smark_order_jobs — worker claim queue (FOR UPDATE SKIP LOCKED)
--    Pure worker-internal plumbing — no UI surface in FEATURES.md reads this
--    table directly (progress/done-total renders from smark_agent_results +
--    smark_agent_runs). RLS locked to service-role only — see §RLS below.
-- ============================================================================
create table public.smark_order_jobs (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.smark_agent_runs (id) on delete cascade,
  bom_line_id uuid not null references public.smark_bom_lines (id) on delete cascade,
  plan        jsonb,
  status      text not null default 'queued'
                constraint smark_order_jobs_status_check
                check (status in ('queued', 'claimed', 'done', 'failed')),
  claimed_at  timestamptz,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

comment on table public.smark_order_jobs is
  'Worker claim queue, one row per (run, bom_line) fan-out unit. Claimed atomically via SELECT ... FOR UPDATE SKIP LOCKED by the always-on Browser-Worker. Service-role only (see RLS §).';

create index idx_smark_order_jobs_run_id      on public.smark_order_jobs (run_id);
create index idx_smark_order_jobs_bom_line_id on public.smark_order_jobs (bom_line_id);
-- Atomic-claim scan: queued jobs in FIFO order.
create index idx_smark_order_jobs_queued
  on public.smark_order_jobs (created_at)
  where status = 'queued';

create trigger trg_smark_order_jobs_updated_at
  before update on public.smark_order_jobs
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 6. smark_agent_results — one row per (run, bom_line, distributor) [streamed]
--    [R2-08] selected/selected_by/selected_at persist the review's chosen
--    option with the run. RLS locked to service-role only — see §RLS below
--    (streaming to the review screen + the "select this option" write both
--    go through server-side code, not direct client table access).
-- ============================================================================
create table public.smark_agent_results (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.smark_agent_runs (id) on delete cascade,
  bom_line_id    uuid not null references public.smark_bom_lines (id) on delete cascade,
  part_id        uuid references public.smark_parts (id) on delete set null,
  distributor_id uuid not null references public.smark_distributors (id), -- no ON DELETE clause (RESTRICT): protects result/review history
  price          numeric(12,2),
  qty_breaks     jsonb,                          -- [{qty, unit_price}]
  stock_qty      integer,
  mpn_match      text not null
                   constraint smark_agent_results_mpn_match_check
                   check (mpn_match in ('exact', 'approx', 'none')),
  package_match  boolean not null default false,
  part_status    text
                   constraint smark_agent_results_part_status_check
                   check (part_status in ('active', 'nrnd', 'eol')), -- distributor-reported lifecycle status
  order_link     text,
  is_recommended boolean not null default false,
  raw            jsonb,                          -- full scraped/API payload — server-controlled, never sent to the client unfiltered
  confidence     numeric,                        -- 0–100 agent confidence
  selected       boolean not null default false, -- [R2-08]
  selected_by    uuid references public.smark_app_users (id),
  selected_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz
);

comment on table public.smark_agent_results is
  'One row per (run, bom_line, distributor option); worker-inserted, streamed to the review UI via server-mediated Realtime/SSE (FEATURES.md §4). idempotent upserts keyed (run_id, bom_line_id, distributor_id) — app-level, no DB unique constraint (multiple non-selected candidate rows are expected per line).';
comment on column public.smark_agent_results.selected is
  '[R2-08] the review''s chosen option persists with the run; at most one selected result per (run_id, bom_line_id) — see idx_smark_agent_results_one_selected_per_line.';

create index idx_smark_agent_results_run_line     on public.smark_agent_results (run_id, bom_line_id);
create index idx_smark_agent_results_distributor  on public.smark_agent_results (distributor_id);
create index idx_smark_agent_results_part_id      on public.smark_agent_results (part_id);
-- "Radio per option" — a line can have at most one selected result.
create unique index idx_smark_agent_results_one_selected_per_line
  on public.smark_agent_results (run_id, bom_line_id)
  where selected;

create trigger trg_smark_agent_results_updated_at
  before update on public.smark_agent_results
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 7. smark_cart_items — the smart cart [R2-09], stage before an order
--    Aggregation invariant: at most one OPEN/DISMISSED row per catalogued
--    part (client's own example: 500 avail, A needs 400 + B needs 200 →
--    ONE auto line of exactly 100 — never two competing lines for one part).
-- ============================================================================
create table public.smark_cart_items (
  id               uuid primary key default gen_random_uuid(),
  part_id          uuid references public.smark_parts (id), -- no ON DELETE clause (RESTRICT): a part can't be deleted while it's an active cart line; nullable for never-catalogued parts
  descriptor       jsonb,                          -- mpn/lcsc_pn/value/package/voltage/description when part_id is null
  source           text not null
                      constraint smark_cart_items_source_check
                      check (source in ('review_add', 'auto_shortfall', 'manual')),
  demand           jsonb not null default '[]'::jsonb, -- [{project_id,bom_id,bom_line_id,qty}] per-project breakdown; manual adds carry []
  qty_to_order     integer not null check (qty_to_order > 0), -- editable; prefill = shortfall or review qty
  chosen_result_id uuid references public.smark_agent_results (id) on delete set null,
  unit_price       numeric(12,2),                  -- typed at cart stage; receipt extraction can overwrite [R2-12]
  status           text not null default 'open'
                      constraint smark_cart_items_status_check
                      check (status in ('open', 'dismissed', 'ordered')),
  created_by       uuid references public.smark_app_users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,

  constraint smark_cart_items_identity_check
    check (part_id is not null or descriptor is not null)
);

comment on table public.smark_cart_items is
  '[R2-09] Smart cart. Lines aggregate per part across projects — "order the items for all the projects at once" — never one row per project per part.';
comment on column public.smark_cart_items.status is
  'open → ordered forward-only (A3 invariant: cart(open) → ordered → arrived); dismissed applies to auto_shortfall lines only [Q-05] and resurrects only if shortfall grows beyond the dismissed qty (app-level).';

-- Aggregation invariant (Q-05 / client's 500/400+200→100 example): at most
-- one active (open/dismissed) line per catalogued part.
create unique index idx_smark_cart_items_one_active_per_part
  on public.smark_cart_items (part_id)
  where status in ('open', 'dismissed') and part_id is not null;

create index idx_smark_cart_items_part_id      on public.smark_cart_items (part_id);
create index idx_smark_cart_items_status       on public.smark_cart_items (status);
create index idx_smark_cart_items_source       on public.smark_cart_items (source);
create index idx_smark_cart_items_created_by   on public.smark_cart_items (created_by);
create index idx_smark_cart_items_chosen_result on public.smark_cart_items (chosen_result_id);

create trigger trg_smark_cart_items_updated_at
  before update on public.smark_cart_items
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 8. smark_orders — one row per distributor group at checkout [R2-12 · Q-06]
--    Global across projects; bom_id intentionally NOT a column (traceability
--    lives on smark_order_lines). po_number = the DISTRIBUTOR WEBSITE's own
--    order number (required, unique — matches deliveries to what was placed).
-- ============================================================================
create table public.smark_orders (
  id                uuid primary key default gen_random_uuid(),
  distributor_id    uuid not null references public.smark_distributors (id), -- no ON DELETE clause (RESTRICT): protects financial history
  po_number         text not null,
  status            text not null default 'ordered'
                       constraint smark_orders_status_check
                       check (status in ('ordered', 'partially_arrived', 'arrived')),
  placed_by         uuid references public.smark_app_users (id),
  placed_at         timestamptz not null default now(),
  notes             text,
  receipt_url       text,                          -- R2
  receipt_extracted jsonb,                          -- Claude-parsed, user-confirmed before any write-back [R2-12]
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,

  constraint smark_orders_po_number_unique unique (po_number)
);

comment on table public.smark_orders is
  '[R2-12 rework · Q-06 final] One row per distributor group at checkout — a purchase is global across projects; per-project traceability lives on smark_order_lines. Placing a row auto-creates a draft smark_expenses row — application logic (checkout server action, after order_lines + their total are known), not a DB trigger.';
comment on column public.smark_orders.po_number is
  'The distributor WEBSITE''s own order number (Q-06) — required + UNIQUE, used to match deliveries. A distributor group without one stays in the cart; no row is created until it exists.';

create index idx_smark_orders_distributor on public.smark_orders (distributor_id);
create index idx_smark_orders_status      on public.smark_orders (status);
create index idx_smark_orders_placed_by   on public.smark_orders (placed_by);
create index idx_smark_orders_placed_at   on public.smark_orders (placed_at desc);

create trigger trg_smark_orders_updated_at
  before update on public.smark_orders
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 9. smark_order_lines — exploded per (project · bom_line) within an order
--    One smark_cart_items row (which can span multiple projects/bom_lines
--    via its `demand` breakdown) fans out into MULTIPLE order_lines at
--    checkout — one per demand slice — each carrying its own project_id/
--    bom_line_id so traceability survives the cart's aggregation.
-- ============================================================================
create table public.smark_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references public.smark_orders (id) on delete cascade,
  cart_item_id          uuid references public.smark_cart_items (id) on delete set null,
  bom_line_id           uuid references public.smark_bom_lines (id) on delete set null, -- nullable: traceability where known (manual buys have none)
  project_id            uuid references public.smark_projects (id), -- [R2-12] denorm for grouping; no ON DELETE clause (RESTRICT) — "traceability... must never be lost" (CROSS-FEATURE A3); archive the project instead of deleting it once it has order history
  part_id               uuid references public.smark_parts (id),
  chosen_distributor_id uuid references public.smark_distributors (id) on delete set null,
  chosen_result_id      uuid references public.smark_agent_results (id) on delete set null,
  qty_ordered           integer not null check (qty_ordered > 0),
  unit_price            numeric(12,2),
  line_status           text not null default 'ordered'
                           constraint smark_order_lines_line_status_check
                           check (line_status in ('ordered', 'arrived')),
  arrived_qty           integer not null default 0 check (arrived_qty >= 0),
  arrived_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz
);

comment on table public.smark_order_lines is
  'Per-(project · bom_line) traceability within an order. line_status walks forward only (A3): ordered → arrived (put-away closes the loop; arrival stamps smark_parts.last_unit_price, out of this migration''s scope — see 0002).';

create index idx_smark_order_lines_order_id     on public.smark_order_lines (order_id);
create index idx_smark_order_lines_project_id   on public.smark_order_lines (project_id);
create index idx_smark_order_lines_bom_line_id  on public.smark_order_lines (bom_line_id);
create index idx_smark_order_lines_part_id      on public.smark_order_lines (part_id);
create index idx_smark_order_lines_cart_item_id on public.smark_order_lines (cart_item_id);
create index idx_smark_order_lines_line_status  on public.smark_order_lines (order_id, line_status);

create trigger trg_smark_order_lines_updated_at
  before update on public.smark_order_lines
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 10. smark_agent_feedback — per-item + whole-order review feedback
--     Whole-order remarks: result_id null, run_id set (per SCHEMA.md §5).
--     converted_rule_id → smark_learned_rules: FK added in §12 below (after
--     smark_learned_rules exists) to resolve the circular reference.
-- ============================================================================
create table public.smark_agent_feedback (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.smark_agent_runs (id) on delete cascade,
  result_id         uuid references public.smark_agent_results (id) on delete set null, -- null = whole-order remark
  comment           text not null,
  feedback_tag      text
                       constraint smark_agent_feedback_tag_check
                       check (feedback_tag in ('wrong_package', 'prefer_distributor', 'already_stocked', 'price_wrong', 'other')),
  created_by        uuid references public.smark_app_users (id),
  converted_rule_id uuid, -- → smark_learned_rules(id); FK added in §12 below once that table exists
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

comment on table public.smark_agent_feedback is
  'Per-item ("wrong package", "we already stock this"...) and whole-order review feedback → raw material for suggested AI-Memory rules. converted_rule_id set once a suggestion is created from this feedback.';
comment on column public.smark_agent_feedback.converted_rule_id is
  'References smark_learned_rules.id — FK added below (§12) after that table is created, resolving the agent_feedback ↔ learned_rules circular reference within this same migration file.';

create index idx_smark_agent_feedback_run_id            on public.smark_agent_feedback (run_id);
create index idx_smark_agent_feedback_result_id          on public.smark_agent_feedback (result_id);
create index idx_smark_agent_feedback_created_by         on public.smark_agent_feedback (created_by);
create index idx_smark_agent_feedback_converted_rule_id  on public.smark_agent_feedback (converted_rule_id);

create trigger trg_smark_agent_feedback_updated_at
  before update on public.smark_agent_feedback
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 11. smark_learned_rules — the reviewable AI memory (suggested → active → retired)
--     Invariant: suggested rules NEVER auto-activate (TESTING.md §5) — status
--     flips only via an explicit owner approval (RLS §, owner-only writes).
-- ============================================================================
create table public.smark_learned_rules (
  id                 uuid primary key default gen_random_uuid(),
  scope              text not null
                        constraint smark_learned_rules_scope_check
                        check (scope in ('global', 'category', 'part', 'project', 'distributor')),
  subject            text,                          -- MPN / category / project id / distributor name; null for scope=global
  rule_type          text not null
                        constraint smark_learned_rules_rule_type_check
                        check (rule_type in ('prefer_distributor', 'avoid_distributor', 'already_stocked', 'package_correction', 'status_preference', 'price_source_note')),
  value              jsonb not null,
  confidence         numeric,
  source_feedback_id uuid references public.smark_agent_feedback (id) on delete set null,
  status             text not null default 'suggested'
                        constraint smark_learned_rules_status_check
                        check (status in ('suggested', 'active', 'retired')),
  superseded_by      uuid references public.smark_learned_rules (id) on delete set null,
  created_by         uuid references public.smark_app_users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz
);

comment on table public.smark_learned_rules is
  'Reviewable, versioned AI memory. suggested → active requires an explicit owner approval event (never automatic); active → retired likewise owner-only. Digest of active rules is pseudonymized before injection into the Opus prompt [R2-17].';

create index idx_smark_learned_rules_status              on public.smark_learned_rules (status);
create index idx_smark_learned_rules_scope_subject        on public.smark_learned_rules (scope, subject);
create index idx_smark_learned_rules_source_feedback_id   on public.smark_learned_rules (source_feedback_id);
create index idx_smark_learned_rules_superseded_by        on public.smark_learned_rules (superseded_by);
create index idx_smark_learned_rules_created_by           on public.smark_learned_rules (created_by);

create trigger trg_smark_learned_rules_updated_at
  before update on public.smark_learned_rules
  for each row execute function public.smark_set_updated_at();


-- ----------------------------------------------------------------------------
-- §12 — resolve the smark_agent_feedback ↔ smark_learned_rules circular
-- reference: add the deferred converted_rule_id FK now that both tables exist.
-- ----------------------------------------------------------------------------
alter table public.smark_agent_feedback
  add constraint smark_agent_feedback_converted_rule_id_fkey
  foreign key (converted_rule_id) references public.smark_learned_rules (id) on delete set null;


-- ============================================================================
-- 13. smark_learned_rules_doc — versioned digest injected into the Opus prompt
-- ============================================================================
create table public.smark_learned_rules_doc (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null,
  content        text not null,                     -- human-readable digest of active rules; aliased before injection [R2-17]
  change_summary text,
  created_by     uuid references public.smark_app_users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,

  constraint smark_learned_rules_doc_version_unique unique (version)
);

comment on table public.smark_learned_rules_doc is
  'Versioned digest (v1, v2...) of active smark_learned_rules, rendered v{N} in the UI. A new version is written on every approve/retire (SCHEMA.md "Derived values to keep in sync").';

create trigger trg_smark_learned_rules_doc_updated_at
  before update on public.smark_learned_rules_doc
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 14. smark_ai_aliases — server-side pseudonym map [R2-17]
--     "server-side only, never sent to clients" (SCHEMA.md §7) — RLS locked
--     to service-role only, see §RLS below. entity_id is polymorphic (no FK),
--     matching the smark_qr_labels.target_id pattern from 0002.
-- ============================================================================
create table public.smark_ai_aliases (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null
                constraint smark_ai_aliases_entity_type_check
                check (entity_type in ('client', 'project', 'product', 'custom')),
  entity_id   uuid not null,                        -- polymorphic → smark_projects.id / etc.; no FK by design
  alias       text not null,                         -- e.g. 'CLIENT-A', 'PROJ-03'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,

  constraint smark_ai_aliases_alias_unique  unique (alias),
  constraint smark_ai_aliases_entity_unique unique (entity_type, entity_id)
);

comment on table public.smark_ai_aliases is
  '[R2-17] Server-side pseudonym map (client/project/product → code), applied to every Claude call carrying business context; de-aliased server-side on the way back. Never sent to clients — service-role only (see RLS §). MPN/LCSC/package/distributor names pass through real (search correctness) and are NOT aliased here.';

create trigger trg_smark_ai_aliases_updated_at
  before update on public.smark_ai_aliases
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 15. smark_expense_accounts — cash/bank/UPI accounts [R2-28]
-- ============================================================================
create table public.smark_expense_accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                       -- 'HDFC current', 'Cash box', 'Owner UPI'
  account_type text not null
                 constraint smark_expense_accounts_type_check
                 check (account_type in ('cash', 'bank', 'upi')),
  active       boolean not null default true,
  created_by   uuid references public.smark_app_users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz,

  constraint smark_expense_accounts_name_unique unique (name)
);

comment on table public.smark_expense_accounts is
  '[R2-28] Owner-only CRUD (Settings card). smark_expenses.account_id references a row here.';

create index idx_smark_expense_accounts_active     on public.smark_expense_accounts (active) where active;
create index idx_smark_expense_accounts_created_by on public.smark_expense_accounts (created_by);

create trigger trg_smark_expense_accounts_updated_at
  before update on public.smark_expense_accounts
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- 16. smark_expenses — owner + accountant ledger [R2-20 · Q-09 FINAL]
--     Soft delete only (deleted_at) — "edit/delete (soft delete, audit)"
--     (tab-expenses.md); no hard-DELETE RLS policy at all (see §RLS below).
-- ============================================================================
create table public.smark_expenses (
  id              uuid primary key default gen_random_uuid(),
  entry_type      text not null
                     constraint smark_expenses_entry_type_check
                     check (entry_type in ('expense', 'income')),
  amount          numeric(14,2) not null check (amount > 0),
  currency        text not null default 'INR',
  entry_date      date not null,
  category        text not null
                     constraint smark_expenses_category_check
                     check (category in ('Materials', 'Salaries', 'Rent', 'Utilities', 'Tools', 'Client payment', 'Other')),
  account_id      uuid not null references public.smark_expense_accounts (id),
  vendor          text,                              -- party/distributor
  gstin           text,
  tax_amount      numeric(14,2) check (tax_amount is null or tax_amount >= 0),
  project_id      uuid references public.smark_projects (id) on delete set null, -- set = this IS a project payment [R2-15]
  note            text,
  attachment_url  text,                               -- R2 (bill/receipt)
  is_draft        boolean not null default false,     -- PO-auto-created entries start true until owner confirms
  source_order_id uuid references public.smark_orders (id) on delete set null, -- the PO that spawned it
  created_by      uuid references public.smark_app_users (id),
  deleted_at      timestamptz,                        -- soft delete for audit
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);

comment on table public.smark_expenses is
  '[R2-20 · Q-09 FINAL] Owner + accountant read/write ledger; employee has NO access (see RLS §). Placing a smark_orders row auto-creates a draft (is_draft=true) row here — application logic in the checkout server action (needs the order''s lines to compute the total; cannot be a simple single-table trigger), not a DB trigger.';
comment on column public.smark_expenses.account_id is
  'NOT NULL — the checkout server action that auto-creates draft rows must supply an account (e.g. a designated default), matching types/db.ts ExpenseRowSchema.';
comment on column public.smark_expenses.is_draft is
  'PO-auto-created entries start true; owner confirm flips to false (TESTING.md Q-09 traceability). Excluded from v_expense_rollups (0005) until confirmed.';

create index idx_smark_expenses_entry_date      on public.smark_expenses (entry_date);
create index idx_smark_expenses_entry_type      on public.smark_expenses (entry_type);
create index idx_smark_expenses_category        on public.smark_expenses (category);
create index idx_smark_expenses_account_id      on public.smark_expenses (account_id);
create index idx_smark_expenses_project_id      on public.smark_expenses (project_id);
create index idx_smark_expenses_source_order_id on public.smark_expenses (source_order_id);
create index idx_smark_expenses_created_by      on public.smark_expenses (created_by);
create index idx_smark_expenses_active          on public.smark_expenses (entry_date) where deleted_at is null;
create index idx_smark_expenses_draft_queue     on public.smark_expenses (created_at) where is_draft;

create trigger trg_smark_expenses_updated_at
  before update on public.smark_expenses
  for each row execute function public.smark_set_updated_at();


-- ============================================================================
-- RLS
-- ============================================================================

-- ---- smark_distributors: Settings-owned reference data — read by all three
-- operational roles (ordering workspace dseq, review, cart, orders all show
-- distributor names); write (CRUD) is Settings, owner-only. ------------------
alter table public.smark_distributors enable row level security;

create policy smark_distributors_select on public.smark_distributors
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_distributors_insert on public.smark_distributors
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_distributors_update on public.smark_distributors
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_distributors_delete on public.smark_distributors
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_distributor_preferences: same pattern as distributors ----------
alter table public.smark_distributor_preferences enable row level security;

create policy smark_distributor_preferences_select on public.smark_distributor_preferences
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_distributor_preferences_insert on public.smark_distributor_preferences
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_distributor_preferences_update on public.smark_distributor_preferences
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_distributor_preferences_delete on public.smark_distributor_preferences
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_ordering_rules: same pattern (read-only display in the
-- Ordering workspace for employee/accountant; edit is Settings, owner-only;
-- the package row is ADDITIONALLY guarded by the CHECK + trigger above,
-- independent of these RLS policies). ----------------------------------------
alter table public.smark_ordering_rules enable row level security;

create policy smark_ordering_rules_select on public.smark_ordering_rules
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_ordering_rules_insert on public.smark_ordering_rules
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_ordering_rules_update on public.smark_ordering_rules
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_ordering_rules_delete on public.smark_ordering_rules
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_agent_runs: "Projects (...runs...) | full | full | read-only" --
alter table public.smark_agent_runs enable row level security;

create policy smark_agent_runs_select on public.smark_agent_runs
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_agent_runs_insert on public.smark_agent_runs
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_agent_runs_update on public.smark_agent_runs
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_agent_runs_delete on public.smark_agent_runs
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_order_jobs: SERVICE ROLE ONLY -----------------------------------
-- Pure worker-internal plumbing; zero UI surface reads this table directly
-- (FEATURES.md §10's "done/total" progress derives from smark_agent_results /
-- smark_agent_runs). RLS enabled with an EMPTY policy set denies ALL access
-- to `authenticated`/`anon` by construction; only `service_role` (BYPASSRLS
-- in Supabase) — the always-on worker + Next.js server code — touches it.
alter table public.smark_order_jobs enable row level security;
-- (deliberately no policies for authenticated/anon — see comment above)

-- ---- smark_agent_results: SERVICE ROLE ONLY --------------------------------
-- Per the migration brief ("jobs/results service-role only"). Even though
-- results ARE "streamed to UI" (SCHEMA.md §4) and the review screen persists
-- selected/selected_by/selected_at (tab-order-review.md R2-08), that entire
-- read+write surface is designed to run through SERVER-SIDE code — a Route
-- Handler/SSE relay for streaming reads, a Server Action for the "Add to
-- cart" selection write — using the service-role client, never a direct
-- browser-side PostgREST/Realtime call. This also keeps the raw scraped
-- distributor payload (`raw` jsonb) server-controlled. If a future change
-- needs direct client reads, add a SELECT policy
-- ((select public.smark_role()) in ('owner','employee','accountant')) —
-- deliberately NOT added here so that stays a conscious, reviewed change.
alter table public.smark_agent_results enable row level security;
-- (deliberately no policies for authenticated/anon — see comment above)

-- ---- smark_cart_items: "Cart & checkout | full | full | read-only" --------
alter table public.smark_cart_items enable row level security;

create policy smark_cart_items_select on public.smark_cart_items
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_cart_items_insert on public.smark_cart_items
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_cart_items_update on public.smark_cart_items
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_cart_items_delete on public.smark_cart_items
  for delete to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'));

-- ---- smark_orders: same bucket; DELETE owner-only (financial record) ------
alter table public.smark_orders enable row level security;

create policy smark_orders_select on public.smark_orders
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_orders_insert on public.smark_orders
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_orders_update on public.smark_orders
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_orders_delete on public.smark_orders
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_order_lines: same bucket as orders ------------------------------
alter table public.smark_order_lines enable row level security;

create policy smark_order_lines_select on public.smark_order_lines
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_order_lines_insert on public.smark_order_lines
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_order_lines_update on public.smark_order_lines
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'employee'))
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_order_lines_delete on public.smark_order_lines
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_agent_feedback: review bucket; UPDATE/DELETE owner-only, like
-- smark_movements (INSERT is the normal-course action; nobody edits/removes
-- feedback in normal operation). ---------------------------------------------
alter table public.smark_agent_feedback enable row level security;

create policy smark_agent_feedback_select on public.smark_agent_feedback
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'employee', 'accountant'));

create policy smark_agent_feedback_insert on public.smark_agent_feedback
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'employee'));

create policy smark_agent_feedback_update on public.smark_agent_feedback
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_agent_feedback_delete on public.smark_agent_feedback
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_learned_rules: OWNER ONLY ---------------------------------------
-- FEATURES.md §2: "AI Memory approve · Settings · user management | full |
-- hidden | hidden" — employee/accountant get ZERO policies (no read, no
-- write). The ordering workspace's tiny "context v{N} · {count} rules" card
-- and lane "why" citations (CROSS-FEATURE A2-9) are computed server-side
-- (service role) and baked into smark_agent_runs.plan / smark_agent_results
-- — never a direct client read of this table. Suggested-rule creation from
-- review feedback (A2-8) is likewise a server-side (service-role) side
-- effect of the smark_agent_feedback insert, not a direct employee INSERT.
alter table public.smark_learned_rules enable row level security;

create policy smark_learned_rules_select on public.smark_learned_rules
  for select to authenticated
  using ((select public.smark_role()) = 'owner');

create policy smark_learned_rules_insert on public.smark_learned_rules
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_learned_rules_update on public.smark_learned_rules
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_learned_rules_delete on public.smark_learned_rules
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_learned_rules_doc: OWNER ONLY (same reasoning) ------------------
alter table public.smark_learned_rules_doc enable row level security;

create policy smark_learned_rules_doc_select on public.smark_learned_rules_doc
  for select to authenticated
  using ((select public.smark_role()) = 'owner');

create policy smark_learned_rules_doc_insert on public.smark_learned_rules_doc
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_learned_rules_doc_update on public.smark_learned_rules_doc
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_learned_rules_doc_delete on public.smark_learned_rules_doc
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_ai_aliases: SERVICE ROLE ONLY -----------------------------------
-- SCHEMA.md §7 is explicit: "server-side only, never sent to clients". No
-- policies for authenticated/anon — the alias service (server-side Claude-
-- call wrapper) is the only reader/writer.
alter table public.smark_ai_aliases enable row level security;
-- (deliberately no policies for authenticated/anon — see comment above)

-- ---- smark_expenses: owner + ACCOUNTANT write (the one special case in
-- this schema — FEATURES.md §2 "Expenses | full | hidden | read+write").
-- Employee gets ZERO policies. No hard-DELETE policy for ANY role — delete
-- is soft (UPDATE deleted_at), same privilege as any other write. ----------
alter table public.smark_expenses enable row level security;

create policy smark_expenses_select on public.smark_expenses
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'accountant'));

create policy smark_expenses_insert on public.smark_expenses
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner', 'accountant'));

create policy smark_expenses_update on public.smark_expenses
  for update to authenticated
  using ((select public.smark_role()) in ('owner', 'accountant'))
  with check ((select public.smark_role()) in ('owner', 'accountant'));

-- (no delete policy: soft delete via UPDATE deleted_at only)

-- ---- smark_expense_accounts: owner + accountant READ; owner-only CRUD -----
-- SCHEMA.md §7: "Owner-only CRUD (Settings card)"; RLS matrix §: "accountant:
-- ...+ expense accounts read". Employee gets ZERO policies (Expenses hidden).
alter table public.smark_expense_accounts enable row level security;

create policy smark_expense_accounts_select on public.smark_expense_accounts
  for select to authenticated
  using ((select public.smark_role()) in ('owner', 'accountant'));

create policy smark_expense_accounts_insert on public.smark_expense_accounts
  for insert to authenticated
  with check ((select public.smark_role()) = 'owner');

create policy smark_expense_accounts_update on public.smark_expense_accounts
  for update to authenticated
  using ((select public.smark_role()) = 'owner')
  with check ((select public.smark_role()) = 'owner');

create policy smark_expense_accounts_delete on public.smark_expense_accounts
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ============================================================================
-- End of 0004_ordering_finance.sql
-- ============================================================================
