-- Keep the team page to one bounded read and return only fields rendered by
-- the workload UI. This replaces the follow-up `todos select *` request.
create index if not exists todos_team_project_due_idx
  on public.todos (project_id, operational_state, status, due_at, id);

create or replace function private.get_team_project_data(
  after_due_at timestamptz default null,
  after_todo_id uuid default null,
  requested_limit integer default 500
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select
      profile.id,
      profile.organization_id,
      profile.role
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and profile.organization_id is not null
  ),
  profile_page as materialized (
    select
      profile.id,
      profile.full_name,
      profile.title,
      profile.status,
      profile.weekly_capacity_minutes
    from public.profiles as profile
    join viewer on viewer.organization_id = profile.organization_id
    where profile.status = 'active'
      and coalesce((profile.preferences ->> 'is_internal')::boolean, true)
    order by profile.full_name, profile.id
    limit 200
  ),
  accessible_projects as materialized (
    select
      project.id,
      project.name,
      project.client_name,
      project.status,
      project.code
    from public.projects as project
    join viewer on viewer.organization_id = project.organization_id
    where project.status not in ('completed', 'cancelled')
      and not project.is_read_only
      and (
        viewer.role in ('admin', 'manager')
        or exists (
          select 1
          from public.project_members as membership
          where membership.project_id = project.id
            and membership.profile_id = viewer.id
        )
      )
  ),
  project_page as materialized (
    select project.*
    from accessible_projects as project
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
    join project_page as project on project.id = milestone.project_id
    where milestone.status not in ('completed', 'cancelled')
      and milestone.due_date is not null
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
      todo.due_on,
      todo.status,
      todo.operational_state,
      todo.issue_number,
      todo.estimated_minutes,
      todo.updated_at,
      project.code as project_code
    from public.todos as todo
    join project_page as project on project.id = todo.project_id
    where todo.status not in ('done', 'cancelled')
      and todo.operational_state in ('active', 'triage')
      and (
        after_due_at is null
        or after_todo_id is null
        or (coalesce(todo.due_at, 'infinity'::timestamptz), todo.id) >
          (after_due_at, after_todo_id)
      )
    order by todo.due_at asc nulls last, todo.id
    limit greatest(1, least(requested_limit, 500))
  ),
  assignees as materialized (
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
        'title', profile.title,
        'status', profile.status,
        'preferences', jsonb_build_object('is_internal', true),
        'weekly_capacity_minutes', profile.weekly_capacity_minutes
      ) order by profile.full_name, profile.id)
      from profile_page as profile
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id,
        'name', project.name,
        'client_name', project.client_name,
        'status', project.status,
        'code', project.code
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
        'due_on', todo.due_on,
        'due_at', todo.due_at,
        'status', todo.status,
        'operational_state', todo.operational_state,
        'issue_number', todo.issue_number,
        'issue_key', todo.project_code || '-' || todo.issue_number::text,
        'estimated_minutes', todo.estimated_minutes,
        'updated_at', todo.updated_at
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

revoke all on function private.get_team_project_data(
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function private.get_team_project_data(
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;

create or replace function public.get_team_project_data(
  after_due_at timestamptz default null,
  after_todo_id uuid default null,
  requested_limit integer default 500
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_team_project_data(
    after_due_at,
    after_todo_id,
    requested_limit
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
