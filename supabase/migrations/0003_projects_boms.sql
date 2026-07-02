-- ============================================================================
-- 0003_projects_boms.sql — SmarkStock: projects, phases, documents, activities,
--                          BOMs, BOM lines, BOM templates
--
-- Owns:       smark_projects, smark_project_phases, smark_project_documents,
--             smark_project_activities, smark_boms, smark_bom_lines,
--             smark_bom_templates
-- Depends on: 0001_users_team (smark_app_users, smark_role(),
--             smark_set_updated_at() — shared trigger fn, reused here)
--             0002_catalog_location (smark_parts)
-- Deferred (plain uuid, FK added in 0005 once the table exists):
--   smark_boms.saved_run_id → smark_agent_runs (0004)
--
-- Canonical spec: plan/SCHEMA.md §1 (projects/phases), §3 (BOMs), §7 (docs/
-- activities). RLS per FEATURES.md §2 matrix — Projects area:
--   owner = full · employee = full · accountant = read-only.
-- ============================================================================

-- ============================================================================
-- smark_projects — client jobs [R2-05 / R2-14 / R2-30 / R2-32]
--   · status (draft/sourcing/sourced) is DERIVED from BOM sourcing_status +
--     active runs — no stored column (SCHEMA.md R2-03).
--   · completion % is DERIVED duration-weighted from phases (Q-07) — no column.
-- ============================================================================
create table public.smark_projects (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  code              text,
  client            text,
  notes             text,
  est_start_date    date,
  est_delivery_date date,
  timeline_note     text,
  share_token       text unique,   -- client-portal capability token; regenerate = revoke [R2-30/38]
  archived_at       timestamptz,   -- archive: releases cart demand, freezes activity, hides from pickers, suspends portal [R2-32]
  completed_at      date,          -- stamped when last phase done + owner confirm [Q-07]
  created_by        uuid references public.smark_app_users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

comment on table public.smark_projects is
  'Client jobs. Card status is derived (BOM sourcing_status + runs); completion % derived from phases (Q-07).';
comment on column public.smark_projects.share_token is
  'Capability token for the public client portal (/p/:share_token). Regenerate = revoke. Null = never shared.';
comment on column public.smark_projects.archived_at is
  'Non-null = archived: demand released from v_part_demand, activity frozen, hidden from pickers, portal suspended.';

create index idx_smark_projects_created_by on public.smark_projects (created_by);
create index idx_smark_projects_archived_at on public.smark_projects (archived_at);

create trigger trg_smark_projects_updated_at
  before update on public.smark_projects
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- smark_project_phases — estimate-sheet timeline [R2-30, Q-07 final]
--   Ordered rows; row kinds phase|parallel|buffer|footnote; at most ONE active
--   phase per project enforced by a partial unique index (app guarantees the
--   "exactly one" half when advancing).
-- ============================================================================
create table public.smark_project_phases (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.smark_projects(id) on delete cascade,
  sort_order    integer not null default 0,
  name          text not null,
  start_date    date,               -- nullable: parallel/footnote rows carry no dates
  end_date      date,
  duration_text text,               -- free text from their sheets: "9-10 days", "Running parallel with design"
  notes         text,               -- tasks/notes column ("3 PCBs", vendor lead time…)
  row_kind      text not null default 'phase'
                  check (row_kind in ('phase','parallel','buffer','footnote')),
  status        text not null default 'pending'
                  check (status in ('pending','active','done')),
  version_label integer not null default 1,  -- bumped on date edits; edits also log `change` activities
  created_by    uuid references public.smark_app_users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);

comment on table public.smark_project_phases is
  'Per-project phase timeline (Smark estimate-sheet model). Drives completion % (duration-weighted done phases) and the on-track chip; rendered in hub + client portal.';
comment on column public.smark_project_phases.version_label is
  'Small v counter; bump on date edits (edit also logged as a change activity).';

-- at most one ACTIVE phase per project
create unique index smark_project_phases_one_active_per_project
  on public.smark_project_phases (project_id)
  where (status = 'active');

create index idx_smark_project_phases_project_sort
  on public.smark_project_phases (project_id, sort_order);
create index idx_smark_project_phases_created_by
  on public.smark_project_phases (created_by);

create trigger trg_smark_project_phases_updated_at
  before update on public.smark_project_phases
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- smark_project_documents — named uploads to R2 [R2-16]
--   Soft delete (owner or uploader — app rule); portal sees ONLY rows explicitly
--   flagged shared_to_portal (§11: opt-in per item, default OFF).
-- ============================================================================
create table public.smark_project_documents (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.smark_projects(id) on delete cascade,
  display_name     text not null,
  file_url         text not null,   -- Cloudflare R2 object (files never live in Supabase storage)
  mime_type        text,
  size_bytes       bigint,
  note             text,
  shared_to_portal boolean not null default false,
  uploaded_by      uuid references public.smark_app_users(id),
  deleted_at       timestamptz,     -- soft delete; row kept for audit [R2-16]
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

comment on table public.smark_project_documents is
  '[R2-16] Named per-project uploads (files in Cloudflare R2). Soft delete (deleted_at); portal sees only shared_to_portal rows via security-definer fns (0005).';
comment on column public.smark_project_documents.shared_to_portal is
  'Portal shows only explicitly-shared documents (FEATURES §11; default OFF — nothing leaks by accident).';

create index idx_smark_project_documents_project_id
  on public.smark_project_documents (project_id);
create index idx_smark_project_documents_uploaded_by
  on public.smark_project_documents (uploaded_by);
-- portal read path: shared, not soft-deleted docs of one project
create index idx_smark_project_documents_portal
  on public.smark_project_documents (project_id)
  where (shared_to_portal and deleted_at is null);

create trigger trg_smark_project_documents_updated_at
  before update on public.smark_project_documents
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- smark_project_activities — notes / meetings / changes / tasks feed [R2-06]
--   Append-only; the 15-min author edit window is enforced in-app, not here.
--   Portal comments land as type='change' rows with from_portal = true and
--   created_by NULL (inserted via the portal security-definer function, §11).
-- ============================================================================
create table public.smark_project_activities (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.smark_projects(id) on delete cascade,
  type             text not null check (type in ('note','meeting','change','task')),
  title            text,
  body             text,
  task_assignee    uuid references public.smark_app_users(id),  -- task rows only; restricted to project members in-app
  task_due         date,
  task_done        boolean,
  task_done_at     timestamptz,
  shared_to_portal boolean not null default false,  -- opt-in per entry (§11, default OFF)
  from_portal      boolean not null default false,  -- "from client portal" tag on portal comments (§11)
  created_by       uuid references public.smark_app_users(id),  -- null only for portal comments
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

comment on table public.smark_project_activities is
  'Project feed: note | meeting | change | task. Append-only (author edit window app-enforced). Tasks carry assignee/due/done.';

create index idx_smark_project_activities_project_created
  on public.smark_project_activities (project_id, created_at desc);
create index idx_smark_project_activities_assignee
  on public.smark_project_activities (task_assignee);
create index idx_smark_project_activities_created_by
  on public.smark_project_activities (created_by);
-- open-task badges: count of not-done tasks per project
create index idx_smark_project_activities_open_tasks
  on public.smark_project_activities (project_id)
  where (type = 'task' and task_done is not true);
-- portal read path: explicitly-shared entries of one project
create index idx_smark_project_activities_portal
  on public.smark_project_activities (project_id)
  where (shared_to_portal);

create trigger trg_smark_project_activities_updated_at
  before update on public.smark_project_activities
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- smark_boms — many NAMED BOMs per project [R2-03 / R2-19 / R2-27]
--   name required + UNIQUE(project_id, name). Each BOM keeps its own pipeline
--   state (distributor sequence, priorities, sourcing status, saved run).
--   Changing build_qty after a run marks the saved run stale (app-level flag).
-- ============================================================================
create table public.smark_boms (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.smark_projects(id) on delete cascade,
  name                 text not null,          -- user label, e.g. "Mainboard v1.2"
  source_file_url      text,                   -- R2 upload; null when created in-app
  created_in_app       boolean not null default false,  -- grid editor vs uploaded file [R2-19]
  line_count           integer not null default 0,
  build_qty            integer not null default 1 check (build_qty >= 1),  -- every need = line qty × build_qty [R2-27]
  distributor_sequence jsonb,                  -- per-BOM ordered site list (drag-reorder + toggles)
  priority_notes       text,                   -- plain-English priorities (sheet-prefilled)
  sourcing_status      text not null default 'draft'
                         check (sourcing_status in ('draft','sourced','ordered')),
  saved_run_id         uuid,                   -- → smark_agent_runs (0004). Plain uuid ON PURPOSE: FK deferred, runs table does not exist yet.
  uploaded_by          uuid references public.smark_app_users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz,
  constraint smark_boms_project_name_unique unique (project_id, name)
);

comment on table public.smark_boms is
  'Named BOMs, many per project (UNIQUE(project_id, name)). Per-BOM pipeline state: sequence, priorities, build_qty ×N, sourcing status, saved run.';
comment on column public.smark_boms.saved_run_id is
  'References smark_agent_runs.id (created in 0004_ordering_finance) — deliberately no FK constraint here to keep the 0001→0005 apply order acyclic; FK added in 0005.';

create index idx_smark_boms_uploaded_by  on public.smark_boms (uploaded_by);
create index idx_smark_boms_saved_run_id on public.smark_boms (saved_run_id);

create trigger trg_smark_boms_updated_at
  before update on public.smark_boms
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- smark_bom_lines — parsed/created lines [+extra jsonb R2-19]
--   "references" is the raw designator string (reserved word — quoted on
--   purpose to match plan/SCHEMA.md §3 naming; PostgREST quotes identifiers).
-- ============================================================================
create table public.smark_bom_lines (
  id               uuid primary key default gen_random_uuid(),
  bom_id           uuid not null references public.smark_boms(id) on delete cascade,
  line_no          integer,
  "references"     text,            -- raw "C3,C69,…"
  qty              integer check (qty is null or qty >= 0),
  value            text,
  footprint        text,            -- raw package/footprint string from the sheet
  dnp              boolean not null default false,
  description      text,
  mpn              text,
  manufacturer     text,
  part_link        text,
  lcsc_pn          text,
  priority_note    text,
  extra            jsonb,           -- custom template-column values [R2-19]; display-only for agents
  matched_part_id  uuid references public.smark_parts(id) on delete set null,
  match_state      text not null default 'unresolved'
                     check (match_state in ('in_stock','to_order','unresolved')),
  match_confidence numeric,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz
);

comment on column public.smark_bom_lines."references" is
  'Raw reference designators from the sheet ("C3,C69,C107"). Reserved SQL word, intentionally quoted per SCHEMA.md.';
comment on column public.smark_bom_lines.match_state is
  'Reconcile outcome vs stock at line qty × bom.build_qty: in_stock | to_order | unresolved.';

create index idx_smark_bom_lines_bom_line on public.smark_bom_lines (bom_id, line_no);
create index idx_smark_bom_lines_matched_part
  on public.smark_bom_lines (matched_part_id)
  where (matched_part_id is not null);            -- v_part_demand / contested-stock lookups
create index idx_smark_bom_lines_match_state
  on public.smark_bom_lines (bom_id, match_state); -- in-stock / to-order split per BOM

create trigger trg_smark_bom_lines_updated_at
  before update on public.smark_bom_lines
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- smark_bom_templates — remembered Create-BOM column structure [R2-19]
--   One active company template (v1): Create-BOM prefills from it, re-saves on
--   change; the downloadable xlsx template renders the same columns. Custom
--   column VALUES live in smark_bom_lines.extra.
-- ============================================================================
create table public.smark_bom_templates (
  id           uuid primary key default gen_random_uuid(),
  columns      jsonb not null,     -- [{key, label, type, required, is_custom}] — order preserved
  created_by   uuid references public.smark_app_users(id),
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

comment on table public.smark_bom_templates is
  'Remembered Create-BOM column structure (standard + user-added columns, order preserved). One active company template in v1.';

create index idx_smark_bom_templates_created_by
  on public.smark_bom_templates (created_by);

create trigger trg_smark_bom_templates_updated_at
  before update on public.smark_bom_templates
  for each row execute function public.smark_set_updated_at();

-- ============================================================================
-- RLS — FEATURES.md §2 matrix (Projects area): owner full · employee full ·
-- accountant read-only. smark_role() is defined in migration 0001.
--   · Deviations (documented): hard DELETE of smark_projects is owner-only
--     (archive is the designed path; deletion cascades across domains) and
--     DELETE of smark_project_activities is owner-only (append-only feed).
--   · Client portal NEVER touches these tables directly — reads/comments go
--     through security-definer functions (defined with the views in 0005).
--   · Worker/service-role traffic bypasses RLS by design.
-- ============================================================================

-- ---- smark_projects --------------------------------------------------------
alter table public.smark_projects enable row level security;

create policy smark_projects_select on public.smark_projects
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_projects_insert on public.smark_projects
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_projects_update on public.smark_projects
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_projects_delete on public.smark_projects
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_project_phases ---------------------------------------------------
alter table public.smark_project_phases enable row level security;

create policy smark_project_phases_select on public.smark_project_phases
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_project_phases_insert on public.smark_project_phases
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_project_phases_update on public.smark_project_phases
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_project_phases_delete on public.smark_project_phases
  for delete to authenticated
  using ((select public.smark_role()) in ('owner','employee'));

-- ---- smark_project_documents -----------------------------------------------
alter table public.smark_project_documents enable row level security;

create policy smark_project_documents_select on public.smark_project_documents
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_project_documents_insert on public.smark_project_documents
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_project_documents_update on public.smark_project_documents
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_project_documents_delete on public.smark_project_documents
  for delete to authenticated
  using ((select public.smark_role()) in ('owner','employee'));

-- ---- smark_project_activities (append-only: no employee hard-delete) --------
alter table public.smark_project_activities enable row level security;

create policy smark_project_activities_select on public.smark_project_activities
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_project_activities_insert on public.smark_project_activities
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_project_activities_update on public.smark_project_activities
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_project_activities_delete on public.smark_project_activities
  for delete to authenticated
  using ((select public.smark_role()) = 'owner');

-- ---- smark_boms --------------------------------------------------------------
alter table public.smark_boms enable row level security;

create policy smark_boms_select on public.smark_boms
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_boms_insert on public.smark_boms
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_boms_update on public.smark_boms
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_boms_delete on public.smark_boms
  for delete to authenticated
  using ((select public.smark_role()) in ('owner','employee'));

-- ---- smark_bom_lines ---------------------------------------------------------
alter table public.smark_bom_lines enable row level security;

create policy smark_bom_lines_select on public.smark_bom_lines
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_bom_lines_insert on public.smark_bom_lines
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_bom_lines_update on public.smark_bom_lines
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_bom_lines_delete on public.smark_bom_lines
  for delete to authenticated
  using ((select public.smark_role()) in ('owner','employee'));

-- ---- smark_bom_templates -----------------------------------------------------
alter table public.smark_bom_templates enable row level security;

create policy smark_bom_templates_select on public.smark_bom_templates
  for select to authenticated
  using ((select public.smark_role()) in ('owner','employee','accountant'));

create policy smark_bom_templates_insert on public.smark_bom_templates
  for insert to authenticated
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_bom_templates_update on public.smark_bom_templates
  for update to authenticated
  using ((select public.smark_role()) in ('owner','employee'))
  with check ((select public.smark_role()) in ('owner','employee'));

create policy smark_bom_templates_delete on public.smark_bom_templates
  for delete to authenticated
  using ((select public.smark_role()) in ('owner','employee'));

-- ============================================================================
-- End of 0003_projects_boms.sql
-- ============================================================================
