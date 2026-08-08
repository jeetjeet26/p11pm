-- Durable per-user chat synchronization. This is intentionally additive so
-- clients using the existing Postgres Changes publications continue to work.

create table public.workspace_chat_conversation_projection (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null
    references public.workspace_conversations(id) on delete cascade,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  kind_rank smallint not null check (kind_rank in (0, 1)),
  sort_at timestamptz not null,
  last_message_id uuid references public.workspace_messages(id) on delete set null,
  last_message_sender_id uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  projected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, conversation_id)
);

create index workspace_chat_projection_page_idx
  on public.workspace_chat_conversation_projection (
    profile_id,
    kind_rank,
    sort_at desc,
    conversation_id
  );

create table public.workspace_chat_sync_cursors (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table public.workspace_chat_events (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'message.created',
      'conversation.upsert',
      'conversation.revoked',
      'conversation.read',
      'thread.read',
      'workspace.reset',
      'workspace.revoked'
    )
  ),
  conversation_id uuid,
  message_id uuid,
  parent_message_id uuid,
  sender_id uuid,
  event_at timestamptz not null default now(),
  primary key (profile_id, sequence)
);

create index workspace_chat_events_conversation_idx
  on public.workspace_chat_events (
    profile_id,
    conversation_id,
    sequence desc
  )
  where conversation_id is not null;

revoke all on public.workspace_chat_conversation_projection
  from anon, authenticated;
revoke all on public.workspace_chat_sync_cursors from anon, authenticated;
revoke all on public.workspace_chat_events from anon, authenticated;

grant select on public.workspace_chat_conversation_projection to authenticated;
grant select on public.workspace_chat_sync_cursors to authenticated;
grant select on public.workspace_chat_events to authenticated;
grant all on public.workspace_chat_conversation_projection to service_role;
grant all on public.workspace_chat_sync_cursors to service_role;
grant all on public.workspace_chat_events to service_role;

alter table public.workspace_chat_conversation_projection
  enable row level security;
alter table public.workspace_chat_sync_cursors enable row level security;
alter table public.workspace_chat_events enable row level security;

create policy "Chat users can read their conversation projection"
on public.workspace_chat_conversation_projection
for select
to authenticated
using (
  profile_id = (select auth.uid())
  and organization_id = (select private.current_chat_organization_id())
);

create policy "Chat users can read their sync cursor"
on public.workspace_chat_sync_cursors
for select
to authenticated
using (profile_id = (select auth.uid()));

create policy "Chat users can catch up their durable events"
on public.workspace_chat_events
for select
to authenticated
using (
  profile_id = (select auth.uid())
  and organization_id = (select private.current_chat_organization_id())
);

create policy "Users can receive their workspace chat sync broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() =
    ('workspace-membership:' || (select auth.uid())::text)
);

create or replace function private.enqueue_workspace_chat_event(
  target_profile_id uuid,
  target_event_type text,
  target_conversation_id uuid default null,
  target_message_id uuid default null,
  target_parent_message_id uuid default null,
  target_sender_id uuid default null,
  target_event_at timestamptz default now()
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  next_sequence bigint;
begin
  select profile.organization_id
  into target_organization_id
  from public.profiles as profile
  where profile.id = target_profile_id
    and profile.organization_id is not null;

  if target_organization_id is null then
    return null;
  end if;

  insert into public.workspace_chat_sync_cursors (
    profile_id,
    last_sequence,
    updated_at
  )
  values (target_profile_id, 1, now())
  on conflict (profile_id) do update
  set last_sequence =
        public.workspace_chat_sync_cursors.last_sequence + 1,
      updated_at = now()
  returning last_sequence into next_sequence;

  insert into public.workspace_chat_events (
    profile_id,
    sequence,
    organization_id,
    event_type,
    conversation_id,
    message_id,
    parent_message_id,
    sender_id,
    event_at
  )
  values (
    target_profile_id,
    next_sequence,
    target_organization_id,
    target_event_type,
    target_conversation_id,
    target_message_id,
    target_parent_message_id,
    target_sender_id,
    target_event_at
  );

  return next_sequence;
end;
$$;

revoke all on function private.enqueue_workspace_chat_event(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) from public;
grant execute on function private.enqueue_workspace_chat_event(
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz
) to service_role;

create or replace function private.broadcast_workspace_chat_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'sequence', new.sequence::text,
      'type', new.event_type,
      'conversation_id', new.conversation_id,
      'message_id', new.message_id,
      'parent_message_id', new.parent_message_id,
      'sender_id', new.sender_id,
      'event_at', new.event_at
    ),
    'workspace-chat-sync',
    'workspace-membership:' || new.profile_id::text,
    true
  );

  return null;
end;
$$;

revoke all on function private.broadcast_workspace_chat_event() from public;

create trigger broadcast_workspace_chat_event
after insert on public.workspace_chat_events
for each row execute function private.broadcast_workspace_chat_event();

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

  insert into public.workspace_chat_conversation_projection (
    profile_id,
    conversation_id,
    organization_id,
    kind_rank,
    sort_at,
    last_message_id,
    last_message_sender_id,
    last_message_at,
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
    now()
  )
  on conflict (profile_id, conversation_id) do update
  set organization_id = excluded.organization_id,
      kind_rank = excluded.kind_rank,
      sort_at = excluded.sort_at,
      last_message_id = excluded.last_message_id,
      last_message_sender_id = excluded.last_message_sender_id,
      last_message_at = excluded.last_message_at,
      updated_at = now();

  return true;
end;
$$;

revoke all on function private.project_workspace_chat_conversation(uuid, uuid)
  from public;
grant execute on function private.project_workspace_chat_conversation(uuid, uuid)
  to service_role;

insert into public.workspace_chat_conversation_projection (
  profile_id,
  conversation_id,
  organization_id,
  kind_rank,
  sort_at,
  last_message_id,
  last_message_sender_id,
  last_message_at
)
select
  profile.id,
  conversation.id,
  conversation.organization_id,
  case when conversation.kind = 'channel' then 0 else 1 end,
  coalesce(latest_message.created_at, conversation.created_at),
  latest_message.id,
  latest_message.sender_id,
  latest_message.created_at
from public.profiles as profile
join public.workspace_conversations as conversation
  on conversation.organization_id = profile.organization_id
left join lateral (
  select message.id, message.sender_id, message.created_at
  from public.workspace_messages as message
  where message.conversation_id = conversation.id
    and message.parent_message_id is null
  order by message.created_at desc, message.id desc
  limit 1
) as latest_message on true
where profile.status = 'active'
  and profile.chat_enabled
  and (
    (
      conversation.kind = 'channel'
      and conversation.visibility = 'public'
    )
    or exists (
      select 1
      from public.workspace_conversation_members as member
      where member.conversation_id = conversation.id
        and member.profile_id = profile.id
        and member.revoked_at is null
    )
  )
on conflict do nothing;

insert into public.workspace_chat_sync_cursors (profile_id, last_sequence)
select profile.id, 0
from public.profiles as profile
where profile.status = 'active'
  and profile.chat_enabled
  and profile.organization_id is not null
on conflict do nothing;

create or replace function private.sync_workspace_chat_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid := coalesce(new.profile_id, old.profile_id);
  target_conversation_id uuid :=
    coalesce(new.conversation_id, old.conversation_id);
  was_projected boolean;
  is_projected boolean;
begin
  select exists (
    select 1
    from public.workspace_chat_conversation_projection as projection
    where projection.profile_id = target_profile_id
      and projection.conversation_id = target_conversation_id
  )
  into was_projected;

  is_projected := private.project_workspace_chat_conversation(
    target_profile_id,
    target_conversation_id
  );

  if is_projected then
    perform private.enqueue_workspace_chat_event(
      target_profile_id,
      'conversation.upsert',
      target_conversation_id
    );
  elsif was_projected then
    perform private.enqueue_workspace_chat_event(
      target_profile_id,
      'conversation.revoked',
      target_conversation_id
    );
  end if;

  return null;
end;
$$;

revoke all on function private.sync_workspace_chat_membership() from public;

create trigger sync_workspace_chat_membership
after insert or update or delete
on public.workspace_conversation_members
for each row execute function private.sync_workspace_chat_membership();

create or replace function private.sync_workspace_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
  target_conversation_id uuid := coalesce(new.id, old.id);
  was_projected boolean;
  is_projected boolean;
begin
  for target_profile_id in
    select candidate.profile_id
    from (
      select projection.profile_id
      from public.workspace_chat_conversation_projection as projection
      where projection.conversation_id = target_conversation_id
      union
      select member.profile_id
      from public.workspace_conversation_members as member
      where member.conversation_id = target_conversation_id
        and member.revoked_at is null
      union
      select profile.id
      from public.profiles as profile
      where new.id is not null
        and new.kind = 'channel'
        and new.visibility = 'public'
        and profile.organization_id = new.organization_id
        and profile.status = 'active'
        and profile.chat_enabled
    ) as candidate
  loop
    select exists (
      select 1
      from public.workspace_chat_conversation_projection as projection
      where projection.profile_id = target_profile_id
        and projection.conversation_id = target_conversation_id
    )
    into was_projected;

    is_projected := private.project_workspace_chat_conversation(
      target_profile_id,
      target_conversation_id
    );

    if is_projected then
      perform private.enqueue_workspace_chat_event(
        target_profile_id,
        'conversation.upsert',
        target_conversation_id
      );
    elsif was_projected then
      perform private.enqueue_workspace_chat_event(
        target_profile_id,
        'conversation.revoked',
        target_conversation_id
      );
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function private.sync_workspace_chat_conversation() from public;

create trigger sync_workspace_chat_conversation
after insert or update
on public.workspace_conversations
for each row execute function private.sync_workspace_chat_conversation();

create or replace function private.revoke_deleted_workspace_chat_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
begin
  for target_profile_id in
    select projection.profile_id
    from public.workspace_chat_conversation_projection as projection
    where projection.conversation_id = old.id
  loop
    perform private.enqueue_workspace_chat_event(
      target_profile_id,
      'conversation.revoked',
      old.id
    );
  end loop;

  return old;
end;
$$;

revoke all on function private.revoke_deleted_workspace_chat_conversation()
  from public;

create trigger revoke_deleted_workspace_chat_conversation
before delete on public.workspace_conversations
for each row execute function private.revoke_deleted_workspace_chat_conversation();

create or replace function private.sync_workspace_chat_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_conversation_id uuid;
  profile_is_eligible boolean :=
    new.status = 'active'
    and new.chat_enabled
    and new.organization_id is not null;
begin
  if not profile_is_eligible then
    if exists (
      select 1
      from public.workspace_chat_sync_cursors as cursor_state
      where cursor_state.profile_id = new.id
    ) then
      perform private.enqueue_workspace_chat_event(
        new.id,
        'workspace.revoked'
      );
    end if;

    delete from public.workspace_chat_conversation_projection as projection
    where projection.profile_id = new.id;
    return null;
  end if;

  for target_conversation_id in
    select candidate.conversation_id
    from (
      select projection.conversation_id
      from public.workspace_chat_conversation_projection as projection
      where projection.profile_id = new.id
      union
      select conversation.id
      from public.workspace_conversations as conversation
      where conversation.organization_id = new.organization_id
        and conversation.kind = 'channel'
        and conversation.visibility = 'public'
      union
      select member.conversation_id
      from public.workspace_conversation_members as member
      join public.workspace_conversations as conversation
        on conversation.id = member.conversation_id
        and conversation.organization_id = new.organization_id
      where member.profile_id = new.id
        and member.revoked_at is null
    ) as candidate
  loop
    perform private.project_workspace_chat_conversation(
      new.id,
      target_conversation_id
    );
  end loop;

  perform private.enqueue_workspace_chat_event(new.id, 'workspace.reset');
  return null;
end;
$$;

revoke all on function private.sync_workspace_chat_profile() from public;

create trigger sync_workspace_chat_profile_insert
after insert on public.profiles
for each row execute function private.sync_workspace_chat_profile();

create trigger sync_workspace_chat_profile_update
after update of organization_id, role, status, chat_enabled
on public.profiles
for each row execute function private.sync_workspace_chat_profile();

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

revoke all on function private.sync_workspace_chat_message() from public;

create trigger sync_workspace_chat_message
after insert on public.workspace_messages
for each row execute function private.sync_workspace_chat_message();

create or replace function private.sync_workspace_conversation_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

revoke all on function private.sync_workspace_conversation_read() from public;

create trigger sync_workspace_conversation_read
after insert or update of last_read_at
on public.workspace_conversation_reads
for each row execute function private.sync_workspace_conversation_read();

create or replace function private.sync_workspace_thread_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_conversation_id uuid;
begin
  select message.conversation_id
  into target_conversation_id
  from public.workspace_messages as message
  where message.id = new.root_message_id;

  if target_conversation_id is not null then
    perform private.enqueue_workspace_chat_event(
      new.profile_id,
      'thread.read',
      target_conversation_id,
      new.root_message_id,
      null,
      new.profile_id,
      new.last_read_at
    );
  end if;

  return null;
end;
$$;

revoke all on function private.sync_workspace_thread_read() from public;

create trigger sync_workspace_thread_read
after insert or update of last_read_at
on public.workspace_thread_reads
for each row execute function private.sync_workspace_thread_read();

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
      (
        select count(*)
        from public.workspace_messages as unread_message
        where unread_message.conversation_id = page.id
          and unread_message.parent_message_id is null
          and unread_message.sender_id <> (select auth.uid())
          and unread_message.created_at > coalesce(
            read_state.last_read_at,
            '-infinity'::timestamptz
          )
      ) as unread_count
    from page_rows as page
    left join public.workspace_conversation_reads as read_state
      on read_state.conversation_id = page.id
      and read_state.profile_id = (select auth.uid())
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

revoke all on function public.get_workspace_conversation_summaries_page(
  integer,
  timestamptz,
  uuid,
  integer,
  uuid
) from public, anon;
grant execute on function public.get_workspace_conversation_summaries_page(
  integer,
  timestamptz,
  uuid,
  integer,
  uuid
) to authenticated, service_role;

create or replace function public.get_workspace_conversation_members(
  target_conversation_id uuid
)
returns table (
  profile_id uuid,
  member_role text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select member.profile_id, member.member_role
  from public.workspace_conversation_members as member
  where member.conversation_id = target_conversation_id
    and member.revoked_at is null
    and (select private.can_access_workspace_conversation(
      target_conversation_id
    ))
  order by member.joined_at, member.profile_id;
$$;

revoke all on function public.get_workspace_conversation_members(uuid)
  from public, anon;
grant execute on function public.get_workspace_conversation_members(uuid)
  to authenticated, service_role;

create or replace function public.get_workspace_messages_delta_v1(
  target_conversation_id uuid,
  target_parent_message_id uuid default null,
  after_created_at timestamptz default null,
  after_message_id uuid default null,
  requested_limit integer default 50
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  client_nonce uuid,
  parent_message_id uuid,
  created_at timestamptz,
  reply_count bigint,
  last_reply_at timestamptz,
  thread_unread_count bigint,
  attachments jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with paged_messages as materialized (
    select
      message.id,
      message.conversation_id,
      message.sender_id,
      message.body,
      message.client_nonce,
      message.parent_message_id,
      message.created_at
    from public.workspace_messages as message
    where message.conversation_id = target_conversation_id
      and (
        (
          target_parent_message_id is null
          and message.parent_message_id is null
        )
        or message.parent_message_id = target_parent_message_id
      )
      and (
        after_created_at is null
        or after_message_id is null
        or (message.created_at, message.id) >
          (after_created_at, after_message_id)
      )
    order by message.created_at, message.id
    limit greatest(1, least(requested_limit, 100))
  ),
  reply_stats as (
    select
      message.id as root_message_id,
      count(reply.id) as reply_count,
      max(reply.created_at) as last_reply_at,
      count(reply.id) filter (
        where reply.sender_id <> (select auth.uid())
          and reply.created_at > coalesce(
            thread_read.last_read_at,
            '-infinity'::timestamptz
          )
      ) as thread_unread_count
    from paged_messages as message
    left join public.workspace_thread_reads as thread_read
      on thread_read.root_message_id = message.id
      and thread_read.profile_id = (select auth.uid())
    left join public.workspace_messages as reply
      on reply.parent_message_id = message.id
    where target_parent_message_id is null
    group by message.id, thread_read.last_read_at
  ),
  attachment_stats as (
    select
      attachment.message_id,
      jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'file_name', attachment.file_name,
          'mime_type', attachment.mime_type,
          'size_bytes', attachment.size_bytes
        )
        order by attachment.created_at, attachment.id
      ) as attachments
    from public.workspace_message_attachments as attachment
    join paged_messages as message
      on message.id = attachment.message_id
    group by attachment.message_id
  )
  select
    message.id,
    message.conversation_id,
    message.sender_id,
    message.body,
    message.client_nonce,
    message.parent_message_id,
    message.created_at,
    coalesce(reply_stats.reply_count, 0),
    reply_stats.last_reply_at,
    coalesce(reply_stats.thread_unread_count, 0),
    coalesce(attachment_stats.attachments, '[]'::jsonb)
  from paged_messages as message
  left join reply_stats
    on reply_stats.root_message_id = message.id
  left join attachment_stats
    on attachment_stats.message_id = message.id
  order by message.created_at, message.id;
$$;

revoke all on function public.get_workspace_messages_delta_v1(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_workspace_messages_delta_v1(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;

create or replace function public.mark_workspace_thread_read(
  target_root_message_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_read_at timestamptz;
  latest_unread_at timestamptz;
  saved_read_at timestamptz;
begin
  if not (
    select private.can_access_workspace_thread(target_root_message_id)
  ) then
    raise insufficient_privilege using
      message = 'You do not have access to this thread.';
  end if;

  select read_state.last_read_at
  into current_read_at
  from public.workspace_thread_reads as read_state
  where read_state.root_message_id = target_root_message_id
    and read_state.profile_id = (select auth.uid());

  select max(reply.created_at)
  into latest_unread_at
  from public.workspace_messages as reply
  where reply.parent_message_id = target_root_message_id
    and reply.sender_id <> (select auth.uid())
    and reply.created_at > coalesce(
      current_read_at,
      '-infinity'::timestamptz
    );

  if latest_unread_at is null then
    return jsonb_build_object(
      'read_at', current_read_at,
      'updated', false
    );
  end if;

  insert into public.workspace_thread_reads (
    root_message_id,
    profile_id,
    last_read_at
  )
  values (
    target_root_message_id,
    (select auth.uid()),
    latest_unread_at
  )
  on conflict (root_message_id, profile_id) do update
  set last_read_at = greatest(
    public.workspace_thread_reads.last_read_at,
    excluded.last_read_at
  )
  returning last_read_at into saved_read_at;

  return jsonb_build_object(
    'read_at', saved_read_at,
    'updated', true
  );
end;
$$;

revoke all on function public.mark_workspace_thread_read(uuid)
  from public, anon;
grant execute on function public.mark_workspace_thread_read(uuid)
  to authenticated, service_role;

create or replace function public.get_workspace_chat_events(
  after_sequence bigint default 0,
  requested_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with settings as (
    select
      greatest(0, after_sequence) as cursor_value,
      greatest(1, least(requested_limit, 500)) as page_limit
  ),
  server_state as (
    select coalesce(cursor_state.last_sequence, 0) as last_sequence
    from settings
    left join public.workspace_chat_sync_cursors as cursor_state
      on cursor_state.profile_id = (select auth.uid())
  ),
  candidates as materialized (
    select event.*
    from public.workspace_chat_events as event
    cross join settings
    where event.profile_id = (select auth.uid())
      and event.sequence > settings.cursor_value
    order by event.sequence
    limit (select page_limit + 1 from settings)
  ),
  page_rows as materialized (
    select candidate.*
    from candidates as candidate
    order by candidate.sequence
    limit (select page_limit from settings)
  )
  select jsonb_build_object(
    'events',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sequence', event.sequence::text,
          'type', event.event_type,
          'conversation_id', event.conversation_id,
          'message_id', event.message_id,
          'parent_message_id', event.parent_message_id,
          'sender_id', event.sender_id,
          'event_at', event.event_at
        )
        order by event.sequence
      )
      from page_rows as event
    ), '[]'::jsonb),
    'cursor',
    coalesce(
      (select max(event.sequence)::text from page_rows as event),
      (select cursor_value::text from settings)
    ),
    'server_cursor',
    (select last_sequence::text from server_state),
    'has_more',
    (select count(*) from candidates) > (select page_limit from settings),
    'reset_required',
    (select cursor_value from settings) >
      (select last_sequence from server_state)
      or (
        (select cursor_value from settings) <
          (select last_sequence from server_state)
        and (
          not exists (select 1 from page_rows)
          or (select min(event.sequence) from page_rows as event) <>
            (select cursor_value + 1 from settings)
        )
      )
  );
$$;

revoke all on function public.get_workspace_chat_events(bigint, integer)
  from public, anon;
grant execute on function public.get_workspace_chat_events(bigint, integer)
  to authenticated, service_role;

create or replace function public.get_workspace_chat_bootstrap(
  target_conversation_id uuid default null,
  requested_summary_limit integer default 50,
  requested_message_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  viewer_profile public.profiles;
  summary_page jsonb;
  selected_id uuid;
  selected_summary jsonb;
  selected_members jsonb := '[]'::jsonb;
  selected_messages jsonb := '[]'::jsonb;
  selected_has_more boolean := false;
  selected_message_limit integer :=
    greatest(1, least(requested_message_limit, 50));
  profile_list jsonb := '[]'::jsonb;
  sync_cursor bigint := 0;
begin
  select profile.*
  into viewer_profile
  from public.profiles as profile
  where profile.id = (select auth.uid())
    and profile.status = 'active'
    and profile.chat_enabled
    and profile.organization_id is not null;

  if viewer_profile.id is null then
    raise insufficient_privilege using
      message = 'Your account does not have access to P11 Chat.';
  end if;

  summary_page := public.get_workspace_conversation_summaries_page(
    null,
    null,
    null,
    requested_summary_limit,
    null
  );

  if target_conversation_id is not null and exists (
    select 1
    from public.workspace_chat_conversation_projection as projection
    where projection.profile_id = viewer_profile.id
      and projection.conversation_id = target_conversation_id
  ) then
    selected_id := target_conversation_id;
  else
    selected_id := nullif(
      summary_page #>> '{conversations,0,conversation_id}',
      ''
    )::uuid;
  end if;

  if selected_id is not null then
    selected_summary :=
      public.get_workspace_conversation_summaries_page(
        null,
        null,
        null,
        1,
        selected_id
      ) #> '{conversations,0}';

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'profile_id', member.profile_id,
          'member_role', member.member_role
        )
        order by member.joined_at, member.profile_id
      ),
      '[]'::jsonb
    )
    into selected_members
    from public.workspace_conversation_members as member
    where member.conversation_id = selected_id
      and member.revoked_at is null;

    select count(*) > selected_message_limit
    into selected_has_more
    from public.get_workspace_messages_page_v4(
      selected_id,
      null,
      null,
      null,
      selected_message_limit + 1
    );

    select coalesce(
      jsonb_agg(to_jsonb(message) order by message.created_at desc, message.message_id desc),
      '[]'::jsonb
    )
    into selected_messages
    from (
      select page.*
      from public.get_workspace_messages_page_v4(
        selected_id,
        null,
        null,
        null,
        selected_message_limit + 1
      ) as page
      order by page.created_at desc, page.message_id desc
      limit selected_message_limit
    ) as message;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'email', profile.email,
        'full_name', profile.full_name,
        'title', profile.title,
        'avatar_url', profile.avatar_url,
        'role', profile.role
      )
      order by profile.full_name, profile.id
    ),
    '[]'::jsonb
  )
  into profile_list
  from public.profiles as profile
  where profile.organization_id = viewer_profile.organization_id
    and profile.status = 'active'
    and profile.chat_enabled;

  select coalesce(cursor_state.last_sequence, 0)
  into sync_cursor
  from public.workspace_chat_sync_cursors as cursor_state
  where cursor_state.profile_id = viewer_profile.id;

  return jsonb_build_object(
    'viewer',
    jsonb_build_object(
      'id', viewer_profile.id,
      'email', viewer_profile.email,
      'full_name', viewer_profile.full_name,
      'title', viewer_profile.title,
      'avatar_url', viewer_profile.avatar_url,
      'role', viewer_profile.role
    ),
    'profiles', profile_list,
    'summary_page', summary_page,
    'selected_conversation_id', selected_id,
    'selected_summary', selected_summary,
    'selected_members', selected_members,
    'selected_message_page',
    jsonb_build_object(
      'messages', selected_messages,
      'has_more', selected_has_more
    ),
    'cursor', sync_cursor::text
  );
end;
$$;

revoke all on function public.get_workspace_chat_bootstrap(
  uuid,
  integer,
  integer
) from public, anon;
grant execute on function public.get_workspace_chat_bootstrap(
  uuid,
  integer,
  integer
) to authenticated, service_role;
