-- Preserve Accelo milestone identity and raw source data. Milestone names are
-- not globally unique within a job, so synchronization keys off the Accelo ID.

alter table public.milestones
  add column accelo_milestone_id text,
  add column accelo_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(accelo_payload) = 'object');

alter table public.milestones
  drop constraint milestones_project_id_name_key;

create unique index milestones_accelo_id_unique_idx
  on public.milestones (project_id, accelo_milestone_id)
  where accelo_milestone_id is not null;
