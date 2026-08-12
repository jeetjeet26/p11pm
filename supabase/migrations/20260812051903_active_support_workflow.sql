-- First-class active support built as an organization-scoped extension of the
-- canonical Jira-style todo/issue model. Accelo remains a GET-only source.

create table public.support_tickets (
  todo_id uuid primary key references public.todos(id) on delete cascade,
  id uuid generated always as (todo_id) stored unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  requester_contact_id uuid,
  retainer_id uuid,
  source_provider text not null default 'p11'
    check (source_provider in ('p11', 'accelo', 'email', 'api')),
  external_id text,
  source_status text,
  source_url text,
  opened_at timestamptz not null default now(),
  first_response_due_at timestamptz,
  first_response_at timestamptz,
  resolution_due_at timestamptz,
  last_customer_message_at timestamptz,
  last_team_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  source_updated_at timestamptz,
  source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, todo_id),
  foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete restrict,
  foreign key (organization_id, requester_contact_id)
    references public.contacts(organization_id, id) on delete set null,
  foreign key (organization_id, retainer_id)
    references public.retainers(organization_id, id) on delete set null,
  constraint support_tickets_source_identity check (
    (source_provider = 'p11' and external_id is null)
    or (source_provider <> 'p11' and nullif(btrim(external_id), '') is not null)
  ),
  constraint support_tickets_response_times check (
    first_response_at is null or first_response_at >= opened_at
  ),
  constraint support_tickets_resolution_times check (
    (resolved_at is null or resolved_at >= opened_at)
    and (closed_at is null or closed_at >= opened_at)
  )
);

create unique index support_tickets_source_key
  on public.support_tickets (organization_id, source_provider, external_id)
  where external_id is not null;
create index support_tickets_queue_idx
  on public.support_tickets (
    organization_id, closed_at, first_response_due_at, resolution_due_at,
    opened_at desc, todo_id
  );
create index support_tickets_client_opened_idx
  on public.support_tickets (client_id, opened_at desc, todo_id);
create index support_tickets_requester_idx
  on public.support_tickets (requester_contact_id, opened_at desc)
  where requester_contact_id is not null;
create index support_tickets_search_idx
  on public.support_tickets using gin (
    to_tsvector(
      'simple',
      coalesce(source_status, '') || ' ' || coalesce(external_id, '')
    )
  );

-- Named constraints avoid PL/pgSQL variable/column ambiguity in the promotion
-- function's conflict targets.
alter table public.todos
  add constraint todos_project_accelo_issue_unique
  unique (project_id, accelo_issue_id);

create trigger set_support_tickets_updated_at
  before update on public.support_tickets
  for each row execute function private.set_updated_at();

alter table public.support_tickets enable row level security;

create policy "Support readers can read tickets"
on public.support_tickets for select to authenticated
using (
  (select private.has_organization_permission(
    organization_id, 'support.read'
  ))
);

create policy "Support writers can manage tickets"
on public.support_tickets for all to authenticated
using (
  (select private.has_organization_permission(
    organization_id, 'support.write'
  ))
)
with check (
  (select private.has_organization_permission(
    organization_id, 'support.write'
  ))
);

grant select on public.support_tickets to authenticated;
grant all on public.support_tickets to service_role;

-- Support agents use the same issue, comment, and transition records without
-- needing membership in the system-owned support project.
create policy "Support readers can read the system support project"
on public.projects for select to authenticated
using (
  metadata ->> 'system_kind' = 'support_queue'
  and private.has_organization_permission(
    organization_id, 'support.read'
  )
);

create policy "Support readers can read support issue cores"
on public.todos for select to authenticated
using (
  exists (
    select 1
    from public.support_tickets as ticket
    where ticket.todo_id = id
      and private.has_organization_permission(
        ticket.organization_id, 'support.read'
      )
  )
);

create policy "Support readers can read support comments"
on public.comments for select to authenticated
using (
  todo_id is not null
  and exists (
    select 1
    from public.support_tickets as ticket
    where ticket.todo_id = comments.todo_id
      and private.has_organization_permission(
        ticket.organization_id, 'support.read'
      )
  )
);

create policy "Support readers can read support transitions"
on public.issue_status_transitions for select to authenticated
using (
  exists (
    select 1
    from public.support_tickets as ticket
    where ticket.todo_id = issue_status_transitions.todo_id
      and private.has_organization_permission(
        ticket.organization_id, 'support.read'
      )
  )
);

create or replace function private.can_access_todo(target_todo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.todos as todo
    where todo.id = target_todo_id
      and (
        (select private.can_access_project(todo.project_id))
        or exists (
          select 1
          from public.support_tickets as ticket
          where ticket.todo_id = todo.id
            and private.has_organization_permission(
              ticket.organization_id, 'support.read'
            )
        )
      )
  );
$$;

create or replace function private.can_access_comment(target_comment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.comments as comment
    where comment.id = target_comment_id
      and (
        (select private.can_access_project(comment.project_id))
        or (
          comment.todo_id is not null
          and (select private.can_access_todo(comment.todo_id))
        )
      )
  );
$$;

-- Managers operate support by default. Explicit grants can delegate either
-- read-only or agent access to other active workspace members.
create or replace function private.has_organization_permission(
  target_organization_id uuid,
  target_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      profile.organization_id = target_organization_id
      and profile.status = 'active'
      and (
        profile.role = 'admin'
        or coalesce((profile.permissions ->> target_permission)::boolean, false)
        or (
          profile.role = 'manager'
          and target_permission in (
            'commercial.read',
            'commercial.write',
            'time.approve',
            'pipeline.write',
            'support.read',
            'support.write'
          )
        )
      )
    from public.profiles as profile
    where profile.id = (select auth.uid())
  ), false);
$$;

create or replace function private.update_workspace_profile_permissions(
  target_profile_id uuid,
  target_permissions jsonb
)
returns public.profiles
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  result public.profiles%rowtype;
begin
  if not (select private.is_workspace_admin()) then
    raise insufficient_privilege using
      message = 'Workspace administrator access is required.';
  end if;
  if jsonb_typeof(target_permissions) <> 'object'
    or exists (
      select 1
      from jsonb_each(target_permissions) as item
      where item.key not in (
        'commercial.read',
        'commercial.write',
        'time.approve',
        'pipeline.write',
        'support.read',
        'support.write'
      )
        or jsonb_typeof(item.value) <> 'boolean'
    )
  then
    raise check_violation using message = 'Invalid workspace permissions.';
  end if;
  update public.profiles as profile
  set permissions = target_permissions,
      updated_at = now()
  where profile.id = target_profile_id
    and profile.organization_id =
      (select private.current_workspace_organization_id())
  returning profile.* into result;
  if result.id is null then
    raise no_data_found using message = 'Workspace profile not found.';
  end if;
  return result;
end;
$$;

-- Source correspondence uses the existing comment model. Expression identity
-- makes repeated incremental imports idempotent.
create unique index comments_source_identity_key
  on public.comments (
    project_id,
    (metadata ->> 'source_provider'),
    (metadata ->> 'external_id')
  )
  where metadata ? 'source_provider' and metadata ? 'external_id';

create or replace function private.sync_accelo_support_activity(
  target_activity_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  activity public.client_activities%rowtype;
  ticket public.support_tickets%rowtype;
  target_source_issue_id text;
  target_project_id uuid;
begin
  select item.* into activity
  from public.client_activities as item
  where item.id = target_activity_id
    and item.source = 'accelo';
  if activity.id is null then return; end if;

  if lower(coalesce(activity.source_payload ->> 'against_type', '')) <> 'issue'
  then return; end if;
  target_source_issue_id := regexp_replace(
    coalesce(
      activity.source_payload ->> 'against_id',
      activity.source_payload #>> '{against,id}',
      ''
    ),
    '^.*/',
    ''
  );
  if target_source_issue_id = '' then return; end if;

  select support.* into ticket
  from public.support_tickets as support
  where support.organization_id = activity.organization_id
    and support.source_provider = 'accelo'
    and support.external_id = target_source_issue_id;
  if ticket.todo_id is null then return; end if;
  select todo.project_id into target_project_id
  from public.todos as todo where todo.id = ticket.todo_id;

  insert into public.comments (
    project_id, todo_id, author_id, body, metadata, created_at, updated_at
  )
  values (
    target_project_id,
    ticket.todo_id,
    activity.created_by,
    coalesce(
      nullif(btrim(activity.body), ''),
      nullif(btrim(activity.subject), ''),
      'Accelo support activity'
    ),
    jsonb_build_object(
      'source_provider', 'accelo',
      'external_id', activity.external_id,
      'direction', activity.direction,
      'activity_type', activity.activity_type,
      'contact_id', activity.contact_id
    ),
    activity.occurred_at,
    coalesce(activity.source_updated_at, activity.occurred_at)
  )
  on conflict (
    project_id,
    (metadata ->> 'source_provider'),
    (metadata ->> 'external_id')
  ) where metadata ? 'source_provider' and metadata ? 'external_id'
  do update set
    body = excluded.body,
    metadata = excluded.metadata,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function private.sync_accelo_support_activity_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sync_accelo_support_activity(new.id);
  return new;
end;
$$;

create trigger sync_accelo_support_activity
  after insert or update of body, subject, occurred_at, source_payload
  on public.client_activities
  for each row
  when (new.source = 'accelo')
  execute function private.sync_accelo_support_activity_trigger();

create or replace function private.sync_accelo_support_ticket_activities_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_id uuid;
begin
  if new.provider <> 'accelo'
    or new.source_entity_type <> 'issues'
    or new.source_deleted
  then return new; end if;
  for activity_id in
    select activity.id
    from public.client_activities as activity
    where activity.organization_id = new.organization_id
      and activity.source = 'accelo'
      and lower(coalesce(activity.source_payload ->> 'against_type', '')) = 'issue'
      and regexp_replace(
        coalesce(
          activity.source_payload ->> 'against_id',
          activity.source_payload #>> '{against,id}',
          ''
        ),
        '^.*/',
        ''
      ) = new.source_record_id
  loop
    perform private.sync_accelo_support_activity(activity_id);
  end loop;
  return new;
end;
$$;

create trigger sync_accelo_support_ticket_activities
  after insert or update of destination_record_id, source_deleted
  on public.source_records
  for each row execute function private.sync_accelo_support_ticket_activities_trigger();

create or replace function public.get_support_queue(
  requested_limit integer default 100,
  status_filters text[] default null,
  priority_filters text[] default null,
  owner_filter uuid default null,
  client_filter uuid default null,
  sla_filter text default null,
  text_filter text default null,
  include_closed boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with authorized as materialized (
    select private.current_organization_id() as organization_id
    where private.has_organization_permission(
      private.current_organization_id(), 'support.read'
    )
  ),
  matching as materialized (
    select
      ticket.todo_id,
      ticket.client_id,
      ticket.requester_contact_id,
      ticket.source_provider,
      ticket.external_id,
      ticket.source_status,
      ticket.opened_at,
      ticket.first_response_due_at,
      ticket.first_response_at,
      ticket.resolution_due_at,
      ticket.last_customer_message_at,
      ticket.last_team_response_at,
      ticket.resolved_at,
      ticket.closed_at,
      todo.title,
      todo.description,
      todo.status,
      todo.priority,
      todo.assigned_to,
      todo.version,
      todo.updated_at,
      client.name as client_name,
      nullif(btrim(concat_ws(' ', contact.first_name, contact.last_name)), '')
        as requester_name,
      contact.email as requester_email,
      owner.full_name as owner_name,
      project.code || '-' || todo.issue_number::text as issue_key,
      case
        when todo.status in ('done', 'cancelled') then 'closed'
        when ticket.first_response_at is null
          and ticket.first_response_due_at < statement_timestamp()
          then 'response_breached'
        when ticket.resolution_due_at < statement_timestamp()
          then 'resolution_breached'
        when ticket.first_response_at is null
          and ticket.first_response_due_at <
            statement_timestamp() + interval '4 hours'
          then 'response_at_risk'
        when ticket.resolution_due_at <
          statement_timestamp() + interval '1 day'
          then 'resolution_at_risk'
        else 'on_track'
      end as sla_state
    from public.support_tickets as ticket
    join authorized on authorized.organization_id = ticket.organization_id
    join public.todos as todo on todo.id = ticket.todo_id
    join public.projects as project on project.id = todo.project_id
    join public.clients as client on client.id = ticket.client_id
    left join public.contacts as contact
      on contact.id = ticket.requester_contact_id
    left join public.profiles as owner on owner.id = todo.assigned_to
    where (
      include_closed
      or todo.status not in ('done', 'cancelled')
    )
      and (
        coalesce(cardinality(status_filters), 0) = 0
        or todo.status = any(status_filters)
      )
      and (
        coalesce(cardinality(priority_filters), 0) = 0
        or todo.priority = any(priority_filters)
      )
      and (owner_filter is null or todo.assigned_to = owner_filter)
      and (client_filter is null or ticket.client_id = client_filter)
      and (
        nullif(btrim(text_filter), '') is null
        or todo.title ilike '%' || btrim(text_filter) || '%'
        or coalesce(todo.description, '') ilike '%' || btrim(text_filter) || '%'
        or client.name ilike '%' || btrim(text_filter) || '%'
        or coalesce(contact.first_name, '') || ' ' ||
          coalesce(contact.last_name, '') ilike '%' || btrim(text_filter) || '%'
        or ticket.external_id = btrim(text_filter)
      )
  ),
  filtered as (
    select *
    from matching
    where sla_filter is null
      or sla_filter = 'all'
      or sla_state = sla_filter
      or (sla_filter = 'breached' and sla_state like '%_breached')
      or (sla_filter = 'at_risk' and sla_state like '%_at_risk')
  ),
  page as (
    select *
    from filtered
    order by
      case sla_state
        when 'response_breached' then 0
        when 'resolution_breached' then 1
        when 'response_at_risk' then 2
        when 'resolution_at_risk' then 3
        else 4
      end,
      priority desc,
      opened_at,
      todo_id
    limit greatest(1, least(coalesce(requested_limit, 100), 250))
  )
  select jsonb_build_object(
    'tickets', coalesce(
      (select jsonb_agg(to_jsonb(item.*)) from page as item),
      '[]'::jsonb
    ),
    'summary', jsonb_build_object(
      'open', (select count(*) from matching where status not in ('done', 'cancelled')),
      'unassigned', (select count(*) from matching where assigned_to is null),
      'breached', (select count(*) from matching where sla_state like '%_breached'),
      'at_risk', (select count(*) from matching where sla_state like '%_at_risk'),
      'closed', (select count(*) from matching where status in ('done', 'cancelled'))
    )
  );
$$;

create or replace function public.get_support_ticket_detail(target_todo_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ticket as materialized (
    select
      support.*,
      todo.project_id,
      todo.title,
      todo.description,
      todo.status,
      todo.priority,
      todo.assigned_to,
      todo.issue_number,
      todo.version,
      todo.updated_at,
      project.code || '-' || todo.issue_number::text as issue_key,
      client.name as client_name,
      client.status as client_status,
      nullif(btrim(concat_ws(' ', contact.first_name, contact.last_name)), '')
        as requester_name,
      contact.email as requester_email,
      contact.phone as requester_phone,
      owner.full_name as owner_name,
      owner.email as owner_email
    from public.support_tickets as support
    join public.todos as todo on todo.id = support.todo_id
    join public.projects as project on project.id = todo.project_id
    join public.clients as client on client.id = support.client_id
    left join public.contacts as contact
      on contact.id = support.requester_contact_id
    left join public.profiles as owner on owner.id = todo.assigned_to
    where support.todo_id = target_todo_id
      and private.has_organization_permission(
        support.organization_id, 'support.read'
      )
  )
  select case when not exists (select 1 from ticket) then null else
    jsonb_build_object(
      'ticket', (select to_jsonb(ticket.*) from ticket),
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', comment.id,
          'author_id', comment.author_id,
          'author_name', profile.full_name,
          'body', comment.body,
          'metadata', comment.metadata,
          'created_at', comment.created_at,
          'updated_at', comment.updated_at
        ) order by comment.created_at, comment.id)
        from public.comments as comment
        left join public.profiles as profile on profile.id = comment.author_id
        where comment.todo_id = target_todo_id
      ), '[]'::jsonb),
      'transitions', coalesce((
        select jsonb_agg(to_jsonb(transition.*)
          order by transition.created_at, transition.id)
        from public.issue_status_transitions as transition
        where transition.todo_id = target_todo_id
      ), '[]'::jsonb)
    )
  end;
$$;

create or replace function private.update_support_ticket(
  target_todo_id uuid,
  expected_version bigint,
  changes jsonb,
  requested_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets%rowtype;
  todo public.todos%rowtype;
  next_owner uuid;
  next_status text;
begin
  select support.* into ticket
  from public.support_tickets as support
  where support.todo_id = target_todo_id
  for update;
  if ticket.todo_id is null then
    raise no_data_found using message = 'Support ticket not found.';
  end if;
  if requested_actor_id is distinct from (select auth.uid())
    or not private.has_organization_permission(
      ticket.organization_id, 'support.write'
    )
  then
    raise insufficient_privilege using
      message = 'Support agent access is required.';
  end if;
  if jsonb_typeof(changes) <> 'object'
    or changes = '{}'::jsonb
    or (changes - array['status', 'priority', 'owner_id']) <> '{}'::jsonb
  then
    raise check_violation using message = 'Unsupported support ticket changes.';
  end if;

  select item.* into todo
  from public.todos as item where item.id = target_todo_id for update;
  if todo.version <> expected_version then
    raise serialization_failure using
      message = format(
        'Support ticket version conflict: expected %s, current %s.',
        expected_version, todo.version
      );
  end if;
  next_status := coalesce(changes ->> 'status', todo.status);
  if next_status not in (
    'todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled'
  ) then
    raise check_violation using message = 'Invalid support ticket status.';
  end if;
  if changes ? 'priority'
    and changes ->> 'priority' not in ('low', 'medium', 'high', 'urgent')
  then
    raise check_violation using message = 'Invalid support ticket priority.';
  end if;
  if changes ? 'owner_id' and changes -> 'owner_id' <> 'null'::jsonb then
    next_owner := (changes ->> 'owner_id')::uuid;
    if not exists (
      select 1 from public.profiles as profile
      where profile.id = next_owner
        and profile.organization_id = ticket.organization_id
        and profile.status = 'active'
    ) then
      raise check_violation using message = 'Support owner must be active.';
    end if;
  elsif changes ? 'owner_id' then
    next_owner := null;
  else
    next_owner := todo.assigned_to;
  end if;

  update public.todos as item
  set
    status = next_status,
    priority = coalesce(changes ->> 'priority', item.priority),
    assigned_to = next_owner,
    operational_state = case
      when next_status in ('done', 'cancelled') then 'historical'
      else 'active'
    end,
    completed_at = case
      when next_status in ('done', 'cancelled')
        then coalesce(item.completed_at, statement_timestamp())
      else null
    end,
    completed_by = case
      when next_status in ('done', 'cancelled')
        then coalesce(item.completed_by, requested_actor_id)
      else null
    end,
    version = item.version + 1,
    updated_at = statement_timestamp()
  where item.id = target_todo_id
  returning item.* into todo;

  delete from public.todo_assignees where todo_id = target_todo_id;
  if next_owner is not null then
    insert into public.todo_assignees (todo_id, profile_id, assigned_by)
    values (target_todo_id, next_owner, requested_actor_id);
  end if;
  update public.support_tickets
  set
    resolved_at = case
      when next_status in ('done', 'cancelled')
        then coalesce(resolved_at, statement_timestamp())
      else null
    end,
    closed_at = case
      when next_status in ('done', 'cancelled')
        then coalesce(closed_at, statement_timestamp())
      else null
    end
  where todo_id = target_todo_id;

  if next_owner is not null then
    insert into public.workspace_inbox_items (
      organization_id, recipient_id, actor_id, project_id, kind, title,
      body, href, source_type, source_id, priority
    )
    values (
      ticket.organization_id, next_owner, requested_actor_id, todo.project_id,
      'support_ticket', todo.title, 'Support ticket assigned to you.',
      '/support/' || todo.id::text, 'support_ticket', todo.id::text,
      case when todo.priority = 'medium' then 'normal' else todo.priority end
    )
    on conflict (recipient_id, kind, source_type, source_id)
    do update set
      title = excluded.title,
      body = excluded.body,
      priority = excluded.priority,
      completed_at = null,
      snoozed_until = null,
      updated_at = statement_timestamp();
  end if;
  return to_jsonb(todo);
end;
$$;

create or replace function public.update_support_ticket(
  target_todo_id uuid,
  expected_version bigint,
  changes jsonb,
  requested_actor_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_support_ticket(
    target_todo_id, expected_version, changes, requested_actor_id
  );
$$;

create or replace function private.add_support_ticket_comment(
  target_todo_id uuid,
  target_body text,
  requested_actor_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets%rowtype;
  target_project_id uuid;
  created public.comments%rowtype;
begin
  select support.* into ticket
  from public.support_tickets as support
  where support.todo_id = target_todo_id;
  if ticket.todo_id is null then
    raise no_data_found using message = 'Support ticket not found.';
  end if;
  if requested_actor_id is distinct from (select auth.uid())
    or not private.has_organization_permission(
      ticket.organization_id, 'support.write'
    )
  then
    raise insufficient_privilege using
      message = 'Support agent access is required.';
  end if;
  if char_length(btrim(coalesce(target_body, ''))) not between 1 and 10000 then
    raise check_violation using message = 'Comment must be 1 to 10000 characters.';
  end if;
  select project_id into target_project_id
  from public.todos where id = target_todo_id;
  insert into public.comments (
    project_id, todo_id, author_id, body, metadata
  )
  values (
    target_project_id, target_todo_id, requested_actor_id, btrim(target_body),
    '{"source_provider":"p11","direction":"internal"}'::jsonb
  )
  returning * into created;
  update public.support_tickets
  set
    first_response_at = coalesce(first_response_at, statement_timestamp()),
    last_team_response_at = statement_timestamp()
  where todo_id = target_todo_id;
  return to_jsonb(created);
end;
$$;

create or replace function public.add_support_ticket_comment(
  target_todo_id uuid,
  target_body text,
  requested_actor_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.add_support_ticket_comment(
    target_todo_id, target_body, requested_actor_id
  );
$$;

revoke all on function public.get_support_queue(
  integer, text[], text[], uuid, uuid, text, text, boolean
) from public, anon;
grant execute on function public.get_support_queue(
  integer, text[], text[], uuid, uuid, text, text, boolean
) to authenticated, service_role;
revoke all on function public.get_support_ticket_detail(uuid) from public, anon;
grant execute on function public.get_support_ticket_detail(uuid)
  to authenticated, service_role;
revoke all on function private.update_support_ticket(uuid, bigint, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function private.update_support_ticket(uuid, bigint, jsonb, uuid)
  to authenticated, service_role;
revoke all on function public.update_support_ticket(uuid, bigint, jsonb, uuid)
  from public, anon;
grant execute on function public.update_support_ticket(uuid, bigint, jsonb, uuid)
  to authenticated, service_role;
revoke all on function private.add_support_ticket_comment(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function private.add_support_ticket_comment(uuid, text, uuid)
  to authenticated, service_role;
revoke all on function public.add_support_ticket_comment(uuid, text, uuid)
  from public, anon;
grant execute on function public.add_support_ticket_comment(uuid, text, uuid)
  to authenticated, service_role;

alter table public.workspace_inbox_items
  drop constraint workspace_inbox_items_kind_check,
  add constraint workspace_inbox_items_kind_check check (
    kind in (
      'mention', 'assignment', 'thread_reply', 'approval', 'due', 'overdue',
      'blocker', 'watch', 'automation', 'integration', 'file_share',
      'file_comment', 'support_ticket'
    )
  );

-- Repoint Accelo issue promotion from per-client completed projects to one
-- active support queue per organization while retaining todos as issue cores.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  updated_definition := original_definition;

  updated_definition := replace(
    updated_definition,
$old$        when 'issues' then
          client_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'companies',
            payload ->> 'company_source_id', 'clients'
          );
          if client_id is null then
            raise foreign_key_violation using message = 'issue_company_missing';
          end if;
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'owner_source_id', 'profiles'
          );
          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          select item.id into project_id
          from public.projects as item
          where item.organization_id = run.organization_id
            and item.code = left(
              regexp_replace(
                upper('SUP-' || payload ->> 'company_source_id'),
                '[^A-Z0-9-]+', '-', 'g'
              ),
              32
            );
          if project_id is null then
            insert into public.projects (
              organization_id, name, code, client_id, client_name, status,
              billing_type, currency, commercial_currency, description
            )
            select
              run.organization_id,
              client.name || ' Support',
              left(
                regexp_replace(
                  upper('SUP-' || payload ->> 'company_source_id'),
                  '[^A-Z0-9-]+', '-', 'g'
                ),
                32
              ),
              client.id,
              client.name,
              case when payload ->> 'status' = 'done'
                then 'completed' else 'active' end,
              'internal',
              client.default_currency,
              client.default_currency,
              'Accelo support issues with source-faithful open and closed state.'
            from public.clients as client
            where client.id = client_id
            returning id into project_id;
          end if;
          insert into public.todo_lists (project_id, title, position)
          values (project_id, 'Imported support issues', 0)
          on conflict (project_id, title) do update set title = excluded.title
          returning id into list_id;
          insert into public.todos (
            project_id, todo_list_id, title, description, status, priority,
            due_at, completed_at, assigned_to, accelo_issue_id,
            sync_status, last_synced_at, accelo_payload, source_updated_at,
            operational_state
          )
          values (
            project_id, list_id, payload ->> 'title',
            nullif(payload ->> 'description', ''),
            coalesce(payload ->> 'status', 'done'),
            coalesce(payload ->> 'priority', 'medium'),
            nullif(payload ->> 'due_at', '')::timestamptz,
            case when payload ->> 'status' = 'done'
              then coalesce(
                nullif(payload ->> 'completed_at', '')::timestamptz,
                now()
              )
              else null
            end,
            profile_id, stage.source_record_id, 'synced', now(),
            stage.raw_payload, stage.source_updated_at,
            case when payload ->> 'status' = 'done'
              then 'historical' else 'active' end
          )
          on conflict (project_id, accelo_issue_id)
            where accelo_issue_id is not null
          do update set
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            priority = excluded.priority,
            assigned_to = excluded.assigned_to,
            due_at = excluded.due_at,
            completed_at = excluded.completed_at,
            sync_status = 'synced',
            last_synced_at = now(),
            accelo_payload = excluded.accelo_payload,
            source_updated_at = excluded.source_updated_at,
            operational_state = excluded.operational_state,
            updated_at = now()
          returning id into destination_id;$old$,
$new$        when 'issues' then
          client_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'companies',
            payload ->> 'company_source_id', 'clients'
          );
          if client_id is null then
            raise foreign_key_violation using message = 'issue_company_missing';
          end if;
          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          if contact_id is null and nullif(payload ->> 'affiliation_source_id', '') is not null then
            select link.contact_id into contact_id
            from public.client_contacts as link
            where link.id = private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'affiliations',
              payload ->> 'affiliation_source_id', 'client_contacts'
            );
          end if;
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'owner_source_id', 'profiles'
          );
          retainer_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contracts',
            payload ->> 'contract_source_id', 'retainers'
          );
          select item.id into project_id
          from public.projects as item
          where item.organization_id = run.organization_id
            and item.metadata ->> 'system_kind' = 'support_queue'
          order by item.created_at
          limit 1;
          if project_id is null then
            insert into public.projects (
              organization_id, name, code, status, billing_type, currency,
              commercial_currency, description, metadata
            )
            values (
              run.organization_id, 'P11 Support', 'P11-SUPPORT', 'active',
              'internal', 'USD', 'USD',
              'Organization-wide active and historical client support tickets.',
              '{"system_kind":"support_queue","source_system":"support"}'::jsonb
            )
            on conflict (organization_id, code) do update
            set
              status = 'active',
              metadata = public.projects.metadata ||
                '{"system_kind":"support_queue","source_system":"support"}'::jsonb,
              updated_at = statement_timestamp()
            returning id into project_id;
          end if;
          insert into public.todo_lists (project_id, title, position)
          values (project_id, 'Support tickets', 0)
          on conflict on constraint todo_lists_project_id_title_key
          do update set title = excluded.title
          returning id into list_id;
          insert into public.todos (
            project_id, todo_list_id, title, description, status, priority,
            assigned_to, due_at, completed_at, accelo_issue_id, sync_status,
            last_synced_at, accelo_payload, source_created_at,
            source_updated_at, imported_at, operational_state, issue_type
          )
          values (
            project_id, list_id,
            coalesce(nullif(payload ->> 'title', ''), 'Accelo support issue'),
            nullif(payload ->> 'description', ''),
            coalesce(payload ->> 'status', 'todo'),
            coalesce(payload ->> 'priority', 'medium'),
            profile_id,
            nullif(
              coalesce(
                payload ->> 'resolution_due_at',
                payload ->> 'due_at'
              ),
              ''
            )::timestamptz,
            case when coalesce(payload ->> 'status', 'todo')
              in ('done', 'cancelled')
              then coalesce(
                nullif(payload ->> 'closed_at', '')::timestamptz,
                nullif(payload ->> 'resolved_at', '')::timestamptz,
                nullif(payload ->> 'completed_at', '')::timestamptz,
                stage.source_updated_at
              )
              else null
            end,
            stage.source_record_id, 'synced', statement_timestamp(),
            stage.raw_payload,
            coalesce(
              nullif(payload ->> 'opened_at', '')::timestamptz,
              stage.source_updated_at
            ),
            stage.source_updated_at, statement_timestamp(),
            case when coalesce(payload ->> 'status', 'todo')
              in ('done', 'cancelled') then 'historical' else 'active' end,
            'bug'
          )
          on conflict on constraint todos_project_accelo_issue_unique
          do update set
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            priority = excluded.priority,
            assigned_to = excluded.assigned_to,
            due_at = excluded.due_at,
            completed_at = excluded.completed_at,
            sync_status = 'synced',
            last_synced_at = statement_timestamp(),
            accelo_payload = excluded.accelo_payload,
            source_updated_at = excluded.source_updated_at,
            operational_state = excluded.operational_state,
            updated_at = statement_timestamp()
          returning id into destination_id;
          insert into public.support_tickets (
            todo_id, organization_id, client_id, requester_contact_id,
            retainer_id, source_provider, external_id, source_status,
            source_url, opened_at, first_response_due_at, first_response_at,
            resolution_due_at, last_customer_message_at,
            last_team_response_at, resolved_at, closed_at,
            source_updated_at, source_payload
          )
          values (
            destination_id, run.organization_id, client_id, contact_id,
            retainer_id, 'accelo', stage.source_record_id,
            nullif(payload ->> 'source_status', ''),
            nullif(payload ->> 'source_url', ''),
            coalesce(
              nullif(payload ->> 'opened_at', '')::timestamptz,
              stage.source_updated_at,
              statement_timestamp()
            ),
            nullif(payload ->> 'first_response_due_at', '')::timestamptz,
            nullif(payload ->> 'first_response_at', '')::timestamptz,
            nullif(
              coalesce(payload ->> 'resolution_due_at', payload ->> 'due_at'),
              ''
            )::timestamptz,
            nullif(payload ->> 'last_customer_message_at', '')::timestamptz,
            nullif(payload ->> 'last_team_response_at', '')::timestamptz,
            nullif(payload ->> 'resolved_at', '')::timestamptz,
            coalesce(
              nullif(payload ->> 'closed_at', '')::timestamptz,
              nullif(payload ->> 'completed_at', '')::timestamptz
            ),
            stage.source_updated_at, stage.raw_payload
          )
          on conflict (todo_id) do update set
            client_id = excluded.client_id,
            requester_contact_id = excluded.requester_contact_id,
            retainer_id = excluded.retainer_id,
            source_status = excluded.source_status,
            source_url = excluded.source_url,
            opened_at = excluded.opened_at,
            first_response_due_at = excluded.first_response_due_at,
            first_response_at = excluded.first_response_at,
            resolution_due_at = excluded.resolution_due_at,
            last_customer_message_at = excluded.last_customer_message_at,
            last_team_response_at = excluded.last_team_response_at,
            resolved_at = excluded.resolved_at,
            closed_at = excluded.closed_at,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload;
          delete from public.todo_assignees
          where todo_id = destination_id;
          if profile_id is not null then
            insert into public.todo_assignees (todo_id, profile_id)
            values (destination_id, profile_id)
            on conflict do nothing;
          end if;$new$
  );

  updated_definition := replace(
    updated_definition,
    $old$when 'issues' then 'todos'$old$,
    $new$when 'issues' then 'support_tickets'$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$payload ->> 'against_source_id', 'todos'$old$,
    $new$payload ->> 'against_source_id', 'support_tickets'$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$  authority_state text;
begin$old$,
    $new$  authority_state text;
  error_context text;
begin$new$
  );
  updated_definition := replace(
    updated_definition,
    $old$    exception
      when others then
        insert into public.accelo_unresolved_dependencies ($old$,
    $new$    exception
      when others then
        get stacked diagnostics error_context = pg_exception_context;
        insert into public.accelo_unresolved_dependencies ($new$
  );
  updated_definition := replace(
    updated_definition,
    $old$          left(sqlstate || ':' || sqlerrm, 2000),$old$,
    $new$          left(
            sqlstate || ':' || sqlerrm || E'\n' || error_context,
            2000
          ),$new$
  );
  if updated_definition = original_definition
    or updated_definition not like '%insert into public.support_tickets%'
    or updated_definition like '%per-client completed projects%'
  then
    raise exception 'Accelo support promotion rewrite did not match.';
  end if;
  execute updated_definition;
end;
$migration$;

-- Source reconciliation and rollback must recognize the extension table as the
-- issue destination. Todos keep their own journal entries for exact rollback.
create trigger guard_accelo_authority_support_tickets
  before insert or update or delete on public.support_tickets
  for each row execute function private.guard_accelo_native_write('issues');
create trigger journal_accelo_promotion_support_tickets
  after insert or update or delete on public.support_tickets
  for each row execute function private.journal_accelo_promotion('issues');

create or replace function private.accelo_destination_exists(
  target_table text,
  target_record_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result boolean;
begin
  if target_table not in (
    'clients', 'contacts', 'profiles', 'client_contacts', 'projects',
    'retainers', 'retainer_periods', 'client_activities', 'invoices',
    'payments', 'prospects', 'milestones', 'todos', 'support_tickets'
  ) then
    return false;
  end if;
  execute format(
    'select exists (select 1 from public.%I where ' ||
    case when target_table = 'support_tickets' then 'todo_id' else 'id' end ||
    ' = $1::uuid)',
    target_table
  )
  into result
  using target_record_id;
  return result;
exception
  when invalid_text_representation then
    return false;
end;
$$;
