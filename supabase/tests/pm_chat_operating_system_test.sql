begin;

select extensions.plan(4);

insert into public.organizations (id, name, slug)
values
  ('31000000-0000-4000-8000-000000000001', 'Operating system test', 'operating-system-test'),
  ('31000000-0000-4000-8000-000000000002', 'Operating system outsider', 'operating-system-outsider');

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
    '39000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    'ops-admin@example.com',
    'Ops Admin',
    'admin',
    'active',
    true
  ),
  (
    '39000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000001',
    'ops-member@example.com',
    'Ops Member',
    'member',
    'active',
    true
  ),
  (
    '39000000-0000-4000-8000-000000000003',
    '31000000-0000-4000-8000-000000000002',
    'ops-outsider@example.com',
    'Ops Outsider',
    'admin',
    'active',
    true
  );

insert into public.projects (id, organization_id, name, code, owner_id)
values (
  '32000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  'Operating project',
  'OPS-T',
  '39000000-0000-4000-8000-000000000001'
);

insert into public.project_members (project_id, profile_id)
values (
  '32000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '39000000-0000-4000-8000-000000000001';

insert into public.work_decisions (
  organization_id,
  project_id,
  title,
  summary,
  created_by
)
values (
  '31000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000001',
  'Use the closed loop',
  'Conversation state returns to the source.',
  '39000000-0000-4000-8000-000000000001'
);

select extensions.is(
  (
    select organization_id
    from public.work_decisions
    where title = 'Use the closed loop'
  ),
  '31000000-0000-4000-8000-000000000001'::uuid,
  'project-scoped records receive the canonical organization'
);

insert into public.workspace_inbox_items (
  organization_id,
  recipient_id,
  actor_id,
  project_id,
  kind,
  title,
  href,
  source_type,
  source_id
)
values (
  '31000000-0000-4000-8000-000000000001',
  '39000000-0000-4000-8000-000000000002',
  '39000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'assignment',
  'Assigned work',
  '/projects/32000000-0000-4000-8000-000000000001',
  'issue',
  'test-issue'
);

set local "request.jwt.claim.sub" = '39000000-0000-4000-8000-000000000002';

select extensions.is(
  (select count(*)::integer from public.workspace_inbox_items),
  1,
  'a recipient can read their inbox item'
);

select extensions.is(
  (select count(*)::integer from public.work_decisions),
  1,
  'a project member can read project decisions'
);

set local "request.jwt.claim.sub" = '39000000-0000-4000-8000-000000000003';

select extensions.is(
  (select count(*)::integer from public.work_decisions),
  0,
  'an outsider cannot read project decisions'
);

select * from extensions.finish();
rollback;
