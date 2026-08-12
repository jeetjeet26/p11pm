begin;

select plan(1);

insert into public.organizations (id, name, slug)
values
  (
    '12000000-0000-4000-8000-000000000001',
    'Atomic project test',
    'atomic-project-test'
  ),
  (
    '12000000-0000-4000-8000-000000000002',
    'Other atomic test',
    'other-atomic-test'
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
    '92000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'atomic-admin@example.com',
    'Atomic Admin',
    'admin',
    'active',
    '{"is_internal": true}'::jsonb
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '12000000-0000-4000-8000-000000000001',
    'atomic-member@example.com',
    'Atomic Member',
    'member',
    'active',
    '{"is_internal": true}'::jsonb
  ),
  (
    '92000000-0000-4000-8000-000000000003',
    '12000000-0000-4000-8000-000000000002',
    'atomic-outsider@example.com',
    'Atomic Outsider',
    'admin',
    'active',
    '{"is_internal": true}'::jsonb
  ),
  (
    '92000000-0000-4000-8000-000000000004',
    '12000000-0000-4000-8000-000000000001',
    'atomic-unassigned@example.com',
    'Atomic Unassigned',
    'member',
    'active',
    '{"is_internal": true}'::jsonb
  );

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  status
)
values
  (
    '22000000-0000-4000-8000-000000000091',
    '12000000-0000-4000-8000-000000000001',
    'Atomic project',
    'ATOMIC-01',
    'active'
  ),
  (
    '22000000-0000-4000-8000-000000000092',
    '12000000-0000-4000-8000-000000000002',
    'Other project',
    'ATOMIC-02',
    'active'
  );

insert into public.project_members (project_id, profile_id)
values
  (
    '22000000-0000-4000-8000-000000000091',
    '92000000-0000-4000-8000-000000000002'
  );

insert into public.todo_lists (id, project_id, title, position)
values
  (
    '32000000-0000-4000-8000-000000000091',
    '22000000-0000-4000-8000-000000000091',
    'Atomic list',
    0
  ),
  (
    '32000000-0000-4000-8000-000000000092',
    '22000000-0000-4000-8000-000000000092',
    'Other list',
    0
  );

insert into public.files (
  id,
  project_id,
  bucket_id,
  object_path,
  file_name,
  size_bytes
)
values (
  '82000000-0000-4000-8000-000000000091',
  '22000000-0000-4000-8000-000000000091',
  'project-files',
  '22000000-0000-4000-8000-000000000091/brief.txt',
  'brief.txt',
  5
), (
  '82000000-0000-4000-8000-000000000092',
  '22000000-0000-4000-8000-000000000092',
  'project-files',
  '22000000-0000-4000-8000-000000000092/other.txt',
  'other.txt',
  5
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
select
  gen_random_uuid(),
  '12000000-0000-4000-8000-000000000001',
  format('bounded-profile-%s@example.com', sequence),
  format('Bounded profile %s', sequence),
  'member',
  'active',
  '{"is_internal": true}'::jsonb
from generate_series(1, 201) as generated(sequence);

insert into public.projects (
  id,
  organization_id,
  name,
  code,
  status
)
select
  gen_random_uuid(),
  '12000000-0000-4000-8000-000000000001',
  format('Bounded project %s', sequence),
  format('BOUND-%s', sequence),
  'active'
from generate_series(1, 101) as generated(sequence);

insert into public.milestones (project_id, name, status, due_date)
select
  project.id,
  'Bounded milestone',
  'upcoming',
  '2026-12-31'
from public.projects as project
where project.organization_id = '12000000-0000-4000-8000-000000000001'
  and project.code like 'BOUND-%';

set local role authenticated;
set local "request.jwt.claim.sub" =
  '92000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

do $$
declare
  first_todo jsonb;
  retried_todo jsonb;
  updated_todo jsonb;
  first_subtask jsonb;
  second_subtask jsonb;
  updated_subtask jsonb;
  created_message jsonb;
  created_comment jsonb;
  todo_page jsonb;
  team_page jsonb;
  created_todo_id uuid;
begin
  first_todo := public.create_project_todo(
    '22000000-0000-4000-8000-000000000091',
    '32000000-0000-4000-8000-000000000091',
    'Atomic todo',
    'Created with all relations in one transaction.',
    array['92000000-0000-4000-8000-000000000002']::uuid[],
    array['92000000-0000-4000-8000-000000000001']::uuid[],
    '2026-08-12T17:00:00Z',
    'high',
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-todo-0001'
  );
  retried_todo := public.create_project_todo(
    '22000000-0000-4000-8000-000000000091',
    '32000000-0000-4000-8000-000000000091',
    'Atomic todo',
    'Created with all relations in one transaction.',
    array['92000000-0000-4000-8000-000000000002']::uuid[],
    array['92000000-0000-4000-8000-000000000001']::uuid[],
    '2026-08-12T17:00:00Z',
    'high',
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-todo-0001'
  );
  created_todo_id := (first_todo ->> 'id')::uuid;

  if first_todo <> retried_todo then
    raise exception 'Todo idempotency did not return the original result';
  end if;
  todo_page := public.get_project_todos_data(
    '22000000-0000-4000-8000-000000000091',
    null,
    null,
    null,
    100
  );
  if (
    select count(*)
    from jsonb_array_elements(todo_page -> 'todos') as item
    where item ->> 'title' = 'Atomic todo'
  ) <> 1 then
    raise exception 'Todo retry created a duplicate row';
  end if;
  if jsonb_array_length(first_todo -> 'assignee_ids') <> 1 then
    raise exception 'Todo assignees were not committed atomically';
  end if;
  if jsonb_array_length(first_todo -> 'completion_subscriber_ids') <> 1 then
    raise exception 'Todo subscribers were not committed atomically';
  end if;

  updated_todo := public.update_project_todo(
    created_todo_id,
    1,
    '{"status":"done"}'::jsonb,
    '92000000-0000-4000-8000-000000000001',
    'update-atomic-todo-0001'
  );
  if (updated_todo ->> 'version')::integer <> 2
    or updated_todo ->> 'status' <> 'done'
  then
    raise exception 'Todo optimistic update did not advance the version';
  end if;
  if public.update_project_todo(
    created_todo_id,
    1,
    '{"status":"done"}'::jsonb,
    '92000000-0000-4000-8000-000000000001',
    'update-atomic-todo-0001'
  ) <> updated_todo then
    raise exception 'Todo update retry was not idempotent';
  end if;

  begin
    perform public.update_project_todo(
      created_todo_id,
      1,
      '{"title":"Stale update"}'::jsonb,
      '92000000-0000-4000-8000-000000000001',
      'update-atomic-todo-stale'
    );
    raise exception 'Stale todo version was accepted';
  exception
    when serialization_failure then null;
  end;

  begin
    perform public.update_project_todo(
      created_todo_id,
      2,
      '{"assignee_ids":["92000000-0000-4000-8000-000000000003"]}'::jsonb,
      '92000000-0000-4000-8000-000000000001',
      'update-atomic-cross-org'
    );
    raise exception 'Cross-organization assignee was accepted';
  exception
    when check_violation then null;
  end;

  perform set_config(
    'request.jwt.claim.sub',
    '92000000-0000-4000-8000-000000000004',
    true
  );
  begin
    perform public.create_project_todo(
      '22000000-0000-4000-8000-000000000091',
      '32000000-0000-4000-8000-000000000091',
      'Unauthorized same-org todo',
      null,
      '{}'::uuid[],
      '{}'::uuid[],
      null,
      'medium',
      '92000000-0000-4000-8000-000000000004',
      'create-atomic-unauthorized'
    );
    raise exception 'A same-organization non-member wrote to the project';
  exception
    when insufficient_privilege then null;
  end;
  perform set_config(
    'request.jwt.claim.sub',
    '92000000-0000-4000-8000-000000000001',
    true
  );

  first_subtask := public.create_project_subtask(
    created_todo_id,
    'First database-positioned subtask',
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-subtask-0001'
  );
  second_subtask := public.create_project_subtask(
    created_todo_id,
    'Second database-positioned subtask',
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-subtask-0002'
  );
  if (first_subtask ->> 'position')::integer <> 0
    or (second_subtask ->> 'position')::integer <> 1
  then
    raise exception 'Subtask positions were not allocated by the database';
  end if;
  updated_subtask := public.update_project_subtask(
    (first_subtask ->> 'id')::uuid,
    1,
    true,
    '92000000-0000-4000-8000-000000000001',
    'update-atomic-subtask-0001'
  );
  if (updated_subtask ->> 'version')::integer <> 2
    or updated_subtask ->> 'completed_at' is null
  then
    raise exception 'Subtask optimistic update did not advance the version';
  end if;
  if public.update_project_subtask(
    (first_subtask ->> 'id')::uuid,
    1,
    true,
    '92000000-0000-4000-8000-000000000001',
    'update-atomic-subtask-0001'
  ) <> updated_subtask then
    raise exception 'Subtask update retry was not idempotent';
  end if;
  begin
    perform public.update_project_subtask(
      (first_subtask ->> 'id')::uuid,
      1,
      false,
      '92000000-0000-4000-8000-000000000001',
      'update-atomic-subtask-stale'
    );
    raise exception 'Stale subtask version was accepted';
  exception
    when serialization_failure then null;
  end;

  created_message := public.create_project_message(
    '22000000-0000-4000-8000-000000000091',
    'Atomic project update',
    'Created through the canonical message RPC.',
    'update',
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-message-0001'
  );
  if created_message ->> 'project_id'
    <> '22000000-0000-4000-8000-000000000091'
  then
    raise exception 'Canonical message creation returned the wrong project';
  end if;

  created_comment := public.create_project_comment(
    '22000000-0000-4000-8000-000000000091',
    'todo',
    created_todo_id,
    'Atomic comment',
    array['92000000-0000-4000-8000-000000000002']::uuid[],
    array['82000000-0000-4000-8000-000000000091']::uuid[],
    '[{"url":"https://example.com/brief","title":"Brief"}]'::jsonb,
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-comment-0001'
  );
  if jsonb_array_length(created_comment -> 'attachments') <> 2 then
    raise exception 'Comment attachments were not committed atomically';
  end if;
  if jsonb_array_length(created_comment -> 'mentioned_profile_ids') <> 1 then
    raise exception 'Comment mentions were not committed atomically';
  end if;

  begin
    perform public.create_project_comment(
      '22000000-0000-4000-8000-000000000091',
      'todo',
      created_todo_id,
      'Invalid cross-project file',
      '{}'::uuid[],
      array['82000000-0000-4000-8000-000000000092']::uuid[],
      '[]'::jsonb,
      '92000000-0000-4000-8000-000000000001',
      'create-atomic-comment-cross-project'
    );
    raise exception 'Cross-project comment attachment was accepted';
  exception
    when check_violation then null;
  end;

  if public.get_project_overview_data(
    '22000000-0000-4000-8000-000000000092',
    null,
    null,
    20,
    20,
    20
  ) is not null then
    raise exception 'Cross-organization project overview was visible';
  end if;
  if jsonb_array_length(
    public.get_project_todos_data(
      '22000000-0000-4000-8000-000000000091',
      null,
      null,
      null,
      1
    ) -> 'todos'
  ) <> 1 then
    raise exception 'Bounded todo RPC did not respect its requested page';
  end if;
  perform public.create_project_todo(
    '22000000-0000-4000-8000-000000000091',
    '32000000-0000-4000-8000-000000000091',
    'Open workload todo',
    'Keeps the team workload payload assertion focused on active work.',
    array['92000000-0000-4000-8000-000000000002']::uuid[],
    '{}'::uuid[],
    '2026-08-13T17:00:00Z',
    'medium',
    '92000000-0000-4000-8000-000000000001',
    'create-atomic-open-workload'
  );
  team_page := public.get_team_project_data(null, null, 1);
  if jsonb_array_length(team_page -> 'profiles') > 200
    or jsonb_array_length(team_page -> 'projects') > 100
    or jsonb_array_length(team_page -> 'milestones') > 100
  then
    raise exception 'Team supporting collections exceeded their fixed bounds';
  end if;
  if jsonb_array_length(team_page -> 'todos') <> 1
    or not (team_page -> 'todos' -> 0 ? 'due_at')
    or not (team_page -> 'todos' -> 0 ? 'due_on')
    or not (team_page -> 'todos' -> 0 ? 'operational_state')
    or not (team_page -> 'todos' -> 0 ? 'issue_key')
  then
    raise exception 'Team todo payload omitted required workload fields';
  end if;
end;
$$;

reset role;
select pass('bounded project reads and atomic writes preserve invariants');
select * from finish();
rollback;
