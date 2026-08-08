-- Basecamp-style work threads: multiple assignees, completion subscribers,
-- subtasks, mentions, and comment attachments. The existing todos.assigned_to
-- remains the primary Accelo assignee for two-way synchronization.

alter table public.todos
  add column completed_by uuid references public.profiles(id) on delete set null;

create table public.todo_assignees (
  todo_id uuid not null references public.todos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (todo_id, profile_id)
);

create index todo_assignees_profile_idx
  on public.todo_assignees (profile_id, created_at desc);

insert into public.todo_assignees (todo_id, profile_id)
select id, assigned_to
from public.todos
where assigned_to is not null
on conflict do nothing;

create table public.todo_completion_subscribers (
  todo_id uuid not null references public.todos(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (todo_id, profile_id)
);

create index todo_completion_subscribers_profile_idx
  on public.todo_completion_subscribers (profile_id, created_at desc);

create table public.todo_subtasks (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  position integer not null default 0 check (position >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todo_subtasks_completion_consistent check (
    (completed_at is null and completed_by is null)
    or (completed_at is not null and completed_by is not null)
  )
);

create index todo_subtasks_todo_position_idx
  on public.todo_subtasks (todo_id, position);

create table public.comment_mentions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, profile_id)
);

create index comment_mentions_profile_idx
  on public.comment_mentions (profile_id, created_at desc);

create table public.comment_attachments (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  file_id uuid references public.files(id) on delete cascade,
  external_url text,
  title text,
  created_at timestamptz not null default now(),
  constraint comment_attachments_one_source check (
    num_nonnulls(file_id, external_url) = 1
  ),
  constraint comment_attachments_external_url_http check (
    external_url is null or external_url ~ '^https?://'
  )
);

create index comment_attachments_comment_idx
  on public.comment_attachments (comment_id, created_at);

create trigger set_todo_subtasks_updated_at
  before update on public.todo_subtasks
  for each row execute function private.set_updated_at();

alter table public.todo_assignees enable row level security;
alter table public.todo_completion_subscribers enable row level security;
alter table public.todo_subtasks enable row level security;
alter table public.comment_mentions enable row level security;
alter table public.comment_attachments enable row level security;

create policy "Active internal users can access todo assignees"
on public.todo_assignees for all to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy "Active internal users can access completion subscribers"
on public.todo_completion_subscribers for all to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy "Active internal users can access todo subtasks"
on public.todo_subtasks for all to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy "Active internal users can access comment mentions"
on public.comment_mentions for all to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));

create policy "Active internal users can access comment attachments"
on public.comment_attachments for all to authenticated
using ((select private.is_internal_user()))
with check ((select private.is_internal_user()));
