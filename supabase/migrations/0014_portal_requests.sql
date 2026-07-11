-- ============================================================================
-- 0014_portal_requests.sql — client portal "Your requests" read
--
-- Adds portal_get_requests(p_token): the merged list of the CLIENT's own
-- raised items for a project — change requests (requested_source='client') and
-- bug/issue reports (reported_source='client') — with their current status, so
-- the portal can show the client what happened to what they raised instead of
-- them submitting into a void.
--
-- Anon-safe by the same contract as the other portal RPCs (0010_pm.sql):
-- SECURITY DEFINER, token-scoped via share_token, NULL for unknown/regenerated/
-- archived-project tokens (no distinction leaked), execute granted to `anon`
-- only. Purely additive + reversible (drop function to roll back).
-- ============================================================================

create or replace function public.portal_get_requests(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.smark_projects%rowtype;
  v_requests jsonb;
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

  select coalesce(jsonb_agg(x order by x_created_at desc), '[]'::jsonb)
  into v_requests
  from (
    select
      jsonb_build_object(
        'id', cr.id,
        'kind', 'change',
        'description', cr.description,
        'status', cr.status,        -- pending | accepted | rejected
        'task_title', null,
        'created_at', cr.created_at
      ) as x,
      cr.created_at as x_created_at
    from public.smark_change_requests cr
    where cr.project_id = v_project.id
      and cr.requested_source = 'client'

    union all

    select
      jsonb_build_object(
        'id', b.id,
        'kind', 'issue',
        'description', b.description,
        'status', b.status,         -- open | confirmed | dismissed | resolved
        'task_title', t.title,
        'created_at', b.created_at
      ) as x,
      b.created_at as x_created_at
    from public.smark_bugs b
    join public.smark_tasks t on t.id = b.task_id
    where t.project_id = v_project.id
      and b.reported_source = 'client'
  ) sub;

  return jsonb_build_object('requests', v_requests);
end;
$$;

comment on function public.portal_get_requests(text) is
  'Client portal "Your requests": the merged, newest-first list of the client''s own change requests (requested_source=client) and bug reports (reported_source=client) for the token''s project, each with current status. NULL for unknown/regenerated/archived-project tokens (same non-distinguishing contract as portal_get_pm).';

revoke all on function public.portal_get_requests(text) from public;
grant execute on function public.portal_get_requests(text) to anon;
