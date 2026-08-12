begin;

select extensions.plan(12);

select extensions.has_table('public', 'file_folders', 'file folders exist');
select extensions.has_table('public', 'file_versions', 'file versions exist');
select extensions.has_table('public', 'file_shares', 'file shares exist');
select extensions.has_table('public', 'file_comments', 'file comments exist');
select extensions.has_table('public', 'file_favorites', 'file favorites exist');
select extensions.has_column('public', 'files', 'organization_id', 'files are organization scoped');
select extensions.has_column('public', 'files', 'folder_id', 'files support folders');
select extensions.has_column('public', 'files', 'current_version_id', 'files track a current version');
select extensions.has_column('public', 'files', 'trashed_at', 'files support recoverable trash');
select extensions.has_column(
  'public',
  'workspace_cross_links',
  'folder_id',
  'folders participate in workspace cross-links'
);

insert into public.organizations (id, name, slug)
values (
  '8a000000-0000-4000-8000-000000000001',
  'File workspace test',
  'file-workspace-test'
);

insert into public.file_folders (id, organization_id, name)
values (
  '8a000000-0000-4000-8000-000000000010',
  '8a000000-0000-4000-8000-000000000001',
  'Creative Resources'
);

select extensions.throws_ok(
  $$
    insert into public.file_folders (organization_id, name)
    values (
      '8a000000-0000-4000-8000-000000000001',
      'creative resources'
    )
  $$,
  '23505',
  null,
  'active sibling folder names are case-insensitively unique'
);

select extensions.throws_ok(
  $$
    update public.file_folders
    set parent_id = '8a000000-0000-4000-8000-000000000010'
    where id = '8a000000-0000-4000-8000-000000000010'
  $$,
  '23514',
  'A folder cannot contain itself.',
  'folder cycles are rejected'
);

select * from extensions.finish();
rollback;
