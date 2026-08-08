-- Bounded project data access and canonical, transactional project writes.
-- Public RPCs are security-invoker entry points. Privileged mutation logic
-- lives in the private schema and validates organization/project boundaries.

alter table public.todos
  add column if not exists version bigint not null default 1
    check (version > 0);

alter table public.todo_subtasks
  add column if not exists version bigint not null default 1
    check (version > 0);

create index if not exists projects_org_status_updated_keyset_idx
  on public.projects (organization_id, status, updated_at desc, id desc);
create index if not exists projects_org_updated_keyset_idx
  on public.projects (organization_id, updated_at desc, id desc);
create index if not exists todos_project_status_due_keyset_idx
  on public.todos (project_id, status, due_at, id);
create index if not exists todos_project_list_position_keyset_idx
  on public.todos (project_id, todo_list_id, position, id);
create index if not exists todo_assignees_profile_todo_idx
  on public.todo_assignees (profile_id, todo_id);
create index if not exists activity_org_created_keyset_idx
  on public.activity_events (organization_id, created_at desc, id desc);
create index if not exists messages_project_created_keyset_idx
  on public.messages (project_id, created_at desc, id desc);
create index if not exists comments_message_created_keyset_idx
  on public.comments ((metadata ->> 'message_id'), created_at, id)
  where metadata ? 'message_id';
create index if not exists milestones_project_due_keyset_idx
  on public.milestones (project_id, due_date, id);

create table private.project_write_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation text not null,
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 200),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (organization_id, operation, idempotency_key)
);

create index project_write_requests_created_at_idx
  on private.project_write_requests (created_at);

create or replace function private.current_project_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.organization_id
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.status = 'active'
    and profile.organization_id is not null;
$$;

create or replace function private.project_write_actor(
  target_organization_id uuid,
  requested_actor_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  jwt_actor_id uuid := (select auth.uid());
  resolved_actor_id uuid := coalesce(jwt_actor_id, requested_actor_id);
  actor_organization_id uuid;
  actor_status text;
begin
  if jwt_actor_id is not null
    and requested_actor_id is not null
    and requested_actor_id <> jwt_actor_id
  then
    raise insufficient_privilege using
      message = 'The authenticated user cannot write as another profile.';
  end if;

  if resolved_actor_id is null then
    -- Service-role imports and integrations may intentionally have no actor.
    return null;
  end if;

  select profile.organization_id, profile.status
  into actor_organization_id, actor_status
  from public.profiles as profile
  where profile.id = resolved_actor_id;

  if actor_organization_id is distinct from target_organization_id
    or actor_status <> 'active'
  then
    raise insufficient_privilege using
      message = 'The write actor is not an active member of this organization.';
  end if;

  return resolved_actor_id;
end;
$$;

create or replace function private.lock_project_write_request(
  target_organization_id uuid,
  target_operation text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  prior_result jsonb;
begin
  if char_length(coalesce(target_idempotency_key, '')) not between 8 and 200 then
    raise check_violation using
      message = 'An idempotency key between 8 and 200 characters is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_organization_id::text || ':' || target_operation || ':' ||
        target_idempotency_key,
      0
    )
  );

  select request.result
  into prior_result
  from private.project_write_requests as request
  where request.organization_id = target_organization_id
    and request.operation = target_operation
    and request.idempotency_key = target_idempotency_key;

  return prior_result;
end;
$$;

create or replace function private.store_project_write_result(
  target_organization_id uuid,
  target_operation text,
  target_idempotency_key text,
  target_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into private.project_write_requests (
    organization_id,
    operation,
    idempotency_key,
    result
  )
  values (
    target_organization_id,
    target_operation,
    target_idempotency_key,
    target_result
  );
  return target_result;
end;
$$;

revoke all on table private.project_write_requests from public;
revoke all on function private.current_project_organization_id() from public;
revoke all on function private.project_write_actor(uuid, uuid) from public;
revoke all on function private.lock_project_write_request(uuid, text, text)
  from public;
revoke all on function private.store_project_write_result(
  uuid,
  text,
  text,
  jsonb
) from public;
grant execute on function private.current_project_organization_id()
  to authenticated, service_role;

-- Dashboard: bounded project/activity slices plus scalar organization metrics.
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
  with organization as (
    select private.current_project_organization_id() as id
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
      and project.status = 'active'
      and (
        before_project_updated_at is null
        or before_project_id is null
        or (project.updated_at, project.id) <
          (before_project_updated_at, before_project_id)
      )
    order by project.updated_at desc, project.id desc
    limit greatest(1, least(requested_project_limit, 24))
  ),
  project_rows as (
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
    left join public.profiles as actor on actor.id = event.actor_id
    left join public.projects as project on project.id = event.project_id
    where event.organization_id = (select id from organization)
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
      (select count(*) from public.projects as project
        where project.organization_id = (select id from organization)) as project_total,
      (select count(*) from public.projects as project
        where project.organization_id = (select id from organization)
          and project.status = 'active') as active_project_count,
      (select count(*) from public.todos as todo
        join public.projects as project on project.id = todo.project_id
        where project.organization_id = (select id from organization)
          and todo.status not in ('done', 'cancelled')) as open_todo_count,
      (select count(*) from public.todos as todo
        join public.projects as project on project.id = todo.project_id
        where project.organization_id = (select id from organization)
          and todo.status not in ('done', 'cancelled')
          and todo.due_at < now()) as overdue_todo_count,
      (select count(*) from public.todos as todo
        join public.projects as project on project.id = todo.project_id
        where project.organization_id = (select id from organization)
          and todo.status = 'blocked') as blocked_todo_count
  )
  select jsonb_build_object(
    'projects',
    coalesce((
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
    'activity',
    coalesce((
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
  with organization as (
    select private.current_project_organization_id() as id
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
      and (
        before_updated_at is null
        or before_project_id is null
        or (project.updated_at, project.id) <
          (before_updated_at, before_project_id)
      )
    order by project.updated_at desc, project.id desc
    limit greatest(1, least(requested_limit, 100))
  ),
  project_rows as (
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
    'projects',
    coalesce((
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
    'total_count', (
      select count(*)
      from public.projects as project
      where project.organization_id = (select id from organization)
    ),
    'next_cursor', (
      select jsonb_build_object('updated_at', project.updated_at, 'id', project.id)
      from project_page as project
      order by project.updated_at, project.id
      limit 1
    )
  );
$$;

create or replace function public.get_project_overview_data(
  target_project_id uuid,
  after_milestone_due_date date default null,
  after_milestone_id uuid default null,
  requested_milestone_limit integer default 20,
  requested_document_limit integer default 50,
  requested_chat_limit integer default 50
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
  project_row as materialized (
    select
      project.id,
      project.name,
      project.client_name,
      project.description,
      project.status,
      project.metadata,
      project.updated_at
    from public.projects as project
    where project.id = target_project_id
      and project.organization_id = (select id from organization)
  ),
  members as (
    select
      profile.id,
      profile.full_name,
      profile.email,
      profile.title,
      profile.role,
      profile.status,
      profile.preferences
    from public.project_members as member
    join public.profiles as profile on profile.id = member.profile_id
    where member.project_id = target_project_id
      and profile.organization_id = (select id from organization)
    order by profile.full_name, profile.id
  ),
  milestone_page as materialized (
    select
      milestone.id,
      milestone.project_id,
      milestone.name,
      milestone.due_date
    from public.milestones as milestone
    where milestone.project_id = target_project_id
      and milestone.status not in ('completed', 'cancelled')
      and (
        after_milestone_due_date is null
        or after_milestone_id is null
        or (coalesce(milestone.due_date, 'infinity'::date), milestone.id) >
          (after_milestone_due_date, after_milestone_id)
      )
    order by milestone.due_date asc nulls last, milestone.id
    limit greatest(1, least(requested_milestone_limit, 100))
  ),
  documents as (
    (
      select
        doc.id,
        doc.project_id,
        doc.title,
        'doc'::text as kind,
        doc.created_by as author_id,
        null::bigint as size_bytes,
        doc.updated_at
      from public.docs as doc
      where doc.project_id = target_project_id
      order by doc.updated_at desc, doc.id desc
      limit greatest(1, least(requested_document_limit, 100))
    )
    union all
    (
      select
        file.id,
        file.project_id,
        file.file_name,
        'file'::text,
        file.uploaded_by,
        file.size_bytes,
        file.updated_at
      from public.files as file
      where file.project_id = target_project_id
      order by file.updated_at desc, file.id desc
      limit greatest(1, least(requested_document_limit, 100))
    )
  ),
  chats as (
    select
      message.id,
      message.project_id,
      message.profile_id,
      message.content,
      message.created_at
    from public.chat_messages as message
    where message.project_id = target_project_id
    order by message.created_at desc, message.id desc
    limit greatest(1, least(requested_chat_limit, 100))
  ),
  counts as (
    select
      (select count(*) from public.todos as todo
        where todo.project_id = target_project_id
          and todo.status not in ('done', 'cancelled')) as open_todos,
      (select count(*) from public.messages as message
        where message.project_id = target_project_id) as messages,
      (select count(*) from public.chat_messages as message
        where message.project_id = target_project_id) as chats,
      (
        (select count(*) from public.docs as doc
          where doc.project_id = target_project_id)
        +
        (select count(*) from public.files as file
          where file.project_id = target_project_id)
      ) as documents,
      (select count(*) from public.todos as todo
        where todo.project_id = target_project_id
          and todo.status <> 'cancelled') as total_todos,
      (select count(*) from public.todos as todo
        where todo.project_id = target_project_id
          and todo.status = 'done') as done_todos
  )
  select case
    when not exists (select 1 from project_row) then null
    else jsonb_build_object(
      'project', (
        select jsonb_build_object(
          'id', project.id,
          'name', project.name,
          'client_name', project.client_name,
          'description', project.description,
          'status', project.status,
          'metadata', project.metadata,
          'updated_at', project.updated_at,
          'member_ids', coalesce(
            (select array_agg(member.id order by member.id) from members as member),
            '{}'::uuid[]
          ),
          'progress', case
            when (select total_todos from counts) = 0 then 0
            else round(
              100.0 * (select done_todos from counts) /
              (select total_todos from counts)
            )::integer
          end
        )
        from project_row as project
      ),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', member.id,
          'full_name', member.full_name,
          'email', member.email,
          'title', member.title,
          'role', member.role,
          'status', member.status,
          'preferences', member.preferences
        ) order by member.full_name, member.id)
        from members as member
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
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', document.id,
          'project_id', document.project_id,
          'title', document.title,
          'kind', document.kind,
          'author_id', document.author_id,
          'size_bytes', document.size_bytes,
          'updated_at', document.updated_at
        ) order by document.updated_at desc, document.id desc)
        from documents as document
      ), '[]'::jsonb),
      'chats', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', chat.id,
          'project_id', chat.project_id,
          'profile_id', chat.profile_id,
          'content', chat.content,
          'created_at', chat.created_at
        ) order by chat.created_at, chat.id)
        from chats as chat
      ), '[]'::jsonb),
      'tab_counts', (select to_jsonb(counts.*) - 'total_todos' - 'done_todos' from counts),
      'next_milestone_cursor', (
        select jsonb_build_object(
          'due_date', coalesce(milestone.due_date, 'infinity'::date),
          'id', milestone.id
        )
        from milestone_page as milestone
        order by milestone.due_date desc nulls first, milestone.id desc
        limit 1
      )
    )
  end;
$$;

create or replace function public.get_project_todos_data(
  target_project_id uuid,
  after_list_position integer default null,
  after_todo_position integer default null,
  after_todo_id uuid default null,
  requested_limit integer default 100
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
  allowed_project as (
    select project.id
    from public.projects as project
    where project.id = target_project_id
      and project.organization_id = (select id from organization)
  ),
  lists as materialized (
    select list.id, list.project_id, list.title, list.position
    from public.todo_lists as list
    where list.project_id = (select id from allowed_project)
      and not list.is_archived
    order by list.position, list.id
    limit 100
  ),
  todo_page as materialized (
    select
      todo.id,
      todo.project_id,
      todo.todo_list_id,
      todo.title,
      todo.description,
      todo.assigned_to,
      todo.due_at,
      todo.status,
      todo.priority,
      todo.accelo_task_id,
      todo.updated_at,
      todo.position,
      todo.version,
      list.position as list_position
    from public.todos as todo
    join lists as list on list.id = todo.todo_list_id
    where todo.project_id = (select id from allowed_project)
      and (
        after_list_position is null
        or after_todo_position is null
        or after_todo_id is null
        or (list.position, todo.position, todo.id) >
          (after_list_position, after_todo_position, after_todo_id)
      )
    order by list.position, todo.position, todo.id
    limit greatest(1, least(requested_limit, 200))
  ),
  assignees as (
    select
      assignment.todo_id,
      array_agg(assignment.profile_id order by assignment.profile_id) as profile_ids
    from public.todo_assignees as assignment
    join todo_page as todo on todo.id = assignment.todo_id
    group by assignment.todo_id
  ),
  subscribers as (
    select
      subscriber.todo_id,
      array_agg(subscriber.profile_id order by subscriber.profile_id) as profile_ids
    from public.todo_completion_subscribers as subscriber
    join todo_page as todo on todo.id = subscriber.todo_id
    group by subscriber.todo_id
  ),
  subtasks as materialized (
    select
      subtask.id,
      subtask.todo_id,
      subtask.title,
      subtask.position,
      subtask.completed_at,
      subtask.completed_by,
      subtask.version
    from public.todo_subtasks as subtask
    join todo_page as todo on todo.id = subtask.todo_id
    order by subtask.todo_id, subtask.position, subtask.id
    limit 500
  ),
  comments as materialized (
    select
      comment.id,
      comment.todo_id,
      comment.author_id,
      comment.body,
      comment.created_at,
      comment.updated_at,
      comment.is_edited,
      comment.parent_comment_id
    from public.comments as comment
    join todo_page as todo on todo.id = comment.todo_id
    order by comment.created_at, comment.id
    limit 500
  )
  select jsonb_build_object(
    'todo_lists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', list.id,
        'project_id', list.project_id,
        'title', list.title,
        'position', list.position
      ) order by list.position, list.id)
      from lists as list
    ), '[]'::jsonb),
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', todo.id,
        'project_id', todo.project_id,
        'todo_list_id', todo.todo_list_id,
        'title', todo.title,
        'description', todo.description,
        'assigned_to', todo.assigned_to,
        'assignee_ids', coalesce(assignees.profile_ids, '{}'::uuid[]),
        'completion_subscriber_ids', coalesce(subscribers.profile_ids, '{}'::uuid[]),
        'due_at', todo.due_at,
        'status', todo.status,
        'priority', todo.priority,
        'accelo_task_id', todo.accelo_task_id,
        'updated_at', todo.updated_at,
        'position', todo.position,
        'version', todo.version
      ) order by todo.list_position, todo.position, todo.id)
      from todo_page as todo
      left join assignees on assignees.todo_id = todo.id
      left join subscribers on subscribers.todo_id = todo.id
    ), '[]'::jsonb),
    'subtasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', subtask.id,
        'todo_id', subtask.todo_id,
        'title', subtask.title,
        'position', subtask.position,
        'completed_at', subtask.completed_at,
        'completed_by', subtask.completed_by,
        'version', subtask.version
      ) order by subtask.todo_id, subtask.position, subtask.id)
      from subtasks as subtask
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', comment.id,
        'todo_id', comment.todo_id,
        'author_id', comment.author_id,
        'body', comment.body,
        'created_at', comment.created_at,
        'updated_at', comment.updated_at,
        'is_edited', comment.is_edited,
        'parent_comment_id', comment.parent_comment_id,
        'comment_mentions', coalesce((
          select jsonb_agg(jsonb_build_object('profile_id', mention.profile_id))
          from public.comment_mentions as mention
          where mention.comment_id = comment.id
        ), '[]'::jsonb),
        'comment_attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', attachment.id,
            'file_id', attachment.file_id,
            'external_url', attachment.external_url,
            'title', coalesce(attachment.title, file.file_name, 'Attachment')
          ) order by attachment.created_at, attachment.id)
          from public.comment_attachments as attachment
          left join public.files as file on file.id = attachment.file_id
          where attachment.comment_id = comment.id
        ), '[]'::jsonb)
      ) order by comment.created_at, comment.id)
      from comments as comment
    ), '[]'::jsonb),
    'next_cursor', (
      select jsonb_build_object(
        'list_position', todo.list_position,
        'todo_position', todo.position,
        'id', todo.id
      )
      from todo_page as todo
      order by todo.list_position desc, todo.position desc, todo.id desc
      limit 1
    )
  );
$$;

create or replace function public.get_project_messages_data(
  target_project_id uuid,
  before_created_at timestamptz default null,
  before_message_id uuid default null,
  requested_limit integer default 50
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
  allowed_project as (
    select project.id
    from public.projects as project
    where project.id = target_project_id
      and project.organization_id = (select id from organization)
  ),
  message_page as materialized (
    select
      message.id,
      message.project_id,
      message.subject,
      message.body,
      message.sender_id,
      message.metadata,
      message.created_at
    from public.messages as message
    where message.project_id = (select id from allowed_project)
      and (
        before_created_at is null
        or before_message_id is null
        or (message.created_at, message.id) <
          (before_created_at, before_message_id)
      )
    order by message.created_at desc, message.id desc
    limit greatest(1, least(requested_limit, 100))
  )
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message.id,
        'project_id', message.project_id,
        'subject', message.subject,
        'body', message.body,
        'sender_id', message.sender_id,
        'metadata', message.metadata,
        'created_at', message.created_at,
        'comment_count', (
          select count(*)
          from public.comments as comment
          where comment.metadata ->> 'message_id' = message.id::text
        )
      ) order by message.created_at desc, message.id desc)
      from message_page as message
    ), '[]'::jsonb),
    'next_cursor', (
      select jsonb_build_object('created_at', message.created_at, 'id', message.id)
      from message_page as message
      order by message.created_at, message.id
      limit 1
    )
  );
$$;

create or replace function public.get_my_work_project_data(
  after_due_at timestamptz default null,
  after_todo_id uuid default null,
  requested_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with actor as (
    select
      profile.id,
      profile.organization_id
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
  ),
  todo_page as materialized (
    select
      todo.id,
      todo.project_id,
      todo.todo_list_id,
      todo.title,
      todo.description,
      todo.assigned_to,
      todo.due_at,
      todo.status,
      todo.priority,
      todo.updated_at,
      todo.version
    from public.todos as todo
    join public.projects as project on project.id = todo.project_id
    where project.organization_id = (select organization_id from actor)
      and todo.status not in ('done', 'cancelled')
      and (
        todo.assigned_to = (select id from actor)
        or exists (
          select 1
          from public.todo_assignees as assignment
          where assignment.todo_id = todo.id
            and assignment.profile_id = (select id from actor)
        )
      )
      and (
        after_due_at is null
        or after_todo_id is null
        or (coalesce(todo.due_at, 'infinity'::timestamptz), todo.id) >
          (after_due_at, after_todo_id)
      )
    order by todo.due_at asc nulls last, todo.id
    limit greatest(1, least(requested_limit, 200))
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
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', todo.id,
        'project_id', todo.project_id,
        'todo_list_id', todo.todo_list_id,
        'title', todo.title,
        'description', todo.description,
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
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', project.id,
        'name', project.name,
        'client_name', project.client_name,
        'status', project.status
      ) order by project.name, project.id)
      from public.projects as project
      where project.id in (select distinct todo.project_id from todo_page as todo)
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

create or replace function public.get_activity_project_data(
  before_created_at timestamptz default null,
  before_activity_id uuid default null,
  requested_limit integer default 50
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
    left join public.profiles as actor on actor.id = event.actor_id
    left join public.projects as project on project.id = event.project_id
    where event.organization_id = (select id from organization)
      and (
        before_created_at is null
        or before_activity_id is null
        or (event.created_at, event.id) < (before_created_at, before_activity_id)
      )
    order by event.created_at desc, event.id desc
    limit greatest(1, least(requested_limit, 100))
  )
  select jsonb_build_object(
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
    'next_cursor', (
      select jsonb_build_object('created_at', activity.created_at, 'id', activity.id)
      from activity_page as activity
      order by activity.created_at, activity.id
      limit 1
    )
  );
$$;

-- Canonical todo creation: list resolution, todo, assignees, and completion
-- subscribers commit together.
create or replace function private.create_project_todo(
  target_project_id uuid,
  target_todo_list_id uuid,
  target_title text,
  target_description text,
  target_assignee_ids uuid[],
  target_completion_subscriber_ids uuid[],
  target_due_at timestamptz,
  target_priority text,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  actor_id uuid;
  list_id uuid := target_todo_list_id;
  normalized_assignee_ids uuid[];
  normalized_subscriber_ids uuid[];
  valid_profile_count integer;
  next_position integer;
  created_todo public.todos%rowtype;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id
  into target_organization_id
  from public.projects as project
  where project.id = target_project_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Project not found.';
  end if;

  actor_id := private.project_write_actor(target_organization_id, requested_actor_id);
  prior_result := private.lock_project_write_request(
    target_organization_id,
    'create_todo',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  if char_length(btrim(coalesce(target_title, ''))) not between 1 and 300 then
    raise check_violation using message = 'Todo title must be 1 to 300 characters.';
  end if;
  if target_priority not in ('low', 'medium', 'high', 'urgent') then
    raise check_violation using message = 'Invalid todo priority.';
  end if;

  if list_id is null then
    select list.id
    into list_id
    from public.todo_lists as list
    where list.project_id = target_project_id
      and not list.is_archived
    order by list.position, list.id
    limit 1;

    if list_id is null then
      insert into public.todo_lists (
        project_id,
        title,
        position,
        created_by
      )
      values (target_project_id, 'General', 0, actor_id)
      on conflict (project_id, title) do update
        set is_archived = false
      returning id into list_id;
    end if;
  elsif not exists (
    select 1
    from public.todo_lists as list
    where list.id = list_id
      and list.project_id = target_project_id
      and not list.is_archived
  ) then
    raise check_violation using message = 'Todo list does not belong to the project.';
  end if;

  select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[])
  into normalized_assignee_ids
  from (
    select distinct profile_id
    from unnest(coalesce(target_assignee_ids, '{}'::uuid[]))
      as requested(profile_id)
    where profile_id is not null
  ) as normalized;

  select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[])
  into normalized_subscriber_ids
  from (
    select distinct profile_id
    from unnest(coalesce(target_completion_subscriber_ids, '{}'::uuid[]))
      as requested(profile_id)
    where profile_id is not null
  ) as normalized;

  if cardinality(normalized_assignee_ids) > 50
    or cardinality(normalized_subscriber_ids) > 50
  then
    raise check_violation using message = 'Todos support at most 50 assignees or subscribers.';
  end if;

  select count(*)
  into valid_profile_count
  from public.profiles as profile
  where profile.id = any(normalized_assignee_ids || normalized_subscriber_ids)
    and profile.organization_id = target_organization_id
    and profile.status = 'active';
  if valid_profile_count <> cardinality(
    array(
      select distinct profile_id
      from unnest(normalized_assignee_ids || normalized_subscriber_ids)
        as requested(profile_id)
    )
  ) then
    raise check_violation using
      message = 'Every assignee and subscriber must be active in the project organization.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('todo-list:' || list_id::text, 0)
  );
  select coalesce(max(todo.position), -1) + 1
  into next_position
  from public.todos as todo
  where todo.todo_list_id = list_id;

  insert into public.todos (
    project_id,
    todo_list_id,
    title,
    description,
    assigned_to,
    created_by,
    due_at,
    priority,
    position,
    status,
    sync_status
  )
  values (
    target_project_id,
    list_id,
    btrim(target_title),
    nullif(btrim(target_description), ''),
    normalized_assignee_ids[1],
    actor_id,
    target_due_at,
    target_priority,
    next_position,
    'todo',
    'pending'
  )
  returning * into created_todo;

  insert into public.todo_assignees (
    todo_id,
    profile_id,
    assigned_by,
    source
  )
  select created_todo.id, profile_id, actor_id, 'p11'
  from unnest(normalized_assignee_ids) as assignee(profile_id);

  insert into public.todo_completion_subscribers (
    todo_id,
    profile_id,
    source
  )
  select created_todo.id, profile_id, 'p11'
  from unnest(normalized_subscriber_ids) as subscriber(profile_id);

  result := jsonb_build_object(
    'id', created_todo.id,
    'project_id', created_todo.project_id,
    'todo_list_id', created_todo.todo_list_id,
    'title', created_todo.title,
    'description', created_todo.description,
    'assigned_to', created_todo.assigned_to,
    'assignee_ids', normalized_assignee_ids,
    'completion_subscriber_ids', normalized_subscriber_ids,
    'due_at', created_todo.due_at,
    'status', created_todo.status,
    'priority', created_todo.priority,
    'position', created_todo.position,
    'updated_at', created_todo.updated_at,
    'version', created_todo.version
  );
  return private.store_project_write_result(
    target_organization_id,
    'create_todo',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.create_project_todo(
  target_project_id uuid,
  target_todo_list_id uuid,
  target_title text,
  target_description text,
  target_assignee_ids uuid[],
  target_completion_subscriber_ids uuid[],
  target_due_at timestamptz,
  target_priority text,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_project_todo(
    target_project_id,
    target_todo_list_id,
    target_title,
    target_description,
    target_assignee_ids,
    target_completion_subscriber_ids,
    target_due_at,
    target_priority,
    requested_actor_id,
    target_idempotency_key
  );
$$;

create or replace function private.update_project_todo(
  target_todo_id uuid,
  expected_version bigint,
  changes jsonb,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  actor_id uuid;
  current_todo public.todos%rowtype;
  updated_todo public.todos%rowtype;
  normalized_assignee_ids uuid[];
  normalized_subscriber_ids uuid[];
  requested_profile_ids uuid[];
  valid_profile_count integer;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id
  into target_organization_id
  from public.todos as todo
  join public.projects as project on project.id = todo.project_id
  where todo.id = target_todo_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Todo not found.';
  end if;

  actor_id := private.project_write_actor(target_organization_id, requested_actor_id);
  prior_result := private.lock_project_write_request(
    target_organization_id,
    'update_todo',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  if jsonb_typeof(changes) <> 'object'
    or changes = '{}'::jsonb
    or (changes - array[
      'title',
      'description',
      'status',
      'priority',
      'due_at',
      'assignee_ids',
      'completion_subscriber_ids'
    ]) <> '{}'::jsonb
  then
    raise check_violation using message = 'Unsupported or empty todo changes.';
  end if;

  select todo.*
  into current_todo
  from public.todos as todo
  where todo.id = target_todo_id
  for update;
  if current_todo.version <> expected_version then
    raise serialization_failure using
      message = format(
        'Todo version conflict: expected %s, current %s.',
        expected_version,
        current_todo.version
      );
  end if;

  if changes ? 'title'
    and char_length(btrim(coalesce(changes ->> 'title', ''))) not between 1 and 300
  then
    raise check_violation using message = 'Todo title must be 1 to 300 characters.';
  end if;
  if changes ? 'status'
    and changes ->> 'status' not in (
      'todo',
      'in_progress',
      'blocked',
      'review',
      'done',
      'cancelled'
    )
  then
    raise check_violation using message = 'Invalid todo status.';
  end if;
  if changes ? 'priority'
    and changes ->> 'priority' not in ('low', 'medium', 'high', 'urgent')
  then
    raise check_violation using message = 'Invalid todo priority.';
  end if;

  if changes ? 'assignee_ids' then
    if jsonb_typeof(changes -> 'assignee_ids') <> 'array' then
      raise check_violation using message = 'assignee_ids must be an array.';
    end if;
    select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[])
    into normalized_assignee_ids
    from (
      select distinct value::uuid as profile_id
      from jsonb_array_elements_text(changes -> 'assignee_ids')
    ) as normalized;
  else
    select coalesce(array_agg(assignment.profile_id order by assignment.profile_id), '{}'::uuid[])
    into normalized_assignee_ids
    from public.todo_assignees as assignment
    where assignment.todo_id = target_todo_id;
  end if;

  if changes ? 'completion_subscriber_ids' then
    if jsonb_typeof(changes -> 'completion_subscriber_ids') <> 'array' then
      raise check_violation using
        message = 'completion_subscriber_ids must be an array.';
    end if;
    select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[])
    into normalized_subscriber_ids
    from (
      select distinct value::uuid as profile_id
      from jsonb_array_elements_text(changes -> 'completion_subscriber_ids')
    ) as normalized;
  else
    select coalesce(array_agg(subscriber.profile_id order by subscriber.profile_id), '{}'::uuid[])
    into normalized_subscriber_ids
    from public.todo_completion_subscribers as subscriber
    where subscriber.todo_id = target_todo_id;
  end if;

  requested_profile_ids := array(
    select distinct profile_id
    from unnest(normalized_assignee_ids || normalized_subscriber_ids)
      as requested(profile_id)
  );
  if cardinality(normalized_assignee_ids) > 50
    or cardinality(normalized_subscriber_ids) > 50
  then
    raise check_violation using message = 'Todos support at most 50 assignees or subscribers.';
  end if;
  select count(*)
  into valid_profile_count
  from public.profiles as profile
  where profile.id = any(requested_profile_ids)
    and profile.organization_id = target_organization_id
    and profile.status = 'active';
  if valid_profile_count <> cardinality(requested_profile_ids) then
    raise check_violation using
      message = 'Every assignee and subscriber must be active in the project organization.';
  end if;

  update public.todos as todo
  set
    title = case when changes ? 'title'
      then btrim(changes ->> 'title') else todo.title end,
    description = case when changes ? 'description'
      then nullif(btrim(changes ->> 'description'), '') else todo.description end,
    status = case when changes ? 'status'
      then changes ->> 'status' else todo.status end,
    priority = case when changes ? 'priority'
      then changes ->> 'priority' else todo.priority end,
    due_at = case when changes ? 'due_at'
      then (changes ->> 'due_at')::timestamptz else todo.due_at end,
    assigned_to = case when changes ? 'assignee_ids'
      then normalized_assignee_ids[1] else todo.assigned_to end,
    completed_at = case
      when changes ->> 'status' = 'done' then coalesce(todo.completed_at, now())
      when changes ? 'status' then null
      else todo.completed_at
    end,
    completed_by = case
      when changes ->> 'status' = 'done' then coalesce(todo.completed_by, actor_id)
      when changes ? 'status' then null
      else todo.completed_by
    end,
    sync_status = 'pending',
    version = todo.version + 1
  where todo.id = target_todo_id
  returning todo.* into updated_todo;

  if changes ? 'assignee_ids' then
    delete from public.todo_assignees as assignment
    where assignment.todo_id = target_todo_id;
    insert into public.todo_assignees (
      todo_id,
      profile_id,
      assigned_by,
      source
    )
    select target_todo_id, profile_id, actor_id, 'p11'
    from unnest(normalized_assignee_ids) as assignee(profile_id);
  end if;

  if changes ? 'completion_subscriber_ids' then
    delete from public.todo_completion_subscribers as subscriber
    where subscriber.todo_id = target_todo_id;
    insert into public.todo_completion_subscribers (
      todo_id,
      profile_id,
      source
    )
    select target_todo_id, profile_id, 'p11'
    from unnest(normalized_subscriber_ids) as subscriber(profile_id);
  end if;

  result := jsonb_build_object(
    'id', updated_todo.id,
    'project_id', updated_todo.project_id,
    'todo_list_id', updated_todo.todo_list_id,
    'title', updated_todo.title,
    'description', updated_todo.description,
    'assigned_to', updated_todo.assigned_to,
    'assignee_ids', normalized_assignee_ids,
    'completion_subscriber_ids', normalized_subscriber_ids,
    'due_at', updated_todo.due_at,
    'status', updated_todo.status,
    'priority', updated_todo.priority,
    'position', updated_todo.position,
    'completed_at', updated_todo.completed_at,
    'updated_at', updated_todo.updated_at,
    'version', updated_todo.version
  );
  return private.store_project_write_result(
    target_organization_id,
    'update_todo',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.update_project_todo(
  target_todo_id uuid,
  expected_version bigint,
  changes jsonb,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_project_todo(
    target_todo_id,
    expected_version,
    changes,
    requested_actor_id,
    target_idempotency_key
  );
$$;

create or replace function private.create_project_message(
  target_project_id uuid,
  target_subject text,
  target_body text,
  target_category text,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  actor_id uuid;
  created_message public.messages%rowtype;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id
  into target_organization_id
  from public.projects as project
  where project.id = target_project_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Project not found.';
  end if;
  actor_id := private.project_write_actor(target_organization_id, requested_actor_id);
  prior_result := private.lock_project_write_request(
    target_organization_id,
    'create_message',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  if char_length(btrim(coalesce(target_subject, ''))) not between 1 and 240
    or char_length(btrim(coalesce(target_body, ''))) not between 1 and 20000
    or target_category not in ('update', 'decision', 'creative', 'client')
  then
    raise check_violation using message = 'Invalid project message.';
  end if;

  insert into public.messages (
    project_id,
    sender_id,
    direction,
    channel,
    subject,
    body,
    metadata
  )
  values (
    target_project_id,
    actor_id,
    'internal',
    'internal',
    btrim(target_subject),
    btrim(target_body),
    jsonb_build_object('category', target_category)
  )
  returning * into created_message;

  result := jsonb_build_object(
    'id', created_message.id,
    'project_id', created_message.project_id,
    'subject', created_message.subject,
    'body', created_message.body,
    'sender_id', created_message.sender_id,
    'metadata', created_message.metadata,
    'created_at', created_message.created_at,
    'comment_count', 0
  );
  return private.store_project_write_result(
    target_organization_id,
    'create_message',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.create_project_message(
  target_project_id uuid,
  target_subject text,
  target_body text,
  target_category text,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_project_message(
    target_project_id,
    target_subject,
    target_body,
    target_category,
    requested_actor_id,
    target_idempotency_key
  );
$$;

create or replace function private.create_project_comment(
  target_project_id uuid,
  target_parent_type text,
  target_parent_id uuid,
  target_body text,
  target_mention_profile_ids uuid[],
  target_attachment_file_ids uuid[],
  target_external_attachments jsonb,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  actor_id uuid;
  normalized_mention_ids uuid[];
  normalized_file_ids uuid[];
  valid_count integer;
  created_comment public.comments%rowtype;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id
  into target_organization_id
  from public.projects as project
  where project.id = target_project_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Project not found.';
  end if;
  actor_id := private.project_write_actor(target_organization_id, requested_actor_id);
  prior_result := private.lock_project_write_request(
    target_organization_id,
    'create_comment',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  if target_parent_type not in ('message', 'todo', 'doc')
    or char_length(btrim(coalesce(target_body, ''))) not between 1 and 10000
    or (
      target_parent_type = 'message'
      and not exists (
        select 1 from public.messages as message
        where message.id = target_parent_id
          and message.project_id = target_project_id
      )
    )
    or (
      target_parent_type = 'todo'
      and not exists (
        select 1 from public.todos as todo
        where todo.id = target_parent_id
          and todo.project_id = target_project_id
      )
    )
    or (
      target_parent_type = 'doc'
      and not exists (
        select 1 from public.docs as doc
        where doc.id = target_parent_id
          and doc.project_id = target_project_id
      )
    )
  then
    raise check_violation using
      message = 'Comment target does not belong to the project.';
  end if;

  select coalesce(array_agg(profile_id order by profile_id), '{}'::uuid[])
  into normalized_mention_ids
  from (
    select distinct profile_id
    from unnest(coalesce(target_mention_profile_ids, '{}'::uuid[]))
      as requested(profile_id)
    where profile_id is not null
  ) as normalized;
  select count(*)
  into valid_count
  from public.profiles as profile
  where profile.id = any(normalized_mention_ids)
    and profile.organization_id = target_organization_id;
  if valid_count <> cardinality(normalized_mention_ids) then
    raise check_violation using
      message = 'Every mentioned profile must belong to the project organization.';
  end if;

  select coalesce(array_agg(file_id order by file_id), '{}'::uuid[])
  into normalized_file_ids
  from (
    select distinct file_id
    from unnest(coalesce(target_attachment_file_ids, '{}'::uuid[]))
      as requested(file_id)
    where file_id is not null
  ) as normalized;
  select count(*)
  into valid_count
  from public.files as file
  where file.id = any(normalized_file_ids)
    and file.project_id = target_project_id;
  if valid_count <> cardinality(normalized_file_ids) then
    raise check_violation using
      message = 'Every attached file must belong to the comment project.';
  end if;

  if jsonb_typeof(coalesce(target_external_attachments, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(target_external_attachments, '[]'::jsonb)) > 20
    or exists (
      select 1
      from jsonb_array_elements(
        coalesce(target_external_attachments, '[]'::jsonb)
      ) as attachment(value)
      where attachment.value ->> 'url' !~ '^https?://'
        or char_length(btrim(coalesce(attachment.value ->> 'title', '')))
          not between 1 and 240
    )
  then
    raise check_violation using message = 'Invalid external comment attachment.';
  end if;

  insert into public.comments (
    project_id,
    todo_id,
    doc_id,
    author_id,
    body,
    metadata
  )
  values (
    target_project_id,
    case when target_parent_type = 'todo' then target_parent_id end,
    case when target_parent_type = 'doc' then target_parent_id end,
    actor_id,
    btrim(target_body),
    case
      when target_parent_type = 'message'
        then jsonb_build_object('message_id', target_parent_id)
      else '{}'::jsonb
    end
  )
  returning * into created_comment;

  insert into public.comment_mentions (comment_id, profile_id)
  select created_comment.id, profile_id
  from unnest(normalized_mention_ids) as mention(profile_id);

  insert into public.comment_attachments (comment_id, file_id)
  select created_comment.id, file_id
  from unnest(normalized_file_ids) as attachment(file_id);

  insert into public.comment_attachments (
    comment_id,
    external_url,
    title
  )
  select
    created_comment.id,
    attachment.value ->> 'url',
    btrim(attachment.value ->> 'title')
  from jsonb_array_elements(
    coalesce(target_external_attachments, '[]'::jsonb)
  ) as attachment(value);

  result := jsonb_build_object(
    'id', created_comment.id,
    'project_id', created_comment.project_id,
    'todo_id', created_comment.todo_id,
    'doc_id', created_comment.doc_id,
    'author_id', created_comment.author_id,
    'body', created_comment.body,
    'metadata', created_comment.metadata,
    'created_at', created_comment.created_at,
    'mentioned_profile_ids', normalized_mention_ids,
    'attachments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attachment.id,
        'file_id', attachment.file_id,
        'external_url', attachment.external_url,
        'title', coalesce(attachment.title, file.file_name, 'Attachment')
      ) order by attachment.created_at, attachment.id)
      from public.comment_attachments as attachment
      left join public.files as file on file.id = attachment.file_id
      where attachment.comment_id = created_comment.id
    ), '[]'::jsonb)
  );
  return private.store_project_write_result(
    target_organization_id,
    'create_comment',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.create_project_comment(
  target_project_id uuid,
  target_parent_type text,
  target_parent_id uuid,
  target_body text,
  target_mention_profile_ids uuid[],
  target_attachment_file_ids uuid[],
  target_external_attachments jsonb,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_project_comment(
    target_project_id,
    target_parent_type,
    target_parent_id,
    target_body,
    target_mention_profile_ids,
    target_attachment_file_ids,
    target_external_attachments,
    requested_actor_id,
    target_idempotency_key
  );
$$;

create or replace function private.create_project_subtask(
  target_todo_id uuid,
  target_title text,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  actor_id uuid;
  next_position integer;
  created_subtask public.todo_subtasks%rowtype;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id
  into target_organization_id
  from public.todos as todo
  join public.projects as project on project.id = todo.project_id
  where todo.id = target_todo_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Todo not found.';
  end if;
  actor_id := private.project_write_actor(target_organization_id, requested_actor_id);
  prior_result := private.lock_project_write_request(
    target_organization_id,
    'create_subtask',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  if char_length(btrim(coalesce(target_title, ''))) not between 1 and 300 then
    raise check_violation using message = 'Subtask title must be 1 to 300 characters.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('todo-subtasks:' || target_todo_id::text, 0)
  );
  select coalesce(max(subtask.position), -1) + 1
  into next_position
  from public.todo_subtasks as subtask
  where subtask.todo_id = target_todo_id;

  insert into public.todo_subtasks (
    todo_id,
    title,
    position,
    created_by
  )
  values (target_todo_id, btrim(target_title), next_position, actor_id)
  returning * into created_subtask;

  result := jsonb_build_object(
    'id', created_subtask.id,
    'todo_id', created_subtask.todo_id,
    'title', created_subtask.title,
    'position', created_subtask.position,
    'completed_at', created_subtask.completed_at,
    'completed_by', created_subtask.completed_by,
    'version', created_subtask.version
  );
  return private.store_project_write_result(
    target_organization_id,
    'create_subtask',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.create_project_subtask(
  target_todo_id uuid,
  target_title text,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_project_subtask(
    target_todo_id,
    target_title,
    requested_actor_id,
    target_idempotency_key
  );
$$;

create or replace function private.update_project_subtask(
  target_subtask_id uuid,
  expected_version bigint,
  target_completed boolean,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  actor_id uuid;
  current_subtask public.todo_subtasks%rowtype;
  updated_subtask public.todo_subtasks%rowtype;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id
  into target_organization_id
  from public.todo_subtasks as subtask
  join public.todos as todo on todo.id = subtask.todo_id
  join public.projects as project on project.id = todo.project_id
  where subtask.id = target_subtask_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Subtask not found.';
  end if;
  actor_id := private.project_write_actor(target_organization_id, requested_actor_id);
  prior_result := private.lock_project_write_request(
    target_organization_id,
    'update_subtask',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  select subtask.*
  into current_subtask
  from public.todo_subtasks as subtask
  where subtask.id = target_subtask_id
  for update;
  if current_subtask.version <> expected_version then
    raise serialization_failure using
      message = format(
        'Subtask version conflict: expected %s, current %s.',
        expected_version,
        current_subtask.version
      );
  end if;

  update public.todo_subtasks as subtask
  set
    completed_at = case when target_completed then now() else null end,
    completed_by = case when target_completed then actor_id else null end,
    version = subtask.version + 1
  where subtask.id = target_subtask_id
  returning subtask.* into updated_subtask;

  result := jsonb_build_object(
    'id', updated_subtask.id,
    'todo_id', updated_subtask.todo_id,
    'title', updated_subtask.title,
    'position', updated_subtask.position,
    'completed_at', updated_subtask.completed_at,
    'completed_by', updated_subtask.completed_by,
    'version', updated_subtask.version
  );
  return private.store_project_write_result(
    target_organization_id,
    'update_subtask',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.update_project_subtask(
  target_subtask_id uuid,
  expected_version bigint,
  target_completed boolean,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_project_subtask(
    target_subtask_id,
    expected_version,
    target_completed,
    requested_actor_id,
    target_idempotency_key
  );
$$;

-- Direct authenticated writes are intentionally retained for compatibility
-- with the existing Accelo sync, but application/API mutations use these RPCs.
do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.get_dashboard_project_data(timestamptz,uuid,timestamptz,uuid,integer,integer)',
    'public.get_projects_project_data(timestamptz,uuid,integer)',
    'public.get_project_overview_data(uuid,date,uuid,integer,integer,integer)',
    'public.get_project_todos_data(uuid,integer,integer,uuid,integer)',
    'public.get_project_messages_data(uuid,timestamptz,uuid,integer)',
    'public.get_my_work_project_data(timestamptz,uuid,integer)',
    'public.get_team_project_data(timestamptz,uuid,integer)',
    'public.get_activity_project_data(timestamptz,uuid,integer)',
    'public.create_project_todo(uuid,uuid,text,text,uuid[],uuid[],timestamptz,text,uuid,text)',
    'public.update_project_todo(uuid,bigint,jsonb,uuid,text)',
    'public.create_project_message(uuid,text,text,text,uuid,text)',
    'public.create_project_comment(uuid,text,uuid,text,uuid[],uuid[],jsonb,uuid,text)',
    'public.create_project_subtask(uuid,text,uuid,text)',
    'public.update_project_subtask(uuid,bigint,boolean,uuid,text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', signature);
    execute format(
      'grant execute on function %s to authenticated, service_role',
      signature
    );
  end loop;
end;
$$;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'private.create_project_todo(uuid,uuid,text,text,uuid[],uuid[],timestamptz,text,uuid,text)',
    'private.update_project_todo(uuid,bigint,jsonb,uuid,text)',
    'private.create_project_message(uuid,text,text,text,uuid,text)',
    'private.create_project_comment(uuid,text,uuid,text,uuid[],uuid[],jsonb,uuid,text)',
    'private.create_project_subtask(uuid,text,uuid,text)',
    'private.update_project_subtask(uuid,bigint,boolean,uuid,text)'
  ]
  loop
    execute format('revoke all on function %s from public', signature);
    execute format(
      'grant execute on function %s to authenticated, service_role',
      signature
    );
  end loop;
end;
$$;
