begin;

select extensions.plan(14);

select extensions.has_table('public', 'project_cycles', 'project cycles exist');
select extensions.has_table('public', 'time_entry_timers', 'durable timers exist');
select extensions.has_column('public', 'todos', 'milestone_id', 'issues link milestones');
select extensions.has_column('public', 'todos', 'cycle_id', 'issues link cycles');
select extensions.has_column('public', 'todos', 'risk_level', 'issues expose risk');
select extensions.has_column('public', 'milestones', 'risk_level', 'milestones expose risk');
select extensions.has_column(
  'public',
  'retainer_periods',
  'forecast_minutes',
  'retainer periods support forecasts'
);
select extensions.has_column(
  'public',
  'retainer_periods',
  'locked_at',
  'retainer periods support locks'
);
select extensions.has_column(
  'public',
  'retainer_periods',
  'invoiced_at',
  'retainer periods expose invoice state'
);
select extensions.has_function(
  'public',
  'start_time_timer',
  array['uuid', 'uuid', 'uuid', 'text', 'boolean'],
  'timer start RPC exists'
);
select extensions.has_function(
  'public',
  'stop_time_timer',
  array['uuid', 'timestamp with time zone'],
  'timer stop RPC exists'
);
select extensions.has_function(
  'public',
  'discard_time_timer',
  array['uuid'],
  'timer discard RPC exists'
);
select extensions.is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.project_cycles'::regclass
  ),
  true,
  'cycles enforce RLS'
);
select extensions.is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'public.time_entry_timers'::regclass
  ),
  true,
  'timers enforce RLS'
);

select * from extensions.finish();
rollback;
