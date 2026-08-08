-- Identity admission, atomic invitation claims, and organization/project scope.
-- Workspace chat authorization is intentionally untouched: private channels and
-- group DMs continue to use their dedicated membership policies.

create extension if not exists pgcrypto with schema extensions;

create or replace function private.current_organization_id()
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

create or replace function private.can_access_organization(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.organization_id = target_organization_id
      and profile.status = 'active'
  );
$$;

create or replace function private.has_organization_role(
  target_organization_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.organization_id = target_organization_id
      and profile.status = 'active'
      and profile.role = any(allowed_roles)
  );
$$;

create or replace function private.can_access_project(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.profiles as profile
      on profile.id = (select auth.uid())
      and profile.organization_id = project.organization_id
      and profile.status = 'active'
    where project.id = target_project_id
      and (
        profile.role in ('admin', 'manager')
        or exists (
          select 1
          from public.project_members as membership
          where membership.project_id = project.id
            and membership.profile_id = profile.id
        )
      )
  );
$$;

create or replace function private.can_manage_project(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.profiles as profile
      on profile.id = (select auth.uid())
      and profile.organization_id = project.organization_id
      and profile.status = 'active'
      and profile.role in ('admin', 'manager')
    where project.id = target_project_id
  );
$$;

create or replace function private.can_access_todo(
  target_todo_id uuid
)
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
      and (select private.can_access_project(todo.project_id))
  );
$$;

create or replace function private.can_access_comment(
  target_comment_id uuid
)
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
      and (select private.can_access_project(comment.project_id))
  );
$$;

create or replace function private.project_id_from_object_name(
  object_name text
)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  project_segment text := split_part(object_name, '/', 1);
begin
  if project_segment !~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  then
    return null;
  end if;

  return project_segment::uuid;
end;
$$;

revoke all on function private.current_organization_id() from public;
revoke all on function private.can_access_organization(uuid) from public;
revoke all on function private.has_organization_role(uuid, text[]) from public;
revoke all on function private.can_access_project(uuid) from public;
revoke all on function private.can_manage_project(uuid) from public;
revoke all on function private.can_access_todo(uuid) from public;
revoke all on function private.can_access_comment(uuid) from public;
revoke all on function private.project_id_from_object_name(text) from public;

grant execute on function private.current_organization_id()
  to authenticated, service_role;
grant execute on function private.can_access_organization(uuid)
  to authenticated, service_role;
grant execute on function private.has_organization_role(uuid, text[])
  to authenticated, service_role;
grant execute on function private.can_access_project(uuid)
  to authenticated, service_role;
grant execute on function private.can_manage_project(uuid)
  to authenticated, service_role;
grant execute on function private.can_access_todo(uuid)
  to authenticated, service_role;
grant execute on function private.can_access_comment(uuid)
  to authenticated, service_role;
grant execute on function private.project_id_from_object_name(text)
  to authenticated, service_role;

-- This function is ready for the Supabase Auth "Before User Created" hook. It
-- admits only a matching active roster identity or a server-marked pending
-- invitation. Enabling the hook remains an Auth configuration/readiness step.
create or replace function private.hook_restrict_workspace_signup(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate_email text := lower(nullif(btrim(event #>> '{user,email}'), ''));
  candidate_id uuid := nullif(event #>> '{user,id}', '')::uuid;
  marked_invite_id uuid :=
    nullif(event #>> '{user,app_metadata,workspace_invite_id}', '')::uuid;
begin
  if candidate_email is null or candidate_id is null then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'This workspace is invite-only.'
      )
    );
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where lower(profile.email) = candidate_email
      and profile.id = candidate_id
      and profile.organization_id is not null
      and profile.status = 'active'
  ) then
    return '{}'::jsonb;
  end if;

  if marked_invite_id is not null and exists (
    select 1
    from public.invites as invitation
    where invitation.id = marked_invite_id
      and lower(invitation.email) = candidate_email
      and invitation.status = 'pending'
      and invitation.accepted_at is null
      and invitation.expires_at > statement_timestamp()
      and (
        not exists (
          select 1
          from public.profiles as profile
          where lower(profile.email) = candidate_email
        )
        or exists (
          select 1
          from public.profiles as profile
          where lower(profile.email) = candidate_email
            and profile.id = candidate_id
        )
      )
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'http_code', 403,
      'message', 'This workspace is invite-only.'
    )
  );
end;
$$;

revoke all on function private.hook_restrict_workspace_signup(jsonb)
  from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.hook_restrict_workspace_signup(jsonb)
  to supabase_auth_admin;

-- The token row and profile row are locked and changed in one transaction. The
-- signed Auth JWT supplies both auth.uid() and the verified email claim.
create or replace function private.claim_workspace_invite(
  invite_token text,
  requested_full_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  normalized_name text := btrim(requested_full_name);
  invitation public.invites%rowtype;
  actor_profile public.profiles%rowtype;
begin
  if actor_id is null or actor_email is null then
    raise insufficient_privilege using
      message = 'A verified email session is required.';
  end if;

  if char_length(invite_token) < 20
    or char_length(normalized_name) not between 2 and 100
  then
    raise check_violation using message = 'Invalid invitation details.';
  end if;

  select profile.*
  into actor_profile
  from public.profiles as profile
  where profile.id = actor_id
  for update;

  if not found or lower(actor_profile.email) <> actor_email then
    raise insufficient_privilege using
      message = 'The authenticated identity does not match this profile.';
  end if;

  select pending_invite.*
  into invitation
  from public.invites as pending_invite
  where pending_invite.token_hash = encode(
    extensions.digest(invite_token, 'sha256'),
    'hex'
  )
  for update;

  if not found or lower(invitation.email) <> actor_email then
    raise insufficient_privilege using
      message = 'This invitation is invalid or expired.';
  end if;

  if invitation.status = 'accepted'
    and invitation.accepted_by = actor_id
    and invitation.accepted_at is not null
  then
    return actor_id;
  end if;

  if invitation.status <> 'pending'
    or invitation.accepted_at is not null
    or invitation.expires_at <= statement_timestamp()
  then
    raise insufficient_privilege using
      message = 'This invitation is invalid or expired.';
  end if;

  if actor_profile.organization_id is not null
    and actor_profile.organization_id <> invitation.organization_id
  then
    raise insufficient_privilege using
      message = 'This profile belongs to another organization.';
  end if;

  update public.profiles
  set organization_id = invitation.organization_id,
      role = invitation.role,
      status = 'active',
      full_name = normalized_name,
      updated_at = statement_timestamp()
  where id = actor_id;

  update public.invites
  set status = 'accepted',
      accepted_by = actor_id,
      accepted_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = invitation.id
    and status = 'pending'
    and accepted_at is null;

  if not found then
    raise serialization_failure using
      message = 'This invitation was already claimed.';
  end if;

  return actor_id;
end;
$$;

revoke all on function private.claim_workspace_invite(text, text) from public;
grant execute on function private.claim_workspace_invite(text, text)
  to authenticated, service_role;

create or replace function public.claim_workspace_invite(
  invite_token text,
  requested_full_name text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.claim_workspace_invite(invite_token, requested_full_name);
$$;

revoke all on function public.claim_workspace_invite(text, text)
  from public, anon;
grant execute on function public.claim_workspace_invite(text, text)
  to authenticated, service_role;

-- Validate cross-table organization and project references on future writes.
create or replace function private.enforce_project_scope_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  target_project_id uuid;
  target_organization_id uuid;
  row_organization_id uuid :=
    nullif(row_data ->> 'organization_id', '')::uuid;
  referenced_profile_ids uuid[];
  referenced_profile_id uuid;
begin
  target_organization_id := row_organization_id;

  case tg_table_name
    when 'projects' then
      target_project_id := nullif(row_data ->> 'id', '')::uuid;
      target_organization_id := row_organization_id;
    when 'todo_assignees', 'todo_completion_subscribers', 'todo_subtasks' then
      select todo.project_id
      into target_project_id
      from public.todos as todo
      where todo.id = nullif(row_data ->> 'todo_id', '')::uuid;
    when 'comment_mentions', 'comment_attachments' then
      select comment.project_id
      into target_project_id
      from public.comments as comment
      where comment.id = nullif(row_data ->> 'comment_id', '')::uuid;
    else
      target_project_id := nullif(row_data ->> 'project_id', '')::uuid;
  end case;

  if target_project_id is not null and target_organization_id is null then
    select project.organization_id
    into target_organization_id
    from public.projects as project
    where project.id = target_project_id;

    if not found then
      raise foreign_key_violation using message = 'Project does not exist.';
    end if;
  end if;

  if target_project_id is not null
    and row_organization_id is not null
    and row_organization_id <> target_organization_id
  then
    raise check_violation using
      message = 'The row organization must match its project organization.';
  end if;

  case tg_table_name
    when 'projects' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'owner_id', '')::uuid
      ];
    when 'project_members' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'profile_id', '')::uuid
      ];
    when 'docs' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'created_by', '')::uuid,
        nullif(row_data ->> 'updated_by', '')::uuid
      ];
    when 'todos' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'assigned_to', '')::uuid,
        nullif(row_data ->> 'created_by', '')::uuid,
        nullif(row_data ->> 'completed_by', '')::uuid
      ];
    when 'messages' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'sender_id', '')::uuid
      ];
    when 'comments' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'author_id', '')::uuid,
        nullif(row_data ->> 'resolved_by', '')::uuid
      ];
    when 'files' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'uploaded_by', '')::uuid
      ];
    when 'chat_messages' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'profile_id', '')::uuid
      ];
    when 'milestones' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'owner_id', '')::uuid
      ];
    when 'activity_events' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'actor_id', '')::uuid
      ];
    when 'accelo_sync_runs' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'triggered_by', '')::uuid
      ];
    when 'sync_conflicts' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'resolved_by', '')::uuid
      ];
    when 'invites' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'invited_by', '')::uuid,
        nullif(row_data ->> 'accepted_by', '')::uuid
      ];
    when 'integration_settings' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'created_by', '')::uuid,
        nullif(row_data ->> 'updated_by', '')::uuid
      ];
    when 'mcp_api_keys' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'created_by', '')::uuid
      ];
    when 'todo_assignees' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'profile_id', '')::uuid,
        nullif(row_data ->> 'assigned_by', '')::uuid
      ];
    when 'todo_completion_subscribers', 'comment_mentions' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'profile_id', '')::uuid
      ];
    when 'todo_subtasks' then
      referenced_profile_ids := array[
        nullif(row_data ->> 'created_by', '')::uuid,
        nullif(row_data ->> 'completed_by', '')::uuid
      ];
    else
      referenced_profile_ids := '{}'::uuid[];
  end case;

  foreach referenced_profile_id in
    array coalesce(referenced_profile_ids, '{}'::uuid[])
  loop
    continue when referenced_profile_id is null;
    continue when target_organization_id is null
      and tg_table_name = 'chat_messages';

    if not exists (
      select 1
      from public.profiles as profile
      where profile.id = referenced_profile_id
        and profile.organization_id = target_organization_id
    ) then
      raise check_violation using
        message = 'Referenced profiles must belong to the project organization.';
    end if;
  end loop;

  if tg_table_name = 'todos' and not exists (
    select 1
    from public.todo_lists as list
    where list.id = nullif(row_data ->> 'todo_list_id', '')::uuid
      and list.project_id = target_project_id
  ) then
    raise check_violation using
      message = 'The to-do list must belong to the same project.';
  end if;

  if tg_table_name = 'comments' then
    if nullif(row_data ->> 'todo_id', '') is not null and not exists (
      select 1
      from public.todos as todo
      where todo.id = (row_data ->> 'todo_id')::uuid
        and todo.project_id = target_project_id
    ) then
      raise check_violation using
        message = 'The comment to-do must belong to the same project.';
    end if;

    if nullif(row_data ->> 'doc_id', '') is not null and not exists (
      select 1
      from public.docs as doc
      where doc.id = (row_data ->> 'doc_id')::uuid
        and doc.project_id = target_project_id
    ) then
      raise check_violation using
        message = 'The comment document must belong to the same project.';
    end if;

    if nullif(row_data #>> '{metadata,message_id}', '') is not null
      and not exists (
        select 1
        from public.messages as message
        where message.id =
          (row_data #>> '{metadata,message_id}')::uuid
          and message.project_id = target_project_id
      )
    then
      raise check_violation using
        message = 'The comment message must belong to the same project.';
    end if;

    if nullif(row_data ->> 'parent_comment_id', '') is not null and not exists (
      select 1
      from public.comments as parent
      where parent.id = (row_data ->> 'parent_comment_id')::uuid
        and parent.project_id = target_project_id
    ) then
      raise check_violation using
        message = 'The parent comment must belong to the same project.';
    end if;
  end if;

  if tg_table_name = 'comment_attachments'
    and nullif(row_data ->> 'file_id', '') is not null
    and not exists (
      select 1
      from public.files as file
      where file.id = (row_data ->> 'file_id')::uuid
        and file.project_id = target_project_id
    )
  then
    raise check_violation using
      message = 'The attachment file must belong to the comment project.';
  end if;

  if tg_table_name = 'chat_messages'
    and nullif(row_data ->> 'parent_message_id', '') is not null
    and not exists (
      select 1
      from public.chat_messages as parent
      where parent.id = (row_data ->> 'parent_message_id')::uuid
        and parent.project_id is not distinct from target_project_id
    )
  then
    raise check_violation using
      message = 'The parent chat message must belong to the same project.';
  end if;

  if tg_table_name = 'files'
    and split_part(row_data ->> 'object_path', '/', 1)
      <> target_project_id::text
  then
    raise check_violation using
      message = 'Project file paths must begin with the project UUID.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_project_scope_integrity() from public;

do $$
begin
  if exists (
    select 1
    from public.project_members as membership
    join public.projects as project on project.id = membership.project_id
    join public.profiles as profile on profile.id = membership.profile_id
    where profile.organization_id is distinct from project.organization_id
  ) then
    raise check_violation using
      message = 'Existing project membership crosses organizations.';
  end if;
end;
$$;

create trigger enforce_projects_scope
  before insert or update of organization_id, owner_id
  on public.projects
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_project_members_scope
  before insert or update of project_id, profile_id
  on public.project_members
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_todo_lists_scope
  before insert or update of project_id
  on public.todo_lists
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_docs_scope
  before insert or update of project_id, created_by, updated_by
  on public.docs
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_todos_scope
  before insert or update of project_id, todo_list_id, assigned_to, created_by,
    completed_by
  on public.todos
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_messages_scope
  before insert or update of project_id, sender_id
  on public.messages
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_comments_scope
  before insert or update of project_id, todo_id, doc_id, parent_comment_id,
    author_id, resolved_by, metadata
  on public.comments
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_files_scope
  before insert or update of project_id, uploaded_by, object_path
  on public.files
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_project_chat_scope
  before insert or update of project_id, parent_message_id, profile_id
  on public.chat_messages
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_milestones_scope
  before insert or update of project_id, owner_id
  on public.milestones
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_activity_events_scope
  before insert or update of organization_id, project_id, actor_id
  on public.activity_events
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_accelo_sync_runs_scope
  before insert or update of organization_id, project_id, triggered_by
  on public.accelo_sync_runs
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_sync_conflicts_scope
  before insert or update of organization_id, project_id, resolved_by
  on public.sync_conflicts
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_invites_scope
  before insert or update of organization_id, invited_by, accepted_by
  on public.invites
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_integration_settings_scope
  before insert or update of organization_id, created_by, updated_by
  on public.integration_settings
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_mcp_api_keys_scope
  before insert or update of organization_id, created_by
  on public.mcp_api_keys
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_todo_assignees_scope
  before insert or update of todo_id, profile_id, assigned_by
  on public.todo_assignees
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_completion_subscribers_scope
  before insert or update of todo_id, profile_id
  on public.todo_completion_subscribers
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_todo_subtasks_scope
  before insert or update of todo_id, created_by, completed_by
  on public.todo_subtasks
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_comment_mentions_scope
  before insert or update of comment_id, profile_id
  on public.comment_mentions
  for each row execute function private.enforce_project_scope_integrity();
create trigger enforce_comment_attachments_scope
  before insert or update of comment_id, file_id
  on public.comment_attachments
  for each row execute function private.enforce_project_scope_integrity();

-- Replace the broad "all internal users" policies for organization and project
-- data. Dedicated workspace-chat policies are deliberately not changed.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'profiles', 'invites', 'projects', 'project_members',
    'todo_lists', 'todos', 'messages', 'comments', 'docs', 'files',
    'chat_messages', 'milestones', 'activity_events', 'accelo_sync_runs',
    'sync_conflicts', 'integration_settings', 'mcp_api_keys'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      'Active internal users can access ' || table_name,
      table_name
    );
  end loop;
end;
$$;

drop policy if exists "Active internal users can access todo assignees"
  on public.todo_assignees;
drop policy if exists "Active internal users can access completion subscribers"
  on public.todo_completion_subscribers;
drop policy if exists "Active internal users can access todo subtasks"
  on public.todo_subtasks;
drop policy if exists "Active internal users can access comment mentions"
  on public.comment_mentions;
drop policy if exists "Active internal users can access comment attachments"
  on public.comment_attachments;

create policy "Members can read their organization"
on public.organizations
for select
to authenticated
using ((select private.can_access_organization(id)));

create policy "Admins can update their organization"
on public.organizations
for update
to authenticated
using (
  (select private.has_organization_role(id, array['admin']::text[]))
)
with check (
  (select private.has_organization_role(id, array['admin']::text[]))
);

create policy "Members can read organization profiles"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.can_access_organization(organization_id))
);

create policy "Members can update their own profile"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Managers can manage organization invitations"
on public.invites
for all
to authenticated
using (
  (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
)
with check (
  (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);

create policy "Project members can read projects"
on public.projects
for select
to authenticated
using ((select private.can_access_project(id)));

create policy "Managers can create projects"
on public.projects
for insert
to authenticated
with check (
  (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);

create policy "Managers can update projects"
on public.projects
for update
to authenticated
using ((select private.can_manage_project(id)))
with check (
  (select private.has_organization_role(
    organization_id,
    array['admin', 'manager']::text[]
  ))
);

create policy "Managers can delete projects"
on public.projects
for delete
to authenticated
using ((select private.can_manage_project(id)));

create policy "Project members can read membership"
on public.project_members
for select
to authenticated
using ((select private.can_access_project(project_id)));

create policy "Managers can add project membership"
on public.project_members
for insert
to authenticated
with check ((select private.can_manage_project(project_id)));

create policy "Managers can update project membership"
on public.project_members
for update
to authenticated
using ((select private.can_manage_project(project_id)))
with check ((select private.can_manage_project(project_id)));

create policy "Managers can remove project membership"
on public.project_members
for delete
to authenticated
using ((select private.can_manage_project(project_id)));

create policy "Project members can access todo lists"
on public.todo_lists
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can access todos"
on public.todos
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can access messages"
on public.messages
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can access comments"
on public.comments
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can access documents"
on public.docs
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can access file metadata"
on public.files
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Project members can access project chat"
on public.chat_messages
for all
to authenticated
using (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and profile_id = (select auth.uid())
    and (select private.current_organization_id()) is not null
  )
)
with check (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and profile_id = (select auth.uid())
    and (select private.current_organization_id()) is not null
  )
);

create policy "Project members can access milestones"
on public.milestones
for all
to authenticated
using ((select private.can_access_project(project_id)))
with check ((select private.can_access_project(project_id)));

create policy "Members can read scoped activity"
on public.activity_events
for select
to authenticated
using (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and (select private.can_access_organization(organization_id))
  )
);

create policy "Members can access scoped sync runs"
on public.accelo_sync_runs
for all
to authenticated
using (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and (select private.can_access_organization(organization_id))
  )
)
with check (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and (select private.can_access_organization(organization_id))
  )
);

create policy "Members can access scoped sync conflicts"
on public.sync_conflicts
for all
to authenticated
using (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and (select private.can_access_organization(organization_id))
  )
)
with check (
  (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (
    project_id is null
    and (select private.can_access_organization(organization_id))
  )
);

create policy "Admins can manage integration settings"
on public.integration_settings
for all
to authenticated
using (
  (select private.has_organization_role(
    organization_id,
    array['admin']::text[]
  ))
)
with check (
  (select private.has_organization_role(
    organization_id,
    array['admin']::text[]
  ))
);

create policy "Admins can manage MCP API keys"
on public.mcp_api_keys
for all
to authenticated
using (
  (select private.has_organization_role(
    organization_id,
    array['admin']::text[]
  ))
)
with check (
  (select private.has_organization_role(
    organization_id,
    array['admin']::text[]
  ))
);

grant select, insert, update, delete on
  public.todo_assignees,
  public.todo_completion_subscribers,
  public.todo_subtasks,
  public.comment_mentions,
  public.comment_attachments
to authenticated;

create policy "Project members can access todo assignees"
on public.todo_assignees
for all
to authenticated
using ((select private.can_access_todo(todo_id)))
with check ((select private.can_access_todo(todo_id)));

create policy "Project members can access completion subscribers"
on public.todo_completion_subscribers
for all
to authenticated
using ((select private.can_access_todo(todo_id)))
with check ((select private.can_access_todo(todo_id)));

create policy "Project members can access todo subtasks"
on public.todo_subtasks
for all
to authenticated
using ((select private.can_access_todo(todo_id)))
with check ((select private.can_access_todo(todo_id)));

create policy "Project members can access comment mentions"
on public.comment_mentions
for all
to authenticated
using ((select private.can_access_comment(comment_id)))
with check ((select private.can_access_comment(comment_id)));

create policy "Project members can access comment attachments"
on public.comment_attachments
for all
to authenticated
using ((select private.can_access_comment(comment_id)))
with check ((select private.can_access_comment(comment_id)));

drop policy if exists "Internal users can read project files"
  on storage.objects;
drop policy if exists "Internal users can upload project files"
  on storage.objects;
drop policy if exists "Internal users can update project files"
  on storage.objects;
drop policy if exists "Internal users can delete project files"
  on storage.objects;

create policy "Project members can read project files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.can_access_project(
    private.project_id_from_object_name(name)
  ))
);

create policy "Project members can upload project files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-files'
  and (select private.can_access_project(
    private.project_id_from_object_name(name)
  ))
);

create policy "Project members can update project files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.can_access_project(
    private.project_id_from_object_name(name)
  ))
)
with check (
  bucket_id = 'project-files'
  and (select private.can_access_project(
    private.project_id_from_object_name(name)
  ))
);

create policy "Project members can delete project files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.can_access_project(
    private.project_id_from_object_name(name)
  ))
);
