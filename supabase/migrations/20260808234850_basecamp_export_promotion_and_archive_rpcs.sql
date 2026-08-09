-- Per-project promotion for official Basecamp full exports plus bounded,
-- authorization-aware archive and imported-file read APIs.

create or replace function private.validate_basecamp_export_project(
  target_run_id uuid,
  target_project_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  export_run public.basecamp_export_runs%rowtype;
  project_status public.basecamp_export_project_status%rowtype;
  counts jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  select run.*
  into export_run
  from public.basecamp_export_runs as run
  where run.id = target_run_id
  for update;

  if not found then
    raise no_data_found using message = 'Basecamp export run not found.';
  end if;

  select status.*
  into project_status
  from public.basecamp_export_project_status as status
  where status.run_id = target_run_id
    and status.project_id = target_project_id
  for update;

  if not found then
    raise no_data_found using message = 'Basecamp export project status not found.';
  end if;
  if export_run.status not in ('ready', 'importing') then
    raise object_not_in_prerequisite_state using
      message = 'Basecamp export run is not ready for promotion.';
  end if;
  if project_status.status not in ('ready', 'validating', 'promoting') then
    raise object_not_in_prerequisite_state using
      message = 'Basecamp export project is not ready for promotion.';
  end if;

  select coalesce(
    jsonb_object_agg(entity.entity_type, entity.row_count),
    '{}'::jsonb
  )
  into counts
  from (
    select stage.entity_type, count(*) as row_count
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
    group by stage.entity_type
  ) as entity;

  if exists (
    select 1
    from jsonb_each_text(project_status.expected_counts)
      as expected(entity_type, expected_count)
    where case
      when expected.expected_count ~ '^[0-9]+$' then
        coalesce((counts ->> expected.entity_type)::bigint, 0)
          <> expected.expected_count::bigint
      else true
    end
  ) then
    raise check_violation using
      message = 'Staged project counts do not match the expected manifest.';
  end if;

  if (
    select count(*)
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'projects'
  ) <> 1 then
    raise check_violation using
      message = 'A staged export project requires exactly one project row.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'projects'
      and (
        (stage.payload ->> 'id')::uuid is distinct from target_project_id
        or coalesce(
          nullif(stage.payload ->> 'organization_id', '')::uuid,
          export_run.organization_id
        ) <> export_run.organization_id
        or coalesce(
          nullif(stage.payload ->> 'basecamp_account_id', '')::bigint,
          export_run.account_id
        ) <> export_run.account_id
      )
  ) then
    raise check_violation using
      message = 'The staged project identity does not match its export run.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type in (
        'project_members',
        'todo_lists',
        'todos',
        'docs',
        'messages',
        'comments',
        'chat_messages',
        'files',
        'file_references'
      )
      and (stage.payload ->> 'project_id')::uuid
        is distinct from target_project_id
  ) then
    raise check_violation using
      message = 'A staged row maps to another project.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'project_members'
      and not exists (
        select 1
        from public.profiles as profile
        where profile.id = (stage.payload ->> 'profile_id')::uuid
          and profile.organization_id = export_run.organization_id
      )
  ) then
    raise check_violation using
      message = 'A staged project member is outside the export organization.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'todos'
      and not (
        exists (
          select 1
          from public.basecamp_export_stage as list_stage
          where list_stage.run_id = target_run_id
            and list_stage.project_id = target_project_id
            and list_stage.entity_type = 'todo_lists'
            and (list_stage.payload ->> 'id')::uuid
              = (stage.payload ->> 'todo_list_id')::uuid
            and (list_stage.payload ->> 'project_id')::uuid
              = target_project_id
        )
        or exists (
          select 1
          from public.todo_lists as list
          where list.id = (stage.payload ->> 'todo_list_id')::uuid
            and list.project_id = target_project_id
        )
      )
  ) then
    raise check_violation using
      message = 'A staged to-do has an invalid project list.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type in (
        'todo_assignees',
        'todo_completion_subscribers',
        'todo_subtasks'
      )
      and not (
        exists (
          select 1
          from public.basecamp_export_stage as todo_stage
          where todo_stage.run_id = target_run_id
            and todo_stage.project_id = target_project_id
            and todo_stage.entity_type = 'todos'
            and (todo_stage.payload ->> 'id')::uuid
              = (stage.payload ->> 'todo_id')::uuid
        )
        or exists (
          select 1
          from public.todos as todo
          where todo.id = (stage.payload ->> 'todo_id')::uuid
            and todo.project_id = target_project_id
        )
      )
  ) then
    raise check_violation using
      message = 'A staged to-do relation has an invalid to-do.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type in (
        'todo_assignees',
        'todo_completion_subscribers'
      )
      and not exists (
        select 1
        from public.profiles as profile
        where profile.id = (stage.payload ->> 'profile_id')::uuid
          and profile.organization_id = export_run.organization_id
      )
  ) then
    raise check_violation using
      message = 'A staged to-do relation has an invalid profile.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'files'
      and not (
        (
          nullif(stage.payload ->> 'blob_id', '') is null
          and coalesce(
            nullif(stage.payload ->> 'availability_status', ''),
            'pending'
          ) in ('pending', 'missing', 'failed', 'deleted')
        )
        or exists (
          select 1
          from public.file_blobs as blob
          where blob.id = (stage.payload ->> 'blob_id')::uuid
            and blob.organization_id = export_run.organization_id
            and blob.status <> 'deleting'
            and blob.size_bytes = (stage.payload ->> 'size_bytes')::bigint
            and (
              coalesce(
                nullif(stage.payload ->> 'availability_status', ''),
                'available'
              ) <> 'available'
              or blob.status in ('ready', 'unverified')
            )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged logical file has an unavailable or mismatched blob.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'comments'
      and (
        (
          nullif(stage.payload ->> 'todo_id', '') is not null
          and not (
            exists (
              select 1
              from public.basecamp_export_stage as todo_stage
              where todo_stage.run_id = target_run_id
                and todo_stage.project_id = target_project_id
                and todo_stage.entity_type = 'todos'
                and (todo_stage.payload ->> 'id')::uuid
                  = (stage.payload ->> 'todo_id')::uuid
            )
            or exists (
              select 1 from public.todos as todo
              where todo.id = (stage.payload ->> 'todo_id')::uuid
                and todo.project_id = target_project_id
            )
          )
        )
        or (
          nullif(stage.payload ->> 'doc_id', '') is not null
          and not (
            exists (
              select 1
              from public.basecamp_export_stage as doc_stage
              where doc_stage.run_id = target_run_id
                and doc_stage.project_id = target_project_id
                and doc_stage.entity_type = 'docs'
                and (doc_stage.payload ->> 'id')::uuid
                  = (stage.payload ->> 'doc_id')::uuid
            )
            or exists (
              select 1 from public.docs as doc
              where doc.id = (stage.payload ->> 'doc_id')::uuid
                and doc.project_id = target_project_id
            )
          )
        )
        or (
          nullif(stage.payload #>> '{metadata,message_id}', '') is not null
          and not (
            exists (
              select 1
              from public.basecamp_export_stage as message_stage
              where message_stage.run_id = target_run_id
                and message_stage.project_id = target_project_id
                and message_stage.entity_type = 'messages'
                and (message_stage.payload ->> 'id')::uuid
                  = (stage.payload #>> '{metadata,message_id}')::uuid
            )
            or exists (
              select 1 from public.messages as message
              where message.id =
                (stage.payload #>> '{metadata,message_id}')::uuid
                and message.project_id = target_project_id
            )
          )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged comment has an invalid project target.';
  end if;

  if exists (
    select 1
    from public.basecamp_export_stage as stage
    where stage.run_id = target_run_id
      and stage.project_id = target_project_id
      and stage.entity_type = 'file_references'
      and (
        num_nonnulls(
          nullif(stage.payload ->> 'todo_id', ''),
          nullif(stage.payload ->> 'comment_id', ''),
          nullif(stage.payload ->> 'doc_id', ''),
          nullif(stage.payload ->> 'message_id', ''),
          nullif(stage.payload ->> 'chat_message_id', ''),
          nullif(stage.payload ->> 'archive_record_id', '')
        ) <> 1
        or not (
          exists (
            select 1
            from public.basecamp_export_stage as file_stage
            where file_stage.run_id = target_run_id
              and file_stage.project_id = target_project_id
              and file_stage.entity_type = 'files'
              and (file_stage.payload ->> 'id')::uuid
                = (stage.payload ->> 'file_id')::uuid
          )
          or exists (
            select 1
            from public.files as file
            where file.id = (stage.payload ->> 'file_id')::uuid
              and file.project_id = target_project_id
          )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged file reference has an invalid shape or logical file.';
  end if;

  return counts;
end;
$$;

create or replace function private.basecamp_export_stage_row(
  target_run_id uuid,
  target_project_id uuid,
  target_entity_type text,
  target_payload jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  export_run public.basecamp_export_runs%rowtype;
  defaults jsonb;
  invariants jsonb;
begin
  select run.*
  into export_run
  from public.basecamp_export_runs as run
  where run.id = target_run_id;

  if not found then
    raise no_data_found using message = 'Basecamp export run not found.';
  end if;

  defaults := case target_entity_type
    when 'projects' then jsonb_build_object(
      'organization_id', export_run.organization_id,
      'status', 'planning',
      'priority', 'medium',
      'currency', 'USD',
      'metadata', '{}'::jsonb,
      'basecamp_account_id', export_run.account_id,
      'basecamp_payload', '{}'::jsonb,
      'is_read_only', false,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'project_members' then jsonb_build_object(
      'id', gen_random_uuid(),
      'role', 'member',
      'joined_at', statement_timestamp(),
      'source', 'basecamp',
      'source_payload', '{}'::jsonb,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'todo_lists' then jsonb_build_object(
      'position', 0,
      'is_archived', false,
      'basecamp_payload', '{}'::jsonb,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'todos' then jsonb_build_object(
      'status', 'todo',
      'priority', 'medium',
      'position', 0,
      'labels', '[]'::jsonb,
      'sync_status', 'not_synced',
      'sync_version', 0,
      'accelo_payload', '{}'::jsonb,
      'basecamp_payload', '{}'::jsonb,
      'version', 1,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'todo_assignees' then jsonb_build_object(
      'source', 'basecamp',
      'source_payload', '{}'::jsonb,
      'created_at', statement_timestamp()
    )
    when 'todo_completion_subscribers' then jsonb_build_object(
      'source', 'basecamp',
      'source_payload', '{}'::jsonb,
      'created_at', statement_timestamp()
    )
    when 'todo_subtasks' then jsonb_build_object(
      'position', 0,
      'basecamp_payload', '{}'::jsonb,
      'version', 1,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'docs' then jsonb_build_object(
      'content', '{}'::jsonb,
      'status', 'draft',
      'version', 1,
      'basecamp_payload', '{}'::jsonb,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'messages' then jsonb_build_object(
      'direction', 'internal',
      'channel', 'internal',
      'status', 'sent',
      'recipient_emails', '[]'::jsonb,
      'metadata', '{}'::jsonb,
      'basecamp_payload', '{}'::jsonb,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'comments' then jsonb_build_object(
      'is_edited', false,
      'metadata', '{}'::jsonb,
      'basecamp_payload', '{}'::jsonb,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'chat_messages' then jsonb_build_object(
      'role', 'user',
      'content', '',
      'tool_calls', '[]'::jsonb,
      'metadata', '{}'::jsonb,
      'basecamp_account_id', export_run.account_id,
      'basecamp_payload', '{}'::jsonb,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'files' then jsonb_build_object(
      'bucket_id', null,
      'object_path', null,
      'size_bytes', 0,
      'metadata', '{}'::jsonb,
      'source_system', 'basecamp',
      'source_account_id', export_run.account_id::text,
      'source_payload', '{}'::jsonb,
      'availability_status', 'available',
      'basecamp_account_id', export_run.account_id,
      'created_at', statement_timestamp(),
      'updated_at', statement_timestamp()
    )
    when 'file_references' then jsonb_build_object(
      'reference_role', 'attachment',
      'ordinal', 0,
      'payload', '{}'::jsonb,
      'created_at', statement_timestamp()
    )
    else '{}'::jsonb
  end;

  invariants := case
    when target_entity_type = 'projects' then jsonb_build_object(
      'id', target_project_id,
      'organization_id', export_run.organization_id,
      'basecamp_account_id', export_run.account_id,
      'basecamp_export_run_id', target_run_id,
      'imported_at', statement_timestamp()
    )
    when target_entity_type = 'project_members' then jsonb_build_object(
      'project_id', target_project_id,
      'basecamp_export_run_id', target_run_id,
      'imported_at', statement_timestamp()
    )
    when target_entity_type in (
      'todo_lists',
      'todos',
      'docs',
      'messages',
      'comments',
      'chat_messages',
      'files'
    ) then jsonb_build_object(
        'project_id', target_project_id,
        'basecamp_export_run_id', target_run_id,
        'imported_at', statement_timestamp()
      )
    when target_entity_type in (
      'todo_assignees',
      'todo_completion_subscribers',
      'todo_subtasks'
    ) then jsonb_build_object(
        'basecamp_export_run_id', target_run_id,
        'imported_at', statement_timestamp()
      )
    when target_entity_type = 'file_references' then jsonb_build_object(
      'project_id', target_project_id
    )
    else '{}'::jsonb
  end;

  if target_entity_type = 'todos'
    and nullif(target_payload ->> 'due_on', '') is null
    and left(coalesce(target_payload ->> 'due_at', ''), 10)
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then
    invariants := invariants || jsonb_build_object(
      'due_on',
      left(target_payload ->> 'due_at', 10)
    );
  end if;

  return defaults
    || (coalesce(target_payload, '{}'::jsonb) - '_conflict')
    || invariants;
end;
$$;

create or replace function private.promote_basecamp_export_stage_row(
  target_run_id uuid,
  target_project_id uuid,
  target_entity_type text,
  target_source_key text,
  target_payload jsonb
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  table_name text;
  conflict_target text;
  key_predicate text;
  key_columns text[];
  normalized_payload jsonb;
  existing_row jsonb;
  entity_id text;
  insert_columns text;
  select_columns text;
  update_assignments text;
  conflict_detail jsonb;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  normalized_payload := private.basecamp_export_stage_row(
    target_run_id,
    target_project_id,
    target_entity_type,
    target_payload
  );

  case target_entity_type
    when 'projects' then
      table_name := 'projects';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'project_members' then
      table_name := 'project_members';
      conflict_target := 'project_id, profile_id';
      key_columns := array['project_id', 'profile_id'];
      key_predicate :=
        'target.project_id = ($1 ->> ''project_id'')::uuid
         and target.profile_id = ($1 ->> ''profile_id'')::uuid';
      entity_id := (normalized_payload ->> 'project_id')
        || ':' || (normalized_payload ->> 'profile_id');
    when 'todo_lists' then
      table_name := 'todo_lists';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'todos' then
      table_name := 'todos';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'todo_assignees' then
      table_name := 'todo_assignees';
      conflict_target := 'todo_id, profile_id';
      key_columns := array['todo_id', 'profile_id'];
      key_predicate :=
        'target.todo_id = ($1 ->> ''todo_id'')::uuid
         and target.profile_id = ($1 ->> ''profile_id'')::uuid';
      entity_id := (normalized_payload ->> 'todo_id')
        || ':' || (normalized_payload ->> 'profile_id');
    when 'todo_completion_subscribers' then
      table_name := 'todo_completion_subscribers';
      conflict_target := 'todo_id, profile_id';
      key_columns := array['todo_id', 'profile_id'];
      key_predicate :=
        'target.todo_id = ($1 ->> ''todo_id'')::uuid
         and target.profile_id = ($1 ->> ''profile_id'')::uuid';
      entity_id := (normalized_payload ->> 'todo_id')
        || ':' || (normalized_payload ->> 'profile_id');
    when 'todo_subtasks' then
      table_name := 'todo_subtasks';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'docs' then
      table_name := 'docs';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'messages' then
      table_name := 'messages';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'comments' then
      table_name := 'comments';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'chat_messages' then
      table_name := 'chat_messages';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'files' then
      table_name := 'files';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    when 'file_references' then
      table_name := 'file_references';
      conflict_target := 'id';
      key_columns := array['id'];
      key_predicate := 'target.id = ($1 ->> ''id'')::uuid';
      entity_id := normalized_payload ->> 'id';
    else
      raise check_violation using
        message = 'Unsupported Basecamp export stage entity.';
  end case;

  execute format(
    'select to_jsonb(target) from public.%I as target where %s',
    table_name,
    key_predicate
  )
  into existing_row
  using normalized_payload;

  conflict_detail := target_payload -> '_conflict';
  if existing_row is not null
    and jsonb_typeof(conflict_detail) = 'object'
    and conflict_detail <> '{}'::jsonb
  then
    insert into public.basecamp_export_preimages (
      run_id,
      project_id,
      entity_type,
      source_key,
      operation,
      entity_id,
      preimage,
      staged_payload
    )
    values (
      target_run_id,
      target_project_id,
      target_entity_type,
      target_source_key,
      'conflict',
      entity_id,
      existing_row,
      target_payload
    )
    on conflict (run_id, project_id, entity_type, source_key) do nothing;

    insert into public.basecamp_export_conflicts (
      run_id,
      project_id,
      entity_type,
      source_key,
      entity_id,
      local_row,
      staged_payload,
      conflict
    )
    values (
      target_run_id,
      target_project_id,
      target_entity_type,
      target_source_key,
      entity_id,
      existing_row,
      target_payload,
      conflict_detail
    )
    on conflict (run_id, project_id, entity_type, source_key) do nothing;

    return 'conflict';
  end if;

  insert into public.basecamp_export_preimages (
    run_id,
    project_id,
    entity_type,
    source_key,
    operation,
    entity_id,
    preimage,
    staged_payload
  )
  values (
    target_run_id,
    target_project_id,
    target_entity_type,
    target_source_key,
    case when existing_row is null then 'insert' else 'update' end,
    entity_id,
    existing_row,
    target_payload
  )
  on conflict (run_id, project_id, entity_type, source_key) do nothing;

  select
    string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum),
    string_agg(
      format('populated.%I', attribute.attname),
      ', ' order by attribute.attnum
    ),
    string_agg(
      format('%1$I = excluded.%1$I', attribute.attname),
      ', ' order by attribute.attnum
    ) filter (
      where not attribute.attname = any(key_columns)
        and attribute.attname not in ('id', 'created_at', 'version')
    )
  into insert_columns, select_columns, update_assignments
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = format('public.%I', table_name)::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attgenerated = ''
    and attribute.attidentity = '';

  execute format(
    'insert into public.%1$I (%2$s)
     select %3$s
     from jsonb_populate_record(null::public.%1$I, $1) as populated
     on conflict (%4$s) do update set %5$s',
    table_name,
    insert_columns,
    select_columns,
    conflict_target,
    update_assignments
  )
  using normalized_payload;

  return case when existing_row is null then 'insert' else 'update' end;
end;
$$;

revoke all on function private.validate_basecamp_export_project(uuid, uuid)
  from public;
revoke all on function private.basecamp_export_stage_row(
  uuid,
  uuid,
  text,
  jsonb
) from public;
revoke all on function private.promote_basecamp_export_stage_row(
  uuid,
  uuid,
  text,
  text,
  jsonb
) from public;

grant execute on function private.validate_basecamp_export_project(uuid, uuid)
  to service_role;
grant execute on function private.basecamp_export_stage_row(
  uuid,
  uuid,
  text,
  jsonb
) to service_role;
grant execute on function private.promote_basecamp_export_stage_row(
  uuid,
  uuid,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.promote_basecamp_export_project(
  run_id uuid,
  project_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  export_run public.basecamp_export_runs%rowtype;
  project_status public.basecamp_export_project_status%rowtype;
  stage_row record;
  current_entity_type text;
  validation_counts jsonb;
  promotion_counts jsonb;
  result jsonb;
  inserted_count bigint;
  updated_count bigint;
  conflict_count bigint;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(run_id::text || ':' || project_id::text, 0)
  );

  select candidate.*
  into export_run
  from public.basecamp_export_runs as candidate
  where candidate.id = run_id
  for update;

  if not found then
    raise no_data_found using message = 'Basecamp export run not found.';
  end if;

  select candidate.*
  into project_status
  from public.basecamp_export_project_status as candidate
  where candidate.run_id = promote_basecamp_export_project.run_id
    and candidate.project_id = promote_basecamp_export_project.project_id
  for update;

  if not found then
    raise no_data_found using message = 'Basecamp export project status not found.';
  end if;

  if project_status.status = 'promoted' then
    return project_status.summary || jsonb_build_object(
      'idempotent', true,
      'runId', run_id,
      'projectId', project_id
    );
  end if;

  if export_run.status not in ('ready', 'importing')
    or project_status.status <> 'ready'
  then
    raise object_not_in_prerequisite_state using
      message = 'The export project must be ready before promotion.';
  end if;

  perform pg_catalog.set_config('app.basecamp_import_mode', 'on', true);

  update public.basecamp_export_runs
  set status = 'importing', phase = 'project_promotion'
  where id = run_id;

  update public.basecamp_export_project_status
  set
    status = 'validating',
    attempt_count = attempt_count + 1,
    errors = '[]'::jsonb
  where basecamp_export_project_status.run_id
      = promote_basecamp_export_project.run_id
    and basecamp_export_project_status.project_id
      = promote_basecamp_export_project.project_id;

  validation_counts := private.validate_basecamp_export_project(
    run_id,
    project_id
  );

  update public.basecamp_export_project_status
  set
    status = 'promoting',
    staged_counts = validation_counts,
    validated_at = statement_timestamp()
  where basecamp_export_project_status.run_id
      = promote_basecamp_export_project.run_id
    and basecamp_export_project_status.project_id
      = promote_basecamp_export_project.project_id;

  foreach current_entity_type in array array[
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
    'chat_messages',
    'files',
    'file_references'
  ]
  loop
    for stage_row in
      with recursive ordered_stage as (
        select
          stage.source_key,
          stage.payload,
          0 as depth,
          array[stage.source_key]::text[] as path
        from public.basecamp_export_stage as stage
        where stage.run_id = promote_basecamp_export_project.run_id
          and stage.project_id = promote_basecamp_export_project.project_id
          and stage.entity_type = current_entity_type
          and (
            current_entity_type not in ('comments', 'chat_messages')
            or (
              current_entity_type = 'comments'
              and (
                nullif(stage.payload ->> 'parent_comment_id', '') is null
                or not exists (
                  select 1
                  from public.basecamp_export_stage as parent_stage
                  where parent_stage.run_id
                      = promote_basecamp_export_project.run_id
                    and parent_stage.project_id
                      = promote_basecamp_export_project.project_id
                    and parent_stage.entity_type = 'comments'
                    and parent_stage.payload ->> 'id'
                      = stage.payload ->> 'parent_comment_id'
                )
              )
            )
            or (
              current_entity_type = 'chat_messages'
              and (
                nullif(stage.payload ->> 'parent_message_id', '') is null
                or not exists (
                  select 1
                  from public.basecamp_export_stage as parent_stage
                  where parent_stage.run_id
                      = promote_basecamp_export_project.run_id
                    and parent_stage.project_id
                      = promote_basecamp_export_project.project_id
                    and parent_stage.entity_type = 'chat_messages'
                    and parent_stage.payload ->> 'id'
                      = stage.payload ->> 'parent_message_id'
                )
              )
            )
          )
        union all
        select
          child.source_key,
          child.payload,
          parent.depth + 1,
          parent.path || child.source_key
        from ordered_stage as parent
        join public.basecamp_export_stage as child
          on child.run_id = promote_basecamp_export_project.run_id
         and child.project_id = promote_basecamp_export_project.project_id
         and child.entity_type = current_entity_type
         and (
           (
             current_entity_type = 'comments'
             and child.payload ->> 'parent_comment_id'
               = parent.payload ->> 'id'
           )
           or (
             current_entity_type = 'chat_messages'
             and child.payload ->> 'parent_message_id'
               = parent.payload ->> 'id'
           )
         )
         and not child.source_key = any(parent.path)
      )
      select ordered_stage.source_key, ordered_stage.payload
      from ordered_stage
      order by ordered_stage.depth, ordered_stage.source_key
    loop
      perform private.promote_basecamp_export_stage_row(
        run_id,
        project_id,
        current_entity_type,
        stage_row.source_key,
        stage_row.payload
      );
    end loop;
  end loop;

  if (
    select count(*)
    from public.basecamp_export_preimages as preimage
    where preimage.run_id = promote_basecamp_export_project.run_id
      and preimage.project_id = promote_basecamp_export_project.project_id
  ) <> (
    select count(*)
    from public.basecamp_export_stage as stage
    where stage.run_id = promote_basecamp_export_project.run_id
      and stage.project_id = promote_basecamp_export_project.project_id
  ) then
    raise check_violation using
      message = 'The staged project contains an unresolved hierarchy.';
  end if;

  update public.projects
  set
    is_read_only = project_status.is_read_only,
    basecamp_export_run_id = run_id,
    imported_at = coalesce(imported_at, statement_timestamp())
  where id = project_id;

  select
    count(*) filter (where preimage.operation = 'insert'),
    count(*) filter (where preimage.operation = 'update'),
    count(*) filter (where preimage.operation = 'conflict')
  into inserted_count, updated_count, conflict_count
  from public.basecamp_export_preimages as preimage
  where preimage.run_id = promote_basecamp_export_project.run_id
    and preimage.project_id = promote_basecamp_export_project.project_id;

  select coalesce(
    jsonb_object_agg(entity.entity_type, entity.operations),
    '{}'::jsonb
  )
  into promotion_counts
  from (
    select
      preimage.entity_type,
      jsonb_build_object(
        'inserted',
        count(*) filter (where preimage.operation = 'insert'),
        'updated',
        count(*) filter (where preimage.operation = 'update'),
        'conflicts',
        count(*) filter (where preimage.operation = 'conflict')
      ) as operations
    from public.basecamp_export_preimages as preimage
    where preimage.run_id = promote_basecamp_export_project.run_id
      and preimage.project_id = promote_basecamp_export_project.project_id
    group by preimage.entity_type
  ) as entity;

  result := jsonb_build_object(
    'runId', run_id,
    'projectId', project_id,
    'idempotent', false,
    'isReadOnly', project_status.is_read_only,
    'inserted', inserted_count,
    'updated', updated_count,
    'conflicts', conflict_count,
    'counts', promotion_counts
  );

  update public.basecamp_export_project_status
  set
    status = 'promoted',
    promoted_counts = promotion_counts,
    summary = result,
    promoted_at = statement_timestamp()
  where basecamp_export_project_status.run_id
      = promote_basecamp_export_project.run_id
    and basecamp_export_project_status.project_id
      = promote_basecamp_export_project.project_id;

  return result;
end;
$$;

revoke all on function public.promote_basecamp_export_project(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_basecamp_export_project(uuid, uuid)
  to service_role;

create or replace function public.claim_basecamp_file_blob(
  target_blob_id uuid,
  target_organization_id uuid,
  target_bucket_id text,
  target_object_path text,
  target_sha256 text,
  target_crc32 text,
  target_size_bytes bigint,
  target_mime_type text,
  target_lease_token uuid
)
returns table (
  id uuid,
  status text,
  tus_upload_url text,
  tus_offset_bytes bigint,
  bucket_id text,
  object_path text,
  claimed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  blob public.file_blobs%rowtype;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.organization_id = target_organization_id
    and candidate.sha256 = target_sha256
    and candidate.size_bytes = target_size_bytes
    and candidate.status = 'ready'
  limit 1
  for update;

  if found then
    return query select
      blob.id,
      blob.status,
      blob.tus_upload_url,
      blob.tus_offset_bytes,
      blob.bucket_id,
      blob.object_path,
      false;
    return;
  end if;

  insert into public.file_blobs (
    id,
    organization_id,
    bucket_id,
    object_path,
    sha256,
    crc32,
    size_bytes,
    mime_type,
    status
  )
  values (
    target_blob_id,
    target_organization_id,
    target_bucket_id,
    target_object_path,
    target_sha256,
    target_crc32,
    target_size_bytes,
    target_mime_type,
    'pending'
  )
  on conflict on constraint file_blobs_bucket_path_unique do nothing;

  select candidate.*
  into blob
  from public.file_blobs as candidate
  where candidate.bucket_id = target_bucket_id
    and candidate.object_path = target_object_path
  for update;

  if not found then
    raise no_data_found using message = 'File blob claim could not be created.';
  end if;
  if blob.organization_id <> target_organization_id
    or blob.sha256 is distinct from target_sha256
    or blob.size_bytes <> target_size_bytes
  then
    raise check_violation using message = 'File blob claim identity mismatch.';
  end if;
  if blob.status = 'ready' then
    return query select
      blob.id,
      blob.status,
      blob.tus_upload_url,
      blob.tus_offset_bytes,
      blob.bucket_id,
      blob.object_path,
      false;
    return;
  end if;
  if blob.status = 'uploading'
    and blob.upload_lease_token is distinct from target_lease_token
    and blob.upload_lease_expires_at > statement_timestamp()
  then
    raise lock_not_available using
      message = 'File blob is leased by another importer.';
  end if;

  update public.file_blobs
  set
    status = 'uploading',
    upload_lease_token = target_lease_token,
    upload_lease_expires_at = statement_timestamp() + interval '5 minutes',
    upload_attempt_count = upload_attempt_count + 1,
    upload_started_at = coalesce(upload_started_at, statement_timestamp()),
    last_attempt_at = statement_timestamp(),
    last_error = null
  where file_blobs.id = blob.id
  returning * into blob;

  return query select
    blob.id,
    blob.status,
    blob.tus_upload_url,
    blob.tus_offset_bytes,
    blob.bucket_id,
    blob.object_path,
    true;
end;
$$;

revoke all on function public.claim_basecamp_file_blob(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.claim_basecamp_file_blob(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  text,
  uuid
) to service_role;

create or replace function public.list_basecamp_archive_projects(
  organization_id uuid,
  run_id uuid default null,
  after_project_name text default null,
  after_project_id uuid default null,
  page_size integer default 50
)
returns table (
  project_id uuid,
  project_name text,
  project_status text,
  is_read_only boolean,
  export_run_id uuid,
  exported_at timestamptz,
  record_count bigint,
  entry_count bigint,
  file_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_page_size integer;
begin
  if not private.has_organization_role(
    organization_id,
    array['admin', 'manager', 'member', 'viewer']::text[]
  ) then
    raise insufficient_privilege using message = 'Organization access is required.';
  end if;
  if (after_project_name is null) <> (after_project_id is null) then
    raise check_violation using message = 'Both project cursor values are required.';
  end if;

  bounded_page_size := least(greatest(coalesce(page_size, 50), 1), 100);

  return query
  select
    project.id,
    project.name,
    project.status,
    project.is_read_only,
    latest_run.id,
    latest_run.exported_at,
    coalesce(record_counts.row_count, 0),
    coalesce(entry_counts.row_count, 0),
    coalesce(file_counts.row_count, 0)
  from public.projects as project
  join lateral (
    select export.id, export.exported_at
    from public.basecamp_export_runs as export
    where export.organization_id = list_basecamp_archive_projects.organization_id
      and (
        list_basecamp_archive_projects.run_id is null
        or export.id = list_basecamp_archive_projects.run_id
      )
      and (
        export.id = project.basecamp_export_run_id
        or exists (
          select 1
          from public.basecamp_archive_records as record
          where record.run_id = export.id
            and record.project_id = project.id
        )
        or exists (
          select 1
          from public.basecamp_archive_entries as entry
          where entry.run_id = export.id
            and entry.project_id = project.id
        )
      )
    order by export.exported_at desc, export.id desc
    limit 1
  ) as latest_run on true
  left join lateral (
    select count(*) as row_count
    from public.basecamp_archive_records as record
    where record.run_id = latest_run.id
      and record.project_id = project.id
  ) as record_counts on true
  left join lateral (
    select count(*) as row_count
    from public.basecamp_archive_entries as entry
    where entry.run_id = latest_run.id
      and entry.project_id = project.id
  ) as entry_counts on true
  left join lateral (
    select count(*) as row_count
    from public.files as file
    where file.project_id = project.id
      and file.basecamp_export_run_id = latest_run.id
  ) as file_counts on true
  where project.organization_id
      = list_basecamp_archive_projects.organization_id
    and private.can_access_project(project.id)
    and (
      list_basecamp_archive_projects.after_project_name is null
      or (
        lower(project.name),
        project.id
      ) > (
        lower(list_basecamp_archive_projects.after_project_name),
        list_basecamp_archive_projects.after_project_id
      )
    )
  order by lower(project.name), project.id
  limit bounded_page_size;
end;
$$;

create or replace function public.search_basecamp_archive(
  target_organization_id uuid,
  search_query text,
  target_project_id uuid default null,
  target_record_type text default null,
  after_rank real default null,
  after_source_updated_at timestamptz default null,
  after_record_id uuid default null,
  page_size integer default 50,
  source_from timestamptz default null,
  source_to timestamptz default null
)
returns table (
  record_id uuid,
  export_run_id uuid,
  project_id uuid,
  parent_id uuid,
  record_type text,
  title text,
  plain_text_excerpt text,
  source_updated_at timestamptz,
  rank real
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_page_size integer;
  parsed_query tsquery;
begin
  if char_length(btrim(coalesce(search_query, ''))) not between 1 and 500 then
    raise check_violation using message = 'A search query is required.';
  end if;
  if (
    after_rank is null
    or after_source_updated_at is null
    or after_record_id is null
  ) and not (
    after_rank is null
    and after_source_updated_at is null
    and after_record_id is null
  ) then
    raise check_violation using message = 'All search cursor values are required.';
  end if;
  if target_project_id is null then
    if not private.has_organization_role(
      target_organization_id,
      array['admin', 'manager']::text[]
    ) then
      raise insufficient_privilege using
        message = 'An admin or manager is required for organization-wide search.';
    end if;
  elsif not exists (
    select 1
    from public.projects as project
    where project.id = target_project_id
      and project.organization_id = target_organization_id
      and private.can_access_project(project.id)
  ) then
    raise insufficient_privilege using message = 'Project access is required.';
  end if;

  bounded_page_size := least(greatest(coalesce(page_size, 50), 1), 100);
  parsed_query := websearch_to_tsquery('english'::regconfig, search_query);

  return query
  with ranked as (
    select
      record.id,
      record.run_id,
      record.project_id,
      record.parent_id,
      record.record_type,
      record.title,
      left(coalesce(record.plain_text, ''), 500) as excerpt,
      record.source_updated_at,
      ts_rank_cd(record.search_vector, parsed_query)::real as search_rank
    from public.basecamp_archive_records as record
    join public.basecamp_export_runs as export on export.id = record.run_id
    where export.organization_id = target_organization_id
      and record.search_vector @@ parsed_query
      and (
        target_project_id is null
        or record.project_id = target_project_id
      )
      and (
        target_record_type is null
        or record.record_type = target_record_type
      )
      and (
        source_from is null
        or coalesce(record.source_updated_at, record.source_created_at)
          >= source_from
      )
      and (
        source_to is null
        or coalesce(record.source_updated_at, record.source_created_at)
          <= source_to
      )
      and private.can_access_basecamp_archive_row(
        record.run_id,
        record.project_id
      )
  )
  select
    ranked.id,
    ranked.run_id,
    ranked.project_id,
    ranked.parent_id,
    ranked.record_type,
    ranked.title,
    ranked.excerpt,
    ranked.source_updated_at,
    ranked.search_rank
  from ranked
  where search_basecamp_archive.after_rank is null
    or (
      ranked.search_rank,
      coalesce(ranked.source_updated_at, '-infinity'::timestamptz),
      ranked.id
    ) < (
      search_basecamp_archive.after_rank,
      coalesce(
        search_basecamp_archive.after_source_updated_at,
        '-infinity'::timestamptz
      ),
      search_basecamp_archive.after_record_id
    )
  order by
    ranked.search_rank desc,
    coalesce(ranked.source_updated_at, '-infinity'::timestamptz) desc,
    ranked.id desc
  limit bounded_page_size;
end;
$$;

create or replace function public.list_basecamp_archive_records(
  target_project_id uuid,
  target_record_type text default null,
  target_parent_id uuid default null,
  after_source_updated_at timestamptz default null,
  after_record_id uuid default null,
  page_size integer default 50,
  source_from timestamptz default null,
  source_to timestamptz default null
)
returns table (
  record_id uuid,
  export_run_id uuid,
  parent_id uuid,
  record_type text,
  native_recording_id bigint,
  title text,
  sanitized_html text,
  plain_text text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  source_status text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_page_size integer;
  selected_run_id uuid;
begin
  if not private.can_access_project(target_project_id) then
    raise insufficient_privilege using message = 'Project access is required.';
  end if;
  if (after_source_updated_at is null) <> (after_record_id is null) then
    raise check_violation using message = 'Both record cursor values are required.';
  end if;

  bounded_page_size := least(greatest(coalesce(page_size, 50), 1), 100);

  select candidate.run_id
  into selected_run_id
  from (
    select record.run_id, export.exported_at
    from public.basecamp_archive_records as record
    join public.basecamp_export_runs as export on export.id = record.run_id
    where record.project_id = target_project_id
    union
    select entry.run_id, export.exported_at
    from public.basecamp_archive_entries as entry
    join public.basecamp_export_runs as export on export.id = entry.run_id
    where entry.project_id = target_project_id
    union
    select file.basecamp_export_run_id, export.exported_at
    from public.files as file
    join public.basecamp_export_runs as export
      on export.id = file.basecamp_export_run_id
    where file.project_id = target_project_id
  ) as candidate
  order by candidate.exported_at desc, candidate.run_id desc
  limit 1;

  return query
  select
    record.id,
    record.run_id,
    record.parent_id,
    record.record_type,
    record.native_recording_id,
    record.title,
    record.sanitized_html,
    record.plain_text,
    record.source_created_at,
    record.source_updated_at,
    record.source_status,
    record.metadata
  from public.basecamp_archive_records as record
  where record.project_id = target_project_id
    and record.run_id = selected_run_id
    and (
      target_record_type is null
      or record.record_type = target_record_type
    )
    and (
      target_parent_id is null
      or record.parent_id = target_parent_id
    )
    and (
      source_from is null
      or coalesce(record.source_updated_at, record.source_created_at)
        >= source_from
    )
    and (
      source_to is null
      or coalesce(record.source_updated_at, record.source_created_at)
        <= source_to
    )
    and (
      list_basecamp_archive_records.after_source_updated_at is null
      or (
        coalesce(record.source_updated_at, '-infinity'::timestamptz),
        record.id
      ) < (
        list_basecamp_archive_records.after_source_updated_at,
        list_basecamp_archive_records.after_record_id
      )
    )
  order by
    coalesce(record.source_updated_at, '-infinity'::timestamptz) desc,
    record.id desc
  limit bounded_page_size;
end;
$$;

create or replace function public.get_basecamp_project_archive_counts(
  project_id uuid,
  run_id uuid default null
)
returns table (
  export_run_id uuid,
  record_count bigint,
  entry_count bigint,
  imported_file_count bigint,
  record_types jsonb,
  entry_classifications jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_run_id uuid;
begin
  if not private.can_access_project(project_id) then
    raise insufficient_privilege using message = 'Project access is required.';
  end if;

  if get_basecamp_project_archive_counts.run_id is not null then
    select export.id
    into selected_run_id
    from public.basecamp_export_runs as export
    join public.projects as project
      on project.organization_id = export.organization_id
    where export.id = get_basecamp_project_archive_counts.run_id
      and project.id = get_basecamp_project_archive_counts.project_id;
  else
    select candidate.run_id
    into selected_run_id
    from (
      select record.run_id, export.exported_at
      from public.basecamp_archive_records as record
      join public.basecamp_export_runs as export on export.id = record.run_id
      where record.project_id
        = get_basecamp_project_archive_counts.project_id
      union
      select entry.run_id, export.exported_at
      from public.basecamp_archive_entries as entry
      join public.basecamp_export_runs as export on export.id = entry.run_id
      where entry.project_id
        = get_basecamp_project_archive_counts.project_id
      union
      select file.basecamp_export_run_id, export.exported_at
      from public.files as file
      join public.basecamp_export_runs as export
        on export.id = file.basecamp_export_run_id
      where file.project_id
        = get_basecamp_project_archive_counts.project_id
    ) as candidate
    order by candidate.exported_at desc, candidate.run_id desc
    limit 1;
  end if;

  if selected_run_id is null then
    return;
  end if;

  return query
  select
    selected_run_id,
    (
      select count(*)
      from public.basecamp_archive_records as record
      where record.run_id = selected_run_id
        and record.project_id
          = get_basecamp_project_archive_counts.project_id
    ),
    (
      select count(*)
      from public.basecamp_archive_entries as entry
      where entry.run_id = selected_run_id
        and entry.project_id
          = get_basecamp_project_archive_counts.project_id
    ),
    (
      select count(*)
      from public.files as file
      where file.basecamp_export_run_id = selected_run_id
        and file.project_id
          = get_basecamp_project_archive_counts.project_id
    ),
    coalesce((
      select jsonb_object_agg(grouped.record_type, grouped.row_count)
      from (
        select record.record_type, count(*) as row_count
        from public.basecamp_archive_records as record
        where record.run_id = selected_run_id
          and record.project_id
            = get_basecamp_project_archive_counts.project_id
        group by record.record_type
      ) as grouped
    ), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(
        grouped.classification,
        grouped.row_count
      )
      from (
        select entry.classification, count(*) as row_count
        from public.basecamp_archive_entries as entry
        where entry.run_id = selected_run_id
          and entry.project_id
            = get_basecamp_project_archive_counts.project_id
        group by entry.classification
      ) as grouped
    ), '{}'::jsonb);
end;
$$;

create or replace function public.list_imported_project_files(
  project_id uuid,
  after_listing_position bigint default null,
  after_file_id uuid default null,
  page_size integer default 50
)
returns table (
  file_id uuid,
  file_name text,
  mime_type text,
  size_bytes bigint,
  availability_status text,
  listing_position bigint,
  listing_cursor bigint,
  source_system text,
  source_account_id text,
  source_file_id text,
  source_path text,
  source_uploader_id text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  imported_at timestamptz,
  reference_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  bounded_page_size integer;
begin
  if not private.can_access_project(project_id) then
    raise insufficient_privilege using message = 'Project access is required.';
  end if;
  if (after_listing_position is null) <> (after_file_id is null) then
    raise check_violation using message = 'Both file cursor values are required.';
  end if;

  bounded_page_size := least(greatest(coalesce(page_size, 50), 1), 100);

  return query
  select
    file.id,
    file.file_name,
    file.mime_type,
    file.size_bytes,
    file.availability_status,
    file.listing_position,
    coalesce(file.listing_position, 9223372036854775807::bigint),
    file.source_system,
    file.source_account_id,
    file.source_file_id,
    file.source_path,
    file.source_uploader_id,
    file.source_created_at,
    file.source_updated_at,
    file.imported_at,
    (
      select count(*)
      from public.file_references as reference
      where reference.file_id = file.id
    )
  from public.files as file
  where file.project_id = list_imported_project_files.project_id
    and file.basecamp_export_run_id is not null
    and (
      list_imported_project_files.after_listing_position is null
      or (
        coalesce(file.listing_position, 9223372036854775807::bigint),
        file.id
      ) > (
        list_imported_project_files.after_listing_position,
        list_imported_project_files.after_file_id
      )
    )
  order by
    coalesce(file.listing_position, 9223372036854775807::bigint),
    file.id
  limit bounded_page_size;
end;
$$;

create or replace function private.resolve_basecamp_download_target(
  file_id uuid default null,
  archive_entry_id uuid default null
)
returns table (
  bucket_id text,
  object_path text,
  file_name text,
  mime_type text,
  size_bytes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') not in ('authenticated', 'service_role') then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;
  if num_nonnulls(
    resolve_basecamp_download_target.file_id,
    resolve_basecamp_download_target.archive_entry_id
  ) <> 1 then
    raise check_violation using
      message = 'Exactly one logical file or archive entry is required.';
  end if;

  if resolve_basecamp_download_target.file_id is not null then
    return query
    select
      blob.bucket_id,
      blob.object_path,
      file.file_name,
      coalesce(file.mime_type, blob.mime_type),
      file.size_bytes
    from public.files as file
    join public.file_blobs as blob on blob.id = file.blob_id
    where file.id = resolve_basecamp_download_target.file_id
      and file.availability_status = 'available'
      and blob.status in ('ready', 'unverified')
      and private.can_access_project(file.project_id);
  else
    return query
    select
      blob.bucket_id,
      blob.object_path,
      entry.file_name,
      blob.mime_type,
      entry.uncompressed_size_bytes
    from public.basecamp_archive_entries as entry
    join public.file_blobs as blob on blob.id = entry.blob_id
    where entry.id = resolve_basecamp_download_target.archive_entry_id
      and blob.status in ('ready', 'unverified')
      and (
        private.can_access_basecamp_archive_row(
          entry.run_id,
          entry.project_id
        )
        or (
          entry.project_id is null
          and exists (
            select 1
            from public.basecamp_archive_record_entries as reference
            join public.basecamp_archive_records as record
              on record.id = reference.record_id
            where reference.entry_id = entry.id
              and record.run_id = entry.run_id
              and record.project_id is not null
              and private.can_access_project(record.project_id)
          )
        )
      );
  end if;

  if not found then
    raise insufficient_privilege using
      message = 'The download target is unavailable or unauthorized.';
  end if;
end;
$$;

revoke all on function private.resolve_basecamp_download_target(uuid, uuid)
  from public;
grant execute on function private.resolve_basecamp_download_target(uuid, uuid)
  to authenticated, service_role;

create or replace function public.resolve_basecamp_download_target(
  file_id uuid default null,
  archive_entry_id uuid default null
)
returns table (
  bucket_id text,
  object_path text,
  file_name text,
  mime_type text,
  size_bytes bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.resolve_basecamp_download_target(file_id, archive_entry_id);
$$;

revoke all on function public.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) from public, anon;
revoke all on function public.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) from public, anon;
revoke all on function public.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) from public, anon;
revoke all on function public.get_basecamp_project_archive_counts(uuid, uuid)
  from public, anon;
revoke all on function public.list_imported_project_files(
  uuid,
  bigint,
  uuid,
  integer
) from public, anon;
revoke all on function public.resolve_basecamp_download_target(uuid, uuid)
  from public, anon;

grant execute on function public.list_basecamp_archive_projects(
  uuid,
  uuid,
  text,
  uuid,
  integer
) to authenticated, service_role;
grant execute on function public.search_basecamp_archive(
  uuid,
  text,
  uuid,
  text,
  real,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) to authenticated, service_role;
grant execute on function public.list_basecamp_archive_records(
  uuid,
  text,
  uuid,
  timestamptz,
  uuid,
  integer,
  timestamptz,
  timestamptz
) to authenticated, service_role;
grant execute on function public.get_basecamp_project_archive_counts(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.list_imported_project_files(
  uuid,
  bigint,
  uuid,
  integer
) to authenticated, service_role;
grant execute on function public.resolve_basecamp_download_target(uuid, uuid)
  to authenticated, service_role;
