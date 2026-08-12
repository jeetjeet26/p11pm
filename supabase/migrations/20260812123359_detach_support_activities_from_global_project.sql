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
$old$            select item.project_id, coalesce(ticket.client_id, project.client_id)
              into project_id, client_id
            from public.support_tickets as ticket
            join public.todos as item on item.id = ticket.todo_id
            join public.projects as project on project.id = item.project_id
            where ticket.id = destination_id;$old$,
$new$            select null::uuid, ticket.client_id
              into project_id, client_id
            from public.support_tickets as ticket
            where ticket.id = destination_id;$new$
  );
  if updated_definition = definition
     or position('select null::uuid, ticket.client_id' in updated_definition) = 0
  then
    raise exception 'Unable to detach support activities from global project.';
  end if;
  execute updated_definition;
end;
$migration$;

alter function private.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '115s';
alter function public.promote_accelo_pull_run(uuid, uuid)
  set statement_timeout = '118s';
