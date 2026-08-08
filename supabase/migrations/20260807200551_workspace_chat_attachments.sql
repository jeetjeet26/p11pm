-- Secure message attachments for channels, DMs, and thread replies.

create table public.workspace_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.workspace_conversations(id) on delete cascade,
  message_id uuid references public.workspace_messages(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete restrict,
  bucket_id text not null default 'workspace-chat-files'
    check (bucket_id = 'workspace-chat-files'),
  object_path text not null unique check (
    char_length(btrim(object_path)) > 0
    and object_path !~ '(^|/)\.\.(/|$)'
  ),
  file_name text not null check (
    char_length(btrim(file_name)) between 1 and 255
  ),
  mime_type text check (
    mime_type is null or char_length(mime_type) <= 255
  ),
  size_bytes bigint not null check (
    size_bytes between 1 and 26214400
  ),
  created_at timestamptz not null default now()
);

create index workspace_message_attachments_message_idx
  on public.workspace_message_attachments (message_id, created_at, id)
  where message_id is not null;

create index workspace_message_attachments_pending_idx
  on public.workspace_message_attachments (uploader_id, created_at)
  where message_id is null;

create or replace function private.validate_workspace_message_attachment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_conversation_id uuid;
  target_sender_id uuid;
begin
  if new.message_id is null then
    return new;
  end if;

  select message.conversation_id, message.sender_id
  into target_conversation_id, target_sender_id
  from public.workspace_messages as message
  where message.id = new.message_id;

  if not found then
    raise foreign_key_violation using
      message = 'Attachment message does not exist.';
  end if;

  if target_conversation_id <> new.conversation_id then
    raise check_violation using
      message = 'Attachments must remain in their uploaded conversation.';
  end if;

  if target_sender_id <> new.uploader_id then
    raise check_violation using
      message = 'Only the message sender can attach an uploaded file.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_workspace_message_attachment()
  from public;

create trigger validate_workspace_message_attachment
  before insert or update of message_id, conversation_id, uploader_id
  on public.workspace_message_attachments
  for each row execute function private.validate_workspace_message_attachment();

revoke all on public.workspace_message_attachments from anon, authenticated;
grant select, insert, delete on public.workspace_message_attachments
  to authenticated;
grant update (message_id) on public.workspace_message_attachments
  to authenticated;
grant all on public.workspace_message_attachments to service_role;

alter table public.workspace_message_attachments enable row level security;

create policy "Chat users can read available attachments"
on public.workspace_message_attachments
for select
to authenticated
using (
  (select private.can_access_workspace_conversation(conversation_id))
  and (
    message_id is not null
    or uploader_id = (select auth.uid())
  )
);

create policy "Chat users can upload pending attachments"
on public.workspace_message_attachments
for insert
to authenticated
with check (
  uploader_id = (select auth.uid())
  and message_id is null
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Chat users can link their pending attachments"
on public.workspace_message_attachments
for update
to authenticated
using (
  uploader_id = (select auth.uid())
  and message_id is null
  and (select private.can_access_workspace_conversation(conversation_id))
)
with check (
  uploader_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Chat users can remove their pending attachments"
on public.workspace_message_attachments
for delete
to authenticated
using (
  uploader_id = (select auth.uid())
  and message_id is null
  and (select private.can_access_workspace_conversation(conversation_id))
);

create or replace function private.can_read_workspace_chat_object(
  object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_message_attachments as attachment
    where attachment.object_path = object_name
      and (
        attachment.message_id is not null
        or attachment.uploader_id = (select auth.uid())
      )
      and (
        select private.can_access_workspace_conversation(
          attachment.conversation_id
        )
      )
  );
$$;

revoke all on function private.can_read_workspace_chat_object(text)
  from public;
grant execute on function private.can_read_workspace_chat_object(text)
  to authenticated, service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'workspace-chat-files',
  'workspace-chat-files',
  false,
  26214400
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "Chat users can read authorized message files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'workspace-chat-files'
  and (select private.can_read_workspace_chat_object(name))
);

create policy "Chat users can upload their message files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'workspace-chat-files'
  and split_part(name, '/', 2) = (select auth.uid())::text
  and (
    select private.can_access_workspace_conversation(
      split_part(name, '/', 1)::uuid
    )
  )
);

create policy "Chat users can remove their pending message files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'workspace-chat-files'
  and split_part(name, '/', 2) = (select auth.uid())::text
);

create or replace function public.send_workspace_message(
  target_conversation_id uuid,
  target_body text,
  target_client_nonce uuid,
  target_parent_message_id uuid default null,
  target_attachment_ids uuid[] default '{}'::uuid[]
)
returns public.workspace_messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attachment_count integer;
  result_message public.workspace_messages;
begin
  if char_length(btrim(target_body)) not between 1 and 4000 then
    raise check_violation using
      message = 'Message body must contain between 1 and 4,000 characters.';
  end if;

  if coalesce(cardinality(target_attachment_ids), 0) > 5 then
    raise check_violation using
      message = 'Messages can contain at most five attachments.';
  end if;

  select message.*
  into result_message
  from public.workspace_messages as message
  where message.sender_id = (select auth.uid())
    and message.client_nonce = target_client_nonce;

  if found then
    if coalesce(cardinality(target_attachment_ids), 0) > 0 and (
      select count(*)
      from public.workspace_message_attachments as attachment
      where attachment.id = any(target_attachment_ids)
        and attachment.message_id = result_message.id
    ) <> cardinality(target_attachment_ids) then
      raise check_violation using
        message = 'The retry does not match the original attachments.';
    end if;

    return result_message;
  end if;

  if coalesce(cardinality(target_attachment_ids), 0) > 0 then
    select count(*)
    into attachment_count
    from public.workspace_message_attachments as attachment
    where attachment.id = any(target_attachment_ids)
      and attachment.conversation_id = target_conversation_id
      and attachment.uploader_id = (select auth.uid())
      and attachment.message_id is null;

    if attachment_count <> cardinality(target_attachment_ids) then
      raise check_violation using
        message = 'One or more attachments are unavailable.';
    end if;
  end if;

  insert into public.workspace_messages (
    conversation_id,
    sender_id,
    body,
    client_nonce,
    parent_message_id
  )
  values (
    target_conversation_id,
    (select auth.uid()),
    btrim(target_body),
    target_client_nonce,
    target_parent_message_id
  )
  on conflict (sender_id, client_nonce) do nothing
  returning * into result_message;

  if result_message.id is null then
    select message.*
    into result_message
    from public.workspace_messages as message
    where message.sender_id = (select auth.uid())
      and message.client_nonce = target_client_nonce;

    if coalesce(cardinality(target_attachment_ids), 0) > 0 and (
      select count(*)
      from public.workspace_message_attachments as attachment
      where attachment.id = any(target_attachment_ids)
        and attachment.message_id = result_message.id
    ) <> cardinality(target_attachment_ids) then
      raise check_violation using
        message = 'The retry does not match the original attachments.';
    end if;

    return result_message;
  end if;

  if coalesce(cardinality(target_attachment_ids), 0) > 0 then
    update public.workspace_message_attachments
    set message_id = result_message.id
    where id = any(target_attachment_ids);
  end if;

  return result_message;
end;
$$;

revoke all on function public.send_workspace_message(
  uuid,
  text,
  uuid,
  uuid,
  uuid[]
) from public, anon;
grant execute on function public.send_workspace_message(
  uuid,
  text,
  uuid,
  uuid,
  uuid[]
) to authenticated, service_role;

create or replace function public.get_workspace_messages_page_v3(
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
    end,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'file_name', attachment.file_name,
          'mime_type', attachment.mime_type,
          'size_bytes', attachment.size_bytes
        )
        order by attachment.created_at, attachment.id
      )
      from public.workspace_message_attachments as attachment
      where attachment.message_id = message.id
    ), '[]'::jsonb)
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

revoke all on function public.get_workspace_messages_page_v3(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) from public, anon;
grant execute on function public.get_workspace_messages_page_v3(
  uuid,
  uuid,
  timestamptz,
  uuid,
  integer
) to authenticated, service_role;
