-- PostgREST represents insert-with-returning as a data-modifying CTE. During
-- that statement, helper functions that re-query the target table cannot see
-- the newly inserted row. Authorize ordinary organization/project rows from
-- their row values, while retaining helper checks for explicitly shared rows.

drop policy if exists "Members can read accessible files" on public.files;
create policy "Members can read accessible files"
on public.files for select to authenticated
using (
  (
    project_id is null
    and (select private.has_organization_role(
      organization_id,
      array['admin', 'manager', 'member']::text[]
    ))
  )
  or (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (select private.can_access_file(id))
);

drop policy if exists "Members can read accessible folders"
  on public.file_folders;
create policy "Members can read accessible folders"
on public.file_folders for select to authenticated
using (
  (
    project_id is null
    and (select private.has_organization_role(
      organization_id,
      array['admin', 'manager', 'member']::text[]
    ))
  )
  or (
    project_id is not null
    and (select private.can_access_project(project_id))
  )
  or (select private.can_access_file_folder(id))
);
