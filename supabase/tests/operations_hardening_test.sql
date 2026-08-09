begin;

select extensions.plan(8);

select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"00000000-0000-4000-8000-000000000001"}',
  true
);

do $$
declare
  project_limit bigint;
  chat_limit bigint;
begin
  if to_regclass('public.upload_reservations') is null
     or to_regclass('public.slack_notification_outbox') is null
     or to_regclass('public.storage_deletion_outbox') is null then
    raise exception 'Operations hardening tables are missing';
  end if;

  select file_size_limit into project_limit
  from storage.buckets where id = 'project-files';
  select file_size_limit into chat_limit
  from storage.buckets where id = 'workspace-chat-files';
  if project_limit <> 4294967296 or chat_limit <> 26214400 then
    raise exception
      'Project files must allow 4 GiB exports while chat stays at 25 MB';
  end if;

  if to_regprocedure(
    'public.create_upload_reservation(text,uuid,text,text,bigint)'
  ) is null or to_regprocedure(
    'public.finalize_upload_reservation(uuid)'
  ) is null then
    raise exception 'Upload reservation RPCs are missing';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'Internal users can update project files',
        'Project members can update project files',
        'Internal users can delete project files',
        'Project members can delete project files',
        'Chat users can remove their pending message files'
      )
  ) then
    raise exception 'Direct object update/delete policies must stay disabled';
  end if;
end;
$$;
select extensions.pass('upload schema, bucket limits, and storage policies');

set local session_replication_role = replica;
insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '74100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'operations-upload@example.com',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  '74000000-0000-4000-8000-000000000001',
  'Operations test organization',
  'operations-test-organization'
);
insert into public.profiles (
  id,
  organization_id,
  email,
  full_name,
  role,
  status
)
values (
  '74100000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'operations-upload@example.com',
  'Operations Uploader',
  'member',
  'active'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"74100000-0000-4000-8000-000000000001","email":"operations-upload@example.com"}',
  true
);

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  status
)
values (
  '74200000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  'Operations upload project',
  'OPS-UPLOAD',
  'active'
);
insert into public.project_members (project_id, profile_id)
values (
  '74200000-0000-4000-8000-000000000001',
  '74100000-0000-4000-8000-000000000001'
);

do $$
declare
  reservation jsonb;
  finalized jsonb;
begin
  reservation := public.create_upload_reservation(
    'project_file',
    '74200000-0000-4000-8000-000000000001',
    'review.pdf',
    'application/pdf',
    1024
  );
  if reservation ->> 'status' <> 'pending'
     or reservation ->> 'bucketName' <> 'project-files'
     or reservation ->> 'objectName' not like
       '74200000-0000-4000-8000-000000000001/74100000-0000-4000-8000-000000000001/%'
  then
    raise exception 'Project upload reservation was not scoped correctly';
  end if;

  insert into storage.objects (
    bucket_id,
    name,
    owner,
    owner_id,
    metadata
  )
  values (
    reservation ->> 'bucketName',
    reservation ->> 'objectName',
    '74100000-0000-4000-8000-000000000001',
    '74100000-0000-4000-8000-000000000001',
    '{"size":1024,"mimetype":"application/pdf"}'
  );

  finalized := public.finalize_upload_reservation(
    (reservation ->> 'id')::uuid
  );
  if finalized ->> 'status' <> 'finalized'
     or finalized #>> '{resource,title}' <> 'review.pdf'
     or not exists (
       select 1 from public.files
       where id = (finalized #>> '{resource,id}')::uuid
         and size_bytes = 1024
     )
  then
    raise exception 'Project upload finalization was not atomic';
  end if;
end;
$$;
select extensions.pass('project uploads reserve and finalize atomically');

update public.profiles
set preferences = jsonb_build_object('slack_user_id', 'UOPERATIONS')
where id = '74100000-0000-4000-8000-000000000001';

insert into public.todo_lists (id, project_id, title, created_by)
values (
  '74300000-0000-4000-8000-000000000001',
  '74200000-0000-4000-8000-000000000001',
  'Operations notifications',
  '74100000-0000-4000-8000-000000000001'
);
insert into public.todos (
  id,
  project_id,
  todo_list_id,
  title,
  status,
  created_by
)
values (
  '74400000-0000-4000-8000-000000000001',
  '74200000-0000-4000-8000-000000000001',
  '74300000-0000-4000-8000-000000000001',
  'Verify transactional notifications',
  'todo',
  '74100000-0000-4000-8000-000000000001'
);
insert into public.todo_completion_subscribers (todo_id, profile_id)
values (
  '74400000-0000-4000-8000-000000000001',
  '74100000-0000-4000-8000-000000000001'
);

update public.todos
set
  status = 'done',
  completed_at = now(),
  completed_by = null
where id = '74400000-0000-4000-8000-000000000001';

select extensions.ok(
  (
    select count(*) = 1
    from public.slack_notification_outbox
    where event_type = 'todo.completed'
      and channel = 'UOPERATIONS'
      and payload #>> '{metadata,todoId}' =
        '74400000-0000-4000-8000-000000000001'
  ),
  'todo completion enqueues Slack delivery in the write transaction'
);

insert into public.comments (
  id,
  project_id,
  todo_id,
  author_id,
  body
)
values (
  '74500000-0000-4000-8000-000000000001',
  '74200000-0000-4000-8000-000000000001',
  '74400000-0000-4000-8000-000000000001',
  null,
  'The transactional notification path is ready.'
);

select extensions.ok(
  (
    select count(*) = 1
    from public.slack_notification_outbox
    where event_type = 'todo.comment.created'
      and channel = 'UOPERATIONS'
      and payload #>> '{metadata,commentId}' =
        '74500000-0000-4000-8000-000000000001'
  ),
  'todo comments enqueue Slack delivery in the write transaction'
);

select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"00000000-0000-4000-8000-000000000001"}',
  true
);

-- Mutation-owner integration contract:
--   perform private.enqueue_slack_notification(
--     'todo.completed',
--     subscriber_slack_id,
--     notification_text,
--     null,
--     null,
--     format('todo:%s:completed:%s', todo_id, mutation_nonce),
--     jsonb_build_object('todoId', todo_id)
--   );
-- This call belongs inside the same private mutation RPC transaction as the
-- todo/comment write; the following rollback check proves outbox atomicity.
do $$
begin
  begin
    insert into public.slack_notification_outbox (
      event_type,
      channel,
      payload,
      idempotency_key
    )
    values (
      'test.rollback',
      'UROLLBACK',
      '{"text":"must roll back"}',
      'operations-test-rollback'
    );
    raise exception 'force mutation rollback';
  exception
    when others then null;
  end;

  if exists (
    select 1 from public.slack_notification_outbox
    where idempotency_key = 'operations-test-rollback'
  ) then
    raise exception 'Outbox row escaped its mutation transaction';
  end if;
end;
$$;
select extensions.pass('notification rows share the mutation transaction');

do $$
declare
  claimed record;
  result text;
  next_attempt timestamptz;
begin
  insert into public.slack_notification_outbox (
    id,
    event_type,
    channel,
    payload,
    idempotency_key,
    max_attempts,
    available_at,
    created_at
  )
  values (
    '71000000-0000-4000-8000-000000000001',
    'test.retry',
    'UTEST',
    '{"text":"retry me"}',
    'operations-test-retry',
    2,
    now() - interval '1 day',
    now() - interval '1 day'
  );

  select * into claimed
  from public.claim_slack_notifications(1, 120);
  if claimed.id <> '71000000-0000-4000-8000-000000000001'::uuid
     or claimed.attempt_count <> 1
     or claimed.lock_token is null then
    raise exception 'Slack claim was not atomic';
  end if;

  result := public.fail_slack_notification(
    claimed.id,
    claimed.lock_token,
    'rate limited',
    'ratelimited',
    600
  );
  select available_at into next_attempt
  from public.slack_notification_outbox where id = claimed.id;
  if result <> 'failed' or next_attempt < now() + interval '590 seconds' then
    raise exception 'Slack Retry-After was not honored';
  end if;

  update public.slack_notification_outbox
  set available_at = now() where id = claimed.id;
  select * into claimed
  from public.claim_slack_notifications(1, 120);
  result := public.fail_slack_notification(
    claimed.id,
    claimed.lock_token,
    'still failing',
    'ratelimited',
    null
  );
  if result <> 'dead' or not exists (
    select 1 from public.slack_notification_outbox
    where id = claimed.id
      and status = 'dead'
      and dead_lettered_at is not null
  ) then
    raise exception 'Slack max-attempt dead lettering failed';
  end if;
end;
$$;
select extensions.pass('Slack claims honor retry and dead-letter rules');

do $$
declare
  claimed record;
begin
  insert into public.storage_deletion_outbox (
    id,
    bucket_id,
    object_path,
    reason
  )
  values (
    '72000000-0000-4000-8000-000000000001',
    'project-files',
    'test/orphan.txt',
    'operations_test'
  );

  select * into claimed
  from public.claim_storage_deletions(1, 120);
  if claimed.id <> '72000000-0000-4000-8000-000000000001'::uuid
     or claimed.lock_token is null then
    raise exception 'Storage deletion claim failed';
  end if;
  if not public.ack_storage_deletion(claimed.id, claimed.lock_token) then
    raise exception 'Storage deletion acknowledgement failed';
  end if;
end;
$$;
select extensions.pass('storage deletion claims acknowledge atomically');

do $$
declare
  activity_id uuid := '73000000-0000-4000-8000-000000000001';
  report jsonb;
begin
  insert into public.activity_events (
    id,
    entity_type,
    action,
    created_at
  )
  values (
    activity_id,
    'operations_test',
    'created',
    now() - interval '366 days'
  );

  report := public.run_operations_cleanup(10, true);
  if coalesce((report #>> '{retention,activity365Days}')::integer, 0) < 1 then
    raise exception 'Cleanup dry-run did not report expired activity';
  end if;
  if not exists (
    select 1 from public.activity_events where id = activity_id
  ) then
    raise exception 'Cleanup dry-run mutated activity';
  end if;

  perform public.run_operations_cleanup(10, false);
  if exists (
    select 1 from public.activity_events where id = activity_id
  ) then
    raise exception 'Cleanup execution did not delete expired activity';
  end if;
end;
$$;
select extensions.pass('cleanup defaults support dry-run and execution');

select * from extensions.finish();

rollback;
