alter table public.invoices
  add column subject text not null default 'Professional services'
    check (char_length(btrim(subject)) between 1 and 240),
  add column attention_to text
    check (attention_to is null or char_length(btrim(attention_to)) <= 240),
  add column billing_address jsonb not null default '{}'::jsonb
    check (jsonb_typeof(billing_address) = 'object'),
  add column service_period_start date,
  add column service_period_end date,
  add column payment_instructions text,
  add column payment_terms text,
  add constraint invoices_service_period_valid check (
    service_period_start is null
    or service_period_end is null
    or service_period_end >= service_period_start
  );

alter table public.invoice_line_items
  drop constraint invoice_line_items_unit_amount_cents_check,
  drop constraint invoice_line_items_amount_cents_check,
  add column item_type text not null default 'service'
    check (item_type in ('service', 'material', 'fee', 'deposit', 'credit')),
  add column details text,
  add column retainer_id uuid,
  add column retainer_period_id uuid,
  add column service_period_start date,
  add column service_period_end date,
  add constraint invoice_line_items_unit_amount_valid check (
    unit_amount_cents between -1000000000000 and 1000000000000
  ),
  add constraint invoice_line_items_amount_valid check (
    amount_cents between -1000000000000 and 1000000000000
  ),
  add constraint invoice_line_items_credit_sign_valid check (
    (item_type = 'credit' and amount_cents <= 0)
    or (item_type <> 'credit' and amount_cents >= 0)
  ),
  add constraint invoice_line_items_service_period_valid check (
    service_period_start is null
    or service_period_end is null
    or service_period_end >= service_period_start
  ),
  add constraint invoice_line_items_organization_retainer_fkey
    foreign key (organization_id, retainer_id)
    references public.retainers(organization_id, id) on delete restrict,
  add constraint invoice_line_items_organization_retainer_period_fkey
    foreign key (organization_id, retainer_period_id)
    references public.retainer_periods(organization_id, id) on delete restrict;

create index invoice_line_items_retainer_idx
  on public.invoice_line_items (retainer_id, retainer_period_id, invoice_id)
  where retainer_id is not null;

create or replace function private.create_detailed_invoice(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_subject text,
  target_attention_to text,
  target_billing_address jsonb,
  target_issue_date date,
  target_due_date date,
  target_service_period_start date,
  target_service_period_end date,
  target_currency text,
  target_line_items jsonb,
  target_tax_cents bigint,
  target_notes text,
  target_payment_instructions text,
  target_payment_terms text
)
returns public.invoices
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := (select private.current_organization_id());
  result public.invoices%rowtype;
  line_item jsonb;
  line_position integer := 0;
  line_quantity numeric(12,4);
  line_unit_cents bigint;
  line_type text;
  line_retainer_id uuid;
  line_retainer_period_id uuid;
begin
  if jsonb_typeof(target_line_items) <> 'array'
    or jsonb_array_length(target_line_items) not between 1 and 500
    or target_tax_cents < 0
    or target_due_date < target_issue_date
    or char_length(btrim(target_subject)) not between 1 and 240
    or target_currency !~ '^[A-Z]{3}$'
    or jsonb_typeof(coalesce(target_billing_address, '{}'::jsonb)) <> 'object'
    or (
      target_service_period_start is not null
      and target_service_period_end is not null
      and target_service_period_end < target_service_period_start
    )
  then
    raise check_violation using message = 'Invalid detailed invoice request.';
  end if;

  if not (select private.has_organization_role(
    target_organization_id, array['admin', 'manager']::text[]
  )) then
    raise insufficient_privilege using message = 'Manager billing access is required.';
  end if;

  if not exists (
    select 1 from public.clients as client
    where client.id = target_client_id
      and client.organization_id = target_organization_id
  ) or (
    target_project_id is not null and not exists (
      select 1 from public.projects as project
      where project.id = target_project_id
        and project.organization_id = target_organization_id
        and project.client_id = target_client_id
    )
  ) then
    raise check_violation using message = 'Invoice client or project is invalid.';
  end if;

  insert into public.invoices (
    organization_id, client_id, project_id, invoice_number, subject,
    attention_to, billing_address, status, issue_date, due_date,
    service_period_start, service_period_end, currency, notes,
    payment_instructions, payment_terms, created_by
  )
  values (
    target_organization_id, target_client_id, target_project_id,
    btrim(target_invoice_number), btrim(target_subject),
    nullif(btrim(target_attention_to), ''),
    coalesce(target_billing_address, '{}'::jsonb), 'draft',
    target_issue_date, target_due_date, target_service_period_start,
    target_service_period_end, target_currency::char(3), target_notes,
    target_payment_instructions, target_payment_terms, (select auth.uid())
  )
  returning * into result;

  for line_item in
    select value
    from jsonb_array_elements(target_line_items)
    order by (value ->> 'item_type' = 'credit')
  loop
    line_quantity := (line_item ->> 'quantity')::numeric;
    line_unit_cents := (line_item ->> 'unit_amount_cents')::bigint;
    line_type := coalesce(nullif(line_item ->> 'item_type', ''), 'service');
    line_retainer_id := nullif(line_item ->> 'retainer_id', '')::uuid;
    line_retainer_period_id :=
      nullif(line_item ->> 'retainer_period_id', '')::uuid;

    if line_quantity <= 0
      or line_type not in ('service', 'material', 'fee', 'deposit', 'credit')
      or char_length(btrim(line_item ->> 'description')) not between 1 and 500
      or (line_type = 'credit' and line_unit_cents > 0)
      or (line_type <> 'credit' and line_unit_cents < 0)
      or (
        line_retainer_id is not null
        and not exists (
          select 1
          from public.retainers as retainer
          where retainer.id = line_retainer_id
            and retainer.organization_id = target_organization_id
            and retainer.client_id = target_client_id
        )
      )
      or (
        line_retainer_period_id is not null
        and not exists (
          select 1
          from public.retainer_periods as period
          where period.id = line_retainer_period_id
            and period.organization_id = target_organization_id
            and (
              line_retainer_id is null
              or period.retainer_id = line_retainer_id
            )
        )
      )
    then
      raise check_violation using message = 'Invalid detailed invoice line.';
    end if;

    insert into public.invoice_line_items (
      organization_id, invoice_id, project_id, retainer_id,
      retainer_period_id, item_type, description, details,
      service_period_start, service_period_end, quantity,
      unit_amount_cents, amount_cents, position
    )
    values (
      target_organization_id, result.id,
      nullif(line_item ->> 'project_id', '')::uuid,
      line_retainer_id, line_retainer_period_id, line_type,
      btrim(line_item ->> 'description'),
      nullif(btrim(line_item ->> 'details'), ''),
      nullif(line_item ->> 'service_period_start', '')::date,
      nullif(line_item ->> 'service_period_end', '')::date,
      line_quantity, line_unit_cents,
      round(line_quantity * line_unit_cents)::bigint, line_position
    );
    line_position := line_position + 1;
  end loop;

  select invoice.* into result
  from public.invoices as invoice
  where invoice.id = result.id;

  if result.total_cents < 0 then
    raise check_violation using message = 'Invoice total cannot be negative.';
  end if;
  return result;
end;
$$;

create or replace function public.create_detailed_invoice(
  target_client_id uuid,
  target_project_id uuid,
  target_invoice_number text,
  target_subject text,
  target_attention_to text,
  target_billing_address jsonb,
  target_issue_date date,
  target_due_date date,
  target_service_period_start date,
  target_service_period_end date,
  target_currency text,
  target_line_items jsonb,
  target_tax_cents bigint default 0,
  target_notes text default null,
  target_payment_instructions text default null,
  target_payment_terms text default null
)
returns public.invoices
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_detailed_invoice(
    target_client_id, target_project_id, target_invoice_number,
    target_subject, target_attention_to, target_billing_address,
    target_issue_date, target_due_date, target_service_period_start,
    target_service_period_end, target_currency, target_line_items,
    target_tax_cents, target_notes, target_payment_instructions,
    target_payment_terms
  );
$$;

revoke all on function private.create_detailed_invoice(
  uuid, uuid, text, text, text, jsonb, date, date, date, date,
  text, jsonb, bigint, text, text, text
) from public;
grant execute on function private.create_detailed_invoice(
  uuid, uuid, text, text, text, jsonb, date, date, date, date,
  text, jsonb, bigint, text, text, text
) to authenticated, service_role;

revoke all on function public.create_detailed_invoice(
  uuid, uuid, text, text, text, jsonb, date, date, date, date,
  text, jsonb, bigint, text, text, text
) from public, anon;
grant execute on function public.create_detailed_invoice(
  uuid, uuid, text, text, text, jsonb, date, date, date, date,
  text, jsonb, bigint, text, text, text
) to authenticated, service_role;
