-- Closed-loop PM/chat operating system primitives.
-- All exposed tables use RLS and retain organization/project scope explicitly.

create table public.project_channel_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid not null references public.workspace_conversations(id) on delete cascade,
  is_primary boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, conversation_id)
);

create unique index project_channel_bindings_primary_idx
  on public.project_channel_bindings (project_id)
  where is_primary;
create index project_channel_bindings_conversation_idx
  on public.project_channel_bindings (conversation_id, project_id);

create table public.work_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  summary text not null check (char_length(btrim(summary)) between 1 and 10000),
  rationale text,
  status text not null default 'active'
    check (status in ('proposed', 'active', 'superseded', 'reversed')),
  owner_id uuid references public.profiles(id) on delete set null,
  source_conversation_id uuid references public.workspace_conversations(id) on delete set null,
  source_message_id uuid references public.workspace_messages(id) on delete set null,
  superseded_by uuid references public.work_decisions(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_decisions_project_idx
  on public.work_decisions (project_id, status, decided_at desc);
create index work_decisions_source_message_idx
  on public.work_decisions (source_message_id)
  where source_message_id is not null;

create table public.work_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 240),
  description text,
  subject_type text not null
    check (subject_type in ('project', 'issue', 'decision', 'doc', 'file', 'milestone')),
  subject_id uuid not null,
  requested_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested', 'rejected', 'cancelled')),
  response_note text,
  source_conversation_id uuid references public.workspace_conversations(id) on delete set null,
  source_message_id uuid references public.workspace_messages(id) on delete set null,
  due_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_approvals_reviewer_idx
  on public.work_approvals (reviewer_id, status, due_at nulls last);
create index work_approvals_project_idx
  on public.work_approvals (project_id, status, created_at desc);

create table public.issue_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  predecessor_todo_id uuid not null references public.todos(id) on delete cascade,
  successor_todo_id uuid not null references public.todos(id) on delete cascade,
  relationship text not null default 'blocks'
    check (relationship in ('blocks', 'relates_to', 'duplicates', 'parent')),
  reason text,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  check (predecessor_todo_id <> successor_todo_id),
  unique (predecessor_todo_id, successor_todo_id, relationship)
);

create index issue_dependencies_predecessor_idx
  on public.issue_dependencies (predecessor_todo_id);
create index issue_dependencies_successor_idx
  on public.issue_dependencies (successor_todo_id);

create table public.work_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  goal text,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'completed', 'cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index work_cycles_organization_idx
  on public.work_cycles (organization_id, starts_on desc);
create index work_cycles_project_idx
  on public.work_cycles (project_id, starts_on desc)
  where project_id is not null;

create table public.cycle_issues (
  cycle_id uuid not null references public.work_cycles(id) on delete cascade,
  todo_id uuid not null references public.todos(id) on delete cascade,
  added_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (cycle_id, todo_id)
);

create index cycle_issues_todo_idx on public.cycle_issues (todo_id, cycle_id);

create table public.workspace_inbox_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete cascade,
  kind text not null check (
    kind in (
      'mention', 'assignment', 'thread_reply', 'approval', 'due',
      'overdue', 'blocker', 'watch', 'automation', 'integration'
    )
  ),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  body text,
  href text not null check (href like '/%'),
  source_type text not null,
  source_id text not null,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  read_at timestamptz,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipient_id, kind, source_type, source_id)
);

create index workspace_inbox_recipient_idx
  on public.workspace_inbox_items (
    recipient_id,
    completed_at,
    snoozed_until,
    created_at desc
  );
create index workspace_inbox_project_idx
  on public.workspace_inbox_items (project_id, created_at desc)
  where project_id is not null;

create table public.saved_workspace_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade
    default auth.uid(),
  project_id uuid references public.projects(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  href text not null check (href like '/%'),
  note text,
  created_at timestamptz not null default now(),
  unique (owner_id, source_type, source_id)
);

create index saved_workspace_items_owner_idx
  on public.saved_workspace_items (owner_id, created_at desc);

create table public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 160),
  enabled boolean not null default true,
  trigger_type text not null check (
    trigger_type in (
      'issue_created', 'status_changed', 'assignment_changed',
      'due_soon', 'overdue', 'stale', 'approval_completed'
    )
  ),
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null check (
    action_type in (
      'notify', 'create_follow_up', 'request_approval',
      'post_update', 'assign', 'change_status'
    )
  ),
  action_config jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index automation_rules_active_idx
  on public.automation_rules (organization_id, enabled, trigger_type);

create table public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.workspace_conversations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  summary text not null check (char_length(btrim(summary)) between 1 and 20000),
  decisions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  citations jsonb not null default '[]'::jsonb,
  source_message_count integer not null default 0 check (source_message_count >= 0),
  generated_by uuid references public.profiles(id) on delete set null
    default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id)
);

create index conversation_summaries_project_idx
  on public.conversation_summaries (project_id, updated_at desc)
  where project_id is not null;

create table public.guest_project_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  access_role text not null default 'reviewer'
    check (access_role in ('viewer', 'commenter', 'reviewer')),
  can_access_chat boolean not null default false,
  expires_at timestamptz,
  granted_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  unique (project_id, profile_id)
);

create index guest_project_access_profile_idx
  on public.guest_project_access (profile_id, expires_at);

create table public.integration_api_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 120),
  token_prefix text not null check (char_length(token_prefix) between 6 and 16),
  token_hash text not null unique,
  scopes text[] not null default '{}',
  created_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index integration_api_tokens_org_idx
  on public.integration_api_tokens (organization_id, revoked_at, expires_at);

create table public.workspace_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 2 and 120),
  entity_type text not null,
  entity_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index workspace_audit_org_idx
  on public.workspace_audit_events (organization_id, created_at desc);
create index workspace_audit_project_idx
  on public.workspace_audit_events (project_id, created_at desc)
  where project_id is not null;

-- Keep project-scoped organization IDs canonical even for direct Data API writes.
create or replace function private.set_pm_chat_project_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  canonical_organization_id uuid;
begin
  select project.organization_id
  into canonical_organization_id
  from public.projects as project
  where project.id = new.project_id;

  if canonical_organization_id is null then
    raise foreign_key_violation using message = 'Project does not exist.';
  end if;
  new.organization_id := canonical_organization_id;
  return new;
end;
$$;

revoke all on function private.set_pm_chat_project_organization() from public;

create trigger set_project_channel_binding_organization
  before insert or update of project_id, organization_id
  on public.project_channel_bindings
  for each row execute function private.set_pm_chat_project_organization();
create trigger set_work_decision_organization
  before insert or update of project_id, organization_id
  on public.work_decisions
  for each row execute function private.set_pm_chat_project_organization();
create trigger set_work_approval_organization
  before insert or update of project_id, organization_id
  on public.work_approvals
  for each row execute function private.set_pm_chat_project_organization();
create trigger set_issue_dependency_organization
  before insert or update of project_id, organization_id
  on public.issue_dependencies
  for each row execute function private.set_pm_chat_project_organization();
create trigger set_guest_project_access_organization
  before insert or update of project_id, organization_id
  on public.guest_project_access
  for each row execute function private.set_pm_chat_project_organization();

-- Grants and RLS.
revoke all on
  public.project_channel_bindings,
  public.work_decisions,
  public.work_approvals,
  public.issue_dependencies,
  public.work_cycles,
  public.cycle_issues,
  public.workspace_inbox_items,
  public.saved_workspace_items,
  public.automation_rules,
  public.conversation_summaries,
  public.guest_project_access,
  public.integration_api_tokens,
  public.workspace_audit_events
from public, anon, authenticated;

grant select, insert, update, delete on
  public.project_channel_bindings,
  public.work_decisions,
  public.work_approvals,
  public.issue_dependencies,
  public.work_cycles,
  public.cycle_issues,
  public.workspace_inbox_items,
  public.saved_workspace_items,
  public.automation_rules,
  public.conversation_summaries,
  public.guest_project_access,
  public.integration_api_tokens,
  public.workspace_audit_events
to authenticated;

grant all on
  public.project_channel_bindings,
  public.work_decisions,
  public.work_approvals,
  public.issue_dependencies,
  public.work_cycles,
  public.cycle_issues,
  public.workspace_inbox_items,
  public.saved_workspace_items,
  public.automation_rules,
  public.conversation_summaries,
  public.guest_project_access,
  public.integration_api_tokens,
  public.workspace_audit_events
to service_role;

alter table public.project_channel_bindings enable row level security;
alter table public.work_decisions enable row level security;
alter table public.work_approvals enable row level security;
alter table public.issue_dependencies enable row level security;
alter table public.work_cycles enable row level security;
alter table public.cycle_issues enable row level security;
alter table public.workspace_inbox_items enable row level security;
alter table public.saved_workspace_items enable row level security;
alter table public.automation_rules enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.guest_project_access enable row level security;
alter table public.integration_api_tokens enable row level security;
alter table public.workspace_audit_events enable row level security;

create policy "Members can read project channel bindings"
on public.project_channel_bindings for select to authenticated
using (
  (select private.can_access_project(project_id))
  and (select private.can_access_workspace_conversation(conversation_id))
);
create policy "Managers can manage project channel bindings"
on public.project_channel_bindings for all to authenticated
using (
  (select private.can_manage_project(project_id))
  and (select private.can_access_workspace_conversation(conversation_id))
)
with check (
  (select private.can_manage_project(project_id))
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Members can read decisions"
on public.work_decisions for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Members can create decisions"
on public.work_decisions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_project(project_id))
);
create policy "Decision owners can update decisions"
on public.work_decisions for update to authenticated
using (
  created_by = (select auth.uid())
  or owner_id = (select auth.uid())
  or (select private.can_manage_project(project_id))
)
with check ((select private.can_access_project(project_id)));

create policy "Project members can read approvals"
on public.work_approvals for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Project members can request approvals"
on public.work_approvals for insert to authenticated
with check (
  requested_by = (select auth.uid())
  and (select private.can_access_project(project_id))
);
create policy "Reviewers can update approvals"
on public.work_approvals for update to authenticated
using (
  reviewer_id = (select auth.uid())
  or requested_by = (select auth.uid())
  or (select private.can_manage_project(project_id))
)
with check ((select private.can_access_project(project_id)));

create policy "Project members can read dependencies"
on public.issue_dependencies for select to authenticated
using ((select private.can_access_project(project_id)));
create policy "Project members can create dependencies"
on public.issue_dependencies for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_project(project_id))
);
create policy "Dependency creators can remove dependencies"
on public.issue_dependencies for delete to authenticated
using (
  created_by = (select auth.uid())
  or (select private.can_manage_project(project_id))
);

create policy "Members can read accessible cycles"
on public.work_cycles for select to authenticated
using (
  (project_id is null and (select private.can_access_organization(organization_id)))
  or (project_id is not null and (select private.can_access_project(project_id)))
);
create policy "Managers can manage cycles"
on public.work_cycles for all to authenticated
using ((select private.has_organization_role(organization_id, array['admin', 'manager'])))
with check ((select private.has_organization_role(organization_id, array['admin', 'manager'])));

create policy "Members can read cycle issues"
on public.cycle_issues for select to authenticated
using (
  exists (
    select 1
    from public.work_cycles as cycle
    where cycle.id = cycle_id
      and (
        (cycle.project_id is null and (select private.can_access_organization(cycle.organization_id)))
        or (cycle.project_id is not null and (select private.can_access_project(cycle.project_id)))
      )
  )
);
create policy "Managers can manage cycle issues"
on public.cycle_issues for all to authenticated
using (
  exists (
    select 1 from public.work_cycles as cycle
    where cycle.id = cycle_id
      and (select private.has_organization_role(cycle.organization_id, array['admin', 'manager']))
  )
)
with check (
  exists (
    select 1 from public.work_cycles as cycle
    where cycle.id = cycle_id
      and (select private.has_organization_role(cycle.organization_id, array['admin', 'manager']))
  )
);

create policy "People can read their inbox"
on public.workspace_inbox_items for select to authenticated
using (recipient_id = (select auth.uid()));
create policy "People can update their inbox"
on public.workspace_inbox_items for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));
create policy "Members can create scoped inbox events"
on public.workspace_inbox_items for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (select private.can_access_organization(organization_id))
  and (
    project_id is null
    or (select private.can_access_project(project_id))
  )
);
create policy "People can remove their inbox items"
on public.workspace_inbox_items for delete to authenticated
using (recipient_id = (select auth.uid()));

create policy "People can manage saved items"
on public.saved_workspace_items for all to authenticated
using (owner_id = (select auth.uid()))
with check (
  owner_id = (select auth.uid())
  and (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);

create policy "Members can read automation rules"
on public.automation_rules for select to authenticated
using (
  (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);
create policy "Managers can manage automation rules"
on public.automation_rules for all to authenticated
using ((select private.has_organization_role(organization_id, array['admin', 'manager'])))
with check ((select private.has_organization_role(organization_id, array['admin', 'manager'])));

create policy "Members can read accessible conversation summaries"
on public.conversation_summaries for select to authenticated
using (
  (select private.can_access_workspace_conversation(conversation_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);
create policy "Members can manage accessible conversation summaries"
on public.conversation_summaries for all to authenticated
using (
  (select private.can_access_workspace_conversation(conversation_id))
  and (project_id is null or (select private.can_access_project(project_id)))
)
with check (
  (select private.can_access_workspace_conversation(conversation_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);

create policy "Managers can manage guest project access"
on public.guest_project_access for all to authenticated
using ((select private.can_manage_project(project_id)))
with check ((select private.can_manage_project(project_id)));
create policy "Guests can read their grants"
on public.guest_project_access for select to authenticated
using (profile_id = (select auth.uid()));

create policy "Managers can manage integration tokens"
on public.integration_api_tokens for all to authenticated
using ((select private.has_organization_role(organization_id, array['admin', 'manager'])))
with check ((select private.has_organization_role(organization_id, array['admin', 'manager'])));

create policy "Members can read accessible audit events"
on public.workspace_audit_events for select to authenticated
using (
  (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);
create policy "Members can create scoped audit events"
on public.workspace_audit_events for insert to authenticated
with check (
  actor_id = (select auth.uid())
  and (select private.can_access_organization(organization_id))
  and (project_id is null or (select private.can_access_project(project_id)))
);

-- Atomic chat-to-work conversion. If either issue creation or source linking
-- fails, Postgres rolls back the complete operation.
create or replace function public.create_issue_from_workspace_message(
  target_message_id uuid,
  target_project_id uuid,
  target_title text,
  target_assignee_ids uuid[] default '{}',
  target_due_at timestamptz default null,
  target_priority text default 'medium',
  requested_actor_id uuid default auth.uid(),
  target_idempotency_key text default gen_random_uuid()::text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  source_message public.workspace_messages%rowtype;
  created_issue jsonb;
begin
  select message.*
  into source_message
  from public.workspace_messages as message
  where message.id = target_message_id;
  if source_message.id is null then
    raise no_data_found using message = 'Source message not found.';
  end if;
  if not (select private.can_access_workspace_conversation(source_message.conversation_id)) then
    raise insufficient_privilege using message = 'Conversation access required.';
  end if;

  created_issue := public.create_project_issue(
    target_project_id,
    null,
    target_title,
    'Created from workspace chat:' || E'\n\n' || source_message.body,
    coalesce(target_assignee_ids, '{}'::uuid[]),
    '{}'::uuid[],
    target_due_at,
    target_priority,
    'task',
    array['from-chat'],
    null,
    null,
    requested_actor_id,
    target_idempotency_key
  );

  perform public.link_workspace_chat_entity(
    'message',
    target_message_id,
    'issue',
    (created_issue ->> 'id')::uuid
  );
  return created_issue;
end;
$$;

revoke all on function public.create_issue_from_workspace_message(
  uuid,
  uuid,
  text,
  uuid[],
  timestamptz,
  text,
  uuid,
  text
) from public, anon;
grant execute on function public.create_issue_from_workspace_message(
  uuid,
  uuid,
  text,
  uuid[],
  timestamptz,
  text,
  uuid,
  text
) to authenticated, service_role;

-- Close the loop by returning issue status changes to the chat thread that
-- created or linked the issue. Only conversations the acting user can access
-- receive an event.
create or replace function private.post_linked_issue_status_to_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_record record;
  issue_record record;
  thread_root_id uuid;
begin
  if new.from_status is not distinct from new.to_status then
    return null;
  end if;
  select todo.title, todo.issue_number, project.code
  into issue_record
  from public.todos as todo
  join public.projects as project on project.id = todo.project_id
  where todo.id = new.todo_id;

  for linked_record in
    select link.conversation_id, link.workspace_message_id
    from public.workspace_cross_links as link
    where link.work_type = 'issue'
      and link.todo_id = new.todo_id
      and link.chat_type = 'message'
      and link.workspace_message_id is not null
  loop
    if not (select private.can_access_workspace_conversation(linked_record.conversation_id)) then
      continue;
    end if;
    select coalesce(message.parent_message_id, message.id)
    into thread_root_id
    from public.workspace_messages as message
    where message.id = linked_record.workspace_message_id;

    insert into public.workspace_messages (
      conversation_id,
      sender_id,
      body,
      client_nonce,
      parent_message_id
    )
    values (
      linked_record.conversation_id,
      coalesce(new.actor_id, (select auth.uid())),
      coalesce(issue_record.code || '-' || issue_record.issue_number::text || ': ', '')
        || issue_record.title
        || ' moved to '
        || replace(new.to_status, '_', ' ')
        || '.',
      gen_random_uuid(),
      thread_root_id
    );
  end loop;
  return null;
end;
$$;

revoke all on function private.post_linked_issue_status_to_chat() from public;

create trigger post_linked_issue_status_to_chat
  after insert on public.issue_status_transitions
  for each row execute function private.post_linked_issue_status_to_chat();
