begin;

select extensions.plan(10);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values
  (
    'ca100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'crm-admin@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'ca100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'crm-outsider@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values
  (
    'ca200000-0000-4000-8000-000000000001',
    'CRM workflow test',
    'crm-workflow-test'
  ),
  (
    'ca200000-0000-4000-8000-000000000002',
    'CRM workflow outsider',
    'crm-workflow-outsider'
  );

insert into public.profiles (
  id, organization_id, email, full_name, role, status
)
values
  (
    'ca100000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    'crm-admin@example.com', 'CRM Admin', 'admin', 'active'
  ),
  (
    'ca100000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000002',
    'crm-outsider@example.com', 'CRM Outsider', 'admin', 'active'
  );

insert into public.clients (
  id, organization_id, name, status, account_owner_id, default_currency
)
values (
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'Prospective Client', 'prospect',
  'ca100000-0000-4000-8000-000000000001', 'USD'
);

insert into public.clients (
  id, organization_id, name, status, account_owner_id, parent_client_id,
  default_currency
)
values (
  'ca300000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000001',
  'Prospective Client Subsidiary', 'prospect',
  'ca100000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001', 'USD'
);

select extensions.ok(
  (
    select account_owner_id = 'ca100000-0000-4000-8000-000000000001'::uuid
      and parent_client_id = 'ca300000-0000-4000-8000-000000000001'::uuid
    from public.clients
    where id = 'ca300000-0000-4000-8000-000000000002'
  ),
  'client ownership and hierarchy use canonical columns'
);

insert into public.contacts (
  id, organization_id, first_name, last_name, email
)
values (
  'ca400000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'Avery', 'Buyer', 'avery@example.com'
);

insert into public.prospects (
  id, organization_id, client_id, primary_contact_id, owner_id, title,
  stage, probability, value_cents, currency, next_action, next_action_at
)
values (
  'ca500000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'Website redesign', 'qualified', 70, 2500000, 'USD',
  'Review proposal', '2026-08-15T17:00:00Z'
);

insert into public.prospect_contacts (
  organization_id, prospect_id, contact_id, role, is_primary
)
values (
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'Decision maker', true
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000001"}',
  true
);

select public.convert_prospect_to_won(
  'ca500000-0000-4000-8000-000000000001',
  'Website redesign delivery',
  'CRM-WON',
  '2026-08-12',
  true,
  'Website care',
  150000,
  600,
  'crm-conversion-001'
);

select extensions.ok(
  (
    select stage = 'won'
      and probability = 100
      and won_project_id is not null
      and won_retainer_id is not null
      and converted_at is not null
    from public.prospects
    where id = 'ca500000-0000-4000-8000-000000000001'
  ),
  'winning an opportunity records its complete conversion'
);

select extensions.ok(
  (
    select project.client_id = prospect.client_id
      and project.commercial_value_cents = prospect.value_cents
    from public.prospects as prospect
    join public.projects as project on project.id = prospect.won_project_id
    where prospect.id = 'ca500000-0000-4000-8000-000000000001'
  ),
  'conversion creates a linked client project with commercial value'
);

select extensions.ok(
  exists (
    select 1
    from public.prospects as prospect
    join public.retainer_projects as relation
      on relation.retainer_id = prospect.won_retainer_id
      and relation.project_id = prospect.won_project_id
    where prospect.id = 'ca500000-0000-4000-8000-000000000001'
  ),
  'optional converted retainer is linked to the project'
);

select extensions.ok(
  exists (
    select 1
    from public.prospects as prospect
    join public.project_contacts as relation
      on relation.project_id = prospect.won_project_id
    where prospect.id = 'ca500000-0000-4000-8000-000000000001'
      and relation.contact_id = 'ca400000-0000-4000-8000-000000000001'
  ),
  'opportunity contacts carry into delivery'
);

select extensions.ok(
  exists (
    select 1 from public.client_activities
    where prospect_id = 'ca500000-0000-4000-8000-000000000001'
      and activity_type = 'status_change'
  ),
  'conversion is recorded in opportunity history'
);

select public.convert_prospect_to_won(
  'ca500000-0000-4000-8000-000000000001',
  'Website redesign delivery',
  'CRM-WON',
  '2026-08-12',
  true,
  'Website care',
  150000,
  600,
  'crm-conversion-001'
);

select extensions.is(
  (
    select count(*)::integer from public.projects
    where metadata ->> 'converted_from_prospect_id'
      = 'ca500000-0000-4000-8000-000000000001'
  ),
  1,
  'repeating a conversion key is idempotent'
);

reset role;

select extensions.throws_like(
  $$
    insert into public.prospects (
      organization_id, client_id, title, stage, probability, value_cents,
      currency, closed_at
    )
    values (
      'ca200000-0000-4000-8000-000000000001',
      'ca300000-0000-4000-8000-000000000001',
      'Unexplained loss', 'lost', 0, 0, 'USD', now()
    )
  $$,
  '%prospects_lost_reason_consistent%',
  'lost opportunities require a reason'
);

insert into public.automation_rules (
  id, organization_id, project_id, name, trigger_type, action_type, created_by
)
select
  'ca600000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  prospect.won_project_id,
  'Notify overdue owner', 'overdue', 'notify',
  'ca100000-0000-4000-8000-000000000001'
from public.prospects as prospect
where prospect.id = 'ca500000-0000-4000-8000-000000000001';

insert into public.automation_rule_runs (
  id, organization_id, rule_id, event_key, status, attempt_count
)
values (
  'ca700000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca600000-0000-4000-8000-000000000001',
  'overdue:issue:test', 'failed', 1
);
insert into public.automation_run_attempts (
  organization_id, run_id, attempt_number, status, error, completed_at
)
values (
  'ca200000-0000-4000-8000-000000000001',
  'ca700000-0000-4000-8000-000000000001',
  1, 'failed', 'test failure', now()
);

select extensions.throws_like(
  $$
    update public.automation_run_attempts
    set error = 'rewritten'
    where run_id = 'ca700000-0000-4000-8000-000000000001'
  $$,
  '%append-only%',
  'automation retry history is append-only'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"ca100000-0000-4000-8000-000000000002"}',
  true
);

select extensions.is(
  (select count(*)::integer from public.automation_rule_runs),
  0,
  'automation run history is organization scoped'
);

select * from extensions.finish();
rollback;
