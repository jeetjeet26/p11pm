begin;

select extensions.plan(13);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values
  (
    'd1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'support-manager@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'd1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'support-reader@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    'd1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'support-outsider@example.com', now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values
  (
    'd1200000-0000-4000-8000-000000000001',
    'Support workflow test',
    'support-workflow-test'
  ),
  (
    'd1200000-0000-4000-8000-000000000002',
    'Support outsider',
    'support-outsider'
  );

insert into public.profiles (
  id, organization_id, email, full_name, role, status, permissions,
  accelo_staff_id
)
values
  (
    'd1100000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001',
    'support-manager@example.com', 'Support Manager', 'manager', 'active',
    '{}', 'staff-7'
  ),
  (
    'd1100000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000001',
    'support-reader@example.com', 'Support Reader', 'member', 'active',
    '{"support.read":true}', null
  ),
  (
    'd1100000-0000-4000-8000-000000000003',
    'd1200000-0000-4000-8000-000000000002',
    'support-outsider@example.com', 'Support Outsider', 'member', 'active',
    '{}', null
  );

insert into public.clients (
  id, organization_id, name, status, external_id
)
values (
  'd1300000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'Support Client', 'active', 'company-7'
);

insert into public.contacts (
  id, organization_id, first_name, last_name, email, external_id
)
values (
  'd1400000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'Riley', 'Requester', 'riley@example.com', 'contact-7'
);

insert into public.source_records (
  organization_id, provider, source_account_id, source_entity_type,
  source_record_id, destination_table, destination_record_id
)
values
  (
    'd1200000-0000-4000-8000-000000000001', 'accelo', 'support-test',
    'companies', 'company-7', 'clients',
    'd1300000-0000-4000-8000-000000000001'
  ),
  (
    'd1200000-0000-4000-8000-000000000001', 'accelo', 'support-test',
    'contacts', 'contact-7', 'contacts',
    'd1400000-0000-4000-8000-000000000001'
  ),
  (
    'd1200000-0000-4000-8000-000000000001', 'accelo', 'support-test',
    'staff', 'staff-7', 'profiles',
    'd1100000-0000-4000-8000-000000000001'
  );

set local session_replication_role = replica;
insert into public.integration_authority_states (
  organization_id, source_account_id, entity_type, state
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'support-test', 'issues', 'importing'
);
set local session_replication_role = origin;

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  requested_entities, lease_token, lease_owner, lease_acquired_at,
  lease_expires_at, heartbeat_at, started_at
)
values (
  'd1500000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'support-test', 'support-import-run-001', 'running', array['issues'],
  'd1600000-0000-4000-8000-000000000001', 'pg-tap', now(),
  now() + interval '10 minutes', now(), now()
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id, source_updated_at,
  raw_payload, normalized_payload, transformer_version
)
values
  (
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'issues', 'issue-open', '2026-08-11T18:00:00Z',
    '{"id":"issue-open","standing":"waiting","company":{"id":"company-7"}}',
    '{
      "source_id":"issue-open",
      "company_source_id":"company-7",
      "contact_source_id":"contact-7",
      "owner_source_id":"staff-7",
      "title":"Website form is failing",
      "description":"Lead submissions return an error.",
      "source_status":"Waiting on Client",
      "status":"review",
      "priority":"urgent",
      "opened_at":"2026-08-10T17:00:00Z",
      "first_response_due_at":"2026-08-10T19:00:00Z",
      "resolution_due_at":"2026-08-12T17:00:00Z"
    }',
    2
  ),
  (
    'd1200000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    'issues', 'issue-closed', '2026-08-11T18:00:00Z',
    '{"id":"issue-closed","standing":"resolved","company":{"id":"company-7"}}',
    '{
      "source_id":"issue-closed",
      "company_source_id":"company-7",
      "title":"Correct old brochure link",
      "source_status":"Resolved",
      "status":"done",
      "priority":"low",
      "opened_at":"2026-08-01T17:00:00Z",
      "resolved_at":"2026-08-02T17:00:00Z",
      "closed_at":"2026-08-02T18:00:00Z"
    }',
    2
  );

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'd1500000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001'
    ) ->> 'mapped'
  )::bigint,
  2::bigint,
  'open and closed Accelo issues promote into support'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.projects
    where organization_id = 'd1200000-0000-4000-8000-000000000001'
      and metadata ->> 'system_kind' = 'support_queue'
      and status = 'active'
  ),
  1::bigint,
  'one active organization support project backs canonical issue cores'
);

select extensions.ok(
  (
    select count(*) = 2
      and bool_and(client_id = 'd1300000-0000-4000-8000-000000000001')
    from public.support_tickets
    where organization_id = 'd1200000-0000-4000-8000-000000000001'
  ),
  'support extension preserves client and source identity'
);

select extensions.ok(
  (
    select ticket.requester_contact_id =
        'd1400000-0000-4000-8000-000000000001'
      and todo.assigned_to = 'd1100000-0000-4000-8000-000000000001'
      and todo.status = 'review'
      and todo.priority = 'urgent'
      and ticket.source_status = 'Waiting on Client'
      and ticket.first_response_due_at = '2026-08-10T19:00:00Z'
    from public.support_tickets as ticket
    join public.todos as todo on todo.id = ticket.todo_id
    where ticket.external_id = 'issue-open'
  ),
  'requester owner status priority and SLA fields remain source faithful'
);

select extensions.ok(
  (
    select todo.status = 'done'
      and todo.operational_state = 'historical'
      and ticket.resolved_at = '2026-08-02T17:00:00Z'
      and ticket.closed_at = '2026-08-02T18:00:00Z'
    from public.support_tickets as ticket
    join public.todos as todo on todo.id = ticket.todo_id
    where ticket.external_id = 'issue-closed'
  ),
  'closed support history retains resolution and closure timestamps'
);

insert into public.client_activities (
  organization_id, client_id, contact_id, activity_type, subject, body,
  occurred_at, external_id, source, direction, source_updated_at, source_payload
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'email', 'Re: Website form is failing', 'The error is still happening.',
  '2026-08-11T17:30:00Z', 'activity-support-1', 'accelo', 'inbound',
  '2026-08-11T17:30:00Z',
  '{"against_type":"issue","against_id":"issue-open"}'
);

select extensions.ok(
  (
    select comment.body = 'The error is still happening.'
      and comment.metadata ->> 'direction' = 'inbound'
    from public.comments as comment
    join public.support_tickets as ticket on ticket.todo_id = comment.todo_id
    where ticket.external_id = 'issue-open'
      and comment.metadata ->> 'external_id' = 'activity-support-1'
  ),
  'Accelo issue correspondence imports into canonical comments'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d1100000-0000-4000-8000-000000000001"}',
  true
);

select extensions.is(
  jsonb_array_length(public.get_support_queue() -> 'tickets'),
  1,
  'support queue defaults to active tickets'
);

select extensions.ok(
  (
    public.get_support_ticket_detail((
      select todo_id from public.support_tickets where external_id = 'issue-open'
    )) #>> '{ticket,requester_email}'
  ) = 'riley@example.com',
  'detail returns requester and client context'
);

select extensions.ok(
  (
    public.update_support_ticket(
      (select todo_id from public.support_tickets where external_id = 'issue-open'),
      1,
      '{"status":"in_progress","priority":"high"}',
      'd1100000-0000-4000-8000-000000000001'
    ) ->> 'status'
  ) = 'in_progress',
  'support agents update canonical issue status with optimistic versioning'
);

select extensions.ok(
  (
    public.add_support_ticket_comment(
      (select todo_id from public.support_tickets where external_id = 'issue-open'),
      'Investigating the form endpoint.',
      'd1100000-0000-4000-8000-000000000001'
    ) ->> 'body'
  ) = 'Investigating the form endpoint.',
  'support correspondence reuses canonical comments'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d1100000-0000-4000-8000-000000000002"}',
  true
);
select extensions.is(
  jsonb_array_length(public.get_support_queue() -> 'tickets'),
  1,
  'delegated support readers can access the queue without project membership'
);
select extensions.throws_ok(
  $$
    select public.update_support_ticket(
      (select todo_id from public.support_tickets where external_id = 'issue-open'),
      3,
      '{"priority":"urgent"}',
      'd1100000-0000-4000-8000-000000000002'
    )
  $$,
  '42501',
  'Support agent access is required.',
  'read-only support permission cannot mutate tickets'
);

select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"d1100000-0000-4000-8000-000000000003"}',
  true
);
select extensions.is(
  jsonb_array_length(public.get_support_queue() -> 'tickets'),
  0,
  'RLS prevents cross-organization support reads'
);

select * from extensions.finish();
rollback;
