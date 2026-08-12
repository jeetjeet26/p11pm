-- Multiple historical Accelo affiliation IDs can represent the same canonical
-- contact/company relationship. Preserve every source ID while sharing one
-- destination affiliation.
alter table public.source_records
  drop constraint
    source_records_organization_id_provider_source_account_id_d_key;

create index source_records_destination_lookup_idx
  on public.source_records (
    organization_id,
    provider,
    source_account_id,
    destination_schema,
    destination_table,
    destination_record_id
  );

with latest_stage as (
  select distinct on (
    stage.organization_id,
    run.source_account_id,
    stage.source_record_id
  )
    stage.organization_id,
    run.source_account_id,
    stage.source_record_id,
    stage.source_updated_at,
    stage.payload_sha256,
    stage.normalized_payload
  from public.accelo_pull_stage as stage
  join public.accelo_pull_runs as run on run.id = stage.run_id
  where stage.entity_type = 'affiliations'
    and stage.normalized_payload is not null
  order by
    stage.organization_id,
    run.source_account_id,
    stage.source_record_id,
    stage.staged_at desc,
    stage.id desc
),
canonical as (
  select
    stage.*,
    link.id as destination_id
  from latest_stage as stage
  join public.source_records as company_mapping
    on company_mapping.organization_id = stage.organization_id
    and company_mapping.provider = 'accelo'
    and company_mapping.source_account_id = stage.source_account_id
    and company_mapping.source_entity_type = 'companies'
    and company_mapping.source_record_id =
      stage.normalized_payload ->> 'company_source_id'
    and not company_mapping.source_deleted
  join public.source_records as contact_mapping
    on contact_mapping.organization_id = stage.organization_id
    and contact_mapping.provider = 'accelo'
    and contact_mapping.source_account_id = stage.source_account_id
    and contact_mapping.source_entity_type = 'contacts'
    and contact_mapping.source_record_id =
      stage.normalized_payload ->> 'contact_source_id'
    and not contact_mapping.source_deleted
  join public.client_contacts as link
    on link.organization_id = stage.organization_id
    and link.client_id = company_mapping.destination_record_id::uuid
    and link.contact_id = contact_mapping.destination_record_id::uuid
)
insert into public.source_records (
  organization_id,
  provider,
  source_account_id,
  source_entity_type,
  source_record_id,
  destination_schema,
  destination_table,
  destination_record_id,
  source_updated_at,
  payload_sha256,
  metadata
)
select
  canonical.organization_id,
  'accelo',
  canonical.source_account_id,
  'affiliations',
  canonical.source_record_id,
  'public',
  'client_contacts',
  canonical.destination_id::text,
  canonical.source_updated_at,
  canonical.payload_sha256,
  jsonb_build_object('canonical_duplicate', true)
from canonical
on conflict (
  organization_id,
  provider,
  source_account_id,
  source_entity_type,
  source_record_id
) do nothing;
