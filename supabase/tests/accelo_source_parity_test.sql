begin;

select extensions.plan(12);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values (
  'd1100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'accelo-source-admin@example.com',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  'd1200000-0000-4000-8000-000000000001',
  'Accelo source parity test',
  'accelo-source-parity-test'
);

insert into public.profiles (
  id, organization_id, email, full_name, role, status
)
values (
  'd1100000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'accelo-source-admin@example.com',
  'Accelo Source Admin',
  'admin',
  'active'
);

select extensions.ok(
  (
    select count(*) = 4 and bool_and(class.relrowsecurity)
    from pg_catalog.pg_class as class
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname = any(array[
        'accelo_recovery_stage_links',
        'accelo_recovery_attempt_events',
        'accelo_orphan_archive',
        'accelo_unresolved_disposition_events'
      ])
  ),
  'recovery evidence and approval tables enforce RLS'
);

insert into public.clients (
  id, organization_id, name, status, external_id
)
values (
  'd1400000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'Source Client',
  'active',
  'company-1'
);

insert into public.retainers (
  id, organization_id, client_id, name, status, start_date, cadence,
  included_minutes, fee_cents, currency, external_id, allowance_type
)
values (
  'd1500000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'Source Contract',
  'active',
  '2026-08-01',
  'monthly',
  0,
  50000,
  'AUD',
  'contract-1',
  'fixed_value'
);

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  full_snapshot, requested_entities, lease_token, lease_owner,
  lease_acquired_at, lease_expires_at, heartbeat_at, started_at
)
values (
  'd1300000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'source-parity-period-run',
  'running',
  true,
  array['contract_periods'],
  'd1600000-0000-4000-8000-000000000001',
  'pg-tap',
  now(),
  now() + interval '10 minutes',
  now(),
  now()
);

insert into public.source_records (
  organization_id, provider, source_account_id, source_entity_type,
  source_record_id, destination_schema, destination_table,
  destination_record_id, first_seen_run_id, last_seen_run_id,
  source_updated_at, payload_sha256, metadata
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'accelo',
  'p11creativeinc',
  'contracts',
  'contract-1',
  'public',
  'retainers',
  'd1500000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  '2026-08-11T20:00:00Z',
  repeat('a', 64),
  '{"transformer_version":2}'
);

select public.set_integration_authority_state(
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'contract_periods',
  'disabled',
  'shadow',
  null,
  'Test source periods',
  'd1100000-0000-4000-8000-000000000001'
);
select public.set_integration_authority_state(
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'contract_periods',
  'shadow',
  'importing',
  null,
  'Import source periods',
  'd1100000-0000-4000-8000-000000000001'
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id,
  source_updated_at, raw_payload, normalized_payload, transformer_version
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'contract_periods',
  'period-1',
  '2026-08-11T21:00:00Z',
  '{"id":"period-1","currency":"AUD"}',
  '{
    "source_id":"period-1",
    "contract_source_id":"contract-1",
    "period_start":"2026-08-01",
    "period_end":"2026-08-31",
    "status":"open",
    "allowance_type":"fixed_value",
    "included_minutes":0,
    "included_value_cents":100000,
    "consumed_minutes":120,
    "consumed_value_cents":42000,
    "rollover_minutes":30,
    "rollover_value_cents":10000,
    "overage_minutes":15,
    "overage_value_cents":5000,
    "fee_cents":50000,
    "currency":"AUD",
    "template_revision":2
  }',
  3
);

select extensions.is(
  (
    private.promote_accelo_pull_run(
      'd1300000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001'
    ) ->> 'mapped'
  )::bigint,
  1::bigint,
  'contract periods promote as first-class source resources'
);

select extensions.ok(
  (
    select
      external_id = 'period-1'
      and currency = 'AUD'
      and consumed_minutes = 120
      and consumed_value_cents = 42000
      and rollover_minutes = 30
      and rollover_value_cents = 10000
      and overage_minutes = 15
      and overage_value_cents = 5000
    from public.retainer_periods
    where retainer_id = 'd1500000-0000-4000-8000-000000000001'
  ),
  'period allowance consumption rollover overage and currency are faithful'
);

select extensions.ok(
  (
    select
      metadata ? 'field_sha256'
      and metadata ? 'relationship_sha256'
    from public.source_records
    where source_entity_type = 'contract_periods'
      and source_record_id = 'period-1'
  ),
  'mapping captures field and relationship hashes'
);

select extensions.is(
  (
    public.finalize_accelo_pull_run(
      'd1300000-0000-4000-8000-000000000001',
      'd1600000-0000-4000-8000-000000000001',
      '{}',
      '{
        "truncated":false,
        "resources":{
          "contract_periods":{"complete":true}
        }
      }'
    )
  ).status,
  'succeeded',
  'period counts relationships hashes and financials reconcile'
);

select extensions.ok(
  (
    select
      latest_unique_staged_count = 1
      and mapped_count = 1
      and destination_count = 1
      and field_hash_mismatch_count = 0
      and relationship_mismatch_count = 0
      and financial_source = financial_destination
    from public.accelo_pull_reconciliations
    where run_id = 'd1300000-0000-4000-8000-000000000001'
  ),
  'reconciliation captures complete deterministic evidence'
);

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  full_snapshot, requested_entities, lease_token, lease_owner,
  lease_acquired_at, lease_expires_at, heartbeat_at, started_at
)
values (
  'd1300000-0000-4000-8000-000000000002',
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'source-parity-recovery-run',
  'running',
  false,
  array['activities'],
  'd1600000-0000-4000-8000-000000000002',
  'pg-tap',
  now(),
  now() + interval '10 minutes',
  now(),
  now()
);

select public.set_integration_authority_state(
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'activities',
  'disabled',
  'shadow',
  null,
  'Test activity recovery',
  'd1100000-0000-4000-8000-000000000001'
);
select public.set_integration_authority_state(
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'activities',
  'shadow',
  'importing',
  null,
  'Import activity recovery',
  'd1100000-0000-4000-8000-000000000001'
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id,
  source_updated_at, raw_payload, normalized_payload, transformer_version
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000002',
  'activities',
  'activity-orphan',
  '2026-08-11T22:00:00Z',
  '{"id":"activity-orphan","against_type":"company","against_id":"missing"}',
  '{
    "source_id":"activity-orphan",
    "against_type":"company",
    "against_source_id":"missing",
    "activity_type":"note",
    "subject":"Orphan",
    "occurred_at":"2026-08-11T22:00:00Z"
  }',
  3
);

select private.promote_accelo_pull_run(
  'd1300000-0000-4000-8000-000000000002',
  'd1600000-0000-4000-8000-000000000002'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.claim_accelo_activity_recoveries(
      'd1300000-0000-4000-8000-000000000002',
      'd1600000-0000-4000-8000-000000000002',
      25
    )
  ),
  1::bigint,
  'missing activity parent is claimed for bounded GET recovery'
);

select public.record_accelo_recovery_failure(
  'd1300000-0000-4000-8000-000000000002',
  'd1600000-0000-4000-8000-000000000002',
  (
    select id
    from public.accelo_unresolved_dependencies
    where source_record_id = 'activity-orphan'
  ),
  'source_not_found',
  true
);

select extensions.ok(
  (
    select
      unresolved.resolution_state = 'pending'
      and unresolved.recovery_status = 'exhausted'
      and archive.approval_state = 'pending'
      and archive.raw_payload = stage.raw_payload
    from public.accelo_unresolved_dependencies as unresolved
    join public.accelo_pull_stage as stage
      on stage.id = unresolved.stage_record_id
    join public.accelo_orphan_archive as archive
      on archive.unresolved_id = unresolved.id
    where unresolved.source_record_id = 'activity-orphan'
  ),
  'exhausted recovery remains pending with a lossless orphan archive'
);

select extensions.is(
  (
    public.get_accelo_pending_report(
      'd1200000-0000-4000-8000-000000000001',
      'p11creativeinc'
    ) ->> 'requires_disposition_count'
  )::bigint,
  1::bigint,
  'pending report deterministically identifies manual dispositions'
);

select public.set_accelo_unresolved_disposition(
  (
    select id
    from public.accelo_unresolved_dependencies
    where source_record_id = 'activity-orphan'
  ),
  'archive',
  'd1100000-0000-4000-8000-000000000001',
  'Administrator approves preserving this unavailable source orphan'
);

select extensions.ok(
  (
    select
      unresolved.resolution_state = 'approved_exclusion'
      and archive.approval_state = 'approved'
      and archive.approved_by = 'd1100000-0000-4000-8000-000000000001'
    from public.accelo_unresolved_dependencies as unresolved
    join public.accelo_orphan_archive as archive
      on archive.unresolved_id = unresolved.id
    where unresolved.source_record_id = 'activity-orphan'
  ),
  'business exception requires explicit administrator archive approval'
);

insert into public.accelo_pull_runs (
  id, organization_id, source_account_id, idempotency_key, status,
  full_snapshot, requested_entities, lease_token, lease_owner,
  lease_acquired_at, lease_expires_at, heartbeat_at, started_at
)
values (
  'd1300000-0000-4000-8000-000000000003',
  'd1200000-0000-4000-8000-000000000001',
  'p11creativeinc',
  'source-parity-deletion-run',
  'running',
  true,
  array['contract_periods'],
  'd1600000-0000-4000-8000-000000000003',
  'pg-tap',
  now(),
  now() + interval '10 minutes',
  now(),
  now()
);

insert into public.accelo_pull_stage (
  organization_id, run_id, entity_type, source_record_id,
  source_updated_at, source_deleted, raw_payload, normalized_payload,
  transformer_version
)
values (
  'd1200000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000003',
  'contract_periods',
  'period-1',
  '2026-08-12T01:00:00Z',
  true,
  '{"id":"period-1","standing":"retired"}',
  '{
    "source_id":"period-1",
    "source_deleted":true,
    "contract_source_id":"contract-1",
    "period_start":"2026-08-01",
    "period_end":"2026-08-31"
  }',
  3
);

select extensions.is(
  (
    public.finalize_accelo_pull_run(
      'd1300000-0000-4000-8000-000000000003',
      'd1600000-0000-4000-8000-000000000003',
      '{}',
      '{
        "truncated":false,
        "resources":{
          "contract_periods":{"expected_count":1,"complete":true}
        }
      }'
    )
  ).status,
  'succeeded',
  'explicit source retirement reconciles without deleting destination history'
);

select extensions.ok(
  (
    select
      mapping.source_deleted
      and mapping.retired_at is not null
      and mapping.metadata ? 'source_retired_at'
      and exists (
        select 1
        from public.retainer_periods as period
        where period.id = mapping.destination_record_id::uuid
      )
    from public.source_records as mapping
    where mapping.source_entity_type = 'contract_periods'
      and mapping.source_record_id = 'period-1'
  ),
  'source retirement metadata is preserved while destination remains lossless'
);

select * from extensions.finish();
rollback;
