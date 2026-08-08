-- Queue subscriber notifications in the same transaction as canonical writes.
-- Delivery remains asynchronous through the leased Slack outbox worker.

create or replace function private.queue_todo_completion_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscriber record;
begin
  if new.status <> 'done'
    or old.status = 'done'
    or new.completed_at is null
  then
    return new;
  end if;

  for subscriber in
    select distinct nullif(btrim(profile.preferences ->> 'slack_user_id'), '')
      as channel
    from public.todo_completion_subscribers as subscription
    join public.profiles as profile
      on profile.id = subscription.profile_id
     and profile.status = 'active'
    where subscription.todo_id = new.id
      and subscription.profile_id is distinct from new.completed_by
      and nullif(btrim(profile.preferences ->> 'slack_user_id'), '') is not null
  loop
    insert into public.slack_notification_outbox (
      event_type,
      channel,
      payload,
      idempotency_key
    )
    values (
      'todo.completed',
      subscriber.channel,
      jsonb_build_object(
        'text', 'Completed: ' || new.title,
        'metadata', jsonb_build_object(
          'todoId', new.id,
          'projectId', new.project_id
        )
      ),
      format(
        'todo.completed:%s:%s:%s',
        new.id,
        new.version,
        subscriber.channel
      )
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function private.queue_todo_completion_notifications()
  from public;

drop trigger if exists queue_todo_completion_notifications
  on public.todos;
create trigger queue_todo_completion_notifications
after update of status on public.todos
for each row execute function private.queue_todo_completion_notifications();

create or replace function private.queue_todo_comment_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscriber record;
  todo_title text;
begin
  if new.todo_id is null
    or new.created_at < statement_timestamp() - interval '5 minutes'
  then
    return new;
  end if;

  select todo.title
  into todo_title
  from public.todos as todo
  where todo.id = new.todo_id
    and todo.project_id = new.project_id;

  if todo_title is null then
    return new;
  end if;

  for subscriber in
    select distinct nullif(btrim(profile.preferences ->> 'slack_user_id'), '')
      as channel
    from public.todo_completion_subscribers as subscription
    join public.profiles as profile
      on profile.id = subscription.profile_id
     and profile.status = 'active'
    where subscription.todo_id = new.todo_id
      and subscription.profile_id is distinct from new.author_id
      and nullif(btrim(profile.preferences ->> 'slack_user_id'), '') is not null
  loop
    insert into public.slack_notification_outbox (
      event_type,
      channel,
      payload,
      idempotency_key
    )
    values (
      'todo.comment.created',
      subscriber.channel,
      jsonb_build_object(
        'text',
        format(
          'New comment on %s: %s',
          todo_title,
          left(regexp_replace(new.body, '\s+', ' ', 'g'), 180)
        ),
        'metadata', jsonb_build_object(
          'commentId', new.id,
          'todoId', new.todo_id,
          'projectId', new.project_id
        )
      ),
      format(
        'todo.comment.created:%s:%s',
        new.id,
        subscriber.channel
      )
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function private.queue_todo_comment_notifications()
  from public;

drop trigger if exists queue_todo_comment_notifications
  on public.comments;
create trigger queue_todo_comment_notifications
after insert on public.comments
for each row execute function private.queue_todo_comment_notifications();
