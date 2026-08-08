-- Single-level Slack-style threads for workspace chat messages.

alter table public.workspace_messages
  add column parent_message_id uuid
    references public.workspace_messages(id) on delete cascade;

create index workspace_messages_parent_created_idx
  on public.workspace_messages (parent_message_id, created_at, id)
  where parent_message_id is not null;

create or replace function private.validate_workspace_message_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_conversation_id uuid;
  parent_parent_message_id uuid;
begin
  if new.parent_message_id is null then
    return new;
  end if;

  select
    parent.conversation_id,
    parent.parent_message_id
  into
    parent_conversation_id,
    parent_parent_message_id
  from public.workspace_messages as parent
  where parent.id = new.parent_message_id;

  if not found then
    raise check_violation using
      message = 'Thread parent message does not exist.';
  end if;

  if parent_conversation_id <> new.conversation_id then
    raise check_violation using
      message = 'Thread replies must remain in the parent conversation.';
  end if;

  if parent_parent_message_id is not null then
    raise check_violation using
      message = 'Nested thread replies are not supported.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_workspace_message_parent()
  from public;

create trigger validate_workspace_message_parent
  before insert or update of parent_message_id, conversation_id
  on public.workspace_messages
  for each row execute function private.validate_workspace_message_parent();

create table public.workspace_thread_reads (
  root_message_id uuid not null
    references public.workspace_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (root_message_id, profile_id)
);

create index workspace_thread_reads_profile_idx
  on public.workspace_thread_reads (profile_id, last_read_at desc);

create trigger set_workspace_thread_reads_updated_at
  before update on public.workspace_thread_reads
  for each row execute function private.set_updated_at();

create trigger keep_workspace_thread_read_monotonic
  before update on public.workspace_thread_reads
  for each row execute function private.keep_workspace_read_monotonic();

create or replace function private.can_access_workspace_thread(
  target_root_message_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_messages as message
    where message.id = target_root_message_id
      and message.parent_message_id is null
      and (
        select private.can_access_workspace_conversation(
          message.conversation_id
        )
      )
  );
$$;

revoke all on function private.can_access_workspace_thread(uuid)
  from public;
grant execute on function private.can_access_workspace_thread(uuid)
  to authenticated, service_role;

revoke all on public.workspace_thread_reads from anon, authenticated;
grant select, insert, update on public.workspace_thread_reads
  to authenticated;
grant all on public.workspace_thread_reads to service_role;

alter table public.workspace_thread_reads enable row level security;

create policy "Chat users can read their thread state"
on public.workspace_thread_reads
for select
to authenticated
using (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_thread(root_message_id))
);

create policy "Chat users can create their thread state"
on public.workspace_thread_reads
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_thread(root_message_id))
);

create policy "Chat users can advance their thread state"
on public.workspace_thread_reads
for update
to authenticated
using (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_thread(root_message_id))
)
with check (
  profile_id = (select auth.uid())
  and (select private.can_access_workspace_thread(root_message_id))
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

create or replace function public.get_workspace_messages_page_v2(
  target_conversation_id uuid,
  target_parent_message_id uuid default null,
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
  parent_message_id uuid,
  created_at timestamptz,
  reply_count bigint,
  last_reply_at timestamptz,
  thread_unread_count bigint
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
    message.parent_message_id,
    message.created_at,
    case
      when target_parent_message_id is null then reply_stats.reply_count
      else 0
    end,
    case
      when target_parent_message_id is null then reply_stats.last_reply_at
      else null
    end,
    case
      when target_parent_message_id is null then (
        select count(*)
        from public.workspace_messages as unread_reply
        where unread_reply.parent_message_id = message.id
          and unread_reply.sender_id <> (select auth.uid())
          and unread_reply.created_at > coalesce(
            thread_read.last_read_at,
            '-infinity'::timestamptz
          )
      )
      else 0
    end
  from public.workspace_messages as message
  left join public.workspace_thread_reads as thread_read
    on target_parent_message_id is null
    and thread_read.root_message_id = message.id
    and thread_read.profile_id = (select auth.uid())
  left join lateral (
    select
      count(*) as reply_count,
      max(reply.created_at) as last_reply_at
    from public.workspace_messages as reply
    where reply.parent_message_id = message.id
  ) as reply_stats on target_parent_message_id is null
  where message.conversation_id = target_conversation_id
    and (
      (
        target_parent_message_id is null
        and message.parent_message_id is null
      )
      or message.parent_message_id = target_parent_message_id
    )
    and (
      before_created_at is null
      or before_message_id is null
      or (message.created_at, message.id) <
        (before_created_at, before_message_id)
    )
  order by message.created_at desc, message.id desc
  limit greatest(1, least(requested_limit, 100));
$$;

revoke all on function public.get_workspace_messages_page_v2(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_workspace_messages_page_v2(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;
