-- Repair relationship resolution and invoice state normalization in the
-- already-deployed promotion function without duplicating its full body.
do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  );
  if position(
    $marker$payload ->> 'against_type' = 'affiliation'$marker$
      in original_definition
    ) > 0
    and position('status, issue_date, issued_at' in original_definition) > 0
    and position('sqlstate ||' in original_definition) > 0
  then
    return;
  end if;

  updated_definition := original_definition;

  updated_definition := replace(
    updated_definition,
$company_old$          elsif payload ->> 'against_type' = 'company' then
            client_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'companies',
              payload ->> 'against_source_id', 'clients'
            );
          end if;$company_old$,
$company_new$          elsif payload ->> 'against_type' = 'company' then
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
          end if;$company_new$
  );

  updated_definition := replace(
    updated_definition,
$invoice_columns_old$            status, issue_date, due_date, currency, subtotal_cents, tax_cents,
            paid_cents, notes, external_id, source_updated_at, source_payload$invoice_columns_old$,
$invoice_columns_new$            status, issue_date, issued_at, due_date, currency, subtotal_cents,
            tax_cents, paid_cents, notes, external_id, source_updated_at,
            source_payload$invoice_columns_new$
  );

  updated_definition := replace(
    updated_definition,
$invoice_values_old$            end,
            coalesce(nullif(payload ->> 'issue_date', '')::date, current_date),
            coalesce(
              nullif(payload ->> 'due_date', '')::date,$invoice_values_old$,
$invoice_values_new$            end,
            coalesce(nullif(payload ->> 'issue_date', '')::date, current_date),
            coalesce(
              nullif(payload ->> 'issue_date', '')::date,
              current_date
            )::timestamptz,
            coalesce(
              nullif(payload ->> 'due_date', '')::date,$invoice_values_new$
  );

  updated_definition := replace(
    updated_definition,
$invoice_update_old$            issue_date = excluded.issue_date,
            due_date = excluded.due_date,$invoice_update_old$,
$invoice_update_new$            issue_date = excluded.issue_date,
            issued_at = excluded.issued_at,
            due_date = excluded.due_date,$invoice_update_new$
  );

  updated_definition := replace(
    updated_definition,
$diagnostic_old$          stage.source_record_id, 'promotion_failed', sqlstate, stage.raw_payload$diagnostic_old$,
$diagnostic_new$          stage.source_record_id, 'promotion_failed',
          sqlstate || ':' || sqlerrm, stage.raw_payload$diagnostic_new$
  );

  if updated_definition = original_definition then
    raise exception 'Could not apply Accelo promotion mapping repairs.';
  end if;

  execute updated_definition;
end;
$migration$;
