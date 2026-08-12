-- Accelo can carry multiple source affiliations for the same client/contact.
-- Preserve those identities and reconcile them through source_records instead
-- of rejecting them at the destination table.
alter table public.client_contacts
  drop constraint if exists client_contacts_client_id_contact_id_key;
create index if not exists client_contacts_client_contact_idx
  on public.client_contacts (client_id, contact_id);

-- Let the milestone upsert infer a non-partial arbiter reliably from PL/pgSQL.
create unique index if not exists milestones_project_accelo_id_key
  on public.milestones (project_id, accelo_milestone_id);

do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.promote_accelo_pull_run(uuid,uuid)'::regprocedure
  ) into definition;

  updated_definition := replace(
    definition,
$old$    if stage.entity_type = 'activities'
      and payload ->> 'against_source_id' like '%/%'
    then
      payload := jsonb_set(
        payload,
        '{against_source_id}',
        to_jsonb(regexp_replace(payload ->> 'against_source_id', '^.*/', ''))
      );
    end if;$old$,
$new$    if stage.entity_type = 'activities'
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
    end if;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$          elsif payload ->> 'against_type' = 'company' then
            client_id := private.accelo_destination_uuid($old$,
$new$          elsif payload ->> 'against_type' = 'contract_period' then
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
            client_id := private.accelo_destination_uuid($new$
  );

  if position('contract_source_id'', ''^.*/' in updated_definition) = 0
     or position(
       'against_type'' = ''contract_period''' in updated_definition
     ) = 0
  then
    raise exception 'Unable to repair Accelo parent promotion.';
  end if;

  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '90s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '95s';
