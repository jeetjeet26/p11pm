create or replace function private.accelo_destination_uuid(
  target_organization_id uuid,
  target_source_account_id text,
  target_entity_type text,
  target_source_record_id text,
  target_destination_table text default null
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mapping.destination_record_id::uuid
  from public.source_records as mapping
  where mapping.organization_id = target_organization_id
    and mapping.provider = 'accelo'
    and mapping.source_account_id = target_source_account_id
    and mapping.source_entity_type = target_entity_type
    and mapping.source_record_id = target_source_record_id
    and (
      target_destination_table is null
      or mapping.destination_table = target_destination_table
    )
    and not mapping.source_deleted
  limit 1;
$$;

revoke all on function private.accelo_destination_uuid(
  uuid, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.accelo_destination_uuid(
  uuid, text, text, text, text
) to service_role;

create or replace function private.promote_accelo_pull_run(
  target_run_id uuid,
  target_lease_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  run public.accelo_pull_runs%rowtype;
  stage public.accelo_pull_stage%rowtype;
  payload jsonb;
  destination_id uuid;
  client_id uuid;
  contact_id uuid;
  project_id uuid;
  profile_id uuid;
  retainer_id uuid;
  invoice_id uuid;
  list_id uuid;
  rate_cents bigint;
  cost_rate_cents bigint;
  activity_entry_date date;
  mapped_count bigint := 0;
  quarantined_count bigint := 0;
  skipped_count bigint := 0;
  authority_state text;
begin
  select item.* into run
  from public.accelo_pull_runs as item
  where item.id = target_run_id
    and item.status = 'running'
    and item.lease_token = target_lease_token
    and item.lease_expires_at > statement_timestamp()
  for update;
  if run.id is null then
    raise object_not_in_prerequisite_state using
      message = 'Accelo pull lease is missing, expired, or owned elsewhere.';
  end if;

  for stage in
    select item.*
    from public.accelo_pull_stage as item
    join public.accelo_pull_runs as source_run on source_run.id = item.run_id
    where source_run.organization_id = run.organization_id
      and source_run.provider = 'accelo'
      and source_run.source_account_id = run.source_account_id
      and source_run.status in ('running', 'partial', 'succeeded')
      and item.entity_type = any(run.requested_entities)
      and not exists (
        select 1
        from public.source_records as mapping
        where mapping.organization_id = run.organization_id
          and mapping.provider = 'accelo'
          and mapping.source_account_id = run.source_account_id
          and mapping.source_entity_type = item.entity_type
          and mapping.source_record_id = item.source_record_id
          and mapping.payload_sha256 = item.payload_sha256
          and not mapping.source_deleted
      )
    order by
      array_position(
        array[
          'companies', 'contacts', 'staff', 'affiliations', 'jobs',
          'milestones', 'tasks', 'contracts', 'activities', 'invoices',
          'payments', 'prospects', 'issues'
        ]::text[],
        item.entity_type
      ),
      item.staged_at,
      item.id
  loop
    payload := stage.normalized_payload;
    if payload is null or stage.source_deleted then
      skipped_count := skipped_count + 1;
      continue;
    end if;
    if stage.entity_type = 'activities'
      and payload ->> 'against_source_id' like '%/%'
    then
      payload := jsonb_set(
        payload,
        '{against_source_id}',
        to_jsonb(regexp_replace(payload ->> 'against_source_id', '^.*/', ''))
      );
    end if;
    if stage.entity_type = 'contract_periods'
      and payload ->> 'contract_source_id' like '%/%'
    then
      payload := jsonb_set(
        payload,
        '{contract_source_id}',
        to_jsonb(regexp_replace(payload ->> 'contract_source_id', '^.*/', ''))
      );
    end if;

    select state.state into authority_state
    from public.integration_authority_states as state
    where state.organization_id = run.organization_id
      and state.provider = 'accelo'
      and state.source_account_id = run.source_account_id
      and state.entity_type = stage.entity_type;
    if authority_state in ('disabled', 'supabase_authoritative', 'audit_only') then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    begin
      destination_id := null;
      client_id := null;
      contact_id := null;
      project_id := null;
      profile_id := null;
      retainer_id := null;
      invoice_id := null;

      case stage.entity_type
        when 'companies' then
          insert into public.clients (
            organization_id, name, status, phone, website, billing_address,
            default_currency, external_id, source_updated_at, source_payload
          )
          values (
            run.organization_id,
            payload ->> 'name',
            coalesce(payload ->> 'status', 'active'),
            nullif(payload ->> 'phone', ''),
            nullif(payload ->> 'website', ''),
            coalesce(payload -> 'billing_address', '{}'::jsonb),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            stage.source_record_id,
            stage.source_updated_at,
            stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            name = excluded.name,
            status = excluded.status,
            phone = excluded.phone,
            website = excluded.website,
            billing_address = excluded.billing_address,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;

        when 'contacts' then
          insert into public.contacts (
            organization_id, first_name, last_name, email, phone, title,
            status, external_id, source_updated_at, source_payload
          )
          values (
            run.organization_id,
            coalesce(nullif(payload ->> 'first_name', ''), 'Unknown'),
            coalesce(payload ->> 'last_name', ''),
            nullif(payload ->> 'email', ''),
            nullif(payload ->> 'phone', ''),
            nullif(payload ->> 'title', ''),
            coalesce(payload ->> 'status', 'active'),
            stage.source_record_id,
            stage.source_updated_at,
            stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            email = excluded.email,
            phone = excluded.phone,
            title = excluded.title,
            status = excluded.status,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;

        when 'staff' then
          select item.id into destination_id
          from public.profiles as item
          where item.organization_id = run.organization_id
            and (
              item.accelo_staff_id = stage.source_record_id
              or lower(item.email) = lower(payload ->> 'email')
            )
          order by (item.accelo_staff_id = stage.source_record_id) desc
          limit 1;
          if destination_id is null then
            raise foreign_key_violation using message = 'staff_crosswalk_missing';
          end if;
          update public.profiles
          set
            accelo_staff_id = stage.source_record_id,
            timezone = coalesce(nullif(payload ->> 'timezone', ''), timezone),
            updated_at = now()
          where id = destination_id;

        when 'affiliations' then
          client_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'companies',
            payload ->> 'company_source_id', 'clients'
          );
          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          if client_id is null or contact_id is null then
            raise foreign_key_violation using message = 'affiliation_parent_missing';
          end if;
          insert into public.client_contacts (
            organization_id, client_id, contact_id, role, receives_invoices,
            external_id, position, standing, source_updated_at, source_payload
          )
          values (
            run.organization_id, client_id, contact_id,
            nullif(payload ->> 'role', ''),
            coalesce((payload ->> 'receives_invoices')::boolean, false),
            stage.source_record_id, nullif(payload ->> 'position', ''),
            nullif(payload ->> 'standing', ''), stage.source_updated_at,
            stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            client_id = excluded.client_id,
            contact_id = excluded.contact_id,
            role = excluded.role,
            receives_invoices = excluded.receives_invoices,
            position = excluded.position,
            standing = excluded.standing,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload
          returning id into destination_id;

        when 'jobs' then
          client_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'companies',
            payload ->> 'company_source_id', 'clients'
          );
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'manager_source_id', 'profiles'
          );
          insert into public.projects (
            organization_id, name, code, client_id, client_name, status,
            owner_id, start_date, due_date, currency, billing_type,
            hourly_rate_cents, commercial_currency, accelo_job_id,
            source_updated_at, source_payload
          )
          values (
            run.organization_id,
            payload ->> 'title',
            left(
              regexp_replace(
                upper('ACC-' || stage.source_record_id),
                '[^A-Z0-9-]+', '-', 'g'
              ),
              32
            ),
            client_id,
            (select name from public.clients where id = client_id),
            coalesce(payload ->> 'status', 'active'),
            profile_id,
            nullif(payload ->> 'start_date', '')::date,
            nullif(payload ->> 'due_date', '')::date,
            'USD',
            coalesce(payload ->> 'billing_type', 'time_and_materials'),
            nullif(payload ->> 'hourly_rate_cents', '')::bigint,
            'USD',
            stage.source_record_id,
            stage.source_updated_at,
            stage.raw_payload
          )
          on conflict (organization_id, accelo_job_id)
            where accelo_job_id is not null
          do update set
            name = excluded.name,
            client_id = excluded.client_id,
            client_name = excluded.client_name,
            status = excluded.status,
            owner_id = excluded.owner_id,
            start_date = excluded.start_date,
            due_date = excluded.due_date,
            billing_type = excluded.billing_type,
            hourly_rate_cents = excluded.hourly_rate_cents,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;

        when 'contracts' then
          client_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'companies',
            payload ->> 'company_source_id', 'clients'
          );
          if client_id is null then
            raise foreign_key_violation using message = 'contract_company_missing';
          end if;
          insert into public.retainers (
            organization_id, client_id, name, status, start_date, end_date,
            cadence, included_minutes, fee_cents, overage_rate_cents, currency,
            external_id, contract_type, allowance_type, allowance_value_cents,
            overage_policy, auto_renew, renewal_days, source_updated_at,
            source_payload
          )
          values (
            run.organization_id, client_id, payload ->> 'title',
            coalesce(payload ->> 'status', 'draft'),
            coalesce(nullif(payload ->> 'start_date', '')::date, current_date),
            nullif(payload ->> 'end_date', '')::date,
            coalesce(payload ->> 'cadence', 'monthly'),
            coalesce((payload ->> 'included_minutes')::integer, 0),
            coalesce((payload ->> 'fee_cents')::bigint, 0),
            nullif(payload ->> 'overage_rate_cents', '')::bigint,
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            stage.source_record_id, nullif(payload ->> 'contract_type', ''),
            coalesce(payload ->> 'allowance_type', 'fixed_value'),
            nullif(payload ->> 'allowance_value_cents', '')::bigint,
            coalesce(payload ->> 'overage_policy', 'do_not_bill'),
            coalesce((payload ->> 'auto_renew')::boolean, false),
            nullif(payload ->> 'renewal_days', '')::integer,
            stage.source_updated_at, stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            client_id = excluded.client_id,
            name = excluded.name,
            status = excluded.status,
            start_date = excluded.start_date,
            end_date = excluded.end_date,
            cadence = excluded.cadence,
            included_minutes = excluded.included_minutes,
            fee_cents = excluded.fee_cents,
            overage_rate_cents = excluded.overage_rate_cents,
            contract_type = excluded.contract_type,
            allowance_type = excluded.allowance_type,
            allowance_value_cents = excluded.allowance_value_cents,
            overage_policy = excluded.overage_policy,
            auto_renew = excluded.auto_renew,
            renewal_days = excluded.renewal_days,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;
          perform private.ensure_retainer_periods(destination_id, current_date);
          update public.retainer_periods as period
          set
            allowance_type = coalesce(
              payload ->> 'allowance_type',
              period.allowance_type
            ),
            included_value_cents = coalesce(
              nullif(payload ->> 'allowance_value_cents', '')::bigint,
              period.included_value_cents,
              period.fee_cents
            ),
            source_updated_at = stage.source_updated_at,
            source_payload = jsonb_build_object(
              'contract_source_id',
              stage.source_record_id,
              'period_template_source_id',
              payload ->> 'period_template_source_id',
              'generated_from_contract_template',
              true
            )
          where period.retainer_id = destination_id;
          project_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'jobs',
            payload ->> 'job_source_id', 'projects'
          );
          if project_id is not null then
            insert into public.retainer_projects (
              organization_id, retainer_id, project_id
            )
            values (run.organization_id, destination_id, project_id)
            on conflict (retainer_id, project_id) do nothing;
          end if;

        when 'activities' then
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'staff_source_id', 'profiles'
          );
          if payload ->> 'against_type' = 'job' then
            project_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'jobs',
              payload ->> 'against_source_id', 'projects'
            );
            select item.client_id into client_id
            from public.projects as item
            where item.id = project_id;
          elsif payload ->> 'against_type' = 'contract' then
            retainer_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'contracts',
              payload ->> 'against_source_id', 'retainers'
            );
            select item.client_id into client_id
            from public.retainers as item where item.id = retainer_id;
          elsif payload ->> 'against_type' = 'contract_period' then
            destination_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'contract_periods',
              payload ->> 'against_source_id', 'retainer_periods'
            );
            select period.client_id, project.id
              into client_id, project_id
            from public.retainer_periods as period
            left join public.retainer_projects as binding
              on binding.retainer_id = period.retainer_id
            left join public.projects as project
              on project.id = binding.project_id
            where period.id = destination_id
            order by project.id
            limit 1;
          elsif payload ->> 'against_type' = 'company' then
            client_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'companies',
              payload ->> 'against_source_id', 'clients'
            );
          elsif payload ->> 'against_type' = 'affiliation' then
            destination_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'affiliations',
              payload ->> 'against_source_id', 'client_contacts'
            );
            select item.client_id into client_id
            from public.client_contacts as item
            where item.id = destination_id;
          elsif payload ->> 'against_type' = 'account_invoice' then
            invoice_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'invoices',
              payload ->> 'against_source_id', 'invoices'
            );
            select item.client_id, item.project_id into client_id, project_id
            from public.invoices as item
            where item.id = invoice_id;
          elsif payload ->> 'against_type' = 'prospect' then
            destination_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'prospects',
              payload ->> 'against_source_id', 'prospects'
            );
            select item.client_id into client_id
            from public.prospects as item
            where item.id = destination_id;
          elsif payload ->> 'against_type' = 'milestone' then
            destination_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'milestones',
              payload ->> 'against_source_id', 'milestones'
            );
            select item.project_id, project.client_id
              into project_id, client_id
            from public.milestones as item
            join public.projects as project on project.id = item.project_id
            where item.id = destination_id;
          elsif payload ->> 'against_type' = 'issue' then
            destination_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'issues',
              payload ->> 'against_source_id', 'todos'
            );
            select item.project_id, project.client_id
              into project_id, client_id
            from public.todos as item
            join public.projects as project on project.id = item.project_id
            where item.id = destination_id;
          end if;
          if client_id is null then
            raise foreign_key_violation using message = 'activity_client_missing';
          end if;
          insert into public.client_activities (
            organization_id, client_id, project_id, activity_type, subject,
            body, occurred_at, duration_minutes, external_id, source,
            source_updated_at, source_payload
          )
          values (
            run.organization_id, client_id, project_id,
            coalesce(payload ->> 'activity_type', 'note'),
            left(coalesce(nullif(payload ->> 'subject', ''), 'Accelo activity'), 200),
            nullif(payload ->> 'body', ''),
            coalesce((payload ->> 'occurred_at')::timestamptz, now()),
            nullif(payload ->> 'duration_minutes', '')::integer,
            stage.source_record_id, 'accelo', stage.source_updated_at,
            stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            client_id = excluded.client_id,
            project_id = excluded.project_id,
            activity_type = excluded.activity_type,
            subject = excluded.subject,
            body = excluded.body,
            occurred_at = excluded.occurred_at,
            duration_minutes = excluded.duration_minutes,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;
          if project_id is not null
            and profile_id is not null
            and coalesce((payload ->> 'duration_minutes')::integer, 0) > 0
          then
            activity_entry_date :=
              coalesce((payload ->> 'occurred_at')::timestamptz, now())::date;
            select
              coalesce(
                nullif(payload ->> 'billing_rate_cents', '')::bigint,
                rate.rate_cents,
                18000
              ),
              coalesce(rate.cost_rate_cents, 7000)
            into rate_cents, cost_rate_cents
            from (select 1) as seed
            left join lateral (
              select item.rate_cents, item.cost_rate_cents
              from public.staff_billing_rates as item
              where item.organization_id = run.organization_id
                and item.profile_id = profile_id
                and item.effective_from <= activity_entry_date
                and (
                  item.effective_to is null
                  or item.effective_to >= activity_entry_date
                )
                and (
                  item.project_id = project_id
                  or item.project_id is null
                )
                and (item.client_id = client_id or item.client_id is null)
              order by
                (item.project_id is not null) desc,
                (item.client_id is not null) desc,
                item.effective_from desc,
                item.id
              limit 1
            ) as rate on true;
            insert into public.time_entries (
              organization_id, client_id, project_id, profile_id, entry_date,
              minutes, description, billable, status, billing_rate_cents,
              cost_rate_cents, currency, approved_by, approved_at, source,
              external_id, source_updated_at, source_payload
            )
            values (
              run.organization_id, client_id, project_id, profile_id,
              activity_entry_date,
              (payload ->> 'duration_minutes')::integer,
              left(
                coalesce(nullif(payload ->> 'subject', ''), 'Accelo activity'),
                1000
              ),
              coalesce((payload ->> 'billable_seconds')::integer, 0) > 0,
              'approved', rate_cents, cost_rate_cents, 'USD',
              profile_id,
              coalesce((payload ->> 'occurred_at')::timestamptz, now()),
              'import', stage.source_record_id, stage.source_updated_at,
              stage.raw_payload
            )
            on conflict (organization_id, external_id)
              where external_id is not null
            do update set
              minutes = excluded.minutes,
              description = excluded.description,
              billable = excluded.billable,
              billing_rate_cents = excluded.billing_rate_cents,
              cost_rate_cents = excluded.cost_rate_cents,
              source_updated_at = excluded.source_updated_at,
              source_payload = excluded.source_payload,
              updated_at = now()
            where public.time_entries.status <> 'invoiced';
          end if;

        when 'invoices' then
          if payload ->> 'against_type' = 'job' then
            project_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'jobs',
              payload ->> 'against_source_id', 'projects'
            );
            select item.client_id into client_id
            from public.projects as item where item.id = project_id;
          elsif payload ->> 'against_type' = 'contract' then
            retainer_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'contracts',
              payload ->> 'against_source_id', 'retainers'
            );
            select item.client_id into client_id
            from public.retainers as item where item.id = retainer_id;
          elsif payload ->> 'against_type' = 'company' then
            client_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'companies',
              payload ->> 'against_source_id', 'clients'
            );
          elsif payload ->> 'against_type' = 'issue' then
            destination_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'issues',
              payload ->> 'against_source_id', 'todos'
            );
            select item.project_id, project.client_id
              into project_id, client_id
            from public.todos as item
            join public.projects as project on project.id = item.project_id
            where item.id = destination_id;
          end if;
          if client_id is null then
            raise foreign_key_violation using message = 'invoice_client_missing';
          end if;
          insert into public.invoices (
            organization_id, client_id, project_id, invoice_number, subject,
            status, issue_date, issued_at, due_date, currency, subtotal_cents,
            tax_cents, paid_cents, notes, external_id, source_updated_at,
            source_payload
          )
          values (
            run.organization_id, client_id, project_id,
            left(payload ->> 'invoice_number', 64),
            coalesce(payload ->> 'subject', 'Professional services'),
            case
              when coalesce((payload ->> 'outstanding_cents')::bigint, 0) = 0
                then 'paid'
              when coalesce((payload ->> 'outstanding_cents')::bigint, 0)
                < coalesce((payload ->> 'amount_cents')::bigint, 0)
                then 'partially_paid'
              else 'issued'
            end,
            coalesce(nullif(payload ->> 'issue_date', '')::date, current_date),
            coalesce(
              nullif(payload ->> 'issue_date', '')::date,
              current_date
            )::timestamptz,
            coalesce(
              nullif(payload ->> 'due_date', '')::date,
              coalesce(nullif(payload ->> 'issue_date', '')::date, current_date) + 30
            ),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            greatest(
              coalesce((payload ->> 'amount_cents')::bigint, 0)
                - coalesce((payload ->> 'tax_cents')::bigint, 0),
              0
            ),
            coalesce((payload ->> 'tax_cents')::bigint, 0),
            greatest(
              coalesce((payload ->> 'amount_cents')::bigint, 0)
                - coalesce((payload ->> 'outstanding_cents')::bigint, 0),
              0
            ),
            nullif(payload ->> 'notes', ''),
            stage.source_record_id, stage.source_updated_at, stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            client_id = excluded.client_id,
            project_id = excluded.project_id,
            invoice_number = excluded.invoice_number,
            subject = excluded.subject,
            status = excluded.status,
            issue_date = excluded.issue_date,
            issued_at = excluded.issued_at,
            due_date = excluded.due_date,
            subtotal_cents = excluded.subtotal_cents,
            tax_cents = excluded.tax_cents,
            paid_cents = excluded.paid_cents,
            notes = excluded.notes,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload
          returning id into destination_id;

        when 'payments' then
          invoice_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'invoices',
            payload ->> 'against_source_id', 'invoices'
          );
          select item.client_id into client_id
          from public.invoices as item where item.id = invoice_id;
          if invoice_id is null or client_id is null then
            raise foreign_key_violation using message = 'payment_invoice_missing';
          end if;
          insert into public.payments (
            organization_id, client_id, amount_cents, currency, payment_date,
            method, reference, status, idempotency_key, external_id,
            source_updated_at, source_payload
          )
          values (
            run.organization_id, client_id,
            coalesce((payload ->> 'amount_cents')::bigint, 0),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            coalesce((payload ->> 'paid_at')::timestamptz, now())::date,
            'other', nullif(payload ->> 'reference', ''), 'received',
            'accelo:' || run.source_account_id || ':' || stage.source_record_id,
            stage.source_record_id, stage.source_updated_at, stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            amount_cents = excluded.amount_cents,
            payment_date = excluded.payment_date,
            reference = excluded.reference,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload
          returning id into destination_id;
          insert into public.payment_allocations (
            organization_id, client_id, payment_id, invoice_id, amount_cents
          )
          values (
            run.organization_id, client_id, destination_id, invoice_id,
            least(
              coalesce((payload ->> 'amount_cents')::bigint, 0),
              (select total_cents from public.invoices where id = invoice_id)
            )
          )
          on conflict (payment_id, invoice_id) do update set
            amount_cents = excluded.amount_cents;

        when 'prospects' then
          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          select link.client_id into client_id
          from public.client_contacts as link
          where link.contact_id = contact_id
          order by link.is_primary desc, link.created_at
          limit 1;
          if client_id is null then
            raise foreign_key_violation using message = 'prospect_client_missing';
          end if;
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'owner_source_id', 'profiles'
          );
          insert into public.prospects (
            organization_id, client_id, primary_contact_id, owner_id,
            external_id, title, stage, probability, value_cents, currency,
            next_action, next_action_at, closed_at, source_updated_at,
            source_payload
          )
          values (
            run.organization_id, client_id, contact_id, profile_id,
            stage.source_record_id, payload ->> 'title',
            coalesce(payload ->> 'stage', 'lead'),
            coalesce((payload ->> 'probability')::integer, 20),
            coalesce((payload ->> 'value_cents')::bigint, 0),
            coalesce(nullif(payload ->> 'currency', ''), 'USD')::char(3),
            nullif(payload ->> 'next_action', ''),
            nullif(payload ->> 'next_action_at', '')::timestamptz,
            case
              when payload ->> 'stage' in ('won', 'lost')
                then coalesce(
                  nullif(payload ->> 'closed_at', '')::timestamptz,
                  now()
                )
              else null
            end,
            stage.source_updated_at, stage.raw_payload
          )
          on conflict (organization_id, external_id)
            where external_id is not null
          do update set
            client_id = excluded.client_id,
            primary_contact_id = excluded.primary_contact_id,
            owner_id = excluded.owner_id,
            title = excluded.title,
            stage = excluded.stage,
            probability = excluded.probability,
            value_cents = excluded.value_cents,
            next_action = excluded.next_action,
            next_action_at = excluded.next_action_at,
            closed_at = excluded.closed_at,
            source_updated_at = excluded.source_updated_at,
            source_payload = excluded.source_payload,
            updated_at = now()
          returning id into destination_id;

        when 'milestones' then
          project_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'jobs',
            payload ->> 'job_source_id', 'projects'
          );
          if project_id is null then
            raise foreign_key_violation using message = 'milestone_job_missing';
          end if;
          insert into public.milestones (
            project_id, name, description, status, due_date, completed_at,
            accelo_milestone_id, accelo_payload, source_updated_at
          )
          values (
            project_id, payload ->> 'name', nullif(payload ->> 'description', ''),
            coalesce(payload ->> 'status', 'upcoming'),
            nullif(payload ->> 'due_date', '')::date,
            nullif(payload ->> 'completed_at', '')::timestamptz,
            stage.source_record_id, stage.raw_payload, stage.source_updated_at
          )
          on conflict (project_id, accelo_milestone_id)
            where accelo_milestone_id is not null
          do update set
            name = excluded.name,
            description = excluded.description,
            status = excluded.status,
            due_date = excluded.due_date,
            completed_at = excluded.completed_at,
            accelo_payload = excluded.accelo_payload,
            source_updated_at = excluded.source_updated_at,
            updated_at = now()
          returning id into destination_id;

        when 'tasks' then
          project_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'jobs',
            payload ->> 'job_source_id', 'projects'
          );
          if project_id is null then
            raise foreign_key_violation using message = 'task_job_missing';
          end if;
          insert into public.todo_lists (project_id, title, position)
          values (project_id, 'Accelo Tasks', 0)
          on conflict (project_id, title) do update set title = excluded.title
          returning id into list_id;
          profile_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'staff',
            payload ->> 'assigned_staff_source_id', 'profiles'
          );
          insert into public.todos (
            project_id, todo_list_id, title, description, status, assigned_to,
            due_at, completed_at, estimated_minutes, actual_minutes,
            accelo_task_id, sync_status, last_synced_at, accelo_payload,
            source_updated_at
          )
          values (
            project_id, list_id, payload ->> 'title',
            nullif(payload ->> 'description', ''),
            coalesce(payload ->> 'status', 'todo'), profile_id,
            nullif(payload ->> 'due_at', '')::timestamptz,
            nullif(payload ->> 'completed_at', '')::timestamptz,
            nullif(payload ->> 'estimated_minutes', '')::integer,
            nullif(payload ->> 'actual_minutes', '')::integer,
            stage.source_record_id, 'synced', now(), stage.raw_payload,
            stage.source_updated_at
          )
          on conflict (project_id, accelo_task_id)
            where accelo_task_id is not null
          do update set
            title = excluded.title,
            description = excluded.description,
            status = excluded.status,
            assigned_to = excluded.assigned_to,
            due_at = excluded.due_at,
            completed_at = excluded.completed_at,
            estimated_minutes = excluded.estimated_minutes,
            actual_minutes = excluded.actual_minutes,
            sync_status = 'synced',
            last_synced_at = now(),
            accelo_payload = excluded.accelo_payload,
            source_updated_at = excluded.source_updated_at,
            updated_at = now()
          returning id into destination_id;

        when 'issues' then
          client_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'companies',
            payload ->> 'company_source_id', 'clients'
          );
          if client_id is null then
            raise foreign_key_violation using message = 'issue_company_missing';
          end if;
          select item.id into project_id
          from public.projects as item
          where item.organization_id = run.organization_id
            and item.code = left(
              regexp_replace(
                upper('SUP-' || payload ->> 'company_source_id'),
                '[^A-Z0-9-]+', '-', 'g'
              ),
              32
            );
          if project_id is null then
            insert into public.projects (
              organization_id, name, code, client_id, client_name, status,
              billing_type, currency, commercial_currency, description
            )
            select
              run.organization_id,
              client.name || ' Support',
              left(
                regexp_replace(
                  upper('SUP-' || payload ->> 'company_source_id'),
                  '[^A-Z0-9-]+', '-', 'g'
                ),
                32
              ),
              client.id,
              client.name,
              'completed',
              'internal',
              client.default_currency,
              client.default_currency,
              'Historical Accelo support issues. All imported issues are closed.'
            from public.clients as client
            where client.id = client_id
            returning id into project_id;
          end if;
          insert into public.todo_lists (project_id, title, position)
          values (project_id, 'Imported support issues', 0)
          on conflict (project_id, title) do update set title = excluded.title
          returning id into list_id;
          insert into public.todos (
            project_id, todo_list_id, title, description, status, priority,
            due_at, completed_at, accelo_issue_id, sync_status, last_synced_at,
            accelo_payload, source_updated_at, operational_state
          )
          values (
            project_id, list_id, payload ->> 'title',
            nullif(payload ->> 'description', ''),
            coalesce(payload ->> 'status', 'done'),
            coalesce(payload ->> 'priority', 'medium'),
            nullif(payload ->> 'due_at', '')::timestamptz,
            coalesce(
              nullif(payload ->> 'completed_at', '')::timestamptz,
              now()
            ),
            stage.source_record_id, 'synced', now(), stage.raw_payload,
            stage.source_updated_at, 'historical'
          )
          on conflict (project_id, accelo_issue_id)
            where accelo_issue_id is not null
          do update set
            title = excluded.title,
            description = excluded.description,
            priority = excluded.priority,
            due_at = excluded.due_at,
            completed_at = excluded.completed_at,
            sync_status = 'synced',
            last_synced_at = now(),
            accelo_payload = excluded.accelo_payload,
            source_updated_at = excluded.source_updated_at,
            updated_at = now()
          returning id into destination_id;

        else
          raise feature_not_supported using message = 'unsupported_entity';
      end case;

      perform private.map_source_record(
        run.organization_id,
        'accelo',
        run.source_account_id,
        stage.entity_type,
        stage.source_record_id,
        'public',
        case stage.entity_type
          when 'companies' then 'clients'
          when 'contacts' then 'contacts'
          when 'staff' then 'profiles'
          when 'affiliations' then 'client_contacts'
          when 'jobs' then 'projects'
          when 'contracts' then 'retainers'
          when 'activities' then 'client_activities'
          when 'invoices' then 'invoices'
          when 'payments' then 'payments'
          when 'prospects' then 'prospects'
          when 'milestones' then 'milestones'
          when 'tasks' then 'todos'
          when 'issues' then 'todos'
          else stage.entity_type
        end,
        destination_id::text,
        run.id,
        stage.source_updated_at,
        stage.payload_sha256,
        false,
        jsonb_build_object('stage_record_id', stage.id)
      );
      mapped_count := mapped_count + 1;
    exception
      when others then
        insert into public.accelo_pull_quarantine (
          organization_id, run_id, stage_record_id, entity_type,
          source_record_id, reason_code, reason_detail, raw_payload
        )
        values (
          run.organization_id, run.id, stage.id, stage.entity_type,
          stage.source_record_id, 'promotion_failed',
          sqlstate || ':' || sqlerrm, stage.raw_payload
        )
        on conflict do nothing;
        quarantined_count := quarantined_count + 1;
    end;
  end loop;

  update public.accelo_pull_runs
  set
    records_mapped = records_mapped + mapped_count,
    records_quarantined = records_quarantined + quarantined_count,
    heartbeat_at = statement_timestamp()
  where id = run.id;

  return jsonb_build_object(
    'mapped', mapped_count,
    'quarantined', quarantined_count,
    'skipped', skipped_count
  );
end;
$$;

create or replace function public.promote_accelo_pull_run(
  target_run_id uuid,
  target_lease_token uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.promote_accelo_pull_run(
    target_run_id,
    target_lease_token
  );
$$;

revoke all on function private.promote_accelo_pull_run(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.promote_accelo_pull_run(uuid, uuid)
  to service_role;
revoke all on function public.promote_accelo_pull_run(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_accelo_pull_run(uuid, uuid)
  to service_role;
