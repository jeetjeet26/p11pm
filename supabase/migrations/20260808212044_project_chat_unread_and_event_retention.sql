alter table public.workspace_chat_conversation_projection
  add column unread_count bigint not null default 0;

alter table public.workspace_chat_conversation_projection
  add constraint workspace_chat_projection_unread_count_check
  check (unread_count >= 0);

update public.workspace_chat_conversation_projection as projection
set unread_count = (
  select count(*)
  from public.workspace_messages as message
  where message.conversation_id = projection.conversation_id
    and message.parent_message_id is null
    and message.sender_id <> projection.profile_id
    and message.created_at > coalesce(
      (
        select read_state.last_read_at
        from public.workspace_conversation_reads as read_state
        where read_state.conversation_id = projection.conversation_id
          and read_state.profile_id = projection.profile_id
      ),
      '-infinity'::timestamptz
    )
);

create or replace function private.project_workspace_chat_conversation(
  target_profile_id uuid,
  target_conversation_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_kind text;
  target_visibility text;
  target_created_at timestamptz;
  latest_message_id uuid;
  latest_sender_id uuid;
  latest_message_at timestamptz;
  projected_unread_count bigint := 0;
  can_project boolean := false;
begin
  select
    conversation.organization_id,
    conversation.kind,
    conversation.visibility,
    conversation.created_at
  into
    target_organization_id,
    target_kind,
    target_visibility,
    target_created_at
  from public.workspace_conversations as conversation
  join public.profiles as profile
    on profile.id = target_profile_id
    and profile.organization_id = conversation.organization_id
    and profile.status = 'active'
    and profile.chat_enabled
  where conversation.id = target_conversation_id;

  if target_organization_id is not null then
    can_project :=
      (
        target_kind = 'channel'
        and target_visibility = 'public'
      )
      or exists (
        select 1
        from public.workspace_conversation_members as member
        where member.conversation_id = target_conversation_id
          and member.profile_id = target_profile_id
          and member.revoked_at is null
      );
  end if;

  if not can_project then
    delete from public.workspace_chat_conversation_projection as projection
    where projection.profile_id = target_profile_id
      and projection.conversation_id = target_conversation_id;
    return false;
  end if;

  select message.id, message.sender_id, message.created_at
  into latest_message_id, latest_sender_id, latest_message_at
  from public.workspace_messages as message
  where message.conversation_id = target_conversation_id
    and message.parent_message_id is null
  order by message.created_at desc, message.id desc
  limit 1;

  select count(*)
  into projected_unread_count
  from public.workspace_messages as message
  where message.conversation_id = target_conversation_id
    and message.parent_message_id is null
    and message.sender_id <> target_profile_id
    and message.created_at > coalesce(
      (
        select read_state.last_read_at
        from public.workspace_conversation_reads as read_state
        where read_state.conversation_id = target_conversation_id
          and read_state.profile_id = target_profile_id
      ),
      '-infinity'::timestamptz
    );

  insert into public.workspace_chat_conversation_projection (
    profile_id,
    conversation_id,
    organization_id,
    kind_rank,
    sort_at,
    last_message_id,
    last_message_sender_id,
    last_message_at,
    unread_count,
    updated_at
  )
  values (
    target_profile_id,
    target_conversation_id,
    target_organization_id,
    case when target_kind = 'channel' then 0 else 1 end,
    coalesce(latest_message_at, target_created_at),
    latest_message_id,
    latest_sender_id,
    latest_message_at,
    projected_unread_count,
    now()
  )
  on conflict (profile_id, conversation_id) do update
  set organization_id = excluded.organization_id,
      kind_rank = excluded.kind_rank,
      sort_at = excluded.sort_at,
      last_message_id = excluded.last_message_id,
      last_message_sender_id = excluded.last_message_sender_id,
      last_message_at = excluded.last_message_at,
      unread_count = excluded.unread_count,
      updated_at = now();

  return true;
end;
$$;

create or replace function private.sync_workspace_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
begin
  if new.parent_message_id is null then
    update public.workspace_chat_conversation_projection as projection
    set sort_at = new.created_at,
        last_message_id = new.id,
        last_message_sender_id = new.sender_id,
        last_message_at = new.created_at,
        updated_at = now()
    where projection.conversation_id = new.conversation_id
      and (
        projection.last_message_at is null
        or (new.created_at, new.id) >= (
          projection.last_message_at,
          projection.last_message_id
        )
      );

    update public.workspace_chat_conversation_projection as projection
    set unread_count = projection.unread_count + 1,
        updated_at = now()
    where projection.conversation_id = new.conversation_id
      and projection.profile_id <> new.sender_id
      and new.created_at > coalesce(
        (
          select read_state.last_read_at
          from public.workspace_conversation_reads as read_state
          where read_state.conversation_id = new.conversation_id
            and read_state.profile_id = projection.profile_id
        ),
        '-infinity'::timestamptz
      );
  end if;

  for target_profile_id in
    select projection.profile_id
    from public.workspace_chat_conversation_projection as projection
    where projection.conversation_id = new.conversation_id
  loop
    perform private.enqueue_workspace_chat_event(
      target_profile_id,
      'message.created',
      new.conversation_id,
      new.id,
      new.parent_message_id,
      new.sender_id,
      new.created_at
    );
  end loop;

  return null;
end;
$$;

create or replace function private.sync_workspace_conversation_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_read_at timestamptz :=
    case
      when tg_op = 'UPDATE' then old.last_read_at
      else '-infinity'::timestamptz
    end;
begin
  if new.last_read_at <= previous_read_at then
    return null;
  end if;

  update public.workspace_chat_conversation_projection as projection
  set unread_count = greatest(
        0,
        projection.unread_count - (
          select count(*)
          from public.workspace_messages as message
          where message.conversation_id = new.conversation_id
            and message.parent_message_id is null
            and message.sender_id <> new.profile_id
            and message.created_at > previous_read_at
            and message.created_at <= new.last_read_at
        )
      ),
      updated_at = now()
  where projection.profile_id = new.profile_id
    and projection.conversation_id = new.conversation_id;

  perform private.enqueue_workspace_chat_event(
    new.profile_id,
    'conversation.read',
    new.conversation_id,
    null,
    null,
    new.profile_id,
    new.last_read_at
  );
  return null;
end;
$$;

create or replace function public.get_workspace_conversation_summaries_page(
  after_kind_rank integer default null,
  after_sort_at timestamptz default null,
  after_conversation_id uuid default null,
  requested_limit integer default 50,
  target_conversation_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select greatest(1, least(requested_limit, 100)) as page_limit
  ),
  candidates as materialized (
    select
      projection.kind_rank,
      projection.sort_at,
      projection.last_message_id,
      projection.last_message_sender_id,
      projection.last_message_at,
      projection.unread_count,
      conversation.id,
      conversation.organization_id,
      conversation.kind,
      conversation.visibility,
      conversation.name,
      conversation.slug,
      conversation.dm_profile_a,
      conversation.dm_profile_b,
      conversation.dm_member_key,
      conversation.created_at,
      conversation.updated_at
    from public.workspace_chat_conversation_projection as projection
    join public.workspace_conversations as conversation
      on conversation.id = projection.conversation_id
    cross join settings
    where projection.profile_id = (select auth.uid())
      and (
        (
          target_conversation_id is not null
          and projection.conversation_id = target_conversation_id
        )
        or (
          target_conversation_id is null
          and (
            after_kind_rank is null
            or projection.kind_rank > after_kind_rank
            or (
              projection.kind_rank = after_kind_rank
              and projection.sort_at < after_sort_at
            )
            or (
              projection.kind_rank = after_kind_rank
              and projection.sort_at = after_sort_at
              and projection.conversation_id > after_conversation_id
            )
          )
        )
      )
    order by
      projection.kind_rank,
      projection.sort_at desc,
      projection.conversation_id
    limit (
      case
        when target_conversation_id is null then
          (select page_limit + 1 from settings)
        else 1
      end
    )
  ),
  page_rows as materialized (
    select candidate.*
    from candidates as candidate
    order by candidate.kind_rank, candidate.sort_at desc, candidate.id
    limit (select page_limit from settings)
  ),
  summaries as (
    select
      page.kind_rank,
      page.sort_at,
      page.id,
      page.organization_id,
      page.kind,
      page.visibility,
      page.name,
      page.slug,
      page.dm_profile_a,
      page.dm_profile_b,
      page.dm_member_key,
      coalesce(member_preview.members, '[]'::jsonb) as members,
      coalesce(member_count.total, 0) as member_count,
      current_member.member_role as current_member_role,
      (select private.can_manage_workspace_conversation(page.id))
        as can_manage,
      page.created_at,
      page.updated_at,
      page.last_message_id,
      latest_message.body as last_message_body,
      page.last_message_sender_id,
      page.last_message_at,
      page.unread_count
    from page_rows as page
    left join public.workspace_conversation_members as current_member
      on current_member.conversation_id = page.id
      and current_member.profile_id = (select auth.uid())
      and current_member.revoked_at is null
    left join public.workspace_messages as latest_message
      on latest_message.id = page.last_message_id
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', preview.profile_id,
          'member_role', preview.member_role
        )
        order by preview.joined_at, preview.profile_id
      ) as members
      from (
        select member.profile_id, member.member_role, member.joined_at
        from public.workspace_conversation_members as member
        where member.conversation_id = page.id
          and member.revoked_at is null
        order by member.joined_at, member.profile_id
        limit 4
      ) as preview
    ) as member_preview on true
    left join lateral (
      select count(*) as total
      from public.workspace_conversation_members as member
      where member.conversation_id = page.id
        and member.revoked_at is null
    ) as member_count on true
  ),
  last_page_row as (
    select summary.kind_rank, summary.sort_at, summary.id
    from summaries as summary
    order by summary.kind_rank desc, summary.sort_at, summary.id desc
    limit 1
  )
  select jsonb_build_object(
    'conversations',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'conversation_id', summary.id,
          'organization_id', summary.organization_id,
          'kind', summary.kind,
          'visibility', summary.visibility,
          'name', summary.name,
          'slug', summary.slug,
          'dm_profile_a', summary.dm_profile_a,
          'dm_profile_b', summary.dm_profile_b,
          'dm_member_key', summary.dm_member_key,
          'members', summary.members,
          'member_count', summary.member_count,
          'roster_loaded', false,
          'current_member_role', summary.current_member_role,
          'can_manage', summary.can_manage,
          'created_at', summary.created_at,
          'updated_at', summary.updated_at,
          'last_message_id', summary.last_message_id,
          'last_message_body', summary.last_message_body,
          'last_message_sender_id', summary.last_message_sender_id,
          'last_message_at', summary.last_message_at,
          'unread_count', summary.unread_count
        )
        order by summary.kind_rank, summary.sort_at desc, summary.id
      )
      from summaries as summary
    ), '[]'::jsonb),
    'has_more',
    target_conversation_id is null
      and (select count(*) from candidates) >
        (select page_limit from settings),
    'next_cursor',
    case
      when target_conversation_id is not null
        or not exists (select 1 from last_page_row)
      then null
      else (
        select jsonb_build_object(
          'kind_rank', last_page_row.kind_rank,
          'sort_at', last_page_row.sort_at,
          'conversation_id', last_page_row.id
        )
        from last_page_row
      )
    end
  );
$$;

create index workspace_chat_events_event_at_idx
  on public.workspace_chat_events (event_at, profile_id, sequence);

create or replace function public.cleanup_workspace_chat_events(
  requested_limit integer default 1000
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  deleted_count integer := 0;
begin
  with stale_events as materialized (
    select event.profile_id, event.sequence
    from public.workspace_chat_events as event
    where event.event_at < now() - interval '7 days'
    order by event.event_at, event.profile_id, event.sequence
    for update of event skip locked
    limit greatest(1, least(coalesce(requested_limit, 1000), 10000))
  ),
  deleted as (
    delete from public.workspace_chat_events as event
    using stale_events
    where event.profile_id = stale_events.profile_id
      and event.sequence = stale_events.sequence
    returning 1
  )
  select count(*)::integer
  into deleted_count
  from deleted;

  return deleted_count;
end;
$$;

revoke all on function public.cleanup_workspace_chat_events(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_workspace_chat_events(integer)
  to service_role;
