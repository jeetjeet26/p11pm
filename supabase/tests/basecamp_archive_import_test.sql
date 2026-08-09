begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select no_plan();

set local session_replication_role = replica;
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'archive-admin@example.com',
    crypt('password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Archive Admin"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'archive-manager@example.com',
    crypt('password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Archive Manager"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '11000000-0000-0000-0000-000000000003',
    'authenticated',
    'authenticated',
    'archive-member@example.com',
    crypt('password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Archive Member"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '21000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'archive-outsider@example.com',
    crypt('password', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Archive Outsider"}'::jsonb,
    now(),
    now()
  );
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values
  (
    '10000000-0000-0000-0000-000000000001',
    'Archive Organization',
    'archive-organization'
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    'Outside Organization',
    'outside-organization'
  );

insert into public.profiles (
  id,
  organization_id,
  email,
  full_name,
  role,
  status,
  preferences
)
values
  (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'archive-admin@example.com',
    'Archive Admin',
    'admin',
    'active',
    '{"slack_user_id":"U-ADMIN"}'::jsonb
  ),
  (
    '11000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'archive-manager@example.com',
    'Archive Manager',
    'manager',
    'active',
    '{"slack_user_id":"U-MANAGER"}'::jsonb
  ),
  (
    '11000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'archive-member@example.com',
    'Archive Member',
    'member',
    'active',
    '{"slack_user_id":"U-MEMBER"}'::jsonb
  ),
  (
    '21000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'archive-outsider@example.com',
    'Archive Outsider',
    'admin',
    'active',
    '{}'::jsonb
  );

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  status,
  owner_id
)
values
  (
    '12000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Accessible Archive Project',
    'AAP',
    'active',
    '11000000-0000-0000-0000-000000000001'
  ),
  (
    '12000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'Other Archive Project',
    'OAP',
    'active',
    '11000000-0000-0000-0000-000000000001'
  );

insert into public.project_members (project_id, profile_id, role)
values
  (
    '12000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000003',
    'member'
  );

select has_table(
  'public',
  'basecamp_export_runs',
  'full-export lineage table exists'
);
select has_table(
  'public',
  'file_blobs',
  'service-only physical blob table exists'
);
select has_table(
  'public',
  'basecamp_archive_entries',
  'archive entry table exists'
);
select has_table(
  'public',
  'basecamp_archive_records',
  'archive record table exists'
);
select has_table(
  'public',
  'file_references',
  'logical file reference table exists'
);
select has_column(
  'public',
  'projects',
  'is_read_only',
  'projects expose the archive read-only state'
);
select col_type_is(
  'public',
  'todos',
  'due_on',
  'date',
  'to-do deadlines preserve date-only semantics'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.file_blobs',
    'select'
  ),
  'authenticated users cannot read physical blob rows'
);
select ok(
  has_table_privilege(
    'service_role',
    'public.file_blobs',
    'select'
  ),
  'the service role can manage physical blob rows'
);
select ok(
  not has_column_privilege(
    'authenticated',
    'public.files',
    'blob_id',
    'select'
  )
  and not has_column_privilege(
    'authenticated',
    'public.files',
    'source_checksum_sha256',
    'select'
  ),
  'client file reads hide physical identity and source hashes'
);

insert into public.basecamp_export_runs (
  id,
  organization_id,
  account_id,
  archive_name,
  archive_size_bytes,
  manifest_sha256,
  archive_sha256,
  parser_version,
  exported_at,
  status,
  phase
)
values (
  '14000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  9001,
  'basecamp-export.zip',
  1024,
  repeat('a', 64),
  repeat('b', 64),
  'archive-parser/1',
  '2026-08-01 00:00:00+00',
  'completed',
  'complete'
);

select throws_ok(
  $$
    insert into public.basecamp_export_runs (
      organization_id,
      account_id,
      archive_name,
      archive_size_bytes,
      manifest_sha256,
      parser_version,
      exported_at
    )
    values (
      '10000000-0000-0000-0000-000000000001',
      9001,
      'same-export.zip',
      1024,
      repeat('a', 64),
      'archive-parser/1',
      now()
    )
  $$,
  '23505',
  null,
  'organization, account, and manifest form an idempotent run identity'
);

insert into public.file_blobs (
  id,
  organization_id,
  object_path,
  sha256,
  crc32,
  size_bytes,
  mime_type,
  status,
  verified_at
)
values
  (
    '15000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'imports/basecamp/archive-object.txt',
    repeat('c', 64),
    'abcdef12',
    42,
    'text/plain',
    'ready',
    now()
  ),
  (
    '15000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'imports/basecamp/shared-object.bin',
    repeat('d', 64),
    '1234abcd',
    64,
    'application/octet-stream',
    'ready',
    now()
  );

select throws_ok(
  $$
    insert into public.file_blobs (
      organization_id,
      object_path,
      sha256,
      size_bytes,
      status,
      verified_at
    )
    values (
      '10000000-0000-0000-0000-000000000001',
      'imports/basecamp/duplicate-content.txt',
      repeat('c', 64),
      42,
      'ready',
      now()
    )
  $$,
  '23505',
  null,
  'ready blobs deduplicate by organization, SHA-256, and size'
);

insert into public.basecamp_archive_entries (
  id,
  run_id,
  project_id,
  entry_type,
  classification,
  source_id,
  source_path,
  file_name,
  crc32,
  compressed_size_bytes,
  uncompressed_size_bytes,
  blob_id
)
values (
  '16000000-0000-0000-0000-000000000001',
  '14000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'upload',
  'binary',
  'upload-1',
  'projects/1/uploads/archive-object.txt',
  'archive-object.txt',
  'abcdef12',
  40,
  42,
  '15000000-0000-0000-0000-000000000001'
);

select throws_ok(
  $$
    insert into public.basecamp_archive_entries (
      run_id,
      project_id,
      entry_type,
      classification,
      source_path,
      file_name,
      crc32,
      compressed_size_bytes,
      uncompressed_size_bytes
    )
    values (
      '14000000-0000-0000-0000-000000000001',
      '12000000-0000-0000-0000-000000000001',
      'upload',
      'binary',
      'projects/1/uploads/archive-object.txt',
      'duplicate.txt',
      'abcdef12',
      40,
      42
    )
  $$,
  '23505',
  null,
  'an export contains one logical archive entry per source path'
);

insert into public.basecamp_archive_records (
  id,
  run_id,
  project_id,
  record_type,
  native_recording_id,
  source_locator,
  source_path,
  title,
  plain_text,
  source_updated_at
)
values
  (
    '17000000-0000-0000-0000-000000000001',
    '14000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    'message',
    101,
    'recording:101',
    'projects/1/recordings/101.json',
    'Migration needle',
    'The full export archive is searchable.',
    '2026-08-01 01:00:00+00'
  ),
  (
    '17000000-0000-0000-0000-000000000002',
    '14000000-0000-0000-0000-000000000001',
    null,
    'account',
    9001,
    'account:9001',
    'account.json',
    'Organization root needle',
    'Manager-only archive metadata.',
    '2026-08-01 02:00:00+00'
  );

insert into public.basecamp_archive_records (
  run_id,
  project_id,
  record_type,
  native_recording_id,
  source_locator,
  source_path,
  title,
  plain_text,
  source_updated_at
)
select
  '14000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'message',
  1000 + generated.number,
  'generated:' || generated.number,
  'projects/1/generated/' || generated.number || '.json',
  'Bounded needle ' || generated.number,
  'A generated searchable archive record.',
  '2026-08-01 03:00:00+00'::timestamptz
    + make_interval(secs => generated.number)
from generate_series(1, 105) as generated(number);

insert into public.basecamp_archive_record_entries (
  record_id,
  entry_id,
  reference_role,
  ordinal,
  source_locator
)
values
  (
    '17000000-0000-0000-0000-000000000001',
    '16000000-0000-0000-0000-000000000001',
    'attachment',
    0,
    'recording:101:attachment:0'
  ),
  (
    '17000000-0000-0000-0000-000000000001',
    '16000000-0000-0000-0000-000000000001',
    'inline',
    1,
    'recording:101:inline:1'
  );

select is(
  (
    select count(*)
    from public.basecamp_archive_record_entries
    where record_id = '17000000-0000-0000-0000-000000000001'
      and entry_id = '16000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'record-to-entry joins preserve repeated occurrences'
);

select throws_ok(
  $$
    insert into public.basecamp_archive_record_entries (
      record_id,
      entry_id,
      reference_role,
      ordinal,
      source_locator
    )
    values (
      '17000000-0000-0000-0000-000000000001',
      '16000000-0000-0000-0000-000000000001',
      'inline',
      2,
      'recording:101:inline:1'
    )
  $$,
  '23505',
  null,
  'record-entry source locators are idempotent'
);

insert into public.files (
  id,
  project_id,
  uploaded_by,
  blob_id,
  bucket_id,
  object_path,
  file_name,
  mime_type,
  size_bytes,
  metadata
)
values
  (
    '18000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '15000000-0000-0000-0000-000000000002',
    null,
    null,
    'shared-one.bin',
    'application/octet-stream',
    64,
    '{}'::jsonb
  ),
  (
    '18000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '15000000-0000-0000-0000-000000000002',
    null,
    null,
    'shared-two.bin',
    'application/octet-stream',
    64,
    '{}'::jsonb
  );

delete from public.files
where id = '18000000-0000-0000-0000-000000000001';

select is(
  (
    select status
    from public.file_blobs
    where id = '15000000-0000-0000-0000-000000000002'
  ),
  'ready',
  'deleting one logical file preserves a shared physical blob'
);
select is(
  (
    select count(*)
    from public.storage_deletion_outbox
    where object_path = 'imports/basecamp/shared-object.bin'
  ),
  0::bigint,
  'a shared blob is not queued for deletion while referenced'
);

delete from public.files
where id = '18000000-0000-0000-0000-000000000002';

select is(
  (
    select status
    from public.file_blobs
    where id = '15000000-0000-0000-0000-000000000002'
  ),
  'deleting',
  'the final logical-file deletion marks an unreferenced blob'
);
select is(
  (
    select count(*)
    from public.storage_deletion_outbox
    where object_path = 'imports/basecamp/shared-object.bin'
      and status = 'pending'
  ),
  1::bigint,
  'the final logical-file deletion queues physical garbage collection'
);
select throws_ok(
  $$
    insert into public.basecamp_archive_entries (
      run_id,
      project_id,
      entry_type,
      classification,
      source_path,
      file_name,
      crc32,
      compressed_size_bytes,
      uncompressed_size_bytes,
      blob_id
    )
    values (
      '14000000-0000-0000-0000-000000000001',
      '12000000-0000-0000-0000-000000000001',
      'upload',
      'binary',
      'projects/1/uploads/deleting-object.bin',
      'deleting-object.bin',
      '1234abcd',
      64,
      64,
      '15000000-0000-0000-0000-000000000002'
    )
  $$,
  '55000',
  'A blob pending deletion cannot receive new references.',
  'a blob queued for deletion cannot acquire a late archive reference'
);

insert into public.todo_lists (id, project_id, title, position)
values
  (
    '19000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    'Archive list',
    0
  ),
  (
    '19000000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    'Other list',
    0
  );

insert into public.todos (
  id,
  project_id,
  todo_list_id,
  title,
  status,
  position
)
values
  (
    '19100000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000001',
    'Archive target',
    'todo',
    0
  ),
  (
    '19100000-0000-0000-0000-000000000002',
    '12000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000002',
    'Other target',
    'todo',
    0
  );

insert into public.files (
  id,
  project_id,
  uploaded_by,
  blob_id,
  bucket_id,
  object_path,
  file_name,
  mime_type,
  size_bytes,
  source_system,
  source_account_id,
  source_file_id,
  source_path,
  availability_status,
  listing_position,
  basecamp_account_id,
  basecamp_upload_id,
  basecamp_export_run_id,
  imported_at,
  metadata,
  source_payload
)
values (
  '18000000-0000-0000-0000-000000000010',
  '12000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '15000000-0000-0000-0000-000000000001',
  null,
  null,
  'archive-object.txt',
  'text/plain',
  42,
  'basecamp',
  '9001',
  'upload-1',
  'projects/1/uploads/archive-object.txt',
  'available',
  10,
  9001,
  1,
  '14000000-0000-0000-0000-000000000001',
  now(),
  '{}'::jsonb,
  '{}'::jsonb
);

select throws_ok(
  $$
    insert into public.files (
      id,
      project_id,
      blob_id,
      bucket_id,
      object_path,
      file_name,
      mime_type,
      size_bytes,
      source_system,
      source_account_id,
      source_file_id,
      metadata,
      source_payload
    )
    values (
      '18000000-0000-0000-0000-000000000011',
      '12000000-0000-0000-0000-000000000001',
      '15000000-0000-0000-0000-000000000001',
      null,
      null,
      'duplicate-logical-file.txt',
      'text/plain',
      42,
      'basecamp',
      '9001',
      'upload-1',
      '{}'::jsonb,
      '{}'::jsonb
    )
  $$,
  '23505',
  null,
  'logical file source identities are idempotent within a project'
);

insert into public.file_references (
  id,
  file_id,
  project_id,
  todo_id,
  reference_role,
  ordinal,
  source_locator
)
values (
  '19200000-0000-0000-0000-000000000001',
  '18000000-0000-0000-0000-000000000010',
  '12000000-0000-0000-0000-000000000001',
  '19100000-0000-0000-0000-000000000001',
  'attachment',
  0,
  'todo:1:attachment:0'
);

select throws_ok(
  $$
    insert into public.file_references (
      file_id,
      project_id,
      todo_id,
      reference_role,
      ordinal
    )
    values (
      '18000000-0000-0000-0000-000000000010',
      '12000000-0000-0000-0000-000000000001',
      '19100000-0000-0000-0000-000000000002',
      'attachment',
      1
    )
  $$,
  '23514',
  'File reference target must belong to the logical file project.',
  'cross-project logical file references are rejected'
);

select throws_ok(
  $$
    insert into public.file_references (
      file_id,
      project_id,
      todo_id,
      doc_id,
      reference_role
    )
    values (
      '18000000-0000-0000-0000-000000000010',
      '12000000-0000-0000-0000-000000000001',
      '19100000-0000-0000-0000-000000000001',
      gen_random_uuid(),
      'attachment'
    )
  $$,
  '23514',
  null,
  'a logical file reference requires exactly one target'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000003',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (
    select count(*)
    from public.basecamp_archive_records
    where project_id = '12000000-0000-0000-0000-000000000001'
  ),
  106::bigint,
  'project members can read project archive records through RLS'
);
select is(
  (
    select count(*)
    from public.basecamp_archive_records
    where project_id is null
  ),
  0::bigint,
  'ordinary project members cannot read organization-root archive rows'
);
select is(
  (
    select count(*)
    from public.search_basecamp_archive(
      '10000000-0000-0000-0000-000000000001',
      'needle',
      '12000000-0000-0000-0000-000000000001',
      null,
      null,
      null,
      null,
      1000
    )
  ),
  100::bigint,
  'archive search enforces its 100-row upper bound'
);
select is(
  (
    select count(*)
    from public.list_basecamp_archive_records(
      '12000000-0000-0000-0000-000000000001',
      null,
      null,
      null,
      null,
      1000
    )
  ),
  100::bigint,
  'project archive browsing enforces its 100-row upper bound'
);
select throws_ok(
  $$
    select *
    from public.search_basecamp_archive(
      '10000000-0000-0000-0000-000000000001',
      'needle',
      null,
      null,
      null,
      null,
      null,
      10
    )
  $$,
  '42501',
  'An admin or manager is required for organization-wide search.',
  'organization-wide archive search is manager restricted'
);
select results_eq(
  $$
    select bucket_id, object_path, file_name
    from public.resolve_basecamp_download_target(
      '18000000-0000-0000-0000-000000000010',
      null
    )
  $$,
  $$
    values (
      'project-files'::text,
      'imports/basecamp/archive-object.txt'::text,
      'archive-object.txt'::text
    )
  $$,
  'authorized logical-file downloads resolve only bucket, path, and name'
);
select results_eq(
  $$
    select bucket_id, object_path, file_name
    from public.resolve_basecamp_download_target(
      null,
      '16000000-0000-0000-0000-000000000001'
    )
  $$,
  $$
    values (
      'project-files'::text,
      'imports/basecamp/archive-object.txt'::text,
      'archive-object.txt'::text
    )
  $$,
  'authorized archive-entry downloads resolve without exposing blob rows'
);
select is(
  (
    select count(*)
    from public.list_imported_project_files(
      '12000000-0000-0000-0000-000000000001',
      null,
      null,
      500
    )
  ),
  1::bigint,
  'imported project file listing is authorized and bounded'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000002',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (
    select count(*)
    from public.basecamp_archive_records
    where project_id is null
  ),
  1::bigint,
  'organization managers can read root archive records'
);
select is(
  (
    select count(*)
    from public.search_basecamp_archive(
      '10000000-0000-0000-0000-000000000001',
      'organization root needle',
      null,
      null,
      null,
      null,
      null,
      10
    )
    where project_id is null
  ),
  1::bigint,
  'organization managers can search root archive records'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '21000000-0000-0000-0000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (
    select count(*)
    from public.basecamp_archive_records
    where project_id = '12000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'users from another organization cannot read project archive rows'
);
select throws_ok(
  $$
    select *
    from public.resolve_basecamp_download_target(
      '18000000-0000-0000-0000-000000000010',
      null
    )
  $$,
  '42501',
  'The download target is unavailable or unauthorized.',
  'download target resolution rejects unauthorized users'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  status,
  owner_id
)
values (
  '13000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000001',
  'Local project title',
  'IMP',
  'active',
  '11000000-0000-0000-0000-000000000001'
);

insert into public.project_members (project_id, profile_id, role)
values (
  '13000000-0000-0000-0000-000000000009',
  '11000000-0000-0000-0000-000000000003',
  'member'
);

insert into public.todo_lists (id, project_id, title, position)
values (
  '13100000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000009',
  'Local list',
  0
);

insert into public.todos (
  id,
  project_id,
  todo_list_id,
  title,
  status,
  position,
  created_by
)
values (
  '13200000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000009',
  '13100000-0000-0000-0000-000000000001',
  'Local to-do title',
  'todo',
  0,
  '11000000-0000-0000-0000-000000000001'
);

insert into public.todo_completion_subscribers (
  todo_id,
  profile_id,
  source,
  source_payload
)
values (
  '13200000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000003',
  'native',
  '{}'::jsonb
);

insert into public.docs (
  id,
  project_id,
  title,
  slug,
  content,
  status,
  created_by
)
values (
  '13300000-0000-0000-0000-000000000001',
  '13000000-0000-0000-0000-000000000009',
  'Locally edited document',
  'locally-edited-document',
  '{"type":"doc","content":[]}'::jsonb,
  'draft',
  '11000000-0000-0000-0000-000000000001'
);

insert into public.file_blobs (
  id,
  organization_id,
  object_path,
  sha256,
  crc32,
  size_bytes,
  mime_type,
  status,
  verified_at
)
values (
  '15000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000001',
  'imports/basecamp/promoted-file.pdf',
  repeat('e', 64),
  '9988aabb',
  128,
  'application/pdf',
  'ready',
  now()
);

insert into public.basecamp_export_runs (
  id,
  organization_id,
  account_id,
  archive_name,
  archive_size_bytes,
  manifest_sha256,
  parser_version,
  exported_at,
  status,
  phase,
  entry_count_expected,
  entry_count_processed,
  record_count_expected,
  record_count_processed,
  blob_count_expected,
  blob_count_ready,
  bytes_total,
  bytes_hashed,
  bytes_uploaded
)
values (
  '14000000-0000-0000-0000-000000000009',
  '10000000-0000-0000-0000-000000000001',
  9001,
  'promotion-export.zip',
  4096,
  repeat('f', 64),
  'archive-parser/1',
  '2026-08-02 00:00:00+00',
  'staging',
  'project_staging',
  0,
  0,
  0,
  0,
  1,
  1,
  128,
  128,
  128
);

insert into public.basecamp_export_project_status (
  run_id,
  project_id,
  source_project_id,
  is_read_only,
  status,
  expected_counts
)
values (
  '14000000-0000-0000-0000-000000000009',
  '13000000-0000-0000-0000-000000000009',
  7009,
  true,
  'staging',
  '{
    "projects": 1,
    "project_members": 1,
    "todo_lists": 1,
    "todos": 1,
    "todo_assignees": 1,
    "todo_completion_subscribers": 1,
    "todo_subtasks": 1,
    "docs": 1,
    "messages": 1,
    "comments": 1,
    "chat_messages": 1,
    "files": 2,
    "file_references": 1
  }'::jsonb
);

insert into public.basecamp_export_stage (
  run_id,
  project_id,
  entity_type,
  source_key,
  payload
)
values
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'projects',
    'project:7009',
    jsonb_build_object(
      'id', '13000000-0000-0000-0000-000000000009',
      'organization_id', '10000000-0000-0000-0000-000000000001',
      'name', 'Imported project title',
      'code', 'IMP',
      'status', 'active',
      'priority', 'medium',
      'basecamp_project_id', 7009,
      'basecamp_account_id', 9001,
      'source_created_at', '2018-01-01T00:00:00Z',
      'source_updated_at', '2020-01-01T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'project_members',
    'project-member:7009:1',
    jsonb_build_object(
      'project_id', '13000000-0000-0000-0000-000000000009',
      'profile_id', '11000000-0000-0000-0000-000000000001',
      'role', 'lead',
      'basecamp_person_id', 1
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'todo_lists',
    'todo-list:7100',
    jsonb_build_object(
      'id', '13100000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'title', 'Imported list',
      'position', 0,
      'basecamp_todolist_id', 7100,
      'source_created_at', '2018-01-01T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'todos',
    'todo:7200',
    jsonb_build_object(
      'id', '13200000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'todo_list_id', '13100000-0000-0000-0000-000000000001',
      'title', 'Imported to-do title',
      'status', 'done',
      'position', 0,
      'completed_at', '2020-01-02T12:00:00Z',
      'completed_by', '11000000-0000-0000-0000-000000000001',
      'due_at', '2020-01-02',
      'basecamp_todo_id', 7200,
      'basecamp_creator_id', 1,
      'source_created_at', '2018-01-02T00:00:00Z',
      'source_updated_at', '2020-01-02T12:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'todo_assignees',
    'todo-assignee:7200:1',
    jsonb_build_object(
      'todo_id', '13200000-0000-0000-0000-000000000001',
      'profile_id', '11000000-0000-0000-0000-000000000001',
      'basecamp_person_id', 1
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'todo_completion_subscribers',
    'todo-subscriber:7200:3',
    jsonb_build_object(
      'todo_id', '13200000-0000-0000-0000-000000000001',
      'profile_id', '11000000-0000-0000-0000-000000000003',
      'basecamp_person_id', 3
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'todo_subtasks',
    'todo-subtask:7300',
    jsonb_build_object(
      'id', '13400000-0000-0000-0000-000000000001',
      'todo_id', '13200000-0000-0000-0000-000000000001',
      'title', 'Imported subtask',
      'position', 0,
      'is_completed', false,
      'basecamp_subtask_id', 7300,
      'source_created_at', '2018-01-03T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'docs',
    'doc:7400',
    jsonb_build_object(
      'id', '13300000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'title', 'Imported document title',
      'slug', 'locally-edited-document',
      'content', '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
      'status', 'draft',
      'basecamp_document_id', 7400,
      '_conflict', jsonb_build_object(
        'fields', jsonb_build_array('title', 'content'),
        'reason', 'local_edit_after_export'
      )
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'messages',
    'message:7500',
    jsonb_build_object(
      'id', '13500000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'subject', 'Imported announcement',
      'body', 'Historical Basecamp message',
      'sender_id', '11000000-0000-0000-0000-000000000001',
      'basecamp_message_id', 7500,
      'basecamp_creator_id', 1,
      'source_created_at', '2018-01-04T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'comments',
    'comment:7600',
    jsonb_build_object(
      'id', '13600000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'todo_id', '13200000-0000-0000-0000-000000000001',
      'author_id', '11000000-0000-0000-0000-000000000001',
      'body', 'Historical imported comment',
      'basecamp_comment_id', 7600,
      'basecamp_creator_id', 1,
      'source_created_at', '2018-01-05T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'chat_messages',
    'chat-message:7700',
    jsonb_build_object(
      'id', '13700000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'conversation_id', '13700000-0000-0000-0000-000000000099',
      'profile_id', '11000000-0000-0000-0000-000000000001',
      'role', 'user',
      'content', 'Historical campfire line',
      'basecamp_chat_id', 77,
      'basecamp_message_id', 7700,
      'source_locator', 'campfire:77:7700',
      'source_ordinal', 0,
      'source_created_at', '2018-01-06T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'files',
    'file:7800',
    jsonb_build_object(
      'id', '13800000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'blob_id', '15000000-0000-0000-0000-000000000009',
      'uploaded_by', '11000000-0000-0000-0000-000000000001',
      'file_name', 'promoted-file.pdf',
      'mime_type', 'application/pdf',
      'size_bytes', 128,
      'source_system', 'basecamp',
      'source_account_id', '9001',
      'source_file_id', '7800',
      'source_path', 'projects/7009/uploads/7800',
      'availability_status', 'available',
      'listing_position', 1,
      'basecamp_upload_id', 7800,
      'source_created_at', '2018-01-07T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'files',
    'file:7801',
    jsonb_build_object(
      'id', '13800000-0000-0000-0000-000000000002',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'blob_id', null,
      'bucket_id', null,
      'object_path', null,
      'file_name', 'pending-file.zip',
      'mime_type', 'application/zip',
      'size_bytes', 256,
      'source_system', 'basecamp',
      'source_account_id', '9001',
      'source_file_id', '7801',
      'source_path', 'projects/7009/uploads/7801',
      'availability_status', 'pending',
      'listing_position', 2,
      'basecamp_upload_id', 7801,
      'source_created_at', '2018-01-08T00:00:00Z'
    )
  ),
  (
    '14000000-0000-0000-0000-000000000009',
    '13000000-0000-0000-0000-000000000009',
    'file_references',
    'file-reference:7800:7200:0',
    jsonb_build_object(
      'id', '13900000-0000-0000-0000-000000000001',
      'file_id', '13800000-0000-0000-0000-000000000001',
      'project_id', '13000000-0000-0000-0000-000000000009',
      'todo_id', '13200000-0000-0000-0000-000000000001',
      'reference_role', 'attachment',
      'ordinal', 0,
      'source_locator', 'todo:7200:attachment:7800:0'
    )
  );

update public.basecamp_export_project_status
set status = 'ready'
where run_id = '14000000-0000-0000-0000-000000000009'
  and project_id = '13000000-0000-0000-0000-000000000009';

update public.basecamp_export_runs
set status = 'ready', phase = 'ready'
where id = '14000000-0000-0000-0000-000000000009';

create temporary table archive_import_baseline as
select
  (select count(*) from public.activity_events) as activity_count,
  (select count(*) from public.slack_notification_outbox) as slack_count;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (
    public.promote_basecamp_export_project(
      '14000000-0000-0000-0000-000000000009',
      '13000000-0000-0000-0000-000000000009'
    ) ->> 'idempotent'
  )::boolean,
  false,
  'a ready staged project promotes transactionally'
);
select is(
  (
    public.promote_basecamp_export_project(
      '14000000-0000-0000-0000-000000000009',
      '13000000-0000-0000-0000-000000000009'
    ) ->> 'idempotent'
  )::boolean,
  true,
  're-running a promoted project is idempotent'
);

reset role;
select set_config('request.jwt.claim.role', '', true);

select is(
  (
    select status
    from public.basecamp_export_project_status
    where run_id = '14000000-0000-0000-0000-000000000009'
      and project_id = '13000000-0000-0000-0000-000000000009'
  ),
  'promoted',
  'promotion records a terminal per-project state'
);
select is(
  (
    select count(*)
    from public.basecamp_export_preimages
    where run_id = '14000000-0000-0000-0000-000000000009'
      and project_id = '13000000-0000-0000-0000-000000000009'
  ),
  14::bigint,
  'promotion captures one durable preimage decision per staged row'
);
select is(
  (
    select count(*)
    from public.basecamp_export_conflicts
    where run_id = '14000000-0000-0000-0000-000000000009'
      and project_id = '13000000-0000-0000-0000-000000000009'
      and entity_type = 'docs'
      and resolution = 'preserve_local'
  ),
  1::bigint,
  'declared local-edit conflicts are recorded'
);
select is(
  (
    select title
    from public.docs
    where id = '13300000-0000-0000-0000-000000000001'
  ),
  'Locally edited document',
  'declared conflicts preserve the local row'
);
select is(
  (
    select due_on
    from public.todos
    where id = '13200000-0000-0000-0000-000000000001'
  ),
  '2020-01-02'::date,
  'promotion stores Basecamp deadlines as date-only values'
);
select ok(
  (
    select imported_at > '2026-08-01 00:00:00+00'::timestamptz
      and source_created_at = '2018-01-02 00:00:00+00'::timestamptz
    from public.todos
    where id = '13200000-0000-0000-0000-000000000001'
  ),
  'historical source time is separate from retention-safe import time'
);
select is(
  (select count(*) from public.activity_events),
  (
    select activity_count
    from archive_import_baseline
  ),
  'promotion suppresses historical activity events'
);
select is(
  (select count(*) from public.slack_notification_outbox),
  (
    select slack_count
    from archive_import_baseline
  ),
  'promotion suppresses completion and comment Slack notifications'
);
select ok(
  (
    select is_read_only
    from public.projects
    where id = '13000000-0000-0000-0000-000000000009'
  ),
  'promotion applies the staged archive read-only state'
);
select is(
  (
    select count(*)
    from public.files
    where id = '13800000-0000-0000-0000-000000000001'
      and blob_id = '15000000-0000-0000-0000-000000000009'
  ),
  1::bigint,
  'promotion creates a logical file backed by the staged shared blob'
);
select is(
  (
    select availability_status
    from public.files
    where id = '13800000-0000-0000-0000-000000000002'
      and blob_id is null
      and bucket_id is null
      and object_path is null
  ),
  'pending',
  'promotion can create a pending logical file before blob upload'
);
select is(
  (
    select count(*)
    from public.file_references
    where id = '13900000-0000-0000-0000-000000000001'
      and todo_id = '13200000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'promotion creates the staged logical file occurrence'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and trigger.tgname like 'block_read_only_%'
      and not trigger.tgisinternal
      and relation.relname = any(array[
        'projects',
        'project_members',
        'todo_lists',
        'todos',
        'todo_assignees',
        'todo_completion_subscribers',
        'todo_subtasks',
        'docs',
        'messages',
        'comments',
        'comment_mentions',
        'comment_attachments',
        'files',
        'file_references',
        'chat_messages',
        'milestones',
        'activity_events',
        'accelo_sync_runs',
        'sync_conflicts',
        'upload_reservations'
      ]::name[])
  ),
  20::bigint,
  'every project-scoped write path has a read-only guard'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '11000000-0000-0000-0000-000000000002',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$
    update public.projects
    set name = 'Blocked project edit'
    where id = '13000000-0000-0000-0000-000000000009'
  $$,
  '42501',
  'Archived projects are read-only.',
  'authenticated users cannot update an archived project'
);
select throws_ok(
  $$
    update public.todos
    set title = 'Blocked child edit'
    where id = '13200000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'Archived projects are read-only.',
  'authenticated users cannot update a direct archived-project child'
);
select throws_ok(
  $$
    delete from public.todo_completion_subscribers
    where todo_id = '13200000-0000-0000-0000-000000000001'
      and profile_id = '11000000-0000-0000-0000-000000000003'
  $$,
  '42501',
  'Archived projects are read-only.',
  'authenticated users cannot delete an indirect to-do child'
);
select throws_ok(
  $$
    insert into public.comment_mentions (comment_id, profile_id)
    values (
      '13600000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000003'
    )
  $$,
  '42501',
  'Archived projects are read-only.',
  'authenticated users cannot insert an indirect comment child'
);
select throws_ok(
  $$
    update public.file_references
    set caption = 'Blocked attachment edit'
    where id = '13900000-0000-0000-0000-000000000001'
  $$,
  '42501',
  'Archived projects are read-only.',
  'authenticated users cannot mutate archived logical file references'
);
select is(
  private.can_access_upload_project(
    '13000000-0000-0000-0000-000000000009'
  ),
  false,
  'interactive upload reservations reject archived projects'
);
select throws_ok(
  $$
    select public.promote_basecamp_export_project(
      '14000000-0000-0000-0000-000000000009',
      '13000000-0000-0000-0000-000000000009'
    )
  $$,
  '42501',
  'permission denied for function promote_basecamp_export_project',
  'project promotion is not executable by authenticated users'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select lives_ok(
  $$
    update public.todos
    set description = 'Service-role maintenance remains allowed'
    where id = '13200000-0000-0000-0000-000000000001'
  $$,
  'the service-role importer can maintain an archived project'
);

reset role;
select set_config('request.jwt.claim.role', '', true);

insert into public.basecamp_export_runs (
  id,
  organization_id,
  account_id,
  archive_name,
  archive_size_bytes,
  manifest_sha256,
  parser_version,
  exported_at,
  status,
  phase
)
values (
  '14000000-0000-0000-0000-000000000010',
  '10000000-0000-0000-0000-000000000001',
  9001,
  'rollback-export.zip',
  2048,
  repeat('1', 64),
  'archive-parser/1',
  '2026-08-03 00:00:00+00',
  'staging',
  'project_staging'
);

insert into public.basecamp_export_project_status (
  run_id,
  project_id,
  source_project_id,
  status,
  expected_counts
)
values (
  '14000000-0000-0000-0000-000000000010',
  '13000000-0000-0000-0000-000000000010',
  7010,
  'staging',
  '{"projects":1,"todos":1}'::jsonb
);

insert into public.basecamp_export_stage (
  run_id,
  project_id,
  entity_type,
  source_key,
  payload
)
values
  (
    '14000000-0000-0000-0000-000000000010',
    '13000000-0000-0000-0000-000000000010',
    'projects',
    'project:7010',
    jsonb_build_object(
      'id', '13000000-0000-0000-0000-000000000010',
      'organization_id', '10000000-0000-0000-0000-000000000001',
      'name', 'Rollback project',
      'code', 'RBK',
      'status', 'active',
      'basecamp_project_id', 7010,
      'basecamp_account_id', 9001
    )
  ),
  (
    '14000000-0000-0000-0000-000000000010',
    '13000000-0000-0000-0000-000000000010',
    'todos',
    'todo:7210',
    jsonb_build_object(
      'id', '13200000-0000-0000-0000-000000000010',
      'project_id', '13000000-0000-0000-0000-000000000010',
      'todo_list_id', '13100000-0000-0000-0000-000000000099',
      'title', 'Invalid graph to-do',
      'status', 'todo',
      'position', 0,
      'basecamp_todo_id', 7210
    )
  );

update public.basecamp_export_project_status
set status = 'ready'
where run_id = '14000000-0000-0000-0000-000000000010'
  and project_id = '13000000-0000-0000-0000-000000000010';
update public.basecamp_export_runs
set status = 'ready', phase = 'ready'
where id = '14000000-0000-0000-0000-000000000010';

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  $$
    select public.promote_basecamp_export_project(
      '14000000-0000-0000-0000-000000000010',
      '13000000-0000-0000-0000-000000000010'
    )
  $$,
  '23514',
  'A staged to-do has an invalid project list.',
  'invalid staged graphs abort project promotion'
);

reset role;
select set_config('request.jwt.claim.role', '', true);

select is(
  (
    select count(*)
    from public.projects
    where id = '13000000-0000-0000-0000-000000000010'
  ),
  0::bigint,
  'failed promotion rolls back inserted project data'
);
select is(
  (
    select status
    from public.basecamp_export_project_status
    where run_id = '14000000-0000-0000-0000-000000000010'
      and project_id = '13000000-0000-0000-0000-000000000010'
  ),
  'ready',
  'failed promotion rolls back status transitions'
);
select is(
  (
    select count(*)
    from public.basecamp_export_preimages
    where run_id = '14000000-0000-0000-0000-000000000010'
      and project_id = '13000000-0000-0000-0000-000000000010'
  ),
  0::bigint,
  'failed promotion rolls back preimage capture'
);

select has_table(
  'public',
  'basecamp_import_runs',
  'the legacy fixed-snapshot importer tables still exist'
);
select has_function(
  'public',
  'finalize_basecamp_import',
  array['uuid'],
  'the legacy fixed-snapshot finalizer still coexists'
);
select has_function(
  'private',
  'merge_basecamp_import',
  array['uuid'],
  'the legacy staged merge implementation still coexists'
);

select * from finish();
rollback;
