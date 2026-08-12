-- Accelo contact identity is provider-qualified. Shared inboxes and duplicate
-- historical contacts legitimately reuse an email address.
drop index public.contacts_organization_email_key;

create index contacts_organization_email_idx
  on public.contacts (organization_id, lower(email))
  where email is not null;
