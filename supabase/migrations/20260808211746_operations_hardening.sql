-- Durable uploads, storage reconciliation, Slack delivery, and bounded retention.
-- All privileged functions live in the unexposed private schema. Public RPCs are
-- security-invoker wrappers with narrowly scoped grants.

create table public.upload_reservations (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null
    check (target_kind in ('project_file', 'chat_attachment')),
  project_id uuid references public.projects(id) on delete cascade,
  conversation_id uuid
    references public.workspace_conversations(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id text not null
    check (bucket_id in ('project-files', 'workspace-chat-files')),
  object_path text not null check (
    char_length(btrim(object_path)) between 1 and 1024
    and object_path !~ '(^|/)\.\.(/|$)'
  ),
  file_name text not null
    check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text check (
    mime_type is null or char_length(mime_type) between 1 and 255
  ),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  progress_bytes bigint not null default 0 check (
    progress_bytes between 0 and size_bytes
  ),
  status text not null default 'pending'
    check (status in ('pending', 'finalized', 'failed')),
  resource_id uuid,
  failure_reason text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path),
  constraint upload_reservations_target_valid check (
    (
      target_kind = 'project_file'
      and project_id is not null
      and conversation_id is null
      and bucket_id = 'project-files'
    )
    or (
      target_kind = 'chat_attachment'
      and project_id is null
      and conversation_id is not null
      and bucket_id = 'workspace-chat-files'
    )
  ),
  constraint upload_reservations_finalization_valid check (
    (
      status = 'finalized'
      and resource_id is not null
      and finalized_at is not null
      and failure_reason is null
    )
    or (
      status <> 'finalized'
      and resource_id is null
      and finalized_at is null
    )
  )
);

create index upload_reservations_owner_status_idx
  on public.upload_reservations (uploader_id, status, created_at desc);
create index upload_reservations_pending_expiry_idx
  on public.upload_reservations (expires_at, id)
  where status = 'pending';
create index upload_reservations_resource_idx
  on public.upload_reservations (target_kind, resource_id)
  where resource_id is not null;

create table public.storage_deletion_outbox (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null
    check (bucket_id in ('project-files', 'workspace-chat-files')),
  object_path text not null check (
    char_length(btrim(object_path)) between 1 and 1024
    and object_path !~ '(^|/)\.\.(/|$)'
  ),
  reason text not null check (char_length(btrim(reason)) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed', 'completed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 10 check (max_attempts between 1 and 100),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_until timestamptz,
  lock_token uuid,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create index storage_deletion_outbox_claim_idx
  on public.storage_deletion_outbox (available_at, created_at, id)
  where status in ('pending', 'failed', 'processing');

create table public.storage_reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  issue_type text not null
    check (issue_type in ('orphan_object', 'missing_object')),
  bucket_id text not null
    check (bucket_id in ('project-files', 'workspace-chat-files')),
  object_path text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (issue_type, bucket_id, object_path)
);

create index storage_reconciliation_issues_open_idx
  on public.storage_reconciliation_issues (issue_type, last_seen_at, id)
  where resolved_at is null;

create table public.slack_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null
    check (char_length(btrim(event_type)) between 1 and 120),
  channel text not null check (char_length(btrim(channel)) between 1 and 255),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and char_length(btrim(coalesce(payload ->> 'text', ''))) between 1 and 40000
  ),
  idempotency_key text unique check (
    idempotency_key is null
    or char_length(btrim(idempotency_key)) between 1 and 500
  ),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'failed', 'completed', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 10 check (max_attempts between 1 and 100),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_until timestamptz,
  lock_token uuid,
  last_error text,
  last_error_code text,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index slack_notification_outbox_claim_idx
  on public.slack_notification_outbox (available_at, created_at, id)
  where status in ('pending', 'failed', 'processing');
create index slack_notification_outbox_dead_idx
  on public.slack_notification_outbox (dead_lettered_at desc, id)
  where status = 'dead';

alter table public.upload_reservations enable row level security;
alter table public.storage_deletion_outbox enable row level security;
alter table public.storage_reconciliation_issues enable row level security;
alter table public.slack_notification_outbox enable row level security;

revoke all on
  public.upload_reservations,
  public.storage_deletion_outbox,
  public.storage_reconciliation_issues,
  public.slack_notification_outbox
from anon, authenticated;

grant all on
  public.upload_reservations,
  public.storage_deletion_outbox,
  public.storage_reconciliation_issues,
  public.slack_notification_outbox
to service_role;

create trigger set_upload_reservations_updated_at
  before update on public.upload_reservations
  for each row execute function private.set_updated_at();
create trigger set_storage_deletion_outbox_updated_at
  before update on public.storage_deletion_outbox
  for each row execute function private.set_updated_at();
create trigger set_slack_notification_outbox_updated_at
  before update on public.slack_notification_outbox
  for each row execute function private.set_updated_at();

create or replace function private.can_access_upload_project(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.profiles as viewer
      on viewer.id = (select auth.uid())
     and viewer.organization_id = project.organization_id
     and viewer.status = 'active'
    where project.id = target_project_id
      and (
        viewer.role in ('admin', 'manager')
        or project.owner_id = viewer.id
        or exists (
          select 1
          from public.project_members as membership
          where membership.project_id = project.id
            and membership.profile_id = viewer.id
        )
      )
  );
$$;

revoke all on function private.can_access_upload_project(uuid) from public;
grant execute on function private.can_access_upload_project(uuid)
  to authenticated, service_role;

create or replace function private.upload_resource_payload(
  reservation public.upload_reservations
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if reservation.resource_id is null then
    return null;
  end if;

  if reservation.target_kind = 'project_file' then
    select jsonb_build_object(
      'id', file.id,
      'projectId', file.project_id,
      'title', file.file_name,
      'kind', 'file',
      'authorId', file.uploaded_by,
      'sizeBytes', file.size_bytes,
      'updatedAt', file.created_at
    )
    into result
    from public.files as file
    where file.id = reservation.resource_id;
  else
    select jsonb_build_object(
      'id', attachment.id,
      'fileName', attachment.file_name,
      'mimeType', attachment.mime_type,
      'sizeBytes', attachment.size_bytes
    )
    into result
    from public.workspace_message_attachments as attachment
    where attachment.id = reservation.resource_id;
  end if;

  return result;
end;
$$;

revoke all on function private.upload_resource_payload(public.upload_reservations)
  from public;

create or replace function private.upload_reservation_payload(
  reservation public.upload_reservations
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', reservation.id,
    'targetKind', reservation.target_kind,
    'bucketName', reservation.bucket_id,
    'objectName', reservation.object_path,
    'fileName', reservation.file_name,
    'mimeType', reservation.mime_type,
    'sizeBytes', reservation.size_bytes,
    'progressBytes', reservation.progress_bytes,
    'status', reservation.status,
    'failureReason', reservation.failure_reason,
    'expiresAt', reservation.expires_at,
    'resource', private.upload_resource_payload(reservation)
  );
$$;

revoke all on function private.upload_reservation_payload(public.upload_reservations)
  from public;

create or replace function private.enqueue_storage_deletion(
  target_bucket_id text,
  target_object_path text,
  deletion_reason text,
  deletion_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
begin
  if target_bucket_id not in ('project-files', 'workspace-chat-files') then
    raise check_violation using message = 'Unsupported storage bucket.';
  end if;

  insert into public.storage_deletion_outbox (
    bucket_id,
    object_path,
    reason,
    metadata
  )
  values (
    target_bucket_id,
    target_object_path,
    left(deletion_reason, 120),
    coalesce(deletion_metadata, '{}'::jsonb)
  )
  on conflict (bucket_id, object_path) do update
  set
    reason = excluded.reason,
    metadata = public.storage_deletion_outbox.metadata || excluded.metadata,
    status = case
      when public.storage_deletion_outbox.status = 'completed' then 'pending'
      else public.storage_deletion_outbox.status
    end,
    available_at = case
      when public.storage_deletion_outbox.status = 'completed' then now()
      else public.storage_deletion_outbox.available_at
    end,
    completed_at = case
      when public.storage_deletion_outbox.status = 'completed' then null
      else public.storage_deletion_outbox.completed_at
    end
  returning id into result_id;

  return result_id;
end;
$$;

revoke all on function private.enqueue_storage_deletion(
  text,
  text,
  text,
  jsonb
) from public;

create or replace function private.create_upload_reservation(
  upload_target text,
  target_id uuid,
  upload_file_name text,
  upload_mime_type text,
  upload_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.upload_reservations;
  safe_name text;
  target_bucket text;
  target_path text;
begin
  if (select auth.uid()) is null or not (select private.is_internal_user()) then
    raise insufficient_privilege using message = 'An active account is required.';
  end if;

  if upload_target not in ('project_file', 'chat_attachment') then
    raise check_violation using message = 'Unsupported upload target.';
  end if;
  if target_id is null then
    raise check_violation using message = 'An upload target is required.';
  end if;
  if char_length(btrim(coalesce(upload_file_name, ''))) not between 1 and 255 then
    raise check_violation using message = 'File names must contain 1 to 255 characters.';
  end if;
  if upload_mime_type is not null
     and char_length(btrim(upload_mime_type)) not between 1 and 255 then
    raise check_violation using message = 'The MIME type is invalid.';
  end if;
  if upload_size_bytes not between 1 and 26214400 then
    raise check_violation using message = 'Files must be between 1 byte and 25 MB.';
  end if;

  if upload_target = 'project_file' then
    if not (select private.can_access_upload_project(target_id)) then
      raise insufficient_privilege using message = 'Project access is required.';
    end if;
    target_bucket := 'project-files';
  else
    if not (
      select private.can_access_workspace_conversation(target_id)
    ) then
      raise insufficient_privilege using message = 'Conversation access is required.';
    end if;
    target_bucket := 'workspace-chat-files';
  end if;

  safe_name := regexp_replace(
    btrim(upload_file_name),
    '[^a-zA-Z0-9._-]+',
    '-',
    'g'
  );
  safe_name := regexp_replace(safe_name, '-+', '-', 'g');
  safe_name := right(btrim(safe_name, '-'), 180);
  if safe_name = '' then
    safe_name := case
      when upload_target = 'project_file' then 'file'
      else 'attachment'
    end;
  end if;

  result.id := gen_random_uuid();
  target_path := format(
    '%s/%s/%s-%s',
    target_id,
    (select auth.uid()),
    result.id,
    safe_name
  );

  insert into public.upload_reservations (
    id,
    target_kind,
    project_id,
    conversation_id,
    uploader_id,
    bucket_id,
    object_path,
    file_name,
    mime_type,
    size_bytes
  )
  values (
    result.id,
    upload_target,
    case when upload_target = 'project_file' then target_id end,
    case when upload_target = 'chat_attachment' then target_id end,
    (select auth.uid()),
    target_bucket,
    target_path,
    upload_file_name,
    nullif(btrim(upload_mime_type), ''),
    upload_size_bytes
  )
  returning * into result;

  return private.upload_reservation_payload(result);
end;
$$;

revoke all on function private.create_upload_reservation(
  text,
  uuid,
  text,
  text,
  bigint
) from public;
grant execute on function private.create_upload_reservation(
  text,
  uuid,
  text,
  text,
  bigint
) to authenticated;

create or replace function public.create_upload_reservation(
  upload_target text,
  target_id uuid,
  upload_file_name text,
  upload_mime_type text,
  upload_size_bytes bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_upload_reservation(
    upload_target,
    target_id,
    upload_file_name,
    upload_mime_type,
    upload_size_bytes
  );
$$;

revoke all on function public.create_upload_reservation(
  text,
  uuid,
  text,
  text,
  bigint
) from public, anon;
grant execute on function public.create_upload_reservation(
  text,
  uuid,
  text,
  text,
  bigint
) to authenticated;

create or replace function private.get_upload_reservation(
  reservation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result public.upload_reservations;
begin
  select reservation.*
  into result
  from public.upload_reservations as reservation
  where reservation.id = reservation_id
    and reservation.uploader_id = (select auth.uid());

  if not found then
    return null;
  end if;

  return private.upload_reservation_payload(result);
end;
$$;

revoke all on function private.get_upload_reservation(uuid) from public;
grant execute on function private.get_upload_reservation(uuid) to authenticated;

create or replace function public.get_upload_reservation(
  reservation_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.get_upload_reservation(reservation_id);
$$;

revoke all on function public.get_upload_reservation(uuid) from public, anon;
grant execute on function public.get_upload_reservation(uuid) to authenticated;

create or replace function private.report_upload_progress(
  reservation_id uuid,
  reported_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.upload_reservations;
begin
  update public.upload_reservations as reservation
  set progress_bytes = greatest(
    reservation.progress_bytes,
    least(greatest(reported_bytes, 0), reservation.size_bytes)
  )
  where reservation.id = reservation_id
    and reservation.uploader_id = (select auth.uid())
    and reservation.status = 'pending'
    and reservation.expires_at > now()
  returning reservation.* into result;

  if not found then
    select reservation.*
    into result
    from public.upload_reservations as reservation
    where reservation.id = reservation_id
      and reservation.uploader_id = (select auth.uid());
  end if;

  if not found then
    return null;
  end if;
  return private.upload_reservation_payload(result);
end;
$$;

revoke all on function private.report_upload_progress(uuid, bigint) from public;
grant execute on function private.report_upload_progress(uuid, bigint)
  to authenticated;

create or replace function public.report_upload_progress(
  reservation_id uuid,
  reported_bytes bigint
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.report_upload_progress(reservation_id, reported_bytes);
$$;

revoke all on function public.report_upload_progress(uuid, bigint)
  from public, anon;
grant execute on function public.report_upload_progress(uuid, bigint)
  to authenticated;

create or replace function private.fail_upload_reservation(
  reservation_id uuid,
  failure_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.upload_reservations;
begin
  update public.upload_reservations as reservation
  set
    status = 'failed',
    failure_reason = left(coalesce(nullif(btrim(failure_message), ''), 'upload_failed'), 500)
  where reservation.id = reservation_id
    and reservation.uploader_id = (select auth.uid())
    and reservation.status = 'pending'
  returning reservation.* into result;

  if not found then
    select reservation.*
    into result
    from public.upload_reservations as reservation
    where reservation.id = reservation_id
      and reservation.uploader_id = (select auth.uid());
  end if;

  if not found then
    return null;
  end if;

  if result.status = 'failed' then
    perform private.enqueue_storage_deletion(
      result.bucket_id,
      result.object_path,
      'failed_upload_reservation',
      jsonb_build_object('reservationId', result.id)
    );
  end if;

  return private.upload_reservation_payload(result);
end;
$$;

revoke all on function private.fail_upload_reservation(uuid, text) from public;
grant execute on function private.fail_upload_reservation(uuid, text)
  to authenticated;

create or replace function public.fail_upload_reservation(
  reservation_id uuid,
  failure_message text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.fail_upload_reservation(reservation_id, failure_message);
$$;

revoke all on function public.fail_upload_reservation(uuid, text)
  from public, anon;
grant execute on function public.fail_upload_reservation(uuid, text)
  to authenticated;

create or replace function private.finalize_upload_reservation(
  reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.upload_reservations;
  observed_size bigint;
  observed_mime text;
  result_id uuid;
begin
  select candidate.*
  into reservation
  from public.upload_reservations as candidate
  where candidate.id = reservation_id
    and candidate.uploader_id = (select auth.uid())
  for update;

  if not found then
    return null;
  end if;
  if reservation.status <> 'pending' then
    return private.upload_reservation_payload(reservation);
  end if;

  if reservation.expires_at <= now() then
    update public.upload_reservations
    set status = 'failed', failure_reason = 'reservation_expired'
    where id = reservation.id
    returning * into reservation;
    perform private.enqueue_storage_deletion(
      reservation.bucket_id,
      reservation.object_path,
      'expired_upload_reservation',
      jsonb_build_object('reservationId', reservation.id)
    );
    return private.upload_reservation_payload(reservation);
  end if;

  if (
    reservation.target_kind = 'project_file'
    and not private.can_access_upload_project(reservation.project_id)
  ) or (
    reservation.target_kind = 'chat_attachment'
    and not private.can_access_workspace_conversation(
      reservation.conversation_id
    )
  ) then
    update public.upload_reservations
    set status = 'failed', failure_reason = 'upload_access_revoked'
    where id = reservation.id
    returning * into reservation;
    perform private.enqueue_storage_deletion(
      reservation.bucket_id,
      reservation.object_path,
      'upload_access_revoked',
      jsonb_build_object('reservationId', reservation.id)
    );
    return private.upload_reservation_payload(reservation);
  end if;

  select
    case
      when object.metadata ->> 'size' ~ '^[0-9]+$'
        then (object.metadata ->> 'size')::bigint
      else null
    end,
    nullif(object.metadata ->> 'mimetype', '')
  into observed_size, observed_mime
  from storage.objects as object
  where object.bucket_id = reservation.bucket_id
    and object.name = reservation.object_path;

  if not found then
    return private.upload_reservation_payload(reservation)
      || jsonb_build_object('finalizeError', 'upload_not_complete');
  end if;

  if observed_size is null or observed_size <> reservation.size_bytes then
    update public.upload_reservations
    set
      status = 'failed',
      failure_reason = format(
        'size_mismatch:expected=%s,observed=%s',
        reservation.size_bytes,
        coalesce(observed_size::text, 'unknown')
      )
    where id = reservation.id
    returning * into reservation;
    perform private.enqueue_storage_deletion(
      reservation.bucket_id,
      reservation.object_path,
      'upload_size_mismatch',
      jsonb_build_object('reservationId', reservation.id)
    );
    return private.upload_reservation_payload(reservation);
  end if;

  if reservation.mime_type is not null
     and observed_mime is not null
     and lower(reservation.mime_type) <> lower(observed_mime) then
    update public.upload_reservations
    set
      status = 'failed',
      failure_reason = format(
        'mime_mismatch:expected=%s,observed=%s',
        reservation.mime_type,
        observed_mime
      )
    where id = reservation.id
    returning * into reservation;
    perform private.enqueue_storage_deletion(
      reservation.bucket_id,
      reservation.object_path,
      'upload_mime_mismatch',
      jsonb_build_object('reservationId', reservation.id)
    );
    return private.upload_reservation_payload(reservation);
  end if;

  if reservation.target_kind = 'project_file' then
    insert into public.files (
      project_id,
      uploaded_by,
      bucket_id,
      object_path,
      file_name,
      mime_type,
      size_bytes,
      metadata
    )
    values (
      reservation.project_id,
      reservation.uploader_id,
      reservation.bucket_id,
      reservation.object_path,
      reservation.file_name,
      coalesce(observed_mime, reservation.mime_type),
      observed_size,
      jsonb_build_object('upload_reservation_id', reservation.id)
    )
    returning id into result_id;
  else
    insert into public.workspace_message_attachments (
      conversation_id,
      uploader_id,
      bucket_id,
      object_path,
      file_name,
      mime_type,
      size_bytes
    )
    values (
      reservation.conversation_id,
      reservation.uploader_id,
      reservation.bucket_id,
      reservation.object_path,
      reservation.file_name,
      coalesce(observed_mime, reservation.mime_type),
      observed_size
    )
    returning id into result_id;
  end if;

  update public.upload_reservations
  set
    status = 'finalized',
    progress_bytes = size_bytes,
    resource_id = result_id,
    finalized_at = now(),
    failure_reason = null
  where id = reservation.id
  returning * into reservation;

  return private.upload_reservation_payload(reservation);
end;
$$;

revoke all on function private.finalize_upload_reservation(uuid) from public;
grant execute on function private.finalize_upload_reservation(uuid)
  to authenticated;

create or replace function public.finalize_upload_reservation(
  reservation_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.finalize_upload_reservation(reservation_id);
$$;

revoke all on function public.finalize_upload_reservation(uuid)
  from public, anon;
grant execute on function public.finalize_upload_reservation(uuid)
  to authenticated;

create or replace function private.can_upload_reserved_object(
  target_bucket_id text,
  target_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.upload_reservations as reservation
    where reservation.bucket_id = target_bucket_id
      and reservation.object_path = target_object_path
      and reservation.uploader_id = (select auth.uid())
      and reservation.status = 'pending'
      and reservation.expires_at > now()
      and (
        (
          reservation.target_kind = 'project_file'
          and private.can_access_upload_project(reservation.project_id)
        )
        or (
          reservation.target_kind = 'chat_attachment'
          and private.can_access_workspace_conversation(
            reservation.conversation_id
          )
        )
      )
  );
$$;

revoke all on function private.can_upload_reserved_object(text, text)
  from public;
grant execute on function private.can_upload_reserved_object(text, text)
  to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('project-files', 'project-files', false, 26214400),
  ('workspace-chat-files', 'workspace-chat-files', false, 26214400)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "Internal users can read project files"
  on storage.objects;
drop policy if exists "Internal users can upload project files"
  on storage.objects;
drop policy if exists "Internal users can update project files"
  on storage.objects;
drop policy if exists "Internal users can delete project files"
  on storage.objects;
drop policy if exists "Chat users can upload their message files"
  on storage.objects;
drop policy if exists "Chat users can remove their pending message files"
  on storage.objects;

create policy "Project members can read finalized project files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'project-files'
  and exists (
    select 1
    from public.files as file
    where file.bucket_id = storage.objects.bucket_id
      and file.object_path = storage.objects.name
      and private.can_access_upload_project(file.project_id)
  )
);

create policy "Authenticated users can upload reserved objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id in ('project-files', 'workspace-chat-files')
  and private.can_upload_reserved_object(bucket_id, name)
);

create or replace function private.queue_deleted_storage_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_target_kind text := tg_argv[0];
begin
  perform private.enqueue_storage_deletion(
    old.bucket_id,
    old.object_path,
    deleted_target_kind || '_metadata_deleted',
    jsonb_build_object(
      'resourceId',
      old.id,
      'targetKind',
      deleted_target_kind
    )
  );

  update public.upload_reservations as reservation
  set
    status = 'failed',
    resource_id = null,
    finalized_at = null,
    failure_reason = 'finalized_metadata_deleted'
  where reservation.resource_id = old.id
    and reservation.target_kind = deleted_target_kind
    and reservation.status = 'finalized';

  return old;
end;
$$;

revoke all on function private.queue_deleted_storage_object() from public;

create trigger queue_deleted_project_file_object
  after delete on public.files
  for each row execute function private.queue_deleted_storage_object('project_file');
create trigger queue_deleted_chat_attachment_object
  after delete on public.workspace_message_attachments
  for each row execute function private.queue_deleted_storage_object('chat_attachment');

create or replace function private.enqueue_slack_notification(
  notification_event_type text,
  notification_channel text,
  notification_text text,
  notification_blocks jsonb default null,
  notification_thread_ts text default null,
  notification_idempotency_key text default null,
  notification_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  result_payload jsonb;
begin
  if not (select private.is_internal_user()) then
    raise insufficient_privilege using message = 'An active account is required.';
  end if;
  if char_length(btrim(coalesce(notification_event_type, ''))) not between 1 and 120 then
    raise check_violation using message = 'A notification event type is required.';
  end if;
  if char_length(btrim(coalesce(notification_channel, ''))) not between 1 and 255 then
    raise check_violation using message = 'A Slack channel is required.';
  end if;
  if char_length(btrim(coalesce(notification_text, ''))) not between 1 and 40000 then
    raise check_violation using message = 'Slack notification text is required.';
  end if;
  if notification_blocks is not null
     and jsonb_typeof(notification_blocks) <> 'array' then
    raise check_violation using message = 'Slack blocks must be an array.';
  end if;

  result_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'text', notification_text,
      'blocks', notification_blocks,
      'threadTs', nullif(btrim(notification_thread_ts), ''),
      'metadata', coalesce(notification_metadata, '{}'::jsonb)
    )
  );

  insert into public.slack_notification_outbox (
    event_type,
    channel,
    payload,
    idempotency_key
  )
  values (
    notification_event_type,
    notification_channel,
    result_payload,
    nullif(btrim(notification_idempotency_key), '')
  )
  on conflict (idempotency_key) do update
  set idempotency_key = excluded.idempotency_key
  returning id into result_id;

  return result_id;
end;
$$;

comment on function private.enqueue_slack_notification(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) is
  'Call this from the same private mutation RPC transaction as the todo/comment write. Use the mutation nonce in notification_idempotency_key so a rollback or retry cannot create a partial or duplicate notification.';

revoke all on function private.enqueue_slack_notification(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) from public;
grant execute on function private.enqueue_slack_notification(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) to authenticated;

create or replace function public.enqueue_slack_notification(
  notification_event_type text,
  notification_channel text,
  notification_text text,
  notification_blocks jsonb default null,
  notification_thread_ts text default null,
  notification_idempotency_key text default null,
  notification_metadata jsonb default '{}'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.enqueue_slack_notification(
    notification_event_type,
    notification_channel,
    notification_text,
    notification_blocks,
    notification_thread_ts,
    notification_idempotency_key,
    notification_metadata
  );
$$;

revoke all on function public.enqueue_slack_notification(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) from public, anon;
grant execute on function public.enqueue_slack_notification(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) to authenticated;

create or replace function private.claim_slack_notifications(
  requested_limit integer default 25,
  lease_seconds integer default 120
)
returns table (
  id uuid,
  event_type text,
  channel text,
  payload jsonb,
  attempt_count integer,
  lock_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  return query
  with candidates as materialized (
    select notification.id
    from public.slack_notification_outbox as notification
    where (
      notification.status in ('pending', 'failed')
      and notification.available_at <= now()
    )
    or (
      notification.status = 'processing'
      and notification.locked_until <= now()
    )
    order by notification.available_at, notification.created_at, notification.id
    for update skip locked
    limit least(greatest(coalesce(requested_limit, 25), 1), 100)
  )
  update public.slack_notification_outbox as notification
  set
    status = 'processing',
    attempt_count = notification.attempt_count + 1,
    locked_at = now(),
    locked_until = now() + make_interval(
      secs => least(greatest(coalesce(lease_seconds, 120), 30), 900)
    ),
    lock_token = gen_random_uuid(),
    last_error = null,
    last_error_code = null
  from candidates
  where notification.id = candidates.id
  returning
    notification.id,
    notification.event_type,
    notification.channel,
    notification.payload,
    notification.attempt_count,
    notification.lock_token;
end;
$$;

create or replace function private.ack_slack_notification(
  notification_id uuid,
  notification_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  update public.slack_notification_outbox
  set
    status = 'completed',
    completed_at = now(),
    locked_at = null,
    locked_until = null,
    lock_token = null,
    last_error = null,
    last_error_code = null
  where id = notification_id
    and lock_token = notification_lock_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function private.fail_slack_notification(
  notification_id uuid,
  notification_lock_token uuid,
  failure_message text,
  failure_code text default null,
  retry_after_seconds integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  notification public.slack_notification_outbox;
  retry_delay integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  select candidate.*
  into notification
  from public.slack_notification_outbox as candidate
  where candidate.id = notification_id
    and candidate.lock_token = notification_lock_token
    and candidate.status = 'processing'
  for update;

  if not found then
    return 'not_claimed';
  end if;

  if notification.attempt_count >= notification.max_attempts then
    update public.slack_notification_outbox
    set
      status = 'dead',
      dead_lettered_at = now(),
      locked_at = null,
      locked_until = null,
      lock_token = null,
      last_error = left(failure_message, 2000),
      last_error_code = left(failure_code, 255)
    where id = notification.id;
    return 'dead';
  end if;

  retry_delay := greatest(
    greatest(coalesce(retry_after_seconds, 0), 0),
    least(
      21600,
      (30 * power(2, greatest(notification.attempt_count - 1, 0)))::integer
    )
  ) + floor(random() * 5)::integer;

  update public.slack_notification_outbox
  set
    status = 'failed',
    available_at = now() + make_interval(secs => retry_delay),
    locked_at = null,
    locked_until = null,
    lock_token = null,
    last_error = left(failure_message, 2000),
    last_error_code = left(failure_code, 255)
  where id = notification.id;

  return 'failed';
end;
$$;

create or replace function private.dead_letter_slack_notification(
  notification_id uuid,
  notification_lock_token uuid,
  failure_message text,
  failure_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  update public.slack_notification_outbox
  set
    status = 'dead',
    dead_lettered_at = now(),
    locked_at = null,
    locked_until = null,
    lock_token = null,
    last_error = left(failure_message, 2000),
    last_error_code = left(failure_code, 255)
  where id = notification_id
    and lock_token = notification_lock_token
    and status = 'processing';

  return found;
end;
$$;

revoke all on function private.claim_slack_notifications(integer, integer)
  from public;
revoke all on function private.ack_slack_notification(uuid, uuid)
  from public;
revoke all on function private.fail_slack_notification(
  uuid,
  uuid,
  text,
  text,
  integer
) from public;
revoke all on function private.dead_letter_slack_notification(
  uuid,
  uuid,
  text,
  text
) from public;
grant execute on function private.claim_slack_notifications(integer, integer)
  to service_role;
grant execute on function private.ack_slack_notification(uuid, uuid)
  to service_role;
grant execute on function private.fail_slack_notification(
  uuid,
  uuid,
  text,
  text,
  integer
) to service_role;
grant execute on function private.dead_letter_slack_notification(
  uuid,
  uuid,
  text,
  text
) to service_role;

create or replace function public.claim_slack_notifications(
  requested_limit integer default 25,
  lease_seconds integer default 120
)
returns table (
  id uuid,
  event_type text,
  channel text,
  payload jsonb,
  attempt_count integer,
  lock_token uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.claim_slack_notifications(
    requested_limit,
    lease_seconds
  );
$$;

create or replace function public.ack_slack_notification(
  notification_id uuid,
  notification_lock_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.ack_slack_notification(
    notification_id,
    notification_lock_token
  );
$$;

create or replace function public.fail_slack_notification(
  notification_id uuid,
  notification_lock_token uuid,
  failure_message text,
  failure_code text default null,
  retry_after_seconds integer default null
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.fail_slack_notification(
    notification_id,
    notification_lock_token,
    failure_message,
    failure_code,
    retry_after_seconds
  );
$$;

create or replace function public.dead_letter_slack_notification(
  notification_id uuid,
  notification_lock_token uuid,
  failure_message text,
  failure_code text default null
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.dead_letter_slack_notification(
    notification_id,
    notification_lock_token,
    failure_message,
    failure_code
  );
$$;

revoke all on function public.claim_slack_notifications(integer, integer)
  from public, anon, authenticated;
revoke all on function public.ack_slack_notification(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_slack_notification(
  uuid,
  uuid,
  text,
  text,
  integer
) from public, anon, authenticated;
revoke all on function public.dead_letter_slack_notification(
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.claim_slack_notifications(integer, integer)
  to service_role;
grant execute on function public.ack_slack_notification(uuid, uuid)
  to service_role;
grant execute on function public.fail_slack_notification(
  uuid,
  uuid,
  text,
  text,
  integer
) to service_role;
grant execute on function public.dead_letter_slack_notification(
  uuid,
  uuid,
  text,
  text
) to service_role;

create or replace function private.claim_storage_deletions(
  requested_limit integer default 25,
  lease_seconds integer default 120
)
returns table (
  id uuid,
  bucket_id text,
  object_path text,
  attempt_count integer,
  lock_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  return query
  with candidates as materialized (
    select deletion.id
    from public.storage_deletion_outbox as deletion
    where (
      deletion.status in ('pending', 'failed')
      and deletion.available_at <= now()
    )
    or (
      deletion.status = 'processing'
      and deletion.locked_until <= now()
    )
    order by deletion.available_at, deletion.created_at, deletion.id
    for update skip locked
    limit least(greatest(coalesce(requested_limit, 25), 1), 100)
  )
  update public.storage_deletion_outbox as deletion
  set
    status = 'processing',
    attempt_count = deletion.attempt_count + 1,
    locked_at = now(),
    locked_until = now() + make_interval(
      secs => least(greatest(coalesce(lease_seconds, 120), 30), 900)
    ),
    lock_token = gen_random_uuid(),
    last_error = null
  from candidates
  where deletion.id = candidates.id
  returning
    deletion.id,
    deletion.bucket_id,
    deletion.object_path,
    deletion.attempt_count,
    deletion.lock_token;
end;
$$;

create or replace function private.ack_storage_deletion(
  deletion_id uuid,
  deletion_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion public.storage_deletion_outbox;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  update public.storage_deletion_outbox
  set
    status = 'completed',
    completed_at = now(),
    locked_at = null,
    locked_until = null,
    lock_token = null,
    last_error = null
  where id = deletion_id
    and lock_token = deletion_lock_token
    and status = 'processing'
  returning * into deletion;

  if not found then
    return false;
  end if;

  update public.storage_reconciliation_issues
  set resolved_at = now(), last_seen_at = now()
  where bucket_id = deletion.bucket_id
    and object_path = deletion.object_path
    and resolved_at is null;

  return true;
end;
$$;

create or replace function private.fail_storage_deletion(
  deletion_id uuid,
  deletion_lock_token uuid,
  failure_message text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion public.storage_deletion_outbox;
  retry_delay integer;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  select candidate.*
  into deletion
  from public.storage_deletion_outbox as candidate
  where candidate.id = deletion_id
    and candidate.lock_token = deletion_lock_token
    and candidate.status = 'processing'
  for update;

  if not found then
    return 'not_claimed';
  end if;

  if deletion.attempt_count >= deletion.max_attempts then
    update public.storage_deletion_outbox
    set
      status = 'dead',
      locked_at = null,
      locked_until = null,
      lock_token = null,
      last_error = left(failure_message, 2000)
    where id = deletion.id;
    return 'dead';
  end if;

  retry_delay := least(
    21600,
    (30 * power(2, greatest(deletion.attempt_count - 1, 0)))::integer
  ) + floor(random() * 5)::integer;

  update public.storage_deletion_outbox
  set
    status = 'failed',
    available_at = now() + make_interval(secs => retry_delay),
    locked_at = null,
    locked_until = null,
    lock_token = null,
    last_error = left(failure_message, 2000)
  where id = deletion.id;

  return 'failed';
end;
$$;

revoke all on function private.claim_storage_deletions(integer, integer)
  from public;
revoke all on function private.ack_storage_deletion(uuid, uuid) from public;
revoke all on function private.fail_storage_deletion(uuid, uuid, text)
  from public;
grant execute on function private.claim_storage_deletions(integer, integer)
  to service_role;
grant execute on function private.ack_storage_deletion(uuid, uuid)
  to service_role;
grant execute on function private.fail_storage_deletion(uuid, uuid, text)
  to service_role;

create or replace function public.claim_storage_deletions(
  requested_limit integer default 25,
  lease_seconds integer default 120
)
returns table (
  id uuid,
  bucket_id text,
  object_path text,
  attempt_count integer,
  lock_token uuid
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.claim_storage_deletions(
    requested_limit,
    lease_seconds
  );
$$;

create or replace function public.ack_storage_deletion(
  deletion_id uuid,
  deletion_lock_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.ack_storage_deletion(deletion_id, deletion_lock_token);
$$;

create or replace function public.fail_storage_deletion(
  deletion_id uuid,
  deletion_lock_token uuid,
  failure_message text
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.fail_storage_deletion(
    deletion_id,
    deletion_lock_token,
    failure_message
  );
$$;

revoke all on function public.claim_storage_deletions(integer, integer)
  from public, anon, authenticated;
revoke all on function public.ack_storage_deletion(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_storage_deletion(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_storage_deletions(integer, integer)
  to service_role;
grant execute on function public.ack_storage_deletion(uuid, uuid)
  to service_role;
grant execute on function public.fail_storage_deletion(uuid, uuid, text)
  to service_role;

create or replace function private.retention_days(
  settings jsonb,
  setting_key text,
  default_days integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    default_days,
    case
      when coalesce(settings ->> setting_key, '') ~ '^[0-9]{1,5}$'
        then least((settings ->> setting_key)::integer, 36500)
      else default_days
    end
  );
$$;

create or replace function private.has_legal_hold(settings jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(settings ->> 'legal_hold', 'false'))
    in ('true', '1', 'yes', 'on');
$$;

revoke all on function private.retention_days(jsonb, text, integer)
  from public;
revoke all on function private.has_legal_hold(jsonb) from public;

create or replace function private.run_operations_cleanup(
  requested_batch_size integer default 250,
  dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_size integer := least(
    greatest(coalesce(requested_batch_size, 250), 1),
    1000
  );
  activity_count integer := 0;
  sync_run_count integer := 0;
  sync_conflict_count integer := 0;
  expired_invite_count integer := 0;
  accepted_invite_count integer := 0;
  expired_reservation_count integer := 0;
  pending_attachment_count integer := 0;
  chat_message_count integer := 0;
  project_message_count integer := 0;
  project_comment_count integer := 0;
  project_doc_count integer := 0;
  project_file_count integer := 0;
  orphan_object_count integer := 0;
  missing_object_count integer := 0;
  candidate record;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise insufficient_privilege using message = 'Service role is required.';
  end if;

  if dry_run then
    select count(*) into activity_count from (
      select id from public.activity_events
      where created_at < now() - interval '365 days'
      order by created_at, id limit batch_size
    ) as candidates;
    select count(*) into sync_run_count from (
      select id from public.accelo_sync_runs
      where created_at < now() - interval '90 days'
      order by created_at, id limit batch_size
    ) as candidates;
    select count(*) into sync_conflict_count from (
      select id from public.sync_conflicts
      where resolution <> 'unresolved'
        and coalesce(resolved_at, updated_at) < now() - interval '90 days'
      order by coalesce(resolved_at, updated_at), id limit batch_size
    ) as candidates;
    select count(*) into expired_invite_count from (
      select id from public.invites
      where status in ('expired', 'revoked')
        and updated_at < now() - interval '90 days'
      order by updated_at, id limit batch_size
    ) as candidates;
    select count(*) into accepted_invite_count from (
      select id from public.invites
      where status = 'accepted'
        and coalesce(accepted_at, updated_at) < now() - interval '365 days'
      order by coalesce(accepted_at, updated_at), id limit batch_size
    ) as candidates;
    select count(*) into expired_reservation_count from (
      select id from public.upload_reservations
      where status = 'pending' and expires_at <= now()
      order by expires_at, id limit batch_size
    ) as candidates;
    select count(*) into pending_attachment_count from (
      select id from public.workspace_message_attachments
      where message_id is null
        and created_at < now() - interval '24 hours'
      order by created_at, id limit batch_size
    ) as candidates;
  else
    with candidates as (
      select id from public.activity_events
      where created_at < now() - interval '365 days'
      order by created_at, id
      for update skip locked limit batch_size
    )
    delete from public.activity_events as target
    using candidates
    where target.id = candidates.id;
    get diagnostics activity_count = row_count;

    with candidates as (
      select id from public.accelo_sync_runs
      where created_at < now() - interval '90 days'
      order by created_at, id
      for update skip locked limit batch_size
    )
    delete from public.accelo_sync_runs as target
    using candidates
    where target.id = candidates.id;
    get diagnostics sync_run_count = row_count;

    with candidates as (
      select id from public.sync_conflicts
      where resolution <> 'unresolved'
        and coalesce(resolved_at, updated_at) < now() - interval '90 days'
      order by coalesce(resolved_at, updated_at), id
      for update skip locked limit batch_size
    )
    delete from public.sync_conflicts as target
    using candidates
    where target.id = candidates.id;
    get diagnostics sync_conflict_count = row_count;

    with candidates as (
      select id from public.invites
      where status in ('expired', 'revoked')
        and updated_at < now() - interval '90 days'
      order by updated_at, id
      for update skip locked limit batch_size
    )
    delete from public.invites as target
    using candidates
    where target.id = candidates.id;
    get diagnostics expired_invite_count = row_count;

    with candidates as (
      select id from public.invites
      where status = 'accepted'
        and coalesce(accepted_at, updated_at) < now() - interval '365 days'
      order by coalesce(accepted_at, updated_at), id
      for update skip locked limit batch_size
    )
    delete from public.invites as target
    using candidates
    where target.id = candidates.id;
    get diagnostics accepted_invite_count = row_count;

    for candidate in
      with candidates as (
        select id from public.upload_reservations
        where status = 'pending' and expires_at <= now()
        order by expires_at, id
        for update skip locked limit batch_size
      )
      update public.upload_reservations as reservation
      set status = 'failed', failure_reason = 'reservation_expired'
      from candidates
      where reservation.id = candidates.id
      returning reservation.*
    loop
      expired_reservation_count := expired_reservation_count + 1;
      perform private.enqueue_storage_deletion(
        candidate.bucket_id,
        candidate.object_path,
        'expired_upload_reservation',
        jsonb_build_object('reservationId', candidate.id)
      );
    end loop;

    with candidates as (
      select id from public.workspace_message_attachments
      where message_id is null
        and created_at < now() - interval '24 hours'
      order by created_at, id
      for update skip locked limit batch_size
    )
    delete from public.workspace_message_attachments as target
    using candidates
    where target.id = candidates.id;
    get diagnostics pending_attachment_count = row_count;
  end if;

  if dry_run then
    select count(*) into chat_message_count from (
      select message.id
      from public.workspace_messages as message
      join public.workspace_conversations as conversation
        on conversation.id = message.conversation_id
      join public.organizations as organization
        on organization.id = conversation.organization_id
      where not private.has_legal_hold(organization.settings)
        and message.created_at < now() - make_interval(
          days => private.retention_days(
            organization.settings,
            'chat_retention_days',
            1095
          )
        )
      order by message.created_at, message.id limit batch_size
    ) as candidates;
  else
    with candidates as (
      select message.id
      from public.workspace_messages as message
      join public.workspace_conversations as conversation
        on conversation.id = message.conversation_id
      join public.organizations as organization
        on organization.id = conversation.organization_id
      where not private.has_legal_hold(organization.settings)
        and message.created_at < now() - make_interval(
          days => private.retention_days(
            organization.settings,
            'chat_retention_days',
            1095
          )
        )
      order by message.created_at, message.id
      for update of message skip locked limit batch_size
    )
    delete from public.workspace_messages as target
    using candidates
    where target.id = candidates.id;
    get diagnostics chat_message_count = row_count;
  end if;

  if dry_run then
    select count(*) into project_message_count from (
      select item.id
      from public.messages as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(
              project.metadata,
              'retention_days',
              1095
            ),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id limit batch_size
    ) as candidates;
    select count(*) into project_comment_count from (
      select item.id
      from public.comments as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id limit batch_size
    ) as candidates;
    select count(*) into project_doc_count from (
      select item.id
      from public.docs as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id limit batch_size
    ) as candidates;
    select count(*) into project_file_count from (
      select item.id
      from public.files as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id limit batch_size
    ) as candidates;
  else
    with candidates as (
      select item.id
      from public.messages as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id
      for update of item skip locked limit batch_size
    )
    delete from public.messages as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_message_count = row_count;

    with candidates as (
      select item.id
      from public.comments as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id
      for update of item skip locked limit batch_size
    )
    delete from public.comments as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_comment_count = row_count;

    with candidates as (
      select item.id
      from public.docs as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id
      for update of item skip locked limit batch_size
    )
    delete from public.docs as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_doc_count = row_count;

    with candidates as (
      select item.id
      from public.files as item
      join public.projects as project on project.id = item.project_id
      join public.organizations as organization
        on organization.id = project.organization_id
      where not private.has_legal_hold(project.metadata)
        and not private.has_legal_hold(organization.settings)
        and item.created_at < now() - make_interval(
          days => greatest(
            private.retention_days(project.metadata, 'retention_days', 1095),
            private.retention_days(
              organization.settings,
              'project_content_retention_days',
              1095
            )
          )
        )
      order by item.created_at, item.id
      for update of item skip locked limit batch_size
    )
    delete from public.files as target
    using candidates
    where target.id = candidates.id;
    get diagnostics project_file_count = row_count;
  end if;

  if dry_run then
    select count(*) into orphan_object_count from (
      select object.id
      from storage.objects as object
      where object.bucket_id in ('project-files', 'workspace-chat-files')
        and object.created_at < now() - interval '24 hours'
        and not exists (
          select 1 from public.files as file
          where file.bucket_id = object.bucket_id
            and file.object_path = object.name
        )
        and not exists (
          select 1 from public.workspace_message_attachments as attachment
          where attachment.bucket_id = object.bucket_id
            and attachment.object_path = object.name
        )
        and not exists (
          select 1 from public.upload_reservations as reservation
          where reservation.bucket_id = object.bucket_id
            and reservation.object_path = object.name
            and reservation.status = 'pending'
            and reservation.expires_at > now()
        )
      order by object.created_at, object.id limit batch_size
    ) as candidates;
  else
    for candidate in
      select object.bucket_id, object.name as object_path
      from storage.objects as object
      where object.bucket_id in ('project-files', 'workspace-chat-files')
        and object.created_at < now() - interval '24 hours'
        and not exists (
          select 1 from public.files as file
          where file.bucket_id = object.bucket_id
            and file.object_path = object.name
        )
        and not exists (
          select 1 from public.workspace_message_attachments as attachment
          where attachment.bucket_id = object.bucket_id
            and attachment.object_path = object.name
        )
        and not exists (
          select 1 from public.upload_reservations as reservation
          where reservation.bucket_id = object.bucket_id
            and reservation.object_path = object.name
            and reservation.status = 'pending'
            and reservation.expires_at > now()
        )
      order by object.created_at, object.id limit batch_size
    loop
      orphan_object_count := orphan_object_count + 1;
      insert into public.storage_reconciliation_issues (
        issue_type,
        bucket_id,
        object_path
      )
      values ('orphan_object', candidate.bucket_id, candidate.object_path)
      on conflict (issue_type, bucket_id, object_path) do update
      set last_seen_at = now(), resolved_at = null;
      perform private.enqueue_storage_deletion(
        candidate.bucket_id,
        candidate.object_path,
        'orphan_storage_object',
        '{}'::jsonb
      );
    end loop;
  end if;

  select count(*) into missing_object_count from (
    select file.id
    from public.files as file
    where not exists (
      select 1 from storage.objects as object
      where object.bucket_id = file.bucket_id
        and object.name = file.object_path
    )
    union all
    select attachment.id
    from public.workspace_message_attachments as attachment
    where not exists (
      select 1 from storage.objects as object
      where object.bucket_id = attachment.bucket_id
        and object.name = attachment.object_path
    )
    limit batch_size
  ) as candidates;

  if not dry_run then
    insert into public.storage_reconciliation_issues (
      issue_type,
      bucket_id,
      object_path,
      metadata
    )
    select
      'missing_object',
      file.bucket_id,
      file.object_path,
      jsonb_build_object('resourceId', file.id, 'targetKind', 'project_file')
    from public.files as file
    where not exists (
      select 1 from storage.objects as object
      where object.bucket_id = file.bucket_id
        and object.name = file.object_path
    )
    order by file.created_at, file.id
    limit batch_size
    on conflict (issue_type, bucket_id, object_path) do update
    set
      last_seen_at = now(),
      resolved_at = null,
      metadata = excluded.metadata;

    insert into public.storage_reconciliation_issues (
      issue_type,
      bucket_id,
      object_path,
      metadata
    )
    select
      'missing_object',
      attachment.bucket_id,
      attachment.object_path,
      jsonb_build_object(
        'resourceId',
        attachment.id,
        'targetKind',
        'chat_attachment'
      )
    from public.workspace_message_attachments as attachment
    where not exists (
      select 1 from storage.objects as object
      where object.bucket_id = attachment.bucket_id
        and object.name = attachment.object_path
    )
    order by attachment.created_at, attachment.id
    limit batch_size
    on conflict (issue_type, bucket_id, object_path) do update
    set
      last_seen_at = now(),
      resolved_at = null,
      metadata = excluded.metadata;
  end if;

  return jsonb_build_object(
    'dryRun', dry_run,
    'batchSize', batch_size,
    'retention', jsonb_build_object(
      'activity365Days', activity_count,
      'syncRuns90Days', sync_run_count,
      'resolvedSyncConflicts90Days', sync_conflict_count,
      'expiredRevokedInvites90Days', expired_invite_count,
      'acceptedInvites365Days', accepted_invite_count,
      'pendingUploads24Hours', expired_reservation_count,
      'pendingChatAttachments24Hours', pending_attachment_count,
      'chatContent1095Days', chat_message_count,
      'projectMessages1095Days', project_message_count,
      'projectComments1095Days', project_comment_count,
      'projectDocs1095Days', project_doc_count,
      'projectFiles1095Days', project_file_count
    ),
    'reconciliation', jsonb_build_object(
      'orphanObjects', orphan_object_count,
      'missingObjects', missing_object_count
    )
  );
end;
$$;

revoke all on function private.run_operations_cleanup(integer, boolean)
  from public;
grant execute on function private.run_operations_cleanup(integer, boolean)
  to service_role;

create or replace function public.run_operations_cleanup(
  requested_batch_size integer default 250,
  dry_run boolean default true
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.run_operations_cleanup(requested_batch_size, dry_run);
$$;

revoke all on function public.run_operations_cleanup(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.run_operations_cleanup(integer, boolean)
  to service_role;
