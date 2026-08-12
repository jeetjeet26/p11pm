-- Contract periods became a first-class resource after the initial authority
-- rows were seeded. Keep the new domain fail-closed in shadow until the same
-- explicit cutover evidence required by every other Accelo domain is supplied.
insert into public.integration_authority_states (
  organization_id,
  provider,
  source_account_id,
  entity_type,
  state,
  previous_state,
  transition_note
)
select distinct
  authority.organization_id,
  'accelo',
  authority.source_account_id,
  'contract_periods',
  'disabled',
  null,
  'Contract periods registered fail-closed'
from public.integration_authority_states as authority
where authority.provider = 'accelo'
on conflict (
  organization_id,
  provider,
  source_account_id,
  entity_type
) do nothing;

do $migration$
declare
  target record;
begin
  for target in
    select
      authority.organization_id,
      authority.source_account_id,
      (
        select profile.id
        from public.profiles as profile
        where profile.organization_id = authority.organization_id
          and profile.role = 'admin'
          and profile.status = 'active'
        order by profile.created_at, profile.id
        limit 1
      ) as actor_id
    from public.integration_authority_states as authority
    where authority.provider = 'accelo'
      and authority.entity_type = 'contract_periods'
      and authority.state = 'disabled'
  loop
    if target.actor_id is not null then
      perform private.set_integration_authority_state(
        target.organization_id,
        target.source_account_id,
        'contract_periods',
        'disabled',
        'shadow',
        null,
        'Contract periods added to read-only shadow inventory',
        target.actor_id
      );
    end if;
  end loop;
end;
$migration$;
