begin;

select extensions.plan(1);

insert into public.organizations (id, name, slug)
values
  (
    '11000000-0000-4000-8000-000000000001',
    'P11 Marketing Studio',
    'p11-marketing-studio'
  ),
  (
    '11000000-0000-4000-8000-000000000002',
    'Other organization',
    'other-organization'
  )
on conflict (id) do nothing;

insert into public.workspace_conversations (
  organization_id,
  kind,
  name,
  slug
)
values (
  '11000000-0000-4000-8000-000000000001',
  'channel',
  'general',
  'general'
)
on conflict do nothing;

insert into public.profiles (
  id,
  organization_id,
  email,
  full_name,
  role,
  status,
  chat_enabled
)
values
  (
    '99000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'chat-a@example.com',
    'Chat A',
    'member',
    'active',
    true
  ),
  (
    '99000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    'chat-b@example.com',
    'Chat B',
    'member',
    'active',
    true
  ),
  (
    '99000000-0000-4000-8000-000000000003',
    '11000000-0000-4000-8000-000000000002',
    'chat-c@example.com',
    'Chat C',
    'admin',
    'active',
    true
  ),
  (
    '99000000-0000-4000-8000-000000000004',
    '11000000-0000-4000-8000-000000000001',
    'chat-suspended@example.com',
    'Chat Suspended',
    'member',
    'suspended',
    true
  ),
  (
    '99000000-0000-4000-8000-000000000005',
    null,
    'chat-unbound@example.com',
    'Chat Unbound',
    'member',
    'active',
    true
  ),
  (
    '99000000-0000-4000-8000-000000000006',
    '11000000-0000-4000-8000-000000000001',
    'chat-d@example.com',
    'Chat D',
    'member',
    'active',
    true
  ),
  (
    '99000000-0000-4000-8000-000000000007',
    '11000000-0000-4000-8000-000000000001',
    'chat-admin@example.com',
    'Chat Admin',
    'admin',
    'active',
    true
  );

insert into public.workspace_conversations (
  id,
  organization_id,
  kind,
  visibility,
  dm_profile_a,
  dm_profile_b,
  dm_member_key,
  created_by
)
values (
  '98000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'dm',
  'private',
  '99000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000001,99000000-0000-4000-8000-000000000002',
  '99000000-0000-4000-8000-000000000001'
);

insert into public.workspace_conversation_members (
  conversation_id,
  profile_id,
  member_role,
  added_by
)
values
  (
    '98000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000001',
    'owner',
    '99000000-0000-4000-8000-000000000001'
  ),
  (
    '98000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000002',
    'member',
    '99000000-0000-4000-8000-000000000001'
  );

do $$
begin
  if (
    select count(*)
    from public.workspace_chat_conversation_projection
    where conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'Direct-message members were not projected for sync';
  end if;

  if exists (
    select 1
    from (
      select
        event.profile_id,
        event.sequence,
        lag(event.sequence) over (
          partition by event.profile_id
          order by event.sequence
        ) as previous_sequence
      from public.workspace_chat_events as event
    ) as sequenced
    where previous_sequence is not null
      and sequence <> previous_sequence + 1
  ) then
    raise exception 'Per-user chat event sequences were not contiguous';
  end if;
end;
$$;

set local role authenticated;
set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000001';

do $$
begin
  if (select auth.uid()) <> '99000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'auth.uid() was not configured for Chat A';
  end if;

  if (
    select count(*)
    from public.workspace_conversations
    where kind = 'channel'
  ) <> 1 then
    raise exception 'Chat A could not read the organization channel';
  end if;
end;
$$;

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce
)
values (
  '97000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'Hello from Chat A',
  '96000000-0000-4000-8000-000000000001'
);

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce,
  parent_message_id
)
values (
  '97000000-0000-4000-8000-000000000002',
  '98000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'Thread reply from Chat A',
  '96000000-0000-4000-8000-000000000003',
  '97000000-0000-4000-8000-000000000001'
);

insert into public.workspace_message_attachments (
  id,
  conversation_id,
  uploader_id,
  object_path,
  file_name,
  mime_type,
  size_bytes
)
values (
  '95000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001/99000000-0000-4000-8000-000000000001/test.pdf',
  'test.pdf',
  'application/pdf',
  1024
);

select public.send_workspace_message(
  '98000000-0000-4000-8000-000000000001',
  'Thread reply with an attachment',
  '96000000-0000-4000-8000-000000000005',
  '97000000-0000-4000-8000-000000000001',
  array['95000000-0000-4000-8000-000000000001']::uuid[]
);

do $$
begin
  begin
    insert into public.workspace_messages (
      conversation_id,
      sender_id,
      body,
      client_nonce
    )
    values (
      '98000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000002',
      'Spoofed sender',
      '96000000-0000-4000-8000-000000000002'
    );
    raise exception 'Sender spoofing was accepted';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.workspace_messages (
      conversation_id,
      sender_id,
      body,
      client_nonce
    )
    values (
      '98000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000001',
      'Duplicate retry',
      '96000000-0000-4000-8000-000000000001'
    );
    raise exception 'Duplicate client nonce was accepted';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.workspace_messages (
      conversation_id,
      sender_id,
      body,
      client_nonce,
      parent_message_id
    )
    values (
      '98000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000001',
      'Nested reply',
      '96000000-0000-4000-8000-000000000004',
      '97000000-0000-4000-8000-000000000002'
    );
    raise exception 'Nested thread reply was accepted';
  exception
    when check_violation then null;
  end;

  if (
    select message_id is null
    from public.workspace_message_attachments
    where id = '95000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Pending attachment was not linked to its message';
  end if;

  if (
    select count(*)
    from public.send_workspace_message(
      '98000000-0000-4000-8000-000000000001',
      'Thread reply with an attachment',
      '96000000-0000-4000-8000-000000000005',
      '97000000-0000-4000-8000-000000000001',
      array['95000000-0000-4000-8000-000000000001']::uuid[]
    )
  ) <> 1 then
    raise exception 'Attachment send retry was not idempotent';
  end if;

  if (
    public.mark_workspace_conversation_read(
      '98000000-0000-4000-8000-000000000001'
    )->>'updated'
  )::boolean then
    raise exception 'Own messages caused an unnecessary read-state write';
  end if;
end;
$$;

do $$
declare
  bootstrap jsonb;
  summary_page jsonb;
begin
  bootstrap := public.get_workspace_chat_bootstrap(
    '98000000-0000-4000-8000-000000000001',
    1,
    50
  );
  summary_page := bootstrap->'summary_page';

  if bootstrap #>> '{viewer,id}' <>
    '99000000-0000-4000-8000-000000000001'
  then
    raise exception 'Chat bootstrap did not return the authenticated viewer';
  end if;
  if bootstrap->>'selected_conversation_id' <>
    '98000000-0000-4000-8000-000000000001'
  then
    raise exception 'Chat bootstrap did not preserve the requested conversation';
  end if;
  if jsonb_array_length(
    bootstrap #> '{selected_message_page,messages}'
  ) <> 1 then
    raise exception 'Chat bootstrap did not return the selected root-message page';
  end if;
  if (bootstrap->>'cursor')::bigint <= 0 then
    raise exception 'Chat bootstrap did not return a durable event cursor';
  end if;
  if (
    select unread_count
    from public.workspace_chat_conversation_projection
    where profile_id = '99000000-0000-4000-8000-000000000001'
      and conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Sender root message incremented its projected unread count';
  end if;
  if (bootstrap #>> '{selected_summary,unread_count}')::bigint <> 0 then
    raise exception 'Bootstrap did not use the sender-excluded projected unread count';
  end if;
  if jsonb_array_length(summary_page->'conversations') <> 1
    or not (summary_page->>'has_more')::boolean
  then
    raise exception 'Conversation summaries were not paginated before aggregation';
  end if;
  if (
    select count(*)
    from public.get_workspace_conversation_members(
      '98000000-0000-4000-8000-000000000001'
    )
  ) <> 2 then
    raise exception 'Full conversation roster was not available on demand';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000002';

do $$
begin
  if (
    select count(*)
    from public.workspace_messages
    where conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 3 then
    raise exception 'Chat B could not read the root and thread replies';
  end if;

  if (
    select unread_count
    from public.get_workspace_conversation_summaries()
    where conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'Chat B unread count was not one';
  end if;
  if (
    select unread_count
    from public.workspace_chat_conversation_projection
    where profile_id = '99000000-0000-4000-8000-000000000002'
      and conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'Root message did not increment the recipient projection';
  end if;
  if (
    public.get_workspace_conversation_summaries_page(
      null,
      null,
      null,
      1,
      '98000000-0000-4000-8000-000000000001'
    ) #>> '{conversations,0,unread_count}'
  )::bigint <> 1 then
    raise exception 'Summary paging did not read the projected unread count';
  end if;

  if (
    select reply_count
    from public.get_workspace_messages_page_v2(
      '98000000-0000-4000-8000-000000000001',
      null,
      null,
      null,
      50
    )
    where message_id = '97000000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'Root message reply count was not two';
  end if;

  if (
    select thread_unread_count
    from public.get_workspace_messages_page_v2(
      '98000000-0000-4000-8000-000000000001',
      null,
      null,
      null,
      50
    )
    where message_id = '97000000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'Chat B thread unread count was not two';
  end if;

  if (
    select count(*)
    from public.get_workspace_messages_page_v2(
      '98000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000001',
      null,
      null,
      50
    )
  ) <> 2 then
    raise exception 'Thread reply page did not contain two replies';
  end if;

  if (
    select sum(jsonb_array_length(attachments))
    from public.get_workspace_messages_page_v4(
      '98000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000001',
      null,
      null,
      50
    )
  ) <> 1 then
    raise exception 'Chat B could not read the thread attachment';
  end if;
end;
$$;

do $$
declare
  first_result jsonb;
  second_result jsonb;
  cursor_before_noop bigint;
  cursor_after_noop bigint;
begin
  first_result := public.mark_workspace_conversation_read(
    '98000000-0000-4000-8000-000000000001'
  );
  if not (first_result->>'updated')::boolean then
    raise exception 'Unread root message did not advance the read cursor';
  end if;
  if (
    select unread_count
    from public.workspace_chat_conversation_projection
    where profile_id = '99000000-0000-4000-8000-000000000002'
      and conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Conversation read did not reset projected unread count';
  end if;

  select last_sequence
  into cursor_before_noop
  from public.workspace_chat_sync_cursors
  where profile_id = '99000000-0000-4000-8000-000000000002';

  second_result := public.mark_workspace_conversation_read(
    '98000000-0000-4000-8000-000000000001'
  );
  select last_sequence
  into cursor_after_noop
  from public.workspace_chat_sync_cursors
  where profile_id = '99000000-0000-4000-8000-000000000002';
  if (second_result->>'updated')::boolean then
    raise exception 'Zero-unread conversation caused a duplicate read write';
  end if;

  if second_result->>'read_at' <> first_result->>'read_at' then
    raise exception 'No-op read changed the conversation read cursor';
  end if;
  if cursor_after_noop <> cursor_before_noop then
    raise exception 'Repeated no-op read emitted a durable chat event';
  end if;
end;
$$;

update public.workspace_conversation_reads
set last_read_at = '-infinity'::timestamptz
where conversation_id = '98000000-0000-4000-8000-000000000001'
  and profile_id = '99000000-0000-4000-8000-000000000002';

insert into public.workspace_thread_reads (
  root_message_id,
  profile_id,
  last_read_at
)
values (
  '97000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000002',
  now() + interval '1 second'
);

update public.workspace_thread_reads
set last_read_at = '-infinity'::timestamptz
where root_message_id = '97000000-0000-4000-8000-000000000001'
  and profile_id = '99000000-0000-4000-8000-000000000002';

do $$
begin
  if (
    select unread_count
    from public.get_workspace_conversation_summaries()
    where conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Chat B unread count did not clear';
  end if;
  if (
    select unread_count
    from public.workspace_chat_conversation_projection
    where profile_id = '99000000-0000-4000-8000-000000000002'
      and conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Monotonic no-op read changed projected unread count';
  end if;

  if (
    select last_read_at
    from public.workspace_conversation_reads
    where conversation_id = '98000000-0000-4000-8000-000000000001'
      and profile_id = '99000000-0000-4000-8000-000000000002'
  ) = '-infinity'::timestamptz then
    raise exception 'Read cursor moved backwards';
  end if;

  if (
    select thread_unread_count
    from public.get_workspace_messages_page_v2(
      '98000000-0000-4000-8000-000000000001',
      null,
      null,
      null,
      50
    )
    where message_id = '97000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Chat B thread unread count did not clear';
  end if;

  if (
    select last_read_at
    from public.workspace_thread_reads
    where root_message_id = '97000000-0000-4000-8000-000000000001'
      and profile_id = '99000000-0000-4000-8000-000000000002'
  ) = '-infinity'::timestamptz then
    raise exception 'Thread read cursor moved backwards';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000001';

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce,
  created_at
)
values (
  '97000000-0000-4000-8000-000000000020',
  '98000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'Forward root delta',
  '96000000-0000-4000-8000-000000000020',
  now() + interval '1 second'
);

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce,
  parent_message_id,
  created_at
)
values (
  '97000000-0000-4000-8000-000000000021',
  '98000000-0000-4000-8000-000000000001',
  '99000000-0000-4000-8000-000000000001',
  'Forward thread delta',
  '96000000-0000-4000-8000-000000000021',
  '97000000-0000-4000-8000-000000000001',
  now() + interval '2 seconds'
);

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000002';

do $$
declare
  first_result jsonb;
  second_result jsonb;
begin
  if (
    select unread_count
    from public.workspace_chat_conversation_projection
    where profile_id = '99000000-0000-4000-8000-000000000002'
      and conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'New root message did not re-increment projected unread count';
  end if;

  if (
    select count(*)
    from public.get_workspace_messages_delta_v1(
      '98000000-0000-4000-8000-000000000001',
      null,
      (
        select created_at
        from public.workspace_messages
        where id = '97000000-0000-4000-8000-000000000001'
      ),
      '97000000-0000-4000-8000-000000000001',
      50
    )
    where message_id = '97000000-0000-4000-8000-000000000020'
  ) <> 1 then
    raise exception 'Forward root-message delta did not return the new message';
  end if;

  first_result := public.mark_workspace_thread_read(
    '97000000-0000-4000-8000-000000000001'
  );
  second_result := public.mark_workspace_thread_read(
    '97000000-0000-4000-8000-000000000001'
  );
  if not (first_result->>'updated')::boolean then
    raise exception 'Unread thread reply did not advance the read cursor';
  end if;
  if (second_result->>'updated')::boolean then
    raise exception 'Zero-unread thread caused a duplicate read write';
  end if;
  if second_result->>'read_at' <> first_result->>'read_at' then
    raise exception 'No-op thread read changed the read cursor';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000001';

do $$
declare
  private_channel_id uuid;
  group_dm_id uuid;
  duplicate_group_dm_id uuid;
begin
  private_channel_id := public.create_workspace_conversation(
    'channel',
    'Leadership review',
    'leadership-review',
    'private',
    array[
      '99000000-0000-4000-8000-000000000002',
      '99000000-0000-4000-8000-000000000006'
    ]::uuid[]
  );
  group_dm_id := public.create_workspace_conversation(
    'dm',
    null,
    null,
    'private',
    array[
      '99000000-0000-4000-8000-000000000006',
      '99000000-0000-4000-8000-000000000002'
    ]::uuid[]
  );
  duplicate_group_dm_id := public.create_workspace_conversation(
    'dm',
    null,
    null,
    'private',
    array[
      '99000000-0000-4000-8000-000000000002',
      '99000000-0000-4000-8000-000000000006',
      '99000000-0000-4000-8000-000000000001'
    ]::uuid[]
  );

  if group_dm_id <> duplicate_group_dm_id then
    raise exception 'Exact group-DM roster was not deduplicated';
  end if;
  if (
    select count(*)
    from public.workspace_conversation_members
    where conversation_id = group_dm_id
  ) <> 3 then
    raise exception 'Group DM did not receive the canonical member roster';
  end if;
  if (
    select count(*)
    from public.workspace_conversation_members
    where conversation_id = private_channel_id
      and member_role = 'owner'
  ) <> 1 then
    raise exception 'Private channel creator was not made its owner';
  end if;

  perform set_config(
    'test.private_channel_id',
    private_channel_id::text,
    true
  );
  perform set_config('test.group_dm_id', group_dm_id::text, true);

  begin
    perform public.create_workspace_conversation(
      'dm',
      null,
      null,
      'private',
      array['99000000-0000-4000-8000-000000000003']::uuid[]
    );
    raise exception 'Cross-organization group member was accepted';
  exception
    when check_violation then null;
  end;

  begin
    perform public.set_workspace_channel_members(
      group_dm_id,
      array[
        '99000000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000002'
      ]::uuid[]
    );
    raise exception 'Group-DM membership was mutable';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce
)
values (
  '97000000-0000-4000-8000-000000000010',
  current_setting('test.private_channel_id')::uuid,
  '99000000-0000-4000-8000-000000000001',
  'Private channel root',
  '96000000-0000-4000-8000-000000000010'
);

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce,
  parent_message_id
)
values (
  '97000000-0000-4000-8000-000000000011',
  current_setting('test.private_channel_id')::uuid,
  '99000000-0000-4000-8000-000000000001',
  'Private channel thread reply',
  '96000000-0000-4000-8000-000000000011',
  '97000000-0000-4000-8000-000000000010'
);

reset role;

insert into storage.objects (
  id,
  bucket_id,
  name,
  owner_id,
  metadata
)
values (
  '94000000-0000-4000-8000-000000000010',
  'workspace-chat-files',
  current_setting('test.private_channel_id')
    || '/99000000-0000-4000-8000-000000000001/private.txt',
  '99000000-0000-4000-8000-000000000001',
  '{"size": 12, "mimetype": "text/plain"}'::jsonb
);

set local role authenticated;
set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000001';

insert into public.workspace_message_attachments (
  id,
  conversation_id,
  uploader_id,
  object_path,
  file_name,
  mime_type,
  size_bytes
)
values (
  '95000000-0000-4000-8000-000000000010',
  current_setting('test.private_channel_id')::uuid,
  '99000000-0000-4000-8000-000000000001',
  current_setting('test.private_channel_id')
    || '/99000000-0000-4000-8000-000000000001/private.txt',
  'private.txt',
  'text/plain',
  12
);

select public.send_workspace_message(
  current_setting('test.private_channel_id')::uuid,
  'Private attachment',
  '96000000-0000-4000-8000-000000000012',
  null,
  array['95000000-0000-4000-8000-000000000010']::uuid[]
);

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000006';

do $$
begin
  if (
    select count(*)
    from public.workspace_conversations
    where id = current_setting('test.private_channel_id')::uuid
  ) <> 1 then
    raise exception 'Private-channel member could not read the channel';
  end if;
  if (
    select count(*)
    from public.workspace_conversations
    where id = current_setting('test.group_dm_id')::uuid
  ) <> 1 then
    raise exception 'Group-DM member could not read the group';
  end if;
  if (
    select count(*)
    from public.workspace_chat_conversation_projection
    where conversation_id in (
      current_setting('test.private_channel_id')::uuid,
      current_setting('test.group_dm_id')::uuid
    )
  ) <> 2 then
    raise exception 'Private channel and group DM were not projected for the member';
  end if;
  if (
    select count(*)
    from public.get_workspace_conversation_members(
      current_setting('test.group_dm_id')::uuid
    )
  ) <> 3 then
    raise exception 'Group-DM roster was not loaded in full on demand';
  end if;
  if (
    select count(*)
    from public.workspace_messages
    where conversation_id = current_setting('test.private_channel_id')::uuid
  ) <> 3 then
    raise exception 'Private-channel member could not read messages and thread';
  end if;
  if (
    select count(*)
    from public.workspace_message_attachments
    where id = '95000000-0000-4000-8000-000000000010'
  ) <> 1 then
    raise exception 'Private-channel member could not read attachment metadata';
  end if;
  if (
    select count(*)
    from storage.objects
    where id = '94000000-0000-4000-8000-000000000010'
  ) <> 1 then
    raise exception 'Private-channel member could not read the stored file';
  end if;

  perform set_config(
    'test.chat_d_cursor',
    (
      select last_sequence::text
      from public.workspace_chat_sync_cursors
      where profile_id = '99000000-0000-4000-8000-000000000006'
    ),
    true
  );
end;
$$;

insert into public.workspace_thread_reads (
  root_message_id,
  profile_id
)
values (
  '97000000-0000-4000-8000-000000000010',
  '99000000-0000-4000-8000-000000000006'
);

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000002';

do $$
begin
  begin
    perform public.set_workspace_channel_members(
      current_setting('test.private_channel_id')::uuid,
      array[
        '99000000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000002'
      ]::uuid[]
    );
    raise exception 'Ordinary private-channel member managed membership';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000007';

do $$
begin
  if (
    select count(*)
    from public.workspace_conversations
    where id = current_setting('test.private_channel_id')::uuid
  ) <> 0 then
    raise exception 'Nonmember admin could read private-channel metadata through chat';
  end if;
  if (
    select count(*)
    from public.workspace_messages
    where conversation_id = current_setting('test.private_channel_id')::uuid
  ) <> 0 then
    raise exception 'Nonmember admin could read private-channel messages';
  end if;
  if (
    select count(*)
    from public.workspace_message_attachments
    where id = '95000000-0000-4000-8000-000000000010'
  ) <> 0 then
    raise exception 'Nonmember admin could read private attachment metadata';
  end if;
  if (
    select count(*)
    from storage.objects
    where id = '94000000-0000-4000-8000-000000000010'
  ) <> 0 then
    raise exception 'Nonmember admin could read the private stored file';
  end if;
  if not (
    public.get_workspace_admin_channels() @> jsonb_build_array(
      jsonb_build_object(
        'id',
        current_setting('test.private_channel_id')::uuid
      )
    )
  ) then
    raise exception 'Workspace admin could not inspect private-channel metadata';
  end if;

  perform public.set_workspace_channel_members(
    current_setting('test.private_channel_id')::uuid,
    array[
      '99000000-0000-4000-8000-000000000001',
      '99000000-0000-4000-8000-000000000002'
    ]::uuid[]
  );

  if (
    select count(*)
    from public.workspace_conversation_members
    where conversation_id = current_setting('test.private_channel_id')::uuid
      and revoked_at is null
  ) <> 2 then
    raise exception 'Admin membership update did not preserve owner and target member';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000006';

do $$
declare
  catch_up jsonb;
begin
  if (
    select count(*)
    from public.workspace_conversation_members
    where conversation_id = current_setting('test.private_channel_id')::uuid
      and profile_id = '99000000-0000-4000-8000-000000000006'
      and revoked_at is not null
  ) <> 1 then
    raise exception 'Removed member did not retain a Realtime revocation marker';
  end if;
  if (
    select count(*)
    from public.workspace_conversations
    where id = current_setting('test.private_channel_id')::uuid
  ) <> 0 then
    raise exception 'Removed member retained private-channel access';
  end if;
  if (
    select count(*)
    from public.workspace_messages
    where conversation_id = current_setting('test.private_channel_id')::uuid
  ) <> 0 then
    raise exception 'Removed member retained private-message access';
  end if;
  if (
    select count(*)
    from public.workspace_thread_reads
    where root_message_id = '97000000-0000-4000-8000-000000000010'
  ) <> 0 then
    raise exception 'Removed member retained private-thread access';
  end if;
  if (
    select count(*)
    from public.workspace_message_attachments
    where id = '95000000-0000-4000-8000-000000000010'
  ) <> 0 then
    raise exception 'Removed member retained private-attachment access';
  end if;
  if (
    select count(*)
    from storage.objects
    where id = '94000000-0000-4000-8000-000000000010'
  ) <> 0 then
    raise exception 'Removed member retained private-file access';
  end if;
  if (
    select count(*)
    from public.workspace_conversations
    where id = current_setting('test.group_dm_id')::uuid
  ) <> 1 then
    raise exception 'Private-channel removal incorrectly revoked group-DM access';
  end if;
  if exists (
    select 1
    from public.workspace_chat_conversation_projection
    where conversation_id = current_setting('test.private_channel_id')::uuid
  ) then
    raise exception 'Revoked private channel remained in the user projection';
  end if;
  if (
    select count(*)
    from public.workspace_chat_conversation_projection
    where conversation_id = current_setting('test.group_dm_id')::uuid
  ) <> 1 then
    raise exception 'Private-channel revocation evicted the group-DM projection';
  end if;

  catch_up := public.get_workspace_chat_events(
    current_setting('test.chat_d_cursor')::bigint,
    100
  );
  if (catch_up->>'reset_required')::boolean then
    raise exception 'Durable revocation catch-up incorrectly required a reset';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(catch_up->'events') as event(value)
    where event.value->>'type' = 'conversation.revoked'
      and event.value->>'conversation_id' =
        current_setting('test.private_channel_id')
  ) then
    raise exception 'Durable catch-up omitted the private-channel revocation';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000003';

do $$
begin
  if (
    select count(*)
    from public.workspace_conversations
    where id = '98000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Cross-organization user could read the DM';
  end if;

  if (
    select count(*)
    from public.workspace_messages
    where conversation_id = '98000000-0000-4000-8000-000000000001'
  ) <> 0 then
    raise exception 'Cross-organization user could read DM messages';
  end if;

  begin
    perform public.update_workspace_profile_admin(
      '99000000-0000-4000-8000-000000000003',
      'member',
      'active',
      true
    );
    raise exception 'Last active workspace admin was demoted';
  exception
    when check_violation then null;
  end;

  begin
    perform public.update_workspace_profile_admin(
      '99000000-0000-4000-8000-000000000001',
      'member',
      'active',
      true
    );
    raise exception 'Cross-organization profile administration was accepted';
  exception
    when no_data_found then null;
  end;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000004';

do $$
begin
  if (select count(*) from public.workspace_conversations) <> 0 then
    raise exception 'Suspended user could read conversations';
  end if;
end;
$$;

set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000005';

do $$
begin
  if (select count(*) from public.workspace_conversations) <> 0 then
    raise exception 'Organization-unbound user could read conversations';
  end if;

  if (select count(*) from public.projects) <> 0 then
    raise exception 'Organization-unbound user inherited workspace access';
  end if;
end;
$$;

reset role;

do $$
declare
  stale_cursor bigint;
begin
  select cursor_state.last_sequence
  into stale_cursor
  from public.workspace_chat_sync_cursors as cursor_state
  where cursor_state.profile_id =
    '99000000-0000-4000-8000-000000000002';

  perform set_config('test.retention_cursor', stale_cursor::text, true);
  perform private.enqueue_workspace_chat_event(
    '99000000-0000-4000-8000-000000000002',
    'workspace.reset',
    null,
    null,
    null,
    null,
    now() - interval '8 days'
  );
  perform private.enqueue_workspace_chat_event(
    '99000000-0000-4000-8000-000000000002',
    'workspace.reset'
  );
end;
$$;

set local role service_role;

do $$
begin
  if public.cleanup_workspace_chat_events(1000) <> 1 then
    raise exception 'Bounded chat-event cleanup did not prune one stale event';
  end if;
end;
$$;

reset role;

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.cleanup_workspace_chat_events(integer)',
    'execute'
  ) then
    raise exception 'Authenticated users can invoke chat-event cleanup';
  end if;
end;
$$;

set local role authenticated;
set local "request.jwt.claim.sub" = '99000000-0000-4000-8000-000000000002';

do $$
declare
  catch_up jsonb;
begin
  catch_up := public.get_workspace_chat_events(
    current_setting('test.retention_cursor')::bigint,
    100
  );
  if not (catch_up->>'reset_required')::boolean then
    raise exception 'Pruned stale cursor did not require a bootstrap reset';
  end if;
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from realtime.messages
    where topic =
        'workspace-membership:99000000-0000-4000-8000-000000000001'
      and extension = 'broadcast'
      and event = 'INSERT'
  ) then
    raise exception 'Membership changes were not broadcast to the member topic';
  end if;
  if not exists (
    select 1
    from realtime.messages
    where extension = 'broadcast'
      and event = 'workspace-chat-sync'
  ) then
    raise exception 'Durable chat events were not broadcast to the sync topic';
  end if;
  if exists (
    select 1
    from realtime.messages
    where extension = 'broadcast'
      and event = 'workspace-chat-sync'
      and payload ? 'body'
  ) then
    raise exception 'Workspace chat sync broadcast exposed a message body';
  end if;
end;
$$;

select extensions.pass('workspace chat synchronization invariants hold');
select * from extensions.finish();

rollback;
