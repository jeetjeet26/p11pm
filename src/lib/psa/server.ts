import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { ZodType } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import {
  mapPsaRow,
  mapPsaRows,
  toDatabaseRow,
  toDatabaseUpdate,
} from "@/lib/psa/mappers";
import type { PsaRow } from "@/lib/psa/types";
import { createClient } from "@/lib/supabase/server";
import { forecastPeriodMinutes } from "@/lib/time-workflow";

type QueryValue = string | number | boolean;
type QueryInput = {
  limit: number;
  offset: number;
  q?: string;
} & Record<string, unknown>;

interface RouteContext {
  client: SupabaseClient;
  organizationId: string;
  userId: string;
}

export interface PsaRouteConfig<
  TQuery extends QueryInput,
  TCreate extends Record<string, unknown>,
  TUpdate extends { id: string } & Record<string, unknown>,
> {
  table: string;
  responseKey: string;
  querySchema: ZodType<TQuery>;
  createSchema: ZodType<TCreate>;
  updateSchema: ZodType<TUpdate>;
  select?: string;
  searchColumn?: string;
  orderColumn?: string;
  filters?: Partial<Record<keyof TQuery, string>>;
  fromColumn?: string;
  toColumn?: string;
  createDefaults?: (
    input: TCreate,
    context: RouteContext,
  ) => Record<string, unknown>;
  mapCreate?: (input: TCreate, context: RouteContext) => PsaRow;
  mapUpdate?: (input: TUpdate, context: RouteContext) => PsaRow;
}

type AnyConfig = PsaRouteConfig<
  QueryInput,
  Record<string, unknown>,
  { id: string } & Record<string, unknown>
>;

export function createPsaRouteHandlers(config: AnyConfig) {
  return {
    GET: (request: Request) => listRows(request, config),
    POST: (request: Request) => createRow(request, config),
    PATCH: (request: Request) => updateRow(request, config),
  };
}

async function listRows(request: Request, config: AnyConfig) {
  const parsed = config.querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return psaValidationError(parsed.error.issues[0]?.message);

  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;

  const input = parsed.data;
  let query = auth.client
    .from(config.table)
    .select(config.select ?? "*", { count: "exact" })
    .eq("organization_id", auth.organizationId);

  for (const [inputKey, column] of Object.entries(config.filters ?? {})) {
    const value = input[inputKey];
    if (
      column &&
      (typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean")
    ) {
      query = query.eq(column, value as QueryValue);
    }
  }
  if (input.from && config.fromColumn) {
    query = query.gte(config.fromColumn, input.from as string);
  }
  if (input.to && config.toColumn) {
    query = query.lte(config.toColumn, input.to as string);
  }
  if (input.q && config.searchColumn) {
    query = query.ilike(config.searchColumn, `%${escapeLike(input.q)}%`);
  }

  const { data, error, count } = await query
    .order(config.orderColumn ?? "created_at", { ascending: false })
    .range(input.offset, input.offset + input.limit - 1);
  if (error) return psaDatabaseError(`load ${config.responseKey}`, error);

  return Response.json({
    [config.responseKey]: mapPsaRows((data ?? []) as unknown as PsaRow[]),
    pagination: {
      limit: input.limit,
      offset: input.offset,
      total: count ?? 0,
    },
  });
}

async function createRow(request: Request, config: AnyConfig) {
  const body = await request.json().catch(() => null);
  const parsed = config.createSchema.safeParse(body);
  if (!parsed.success) return psaValidationError(parsed.error.issues[0]?.message);

  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;

  const row = {
    organization_id: auth.organizationId,
    ...(config.mapCreate?.(parsed.data, auth) ?? toDatabaseRow(parsed.data)),
    ...(config.createDefaults?.(parsed.data, auth) ?? {}),
  };
  const { data, error } = await auth.client
    .from(config.table)
    .insert(row)
    .select(config.select ?? "*")
    .single();
  if (error) return psaDatabaseError(`create ${config.responseKey}`, error);
  return Response.json(
    { [singular(config.responseKey)]: mapPsaRow(data as unknown as PsaRow) },
    { status: 201 },
  );
}

async function updateRow(request: Request, config: AnyConfig) {
  const body = await request.json().catch(() => null);
  const parsed = config.updateSchema.safeParse(body);
  if (!parsed.success) return psaValidationError(parsed.error.issues[0]?.message);

  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const update =
    config.mapUpdate?.(parsed.data, auth) ?? toDatabaseUpdate(parsed.data);
  if (!Object.keys(update).length) {
    return psaValidationError("Provide at least one field to update.");
  }

  const { data, error } = await auth.client
    .from(config.table)
    .update(update)
    .eq("id", parsed.data.id)
    .eq("organization_id", auth.organizationId)
    .select(config.select ?? "*")
    .maybeSingle();
  if (error) return psaDatabaseError(`update ${config.responseKey}`, error);
  if (!data) {
    return Response.json(
      { error: `${titleCase(singular(config.responseKey))} not found.` },
      { status: 404 },
    );
  }
  return Response.json({
    [singular(config.responseKey)]: mapPsaRow(data as unknown as PsaRow),
  });
}

export async function getPsaContext() {
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const viewer = await getViewer();
  if (!viewer) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return {
    ok: true as const,
    client,
    organizationId: viewer.organization.id,
    userId: viewer.user.id,
  };
}

export function psaValidationError(message?: string) {
  return Response.json(
    { error: message ?? "Invalid request." },
    { status: 400 },
  );
}

export function psaDatabaseError(
  operation: string,
  error: { code?: string; message?: string },
) {
  console.error(`Unable to ${operation}:`, error);
  const status =
    error.code === "42501"
      ? 403
      : error.code === "23505"
        ? 409
        : error.code === "PGRST116"
          ? 404
          : 400;
  return Response.json(
    { error: error.message ?? `Unable to ${operation}.` },
    { status },
  );
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function singular(value: string) {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  return value.endsWith("s") ? value.slice(0, -1) : value;
}

function titleCase(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function getClientsPageData({
  query = "",
  ownerId,
  parentClientId,
}: {
  query?: string;
  ownerId?: string;
  parentClientId?: string;
} = {}) {
  if (await psaDemoRequested()) {
    return {
      clients: [],
      totalCount: 0,
      hasMore: false,
      owners: [],
      accountOptions: [],
    };
  }
  const auth = await requiredPsaContext();
  let countQuery = auth.client
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.organizationId);
  if (ownerId) countQuery = countQuery.eq("account_owner_id", ownerId);
  if (parentClientId) countQuery = countQuery.eq("parent_client_id", parentClientId);
  const [{ data, error }, countResult, ownersResult, accountOptionsResult] =
    await Promise.all([
    auth.client.rpc("get_agency_clients", {
      after_name: null,
      after_client_id: null,
      requested_limit: 100,
      status_filters: null,
      text_filter: query || null,
    }),
    countQuery,
    auth.client
      .from("profiles")
      .select("id,full_name")
      .eq("organization_id", auth.organizationId)
      .eq("status", "active")
      .order("full_name"),
    auth.client
      .from("clients")
      .select("id,name")
      .eq("organization_id", auth.organizationId)
      .order("name")
      .limit(500),
  ]);
  if (error) throw error;
  if (countResult.error) throw countResult.error;
  const result = asRow(data);
  const rows = asRows(result.clients);
  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    const [owners, contacts] = await Promise.all([
      auth.client
        .from("profiles")
        .select("id")
        .eq("organization_id", auth.organizationId)
        .ilike("full_name", pattern)
        .limit(200),
      auth.client
        .from("contacts")
        .select("id")
        .eq("organization_id", auth.organizationId)
        .or(
          `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`,
        )
        .limit(500),
    ]);
    if (owners.error) throw owners.error;
    if (contacts.error) throw contacts.error;
    const contactIds = (contacts.data ?? []).map((contact) => contact.id);
    const links = contactIds.length
      ? await auth.client
          .from("client_contacts")
          .select("client_id")
          .eq("organization_id", auth.organizationId)
          .in("contact_id", contactIds)
      : { data: [], error: null };
    if (links.error) throw links.error;
    const relatedIds = new Set([
      ...(links.data ?? []).map((link) => link.client_id),
    ]);
    let relatedQuery = auth.client
      .from("clients")
      .select("*")
      .eq("organization_id", auth.organizationId);
    const ownerIds = (owners.data ?? []).map((owner) => owner.id);
    if (ownerIds.length && relatedIds.size) {
      relatedQuery = relatedQuery.or(
        `account_owner_id.in.(${ownerIds.join(",")}),id.in.(${[...relatedIds].join(",")})`,
      );
    } else if (ownerIds.length) {
      relatedQuery = relatedQuery.in("account_owner_id", ownerIds);
    } else if (relatedIds.size) {
      relatedQuery = relatedQuery.in("id", [...relatedIds]);
    } else {
      relatedQuery = relatedQuery.limit(0);
    }
    const related = await relatedQuery.limit(500);
    if (related.error) throw related.error;
    const seen = new Set(rows.map((row) => text(row.id)));
    for (const row of (related.data ?? []) as unknown as PsaRow[]) {
      if (!seen.has(text(row.id))) rows.push(row);
    }
  }
  const clientIds = rows.map((row) => text(row.id)).filter(Boolean);
  const ownerIds = rows
    .map((row) => text(row.account_owner_id))
    .filter(Boolean);
  const parentIds = rows
    .map((row) => text(row.parent_client_id))
    .filter(Boolean);
  const [owners, parents, contacts] = await Promise.all([
    ownerIds.length
      ? auth.client
          .from("profiles")
          .select("id,full_name")
          .eq("organization_id", auth.organizationId)
          .in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    parentIds.length
      ? auth.client
          .from("clients")
          .select("id,name")
          .eq("organization_id", auth.organizationId)
          .in("id", parentIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? auth.client
          .from("client_contacts")
          .select("client_id,contact:contacts(first_name,last_name)")
          .eq("organization_id", auth.organizationId)
          .eq("is_primary", true)
          .in("client_id", clientIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const relatedError = owners.error ?? parents.error ?? contacts.error;
  if (relatedError) throw relatedError;
  const ownerNames = new Map(
    (owners.data ?? []).map((owner) => [owner.id, owner.full_name]),
  );
  const parentNames = new Map(
    (parents.data ?? []).map((parent) => [parent.id, parent.name]),
  );
  const contactNames = new Map(
    (contacts.data ?? []).map((link) => {
      const contact = firstRow(link.contact);
      return [
        link.client_id,
        [text(contact.first_name), text(contact.last_name)]
          .filter(Boolean)
          .join(" "),
      ];
    }),
  );
  let clients = rows.map((row) =>
    mapClientSummary(row, { ownerNames, parentNames, contactNames }),
  );
  if (ownerId) {
    clients = clients.filter((client) => client.ownerId === ownerId);
  }
  if (parentClientId) {
    clients = clients.filter((client) => client.parentClientId === parentClientId);
  }
  if (ownersResult.error) throw ownersResult.error;
  if (accountOptionsResult.error) throw accountOptionsResult.error;
  return {
    clients,
    totalCount:
      ownerId || parentClientId || query
        ? clients.length
        : (countResult.count ?? clients.length),
    hasMore: result.has_more === true,
    owners: (ownersResult.data ?? []).map((owner) => ({
      id: owner.id,
      name: owner.full_name,
    })),
    accountOptions: (accountOptionsResult.data ?? []).map((account) => ({
      id: account.id,
      name: account.name,
    })),
  };
}

export async function getClientDetailData(clientId: string) {
  if (await psaDemoRequested()) return null;
  const auth = await requiredPsaContext();
  const { data, error } = await auth.client.rpc("get_client_operations", {
    target_client_id: clientId,
    requested_activity_limit: 100,
    requested_time_limit: 100,
    requested_invoice_limit: 100,
  });
  if (error) throw error;
  if (!data) return null;
  const result = asRow(data);
  const clientRow = asRow(result.client);
  if (!clientRow.id) return null;

  const [contactResult, retainerResult] = await Promise.all([
    auth.client
      .from("client_contacts")
      .select(
        "id,is_primary,receives_invoices,role,position,contact:contacts!inner(id,first_name,last_name,email,phone,title,status)",
      )
      .eq("organization_id", auth.organizationId)
      .eq("client_id", clientId)
      .limit(200),
    auth.client
      .from("retainers")
      .select("*,client:clients(name),retainer_periods(*)")
      .eq("organization_id", auth.organizationId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (contactResult.error) throw contactResult.error;
  if (retainerResult.error) throw retainerResult.error;
  const contactLinks = (contactResult.data ?? []) as unknown as PsaRow[];
  const contactIds = contactLinks
    .map((link) => text(firstRow(link.contact).id))
    .filter(Boolean);
  const ownerId = text(clientRow.account_owner_id);
  const parentClientId = text(clientRow.parent_client_id);
  const [ownerResult, parentResult, affiliationResult] = await Promise.all([
    ownerId
      ? auth.client
          .from("profiles")
          .select("id,full_name")
          .eq("id", ownerId)
          .eq("organization_id", auth.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    parentClientId
      ? auth.client
          .from("clients")
          .select("id,name")
          .eq("id", parentClientId)
          .eq("organization_id", auth.organizationId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contactIds.length
      ? auth.client
          .from("client_contacts")
          .select("id,client_id,contact_id,role,is_primary,client:clients(name)")
          .eq("organization_id", auth.organizationId)
          .in("contact_id", contactIds)
          .order("is_primary", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const relatedError =
    ownerResult.error ?? parentResult.error ?? affiliationResult.error;
  if (relatedError) throw relatedError;
  const affiliationsByContact = new Map<string, PsaRow[]>();
  for (const affiliation of (affiliationResult.data ?? []) as unknown as PsaRow[]) {
    const contactId = text(affiliation.contact_id);
    affiliationsByContact.set(contactId, [
      ...(affiliationsByContact.get(contactId) ?? []),
      affiliation,
    ]);
  }

  return {
    client: mapClientSummary(clientRow, {
      ownerNames: new Map(
        ownerResult.data
          ? [[ownerResult.data.id, ownerResult.data.full_name]]
          : [],
      ),
      parentNames: new Map(
        parentResult.data
          ? [[parentResult.data.id, parentResult.data.name]]
          : [],
      ),
    }),
    contacts: contactLinks.map((link) => {
      const contact = firstRow(link.contact);
      const contactId = text(contact.id);
      return {
        id: contactId,
        affiliationId: text(link.id),
        name: [text(contact.first_name), text(contact.last_name)]
          .filter(Boolean)
          .join(" "),
        email: nullableText(contact.email),
        phone: nullableText(contact.phone),
        title: nullableText(contact.title),
        status: nullableText(contact.status),
        isPrimary: link.is_primary === true,
        receivesInvoices: link.receives_invoices === true,
        role: nullableText(link.role),
        position: nullableText(link.position),
        affiliations: (affiliationsByContact.get(contactId) ?? []).map(
          (affiliation) => ({
            id: text(affiliation.id),
            clientId: text(affiliation.client_id),
            clientName: text(firstRow(affiliation.client).name),
            role: nullableText(affiliation.role),
            isPrimary: affiliation.is_primary === true,
          }),
        ),
      };
    }),
    projects: asRows(result.projects).map((project) => ({
      id: text(project.id),
      name: text(project.name),
      code: nullableText(project.code),
      status: nullableText(project.status),
    })),
    retainers: ((retainerResult.data ?? []) as unknown as PsaRow[]).map(
      mapRetainerSummary,
    ),
    activities: asRows(result.activities).map((activity) => ({
      id: text(activity.id),
      type: nullableText(activity.activity_type),
      subject: text(activity.subject),
      body: nullableText(activity.body),
      occurredAt: text(activity.occurred_at),
    })),
    receivables: asRows(result.invoices)
      .filter((invoice) => Number(invoice.balance_cents ?? 0) > 0)
      .map((invoice) => ({
        id: text(invoice.id),
        reference: nullableText(invoice.invoice_number),
        status: nullableText(invoice.status),
        amount: cents(invoice.balance_cents),
        dueDate: nullableText(invoice.due_date),
      })),
  };
}

export async function getClientFormOptions() {
  if (await psaDemoRequested()) return { clients: [], owners: [] };
  const auth = await requiredPsaContext();
  const [clients, owners] = await Promise.all([
    auth.client
      .from("clients")
      .select("id,name")
      .eq("organization_id", auth.organizationId)
      .order("name")
      .limit(1_000),
    auth.client
      .from("profiles")
      .select("id,full_name")
      .eq("organization_id", auth.organizationId)
      .eq("status", "active")
      .order("full_name")
      .limit(1_000),
  ]);
  const error = clients.error ?? owners.error;
  if (error) throw error;
  return {
    clients: clients.data ?? [],
    owners: owners.data ?? [],
  };
}

export async function getRetainersPageData() {
  if (await psaDemoRequested()) {
    return { retainers: [], clients: [], totalCount: 0 };
  }
  const auth = await requiredPsaContext();
  const [retainers, clients, periods] = await Promise.all([
    auth.client.rpc("get_retainers_overview", { requested_limit: 200 }),
    auth.client
      .from("clients")
      .select("id,name")
      .eq("organization_id", auth.organizationId)
      .order("name")
      .limit(500),
    auth.client
      .from("retainer_periods")
      .select("*")
      .neq("status", "cancelled")
      .order("period_start", { ascending: false })
      .limit(1_000),
  ]);
  if (retainers.error) throw retainers.error;
  if (clients.error) throw clients.error;
  if (periods.error) throw periods.error;
  const periodById = new Map<string, PsaRow>();
  for (const period of (periods.data ?? []) as unknown as PsaRow[]) {
    periodById.set(text(period.id), period);
  }
  return {
    retainers: asRows(retainers.data).map((retainer) =>
      mapRetainerSummary({
        ...retainer,
        client: { name: retainer.client_name },
        retainer_periods: retainer.current_period_id
          ? [{
              ...periodById.get(text(retainer.current_period_id)),
              id: retainer.current_period_id,
              period_start: retainer.period_start,
              period_end: retainer.period_end,
              included_minutes: retainer.period_included_minutes,
              rollover_minutes: retainer.rollover_minutes,
              fee_cents: retainer.period_fee_cents,
              used_minutes: retainer.used_minutes,
            }]
          : [],
      }),
    ),
    clients: ((clients.data ?? []) as unknown as PsaRow[]).map((client) => ({
      id: text(client.id),
      name: text(client.name),
    })),
    totalCount: asRows(retainers.data).length,
  };
}

export async function getRetainerDetailData(retainerId: string) {
  if (await psaDemoRequested()) return null;
  const auth = await requiredPsaContext();
  const { data, error } = await auth.client.rpc("get_retainer_burn_report", {
    target_retainer_id: retainerId,
    from_period_start: null,
    requested_limit: 60,
  });
  if (error) throw error;
  if (!data) return null;
  const result = asRow(data);
  const retainerRow = asRow(result.retainer);
  if (!retainerRow.id) return null;
  const { data: client, error: clientError } = await auth.client
    .from("clients")
    .select("name")
    .eq("id", text(retainerRow.client_id))
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (clientError) throw clientError;
  retainerRow.client = client ?? null;
  return {
    retainer: mapRetainerSummary(retainerRow),
    periods: asRows(result.periods).map((period) => {
      const usedMinutes = period.external_id
        ? Number(period.consumed_minutes ?? period.used_minutes ?? 0)
        : Number(period.used_minutes ?? 0);
      return {
      id: text(period.id),
      periodStart: text(period.period_start),
      periodEnd: text(period.period_end),
      allowanceHours:
        Number(period.included_minutes ?? 0) / 60 +
        Number(period.rollover_minutes ?? 0) / 60,
      rolloverHours: Number(period.rollover_minutes ?? 0) / 60,
      loggedHours: usedMinutes / 60,
      billableHours: usedMinutes / 60,
      projectedHours: projectedPeriodHours({ ...period, used_minutes: usedMinutes }),
      forecastHours:
        period.forecast_minutes === null || period.forecast_minutes === undefined
          ? null
          : Number(period.forecast_minutes) / 60,
      value: cents(period.fee_cents),
      status: nullableText(period.status),
      lockedAt: nullableText(period.locked_at),
      invoicedAt: nullableText(period.invoiced_at),
      externalId: nullableText(period.external_id),
      };
    }),
  };
}

function projectedPeriodHours(period: PsaRow) {
  return (
    forecastPeriodMinutes({
      usedMinutes: Number(period.used_minutes ?? 0),
      manualForecastMinutes:
        period.forecast_minutes === null || period.forecast_minutes === undefined
          ? null
          : Number(period.forecast_minutes),
      periodStart: text(period.period_start),
      periodEnd: text(period.period_end),
    }) / 60
  );
}

async function requiredPsaContext() {
  const auth = await getPsaContext();
  if (!auth.ok) {
    throw new Error(
      auth.response.status === 401
        ? "Authentication required."
        : "PSA data is unavailable.",
    );
  }
  return auth;
}

async function psaDemoRequested() {
  return (
    isDemoModeAllowed() &&
    (await cookies()).get("p11-demo")?.value === "true"
  );
}

function mapClientSummary(
  row: PsaRow,
  related: {
    ownerNames?: Map<string, string>;
    parentNames?: Map<string, string>;
    contactNames?: Map<string, string>;
  } = {},
) {
  const metadata = asRow(row.metadata);
  const ownerId = nullableText(row.account_owner_id);
  const parentClientId = nullableText(row.parent_client_id);
  return {
    id: text(row.id),
    name: text(row.name),
    status: nullableText(row.status),
    industry: nullableText(metadata.industry),
    website: nullableText(row.website),
    email: nullableText(row.billing_email),
    phone: nullableText(row.phone),
    notes: nullableText(metadata.notes),
    ownerId,
    ownerName: ownerId ? related.ownerNames?.get(ownerId) ?? null : null,
    parentClientId,
    parentClientName: parentClientId
      ? related.parentNames?.get(parentClientId) ?? null
      : null,
    primaryContactName: related.contactNames?.get(text(row.id)) ?? null,
    activeProjects: Number(row.project_count ?? 0),
    activeRetainers: Number(row.retainer_count ?? 0),
    outstandingAmount: cents(row.balance_cents),
    updatedAt: nullableText(row.updated_at),
  };
}

function mapRetainerSummary(row: PsaRow) {
  const periods = asRows(row.retainer_periods).sort((left, right) =>
    text(right.period_start).localeCompare(text(left.period_start)),
  );
  const period = periods[0] ?? {};
  const client = firstRow(row.client);
  const allowanceMinutes = Number(
    period.included_minutes ?? row.included_minutes ?? 0,
  );
  const loggedMinutes = period.external_id
    ? Number(period.consumed_minutes ?? period.used_minutes ?? 0)
    : Number(period.used_minutes ?? 0);
  return {
    id: text(row.id),
    clientId: text(row.client_id),
    clientName: nullableText(client.name),
    name: text(row.name),
    status: nullableText(row.status),
    periodStart: nullableText(period.period_start ?? row.start_date),
    periodEnd: nullableText(period.period_end ?? row.end_date),
    allowanceHours: allowanceMinutes / 60,
    loggedHours: loggedMinutes / 60,
    billableHours: loggedMinutes / 60,
    projectedHours: period.id
      ? projectedPeriodHours({ ...period, used_minutes: loggedMinutes })
      : loggedMinutes / 60,
    hourlyRate: cents(row.overage_rate_cents),
    value: cents(period.fee_cents ?? row.fee_cents),
    cadence: nullableText(row.cadence),
    startDate: nullableText(row.start_date),
    endDate: nullableText(row.end_date),
    allowanceType: nullableText(period.allowance_type ?? row.allowance_type),
    allowanceValue: cents(
      period.included_value_cents ?? row.allowance_value_cents,
    ),
    overagePolicy: nullableText(row.overage_policy),
    rolloverPolicy: nullableText(row.rollover_policy),
    autoRenew: row.auto_renew === true,
    renewalDays:
      row.renewal_days === null || row.renewal_days === undefined
        ? null
        : Number(row.renewal_days),
    invoiceTiming: nullableText(row.invoice_timing),
    currency: nullableText(row.currency),
  };
}

function asRows(value: unknown): PsaRow[] {
  return Array.isArray(value)
    ? value.filter((item): item is PsaRow => Boolean(item && typeof item === "object"))
    : [];
}

function asRow(value: unknown): PsaRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PsaRow)
    : {};
}

function firstRow(value: unknown): PsaRow {
  return Array.isArray(value) ? asRow(value[0]) : asRow(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function cents(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount / 100 : 0;
}
