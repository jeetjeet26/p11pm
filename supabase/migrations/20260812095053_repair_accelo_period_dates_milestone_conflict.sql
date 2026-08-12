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
$old$    if stage.entity_type = 'contract_periods'
      and payload ->> 'contract_source_id' like '%/%'
    then
      payload := jsonb_set(
        payload,
        '{contract_source_id}',
        to_jsonb(regexp_replace(payload ->> 'contract_source_id', '^.*/', ''))
      );
    end if;$old$,
$new$    if stage.entity_type = 'contract_periods'
      and payload ->> 'contract_source_id' like '%/%'
    then
      payload := jsonb_set(
        payload,
        '{contract_source_id}',
        to_jsonb(regexp_replace(payload ->> 'contract_source_id', '^.*/', ''))
      );
    end if;
    if stage.entity_type = 'contract_periods'
      and nullif(payload ->> 'period_start', '') is null
      and nullif(stage.raw_payload ->> 'date_commenced', '') is not null
    then
      payload := jsonb_set(
        payload,
        '{period_start}',
        to_jsonb(
          ((to_timestamp(
            (stage.raw_payload ->> 'date_commenced')::double precision
          ) at time zone 'UTC')::date)::text
        )
      );
    end if;
    if stage.entity_type = 'contract_periods'
      and nullif(payload ->> 'period_end', '') is null
      and nullif(stage.raw_payload ->> 'date_expires', '') is not null
    then
      payload := jsonb_set(
        payload,
        '{period_end}',
        to_jsonb(
          ((to_timestamp(
            (stage.raw_payload ->> 'date_expires')::double precision
          ) at time zone 'UTC')::date)::text
        )
      );
    end if;$new$
  );

  updated_definition := replace(
    updated_definition,
$old$          on conflict (project_id, accelo_milestone_id)
            where accelo_milestone_id is not null
          do update set$old$,
$new$          on conflict (project_id, accelo_milestone_id)
          do update set$new$
  );

  if position('date_commenced' in updated_definition) = 0
     or position(
       E'on conflict (project_id, accelo_milestone_id)\n          do update'
       in updated_definition
     ) = 0
  then
    raise exception 'Unable to repair Accelo period dates and milestones.';
  end if;

  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '90s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '95s';
