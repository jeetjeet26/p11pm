-- P11 project-management database
-- Authorization deliberately comes from public.profiles, never auth.users.raw_user_meta_data.

create schema if not exists private;
revoke all on schema private from public;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  full_name text not null default '',
  avatar_url text,
  title text,
  phone text,
  timezone text not null default 'UTC',
  role text not null default 'member'
    check (role in ('admin', 'manager', 'member', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'deactivated')),
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_unique_idx on public.profiles (lower(email));
create index profiles_organization_id_idx on public.profiles (organization_id);
create index profiles_active_idx on public.profiles (id) where status = 'active';

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'member'
    check (role in ('admin', 'manager', 'member', 'viewer')),
  token_hash text not null unique check (char_length(token_hash) >= 32),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references public.profiles(id) on delete set null,
  accepted_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invites_acceptance_consistent check (
    (status = 'accepted' and accepted_at is not null and accepted_by is not null)
    or status <> 'accepted'
  )
);

create unique index invites_pending_email_unique_idx
  on public.invites (organization_id, lower(email))
  where status = 'pending';
create index invites_organization_id_idx on public.invites (organization_id);
create index invites_expires_at_idx on public.invites (expires_at) where status = 'pending';

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 160),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  client_name text,
  description text,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  owner_id uuid references public.profiles(id) on delete set null,
  start_date date,
  due_date date,
  budget numeric(14,2) check (budget is null or budget >= 0),
  currency char(3) not null default 'USD' check (currency = upper(currency)),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  constraint projects_dates_valid check (
    due_date is null or start_date is null or due_date >= start_date
  )
);

create index projects_organization_id_idx on public.projects (organization_id);
create index projects_owner_id_idx on public.projects (owner_id);
create index projects_status_due_date_idx on public.projects (status, due_date);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('lead', 'member', 'reviewer', 'client')),
  allocation_percent smallint check (
    allocation_percent is null or allocation_percent between 0 and 100
  ),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, profile_id)
);

create index project_members_profile_id_idx on public.project_members (profile_id);

create table public.todo_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text,
  position integer not null default 0 check (position >= 0),
  is_archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, title)
);

create index todo_lists_project_position_idx
  on public.todo_lists (project_id, is_archived, position);

create table public.docs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  content jsonb not null default '{}'::jsonb,
  plain_text text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  version integer not null default 1 check (version > 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug),
  constraint docs_publication_consistent check (
    (status = 'published' and published_at is not null) or status <> 'published'
  )
);

create index docs_project_status_idx on public.docs (project_id, status);
create index docs_plain_text_search_idx
  on public.docs using gin (to_tsvector('english', coalesce(plain_text, '')));

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  todo_list_id uuid not null references public.todo_lists(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  position integer not null default 0 check (position >= 0),
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes >= 0),
  actual_minutes integer check (actual_minutes is null or actual_minutes >= 0),
  labels text[] not null default '{}'::text[],
  accelo_activity_id text,
  accelo_task_id text,
  accelo_parent_id text,
  accelo_url text,
  sync_status text not null default 'not_synced'
    check (sync_status in ('not_synced', 'pending', 'synced', 'conflict', 'error')),
  sync_version integer not null default 0 check (sync_version >= 0),
  last_synced_at timestamptz,
  sync_error text,
  accelo_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(accelo_payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todos_completion_consistent check (
    (status = 'done' and completed_at is not null) or status <> 'done'
  )
);

create index todos_project_id_idx on public.todos (project_id);
create index todos_list_position_idx on public.todos (todo_list_id, position);
create index todos_assigned_status_due_idx
  on public.todos (assigned_to, status, due_at);
create index todos_sync_status_idx
  on public.todos (sync_status, updated_at)
  where sync_status in ('pending', 'conflict', 'error');
create unique index todos_accelo_activity_unique_idx
  on public.todos (project_id, accelo_activity_id)
  where accelo_activity_id is not null;
create unique index todos_accelo_task_unique_idx
  on public.todos (project_id, accelo_task_id)
  where accelo_task_id is not null;

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  direction text not null default 'internal'
    check (direction in ('inbound', 'outbound', 'internal')),
  channel text not null default 'internal'
    check (channel in ('internal', 'email', 'sms', 'accelo')),
  subject text,
  body text not null check (char_length(btrim(body)) > 0),
  status text not null default 'sent'
    check (status in ('draft', 'queued', 'sent', 'delivered', 'failed')),
  external_id text,
  recipient_emails text[] not null default '{}'::text[],
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index messages_project_created_at_idx
  on public.messages (project_id, created_at desc);
create unique index messages_channel_external_id_unique_idx
  on public.messages (channel, external_id)
  where external_id is not null;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  todo_id uuid references public.todos(id) on delete cascade,
  doc_id uuid references public.docs(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(btrim(body)) > 0),
  is_edited boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_single_target check (num_nonnulls(todo_id, doc_id) <= 1),
  constraint comments_resolution_consistent check (
    (resolved_at is null and resolved_by is null)
    or (resolved_at is not null and resolved_by is not null)
  )
);

create index comments_project_created_at_idx
  on public.comments (project_id, created_at desc);
create index comments_todo_id_idx on public.comments (todo_id) where todo_id is not null;
create index comments_doc_id_idx on public.comments (doc_id) where doc_id is not null;
create index comments_parent_id_idx
  on public.comments (parent_comment_id) where parent_comment_id is not null;

create table public.files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  bucket_id text not null default 'project-files' check (bucket_id = 'project-files'),
  object_path text not null check (
    char_length(btrim(object_path)) > 0 and object_path !~ '(^|/)\.\.(/|$)'
  ),
  file_name text not null check (char_length(btrim(file_name)) > 0),
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  checksum_sha256 text check (
    checksum_sha256 is null or checksum_sha256 ~ '^[a-f0-9]{64}$'
  ),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create index files_project_created_at_idx
  on public.files (project_id, created_at desc);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  conversation_id uuid not null,
  parent_message_id uuid references public.chat_messages(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null default '',
  model text,
  tool_name text,
  tool_call_id text,
  tool_calls jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_calls) = 'array'),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_messages_conversation_created_at_idx
  on public.chat_messages (conversation_id, created_at);
create index chat_messages_project_id_idx on public.chat_messages (project_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'in_progress', 'completed', 'missed', 'cancelled')),
  due_date date,
  completed_at timestamptz,
  owner_id uuid references public.profiles(id) on delete set null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name),
  constraint milestones_completion_consistent check (
    (status = 'completed' and completed_at is not null) or status <> 'completed'
  )
);

create index milestones_project_due_date_idx
  on public.milestones (project_id, due_date);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index activity_events_organization_created_at_idx
  on public.activity_events (organization_id, created_at desc);
create index activity_events_project_created_at_idx
  on public.activity_events (project_id, created_at desc);
create index activity_events_entity_idx
  on public.activity_events (entity_type, entity_id, created_at desc);

create table public.accelo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  triggered_by uuid references public.profiles(id) on delete set null,
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual', 'scheduled', 'webhook', 'retry')),
  direction text not null default 'bidirectional'
    check (direction in ('pull', 'push', 'bidirectional')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  cursor text,
  records_scanned integer not null default 0 check (records_scanned >= 0),
  records_created integer not null default 0 check (records_created >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  records_failed integer not null default 0 check (records_failed >= 0),
  error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accelo_sync_run_times_valid check (
    completed_at is null or started_at is null or completed_at >= started_at
  )
);

create index accelo_sync_runs_organization_created_at_idx
  on public.accelo_sync_runs (organization_id, created_at desc);
create index accelo_sync_runs_status_idx
  on public.accelo_sync_runs (status, created_at)
  where status in ('queued', 'running', 'partial', 'failed');

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  sync_run_id uuid references public.accelo_sync_runs(id) on delete set null,
  entity_type text not null,
  local_entity_id uuid,
  accelo_id text not null,
  field_name text,
  local_value jsonb,
  remote_value jsonb,
  resolution text not null default 'unresolved'
    check (resolution in ('unresolved', 'use_local', 'use_remote', 'merged', 'ignored')),
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sync_conflicts_resolution_consistent check (
    (resolution = 'unresolved' and resolved_at is null and resolved_by is null)
    or (resolution <> 'unresolved' and resolved_at is not null and resolved_by is not null)
  )
);

create index sync_conflicts_open_idx
  on public.sync_conflicts (organization_id, project_id, created_at desc)
  where resolution = 'unresolved';
create index sync_conflicts_run_id_idx on public.sync_conflicts (sync_run_id);

create table public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  vault_secret_id uuid,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

comment on column public.integration_settings.vault_secret_id is
  'Reference to a Supabase Vault secret; never store provider credentials in settings.';

create index integration_settings_organization_id_idx
  on public.integration_settings (organization_id);

create table public.mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  key_prefix text not null check (char_length(key_prefix) between 6 and 24),
  key_hash text not null unique check (char_length(key_hash) >= 32),
  scopes text[] not null default '{}'::text[],
  created_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

comment on column public.mcp_api_keys.key_hash is
  'One-way hash of the API key. The plaintext key must never be persisted.';

create index mcp_api_keys_active_idx
  on public.mcp_api_keys (organization_id, expires_at)
  where revoked_at is null;

-- Generic timestamp maintenance.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'profiles', 'invites', 'projects', 'project_members',
    'todo_lists', 'todos', 'messages', 'comments', 'docs', 'files',
    'chat_messages', 'milestones', 'accelo_sync_runs', 'sync_conflicts',
    'integration_settings', 'mcp_api_keys'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function private.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end;
$$;

-- Internal-user authorization reads the server-managed profiles row. Keeping this
-- function outside an exposed schema avoids recursive RLS and API exposure.
create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function private.is_internal_user() from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_internal_user() to authenticated, service_role;

-- Create a profile for each Auth user. User metadata is used only for display
-- fields; role, status, and organization always come from trusted defaults.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    lower(coalesce(new.email, new.id::text || '@invalid.local')),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill profiles if this initial migration is installed after users exist.
insert into public.profiles (id, email, full_name, avatar_url)
select
  u.id,
  lower(coalesce(u.email, u.id::text || '@invalid.local')),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(u.email, ''), '@', 1),
    ''
  ),
  nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), '')
from auth.users u
on conflict (id) do nothing;

-- Minimal activity-feed records: entity identity and a human label only.
-- Content bodies, credentials, API-key hashes, and integration settings are never copied.
create or replace function private.capture_activity_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  activity_project_id uuid;
  activity_organization_id uuid;
  activity_entity_id uuid;
  activity_label text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  activity_entity_id := nullif(row_data ->> 'id', '')::uuid;

  if tg_table_name = 'projects' then
    activity_project_id := activity_entity_id;
    activity_organization_id := nullif(row_data ->> 'organization_id', '')::uuid;
  else
    activity_project_id := nullif(row_data ->> 'project_id', '')::uuid;
    activity_organization_id := nullif(row_data ->> 'organization_id', '')::uuid;
  end if;

  if activity_project_id is not null then
    select p.organization_id
      into activity_organization_id
      from public.projects p
      where p.id = activity_project_id;

    if not found then
      activity_project_id := null;
    end if;
  end if;

  activity_label := left(
    coalesce(
      nullif(row_data ->> 'title', ''),
      nullif(row_data ->> 'name', ''),
      nullif(row_data ->> 'file_name', ''),
      nullif(row_data ->> 'subject', '')
    ),
    160
  );

  insert into public.activity_events (
    organization_id,
    project_id,
    actor_id,
    entity_type,
    entity_id,
    action,
    summary,
    metadata
  )
  values (
    activity_organization_id,
    activity_project_id,
    (select auth.uid()),
    tg_argv[0],
    activity_entity_id,
    lower(tg_op),
    activity_label,
    jsonb_build_object('table', tg_table_name)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.capture_activity_event() from public;

do $$
declare
  item text[];
begin
  foreach item slice 1 in array array[
    array['projects', 'project'],
    array['project_members', 'project_member'],
    array['todo_lists', 'todo_list'],
    array['todos', 'todo'],
    array['messages', 'message'],
    array['comments', 'comment'],
    array['docs', 'doc'],
    array['files', 'file'],
    array['milestones', 'milestone']
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
       for each row execute function private.capture_activity_event(%L)',
      'capture_' || item[1] || '_activity',
      item[1],
      item[2]
    );
  end loop;
end;
$$;

-- Explicit grants are required by the current Supabase Data API defaults.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to service_role;

grant select on public.profiles to authenticated;
grant update (
  email, full_name, avatar_url, title, phone, timezone, preferences, last_seen_at
) on public.profiles to authenticated;
grant select on public.activity_events to authenticated;

grant select, insert, update, delete on
  public.organizations,
  public.invites,
  public.projects,
  public.project_members,
  public.todo_lists,
  public.todos,
  public.messages,
  public.comments,
  public.docs,
  public.files,
  public.chat_messages,
  public.milestones,
  public.accelo_sync_runs,
  public.sync_conflicts,
  public.integration_settings,
  public.mcp_api_keys
to authenticated;

-- Enable RLS on every P11 table and permit only active, authenticated internal users.
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
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated
       using ((select private.is_internal_user()))
       with check ((select private.is_internal_user()))',
      'Active internal users can access ' || table_name,
      table_name
    );
  end loop;
end;
$$;

-- Private project file bucket. Files are managed through the Storage API; the
-- public.files table stores application metadata and the object path.
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;

create policy "Internal users can read project files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.is_internal_user())
);

create policy "Internal users can upload project files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'project-files'
  and (select private.is_internal_user())
);

create policy "Internal users can update project files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.is_internal_user())
)
with check (
  bucket_id = 'project-files'
  and (select private.is_internal_user())
);

create policy "Internal users can delete project files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'project-files'
  and (select private.is_internal_user())
);

-- Campfire and the activity feed are delivered live through Supabase Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'activity_events'
  ) then
    alter publication supabase_realtime add table public.activity_events;
  end if;
end;
$$;
