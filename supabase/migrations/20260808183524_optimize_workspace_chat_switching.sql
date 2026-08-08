-- Keep channel switching fast by paging before calculating message aggregates.

create or replace function public.get_workspace_messages_page_v4(
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
        before_created_at is null
        or before_message_id is null
        or (message.created_at, message.id) <
          (before_created_at, before_message_id)
      )
    order by message.created_at desc, message.id desc
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
  order by message.created_at desc, message.id desc;
$$;

revoke all on function public.get_workspace_messages_page_v4(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_workspace_messages_page_v4(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;

-- Advance the read cursor only when another person has unread root messages.
create or replace function public.mark_workspace_conversation_read(
  target_conversation_id uuid
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
    select private.can_access_workspace_conversation(target_conversation_id)
  ) then
    raise insufficient_privilege using
      message = 'You do not have access to this conversation.';
  end if;

  select read_state.last_read_at
  into current_read_at
  from public.workspace_conversation_reads as read_state
  where read_state.conversation_id = target_conversation_id
    and read_state.profile_id = (select auth.uid());

  select max(message.created_at)
  into latest_unread_at
  from public.workspace_messages as message
  where message.conversation_id = target_conversation_id
    and message.parent_message_id is null
    and message.sender_id <> (select auth.uid())
    and message.created_at > coalesce(
      current_read_at,
      '-infinity'::timestamptz
    );

  if latest_unread_at is null then
    return jsonb_build_object(
      'read_at', current_read_at,
      'updated', false
    );
  end if;

  insert into public.workspace_conversation_reads (
    conversation_id,
    profile_id,
    last_read_at
  )
  values (
    target_conversation_id,
    (select auth.uid()),
    latest_unread_at
  )
  on conflict (conversation_id, profile_id) do update
  set last_read_at = greatest(
    public.workspace_conversation_reads.last_read_at,
    excluded.last_read_at
  )
  returning last_read_at into saved_read_at;

  return jsonb_build_object(
    'read_at', saved_read_at,
    'updated', true
  );
end;
$$;

revoke all on function public.mark_workspace_conversation_read(uuid)
  from public, anon;
grant execute on function public.mark_workspace_conversation_read(uuid)
  to authenticated, service_role;
