create table public.accelo_activity_promotion_queue (
  stage_record_id uuid primary key
    references public.accelo_pull_stage(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_account_id text not null,
  scan_id text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index accelo_activity_promotion_queue_active_idx
  on public.accelo_activity_promotion_queue (
    organization_id, source_account_id, active, stage_record_id
  );

alter table public.accelo_activity_promotion_queue enable row level security;
revoke all on public.accelo_activity_promotion_queue from public, anon, authenticated;
grant select, insert, update, delete
  on public.accelo_activity_promotion_queue to service_role;

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
$old$    join public.accelo_pull_runs as source_run on source_run.id = item.run_id
    where item.organization_id = run.organization_id$old$,
$new$    join public.accelo_pull_runs as source_run on source_run.id = item.run_id
    left join public.accelo_activity_promotion_queue as activity_queue
      on activity_queue.stage_record_id = item.id
      and activity_queue.organization_id = run.organization_id
      and activity_queue.source_account_id = run.source_account_id
      and activity_queue.active
    where item.organization_id = run.organization_id$new$
  );
  updated_definition := replace(
    updated_definition,
$old$      )
      and item.normalized_payload is not null$old$,
$new$      )
      and (
        item.entity_type <> 'activities'
        or not exists (
          select 1
          from public.accelo_activity_promotion_queue as active_queue
          where active_queue.organization_id = run.organization_id
            and active_queue.source_account_id = run.source_account_id
            and active_queue.active
        )
        or activity_queue.stage_record_id is not null
      )
      and item.normalized_payload is not null$new$
  );
  if position('left join public.accelo_activity_promotion_queue' in updated_definition) = 0
     or position('activity_queue.stage_record_id is not null' in updated_definition) = 0
  then
    raise exception 'Unable to apply the activity promotion queue.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
