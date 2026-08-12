do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.promote_accelo_invoice_stage(public.accelo_pull_runs,public.accelo_pull_stage,jsonb)'::regprocedure
  ) into definition;
  updated_definition := replace(
    definition,
    'run.organization_id, client_id, payment.id,',
    'run.organization_id, invoice.client_id, payment.id,'
  );
  if updated_definition = definition
     or position('run.organization_id, invoice.client_id, payment.id,' in updated_definition) = 0
  then
    raise exception 'Unable to disambiguate invoice payment allocation.';
  end if;
  execute updated_definition;
end;
$migration$;

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
$old$          contact_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'contacts',
            payload ->> 'contact_source_id', 'contacts'
          );
          select link.client_id into client_id
          from public.client_contacts as link
          where link.contact_id = contact_id
          order by link.is_primary desc, link.created_at
          limit 1;$old$,
$new$          destination_id := private.accelo_destination_uuid(
            run.organization_id, run.source_account_id, 'affiliations',
            payload ->> 'affiliation_source_id', 'client_contacts'
          );
          if destination_id is not null then
            select link.client_id, link.contact_id
              into client_id, contact_id
            from public.client_contacts as link
            where link.id = destination_id;
          else
            contact_id := private.accelo_destination_uuid(
              run.organization_id, run.source_account_id, 'contacts',
              payload ->> 'contact_source_id', 'contacts'
            );
            select link.client_id into client_id
            from public.client_contacts as link
            where link.contact_id = contact_id
            order by link.is_primary desc, link.created_at
            limit 1;
          end if;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$            next_action, next_action_at, closed_at, source_updated_at,
            source_payload$old$,
$new$            next_action, next_action_at, closed_at, lost_reason,
            source_updated_at, source_payload$new$
  );
  updated_definition := replace(
    updated_definition,
$old$            nullif(payload ->> 'next_action', ''),
            nullif(payload ->> 'next_action_at', '')::timestamptz,
            case
              when payload ->> 'stage' in ('won', 'lost')
                then coalesce(
                  nullif(payload ->> 'closed_at', '')::timestamptz,
                  now()
                )
              else null
            end,
            stage.source_updated_at, stage.raw_payload$old$,
$new$            nullif(payload ->> 'next_action', ''),
            nullif(payload ->> 'next_action_at', '')::timestamptz,
            case
              when payload ->> 'stage' in ('won', 'lost')
                then coalesce(
                  nullif(payload ->> 'closed_at', '')::timestamptz,
                  now()
                )
              else null
            end,
            case
              when payload ->> 'stage' = 'lost'
                then coalesce(
                  nullif(payload ->> 'lost_reason', ''),
                  'Imported from Accelo'
                )
              else null
            end,
            stage.source_updated_at, stage.raw_payload$new$
  );
  updated_definition := replace(
    updated_definition,
$old$            probability = excluded.probability,
            value_cents = excluded.value_cents,
            currency = excluded.currency,
            next_action = excluded.next_action,
            next_action_at = excluded.next_action_at,
            closed_at = excluded.closed_at,
            source_updated_at = excluded.source_updated_at,$old$,
$new$            probability = excluded.probability,
            value_cents = excluded.value_cents,
            currency = excluded.currency,
            next_action = excluded.next_action,
            next_action_at = excluded.next_action_at,
            closed_at = excluded.closed_at,
            lost_reason = excluded.lost_reason,
            source_updated_at = excluded.source_updated_at,$new$
  );

  if position('affiliation_source_id' in updated_definition) = 0
     or position('lost_reason = excluded.lost_reason' in updated_definition) = 0
  then
    raise exception 'Unable to repair Accelo prospect promotion.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_invoice_stage(
  public.accelo_pull_runs,
  public.accelo_pull_stage,
  jsonb
) set statement_timeout = '240s';
alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '240s';
