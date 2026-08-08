create or replace function public.get_team_project_data(
  after_due_at timestamptz default null,
  after_todo_id uuid default null,
  requested_limit integer default 300
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with organization as (
    select private.current_project_organization_id() as id
  ),
  profile_page as materialized (
    select
      profile.id,
      profile.full_name,
      profile.email,
      profile.title,
      profile.role,
      profile.status,
      profile.preferences
    from public.profiles as profile
    where profile.organization_id = (select id from organization)
      and profile.status = 'active'
      and coalesce((profile.preferences ->> 'is_internal')::boolean, true)
    order by profile.full_name, profile.id
    limit 200
  ),
  project_page as materialized (
    select
      project.id,
      project.name,
      project.client_name,
      project.description,
      project.status,
      project.metadata,
      project.updated_at
    from public.projects as project
    where project.organization_id = (select id from organization)
      and project.status not in ('completed', 'cancelled')
    order by project.name, project.id
    limit 100
  ),
  milestone_page as materialized (
    select
      milestone.id,
      milestone.project_id,
      milestone.name,
      milestone.due_date
    from public.milestones as milestone
    join public.projects as project on project.id = milestone.project_id
    where project.organization_id = (select id from organization)
      and milestone.status not in ('completed', 'cancelled')
    order by milestone.due_date asc nulls last, milestone.id
    limit 100
  ),
  todo_page as materialized (
    select
      todo.id,
      todo.project_id,
      todo.todo_list_id,
      todo.title,
      todo.assigned_to,
      todo.due_at,
      todo.status,
      todo.priority,
      todo.updated_at,
      todo.version
    from public.todos as todo
    join public.projects as project on project.id = todo.project_id
    where project.organization_id = (select id from organization)
      and todo.status not in ('done', 'cancelled')
      and (
        after_due_at is null
        or after_todo_id is null
        or (coalesce(todo.due_at, 'infinity'::timestamptz), todo.id) >
          (after_due_at, after_todo_id)
      )
    order by todo.due_at asc nulls last, todo.id
    limit greatest(1, least(requested_limit, 500))
  ),
  assignees as (
    select
      assignment.todo_id,
      array_agg(assignment.profile_id order by assignment.profile_id) as profile_ids
    from public.todo_assignees as assignment
    join todo_page as todo on todo.id = assignment.todo_id
    group by assignment.todo_id
  )
  select jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id,
        'full_name', profile.full_name,
        'email', profile.email,
        'title', profile.title,
        'role', profile.role,
        'status', profile.status,
        'preferences', profile.preferences
      ) order by profile.full_name, profile.id)
      from profile_page as profile
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id,
        'name', project.name,
        'client_name', project.client_name,
        'description', project.description,
        'status', project.status,
        'metadata', project.metadata,
        'updated_at', project.updated_at,
        'member_ids', coalesce((
          select array_agg(member.profile_id order by member.profile_id)
          from public.project_members as member
          where member.project_id = project.id
        ), '{}'::uuid[])
      ) order by project.name, project.id)
      from project_page as project
    ), '[]'::jsonb),
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', todo.id,
        'project_id', todo.project_id,
        'todo_list_id', todo.todo_list_id,
        'title', todo.title,
        'assigned_to', todo.assigned_to,
        'assignee_ids', coalesce(assignees.profile_ids, '{}'::uuid[]),
        'due_at', todo.due_at,
        'status', todo.status,
        'priority', todo.priority,
        'updated_at', todo.updated_at,
        'version', todo.version
      ) order by todo.due_at asc nulls last, todo.id)
      from todo_page as todo
      left join assignees on assignees.todo_id = todo.id
    ), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', milestone.id,
        'project_id', milestone.project_id,
        'name', milestone.name,
        'due_date', milestone.due_date
      ) order by milestone.due_date asc nulls last, milestone.id)
      from milestone_page as milestone
    ), '[]'::jsonb),
    'next_cursor', (
      select jsonb_build_object(
        'due_at', coalesce(todo.due_at, 'infinity'::timestamptz),
        'id', todo.id
      )
      from todo_page as todo
      order by todo.due_at desc nulls first, todo.id desc
      limit 1
    )
  );
$$;

revoke all on function public.get_team_project_data(
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_team_project_data(
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;
