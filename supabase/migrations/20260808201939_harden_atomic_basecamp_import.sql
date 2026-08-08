-- Keep staging resumable while making the final merge reject dangling or
-- cross-organization references instead of silently dropping them.

grant select, insert, update, delete on
  public.todo_assignees,
  public.todo_completion_subscribers,
  public.todo_subtasks,
  public.comment_mentions,
  public.comment_attachments
to service_role;

create or replace function private.require_staging_basecamp_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_run_id uuid;
begin
  changed_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;

  perform 1
  from public.basecamp_import_runs as run
  where run.id = changed_run_id
    and run.status = 'staging'
  for key share;

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'Basecamp staging can only change while its run is staging.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger require_staging_basecamp_run_for_stage
  before insert or update or delete on public.basecamp_import_stage
  for each row execute function private.require_staging_basecamp_run();

create trigger require_staging_basecamp_run_for_checkpoint
  before insert or update or delete on public.basecamp_import_checkpoints
  for each row execute function private.require_staging_basecamp_run();

create or replace function private.validate_basecamp_import_stage(
  target_run_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  import_run public.basecamp_import_runs%rowtype;
  required_entities constant text[] := array[
    'profiles',
    'projects',
    'project_members',
    'todo_lists',
    'todos',
    'todo_assignees',
    'docs',
    'comments',
    'comment_mentions'
  ];
begin
  select run.*
  into import_run
  from public.basecamp_import_runs as run
  where run.id = target_run_id
  for update;

  if not found then
    raise no_data_found using message = 'Basecamp import run not found.';
  end if;
  if import_run.status <> 'staging' then
    raise object_not_in_prerequisite_state using
      message = 'Basecamp import run is not ready to finalize.';
  end if;
  if not (import_run.manifest ?& required_entities)
    or import_run.manifest - required_entities <> '{}'::jsonb
  then
    raise check_violation using
      message = 'Basecamp manifest must contain exactly the supported entities.';
  end if;
  if exists (
    select 1
    from jsonb_each_text(import_run.manifest) as manifest(entity_type, expected)
    left join lateral (
      select coalesce(sum(checkpoint.row_count), 0) as checkpoint_count
      from public.basecamp_import_checkpoints as checkpoint
      where checkpoint.run_id = target_run_id
        and checkpoint.entity_type = manifest.entity_type
    ) as totals on true
    where totals.checkpoint_count <> manifest.expected::bigint
  ) then
    raise check_violation using
      message = 'Basecamp checkpoints do not match the import manifest.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = 'profiles'
      and (stage.payload ->> 'organization_id')::uuid
        is distinct from import_run.organization_id
  ) then
    raise check_violation using
      message = 'A staged profile maps to another organization.';
  end if;
  if exists (
    select 1
    from public.basecamp_import_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = 'projects'
      and (stage.payload ->> 'organization_id')::uuid
        is distinct from import_run.organization_id
  ) then
    raise check_violation using
      message = 'A staged project maps to another organization.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    cross join lateral jsonb_to_record(stage.payload) as source(
      project_id uuid,
      profile_id uuid
    )
    where stage.run_id = target_run_id
      and stage.entity_type = 'project_members'
      and (
        not exists (
          select 1
          from public.basecamp_import_stage as project_stage
          where project_stage.run_id = target_run_id
            and project_stage.entity_type = 'projects'
            and (project_stage.payload ->> 'id')::uuid = source.project_id
        )
        or not exists (
          select 1
          from public.basecamp_import_stage as profile_stage
          where profile_stage.run_id = target_run_id
            and profile_stage.entity_type = 'profiles'
            and (profile_stage.payload ->> 'id')::uuid = source.profile_id
        )
      )
  ) then
    raise check_violation using
      message = 'A staged project membership has an invalid project or profile.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    where stage.run_id = target_run_id
      and stage.entity_type = 'todo_lists'
      and not exists (
        select 1
        from public.basecamp_import_stage as project_stage
        where project_stage.run_id = target_run_id
          and project_stage.entity_type = 'projects'
          and (project_stage.payload ->> 'id')::uuid
            = (stage.payload ->> 'project_id')::uuid
      )
  ) then
    raise check_violation using
      message = 'A staged todo list has an invalid project.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    cross join lateral jsonb_to_record(stage.payload) as source(
      project_id uuid,
      todo_list_id uuid,
      assigned_to uuid
    )
    where stage.run_id = target_run_id
      and stage.entity_type = 'todos'
      and (
        not exists (
          select 1
          from public.basecamp_import_stage as project_stage
          where project_stage.run_id = target_run_id
            and project_stage.entity_type = 'projects'
            and (project_stage.payload ->> 'id')::uuid = source.project_id
        )
        or not exists (
          select 1
          from public.basecamp_import_stage as list_stage
          where list_stage.run_id = target_run_id
            and list_stage.entity_type = 'todo_lists'
            and (list_stage.payload ->> 'id')::uuid = source.todo_list_id
            and (list_stage.payload ->> 'project_id')::uuid = source.project_id
        )
        or (
          source.assigned_to is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as profile_stage
            where profile_stage.run_id = target_run_id
              and profile_stage.entity_type = 'profiles'
              and (profile_stage.payload ->> 'id')::uuid = source.assigned_to
          )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged todo has an invalid project, list, or assignee.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    cross join lateral jsonb_to_record(stage.payload) as source(
      todo_id uuid,
      profile_id uuid,
      assigned_by uuid
    )
    where stage.run_id = target_run_id
      and stage.entity_type = 'todo_assignees'
      and (
        not exists (
          select 1
          from public.basecamp_import_stage as todo_stage
          where todo_stage.run_id = target_run_id
            and todo_stage.entity_type = 'todos'
            and (todo_stage.payload ->> 'id')::uuid = source.todo_id
        )
        or not exists (
          select 1
          from public.basecamp_import_stage as profile_stage
          where profile_stage.run_id = target_run_id
            and profile_stage.entity_type = 'profiles'
            and (profile_stage.payload ->> 'id')::uuid = source.profile_id
        )
        or (
          source.assigned_by is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as profile_stage
            where profile_stage.run_id = target_run_id
              and profile_stage.entity_type = 'profiles'
              and (profile_stage.payload ->> 'id')::uuid = source.assigned_by
          )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged todo assignee has an invalid todo or profile.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    cross join lateral jsonb_to_record(stage.payload) as source(
      project_id uuid,
      created_by uuid,
      updated_by uuid
    )
    where stage.run_id = target_run_id
      and stage.entity_type = 'docs'
      and (
        not exists (
          select 1
          from public.basecamp_import_stage as project_stage
          where project_stage.run_id = target_run_id
            and project_stage.entity_type = 'projects'
            and (project_stage.payload ->> 'id')::uuid = source.project_id
        )
        or (
          source.created_by is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as profile_stage
            where profile_stage.run_id = target_run_id
              and profile_stage.entity_type = 'profiles'
              and (profile_stage.payload ->> 'id')::uuid = source.created_by
          )
        )
        or (
          source.updated_by is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as profile_stage
            where profile_stage.run_id = target_run_id
              and profile_stage.entity_type = 'profiles'
              and (profile_stage.payload ->> 'id')::uuid = source.updated_by
          )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged document has an invalid project or profile.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    cross join lateral jsonb_to_record(stage.payload) as source(
      project_id uuid,
      todo_id uuid,
      doc_id uuid,
      author_id uuid
    )
    where stage.run_id = target_run_id
      and stage.entity_type = 'comments'
      and (
        num_nonnulls(source.todo_id, source.doc_id) <> 1
        or not exists (
          select 1
          from public.basecamp_import_stage as project_stage
          where project_stage.run_id = target_run_id
            and project_stage.entity_type = 'projects'
            and (project_stage.payload ->> 'id')::uuid = source.project_id
        )
        or (
          source.todo_id is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as todo_stage
            where todo_stage.run_id = target_run_id
              and todo_stage.entity_type = 'todos'
              and (todo_stage.payload ->> 'id')::uuid = source.todo_id
              and (todo_stage.payload ->> 'project_id')::uuid
                = source.project_id
          )
        )
        or (
          source.doc_id is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as doc_stage
            where doc_stage.run_id = target_run_id
              and doc_stage.entity_type = 'docs'
              and (doc_stage.payload ->> 'id')::uuid = source.doc_id
              and (doc_stage.payload ->> 'project_id')::uuid
                = source.project_id
          )
        )
        or (
          source.author_id is not null
          and not exists (
            select 1
            from public.basecamp_import_stage as profile_stage
            where profile_stage.run_id = target_run_id
              and profile_stage.entity_type = 'profiles'
              and (profile_stage.payload ->> 'id')::uuid = source.author_id
          )
        )
      )
  ) then
    raise check_violation using
      message = 'A staged comment has an invalid project, target, or author.';
  end if;

  if exists (
    select 1
    from public.basecamp_import_stage as stage
    cross join lateral jsonb_to_record(stage.payload) as source(
      comment_id uuid,
      profile_id uuid
    )
    where stage.run_id = target_run_id
      and stage.entity_type = 'comment_mentions'
      and (
        not exists (
          select 1
          from public.basecamp_import_stage as comment_stage
          where comment_stage.run_id = target_run_id
            and comment_stage.entity_type = 'comments'
            and (comment_stage.payload ->> 'id')::uuid = source.comment_id
        )
        or not exists (
          select 1
          from public.basecamp_import_stage as profile_stage
          where profile_stage.run_id = target_run_id
            and profile_stage.entity_type = 'profiles'
            and (profile_stage.payload ->> 'id')::uuid = source.profile_id
        )
      )
  ) then
    raise check_violation using
      message = 'A staged comment mention has an invalid comment or profile.';
  end if;
end;
$$;

alter function public.finalize_basecamp_import(uuid) set schema private;
alter function private.finalize_basecamp_import(uuid)
  rename to merge_basecamp_import;

revoke all on function private.require_staging_basecamp_run()
  from public, anon, authenticated;
revoke all on function private.validate_basecamp_import_stage(uuid)
  from public, anon, authenticated;
revoke all on function private.merge_basecamp_import(uuid)
  from public, anon, authenticated;
grant execute on function private.validate_basecamp_import_stage(uuid)
  to service_role;
grant execute on function private.merge_basecamp_import(uuid)
  to service_role;

create or replace function public.finalize_basecamp_import(
  target_run_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  existing_status text;
  existing_summary jsonb;
begin
  select run.status, run.summary
  into existing_status, existing_summary
  from public.basecamp_import_runs as run
  where run.id = target_run_id;
  if existing_status = 'succeeded' then
    return existing_summary;
  end if;

  perform private.validate_basecamp_import_stage(target_run_id);
  return private.merge_basecamp_import(target_run_id);
end;
$$;

revoke all on function public.finalize_basecamp_import(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_basecamp_import(uuid)
  to service_role;

create or replace function private.bump_todo_version_for_direct_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version = old.version and (
    new.project_id,
    new.todo_list_id,
    new.title,
    new.description,
    new.assigned_to,
    new.due_at,
    new.completed_at,
    new.status,
    new.priority,
    new.position,
    new.sync_status,
    new.basecamp_todo_id,
    new.accelo_task_id,
    new.basecamp_payload,
    new.accelo_payload
  ) is distinct from (
    old.project_id,
    old.todo_list_id,
    old.title,
    old.description,
    old.assigned_to,
    old.due_at,
    old.completed_at,
    old.status,
    old.priority,
    old.position,
    old.sync_status,
    old.basecamp_todo_id,
    old.accelo_task_id,
    old.basecamp_payload,
    old.accelo_payload
  ) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger bump_todo_version_for_direct_update
  before update on public.todos
  for each row execute function private.bump_todo_version_for_direct_update();
