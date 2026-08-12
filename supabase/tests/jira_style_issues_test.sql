begin;

select plan(1);

insert into public.organizations (id, name, slug)
values
  (
    '13000000-0000-4000-8000-000000000001',
    'Jira issue test',
    'jira-issue-test'
  ),
  (
    '13000000-0000-4000-8000-000000000002',
    'Jira issue outsider',
    'jira-issue-outsider'
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
    '93000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    'jira-admin@example.com',
    'Jira Admin',
    'admin',
    'active',
    '{"is_internal": true}'::jsonb
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '13000000-0000-4000-8000-000000000002',
    'jira-outsider@example.com',
    'Jira Outsider',
    'admin',
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
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    'Jira test project',
    'JIRA-T',
    'active'
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '13000000-0000-4000-8000-000000000002',
    'Jira outsider project',
    'JIRA-O',
    'active'
  );

insert into public.todo_lists (id, project_id, title, position)
values (
  '33ffffff-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  'Issues',
  0
);

set local role authenticated;
set local "request.jwt.claim.sub" =
  '93000000-0000-4000-8000-000000000001';
set local "request.jwt.claim.role" = 'authenticated';

do $$
declare
  first_issue jsonb;
  second_issue jsonb;
  retried_second_issue jsonb;
  issue_page jsonb;
  label_page jsonb;
  legacy_page jsonb;
  review_page jsonb;
  detail jsonb;
  updated_issue jsonb;
  first_issue_id uuid;
  comment_id uuid;
begin
  first_issue := public.create_project_issue(
    target_project_id => '23000000-0000-4000-8000-000000000001',
    target_todo_list_id => '33ffffff-0000-4000-8000-000000000001',
    target_title => 'Fix checkout regression',
    target_description => 'The checkout button no longer advances.',
    target_assignee_ids =>
      array['93000000-0000-4000-8000-000000000001']::uuid[],
    target_completion_subscriber_ids => '{}'::uuid[],
    target_due_at => '2026-08-12T17:00:00Z',
    target_priority => 'urgent',
    target_issue_type => 'bug',
    target_labels => array['checkout', 'release'],
    target_estimated_minutes => 90,
    target_actual_minutes => null,
    requested_actor_id => '93000000-0000-4000-8000-000000000001',
    target_idempotency_key => 'create-jira-issue-0001'
  );
  first_issue_id := (first_issue ->> 'id')::uuid;

  if first_issue ->> 'issue_key' <> 'JIRA-T-1'
    or first_issue ->> 'issue_type' <> 'bug'
    or first_issue ->> 'operational_state' <> 'active'
    or (first_issue ->> 'version')::integer <> 1
  then
    raise exception 'Rich issue creation did not return stable metadata: %',
      first_issue;
  end if;

  second_issue := public.create_project_todo(
    '23000000-0000-4000-8000-000000000001',
    '33ffffff-0000-4000-8000-000000000001',
    'Document the release',
    null,
    '{}'::uuid[],
    '{}'::uuid[],
    null,
    'medium',
    '93000000-0000-4000-8000-000000000001',
    'create-jira-issue-0002'
  );
  retried_second_issue := public.create_project_todo(
    '23000000-0000-4000-8000-000000000001',
    '33ffffff-0000-4000-8000-000000000001',
    'Document the release',
    null,
    '{}'::uuid[],
    '{}'::uuid[],
    null,
    'medium',
    '93000000-0000-4000-8000-000000000001',
    'create-jira-issue-0002'
  );
  if second_issue ->> 'issue_key' <> 'JIRA-T-2' then
    raise exception 'Legacy create did not return issue metadata: %', second_issue;
  end if;
  if retried_second_issue <> second_issue then
    raise exception 'Legacy issue create retry changed its result';
  end if;

  legacy_page := public.get_project_todos_data(
    '23000000-0000-4000-8000-000000000001',
    null,
    null,
    null,
    100
  );
  if jsonb_array_length(legacy_page -> 'todos') <> 2 then
    raise exception 'Legacy todo list no longer sees created issues: %', legacy_page;
  end if;

  issue_page := public.get_project_issues_data(
    target_project_id => '23000000-0000-4000-8000-000000000001',
    requested_limit => 1
  );
  if jsonb_array_length(issue_page -> 'todos') <> 1
    or not (issue_page ->> 'has_more')::boolean
    or (issue_page #>> '{summary,total_count}')::integer <> 2
    or issue_page ? 'subtasks'
    or issue_page ? 'comments'
  then
    raise exception 'Issue list was not lightweight or correctly paginated: %',
      issue_page;
  end if;

  label_page := public.get_project_issues_data(
    target_project_id => '23000000-0000-4000-8000-000000000001',
    label_filters => array['checkout', 'release'],
    requested_limit => 10
  );
  if (label_page #>> '{summary,total_count}') <> '1'
    or (label_page #>> '{todos,0,issue_key}') <> 'JIRA-T-1'
  then
    raise exception 'Label filtering did not use issue metadata: %', label_page;
  end if;

  insert into public.todo_subtasks (todo_id, title, position, created_by)
  values (
    first_issue_id,
    'Reproduce in production-like data',
    0,
    '93000000-0000-4000-8000-000000000001'
  );
  insert into public.comments (project_id, todo_id, author_id, body)
  values (
    '23000000-0000-4000-8000-000000000001',
    first_issue_id,
    '93000000-0000-4000-8000-000000000001',
    'This blocks today''s release.'
  )
  returning id into comment_id;
  insert into public.comment_mentions (comment_id, profile_id)
  values (comment_id, '93000000-0000-4000-8000-000000000001');
  insert into public.comment_attachments (comment_id, external_url, title)
  values (comment_id, 'https://example.com/repro', 'Reproduction');

  updated_issue := public.update_project_todo(
    first_issue_id,
    1,
    '{"status":"review","actual_minutes":45}'::jsonb,
    '93000000-0000-4000-8000-000000000001',
    'update-jira-issue-0001'
  );
  if updated_issue ->> 'status' <> 'review'
    or (updated_issue ->> 'actual_minutes')::integer <> 45
  then
    raise exception 'Issue update lost Jira metadata: %', updated_issue;
  end if;

  review_page := public.get_project_issues_data(
    target_project_id => '23000000-0000-4000-8000-000000000001',
    status_filters => array['review'],
    requested_limit => 10
  );
  if (review_page #>> '{summary,total_count}')::integer <> 1 then
    raise exception 'Status filter did not preserve review state: %', review_page;
  end if;

  detail := public.get_issue_detail_data(first_issue_id);
  if detail #>> '{issue,issue_key}' <> 'JIRA-T-1'
    or jsonb_array_length(detail -> 'subtasks') <> 1
    or jsonb_array_length(detail -> 'comments') <> 1
    or jsonb_array_length(detail -> 'transitions') <> 1
    or detail #>> '{transitions,0,to_status}' <> 'review'
    or detail #>> '{transitions,0,actor_id}'
      <> '93000000-0000-4000-8000-000000000001'
  then
    raise exception 'Authorized detail omitted issue thread/history data: %', detail;
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '93000000-0000-4000-8000-000000000002',
    true
  );
  if public.get_issue_detail_data(first_issue_id) is not null then
    raise exception 'An outsider could read issue detail';
  end if;
  if exists (
    select 1
    from public.issue_status_transitions as transition
    where transition.todo_id = first_issue_id
  ) then
    raise exception 'An outsider could read issue transition history';
  end if;
end;
$$;

reset role;
select pass('Jira issue metadata, reads, transitions, and RLS stay consistent');
select * from finish();
rollback;
