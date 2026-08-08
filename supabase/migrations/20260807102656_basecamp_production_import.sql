-- Basecamp identities and recordings are durable production data, not Auth
-- accounts or demo fixtures. Profiles may represent people who do not yet have
-- access; when invited, their Auth user is created with the same UUID.

alter table public.profiles
  drop constraint profiles_id_fkey,
  add column basecamp_account_id bigint,
  add column basecamp_person_id bigint,
  add column person_type text,
  add column company_name text,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

comment on column public.profiles.id is
  'Workspace person ID. Auth-enabled people use this same UUID in auth.users.';

create unique index profiles_basecamp_person_unique_idx
  on public.profiles (organization_id, basecamp_person_id)
  where basecamp_person_id is not null;

alter table public.projects
  add column basecamp_account_id bigint,
  add column basecamp_project_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

create unique index projects_basecamp_project_unique_idx
  on public.projects (organization_id, basecamp_project_id)
  where basecamp_project_id is not null;

alter table public.project_members
  add column source text,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

alter table public.todo_lists
  add column basecamp_todolist_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

create unique index todo_lists_basecamp_todolist_unique_idx
  on public.todo_lists (project_id, basecamp_todolist_id)
  where basecamp_todolist_id is not null;

alter table public.todos
  add column basecamp_todo_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

alter table public.todos
  drop constraint todos_completion_consistent,
  add constraint todos_completion_consistent check (
    (
      status = 'done'
      and (completed_at is not null or basecamp_todo_id is not null)
    )
    or status <> 'done'
  );

create unique index todos_basecamp_todo_unique_idx
  on public.todos (project_id, basecamp_todo_id)
  where basecamp_todo_id is not null;

alter table public.todo_assignees
  add column source text,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

alter table public.todo_completion_subscribers
  add column source text,
  add column source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload) = 'object');

alter table public.todo_subtasks
  add column basecamp_subtask_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

create unique index todo_subtasks_basecamp_subtask_unique_idx
  on public.todo_subtasks (todo_id, basecamp_subtask_id)
  where basecamp_subtask_id is not null;

alter table public.messages
  add column basecamp_message_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

create unique index messages_basecamp_message_unique_idx
  on public.messages (project_id, basecamp_message_id)
  where basecamp_message_id is not null;

alter table public.comments
  add column basecamp_comment_id bigint,
  add column basecamp_recording_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

create unique index comments_basecamp_comment_unique_idx
  on public.comments (project_id, basecamp_comment_id)
  where basecamp_comment_id is not null;

alter table public.docs
  add column basecamp_document_id bigint,
  add column basecamp_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(basecamp_payload) = 'object');

create unique index docs_basecamp_document_unique_idx
  on public.docs (project_id, basecamp_document_id)
  where basecamp_document_id is not null;
