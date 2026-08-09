create or replace function private.get_dashboard_project_data(
  before_project_updated_at timestamptz default null,
  before_project_id uuid default null,
  before_activity_created_at timestamptz default null,
  before_activity_id uuid default null,
  requested_project_limit integer default 8,
  requested_activity_limit integer default 5
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select profile.id, profile.organization_id, profile.role
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.organization_id is not null
  ),
  accessible_projects as materialized (
    select
      project.id,
      project.name,
      project.client_name,
      project.description,
      project.status,
      project.metadata,
      project.updated_at
    from public.projects as project
    join viewer on viewer.organization_id = project.organization_id
    where viewer.role in ('admin', 'manager')
      or exists (
        select 1
        from public.project_members as membership
        where membership.project_id = project.id
          and membership.profile_id = viewer.id
      )
  ),
  project_page as materialized (
    select project.*
    from accessible_projects as project
    where project.status = 'active'
      and (
        before_project_updated_at is null
        or before_project_id is null
        or (project.updated_at, project.id) <
          (before_project_updated_at, before_project_id)
      )
    order by project.updated_at desc, project.id desc
    limit greatest(1, least(requested_project_limit, 24))
  ),
  project_rows as materialized (
    select
      project.*,
      coalesce(member_stats.member_ids, '{}'::uuid[]) as member_ids,
      case
        when coalesce(todo_stats.total_count, 0) = 0 then 0
        else round(
          100.0 * coalesce(todo_stats.done_count, 0) /
          todo_stats.total_count
        )::integer
      end as progress
    from project_page as project
    left join lateral (
      select array_agg(member.profile_id order by member.profile_id) as member_ids
      from public.project_members as member
      where member.project_id = project.id
    ) as member_stats on true
    left join lateral (
      select
        count(*) as total_count,
        count(*) filter (where todo.status = 'done') as done_count
      from public.todos as todo
      where todo.project_id = project.id
        and todo.status <> 'cancelled'
    ) as todo_stats on true
  ),
  activity_page as materialized (
    select
      event.id,
      event.project_id,
      event.actor_id,
      event.action,
      event.summary,
      event.created_at,
      actor.full_name as actor_name,
      actor.email as actor_email,
      project.name as project_name
    from public.activity_events as event
    join viewer on viewer.organization_id = event.organization_id
    left join public.profiles as actor on actor.id = event.actor_id
    left join accessible_projects as project on project.id = event.project_id
    where (event.project_id is null or project.id is not null)
      and (
        before_activity_created_at is null
        or before_activity_id is null
        or (event.created_at, event.id) <
          (before_activity_created_at, before_activity_id)
      )
    order by event.created_at desc, event.id desc
    limit greatest(1, least(requested_activity_limit, 50))
  ),
  metrics as (
    select
      (select count(*) from accessible_projects) as project_total,
      (select count(*) from accessible_projects where status = 'active')
        as active_project_count,
      (select count(*)
        from public.todos as todo
        join accessible_projects as project on project.id = todo.project_id
        where todo.status not in ('done', 'cancelled')) as open_todo_count,
      (select count(*)
        from public.todos as todo
        join accessible_projects as project on project.id = todo.project_id
        where todo.status not in ('done', 'cancelled')
          and todo.due_at < now()) as overdue_todo_count,
      (select count(*)
        from public.todos as todo
        join accessible_projects as project on project.id = todo.project_id
        where todo.status = 'blocked') as blocked_todo_count
  )
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id,
        'name', project.name,
        'client_name', project.client_name,
        'description', project.description,
        'status', project.status,
        'metadata', project.metadata,
        'updated_at', project.updated_at,
        'member_ids', project.member_ids,
        'progress', project.progress
      ) order by project.updated_at desc, project.id desc)
      from project_rows as project
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', activity.id,
        'project_id', activity.project_id,
        'actor_id', activity.actor_id,
        'action', activity.action,
        'summary', activity.summary,
        'created_at', activity.created_at,
        'actor_name', activity.actor_name,
        'actor_email', activity.actor_email,
        'project_name', activity.project_name
      ) order by activity.created_at desc, activity.id desc)
      from activity_page as activity
    ), '[]'::jsonb),
    'metrics', (select to_jsonb(metrics.*) from metrics),
    'next_project_cursor', (
      select jsonb_build_object(
        'updated_at', project.updated_at,
        'id', project.id
      )
      from project_page as project
      order by project.updated_at, project.id
      limit 1
    ),
    'next_activity_cursor', (
      select jsonb_build_object(
        'created_at', activity.created_at,
        'id', activity.id
      )
      from activity_page as activity
      order by activity.created_at, activity.id
      limit 1
    )
  );
$$;

revoke all on function private.get_dashboard_project_data(
  timestamptz, uuid, timestamptz, uuid, integer, integer
) from public, anon;
grant execute on function private.get_dashboard_project_data(
  timestamptz, uuid, timestamptz, uuid, integer, integer
) to authenticated, service_role;

create or replace function public.get_dashboard_project_data(
  before_project_updated_at timestamptz default null,
  before_project_id uuid default null,
  before_activity_created_at timestamptz default null,
  before_activity_id uuid default null,
  requested_project_limit integer default 8,
  requested_activity_limit integer default 5
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_dashboard_project_data(
    before_project_updated_at,
    before_project_id,
    before_activity_created_at,
    before_activity_id,
    requested_project_limit,
    requested_activity_limit
  );
$$;

revoke all on function public.get_dashboard_project_data(
  timestamptz, uuid, timestamptz, uuid, integer, integer
) from public, anon;
grant execute on function public.get_dashboard_project_data(
  timestamptz, uuid, timestamptz, uuid, integer, integer
) to authenticated, service_role;

create or replace function private.get_projects_project_data(
  before_updated_at timestamptz default null,
  before_project_id uuid default null,
  requested_limit integer default 24
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select profile.id, profile.organization_id, profile.role
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.organization_id is not null
  ),
  accessible_projects as materialized (
    select
      project.id,
      project.name,
      project.client_name,
      project.description,
      project.status,
      project.metadata,
      project.updated_at
    from public.projects as project
    join viewer on viewer.organization_id = project.organization_id
    where viewer.role in ('admin', 'manager')
      or exists (
        select 1
        from public.project_members as membership
        where membership.project_id = project.id
          and membership.profile_id = viewer.id
      )
  ),
  project_page as materialized (
    select project.*
    from accessible_projects as project
    where before_updated_at is null
      or before_project_id is null
      or (project.updated_at, project.id) <
        (before_updated_at, before_project_id)
    order by project.updated_at desc, project.id desc
    limit greatest(1, least(requested_limit, 100))
  ),
  project_rows as materialized (
    select
      project.*,
      coalesce(member_stats.member_ids, '{}'::uuid[]) as member_ids,
      case
        when coalesce(todo_stats.total_count, 0) = 0 then 0
        else round(
          100.0 * coalesce(todo_stats.done_count, 0) /
          todo_stats.total_count
        )::integer
      end as progress
    from project_page as project
    left join lateral (
      select array_agg(member.profile_id order by member.profile_id) as member_ids
      from public.project_members as member
      where member.project_id = project.id
    ) as member_stats on true
    left join lateral (
      select
        count(*) as total_count,
        count(*) filter (where todo.status = 'done') as done_count
      from public.todos as todo
      where todo.project_id = project.id
        and todo.status <> 'cancelled'
    ) as todo_stats on true
  )
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id,
        'name', project.name,
        'client_name', project.client_name,
        'description', project.description,
        'status', project.status,
        'metadata', project.metadata,
        'updated_at', project.updated_at,
        'member_ids', project.member_ids,
        'progress', project.progress
      ) order by project.updated_at desc, project.id desc)
      from project_rows as project
    ), '[]'::jsonb),
    'total_count', (select count(*) from accessible_projects),
    'next_cursor', (
      select jsonb_build_object(
        'updated_at', project.updated_at,
        'id', project.id
      )
      from project_page as project
      order by project.updated_at, project.id
      limit 1
    )
  );
$$;

revoke all on function private.get_projects_project_data(
  timestamptz, uuid, integer
) from public, anon;
grant execute on function private.get_projects_project_data(
  timestamptz, uuid, integer
) to authenticated, service_role;

create or replace function public.get_projects_project_data(
  before_updated_at timestamptz default null,
  before_project_id uuid default null,
  requested_limit integer default 24
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_projects_project_data(
    before_updated_at,
    before_project_id,
    requested_limit
  );
$$;

revoke all on function public.get_projects_project_data(
  timestamptz, uuid, integer
) from public, anon;
grant execute on function public.get_projects_project_data(
  timestamptz, uuid, integer
) to authenticated, service_role;
