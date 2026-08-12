-- Work-oriented chat affordances: accountable signals, editing history, and pins.

alter table public.workspace_conversations
  add column topic text,
  add column purpose text;

alter table public.workspace_messages
  add column edited_at timestamptz,
  add column deleted_at timestamptz;

create table public.workspace_message_edits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.workspace_conversations(id) on delete cascade,
  message_id uuid not null references public.workspace_messages(id) on delete cascade,
  editor_id uuid not null references public.profiles(id) on delete restrict,
  previous_body text not null,
  edited_at timestamptz not null default now()
);

create index workspace_message_edits_message_idx
  on public.workspace_message_edits (message_id, edited_at desc);

create table public.workspace_message_signals (
  message_id uuid not null references public.workspace_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  signal text not null
    check (signal in ('acknowledged', 'approved', 'needs_changes', 'blocked', 'done')),
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, signal)
);

create index workspace_message_signals_profile_idx
  on public.workspace_message_signals (profile_id, created_at desc);

create table public.workspace_pins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.workspace_conversations(id) on delete cascade,
  message_id uuid references public.workspace_messages(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  href text,
  pinned_by uuid not null references public.profiles(id) on delete restrict
    default auth.uid(),
  created_at timestamptz not null default now(),
  check (message_id is not null or href is not null)
);

create unique index workspace_pins_message_unique_idx
  on public.workspace_pins (conversation_id, message_id)
  where message_id is not null;
create index workspace_pins_conversation_idx
  on public.workspace_pins (conversation_id, created_at desc);

create or replace function private.capture_workspace_message_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
begin
  if new.body is distinct from old.body then
    if old.sender_id <> (select auth.uid()) then
      raise insufficient_privilege using message = 'Only the sender can edit a message.';
    end if;
    if old.created_at < now() - interval '24 hours' then
      raise check_violation using message = 'Messages can be edited for 24 hours.';
    end if;
    select conversation.organization_id
    into target_organization_id
    from public.workspace_conversations as conversation
    where conversation.id = old.conversation_id;
    insert into public.workspace_message_edits (
      organization_id,
      conversation_id,
      message_id,
      editor_id,
      previous_body
    )
    values (
      target_organization_id,
      old.conversation_id,
      old.id,
      (select auth.uid()),
      old.body
    );
    new.edited_at := now();
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    if old.sender_id <> (select auth.uid()) then
      raise insufficient_privilege using message = 'Only the sender can delete a message.';
    end if;
    new.body := 'Message deleted';
  end if;
  return new;
end;
$$;

revoke all on function private.capture_workspace_message_edit() from public;

create trigger capture_workspace_message_edit
  before update of body, deleted_at on public.workspace_messages
  for each row execute function private.capture_workspace_message_edit();

revoke all on
  public.workspace_message_edits,
  public.workspace_message_signals,
  public.workspace_pins
from public, anon, authenticated;
grant select on
  public.workspace_message_edits,
  public.workspace_message_signals,
  public.workspace_pins
to authenticated;
grant insert, delete on public.workspace_message_signals, public.workspace_pins
to authenticated;
grant all on
  public.workspace_message_edits,
  public.workspace_message_signals,
  public.workspace_pins
to service_role;
grant update on public.workspace_messages to authenticated;

alter table public.workspace_message_edits enable row level security;
alter table public.workspace_message_signals enable row level security;
alter table public.workspace_pins enable row level security;

create policy "Members can read accessible message edits"
on public.workspace_message_edits for select to authenticated
using ((select private.can_access_workspace_conversation(conversation_id)));

create policy "Members can read accessible message signals"
on public.workspace_message_signals for select to authenticated
using (
  exists (
    select 1
    from public.workspace_messages as message
    where message.id = message_id
      and (select private.can_access_workspace_conversation(message.conversation_id))
  )
);
create policy "Members can add their message signals"
on public.workspace_message_signals for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1
    from public.workspace_messages as message
    where message.id = message_id
      and (select private.can_access_workspace_conversation(message.conversation_id))
  )
);
create policy "Members can remove their message signals"
on public.workspace_message_signals for delete to authenticated
using (
  profile_id = (select auth.uid())
  and exists (
    select 1
    from public.workspace_messages as message
    where message.id = message_id
      and (select private.can_access_workspace_conversation(message.conversation_id))
  )
);

create policy "Members can read accessible pins"
on public.workspace_pins for select to authenticated
using ((select private.can_access_workspace_conversation(conversation_id)));
create policy "Members can create accessible pins"
on public.workspace_pins for insert to authenticated
with check (
  pinned_by = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);
create policy "Pin creators can remove pins"
on public.workspace_pins for delete to authenticated
using (
  pinned_by = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);

create policy "Senders can update their messages"
on public.workspace_messages for update to authenticated
using (
  sender_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
)
with check (
  sender_id = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
);
