create policy "Users can receive their workspace membership broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() =
    ('workspace-membership:' || (select auth.uid())::text)
);

create or replace function private.broadcast_workspace_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid := coalesce(new.profile_id, old.profile_id);
begin
  perform realtime.broadcast_changes(
    'workspace-membership:' || target_profile_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );

  return null;
end;
$$;

drop trigger if exists broadcast_workspace_membership_change
  on public.workspace_conversation_members;

create trigger broadcast_workspace_membership_change
after insert or update or delete
on public.workspace_conversation_members
for each row
execute function private.broadcast_workspace_membership_change();
