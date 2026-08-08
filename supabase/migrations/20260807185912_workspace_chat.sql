-- Organization-scoped public channels and private one-to-one direct messages.
-- Project Campfire remains on public.chat_messages.

alter table public.profiles
  add column chat_enabled boolean not null default false;

comment on column public.profiles.chat_enabled is
  'Server-managed marker indicating that the profile has a matching Auth account.';

update public.profiles as profile
set chat_enabled = true
where exists (
  select 1
  from auth.users as auth_user
  where auth_user.id = profile.id
);

create index profiles_chat_enabled_organization_idx
  on public.profiles (organization_id, full_name)
  where chat_enabled and status = 'active';

-- Keep imported Basecamp identities and Auth users joined by the same UUID.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    chat_enabled
  )
  values (
    new.id,
    lower(coalesce(new.email, new.id::text || '@invalid.local')),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    ),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    true
  )
  on conflict (id) do update
  set chat_enabled = true,
      updated_at = now();

  return new;
end;
$$;

create or replace function private.handle_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set chat_enabled = false
  where id = old.id;

  return old;
end;
$$;

revoke all on function private.handle_deleted_auth_user() from public;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function private.handle_deleted_auth_user();

create table public.workspace_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('channel', 'dm')),
  name text,
  slug text,
  dm_profile_a uuid references public.profiles(id) on delete cascade,
  dm_profile_b uuid references public.profiles(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_conversations_shape_check check (
    (
      kind = 'channel'
      and name is not null
      and char_length(btrim(name)) between 1 and 80
      and slug is not null
      and char_length(slug) between 1 and 64
      and slug = lower(slug)
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and dm_profile_a is null
      and dm_profile_b is null
    )
    or
    (
      kind = 'dm'
      and name is null
      and slug is null
      and dm_profile_a is not null
      and dm_profile_b is not null
      and dm_profile_a < dm_profile_b
    )
  )
);

create unique index workspace_channels_slug_unique_idx
  on public.workspace_conversations (organization_id, slug)
  where kind = 'channel';
create unique index workspace_dms_pair_unique_idx
  on public.workspace_conversations (
    organization_id,
    dm_profile_a,
    dm_profile_b
  )
  where kind = 'dm';
create index workspace_conversations_organization_kind_idx
  on public.workspace_conversations (organization_id, kind, created_at);
create index workspace_conversations_dm_profile_a_idx
  on public.workspace_conversations (dm_profile_a)
  where kind = 'dm';
create index workspace_conversations_dm_profile_b_idx
  on public.workspace_conversations (dm_profile_b)
  where kind = 'dm';
create index workspace_conversations_created_by_idx
  on public.workspace_conversations (created_by);

create table public.workspace_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.workspace_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  client_nonce uuid not null,
  created_at timestamptz not null default now(),
  unique (sender_id, client_nonce)
);

create index workspace_messages_conversation_created_idx
  on public.workspace_messages (conversation_id, created_at desc, id desc);

create table public.workspace_conversation_reads (
  conversation_id uuid not null
    references public.workspace_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create index workspace_conversation_reads_profile_idx
  on public.workspace_conversation_reads (profile_id, last_read_at desc);

create trigger set_workspace_conversations_updated_at
  before update on public.workspace_conversations
  for each row execute function private.set_updated_at();

create trigger set_workspace_conversation_reads_updated_at
  before update on public.workspace_conversation_reads
  for each row execute function private.set_updated_at();

create or replace function private.keep_workspace_read_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.last_read_at := greatest(old.last_read_at, new.last_read_at);
  return new;
end;
$$;

create trigger keep_workspace_read_monotonic
  before update on public.workspace_conversation_reads
  for each row execute function private.keep_workspace_read_monotonic();

create or replace function private.current_chat_organization_id()
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
    and profile.chat_enabled
    and profile.organization_id is not null;
$$;

create or replace function private.profile_can_chat(
  target_profile_id uuid,
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
    where profile.id = target_profile_id
      and profile.organization_id = target_organization_id
      and profile.status = 'active'
      and profile.chat_enabled
  );
$$;

create or replace function private.can_access_workspace_conversation(
  target_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_conversations as conversation
    where conversation.id = target_conversation_id
      and conversation.organization_id =
        (select private.current_chat_organization_id())
      and (
        conversation.kind = 'channel'
        or (select auth.uid()) in (
          conversation.dm_profile_a,
          conversation.dm_profile_b
        )
      )
  );
$$;

revoke all on function private.current_chat_organization_id() from public;
revoke all on function private.profile_can_chat(uuid, uuid) from public;
revoke all on function private.can_access_workspace_conversation(uuid) from public;
revoke all on function private.keep_workspace_read_monotonic() from public;
grant usage on schema private to authenticated, service_role;
grant execute on function private.current_chat_organization_id()
  to authenticated, service_role;
grant execute on function private.profile_can_chat(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.can_access_workspace_conversation(uuid)
  to authenticated, service_role;

revoke all on public.workspace_conversations from anon, authenticated;
revoke all on public.workspace_messages from anon, authenticated;
revoke all on public.workspace_conversation_reads from anon, authenticated;

grant select, insert on public.workspace_conversations to authenticated;
grant select, insert on public.workspace_messages to authenticated;
grant select, insert, update on public.workspace_conversation_reads
  to authenticated;
grant all on public.workspace_conversations to service_role;
grant all on public.workspace_messages to service_role;
grant all on public.workspace_conversation_reads to service_role;

alter table public.workspace_conversations enable row level security;
alter table public.workspace_messages enable row level security;
alter table public.workspace_conversation_reads enable row level security;

create policy "Chat users can read accessible conversations"
on public.workspace_conversations
for select
to authenticated
using (
  organization_id = (select private.current_chat_organization_id())
  and (
    kind = 'channel'
    or (select auth.uid()) in (dm_profile_a, dm_profile_b)
  )
);

create policy "Chat users can create accessible conversations"
on public.workspace_conversations
for insert
to authenticated
with check (
  organization_id = (select private.current_chat_organization_id())
  and created_by = (select auth.uid())
  and (
    kind = 'channel'
    or (
      kind = 'dm'
      and (select auth.uid()) in (dm_profile_a, dm_profile_b)
      and (
        select private.profile_can_chat(
          case
            when dm_profile_a = (select auth.uid()) then dm_profile_b
            else dm_profile_a
          end,
          organization_id
        )
      )
    )
  )
);

create policy "Chat users can read accessible messages"
on public.workspace_messages
for select
to authenticated
using (
  (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Chat users can send as themselves"
on public.workspace_messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Chat users can read their read state"
on public.workspace_conversation_reads
for select
to authenticated
using (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Chat users can create their read state"
on public.workspace_conversation_reads
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Chat users can advance their read state"
on public.workspace_conversation_reads
for update
to authenticated
using (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
)
with check (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);

create or replace function public.get_workspace_conversation_summaries()
returns table (
  conversation_id uuid,
  organization_id uuid,
  kind text,
  name text,
  slug text,
  dm_profile_a uuid,
  dm_profile_b uuid,
  created_at timestamptz,
  updated_at timestamptz,
  last_message_id uuid,
  last_message_body text,
  last_message_sender_id uuid,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    conversation.id,
    conversation.organization_id,
    conversation.kind,
    conversation.name,
    conversation.slug,
    conversation.dm_profile_a,
    conversation.dm_profile_b,
    conversation.created_at,
    conversation.updated_at,
    latest_message.id,
    latest_message.body,
    latest_message.sender_id,
    latest_message.created_at,
    (
      select count(*)
      from public.workspace_messages as unread_message
      where unread_message.conversation_id = conversation.id
        and unread_message.sender_id <> (select auth.uid())
        and unread_message.created_at > coalesce(
          read_state.last_read_at,
          '-infinity'::timestamptz
        )
    )
  from public.workspace_conversations as conversation
  left join public.workspace_conversation_reads as read_state
    on read_state.conversation_id = conversation.id
    and read_state.profile_id = (select auth.uid())
  left join lateral (
    select
      message.id,
      message.body,
      message.sender_id,
      message.created_at
    from public.workspace_messages as message
    where message.conversation_id = conversation.id
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest_message on true
  order by
    case when conversation.kind = 'channel' then 0 else 1 end,
    coalesce(latest_message.created_at, conversation.created_at) desc,
    conversation.id;
$$;

revoke all on function public.get_workspace_conversation_summaries()
  from public, anon;
grant execute on function public.get_workspace_conversation_summaries()
  to authenticated, service_role;

create or replace function public.get_workspace_messages_page(
  target_conversation_id uuid,
  before_created_at timestamptz default null,
  before_message_id uuid default null,
  requested_limit integer default 50
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  client_nonce uuid,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    message.id,
    message.conversation_id,
    message.sender_id,
    message.body,
    message.client_nonce,
    message.created_at
  from public.workspace_messages as message
  where message.conversation_id = target_conversation_id
    and (
      before_created_at is null
      or before_message_id is null
      or (message.created_at, message.id) <
        (before_created_at, before_message_id)
    )
  order by message.created_at desc, message.id desc
  limit greatest(1, least(requested_limit, 100));
$$;

revoke all on function public.get_workspace_messages_page(
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_workspace_messages_page(
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;

insert into public.workspace_conversations (
  organization_id,
  kind,
  name,
  slug
)
select
  organization.id,
  'channel',
  'general',
  'general'
from public.organizations as organization
where exists (
  select 1
  from public.profiles as profile
  where profile.organization_id = organization.id
)
on conflict do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_messages'
  ) then
    alter publication supabase_realtime
      add table public.workspace_messages;
  end if;
end;
$$;
