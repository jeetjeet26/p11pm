begin;

select plan(1);

insert into public.organizations (id, name, slug)
values
  (
    '12000000-0000-4000-8000-000000000001',
    'Identity test organization',
    'identity-test-organization'
  ),
  (
    '12000000-0000-4000-8000-000000000002',
    'Identity test outsider',
    'identity-test-outsider'
  );

insert into public.profiles (
  id,
  organization_id,
  email,
  full_name,
  role,
  status
)
values
  (
    '91000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'identity-admin@example.com',
    'Identity Admin',
    'admin',
    'active'
  ),
  (
    '91000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000001',
    'identity-manager@example.com',
    'Identity Manager',
    'manager',
    'active'
  ),
  (
    '91000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    'identity-member@example.com',
    'Identity Member',
    'member',
    'active'
  ),
  (
    '91000000-0000-4000-8000-000000000004',
    '12000000-0000-4000-8000-000000000001',
    'identity-nonmember@example.com',
    'Identity Nonmember',
    'member',
    'active'
  ),
  (
    '91000000-0000-4000-8000-000000000005',
    '12000000-0000-4000-8000-000000000002',
    'identity-outsider@example.com',
    'Identity Outsider',
    'admin',
    'active'
  ),
  (
    '91000000-0000-4000-8000-000000000006',
    null,
    'identity-invited@example.com',
    '',
    'member',
    'suspended'
  ),
  (
    '91000000-0000-4000-8000-000000000007',
    null,
    'identity-expired@example.com',
    '',
    'member',
    'suspended'
  );

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  owner_id
)
values
  (
    '92000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'Identity Member Project',
    'IDENTITY-A',
    '91000000-0000-4000-8000-000000000001'
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000001',
    'Identity Restricted Project',
    'IDENTITY-B',
    '91000000-0000-4000-8000-000000000001'
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000002',
    'Identity Outside Project',
    'IDENTITY-C',
    '91000000-0000-4000-8000-000000000005'
  );

insert into public.project_members (project_id, profile_id, role)
values (
  '92000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000003',
  'member'
);

insert into public.todo_lists (id, project_id, title)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Visible list'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'Restricted list'
  );

insert into public.todos (
  id,
  project_id,
  todo_list_id,
  title,
  created_by
)
values
  (
    '94000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    'Visible to-do',
    '91000000-0000-4000-8000-000000000003'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    'Restricted to-do',
    '91000000-0000-4000-8000-000000000001'
  );

insert into public.messages (id, project_id, sender_id, body)
values
  (
    '98000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003',
    'Visible message'
  ),
  (
    '98000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    'Restricted message'
  );

insert into public.invites (
  id,
  organization_id,
  email,
  role,
  token_hash,
  expires_at
)
values
  (
    '96000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'identity-invited@example.com',
    'member',
    encode(
      extensions.digest(
        'identity-valid-invite-token-0001',
        'sha256'
      ),
      'hex'
    ),
    now() + interval '1 day'
  ),
  (
    '96000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000001',
    'identity-expired@example.com',
    'member',
    encode(
      extensions.digest(
        'identity-expired-invite-token-01',
        'sha256'
      ),
      'hex'
    ),
    now() - interval '1 day'
  ),
  (
    '96000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000001',
    'identity-new@example.com',
    'viewer',
    encode(
      extensions.digest(
        'identity-new-profile-token-0001',
        'sha256'
      ),
      'hex'
    ),
    now() + interval '1 day'
  );

insert into auth.users (
  id,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '91000000-0000-4000-8000-000000000003',
    'identity-member@example.com',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '91000000-0000-4000-8000-000000000006',
    'identity-invited@example.com',
    jsonb_build_object(
      'workspace_invite_id',
      '96000000-0000-4000-8000-000000000001'
    ),
    '{"full_name":"Invited Identity"}'::jsonb,
    now(),
    now()
  );

insert into public.workspace_conversations (
  id,
  organization_id,
  kind,
  name,
  slug,
  visibility,
  dm_member_key,
  created_by
)
values
  (
    '97000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'channel',
    'Identity Private Channel',
    'identity-private-channel',
    'private',
    null,
    '91000000-0000-4000-8000-000000000003'
  ),
  (
    '97000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000001',
    'dm',
    null,
    null,
    'private',
    '91000000-0000-4000-8000-000000000002,91000000-0000-4000-8000-000000000003',
    '91000000-0000-4000-8000-000000000003'
  );

insert into public.workspace_conversation_members (
  conversation_id,
  profile_id,
  member_role,
  added_by
)
values
  (
    '97000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000003',
    'owner',
    '91000000-0000-4000-8000-000000000003'
  ),
  (
    '97000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000003',
    'owner',
    '91000000-0000-4000-8000-000000000003'
  ),
  (
    '97000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'member',
    '91000000-0000-4000-8000-000000000003'
  );

do $$
begin
  begin
    insert into auth.users (
      id,
      email,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    values (
      '91000000-0000-4000-8000-000000000096',
      'public-signup@example.com',
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );
    raise exception 'The Auth trigger allowed an unrostered public signup';
  exception
    when insufficient_privilege then null;
  end;

  if exists (
    select 1
    from auth.users
    where id = '91000000-0000-4000-8000-000000000096'
  ) then
    raise exception 'A rejected public Auth user was persisted';
  end if;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000003',
    'email', 'identity-member@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 1 then
    raise exception 'A regular member could read a project without membership';
  end if;

  if (
    select count(*)
    from public.projects
    where id = '92000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'A regular member could not read their assigned project';
  end if;

  if (select count(*) from public.todo_lists) <> 1
    or (select count(*) from public.todos) <> 1
  then
    raise exception 'Project child rows were not scoped with their project';
  end if;

  if (
    select count(*)
    from public.organizations
    where id = '12000000-0000-4000-8000-000000000002'
  ) <> 0 then
    raise exception 'A member could read another organization';
  end if;

  if (
    select count(*)
    from public.workspace_conversations
    where id in (
      '97000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000002'
    )
  ) <> 2 then
    raise exception 'A private channel or group DM was hidden from its member';
  end if;

  insert into public.chat_messages (
    id,
    conversation_id,
    profile_id,
    role,
    content
  )
  values (
    '99000000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000010',
    '91000000-0000-4000-8000-000000000003',
    'user',
    'Private personal chat'
  );

  if (
    select count(*)
    from public.chat_messages
    where id = '99000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'An active member could not use their personal chat';
  end if;

  begin
    insert into public.comments (
      project_id,
      author_id,
      body,
      metadata
    )
    values (
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000003',
      'Cross-project message comment',
      jsonb_build_object(
        'target_type',
        'message',
        'message_id',
        '98000000-0000-4000-8000-000000000002'
      )
    );
    raise exception 'A comment referenced a message in another project';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.todos (
      project_id,
      todo_list_id,
      title,
      created_by
    )
    values (
      '92000000-0000-4000-8000-000000000002',
      '93000000-0000-4000-8000-000000000002',
      'Unauthorized to-do',
      '91000000-0000-4000-8000-000000000003'
    );
    raise exception 'A member wrote to a project without membership';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

do $$
declare
  reservation jsonb;
  reservation_id uuid;
  object_name text;
begin
  reservation := public.create_upload_reservation(
    'project_file',
    '92000000-0000-4000-8000-000000000001',
    'allowed.txt',
    'text/plain',
    1
  );
  reservation_id := (reservation ->> 'id')::uuid;
  object_name := reservation ->> 'objectName';

  insert into storage.objects (
    id,
    bucket_id,
    name,
    owner_id,
    metadata
  )
  values (
    '95000000-0000-4000-8000-000000000001',
    reservation ->> 'bucketName',
    object_name,
    '91000000-0000-4000-8000-000000000003',
    '{"size": 1, "mimetype": "text/plain"}'::jsonb
  );

  perform public.finalize_upload_reservation(reservation_id);

  if (
    select count(*)
    from storage.objects
    where name = object_name
  ) <> 1 then
    raise exception 'A project member could not read an authorized object';
  end if;

  begin
    perform public.create_upload_reservation(
      'project_file',
      '92000000-0000-4000-8000-000000000002',
      'blocked.txt',
      'text/plain',
      1
    );
    raise exception 'A member reserved an upload for an unauthorized project';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into storage.objects (
      id,
      bucket_id,
      name,
      owner_id,
      metadata
    )
    values (
      '95000000-0000-4000-8000-000000000002',
      'project-files',
      '92000000-0000-4000-8000-000000000001/unreserved.txt',
      '91000000-0000-4000-8000-000000000003',
      '{"size": 1, "mimetype": "text/plain"}'::jsonb
    );
    raise exception 'A member bypassed the upload reservation';
  exception
    when insufficient_privilege then null;
  end;

  begin
    insert into public.files (
      project_id,
      uploaded_by,
      object_path,
      file_name,
      size_bytes
    )
    values (
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000003',
      '92000000-0000-4000-8000-000000000002/forged.txt',
      'forged.txt',
      1
    );
    raise exception 'File metadata accepted a mismatched project path';
  exception
    when check_violation then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000004',
    'email', 'identity-nonmember@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 0 then
    raise exception 'A regular nonmember could read organization projects';
  end if;

  if exists (
    select 1
    from public.workspace_conversations
    where id in (
      '97000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000002'
    )
  ) then
    raise exception 'A nonmember could read a private channel or group DM';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000001',
    'email', 'identity-admin@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 2 then
    raise exception 'An admin could not read all same-organization projects';
  end if;

  begin
    insert into public.invites (
      organization_id,
      email,
      token_hash,
      invited_by
    )
    values (
      '12000000-0000-4000-8000-000000000001',
      'identity-cross-org@example.com',
      'identity-cross-organization-token-hash',
      '91000000-0000-4000-8000-000000000005'
    );
    raise exception 'An invitation referenced another organization profile';
  exception
    when check_violation then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000002',
    'email', 'identity-manager@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
begin
  if (select count(*) from public.projects) <> 2 then
    raise exception 'A manager could not read all same-organization projects';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000006',
    'email', 'identity-invited@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  claimed_profile_id uuid;
begin
  begin
    insert into public.chat_messages (
      conversation_id,
      profile_id,
      role,
      content
    )
    values (
      '99000000-0000-4000-8000-000000000011',
      '91000000-0000-4000-8000-000000000006',
      'user',
      'Suspended personal chat'
    );
    raise exception 'A suspended invited profile used personal chat';
  exception
    when insufficient_privilege then null;
  end;

  claimed_profile_id := public.claim_workspace_invite(
    'identity-valid-invite-token-0001',
    'Claimed Identity'
  );

  if claimed_profile_id <> '91000000-0000-4000-8000-000000000006'::uuid then
    raise exception 'The invitation returned the wrong profile';
  end if;

  if public.claim_workspace_invite(
    'identity-valid-invite-token-0001',
    'Claimed Identity'
  ) <> claimed_profile_id then
    raise exception 'An idempotent invitation retry changed the claimant';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000007',
    'email', 'identity-expired@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
begin
  begin
    perform public.claim_workspace_invite(
      'identity-expired-invite-token-01',
      'Expired Identity'
    );
    raise exception 'An expired invitation was accepted';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '91000000-0000-4000-8000-000000000004',
    'email', 'identity-nonmember@example.com',
    'role', 'authenticated'
  )::text,
  true
);

do $$
begin
  begin
    perform public.claim_workspace_invite(
      'identity-new-profile-token-0001',
      'Wrong Identity'
    );
    raise exception 'An invitation was claimed by a different email';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
declare
  active_roster_result jsonb;
  outsider_result jsonb;
  pending_invite_result jsonb;
  wrong_identity_result jsonb;
begin
  if (
    select profile.organization_id
    from public.profiles as profile
    where profile.id = '91000000-0000-4000-8000-000000000006'
  ) <> '12000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'Invitation claim did not bind the organization';
  end if;

  if (
    select invitation.status = 'accepted'
      and invitation.accepted_by =
        '91000000-0000-4000-8000-000000000006'::uuid
      and invitation.accepted_at is not null
    from public.invites as invitation
    where invitation.id = '96000000-0000-4000-8000-000000000001'
  ) is not true then
    raise exception 'Invitation consumption was not persisted atomically';
  end if;

  if (
    select profile.status
    from public.profiles as profile
    where profile.id = '91000000-0000-4000-8000-000000000007'
  ) <> 'suspended' then
    raise exception 'An expired invitation changed the profile';
  end if;

  begin
    insert into public.project_members (project_id, profile_id)
    values (
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000005'
    );
    raise exception 'Cross-organization project membership was accepted';
  exception
    when check_violation then null;
  end;

  active_roster_result := private.hook_restrict_workspace_signup(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'id', '91000000-0000-4000-8000-000000000003',
        'email', 'identity-member@example.com',
        'app_metadata', '{}'::jsonb
      )
    )
  );
  if active_roster_result <> '{}'::jsonb then
    raise exception 'The Auth hook rejected a matching active roster identity';
  end if;

  outsider_result := private.hook_restrict_workspace_signup(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'id', '91000000-0000-4000-8000-000000000099',
        'email', 'public-signup@example.com',
        'app_metadata', '{}'::jsonb
      )
    )
  );
  if outsider_result -> 'error' is null then
    raise exception 'The Auth hook allowed an uninvited public signup';
  end if;

  pending_invite_result := private.hook_restrict_workspace_signup(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'id', '91000000-0000-4000-8000-000000000098',
        'email', 'identity-new@example.com',
        'app_metadata',
        jsonb_build_object(
          'workspace_invite_id',
          '96000000-0000-4000-8000-000000000003'
        )
      )
    )
  );
  if pending_invite_result <> '{}'::jsonb then
    raise exception 'The Auth hook rejected a server-marked pending invite';
  end if;

  wrong_identity_result := private.hook_restrict_workspace_signup(
    jsonb_build_object(
      'user',
      jsonb_build_object(
        'id', '91000000-0000-4000-8000-000000000097',
        'email', 'identity-member@example.com',
        'app_metadata', '{}'::jsonb
      )
    )
  );
  if wrong_identity_result -> 'error' is null then
    raise exception 'The Auth hook ignored an Auth/profile UUID mismatch';
  end if;

  if has_function_privilege(
    'anon',
    'private.hook_restrict_workspace_signup(jsonb)',
    'execute'
  ) then
    raise exception 'Anonymous users can execute the Auth admission hook';
  end if;

  if not has_function_privilege(
    'supabase_auth_admin',
    'private.hook_restrict_workspace_signup(jsonb)',
    'execute'
  ) then
    raise exception 'Supabase Auth cannot execute the admission hook';
  end if;
end;
$$;

select pass('identity authorization invariants hold');
select * from finish();

rollback;
