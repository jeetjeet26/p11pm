alter table public.workspace_conversation_members
  add column revoked_at timestamptz;

create index workspace_conversation_members_active_profile_idx
  on public.workspace_conversation_members (profile_id, conversation_id)
  where revoked_at is null;

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
            and member.revoked_at is null
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
            and member.revoked_at is null
        )
      )
  );
$$;

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
    and member.revoked_at is null
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
  on conflict (conversation_id, profile_id) do update
    set added_by = excluded.added_by,
        joined_at = case
          when workspace_conversation_members.revoked_at is null
            then workspace_conversation_members.joined_at
          else now()
        end,
        revoked_at = null,
        updated_at = now()
    where workspace_conversation_members.member_role = 'member';

  update public.workspace_conversation_members as member
  set revoked_at = now(),
      updated_at = now()
  where member.conversation_id = target_conversation_id
    and member.member_role = 'member'
    and member.revoked_at is null
    and not (member.profile_id = any(normalized_member_ids));
end;
$$;

create or replace function public.get_workspace_conversation_summaries()
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
    and current_member.revoked_at is null
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
      and member.revoked_at is null
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
              and member.revoked_at is null
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
