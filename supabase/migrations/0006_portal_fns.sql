-- ============================================================================
-- 0006_portal_fns.sql — SmarkStock: client-portal SECURITY DEFINER functions
--
-- Owns:       portal_get_project(), portal_get_shared(), portal_add_comment()
-- Depends on: 0001_users_team (smark_app_users, smark_notifications)
--             0003_projects_boms (smark_projects, smark_project_phases,
--             smark_project_activities, smark_project_documents)
--
-- Canonical spec: plan/tab-client-portal.md, FEATURES.md §11/§17,
-- plan/SCHEMA.md "Client portal (R2-38): anonymous role via share_token —
-- SELECT only through dedicated security-definer functions... INSERT limited
-- to portal comments. Token never grants table-level access."
--
-- Trust model (THE reason this whole migration exists): the anon Postgres
-- role gets ZERO grants on any smark_ base table (0005's own comment: "anon
-- gets nothing... the future client portal reads only through SECURITY
-- DEFINER functions, which run as the function owner, not the caller"). Every
-- one of these three functions is `security definer` + `set search_path = ''`
-- (fully-qualified `public.` references throughout, matching the house style
-- in 0001/0002) so it runs with the MIGRATION ROLE's privileges regardless of
-- who calls it — RLS on the underlying tables is irrelevant to these
-- functions' own reads/writes, but the functions themselves are the ONLY
-- surface anon can reach, and they hand back a hand-picked subset of columns.
--
-- Both read functions return NULL for an unknown token, a REGENERATED token
-- (share_token no longer matches any row), and an ARCHIVED project's token —
-- deliberately the exact same NULL in all three cases, so a client watching
-- the response can never learn WHICH of those happened ("token invalid = 404,
-- no distinction leaked" — mission brief). `app/p/[token]/page.tsx` calls
-- `notFound()` on a null `portal_get_project` result.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- portal_get_project — header + phase timeline + progress inputs.
--   Returns a single jsonb object (not a rowset): project_id, name, status
--   (derived from completed_at — NOT the internal draft/sourcing/sourced BOM
--   pipeline status, which is never portal-facing), est_start_date,
--   est_delivery_date, timeline_note, completed_at, and `phases` (every
--   smark_project_phases row for the project, sort_order ascending). The app
--   layer (lib/portal/phase-math.ts) derives completion % and the on-track
--   chip from `phases` — same Q-07 semantics as the internal hub, duplicated
--   there with a comment since lib/projects' canonical version doesn't exist
--   yet (projects-hub package, built in parallel — see this package's
--   integrator report).
-- ----------------------------------------------------------------------------
create or replace function public.portal_get_project(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.smark_projects%rowtype;
  v_phases jsonb;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  select * into v_project
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', ph.id,
      'sort_order', ph.sort_order,
      'name', ph.name,
      'start_date', ph.start_date,
      'end_date', ph.end_date,
      'duration_text', ph.duration_text,
      'notes', ph.notes,
      'row_kind', ph.row_kind,
      'status', ph.status,
      'version_label', ph.version_label
    )
    order by ph.sort_order
  ), '[]'::jsonb)
  into v_phases
  from public.smark_project_phases ph
  where ph.project_id = v_project.id;

  return jsonb_build_object(
    'project_id', v_project.id,
    'name', v_project.name,
    'status', case when v_project.completed_at is not null then 'completed' else 'in_progress' end,
    'est_start_date', v_project.est_start_date,
    'est_delivery_date', v_project.est_delivery_date,
    'timeline_note', v_project.timeline_note,
    'completed_at', v_project.completed_at,
    'phases', v_phases
  );
end;
$$;

comment on function public.portal_get_project(text) is
  'Client portal [R2-38]: header + phase timeline for a share_token. NULL for unknown/regenerated tokens AND archived projects alike (no distinction leaked). Never returns prices, inventory, hours, or internal notes — only the whitelisted columns built here.';

revoke all on function public.portal_get_project(text) from public;
grant execute on function public.portal_get_project(text) to anon;

-- ----------------------------------------------------------------------------
-- portal_get_shared — explicitly-shared updates + documents only.
--   Opt-in per row (shared_to_portal default false, FEATURES §11: "nothing
--   leaks by accident"). Returns { activities: [...], documents: [...] };
--   NULL (same as portal_get_project) for an invalid/archived token.
-- ----------------------------------------------------------------------------
create or replace function public.portal_get_shared(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_activities jsonb;
  v_documents jsonb;
begin
  if p_token is null or p_token = '' then
    return null;
  end if;

  select p.id into v_project_id
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null;

  if v_project_id is null then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'type', a.type,
      'title', a.title,
      'body', a.body,
      'from_portal', a.from_portal,
      'created_at', a.created_at
    )
    order by a.created_at desc
  ), '[]'::jsonb)
  into v_activities
  from public.smark_project_activities a
  where a.project_id = v_project_id
    and a.shared_to_portal;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'display_name', d.display_name,
      'mime_type', d.mime_type,
      'size_bytes', d.size_bytes,
      'file_url', d.file_url,
      'created_at', d.created_at
    )
    order by d.created_at desc
  ), '[]'::jsonb)
  into v_documents
  from public.smark_project_documents d
  where d.project_id = v_project_id
    and d.shared_to_portal
    and d.deleted_at is null;

  return jsonb_build_object('activities', v_activities, 'documents', v_documents);
end;
$$;

comment on function public.portal_get_shared(text) is
  'Client portal [R2-38]: activities WHERE shared_to_portal + documents WHERE shared_to_portal AND not soft-deleted, name/type/size/url only. NULL for unknown/regenerated tokens and archived projects.';

revoke all on function public.portal_get_shared(text) from public;
grant execute on function public.portal_get_shared(text) to anon;

-- ----------------------------------------------------------------------------
-- portal_add_comment — rate-limited comment INSERT.
--   Lands as a smark_project_activities row: type='change', from_portal=true,
--   shared_to_portal=true (so the client's own comment reappears in their own
--   Updates feed — it is, after all, exactly what they just typed), created_by
--   NULL (no smark_app_users identity for an anonymous client). Rate limit:
--   <=5 comments per token per rolling hour (mission brief's own example),
--   counted against from_portal rows for this project — rejects with a plain
--   error the UI surfaces inline, same "no distinction leaked" NULL-shaped
--   behavior for a bad token but as a raised exception (INSERT has to fail
--   loudly, unlike the two read functions which can just return NULL).
-- ----------------------------------------------------------------------------
create or replace function public.portal_add_comment(p_token text, p_author_name text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_author text;
  v_body text;
  v_recent_count int;
  v_activity_id uuid;
begin
  v_author := btrim(coalesce(p_author_name, ''));
  v_body := btrim(coalesce(p_body, ''));

  if v_author = '' or v_body = '' then
    raise exception 'Name and message are required.';
  end if;
  if length(v_author) > 200 then
    raise exception 'Name is too long.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Message is too long (max 2000 characters).';
  end if;

  select p.id into v_project_id
  from public.smark_projects p
  where p.share_token = p_token
    and p.archived_at is null;

  if v_project_id is null then
    -- Same non-distinguishing failure as the read functions — a bad token
    -- never says WHY it's bad.
    raise exception 'This link is no longer available.';
  end if;

  select count(*) into v_recent_count
  from public.smark_project_activities a
  where a.project_id = v_project_id
    and a.from_portal
    and a.created_at > (now() - interval '1 hour');

  if v_recent_count >= 5 then
    raise exception 'Too many messages from this link in the last hour — please try again later.';
  end if;

  insert into public.smark_project_activities (
    project_id, type, title, body, shared_to_portal, from_portal, created_by
  ) values (
    v_project_id, 'change', ('Comment from ' || v_author), v_body, true, true, null
  )
  returning id into v_activity_id;

  -- Owner notification (FEATURES §5/§17 "owner gets a notification").
  -- TODO(integrator): swap to lib/notifications fanout once it lands
  -- (search-notifications package) — this direct insert is the agreed
  -- portal-package seam until then (mission brief "NOTIFICATIONS SEAM").
  insert into public.smark_notifications (user_id, kind, title, body, link)
  select u.id, 'portal_comment', 'New client portal comment',
         (v_author || ': ' || left(v_body, 140)),
         ('/projects/' || v_project_id::text)
  from public.smark_app_users u
  where u.role = 'owner'
    and u.active;

  return jsonb_build_object('ok', true, 'activity_id', v_activity_id);
end;
$$;

comment on function public.portal_add_comment(text, text, text) is
  'Client portal [R2-38]: rate-limited (<=5/token/hour) comment insert -> smark_project_activities (change, from_portal, shared_to_portal) + owner smark_notifications row. Raises a plain-text exception for a bad token or an exceeded rate limit — no distinction between the two leaked to the caller.';

revoke all on function public.portal_add_comment(text, text, text) from public;
grant execute on function public.portal_add_comment(text, text, text) to anon;
