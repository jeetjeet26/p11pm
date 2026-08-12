begin;

select extensions.plan(12);

set local session_replication_role = replica;
insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  'ac100000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'accelo-foundation-manager@example.com',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  'ac200000-0000-4000-8000-000000000001',
  'Accelo pull foundation test',
  'accelo-pull-foundation-test'
);

insert into public.profiles (
  id,
  organization_id,
  email,
  full_name,
  role,
  status
)
values (
  'ac100000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'accelo-foundation-manager@example.com',
  'Accelo Foundation Manager',
  'admin',
  'active'
);

insert into public.clients (
  id,
  organization_id,
  name,
  default_currency,
  payment_terms_days
)
values (
  'ac400000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'Accelo Foundation Client',
  'USD',
  30
);

insert into public.projects (
  id,
  organization_id,
  client_id,
  name,
  code,
  client_name,
  status
)
values (
  'ac300000-0000-4000-8000-000000000001',
  'ac200000-0000-4000-8000-000000000001',
  'ac400000-0000-4000-8000-000000000001',
  'Accelo Foundation Project',
  'ACC-FOUNDATION',
  'Accelo Foundation Client',
  'active'
);

set local role service_role;

create temporary table accelo_test_run as
select run.*
from public.start_accelo_pull_run(
  'ac200000-0000-4000-8000-000000000001',
  'accelo-account-001',
  'accelo-foundation-run-001',
  array['projects']::text[],
  true,
  '{"projects":1}'::jsonb,
  '{}'::jsonb,
  'pgTAP worker',
  300
) as run;

select extensions.is(
  (select direction from accelo_test_run),
  'pull',
  'Accelo run semantics are pull-only'
);

create temporary table accelo_test_stage as
select stage.*
from public.stage_accelo_pull_record(
  (select id from accelo_test_run),
  (select lease_token from accelo_test_run),
  'projects',
  'accelo-project-001',
  '{"id":"accelo-project-001","title":"Foundation"}'::jsonb,
  '{"name":"Foundation"}'::jsonb,
  '2026-08-11 12:00:00+00',
  false
) as stage;

select extensions.is(
  (
    public.stage_accelo_pull_record(
      (select id from accelo_test_run),
      (select lease_token from accelo_test_run),
      'projects',
      'accelo-project-001',
      '{"id":"accelo-project-001","title":"Foundation"}'::jsonb,
      '{"name":"Foundation"}'::jsonb,
      '2026-08-11 12:00:00+00',
      false
    )
  ).id,
  (select id from accelo_test_stage),
  'staging the same source snapshot is idempotent'
);

create temporary table accelo_test_mapping as
select mapping.*
from public.map_source_record(
  'ac200000-0000-4000-8000-000000000001',
  'accelo',
  'accelo-account-001',
  'projects',
  'accelo-project-001',
  'public',
  'projects',
  'ac300000-0000-4000-8000-000000000001',
  (select id from accelo_test_run),
  '2026-08-11 12:00:00+00',
  repeat('a', 64),
  false,
  '{"fixture":true}'::jsonb
) as mapping;

select extensions.is(
  (
    public.map_source_record(
      'ac200000-0000-4000-8000-000000000001',
      'accelo',
      'accelo-account-001',
      'projects',
      'accelo-project-001',
      'public',
      'projects',
      'ac300000-0000-4000-8000-000000000001',
      (select id from accelo_test_run),
      '2026-08-11 12:00:00+00',
      repeat('a', 64),
      false,
      '{"fixture":true}'::jsonb
    )
  ).id,
  (select id from accelo_test_mapping),
  'source mapping retries retain the original identity'
);

select extensions.throws_ok(
  $$
    insert into public.source_records (
      organization_id,
      provider,
      source_account_id,
      source_entity_type,
      source_record_id,
      destination_schema,
      destination_table,
      destination_record_id
    )
    values (
      'ac200000-0000-4000-8000-000000000001',
      'accelo',
      'accelo-account-001',
      'projects',
      'accelo-project-001',
      'public',
      'projects',
      'ac300000-0000-4000-8000-000000000002'
    )
  $$,
  '23505',
  null,
  'one provider-qualified source identity cannot map twice'
);

select public.map_source_record(
  'ac200000-0000-4000-8000-000000000001',
  'basecamp',
  'basecamp-account-001',
  'projects',
  'accelo-project-001',
  'public',
  'projects',
  'ac300000-0000-4000-8000-000000000002'
);

select extensions.is(
  (
    select count(*)::bigint
    from public.source_records
    where source_record_id = 'accelo-project-001'
  ),
  2::bigint,
  'the same external ID remains distinct across providers'
);

select extensions.is(
  (
    public.finalize_accelo_pull_run(
      (select id from accelo_test_run),
      (select lease_token from accelo_test_run),
      '{"next":"complete"}'::jsonb,
      '{
        "fixture":true,
        "truncated":false,
        "resources":{"projects":{"expected_count":1,"complete":true}}
      }'::jsonb
    )
  ).status,
  'succeeded',
  'a reconciled pull finalizes successfully'
);

select extensions.throws_ok(
  $$
    update public.accelo_pull_stage
    set normalized_payload = '{"name":"Changed"}'::jsonb
    where id = (select id from accelo_test_stage)
  $$,
  '55000',
  'Accelo raw, stage, checkpoint, and quarantine rows are append-only.',
  'staged source records remain immutable after finalization'
);

select extensions.is(
  (
    public.set_integration_authority_state(
      'ac200000-0000-4000-8000-000000000001',
      'accelo-account-001',
      'projects',
      'disabled',
      'shadow',
      null,
      'Foundation shadow transition',
      'ac100000-0000-4000-8000-000000000001'
    )
  ).state,
  'shadow',
  'authority can advance through an allowed transition'
);

select extensions.throws_ok(
  $$
    select public.set_integration_authority_state(
      'ac200000-0000-4000-8000-000000000001',
      'accelo-account-001',
      'projects',
      'shadow',
      'supabase_authoritative',
      null,
      'Unsafe transition test',
      'ac100000-0000-4000-8000-000000000001'
    )
  $$,
  '55000',
  'Invalid integration authority transition from shadow to supabase_authoritative.',
  'authority cannot skip guarded transition states'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"ac100000-0000-4000-8000-000000000001"}',
  true
);

select extensions.is(
  (
    select count(*)::bigint
    from public.accelo_pull_stage
    where organization_id = 'ac200000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'same-organization managers can read staged pull records'
);

select public.create_detailed_invoice(
  'ac400000-0000-4000-8000-000000000001',
  'ac300000-0000-4000-8000-000000000001',
  'ACC-TAX-001',
  'Accelo tax persistence',
  null,
  '{}'::jsonb,
  '2026-08-11',
  '2026-09-10',
  null,
  null,
  'USD',
  '[{
    "item_type":"service",
    "description":"Taxable service",
    "quantity":1,
    "unit_amount_cents":10000
  }]'::jsonb,
  825
);

select extensions.ok(
  (
    select subtotal_cents = 10000
      and tax_cents = 825
      and total_cents = 10825
    from public.invoices
    where invoice_number = 'ACC-TAX-001'
  ),
  'detailed invoice tax persists through derived ledger totals'
);

select extensions.throws_ok(
  $$
    insert into public.source_records (
      organization_id,
      provider,
      source_account_id,
      source_entity_type,
      source_record_id,
      destination_schema,
      destination_table,
      destination_record_id
    )
    values (
      'ac200000-0000-4000-8000-000000000001',
      'accelo',
      'accelo-account-001',
      'projects',
      'authenticated-write',
      'public',
      'projects',
      'ac300000-0000-4000-8000-000000000099'
    )
  $$,
  '42501',
  'permission denied for table source_records',
  'authenticated managers cannot write integration state directly'
);

reset role;

select * from extensions.finish();
rollback;
