begin;

select plan(10);

insert into public.organizations (id, name, slug)
values (
  '13000000-0000-4000-8000-000000000001',
  'Atomic Basecamp test',
  'atomic-basecamp-test'
);

insert into public.basecamp_import_runs (
  id,
  organization_id,
  account_id,
  source,
  export_date,
  manifest,
  coverage,
  known_gaps
)
values (
  '73000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  5548255,
  'Basecamp atomic SQL test',
  '2026-08-07',
  '{
    "profiles": 1,
    "projects": 1,
    "project_members": 1,
    "todo_lists": 1,
    "todos": 1,
    "todo_assignees": 1,
    "docs": 1,
    "comments": 1,
    "comment_mentions": 1
  }'::jsonb,
  '{
    "detailed_todos_exported": 619,
    "total_todos_from_list_counters": 2483,
    "detailed_todos_missing": 1864
  }'::jsonb,
  '["1864 todo details unavailable"]'::jsonb
);

insert into public.basecamp_import_stage (
  run_id,
  entity_type,
  source_key,
  payload
)
values
  (
    '73000000-0000-4000-8000-000000000001',
    'profiles',
    '93000000-0000-4000-8000-000000000001',
    '{
      "id": "93000000-0000-4000-8000-000000000001",
      "organization_id": "13000000-0000-4000-8000-000000000001",
      "email": "basecamp-atomic@example.com",
      "full_name": "Basecamp Atomic",
      "title": null,
      "role": "member",
      "status": "active",
      "preferences": {"is_internal": true},
      "basecamp_account_id": 5548255,
      "basecamp_person_id": 101,
      "person_type": "employee",
      "company_name": "P11 Creative",
      "source_payload": {"id": 101}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'projects',
    '23000000-0000-4000-8000-000000000001',
    '{
      "id": "23000000-0000-4000-8000-000000000001",
      "organization_id": "13000000-0000-4000-8000-000000000001",
      "name": "Imported atomic project",
      "code": "BC-ATOMIC-1",
      "client_name": null,
      "description": "Atomic import test",
      "status": "active",
      "metadata": {"source": "basecamp"},
      "archived_at": null,
      "created_at": "2026-08-07T12:00:00Z",
      "updated_at": "2026-08-07T12:00:00Z",
      "basecamp_account_id": 5548255,
      "basecamp_project_id": 201,
      "basecamp_payload": {"id": 201}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'project_members',
    '23000000-0000-4000-8000-000000000001:93000000-0000-4000-8000-000000000001',
    '{
      "project_id": "23000000-0000-4000-8000-000000000001",
      "profile_id": "93000000-0000-4000-8000-000000000001",
      "role": "member",
      "source": "basecamp",
      "source_payload": {"person_id": 101}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'todo_lists',
    '33000000-0000-4000-8000-000000000001',
    '{
      "id": "33000000-0000-4000-8000-000000000001",
      "project_id": "23000000-0000-4000-8000-000000000001",
      "title": "Imported list",
      "description": "1/2483 source counters represented in this fixture.",
      "position": 0,
      "is_archived": false,
      "basecamp_todolist_id": 301,
      "basecamp_payload": {"id": 301}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'todos',
    '43000000-0000-4000-8000-000000000001',
    '{
      "id": "43000000-0000-4000-8000-000000000001",
      "project_id": "23000000-0000-4000-8000-000000000001",
      "todo_list_id": "33000000-0000-4000-8000-000000000001",
      "title": "Imported todo",
      "assigned_to": "93000000-0000-4000-8000-000000000001",
      "due_at": null,
      "status": "todo",
      "priority": "medium",
      "position": 0,
      "sync_status": "not_synced",
      "basecamp_todo_id": 401,
      "basecamp_payload": {"id": 401}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'todo_assignees',
    '43000000-0000-4000-8000-000000000001:93000000-0000-4000-8000-000000000001',
    '{
      "todo_id": "43000000-0000-4000-8000-000000000001",
      "profile_id": "93000000-0000-4000-8000-000000000001",
      "assigned_by": null,
      "source": "basecamp",
      "source_payload": {"todo_id": 401}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'docs',
    '53000000-0000-4000-8000-000000000001',
    '{
      "id": "53000000-0000-4000-8000-000000000001",
      "project_id": "23000000-0000-4000-8000-000000000001",
      "title": "Imported document",
      "slug": "imported-document-501",
      "content": {"body": "Fixture"},
      "plain_text": "Fixture",
      "status": "published",
      "version": 1,
      "created_by": "93000000-0000-4000-8000-000000000001",
      "updated_by": "93000000-0000-4000-8000-000000000001",
      "published_at": "2026-08-07T12:00:00Z",
      "created_at": "2026-08-07T12:00:00Z",
      "updated_at": "2026-08-07T12:00:00Z",
      "basecamp_document_id": 501,
      "basecamp_payload": {"id": 501}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'comments',
    '63000000-0000-4000-8000-000000000001',
    '{
      "id": "63000000-0000-4000-8000-000000000001",
      "project_id": "23000000-0000-4000-8000-000000000001",
      "todo_id": "43000000-0000-4000-8000-000000000001",
      "doc_id": null,
      "author_id": "93000000-0000-4000-8000-000000000001",
      "body": "Imported comment",
      "metadata": {"source": "basecamp"},
      "created_at": "2026-08-07T12:00:00Z",
      "updated_at": "2026-08-07T12:00:00Z",
      "basecamp_comment_id": 601,
      "basecamp_recording_id": 401,
      "basecamp_payload": {"id": 601}
    }'::jsonb
  ),
  (
    '73000000-0000-4000-8000-000000000001',
    'comment_mentions',
    '63000000-0000-4000-8000-000000000001:93000000-0000-4000-8000-000000000001',
    '{
      "comment_id": "63000000-0000-4000-8000-000000000001",
      "profile_id": "93000000-0000-4000-8000-000000000001"
    }'::jsonb
  );

insert into public.basecamp_import_checkpoints (
  run_id,
  entity_type,
  batch_number,
  row_count,
  content_sha256
)
select
  '73000000-0000-4000-8000-000000000001',
  entity_type,
  0,
  1::bigint,
  repeat(substr(md5(entity_type), 1, 1), 64)
from unnest(array[
  'profiles',
  'projects',
  'project_members',
  'todo_lists',
  'todos',
  'todo_assignees',
  'docs',
  'comments',
  'comment_mentions'
]) as entity(entity_type);

set local role service_role;
select is(
  public.finalize_basecamp_import(
    '73000000-0000-4000-8000-000000000001'
  ) ->> 'status',
  'succeeded',
  'a complete staged snapshot finalizes atomically'
);
reset role;

select is(
  (
    select count(*)
    from public.todos
    where project_id = '23000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the finalizer imports only the staged detailed todo'
);

set local role service_role;
select is(
  public.finalize_basecamp_import(
    '73000000-0000-4000-8000-000000000001'
  ),
  (
    select summary
    from public.basecamp_import_runs
    where id = '73000000-0000-4000-8000-000000000001'
  ),
  'retrying a succeeded run returns its stored result'
);
reset role;

create temporary table first_import_activity as
select count(*) as event_count
from public.activity_events
where project_id = '23000000-0000-4000-8000-000000000001';

insert into public.basecamp_import_runs (
  id,
  organization_id,
  account_id,
  source,
  export_date,
  manifest,
  coverage,
  known_gaps
)
select
  '73000000-0000-4000-8000-000000000002',
  organization_id,
  account_id,
  source,
  export_date,
  manifest,
  coverage,
  known_gaps
from public.basecamp_import_runs
where id = '73000000-0000-4000-8000-000000000001';

insert into public.basecamp_import_stage (
  run_id,
  entity_type,
  source_key,
  payload
)
select
  '73000000-0000-4000-8000-000000000002',
  entity_type,
  source_key,
  payload
from public.basecamp_import_stage
where run_id = '73000000-0000-4000-8000-000000000001';

insert into public.basecamp_import_checkpoints (
  run_id,
  entity_type,
  batch_number,
  row_count,
  content_sha256
)
select
  '73000000-0000-4000-8000-000000000002',
  entity_type,
  batch_number,
  row_count,
  content_sha256
from public.basecamp_import_checkpoints
where run_id = '73000000-0000-4000-8000-000000000001';

set local role service_role;
select is(
  public.finalize_basecamp_import(
    '73000000-0000-4000-8000-000000000002'
  ) ->> 'status',
  'succeeded',
  'an identical snapshot can finalize as a separate run'
);
reset role;

select is(
  (
    select count(*)
    from public.activity_events
    where project_id = '23000000-0000-4000-8000-000000000001'
  ),
  (select event_count from first_import_activity),
  'an identical snapshot emits no no-op project activity'
);

select is(
  (
    select version
    from public.todos
    where id = '43000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'an identical snapshot does not advance the todo version'
);

select is(
  (
    select settings #>> '{basecamp_import,coverage,detailed_todos_missing}'
    from public.organizations
    where id = '13000000-0000-4000-8000-000000000001'
  ),
  '1864',
  'the known 619/2483 source incompleteness remains visible'
);

insert into public.basecamp_import_runs (
  id,
  organization_id,
  account_id,
  source,
  export_date,
  manifest,
  coverage,
  known_gaps
)
values (
  '73000000-0000-4000-8000-000000000003',
  '13000000-0000-4000-8000-000000000001',
  5548255,
  'Invalid Basecamp atomic SQL test',
  '2026-08-07',
  '{
    "profiles": 0,
    "projects": 0,
    "project_members": 0,
    "todo_lists": 1,
    "todos": 0,
    "todo_assignees": 0,
    "docs": 0,
    "comments": 0,
    "comment_mentions": 0
  }'::jsonb,
  '{
    "detailed_todos_exported": 619,
    "total_todos_from_list_counters": 2483,
    "detailed_todos_missing": 1864
  }'::jsonb,
  '["invalid-reference fixture"]'::jsonb
);

insert into public.basecamp_import_stage (
  run_id,
  entity_type,
  source_key,
  payload
)
values (
  '73000000-0000-4000-8000-000000000003',
  'todo_lists',
  '33000000-0000-4000-8000-000000000099',
  '{
    "id": "33000000-0000-4000-8000-000000000099",
    "project_id": "23000000-0000-4000-8000-000000000099",
    "title": "Dangling list",
    "description": null,
    "position": 0,
    "is_archived": false,
    "basecamp_todolist_id": 399,
    "basecamp_payload": {"id": 399}
  }'::jsonb
);

insert into public.basecamp_import_checkpoints (
  run_id,
  entity_type,
  batch_number,
  row_count,
  content_sha256
)
values (
  '73000000-0000-4000-8000-000000000003',
  'todo_lists',
  0,
  1,
  repeat('f', 64)
);

set local role service_role;
select throws_ok(
  $test$
    select public.finalize_basecamp_import(
      '73000000-0000-4000-8000-000000000003'
    )
  $test$,
  '23514',
  'A staged todo list has an invalid project.',
  'dangling staged relationships abort before any merge'
);
reset role;

select is(
  (
    select status
    from public.basecamp_import_runs
    where id = '73000000-0000-4000-8000-000000000003'
  ),
  'staging',
  'a rejected finalization leaves the run resumable'
);

set local role service_role;
select throws_ok(
  $test$
    insert into public.basecamp_import_stage (
      run_id,
      entity_type,
      source_key,
      payload
    )
    values (
      '73000000-0000-4000-8000-000000000001',
      'profiles',
      'late-write',
      '{"id":"93000000-0000-4000-8000-000000000099"}'::jsonb
    )
  $test$,
  '55000',
  'Basecamp staging can only change while its run is staging.',
  'a finalized snapshot cannot be mutated'
);
reset role;

select * from finish();
rollback;
