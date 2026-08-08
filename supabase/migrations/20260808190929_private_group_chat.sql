-- Private channels, immutable group DMs, and workspace administration.

update public.profiles
set role = 'admin'
where lower(email) = 'jesse@p11.com';

alter table public.workspace_conversations
  add column visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  add column dm_member_key text;

update public.workspace_conversations
set visibility = 'private',
    dm_member_key = concat_ws(',', dm_profile_a::text, dm_profile_b::text)
where kind = 'dm';

alter table public.workspace_conversations
  drop constraint workspace_conversations_shape_check;

alter table public.workspace_conversations
  add constraint workspace_conversations_shape_check check (
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
      and dm_member_key is null
    )
    or
    (
      kind = 'dm'
      and name is null
      and slug is null
      and visibility = 'private'
      and dm_member_key is not null
      and char_length(dm_member_key) between 73 and 1849
      and (
        (
          dm_profile_a is not null
          and dm_profile_b is not null
          and dm_profile_a < dm_profile_b
        )
        or (
          dm_profile_a is null
          and dm_profile_b is null
        )
      )
    )
  );

create unique index workspace_dms_member_key_unique_idx
  on public.workspace_conversations (organization_id, dm_member_key)
  where kind = 'dm';

create table public.workspace_conversation_members (
  conversation_id uuid not null
    references public.workspace_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member'
    check (member_role in ('owner', 'member')),
  added_by uuid references public.profiles(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create index workspace_conversation_members_profile_idx
  on public.workspace_conversation_members (profile_id, conversation_id);
create index workspace_conversation_members_owner_idx
  on public.workspace_conversation_members (conversation_id, profile_id)
  where member_role = 'owner';

create trigger set_workspace_conversation_members_updated_at
  before update on public.workspace_conversation_members
  for each row execute function private.set_updated_at();

insert into public.workspace_conversation_members (
  conversation_id,
  profile_id,
  member_role,
  added_by
)
select
  conversation.id,
  member.profile_id,
  case
    when member.profile_id = coalesce(
      conversation.created_by,
      conversation.dm_profile_a
    ) then 'owner'
    else 'member'
  end,
  conversation.created_by
from public.workspace_conversations as conversation
cross join lateral (
  values (conversation.dm_profile_a), (conversation.dm_profile_b)
) as member(profile_id)
where conversation.kind = 'dm'
  and member.profile_id is not null
on conflict do nothing;

insert into public.workspace_conversation_members (
  conversation_id,
  profile_id,
  member_role,
  added_by
)
select
  conversation.id,
  conversation.created_by,
  'owner',
  conversation.created_by
from public.workspace_conversations as conversation
where conversation.kind = 'channel'
  and conversation.created_by is not null
on conflict do nothing;

create or replace function private.current_workspace_organization_id()
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

create or replace function private.is_workspace_admin()
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
      and profile.organization_id =
        (select private.current_workspace_organization_id())
      and profile.status = 'active'
      and profile.role = 'admin'
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
        (
          conversation.kind = 'channel'
          and conversation.visibility = 'public'
        )
        or exists (
          select 1
          from public.workspace_conversation_members as member
          where member.conversation_id = conversation.id
            and member.profile_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function private.can_manage_workspace_conversation(
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
        (select private.current_workspace_organization_id())
      and conversation.kind = 'channel'
      and (
        (select private.is_workspace_admin())
        or exists (
          select 1
          from public.workspace_conversation_members as member
          where member.conversation_id = conversation.id
            and member.profile_id = (select auth.uid())
            and member.member_role = 'owner'
        )
      )
  );
$$;

revoke all on function private.current_workspace_organization_id()
  from public;
revoke all on function private.is_workspace_admin() from public;
revoke all on function private.can_manage_workspace_conversation(uuid)
  from public;
grant execute on function private.current_workspace_organization_id()
  to authenticated, service_role;
grant execute on function private.is_workspace_admin()
  to authenticated, service_role;
grant execute on function private.can_manage_workspace_conversation(uuid)
  to authenticated, service_role;

revoke insert on public.workspace_conversations from authenticated;
revoke all on public.workspace_conversation_members from anon, authenticated;
grant select on public.workspace_conversation_members to authenticated;
grant all on public.workspace_conversation_members to service_role;

alter table public.workspace_conversation_members enable row level security;
alter table public.workspace_conversation_members replica identity full;

drop policy "Chat users can read accessible conversations"
  on public.workspace_conversations;
drop policy "Chat users can create accessible conversations"
  on public.workspace_conversations;

create policy "Chat users can read accessible conversations"
on public.workspace_conversations
for select
to authenticated
using ((select private.can_access_workspace_conversation(id)));

create policy "Chat users can read accessible membership"
on public.workspace_conversation_members
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or (select private.can_access_workspace_conversation(conversation_id))
  or (select private.can_manage_workspace_conversation(conversation_id))
);

create or replace function private.create_workspace_conversation(
  target_kind text,
  target_name text,
  target_slug text,
  target_visibility text,
  target_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_organization_id uuid;
  normalized_member_ids uuid[];
  normalized_member_key text;
  member_count integer;
  valid_member_count integer;
  result_conversation_id uuid;
  pair_a uuid;
  pair_b uuid;
begin
  select profile.organization_id
  into actor_organization_id
  from public.profiles as profile
  where profile.id = actor_id
    and profile.status = 'active'
    and profile.chat_enabled
    and profile.organization_id is not null;

  if actor_organization_id is null then
    raise insufficient_privilege using
      message = 'Your account does not have access to P11 Chat.';
  end if;

  select array_agg(member_id order by member_id)
  into normalized_member_ids
  from (
    select distinct member_id
    from unnest(
      array_append(
        coalesce(target_member_ids, '{}'::uuid[]),
        actor_id
      )
    ) as requested(member_id)
    where member_id is not null
  ) as normalized;

  member_count := coalesce(cardinality(normalized_member_ids), 0);
  if member_count < 1 or member_count > 50 then
    raise check_violation using
      message = 'Conversations can contain at most 50 members.';
  end if;

  select count(*)
  into valid_member_count
  from public.profiles as profile
  where profile.id = any(normalized_member_ids)
    and profile.organization_id = actor_organization_id
    and profile.status = 'active'
    and profile.chat_enabled;

  if valid_member_count <> member_count then
    raise check_violation using
      message = 'Every member must be an active P11 Chat user.';
  end if;

  if target_kind = 'channel' then
    if target_visibility not in ('public', 'private') then
      raise check_violation using
        message = 'Channels must be public or private.';
    end if;
    if char_length(btrim(coalesce(target_name, ''))) not between 1 and 80
      or coalesce(target_slug, '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    then
      raise check_violation using message = 'Invalid channel name.';
    end if;

    insert into public.workspace_conversations (
      organization_id,
      kind,
      name,
      slug,
      visibility,
      created_by
    )
    values (
      actor_organization_id,
      'channel',
      btrim(target_name),
      target_slug,
      target_visibility,
      actor_id
    )
    returning id into result_conversation_id;

    insert into public.workspace_conversation_members (
      conversation_id,
      profile_id,
      member_role,
      added_by
    )
    select
      result_conversation_id,
      member_id,
      case when member_id = actor_id then 'owner' else 'member' end,
      actor_id
    from unnest(normalized_member_ids) as member(member_id);

    return result_conversation_id;
  end if;

  if target_kind <> 'dm' or member_count < 2 then
    raise check_violation using
      message = 'Direct messages require at least two members.';
  end if;

  select string_agg(member_id::text, ',' order by member_id)
  into normalized_member_key
  from unnest(normalized_member_ids) as member(member_id);

  select conversation.id
  into result_conversation_id
  from public.workspace_conversations as conversation
  where conversation.organization_id = actor_organization_id
    and conversation.kind = 'dm'
    and conversation.dm_member_key = normalized_member_key;

  if result_conversation_id is not null then
    return result_conversation_id;
  end if;

  if member_count = 2 then
    pair_a := normalized_member_ids[1];
    pair_b := normalized_member_ids[2];
  end if;

  insert into public.workspace_conversations (
    organization_id,
    kind,
    visibility,
    dm_profile_a,
    dm_profile_b,
    dm_member_key,
    created_by
  )
  values (
    actor_organization_id,
    'dm',
    'private',
    pair_a,
    pair_b,
    normalized_member_key,
    actor_id
  )
  on conflict do nothing
  returning id into result_conversation_id;

  if result_conversation_id is null then
    select conversation.id
    into result_conversation_id
    from public.workspace_conversations as conversation
    where conversation.organization_id = actor_organization_id
      and conversation.kind = 'dm'
      and conversation.dm_member_key = normalized_member_key;
    return result_conversation_id;
  end if;

  insert into public.workspace_conversation_members (
    conversation_id,
    profile_id,
    member_role,
    added_by
  )
  select
    result_conversation_id,
    member_id,
    case when member_id = actor_id then 'owner' else 'member' end,
    actor_id
  from unnest(normalized_member_ids) as member(member_id);

  return result_conversation_id;
end;
$$;

create or replace function public.create_workspace_conversation(
  target_kind text,
  target_name text,
  target_slug text,
  target_visibility text,
  target_member_ids uuid[]
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_workspace_conversation(
    target_kind,
    target_name,
    target_slug,
    target_visibility,
    target_member_ids
  );
$$;

revoke all on function private.create_workspace_conversation(
  text,
  text,
  text,
  text,
  uuid[]
) from public;
grant execute on function private.create_workspace_conversation(
  text,
  text,
  text,
  text,
  uuid[]
) to authenticated, service_role;
revoke all on function public.create_workspace_conversation(
  text,
  text,
  text,
  text,
  uuid[]
) from public, anon;
grant execute on function public.create_workspace_conversation(
  text,
  text,
  text,
  text,
  uuid[]
) to authenticated, service_role;

create or replace function private.set_workspace_channel_members(
  target_conversation_id uuid,
  target_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_organization_id uuid;
  normalized_member_ids uuid[];
  member_count integer;
  preserved_owner_count integer;
  valid_member_count integer;
begin
  select conversation.organization_id
  into target_organization_id
  from public.workspace_conversations as conversation
  where conversation.id = target_conversation_id
    and conversation.kind = 'channel'
    and conversation.visibility = 'private';

  if target_organization_id is null
    or not (
      select private.can_manage_workspace_conversation(
        target_conversation_id
      )
    )
  then
    raise insufficient_privilege using
      message = 'You cannot manage this private channel.';
  end if;

  select coalesce(array_agg(member_id order by member_id), '{}'::uuid[])
  into normalized_member_ids
  from (
    select distinct member_id
    from unnest(coalesce(target_member_ids, '{}'::uuid[]))
      as requested(member_id)
    where member_id is not null
  ) as normalized;

  member_count := cardinality(normalized_member_ids);
  select count(*)
  into preserved_owner_count
  from public.workspace_conversation_members as member
  where member.conversation_id = target_conversation_id
    and member.member_role = 'owner'
    and not (member.profile_id = any(normalized_member_ids));

  if member_count + preserved_owner_count > 50 then
    raise check_violation using
      message = 'Channels can contain at most 50 members.';
  end if;

  select count(*)
  into valid_member_count
  from public.profiles as profile
  where profile.id = any(normalized_member_ids)
    and profile.organization_id = target_organization_id
    and profile.status = 'active'
    and profile.chat_enabled;

  if valid_member_count <> member_count then
    raise check_violation using
      message = 'Every member must be an active P11 Chat user.';
  end if;

  insert into public.workspace_conversation_members (
    conversation_id,
    profile_id,
    member_role,
    added_by
  )
  select
    target_conversation_id,
    member_id,
    'member',
    actor_id
  from unnest(normalized_member_ids) as member(member_id)
  on conflict (conversation_id, profile_id) do nothing;

  delete from public.workspace_conversation_members as member
  where member.conversation_id = target_conversation_id
    and member.member_role = 'member'
    and not (member.profile_id = any(normalized_member_ids));
end;
$$;

create or replace function public.set_workspace_channel_members(
  target_conversation_id uuid,
  target_member_ids uuid[]
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_workspace_channel_members(
    target_conversation_id,
    target_member_ids
  );
$$;

revoke all on function private.set_workspace_channel_members(uuid, uuid[])
  from public;
grant execute on function private.set_workspace_channel_members(uuid, uuid[])
  to authenticated, service_role;
revoke all on function public.set_workspace_channel_members(uuid, uuid[])
  from public, anon;
grant execute on function public.set_workspace_channel_members(uuid, uuid[])
  to authenticated, service_role;

drop function public.get_workspace_conversation_summaries();

create function public.get_workspace_conversation_summaries()
returns table (
  conversation_id uuid,
  organization_id uuid,
  kind text,
  visibility text,
  name text,
  slug text,
  dm_profile_a uuid,
  dm_profile_b uuid,
  dm_member_key text,
  members jsonb,
  current_member_role text,
  can_manage boolean,
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
    conversation.visibility,
    conversation.name,
    conversation.slug,
    conversation.dm_profile_a,
    conversation.dm_profile_b,
    conversation.dm_member_key,
    coalesce(member_list.members, '[]'::jsonb),
    current_member.member_role,
    (select private.can_manage_workspace_conversation(conversation.id)),
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
        and unread_message.parent_message_id is null
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
  left join public.workspace_conversation_members as current_member
    on current_member.conversation_id = conversation.id
    and current_member.profile_id = (select auth.uid())
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'profile_id', member.profile_id,
        'member_role', member.member_role
      )
      order by member.joined_at, member.profile_id
    ) as members
    from public.workspace_conversation_members as member
    where member.conversation_id = conversation.id
  ) as member_list on true
  left join lateral (
    select
      message.id,
      message.body,
      message.sender_id,
      message.created_at
    from public.workspace_messages as message
    where message.conversation_id = conversation.id
      and message.parent_message_id is null
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

create or replace function private.get_workspace_admin_profiles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select private.is_workspace_admin()) then
      null
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', profile.id,
          'email', profile.email,
          'full_name', profile.full_name,
          'title', profile.title,
          'role', profile.role,
          'status', profile.status,
          'chat_enabled', profile.chat_enabled
        )
        order by profile.full_name, profile.email
      )
      from public.profiles as profile
      where profile.organization_id =
        (select private.current_workspace_organization_id())
    ), '[]'::jsonb)
  end;
$$;

create or replace function public.get_workspace_admin_profiles()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := private.get_workspace_admin_profiles();
  if result is null then
    raise insufficient_privilege using
      message = 'Workspace administrator access is required.';
  end if;
  return result;
end;
$$;

create or replace function private.get_workspace_admin_channels()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not (select private.is_workspace_admin()) then
      null
    else coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', conversation.id,
          'name', conversation.name,
          'slug', conversation.slug,
          'visibility', conversation.visibility,
          'created_by', conversation.created_by,
          'members', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'profile_id', member.profile_id,
                'member_role', member.member_role
              )
              order by member.joined_at, member.profile_id
            )
            from public.workspace_conversation_members as member
            where member.conversation_id = conversation.id
          ), '[]'::jsonb)
        )
        order by conversation.name, conversation.id
      )
      from public.workspace_conversations as conversation
      where conversation.organization_id =
        (select private.current_workspace_organization_id())
        and conversation.kind = 'channel'
    ), '[]'::jsonb)
  end;
$$;

create or replace function public.get_workspace_admin_channels()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  result := private.get_workspace_admin_channels();
  if result is null then
    raise insufficient_privilege using
      message = 'Workspace administrator access is required.';
  end if;
  return result;
end;
$$;

create or replace function private.update_workspace_profile_admin(
  target_profile_id uuid,
  target_role text,
  target_status text,
  target_chat_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_is_active_admin boolean;
  active_admin_count integer;
begin
  if not (select private.is_workspace_admin()) then
    raise insufficient_privilege using
      message = 'Workspace administrator access is required.';
  end if;
  if target_role not in ('admin', 'manager', 'member', 'viewer')
    or target_status not in ('active', 'suspended', 'deactivated')
  then
    raise check_violation using message = 'Invalid workspace profile state.';
  end if;

  select profile.role = 'admin' and profile.status = 'active'
  into target_is_active_admin
  from public.profiles as profile
  where profile.id = target_profile_id
    and profile.organization_id =
      (select private.current_workspace_organization_id());

  if not found then
    raise no_data_found using message = 'Workspace profile not found.';
  end if;

  if target_is_active_admin
    and (target_role <> 'admin' or target_status <> 'active')
  then
    select count(*)
    into active_admin_count
    from public.profiles as profile
    where profile.organization_id =
      (select private.current_workspace_organization_id())
      and profile.role = 'admin'
      and profile.status = 'active';
    if active_admin_count <= 1 then
      raise check_violation using
        message = 'The workspace must keep at least one active administrator.';
    end if;
  end if;

  update public.profiles
  set role = target_role,
      status = target_status,
      chat_enabled = target_chat_enabled
  where id = target_profile_id;
end;
$$;

create or replace function public.update_workspace_profile_admin(
  target_profile_id uuid,
  target_role text,
  target_status text,
  target_chat_enabled boolean
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_workspace_profile_admin(
    target_profile_id,
    target_role,
    target_status,
    target_chat_enabled
  );
$$;

revoke all on function private.get_workspace_admin_profiles() from public;
revoke all on function private.get_workspace_admin_channels() from public;
revoke all on function private.update_workspace_profile_admin(
  uuid,
  text,
  text,
  boolean
) from public;
grant execute on function private.get_workspace_admin_profiles()
  to authenticated, service_role;
grant execute on function private.get_workspace_admin_channels()
  to authenticated, service_role;
grant execute on function private.update_workspace_profile_admin(
  uuid,
  text,
  text,
  boolean
) to authenticated, service_role;
revoke all on function public.get_workspace_admin_profiles()
  from public, anon;
revoke all on function public.get_workspace_admin_channels()
  from public, anon;
revoke all on function public.update_workspace_profile_admin(
  uuid,
  text,
  text,
  boolean
) from public, anon;
grant execute on function public.get_workspace_admin_profiles()
  to authenticated, service_role;
grant execute on function public.get_workspace_admin_channels()
  to authenticated, service_role;
grant execute on function public.update_workspace_profile_admin(
  uuid,
  text,
  text,
  boolean
) to authenticated, service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_conversations'
  ) then
    alter publication supabase_realtime
      add table public.workspace_conversations;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workspace_conversation_members'
  ) then
    alter publication supabase_realtime
      add table public.workspace_conversation_members;
  end if;
end;
$$;
