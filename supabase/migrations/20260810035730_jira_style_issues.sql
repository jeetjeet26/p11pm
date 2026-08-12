-- Jira-style issue metadata, lightweight issue lists, and authorized detail reads.
-- Legacy todo RPC signatures remain available; new reads use separate issue RPCs.

alter table public.todos
  add column issue_number bigint,
  add column issue_type text not null default 'task',
  add column rank bigint,
  add column operational_state text not null default 'active';

-- Backfill identifiers and ranks from durable fields only. Issue numbers follow
-- source chronology; ranks preserve the existing list/position ordering.
alter table public.todos disable trigger set_todos_updated_at;

with numbered as (
  select
    todo.id,
    row_number() over (
      partition by todo.project_id
      order by
        coalesce(todo.source_created_at, todo.created_at),
        todo.created_at,
        todo.id
    )::bigint as issue_number,
    (
      row_number() over (
        partition by todo.project_id
        order by
          list.position,
          todo.position,
          coalesce(todo.source_created_at, todo.created_at),
          todo.id
      ) * 1024
    )::bigint as rank
  from public.todos as todo
  join public.todo_lists as list on list.id = todo.todo_list_id
)
update public.todos as todo
set
  issue_number = numbered.issue_number,
  rank = numbered.rank
from numbered
where numbered.id = todo.id;

-- The cutoff is intentionally fixed to the migration date minus 90 days so
-- resets and new environments classify the same imported records identically.
update public.todos as todo
set operational_state = case
  when todo.status in ('done', 'cancelled') then 'historical'
  when (
    todo.basecamp_todo_id is not null
    or todo.basecamp_export_run_id is not null
    or todo.imported_at is not null
  )
  and coalesce(
    todo.source_updated_at,
    todo.source_created_at,
    todo.created_at
  ) < '2026-05-12T00:00:00Z'::timestamptz
    then 'triage'
  else 'active'
end;

alter table public.todos enable trigger set_todos_updated_at;

alter table public.todos
  alter column issue_number set not null,
  alter column rank set not null,
  add constraint todos_issue_number_positive check (issue_number > 0),
  add constraint todos_issue_type_valid check (
    issue_type in ('task', 'story', 'bug', 'epic')
  ),
  add constraint todos_rank_positive check (rank > 0),
  add constraint todos_operational_state_valid check (
    operational_state in ('active', 'triage', 'historical')
  ),
  add constraint todos_project_issue_number_key
    unique (project_id, issue_number);

create index todos_project_operational_rank_idx
  on public.todos (
    project_id,
    operational_state,
    rank,
    issue_number,
    id
  );
create index todos_project_status_operational_rank_idx
  on public.todos (
    project_id,
    status,
    operational_state,
    rank,
    issue_number,
    id
  );
create index todos_project_priority_operational_rank_idx
  on public.todos (
    project_id,
    priority,
    operational_state,
    rank,
    issue_number,
    id
  );
create index todos_project_operational_due_on_idx
  on public.todos (project_id, operational_state, due_on, id)
  where due_on is not null;
create index todos_issue_search_idx
  on public.todos using gin (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(description, '')
    )
  );
create index todos_labels_idx on public.todos using gin (labels);

-- Allocate per-project identifiers for every insert path, including native
-- writes and future imports. The project advisory lock prevents duplicate
-- max-plus-one allocation under concurrency.
create or replace function private.prepare_issue_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    new.issue_number := null;
    new.rank := null;
  end if;

  if new.issue_number is null or new.rank is null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'project-issue-metadata:' || new.project_id::text,
        0
      )
    );
  end if;

  if new.issue_number is null then
    select coalesce(max(todo.issue_number), 0) + 1
    into new.issue_number
    from public.todos as todo
    where todo.project_id = new.project_id;
  end if;

  if new.rank is null then
    select coalesce(max(todo.rank), 0) + 1024
    into new.rank
    from public.todos as todo
    where todo.project_id = new.project_id;
  end if;

  new.issue_type := coalesce(new.issue_type, 'task');
  new.operational_state := case
    when new.status in ('done', 'cancelled') then 'historical'
    else coalesce(new.operational_state, 'active')
  end;
  return new;
end;
$$;

revoke all on function private.prepare_issue_metadata() from public;

create trigger prepare_todo_issue_metadata
  before insert or update of project_id, issue_number, rank
  on public.todos
  for each row execute function private.prepare_issue_metadata();

-- Keep optimistic versions accurate for direct/import updates to new issue
-- fields as well as the pre-existing todo fields.
create or replace function private.bump_todo_version_for_direct_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.skip_todo_version_bump', true) = 'true' then
    return new;
  end if;

  if new.version = old.version and (
    new.project_id,
    new.todo_list_id,
    new.title,
    new.description,
    new.assigned_to,
    new.due_at,
    new.due_on,
    new.completed_at,
    new.status,
    new.priority,
    new.position,
    new.estimated_minutes,
    new.actual_minutes,
    new.labels,
    new.issue_number,
    new.issue_type,
    new.rank,
    new.operational_state,
    new.sync_status,
    new.basecamp_todo_id,
    new.accelo_task_id,
    new.basecamp_payload,
    new.accelo_payload
  ) is distinct from (
    old.project_id,
    old.todo_list_id,
    old.title,
    old.description,
    old.assigned_to,
    old.due_at,
    old.due_on,
    old.completed_at,
    old.status,
    old.priority,
    old.position,
    old.estimated_minutes,
    old.actual_minutes,
    old.labels,
    old.issue_number,
    old.issue_type,
    old.rank,
    old.operational_state,
    old.sync_status,
    old.basecamp_todo_id,
    old.accelo_task_id,
    old.basecamp_payload,
    old.accelo_payload
  ) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create table public.issue_status_transitions (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  from_status text not null check (
    from_status in (
      'todo',
      'in_progress',
      'blocked',
      'review',
      'done',
      'cancelled'
    )
  ),
  to_status text not null check (
    to_status in (
      'todo',
      'in_progress',
      'blocked',
      'review',
      'done',
      'cancelled'
    )
  ),
  actor_id uuid references public.profiles(id) on delete set null,
  issue_version bigint not null check (issue_version > 0),
  created_at timestamptz not null default now(),
  constraint issue_status_transitions_changed check (from_status <> to_status)
);

create index issue_status_transitions_todo_created_idx
  on public.issue_status_transitions (todo_id, created_at desc, id desc);
create index issue_status_transitions_project_created_idx
  on public.issue_status_transitions (project_id, created_at desc, id desc);
create index issue_status_transitions_actor_idx
  on public.issue_status_transitions (actor_id)
  where actor_id is not null;

alter table public.issue_status_transitions enable row level security;

create policy "Project members can read issue status transitions"
on public.issue_status_transitions
for select
to authenticated
using ((select private.can_access_project(project_id)));

grant select on public.issue_status_transitions
  to authenticated, service_role;

-- This trigger is privileged only so clients cannot forge history rows. It is
-- private, has an empty search path, and exposes no callable public RPC.
create or replace function private.record_issue_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transition_actor_id uuid := (select auth.uid());
begin
  if transition_actor_id is not null and not exists (
    select 1
    from public.profiles as profile
    where profile.id = transition_actor_id
  ) then
    transition_actor_id := null;
  end if;

  insert into public.issue_status_transitions (
    todo_id,
    project_id,
    from_status,
    to_status,
    actor_id,
    issue_version
  )
  values (
    new.id,
    new.project_id,
    old.status,
    new.status,
    transition_actor_id,
    new.version
  );
  return new;
end;
$$;

revoke all on function private.record_issue_status_transition()
  from public, anon, authenticated;

create trigger record_todo_status_transition
  after update of status on public.todos
  for each row
  when (old.status is distinct from new.status)
  execute function private.record_issue_status_transition();

-- Lightweight keyset-paginated issue list. Supporting list/project summaries
-- are computed over the full filtered result, not only the current page.
create or replace function public.get_project_issues_data(
  target_project_id uuid,
  after_rank bigint default null,
  after_issue_number bigint default null,
  after_todo_id uuid default null,
  requested_limit integer default 50,
  status_filters text[] default null,
  priority_filters text[] default null,
  label_filters text[] default null,
  assignee_filter uuid default null,
  unassigned_filter boolean default false,
  due_state_filter text default null,
  text_filter text default null,
  operational_state_filters text[] default array['active', 'triage']::text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select
      greatest(1, least(coalesce(requested_limit, 50), 100)) as page_limit,
      nullif(btrim(text_filter), '') as search_text,
      case
        when coalesce(cardinality(operational_state_filters), 0) = 0
          then array['active', 'triage']::text[]
        else operational_state_filters
      end as operational_filters
  ),
  allowed_project as materialized (
    select project.id, project.code
    from public.projects as project
    where project.id = target_project_id
      and (select private.can_access_project(project.id))
  ),
  project_lists as materialized (
    select list.id, list.project_id, list.title, list.position
    from public.todo_lists as list
    where list.project_id = (select id from allowed_project)
      and not list.is_archived
  ),
  matching_issues as materialized (
    select
      todo.id,
      todo.project_id,
      todo.todo_list_id,
      todo.title,
      todo.assigned_to,
      todo.due_at,
      todo.due_on,
      todo.status,
      todo.priority,
      todo.accelo_task_id,
      todo.issue_number,
      todo.issue_type,
      todo.rank,
      todo.operational_state,
      todo.labels,
      todo.estimated_minutes,
      todo.actual_minutes,
      todo.created_at,
      todo.completed_at,
      todo.source_created_at,
      todo.updated_at,
      todo.position,
      todo.version,
      list.position as list_position,
      project.code as project_code
    from public.todos as todo
    join project_lists as list on list.id = todo.todo_list_id
    join allowed_project as project on project.id = todo.project_id
    cross join settings
    where (
      coalesce(cardinality(status_filters), 0) = 0
      or todo.status = any(status_filters)
    )
      and (
        coalesce(cardinality(priority_filters), 0) = 0
        or todo.priority = any(priority_filters)
      )
      and (
        coalesce(cardinality(label_filters), 0) = 0
        or todo.labels @> label_filters
      )
      and todo.operational_state = any(settings.operational_filters)
      and (
        (
          not unassigned_filter
          and assignee_filter is null
        )
        or (
          not unassigned_filter
          and exists (
            select 1
            from public.todo_assignees as assignment
            where assignment.todo_id = todo.id
              and assignment.profile_id = assignee_filter
          )
        )
        or (
          unassigned_filter
          and not exists (
            select 1
            from public.todo_assignees as assignment
            where assignment.todo_id = todo.id
          )
        )
      )
      and (
        due_state_filter is null
        or (
          due_state_filter = 'overdue'
          and coalesce(todo.due_on, todo.due_at::date) < current_date
          and todo.status not in ('done', 'cancelled')
        )
        or (
          due_state_filter = 'due_today'
          and coalesce(todo.due_on, todo.due_at::date) = current_date
          and todo.status not in ('done', 'cancelled')
        )
        or (
          due_state_filter = 'due_soon'
          and coalesce(todo.due_on, todo.due_at::date)
            between current_date and current_date + 7
          and todo.status not in ('done', 'cancelled')
        )
        or (
          due_state_filter = 'no_due_date'
          and todo.due_on is null
          and todo.due_at is null
        )
        or (
          due_state_filter = 'has_due_date'
          and (todo.due_on is not null or todo.due_at is not null)
        )
      )
      and (
        settings.search_text is null
        or to_tsvector(
          'simple'::regconfig,
          coalesce(todo.title, '') || ' ' || coalesce(todo.description, '')
        ) @@ websearch_to_tsquery('simple'::regconfig, settings.search_text)
        or todo.issue_number::text = settings.search_text
        or lower(project.code || '-' || todo.issue_number::text)
          = lower(settings.search_text)
      )
  ),
  issue_window as materialized (
    select issue.*
    from matching_issues as issue
    cross join settings
    where (
      (
        after_rank is null
        and after_issue_number is null
        and after_todo_id is null
      )
      or (
        after_rank is not null
        and after_issue_number is not null
        and after_todo_id is not null
        and (issue.rank, issue.issue_number, issue.id) >
          (after_rank, after_issue_number, after_todo_id)
      )
    )
    order by issue.rank, issue.issue_number, issue.id
    limit (select page_limit + 1 from settings)
  ),
  issue_page as materialized (
    select issue.*
    from issue_window as issue
    order by issue.rank, issue.issue_number, issue.id
    limit (select page_limit from settings)
  ),
  assignees as (
    select
      assignment.todo_id,
      array_agg(assignment.profile_id order by assignment.profile_id) as profile_ids
    from public.todo_assignees as assignment
    join issue_page as issue on issue.id = assignment.todo_id
    group by assignment.todo_id
  ),
  list_summaries as (
    select
      list.id,
      list.project_id,
      list.title,
      list.position,
      count(issue.id)::bigint as issue_count
    from project_lists as list
    left join matching_issues as issue on issue.todo_list_id = list.id
    group by list.id, list.project_id, list.title, list.position
  ),
  project_summary as (
    select
      count(*)::bigint as total_count,
      count(*) filter (
        where issue.operational_state = 'active'
      )::bigint as active_count,
      count(*) filter (
        where issue.operational_state = 'triage'
      )::bigint as triage_count,
      count(*) filter (
        where issue.operational_state = 'historical'
      )::bigint as historical_count,
      count(*) filter (
        where issue.status = 'blocked'
      )::bigint as blocked_count,
      count(*) filter (
        where coalesce(issue.due_on, issue.due_at::date) < current_date
          and issue.status not in ('done', 'cancelled')
      )::bigint as overdue_count
    from matching_issues as issue
  )
  select jsonb_build_object(
    'todo_lists', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', list.id,
        'project_id', list.project_id,
        'title', list.title,
        'position', list.position,
        'issue_count', list.issue_count
      ) order by list.position, list.id)
      from list_summaries as list
    ), '[]'::jsonb),
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', issue.id,
        'project_id', issue.project_id,
        'todo_list_id', issue.todo_list_id,
        'title', issue.title,
        'assigned_to', issue.assigned_to,
        'assignee_ids', coalesce(assignees.profile_ids, '{}'::uuid[]),
        'due_on', issue.due_on,
        'due_at', issue.due_at,
        'status', issue.status,
        'priority', issue.priority,
        'accelo_task_id', issue.accelo_task_id,
        'issue_key', issue.project_code || '-' || issue.issue_number::text,
        'issue_number', issue.issue_number,
        'issue_type', issue.issue_type,
        'rank', issue.rank,
        'operational_state', issue.operational_state,
        'labels', issue.labels,
        'estimated_minutes', issue.estimated_minutes,
        'actual_minutes', issue.actual_minutes,
        'created_at', issue.created_at,
        'completed_at', issue.completed_at,
        'source_created_at', issue.source_created_at,
        'updated_at', issue.updated_at,
        'position', issue.position,
        'version', issue.version
      ) order by issue.rank, issue.issue_number, issue.id)
      from issue_page as issue
      left join assignees on assignees.todo_id = issue.id
    ), '[]'::jsonb),
    'summary', coalesce((
      select to_jsonb(summary.*)
      from project_summary as summary
    ), jsonb_build_object(
      'total_count', 0,
      'active_count', 0,
      'triage_count', 0,
      'historical_count', 0,
      'blocked_count', 0,
      'overdue_count', 0
    )),
    'has_more', (
      select count(*) > (select page_limit from settings)
      from issue_window
    ),
    'next_cursor', case
      when (
        select count(*) > (select page_limit from settings)
        from issue_window
      ) then (
        select jsonb_build_object(
          'rank', issue.rank::text,
          'issue_number', issue.issue_number::text,
          'id', issue.id
        )
        from issue_page as issue
        order by issue.rank desc, issue.issue_number desc, issue.id desc
        limit 1
      )
      else null
    end
  );
$$;

-- One authorized issue with all child/thread data. List reads deliberately do
-- not include any of these collections.
create or replace function public.get_issue_detail_data(
  target_todo_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with issue as materialized (
    select todo.*, project.code as project_code
    from public.todos as todo
    join public.projects as project on project.id = todo.project_id
    where todo.id = target_todo_id
      and (select private.can_access_project(todo.project_id))
  )
  select case
    when not exists (select 1 from issue) then null
    else jsonb_build_object(
      'issue', (
        select jsonb_build_object(
          'id', todo.id,
          'project_id', todo.project_id,
          'todo_list_id', todo.todo_list_id,
          'title', todo.title,
          'description', todo.description,
          'assigned_to', todo.assigned_to,
          'assignee_ids', coalesce((
            select array_agg(
              assignment.profile_id order by assignment.profile_id
            )
            from public.todo_assignees as assignment
            where assignment.todo_id = todo.id
          ), '{}'::uuid[]),
          'completion_subscriber_ids', coalesce((
            select array_agg(
              subscriber.profile_id order by subscriber.profile_id
            )
            from public.todo_completion_subscribers as subscriber
            where subscriber.todo_id = todo.id
          ), '{}'::uuid[]),
          'due_on', todo.due_on,
          'due_at', todo.due_at,
          'status', todo.status,
          'priority', todo.priority,
          'accelo_task_id', todo.accelo_task_id,
          'issue_key', todo.project_code || '-' || todo.issue_number::text,
          'issue_number', todo.issue_number,
          'issue_type', todo.issue_type,
          'rank', todo.rank,
          'operational_state', todo.operational_state,
          'labels', todo.labels,
          'estimated_minutes', todo.estimated_minutes,
          'actual_minutes', todo.actual_minutes,
          'created_at', todo.created_at,
          'completed_at', todo.completed_at,
          'source_created_at', todo.source_created_at,
          'updated_at', todo.updated_at,
          'position', todo.position,
          'version', todo.version
        )
        from issue as todo
      ),
      'subtasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', subtask.id,
          'todo_id', subtask.todo_id,
          'title', subtask.title,
          'position', subtask.position,
          'completed_at', subtask.completed_at,
          'completed_by', subtask.completed_by,
          'version', subtask.version
        ) order by subtask.position, subtask.id)
        from (
          select item.*
          from public.todo_subtasks as item
          where item.todo_id = (select id from issue)
          order by item.position, item.id
          limit 500
        ) as subtask
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
            select jsonb_agg(jsonb_build_object(
              'profile_id', mention.profile_id
            ) order by mention.profile_id)
            from (
              select item.*
              from public.comment_mentions as item
              where item.comment_id = comment.id
              order by item.profile_id
              limit 50
            ) as mention
          ), '[]'::jsonb),
          'comment_attachments', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', attachment.id,
              'file_id', attachment.file_id,
              'external_url', attachment.external_url,
              'title', coalesce(
                attachment.title,
                file.file_name,
                'Attachment'
              )
            ) order by attachment.created_at, attachment.id)
            from (
              select item.*
              from public.comment_attachments as item
              where item.comment_id = comment.id
              order by item.created_at, item.id
              limit 50
            ) as attachment
            left join public.files as file on file.id = attachment.file_id
          ), '[]'::jsonb)
        ) order by comment.created_at, comment.id)
        from (
          select item.*
          from public.comments as item
          where item.todo_id = (select id from issue)
          order by item.created_at desc, item.id desc
          limit 500
        ) as comment
      ), '[]'::jsonb),
      'transitions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', transition.id,
          'todo_id', transition.todo_id,
          'from_status', transition.from_status,
          'to_status', transition.to_status,
          'actor_id', transition.actor_id,
          'issue_version', transition.issue_version,
          'created_at', transition.created_at
        ) order by transition.created_at, transition.id)
        from (
          select item.*
          from public.issue_status_transitions as item
          where item.todo_id = (select id from issue)
          order by item.created_at desc, item.id desc
          limit 1000
        ) as transition
      ), '[]'::jsonb)
    )
  end;
$$;

-- Existing create callers keep their signature while receiving all issue
-- metadata allocated by the insert trigger.
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
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_result jsonb;
  created_todo public.todos%rowtype;
  project_code text;
begin
  created_result := private.create_project_todo(
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

  select todo.*
  into created_todo
  from public.todos as todo
  where todo.id = (created_result ->> 'id')::uuid;

  if not found then
    raise no_data_found using message = 'Created todo was not readable.';
  end if;

  select project.code
  into project_code
  from public.projects as project
  where project.id = created_todo.project_id;

  return created_result || jsonb_build_object(
    'issue_key', project_code || '-' || created_todo.issue_number::text,
    'issue_number', created_todo.issue_number,
    'issue_type', created_todo.issue_type,
    'rank', created_todo.rank,
    'operational_state', created_todo.operational_state,
    'labels', created_todo.labels,
    'estimated_minutes', created_todo.estimated_minutes,
    'actual_minutes', created_todo.actual_minutes,
    'created_at', created_todo.created_at,
    'completed_at', created_todo.completed_at,
    'source_created_at', created_todo.source_created_at
  );
end;
$$;

-- Rich create variant used by the Jira-style API without changing the legacy
-- signature above.
create or replace function private.create_project_issue(
  target_project_id uuid,
  target_todo_list_id uuid,
  target_title text,
  target_description text,
  target_assignee_ids uuid[],
  target_completion_subscriber_ids uuid[],
  target_due_at timestamptz,
  target_priority text,
  target_issue_type text,
  target_labels text[],
  target_estimated_minutes integer,
  target_actual_minutes integer,
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
  normalized_labels text[];
  prior_result jsonb;
  core_result jsonb;
  created_todo public.todos%rowtype;
  project_code text;
  result jsonb;
begin
  select project.organization_id, project.code
  into target_organization_id, project_code
  from public.projects as project
  where project.id = target_project_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Project not found.';
  end if;

  perform private.project_write_actor(
    target_organization_id,
    requested_actor_id
  );
  if (select auth.role()) = 'authenticated'
    and not (select private.can_access_project(target_project_id))
  then
    raise insufficient_privilege using
      message = 'The authenticated user cannot write to this project.';
  end if;

  if coalesce(target_issue_type, '') not in ('task', 'story', 'bug', 'epic') then
    raise check_violation using message = 'Invalid issue type.';
  end if;
  if target_estimated_minutes is not null and target_estimated_minutes < 0 then
    raise check_violation using message = 'Estimated minutes cannot be negative.';
  end if;
  if target_actual_minutes is not null and target_actual_minutes < 0 then
    raise check_violation using message = 'Actual minutes cannot be negative.';
  end if;

  select coalesce(
    array_agg(label order by first_ordinal),
    '{}'::text[]
  )
  into normalized_labels
  from (
    select btrim(requested.label) as label, min(requested.ordinality) as first_ordinal
    from unnest(coalesce(target_labels, '{}'::text[]))
      with ordinality as requested(label, ordinality)
    group by btrim(requested.label)
  ) as labels
  where char_length(label) between 1 and 50;

  if cardinality(normalized_labels) <> cardinality(
    array(
      select distinct btrim(label)
      from unnest(coalesce(target_labels, '{}'::text[])) as requested(label)
      where char_length(btrim(label)) between 1 and 50
    )
  )
    or cardinality(normalized_labels) > 50
    or exists (
      select 1
      from unnest(coalesce(target_labels, '{}'::text[])) as requested(label)
      where char_length(btrim(label)) not between 1 and 50
    )
  then
    raise check_violation using
      message = 'Issues support at most 50 unique labels of 1 to 50 characters.';
  end if;

  prior_result := private.lock_project_write_request(
    target_organization_id,
    'create_issue',
    target_idempotency_key
  );
  if prior_result is not null then return prior_result; end if;

  core_result := private.create_project_todo(
    target_project_id,
    target_todo_list_id,
    target_title,
    target_description,
    target_assignee_ids,
    target_completion_subscriber_ids,
    target_due_at,
    target_priority,
    requested_actor_id,
    'issue-core-' || pg_catalog.md5(target_idempotency_key)
  );

  perform pg_catalog.set_config('app.skip_todo_version_bump', 'true', true);
  update public.todos as todo
  set
    issue_type = target_issue_type,
    labels = normalized_labels,
    estimated_minutes = target_estimated_minutes,
    actual_minutes = target_actual_minutes
  where todo.id = (core_result ->> 'id')::uuid
  returning todo.* into created_todo;
  perform pg_catalog.set_config('app.skip_todo_version_bump', 'false', true);

  result := core_result || jsonb_build_object(
    'issue_key', project_code || '-' || created_todo.issue_number::text,
    'issue_number', created_todo.issue_number,
    'issue_type', created_todo.issue_type,
    'rank', created_todo.rank,
    'operational_state', created_todo.operational_state,
    'labels', created_todo.labels,
    'estimated_minutes', created_todo.estimated_minutes,
    'actual_minutes', created_todo.actual_minutes,
    'created_at', created_todo.created_at,
    'completed_at', created_todo.completed_at,
    'source_created_at', created_todo.source_created_at,
    'updated_at', created_todo.updated_at,
    'version', created_todo.version
  );

  return private.store_project_write_result(
    target_organization_id,
    'create_issue',
    target_idempotency_key,
    result
  );
end;
$$;

create or replace function public.create_project_issue(
  target_project_id uuid,
  target_todo_list_id uuid,
  target_title text,
  target_description text,
  target_assignee_ids uuid[],
  target_completion_subscriber_ids uuid[],
  target_due_at timestamptz,
  target_priority text,
  target_issue_type text,
  target_labels text[],
  target_estimated_minutes integer,
  target_actual_minutes integer,
  requested_actor_id uuid,
  target_idempotency_key text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_project_issue(
    target_project_id,
    target_todo_list_id,
    target_title,
    target_description,
    target_assignee_ids,
    target_completion_subscriber_ids,
    target_due_at,
    target_priority,
    target_issue_type,
    target_labels,
    target_estimated_minutes,
    target_actual_minutes,
    requested_actor_id,
    target_idempotency_key
  );
$$;

-- Extend the canonical update implementation without changing its signature.
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
  target_project_id uuid;
  project_code text;
  actor_id uuid;
  current_todo public.todos%rowtype;
  updated_todo public.todos%rowtype;
  normalized_assignee_ids uuid[];
  normalized_subscriber_ids uuid[];
  normalized_labels text[];
  requested_profile_ids uuid[];
  valid_profile_count integer;
  prior_result jsonb;
  result jsonb;
begin
  select project.organization_id, project.id, project.code
  into target_organization_id, target_project_id, project_code
  from public.todos as todo
  join public.projects as project on project.id = todo.project_id
  where todo.id = target_todo_id;
  if target_organization_id is null then
    raise no_data_found using message = 'Todo not found.';
  end if;

  actor_id := private.project_write_actor(
    target_organization_id,
    requested_actor_id
  );
  if (select auth.role()) = 'authenticated'
    and not (select private.can_access_project(target_project_id))
  then
    raise insufficient_privilege using
      message = 'The authenticated user cannot write to this project.';
  end if;
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
      'completion_subscriber_ids',
      'issue_type',
      'rank',
      'operational_state',
      'labels',
      'estimated_minutes',
      'actual_minutes'
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
    and char_length(btrim(coalesce(changes ->> 'title', '')))
      not between 1 and 300
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
  if changes ? 'issue_type'
    and coalesce(changes ->> 'issue_type', '')
      not in ('task', 'story', 'bug', 'epic')
  then
    raise check_violation using message = 'Invalid issue type.';
  end if;
  if changes ? 'operational_state'
    and coalesce(changes ->> 'operational_state', '') not in (
      'active',
      'triage',
      'historical'
    )
  then
    raise check_violation using message = 'Invalid operational state.';
  end if;
  if changes ? 'rank' and (
    jsonb_typeof(changes -> 'rank') <> 'number'
    or changes ->> 'rank' !~ '^[1-9][0-9]*$'
  ) then
    raise check_violation using message = 'Issue rank must be a positive integer.';
  end if;
  if changes ? 'estimated_minutes'
    and changes -> 'estimated_minutes' <> 'null'::jsonb
    and (
      jsonb_typeof(changes -> 'estimated_minutes') <> 'number'
      or changes ->> 'estimated_minutes' !~ '^[0-9]+$'
      or (changes ->> 'estimated_minutes')::numeric > 2147483647
    )
  then
    raise check_violation using
      message = 'Estimated minutes must be a non-negative integer.';
  end if;
  if changes ? 'actual_minutes'
    and changes -> 'actual_minutes' <> 'null'::jsonb
    and (
      jsonb_typeof(changes -> 'actual_minutes') <> 'number'
      or changes ->> 'actual_minutes' !~ '^[0-9]+$'
      or (changes ->> 'actual_minutes')::numeric > 2147483647
    )
  then
    raise check_violation using
      message = 'Actual minutes must be a non-negative integer.';
  end if;

  if changes ? 'labels' then
    if jsonb_typeof(changes -> 'labels') <> 'array'
      or jsonb_array_length(changes -> 'labels') > 50
      or exists (
        select 1
        from jsonb_array_elements(changes -> 'labels') as requested(value)
        where jsonb_typeof(requested.value) <> 'string'
          or char_length(btrim(requested.value #>> '{}')) not between 1 and 50
      )
    then
      raise check_violation using
        message = 'Labels must be an array of at most 50 non-empty strings.';
    end if;

    select coalesce(
      array_agg(label order by first_ordinal),
      '{}'::text[]
    )
    into normalized_labels
    from (
      select
        btrim(requested.value) as label,
        min(requested.ordinality) as first_ordinal
      from jsonb_array_elements_text(changes -> 'labels')
        with ordinality as requested(value, ordinality)
      group by btrim(requested.value)
    ) as labels;
  else
    normalized_labels := current_todo.labels;
  end if;

  if changes ? 'assignee_ids' then
    if jsonb_typeof(changes -> 'assignee_ids') <> 'array' then
      raise check_violation using message = 'assignee_ids must be an array.';
    end if;
    select coalesce(
      array_agg(profile_id order by profile_id),
      '{}'::uuid[]
    )
    into normalized_assignee_ids
    from (
      select distinct value::uuid as profile_id
      from jsonb_array_elements_text(changes -> 'assignee_ids')
    ) as normalized;
  else
    select coalesce(
      array_agg(assignment.profile_id order by assignment.profile_id),
      '{}'::uuid[]
    )
    into normalized_assignee_ids
    from public.todo_assignees as assignment
    where assignment.todo_id = target_todo_id;
  end if;

  if changes ? 'completion_subscriber_ids' then
    if jsonb_typeof(changes -> 'completion_subscriber_ids') <> 'array' then
      raise check_violation using
        message = 'completion_subscriber_ids must be an array.';
    end if;
    select coalesce(
      array_agg(profile_id order by profile_id),
      '{}'::uuid[]
    )
    into normalized_subscriber_ids
    from (
      select distinct value::uuid as profile_id
      from jsonb_array_elements_text(changes -> 'completion_subscriber_ids')
    ) as normalized;
  else
    select coalesce(
      array_agg(subscriber.profile_id order by subscriber.profile_id),
      '{}'::uuid[]
    )
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
    raise check_violation using
      message = 'Todos support at most 50 assignees or subscribers.';
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
    issue_type = case when changes ? 'issue_type'
      then changes ->> 'issue_type' else todo.issue_type end,
    rank = case when changes ? 'rank'
      then (changes ->> 'rank')::bigint else todo.rank end,
    operational_state = case
      when coalesce(changes ->> 'status', todo.status)
        in ('done', 'cancelled') then 'historical'
      when changes ? 'operational_state'
        then changes ->> 'operational_state'
      when changes ? 'status' and todo.operational_state = 'historical'
        then 'active'
      else todo.operational_state
    end,
    labels = normalized_labels,
    estimated_minutes = case when changes ? 'estimated_minutes'
      then (changes ->> 'estimated_minutes')::integer
      else todo.estimated_minutes end,
    actual_minutes = case when changes ? 'actual_minutes'
      then (changes ->> 'actual_minutes')::integer
      else todo.actual_minutes end,
    completed_at = case
      when coalesce(changes ->> 'status', todo.status)
        in ('done', 'cancelled') then coalesce(todo.completed_at, now())
      when changes ? 'status' then null
      else todo.completed_at
    end,
    completed_by = case
      when coalesce(changes ->> 'status', todo.status)
        in ('done', 'cancelled') then coalesce(todo.completed_by, actor_id)
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
    'due_on', updated_todo.due_on,
    'due_at', updated_todo.due_at,
    'status', updated_todo.status,
    'priority', updated_todo.priority,
    'position', updated_todo.position,
    'issue_key', project_code || '-' || updated_todo.issue_number::text,
    'issue_number', updated_todo.issue_number,
    'issue_type', updated_todo.issue_type,
    'rank', updated_todo.rank,
    'operational_state', updated_todo.operational_state,
    'labels', updated_todo.labels,
    'estimated_minutes', updated_todo.estimated_minutes,
    'actual_minutes', updated_todo.actual_minutes,
    'created_at', updated_todo.created_at,
    'completed_at', updated_todo.completed_at,
    'source_created_at', updated_todo.source_created_at,
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

revoke all on function public.get_project_issues_data(
  uuid,
  bigint,
  bigint,
  uuid,
  integer,
  text[],
  text[],
  text[],
  uuid,
  boolean,
  text,
  text,
  text[]
) from public, anon;
grant execute on function public.get_project_issues_data(
  uuid,
  bigint,
  bigint,
  uuid,
  integer,
  text[],
  text[],
  text[],
  uuid,
  boolean,
  text,
  text,
  text[]
) to authenticated, service_role;

revoke all on function public.get_issue_detail_data(uuid)
  from public, anon;
grant execute on function public.get_issue_detail_data(uuid)
  to authenticated, service_role;

revoke all on function private.create_project_issue(
  uuid,
  uuid,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  text,
  text,
  text[],
  integer,
  integer,
  uuid,
  text
) from public;
grant execute on function private.create_project_issue(
  uuid,
  uuid,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  text,
  text,
  text[],
  integer,
  integer,
  uuid,
  text
) to authenticated, service_role;

revoke all on function public.create_project_issue(
  uuid,
  uuid,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  text,
  text,
  text[],
  integer,
  integer,
  uuid,
  text
) from public, anon;
grant execute on function public.create_project_issue(
  uuid,
  uuid,
  text,
  text,
  uuid[],
  uuid[],
  timestamptz,
  text,
  text,
  text[],
  integer,
  integer,
  uuid,
  text
) to authenticated, service_role;
