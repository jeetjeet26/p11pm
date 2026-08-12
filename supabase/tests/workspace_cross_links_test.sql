begin;

select extensions.plan(1);

insert into public.organizations (id, name, slug)
values
  (
    '21000000-0000-4000-8000-000000000001',
    'Cross-link organization',
    'cross-link-organization'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    'Cross-link outsider',
    'cross-link-outsider'
  );

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
    '29000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'cross-link-admin@example.com',
    'Cross Link Admin',
    'admin',
    'active',
    true
  ),
  (
    '29000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    'cross-link-member@example.com',
    'Cross Link Member',
    'member',
    'active',
    true
  ),
  (
    '29000000-0000-4000-8000-000000000003',
    '21000000-0000-4000-8000-000000000002',
    'cross-link-outsider@example.com',
    'Cross Link Outsider',
    'admin',
    'active',
    true
  );

insert into public.projects (id, organization_id, name, code, owner_id)
values
  (
    '72000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'Cross Link Project',
    'XLINK-A',
    '29000000-0000-4000-8000-000000000001'
  ),
  (
    '72000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002',
    'Outside Cross Link Project',
    'XLINK-B',
    '29000000-0000-4000-8000-000000000003'
  );

insert into public.project_members (project_id, profile_id)
values (
  '72000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000002'
);

insert into public.todo_lists (id, project_id, title)
values (
  '23000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'Cross Link Issues'
);

insert into public.todos (id, project_id, todo_list_id, title)
values (
  '24000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'Cross-link this issue'
);

insert into public.workspace_conversations (
  id,
  organization_id,
  kind,
  visibility,
  name,
  slug,
  created_by
)
values
  (
    '28000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'channel',
    'public',
    'cross-links',
    'cross-links',
    '29000000-0000-4000-8000-000000000001'
  ),
  (
    '28000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000001',
    'channel',
    'private',
    'private-cross-links',
    'private-cross-links',
    '29000000-0000-4000-8000-000000000001'
  );

insert into public.workspace_conversation_members (
  conversation_id,
  profile_id,
  member_role
)
values (
  '28000000-0000-4000-8000-000000000002',
  '29000000-0000-4000-8000-000000000001',
  'owner'
);

insert into public.workspace_messages (
  id,
  conversation_id,
  sender_id,
  body,
  client_nonce
)
values (
  '27000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000002',
  '29000000-0000-4000-8000-000000000001',
  'Private attachment message',
  '26000000-0000-4000-8000-000000000001'
);

insert into public.workspace_message_attachments (
  id,
  conversation_id,
  message_id,
  uploader_id,
  object_path,
  file_name,
  mime_type,
  size_bytes
)
values (
  '25000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000002',
  '27000000-0000-4000-8000-000000000001',
  '29000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000002/29000000-0000-4000-8000-000000000001/cross-link.txt',
  'cross-link.txt',
  'text/plain',
  16
);

set local role authenticated;
set local "request.jwt.claim.sub" = '29000000-0000-4000-8000-000000000001';

select public.send_workspace_message(
  '28000000-0000-4000-8000-000000000001',
  'Issue is linked',
  '26000000-0000-4000-8000-000000000002',
  null,
  '{}'::uuid[],
  '[{"type":"issue","id":"24000000-0000-4000-8000-000000000001"}]'::jsonb
);

select public.send_workspace_message(
  '28000000-0000-4000-8000-000000000001',
  'Issue is linked',
  '26000000-0000-4000-8000-000000000002',
  null,
  '{}'::uuid[],
  '[{"type":"issue","id":"24000000-0000-4000-8000-000000000001"}]'::jsonb
);

select public.link_workspace_chat_entity(
  'attachment',
  '25000000-0000-4000-8000-000000000001',
  'issue',
  '24000000-0000-4000-8000-000000000001'
);

do $$
begin
  if (
    select count(*)
    from public.workspace_cross_links
    where work_type = 'issue'
      and work_id = '24000000-0000-4000-8000-000000000001'
  ) <> 2 then
    raise exception 'Message retry duplicated a link or attachment link was lost';
  end if;

  begin
    perform public.link_workspace_chat_entity(
      'message',
      (
        select message.id
        from public.workspace_messages as message
        where message.client_nonce =
          '26000000-0000-4000-8000-000000000002'
      ),
      'project',
      '72000000-0000-4000-8000-000000000002'
    );
    raise exception 'Cross-organization link was accepted';
  exception
    when check_violation then null;
  end;
end;
$$;

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '29000000-0000-4000-8000-000000000002';

do $$
begin
  if exists (
    select 1
    from public.workspace_cross_links
    where workspace_attachment_id =
      '25000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Private-channel attachment backlink leaked to a nonmember';
  end if;
  if not exists (
    select 1
    from public.workspace_cross_links
    where work_type = 'issue'
      and work_id = '24000000-0000-4000-8000-000000000001'
      and chat_type = 'message'
  ) then
    raise exception 'Accessible public-channel backlink was hidden';
  end if;
end;
$$;

reset role;

delete from public.todos
where id = '24000000-0000-4000-8000-000000000001';

do $$
begin
  if exists (
    select 1
    from public.workspace_cross_links
    where work_id = '24000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'Deleted work target did not cascade cross-links';
  end if;
end;
$$;

select extensions.pass('workspace cross-link security invariants hold');
select * from extensions.finish();

rollback;
