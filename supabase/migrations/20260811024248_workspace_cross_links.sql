-- Permission-aware references between workspace chat and durable project records.
-- Files remain in their existing buckets; links only retain typed references.

create table public.workspace_cross_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  chat_type text not null check (
    chat_type in ('conversation', 'message', 'attachment')
  ),
  conversation_id uuid not null
    references public.workspace_conversations(id) on delete cascade,
  workspace_message_id uuid
    references public.workspace_messages(id) on delete cascade,
  workspace_attachment_id uuid
    references public.workspace_message_attachments(id) on delete cascade,
  work_type text not null check (
    work_type in (
      'project',
      'issue',
      'comment',
      'message',
      'doc',
      'file',
      'milestone',
      'archive_record'
    )
  ),
  work_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  todo_id uuid references public.todos(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  project_message_id uuid references public.messages(id) on delete cascade,
  doc_id uuid references public.docs(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete cascade,
  archive_record_id uuid
    references public.basecamp_archive_records(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint workspace_cross_links_chat_shape check (
    (
      chat_type = 'conversation'
      and workspace_message_id is null
      and workspace_attachment_id is null
    )
    or (
      chat_type = 'message'
      and workspace_message_id is not null
      and workspace_attachment_id is null
    )
    or (
      chat_type = 'attachment'
      and workspace_message_id is null
      and workspace_attachment_id is not null
    )
  ),
  constraint workspace_cross_links_work_shape check (
    (
      work_type = 'project'
      and work_id = project_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 0
    )
    or (
      work_type = 'issue'
      and work_id = todo_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
    or (
      work_type = 'comment'
      and work_id = comment_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
    or (
      work_type = 'message'
      and work_id = project_message_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
    or (
      work_type = 'doc'
      and work_id = doc_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
    or (
      work_type = 'file'
      and work_id = file_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
    or (
      work_type = 'milestone'
      and work_id = milestone_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
    or (
      work_type = 'archive_record'
      and work_id = archive_record_id
      and num_nonnulls(
        todo_id,
        comment_id,
        project_message_id,
        doc_id,
        file_id,
        milestone_id,
        archive_record_id
      ) = 1
    )
  )
);

create index workspace_cross_links_conversation_idx
  on public.workspace_cross_links (conversation_id, created_at desc, id);
create index workspace_cross_links_message_idx
  on public.workspace_cross_links (workspace_message_id, created_at, id)
  where workspace_message_id is not null;
create index workspace_cross_links_attachment_idx
  on public.workspace_cross_links (workspace_attachment_id, created_at, id)
  where workspace_attachment_id is not null;
create index workspace_cross_links_work_idx
  on public.workspace_cross_links (work_type, work_id, created_at desc, id);
create index workspace_cross_links_project_idx
  on public.workspace_cross_links (project_id, created_at desc, id);
create index workspace_cross_links_created_by_idx
  on public.workspace_cross_links (created_by, created_at desc, id);

create unique index workspace_cross_links_conversation_unique_idx
  on public.workspace_cross_links (conversation_id, work_type, work_id)
  where chat_type = 'conversation';
create unique index workspace_cross_links_message_unique_idx
  on public.workspace_cross_links (workspace_message_id, work_type, work_id)
  where chat_type = 'message';
create unique index workspace_cross_links_attachment_unique_idx
  on public.workspace_cross_links (workspace_attachment_id, work_type, work_id)
  where chat_type = 'attachment';

create or replace function private.validate_workspace_cross_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_organization_id uuid;
  work_organization_id uuid;
  attached_message_id uuid;
begin
  new.todo_id := null;
  new.comment_id := null;
  new.project_message_id := null;
  new.doc_id := null;
  new.file_id := null;
  new.milestone_id := null;
  new.archive_record_id := null;

  case new.chat_type
    when 'conversation' then
      select conversation.organization_id
      into chat_organization_id
      from public.workspace_conversations as conversation
      where conversation.id = new.conversation_id;
    when 'message' then
      select conversation.organization_id, message.conversation_id
      into chat_organization_id, new.conversation_id
      from public.workspace_messages as message
      join public.workspace_conversations as conversation
        on conversation.id = message.conversation_id
      where message.id = new.workspace_message_id;
    when 'attachment' then
      select
        conversation.organization_id,
        attachment.conversation_id,
        attachment.message_id
      into
        chat_organization_id,
        new.conversation_id,
        attached_message_id
      from public.workspace_message_attachments as attachment
      join public.workspace_conversations as conversation
        on conversation.id = attachment.conversation_id
      where attachment.id = new.workspace_attachment_id;
      if attached_message_id is null then
        raise check_violation using
          message = 'Pending chat attachments cannot be cross-linked.';
      end if;
  end case;
  if chat_organization_id is null then
    raise foreign_key_violation using message = 'Chat target does not exist.';
  end if;

  case new.work_type
    when 'project' then
      new.project_id := new.work_id;
      select project.organization_id
      into work_organization_id
      from public.projects as project
      where project.id = new.work_id;
    when 'issue' then
      select todo.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.todos as todo
      join public.projects as project on project.id = todo.project_id
      where todo.id = new.work_id;
      new.todo_id := new.work_id;
    when 'comment' then
      select comment.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.comments as comment
      join public.projects as project on project.id = comment.project_id
      where comment.id = new.work_id;
      new.comment_id := new.work_id;
    when 'message' then
      select message.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.messages as message
      join public.projects as project on project.id = message.project_id
      where message.id = new.work_id;
      new.project_message_id := new.work_id;
    when 'doc' then
      select doc.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.docs as doc
      join public.projects as project on project.id = doc.project_id
      where doc.id = new.work_id;
      new.doc_id := new.work_id;
    when 'file' then
      select file.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.files as file
      join public.projects as project on project.id = file.project_id
      where file.id = new.work_id;
      new.file_id := new.work_id;
    when 'milestone' then
      select milestone.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.milestones as milestone
      join public.projects as project on project.id = milestone.project_id
      where milestone.id = new.work_id;
      new.milestone_id := new.work_id;
    when 'archive_record' then
      select record.project_id, project.organization_id
      into new.project_id, work_organization_id
      from public.basecamp_archive_records as record
      join public.projects as project on project.id = record.project_id
      where record.id = new.work_id;
      new.archive_record_id := new.work_id;
  end case;
  if work_organization_id is null then
    raise foreign_key_violation using message = 'Work target does not exist.';
  end if;
  if chat_organization_id <> work_organization_id then
    raise check_violation using
      message = 'Cross-links must remain in one organization.';
  end if;

  new.organization_id := work_organization_id;
  if new.created_by is null then
    new.created_by := (select auth.uid());
  end if;
  if (select auth.uid()) is not null
    and new.created_by <> (select auth.uid())
  then
    raise insufficient_privilege using
      message = 'Cross-links must be created as the signed-in user.';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_workspace_cross_link() from public;

create trigger validate_workspace_cross_link
  before insert or update on public.workspace_cross_links
  for each row execute function private.validate_workspace_cross_link();

revoke all on public.workspace_cross_links from public, anon, authenticated;
grant select, insert, delete on public.workspace_cross_links to authenticated;
grant all on public.workspace_cross_links to service_role;

alter table public.workspace_cross_links enable row level security;

create policy "Members can read accessible cross-links"
on public.workspace_cross_links
for select
to authenticated
using (
  (select private.can_access_workspace_conversation(conversation_id))
  and (select private.can_access_project(project_id))
);

create policy "Members can create accessible cross-links"
on public.workspace_cross_links
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
  and (select private.can_access_project(project_id))
);

create policy "Members can remove their accessible cross-links"
on public.workspace_cross_links
for delete
to authenticated
using (
  created_by = (select auth.uid())
  and (select private.can_access_workspace_conversation(conversation_id))
  and (select private.can_access_project(project_id))
);

create or replace function private.attach_workspace_message_links(
  target_conversation_id uuid,
  target_message_id uuid,
  target_work_links jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_link jsonb;
begin
  if jsonb_typeof(coalesce(target_work_links, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(target_work_links, '[]'::jsonb)) > 20
  then
    raise check_violation using
      message = 'Messages can contain at most twenty work links.';
  end if;

  for requested_link in
    select value
    from jsonb_array_elements(coalesce(target_work_links, '[]'::jsonb))
  loop
    if requested_link ->> 'type' not in (
      'project',
      'issue',
      'comment',
      'message',
      'doc',
      'file',
      'milestone',
      'archive_record'
    ) or coalesce(requested_link ->> 'id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    then
      raise check_violation using message = 'Invalid work link.';
    end if;

    insert into public.workspace_cross_links (
      created_by,
      chat_type,
      conversation_id,
      workspace_message_id,
      work_type,
      work_id,
      organization_id,
      project_id
    )
    values (
      (select auth.uid()),
      'message',
      target_conversation_id,
      target_message_id,
      requested_link ->> 'type',
      (requested_link ->> 'id')::uuid,
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000'
    )
    on conflict do nothing;
  end loop;
end;
$$;

revoke all on function private.attach_workspace_message_links(
  uuid,
  uuid,
  jsonb
) from public;
grant execute on function private.attach_workspace_message_links(
  uuid,
  uuid,
  jsonb
) to authenticated, service_role;

create or replace function public.link_workspace_chat_entity(
  target_chat_type text,
  target_chat_id uuid,
  target_work_type text,
  target_work_id uuid
)
returns public.workspace_cross_links
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result_link public.workspace_cross_links;
begin
  insert into public.workspace_cross_links (
    created_by,
    chat_type,
    conversation_id,
    workspace_message_id,
    workspace_attachment_id,
    work_type,
    work_id,
    organization_id,
    project_id
  )
  values (
    (select auth.uid()),
    target_chat_type,
    case
      when target_chat_type = 'conversation' then target_chat_id
      else '00000000-0000-0000-0000-000000000000'::uuid
    end,
    case when target_chat_type = 'message' then target_chat_id end,
    case when target_chat_type = 'attachment' then target_chat_id end,
    target_work_type,
    target_work_id,
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000'
  )
  on conflict do nothing
  returning * into result_link;

  if result_link.id is null then
    select link.*
    into result_link
    from public.workspace_cross_links as link
    where link.chat_type = target_chat_type
      and (
        (target_chat_type = 'conversation' and link.conversation_id = target_chat_id)
        or (target_chat_type = 'message' and link.workspace_message_id = target_chat_id)
        or (
          target_chat_type = 'attachment'
          and link.workspace_attachment_id = target_chat_id
        )
      )
      and link.work_type = target_work_type
      and link.work_id = target_work_id;
  end if;

  return result_link;
end;
$$;

revoke all on function public.link_workspace_chat_entity(
  text,
  uuid,
  text,
  uuid
) from public, anon;
grant execute on function public.link_workspace_chat_entity(
  text,
  uuid,
  text,
  uuid
) to authenticated, service_role;

drop function public.send_workspace_message(uuid, text, uuid, uuid, uuid[]);

create function public.send_workspace_message(
  target_conversation_id uuid,
  target_body text,
  target_client_nonce uuid,
  target_parent_message_id uuid default null,
  target_attachment_ids uuid[] default '{}'::uuid[],
  target_work_links jsonb default '[]'::jsonb
)
returns public.workspace_messages
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attachment_count integer;
  result_message public.workspace_messages;
begin
  if char_length(btrim(target_body)) not between 1 and 4000 then
    raise check_violation using
      message = 'Message body must contain between 1 and 4,000 characters.';
  end if;
  if coalesce(cardinality(target_attachment_ids), 0) > 5 then
    raise check_violation using
      message = 'Messages can contain at most five attachments.';
  end if;

  select message.*
  into result_message
  from public.workspace_messages as message
  where message.sender_id = (select auth.uid())
    and message.client_nonce = target_client_nonce;

  if found then
    if coalesce(cardinality(target_attachment_ids), 0) > 0 and (
      select count(*)
      from public.workspace_message_attachments as attachment
      where attachment.id = any(target_attachment_ids)
        and attachment.message_id = result_message.id
    ) <> cardinality(target_attachment_ids) then
      raise check_violation using
        message = 'The retry does not match the original attachments.';
    end if;
    perform private.attach_workspace_message_links(
      target_conversation_id,
      result_message.id,
      target_work_links
    );
    return result_message;
  end if;

  if coalesce(cardinality(target_attachment_ids), 0) > 0 then
    select count(*)
    into attachment_count
    from public.workspace_message_attachments as attachment
    where attachment.id = any(target_attachment_ids)
      and attachment.conversation_id = target_conversation_id
      and attachment.uploader_id = (select auth.uid())
      and attachment.message_id is null;
    if attachment_count <> cardinality(target_attachment_ids) then
      raise check_violation using
        message = 'One or more attachments are unavailable.';
    end if;
  end if;

  insert into public.workspace_messages (
    conversation_id,
    sender_id,
    body,
    client_nonce,
    parent_message_id
  )
  values (
    target_conversation_id,
    (select auth.uid()),
    btrim(target_body),
    target_client_nonce,
    target_parent_message_id
  )
  on conflict (sender_id, client_nonce) do nothing
  returning * into result_message;

  if result_message.id is null then
    select message.*
    into result_message
    from public.workspace_messages as message
    where message.sender_id = (select auth.uid())
      and message.client_nonce = target_client_nonce;
    if coalesce(cardinality(target_attachment_ids), 0) > 0 and (
      select count(*)
      from public.workspace_message_attachments as attachment
      where attachment.id = any(target_attachment_ids)
        and attachment.message_id = result_message.id
    ) <> cardinality(target_attachment_ids) then
      raise check_violation using
        message = 'The retry does not match the original attachments.';
    end if;
    perform private.attach_workspace_message_links(
      target_conversation_id,
      result_message.id,
      target_work_links
    );
    return result_message;
  end if;

  if coalesce(cardinality(target_attachment_ids), 0) > 0 then
    update public.workspace_message_attachments
    set message_id = result_message.id
    where id = any(target_attachment_ids);
  end if;

  perform private.attach_workspace_message_links(
    target_conversation_id,
    result_message.id,
    target_work_links
  );
  return result_message;
end;
$$;

revoke all on function public.send_workspace_message(
  uuid,
  text,
  uuid,
  uuid,
  uuid[],
  jsonb
) from public, anon;
grant execute on function public.send_workspace_message(
  uuid,
  text,
  uuid,
  uuid,
  uuid[],
  jsonb
) to authenticated, service_role;
