begin;

select extensions.plan(9);

select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"00000000-0000-4000-8000-000000000001"}',
  true
);

do $$
begin
  if to_regclass('public.production_audit_events') is null
     or to_regclass('public.tenant_role_security_matrix') is null then
    raise exception 'Production controls tables are missing';
  end if;
end;
$$;
select extensions.pass('production controls schema exists');

select extensions.ok(
  private.stable_json_hash('{"a":1}'::jsonb) =
  encode(extensions.digest('{"a": 1}'::text, 'sha256'), 'hex'),
  'stable json hash uses sha256 digest'
);

set local session_replication_role = replica;
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values (
  'f2100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'production-admin@example.com', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);
set local session_replication_role = origin;

insert into public.organizations (id, name, slug)
values (
  'f2200000-0000-4000-8000-000000000001',
  'Production controls org',
  'production-controls-org'
);

insert into public.profiles (
  id, organization_id, email, full_name, role, status
)
values (
  'f2100000-0000-4000-8000-000000000001',
  'f2200000-0000-4000-8000-000000000001',
  'production-admin@example.com',
  'Production Admin',
  'admin',
  'active'
);

select set_config('request.jwt.claim.sub', 'f2100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  audit public.production_audit_events%rowtype;
begin
  audit := private.record_production_audit(
    'f2200000-0000-4000-8000-000000000001',
    'operator',
    'test_audit',
    'organization',
    'f2200000-0000-4000-8000-000000000001',
    '{"before":true}'::jsonb,
    '{"after":true}'::jsonb,
    'f2300000-0000-4000-8000-000000000001',
    '{}'::jsonb,
    'production-controls-audit',
    'f2100000-0000-4000-8000-000000000001'
  );
  if audit.before_hash is null or audit.after_hash is null then
    raise exception 'Audit hashes were not generated';
  end if;
end;
$$;
select extensions.pass('production audit records immutable hashes');

select extensions.throws_ok(
  $$
    update public.production_audit_events
    set action_type = 'mutated'
    where organization_id = 'f2200000-0000-4000-8000-000000000001'
  $$,
  '55000',
  null,
  'production audit is append-only'
);

select extensions.ok(
  private.role_matrix_allows('finance', 'invoices', 'manager', 'select'),
  'manager can read invoices in security matrix'
);

select extensions.ok(
  not private.role_matrix_allows('finance', 'invoices', 'member', 'select'),
  'member cannot read invoices in security matrix'
);

select extensions.ok(
  private.role_matrix_allows('files', 'file_shares', 'member', 'insert'),
  'member can create file shares in security matrix'
);

do $$
declare
  rate jsonb;
begin
  rate := public.check_file_share_rate_limit(
    repeat('a', 64),
    repeat('b', 64),
    3,
    15,
    30
  );
  if coalesce(rate ->> 'allowed', 'false')::boolean is distinct from true then
    raise exception 'Initial share access attempt should be allowed';
  end if;
  perform public.check_file_share_rate_limit(repeat('a', 64), repeat('b', 64), 3, 15, 30);
  perform public.check_file_share_rate_limit(repeat('a', 64), repeat('b', 64), 3, 15, 30);
  rate := public.check_file_share_rate_limit(repeat('a', 64), repeat('b', 64), 3, 15, 30);
  if coalesce(rate ->> 'allowed', 'true')::boolean then
    raise exception 'Share brute-force limiter should block repeated failures';
  end if;
end;
$$;
select extensions.pass('share brute-force limiter blocks repeated attempts');

do $$
declare
  export_run public.organization_export_runs%rowtype;
begin
  export_run := public.begin_organization_export(
    'f2200000-0000-4000-8000-000000000001',
    'accounting',
    'f2100000-0000-4000-8000-000000000001'
  );
  export_run := public.complete_organization_export(
    export_run.id,
    '{"tables":["invoices"]}'::jsonb,
    encode(extensions.digest('manifest', 'sha256'), 'hex'),
    '{"invoices":0}'::jsonb
  );
  if export_run.status <> 'succeeded' or export_run.checksum_sha256 is null then
    raise exception 'Organization export completion did not persist checksum';
  end if;
end;
$$;
select extensions.pass('organization export records checksum evidence');

select extensions.finish();
rollback;
