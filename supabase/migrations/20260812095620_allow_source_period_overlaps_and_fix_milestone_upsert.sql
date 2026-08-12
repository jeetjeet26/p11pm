do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.milestones'::regclass
      and conname = 'milestones_project_accelo_id_unique'
  ) then
    alter table public.milestones
      add constraint milestones_project_accelo_id_unique
      unique using index milestones_project_accelo_id_key;
  end if;
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
    'on conflict (project_id, accelo_milestone_id)',
    'on conflict on constraint milestones_project_accelo_id_unique'
  );
  if updated_definition = definition
     and position(
       'on conflict on constraint milestones_project_accelo_id_unique'
       in definition
     ) = 0
  then
    raise exception 'Unable to bind milestone upsert constraint.';
  end if;
  if updated_definition <> definition then
    execute updated_definition;
  end if;
end;
$migration$;

do $migration$
declare
  definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'private.prevent_overlapping_agency_periods()'::regprocedure
  ) into definition;
  updated_definition := replace(
    definition,
$old$      and period.status <> 'cancelled'
      and row_data ->> 'status' <> 'cancelled'
      and not ($old$,
$new$      and period.status <> 'cancelled'
      and row_data ->> 'status' <> 'cancelled'
      and nullif(row_data ->> 'external_id', '') is null
      and not ($new$
  );
  if updated_definition = definition
     or position(
       'nullif(row_data ->> ''external_id'', '''') is null'
       in updated_definition
     ) = 0
  then
    raise exception 'Unable to allow source-faithful retainer overlaps.';
  end if;
  execute updated_definition;
end;
$migration$;
