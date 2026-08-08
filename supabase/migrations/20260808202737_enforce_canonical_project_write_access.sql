-- Security-definer write RPCs still honor project membership carried by the
-- caller's JWT. Service-role integrations retain their explicit actor/org
-- validation in private.project_write_actor.

create or replace function private.enforce_canonical_project_write_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project_id uuid;
begin
  if (select auth.role()) is distinct from 'authenticated' then
    return new;
  end if;

  if tg_table_name = 'todo_subtasks' then
    select todo.project_id
    into target_project_id
    from public.todos as todo
    where todo.id = new.todo_id;
  else
    target_project_id := (to_jsonb(new) ->> 'project_id')::uuid;
  end if;

  if target_project_id is null
    or not (select private.can_access_project(target_project_id))
  then
    raise insufficient_privilege using
      message = 'The authenticated user cannot write to this project.';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_canonical_project_write_access()
  from public, anon, authenticated;

create trigger enforce_canonical_todo_write_access
  before insert or update on public.todos
  for each row execute function private.enforce_canonical_project_write_access();

create trigger enforce_canonical_message_write_access
  before insert or update on public.messages
  for each row execute function private.enforce_canonical_project_write_access();

create trigger enforce_canonical_comment_write_access
  before insert or update on public.comments
  for each row execute function private.enforce_canonical_project_write_access();

create trigger enforce_canonical_subtask_write_access
  before insert or update on public.todo_subtasks
  for each row execute function private.enforce_canonical_project_write_access();
