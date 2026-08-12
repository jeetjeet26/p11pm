begin;

select extensions.plan(19);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values (
  'c1100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'accelo-promotion-admin@example.com',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  'c1200000-0000-4000-8000-000000000001',
  'Accelo promotion test',
  'accelo-promotion-test'
);

insert into public.profiles (
  id, organization_id, email, full_name, role, status
)
values (
  'c1100000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'accelo-promotion-admin@example.com',
  'Accelo Promotion Admin',
  'admin',
  'active'
);

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  full_snapshot, requested_entities, lease_token, lease_owner,
  lease_acquired_at, lease_expires_at, heartbeat_at, started_at
)
values (
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'promotion-test-run-001',
  'running',
  true,
  array['companies'],
  'c1400000-0000-4000-8000-000000000001',
  'pg-tap',
  now(),
  now() + interval '10 minutes',
  now(),
  now()
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id,
  source_updated_at, raw_payload, normalized_payload, transformer_version
)
values (
  'c1200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'companies',
  'company-701',
  '2026-08-11T20:00:00Z',
  '{"id":"company-701","name":"Promotion Client","standing":"active"}',
  '{"source_id":"company-701","name":"Promotion Client","status":"active"}',
  2
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001'
    ) ->> 'mapped'
  )::bigint,
  0::bigint,
  'missing authority fails closed'
);

select extensions.is(
  (
    select count(*)::bigint from public.clients
    where organization_id = 'c1200000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'missing authority never mutates native tables'
);

select public.set_integration_authority_state(
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'companies',
  'disabled',
  'shadow',
  null,
  'Test shadow safety',
  'c1100000-0000-4000-8000-000000000001'
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001'
    ) ->> 'mapped'
  )::bigint,
  0::bigint,
  'shadow mode archives without native promotion'
);

select public.set_integration_authority_state(
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'companies',
  'shadow',
  'importing',
  null,
  'Begin controlled import',
  'c1100000-0000-4000-8000-000000000001'
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001'
    ) ->> 'mapped'
  )::bigint,
  1::bigint,
  'explicit importing authority permits promotion'
);

select extensions.ok(
  (
    select count(*) > 0
    from public.accelo_promotion_journal
    where run_id = 'c1300000-0000-4000-8000-000000000001'
  ),
  'promotion records before and after journal evidence'
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001'
    ) ->> 'mapped'
  )::bigint,
  0::bigint,
  'latest transformer version is idempotent on replay'
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id,
  source_updated_at, raw_payload, normalized_payload, transformer_version
)
values (
  'c1200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'companies',
  'company-701',
  '2026-08-10T20:00:00Z',
  '{"id":"company-701","name":"Stale Client"}',
  '{"source_id":"company-701","name":"Stale Client","status":"active"}',
  2
);

select private.promote_accelo_pull_run(
  'c1300000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001'
);

select extensions.is(
  (
    select name from public.clients
    where organization_id = 'c1200000-0000-4000-8000-000000000001'
      and external_id = 'company-701'
  ),
  'Promotion Client',
  'stale source timestamps cannot overwrite newer native state'
);

select extensions.is(
  (
    public.finalize_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001',
      '{}',
      '{
        "truncated":false,
        "resources":{"companies":{"expected_count":1,"complete":true}}
      }'
    )
  ).status,
  'succeeded',
  'complete inventory reconciles expected mapped destinations'
);

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  full_snapshot, requested_entities, lease_token, lease_owner,
  lease_acquired_at, lease_expires_at, heartbeat_at, started_at
)
values (
  'c1300000-0000-4000-8000-000000000002',
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'promotion-test-run-002',
  'running',
  true,
  array['affiliations'],
  'c1400000-0000-4000-8000-000000000002',
  'pg-tap',
  now(),
  now() + interval '10 minutes',
  now(),
  now()
);

select public.set_integration_authority_state(
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'affiliations',
  'disabled',
  'shadow',
  null,
  'Test affiliation shadow',
  'c1100000-0000-4000-8000-000000000001'
);
select public.set_integration_authority_state(
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'affiliations',
  'shadow',
  'importing',
  null,
  'Test unresolved dependency',
  'c1100000-0000-4000-8000-000000000001'
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id,
  source_updated_at, raw_payload, normalized_payload, transformer_version
)
values (
  'c1200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000002',
  'affiliations',
  'affiliation-9',
  '2026-08-11T21:00:00Z',
  '{"id":"affiliation-9"}',
  '{
    "source_id":"affiliation-9",
    "company_source_id":"missing-company",
    "contact_source_id":"missing-contact"
  }',
  2
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000002',
      'c1400000-0000-4000-8000-000000000002'
    ) ->> 'quarantined'
  )::bigint,
  1::bigint,
  'missing parents create one structured unresolved dependency'
);

select extensions.ok(
  (
    select required_parent_identity ? 'one_of'
      and attempt_count = 1
      and resolution_state = 'pending'
    from public.accelo_unresolved_dependencies
    where source_record_id = 'affiliation-9'
  ),
  'unresolved state identifies child, required parents, and attempts'
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000002',
      'c1400000-0000-4000-8000-000000000002'
    ) ->> 'quarantined'
  )::bigint,
  0::bigint,
  'pending dependencies are not infinitely re-quarantined'
);

select public.set_accelo_unresolved_disposition(
  (
    select id from public.accelo_unresolved_dependencies
    where source_record_id = 'affiliation-9'
  ),
  'archive',
  'c1100000-0000-4000-8000-000000000001',
  'Source parent is unavailable; preserve raw archive'
);

select extensions.is(
  (
    public.finalize_accelo_pull_run(
      'c1300000-0000-4000-8000-000000000002',
      'c1400000-0000-4000-8000-000000000002',
      '{}',
      '{
        "truncated":false,
        "resources":{"affiliations":{"expected_count":1,"complete":true}}
      }'
    )
  ).status,
  'succeeded',
  'approved exclusions satisfy the reconciliation equation'
);

select extensions.ok(
  (
    select expected_count = mapped_count + approved_exclusion_count
      and destination_missing_count = 0
    from public.accelo_pull_reconciliations
    where run_id = 'c1300000-0000-4000-8000-000000000002'
      and entity_type = 'affiliations'
  ),
  'reconciliation proves counts and destination integrity'
);

select extensions.is(
  (
    public.set_integration_authority_state(
      'c1200000-0000-4000-8000-000000000001',
      'p11creativeinc',
      'companies',
      'importing',
      'accelo_authoritative',
      'c1300000-0000-4000-8000-000000000001',
      'Reconciled evidence approves authority',
      'c1100000-0000-4000-8000-000000000001'
    )
  ).state,
  'accelo_authoritative',
  'fresh reconciled evidence gates authority atomically'
);

select extensions.throws_ok(
  $$
    update public.clients
    set name = 'Unsafe native overwrite'
    where organization_id = 'c1200000-0000-4000-8000-000000000001'
      and external_id = 'company-701'
  $$,
  '55000',
  'Native companies writes are blocked while Accelo is authoritative.',
  'native writes honor active source authority'
);

select extensions.is(
  (
    public.rollback_accelo_promotion_run(
      'c1300000-0000-4000-8000-000000000001',
      'c1100000-0000-4000-8000-000000000001',
      'Exercise conflict-aware rollback'
    ) ->> 'status'
  ),
  'succeeded',
  'unchanged promoted rows can be rolled back safely'
);

select extensions.is(
  (
    select count(*)::bigint from public.clients
    where organization_id = 'c1200000-0000-4000-8000-000000000001'
      and external_id = 'company-701'
  ),
  0::bigint,
  'rollback restores the pre-promotion destination state'
);

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  full_snapshot, requested_entities, lease_token, lease_owner,
  lease_acquired_at, lease_expires_at, heartbeat_at, started_at
)
values (
  'c1300000-0000-4000-8000-000000000003',
  'c1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'promotion-test-run-stale',
  'running',
  false,
  array['companies'],
  'c1400000-0000-4000-8000-000000000003',
  'pg-tap-stale',
  now() - interval '20 minutes',
  now() - interval '10 minutes',
  now() - interval '10 minutes',
  now() - interval '20 minutes'
);

select extensions.is(
  public.reap_stale_accelo_pull_runs(),
  1,
  'stale lease reaper claims expired workers once'
);

select extensions.is(
  (
    select status from public.accelo_pull_runs
    where id = 'c1300000-0000-4000-8000-000000000003'
  ),
  'failed',
  'reaped leases become terminal failed runs'
);

select * from extensions.finish();
rollback;
