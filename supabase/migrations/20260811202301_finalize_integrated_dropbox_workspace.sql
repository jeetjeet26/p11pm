-- Follow-up for the final Dropbox workspace changes after the initial migration
-- was applied to Basecamp while implementation was still in progress.

alter table public.files
  drop constraint files_current_version_id_fkey,
  add constraint files_current_version_id_fkey
    foreign key (current_version_id) references public.file_versions(id)
    on delete set null deferrable initially deferred;

drop trigger if exists queue_deleted_file_version_object on public.file_versions;
create or replace function private.queue_deleted_file_version_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.blob_id is null then
    perform private.enqueue_storage_deletion(
      old.bucket_id,
      old.object_path,
      'file_version_metadata_deleted',
      jsonb_build_object(
        'resourceId', old.id,
        'fileId', old.file_id,
        'versionNumber', old.version_number
      )
    );
  else
    perform private.enqueue_unreferenced_file_blob(
      old.blob_id,
      'file_version_blob_unreferenced',
      jsonb_build_object(
        'resourceId', old.id,
        'fileId', old.file_id,
        'versionNumber', old.version_number
      )
    );
  end if;
  return old;
end;
$$;
revoke all on function private.queue_deleted_file_version_object()
  from public, anon, authenticated;
create trigger queue_deleted_file_version_object
  after delete on public.file_versions
  for each row execute function private.queue_deleted_file_version_object();

alter table public.workspace_inbox_items
  drop constraint workspace_inbox_items_kind_check,
  add constraint workspace_inbox_items_kind_check check (
    kind in (
      'mention', 'assignment', 'thread_reply', 'approval', 'due', 'overdue',
      'blocker', 'watch', 'automation', 'integration', 'file_share',
      'file_comment'
    )
  );

create or replace function private.notify_file_workspace_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_file public.files;
  target_recipient uuid;
  target_kind text;
  target_title text;
  target_source_type text;
  target_source_id text;
begin
  if tg_table_name = 'file_shares' then
    if new.shared_with_profile_id is null then return new; end if;
    select file.* into target_file
    from public.files as file
    where file.id = new.file_id;
    target_recipient := new.shared_with_profile_id;
    target_kind := 'file_share';
    target_title := 'A file was shared with you';
    target_source_type := 'file_share';
    target_source_id := new.id::text;
  else
    select file.* into target_file
    from public.files as file
    where file.id = new.file_id;
    target_recipient := target_file.uploaded_by;
    if target_recipient is null or target_recipient = new.author_id then
      return new;
    end if;
    target_kind := 'file_comment';
    target_title := 'New comment on ' || left(target_file.file_name, 180);
    target_source_type := 'file_comment';
    target_source_id := new.id::text;
  end if;
  if target_file.id is null then return new; end if;
  insert into public.workspace_inbox_items (
    organization_id, recipient_id, actor_id, project_id, kind, title, body,
    href, source_type, source_id
  )
  values (
    target_file.organization_id, target_recipient, (select auth.uid()),
    target_file.project_id, target_kind, target_title,
    case when tg_table_name = 'file_comments' then left(new.body, 500) end,
    '/files?file=' || target_file.id::text
      || case when target_file.folder_id is not null
        then '&folderId=' || target_file.folder_id::text else '' end,
    target_source_type, target_source_id
  )
  on conflict (recipient_id, kind, source_type, source_id) do nothing;
  return new;
end;
$$;

revoke all on function private.notify_file_workspace_event()
  from public, anon, authenticated;
drop trigger if exists notify_internal_file_share on public.file_shares;
create trigger notify_internal_file_share
  after insert on public.file_shares
  for each row execute function private.notify_file_workspace_event();
drop trigger if exists notify_file_comment on public.file_comments;
create trigger notify_file_comment
  after insert on public.file_comments
  for each row execute function private.notify_file_workspace_event();
