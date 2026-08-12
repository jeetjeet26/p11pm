import type { PsaRow } from "@/lib/psa/types";

function camelizeKey(key: string) {
  return key.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase(),
  );
}

function snakeCaseKey(key: string) {
  return key.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}

function mapValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mapValue);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return mapPsaRow(value as PsaRow);
}

/**
 * Converts database rows to the API's camel-case contract while preserving
 * compatible columns added by later migrations.
 */
export function mapPsaRow<T = PsaRow>(row: PsaRow): T {
  const mapped = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      camelizeKey(key),
      mapValue(value),
    ]),
  ) as PsaRow;
  addCompatibilityAliases(row, mapped);
  return mapped as T;
}

export function mapPsaRows<T = PsaRow>(rows: PsaRow[]): T[] {
  return rows.map((row) => mapPsaRow<T>(row));
}

/**
 * Inputs have already passed a strict Zod schema, so a bounded top-level
 * conversion is sufficient and prevents arbitrary database columns.
 */
export function toDatabaseRow(
  input: Record<string, unknown>,
  omittedKeys: string[] = [],
): PsaRow {
  const omitted = new Set(omittedKeys);
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => !omitted.has(key) && value !== undefined)
      .map(([key, value]) => [snakeCaseKey(key), value]),
  );
}

export function toDatabaseUpdate(input: Record<string, unknown>): PsaRow {
  return toDatabaseRow(input, ["id"]);
}

export function clientWriteRow(input: Record<string, unknown>): PsaRow {
  const metadata = {
    ...(isRow(input.metadata) ? input.metadata : {}),
    ...(input.industry !== undefined ? { industry: input.industry } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  return compact({
    name: input.name,
    status: input.status,
    account_owner_id: input.ownerId,
    parent_client_id: input.parentClientId,
    website: input.website,
    phone: input.phone,
    billing_email: input.billingEmail ?? input.email,
    default_currency: input.defaultCurrency,
    payment_terms_days: input.paymentTermsDays,
    ...(Object.keys(metadata).length ? { metadata } : {}),
  });
}

export function contactWriteRow(input: Record<string, unknown>): PsaRow {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = input.firstName ?? parts.shift();
  const lastName = input.lastName ?? parts.join(" ");
  return compact({
    first_name: firstName,
    last_name: lastName ?? "",
    email: input.email,
    phone: input.phone,
    title: input.title,
    status: input.status,
  });
}

export function activityWriteRow(input: Record<string, unknown>): PsaRow {
  return compact({
    client_id: input.clientId,
    contact_id: input.contactId,
    project_id: input.projectId,
    activity_type: input.activityType ?? input.type,
    subject: input.subject,
    body: input.body,
    occurred_at: input.occurredAt,
  });
}

export function retainerWriteRow(input: Record<string, unknown>): PsaRow {
  const allowanceMinutes =
    typeof input.allowanceMinutes === "number"
      ? input.allowanceMinutes
      : Math.round(Number(input.allowanceHours ?? 0) * 60);
  const hourlyRate = nullableNumber(input.overageRate ?? input.hourlyRate);
  const fee = nullableNumber(input.fixedFee ?? input.value) ?? 0;
  const allowanceValue =
    nullableNumber(input.allowanceValue ?? input.fixedFee ?? input.value);
  return compact({
    client_id: input.clientId,
    name: input.name,
    status: input.status,
    cadence: input.cadence,
    start_date: input.startDate,
    end_date: input.endDate,
    included_minutes: allowanceMinutes,
    fee_cents: toCents(fee),
    allowance_type: input.allowanceType ?? "fixed_value",
    allowance_value_cents:
      allowanceValue === null ? null : toCents(allowanceValue),
    overage_rate_cents: hourlyRate === null ? null : toCents(hourlyRate),
    rollover_policy: input.rolloverPolicy ?? "none",
    overage_policy: input.overagePolicy ?? "do_not_bill",
    auto_renew: input.autoRenew ?? false,
    renewal_days: input.renewalDays,
    invoice_timing: input.invoiceTiming ?? "period_start",
    currency: input.currency,
  });
}

export function retainerUpdateRow(input: Record<string, unknown>): PsaRow {
  const row = retainerWriteRow(input);
  if (input.allowanceMinutes === undefined && input.allowanceHours === undefined) {
    delete row.included_minutes;
  }
  if (
    input.fixedFee === undefined &&
    input.value === undefined &&
    input.hourlyRate === undefined &&
    input.overageRate === undefined &&
    input.allowanceMinutes === undefined &&
    input.allowanceHours === undefined
  ) {
    delete row.fee_cents;
  }
  if (input.overageRate === undefined && input.hourlyRate === undefined) {
    delete row.overage_rate_cents;
  }
  if (input.allowanceType === undefined) delete row.allowance_type;
  if (input.allowanceValue === undefined) delete row.allowance_value_cents;
  if (input.rolloverPolicy === undefined) delete row.rollover_policy;
  if (input.overagePolicy === undefined) delete row.overage_policy;
  if (input.autoRenew === undefined) delete row.auto_renew;
  if (input.renewalDays === undefined) delete row.renewal_days;
  if (input.invoiceTiming === undefined) delete row.invoice_timing;
  return row;
}

export function invoiceWriteRow(input: Record<string, unknown>): PsaRow {
  return compact({
    client_id: input.clientId,
    project_id: input.projectId,
    invoice_number: input.invoiceNumber,
    subject: input.subject,
    attention_to: input.attentionTo,
    billing_address: input.billingAddress,
    status: input.status,
    issue_date: input.issueDate,
    due_date: input.dueDate,
    service_period_start: input.servicePeriodStart,
    service_period_end: input.servicePeriodEnd,
    currency: input.currency,
    subtotal_cents: toCents(Number(input.subtotal ?? 0)),
    tax_cents: toCents(Number(input.taxTotal ?? 0)),
    paid_cents:
      input.amountPaid === undefined ? undefined : toCents(Number(input.amountPaid)),
    notes: input.notes,
    payment_instructions: input.paymentInstructions,
    payment_terms: input.paymentTerms,
  });
}

export function invoiceUpdateRow(input: Record<string, unknown>): PsaRow {
  const row = invoiceWriteRow(input);
  if (input.subtotal === undefined) delete row.subtotal_cents;
  if (input.taxTotal === undefined) delete row.tax_cents;
  return row;
}

export function timeEntryUpdateRow(input: Record<string, unknown>): PsaRow {
  return compact({
    client_id: input.clientId,
    project_id: input.projectId,
    entry_date: input.entryDate,
    minutes: input.durationMinutes,
    description: input.description,
    billable: input.billable,
    status: input.status,
    todo_id: input.todoId,
    retainer_period_id: input.retainerPeriodId,
  });
}

export function paymentUpdateRow(input: Record<string, unknown>): PsaRow {
  return compact({
    client_id: input.clientId,
    payment_date: input.paymentDate,
    amount_cents:
      input.amount === undefined ? undefined : toCents(Number(input.amount)),
    currency: input.currency,
    method: input.method,
    reference: input.reference,
    notes: input.notes,
  });
}

export function toCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function addCompatibilityAliases(source: PsaRow, target: PsaRow) {
  if ("included_minutes" in source) target.allowanceMinutes = source.included_minutes;
  if ("minutes" in source) target.durationMinutes = source.minutes;
  if ("fee_cents" in source) target.fixedFee = fromCents(source.fee_cents);
  if ("overage_rate_cents" in source) {
    target.overageRate = fromCents(source.overage_rate_cents);
  }
  if ("billing_rate_cents" in source) {
    target.billRate = fromCents(source.billing_rate_cents);
  }
  if ("cost_rate_cents" in source) {
    target.costRate = fromCents(source.cost_rate_cents);
  }
  if ("subtotal_cents" in source) target.subtotal = fromCents(source.subtotal_cents);
  if ("tax_cents" in source) target.taxTotal = fromCents(source.tax_cents);
  if ("total_cents" in source) target.total = fromCents(source.total_cents);
  if ("paid_cents" in source) target.amountPaid = fromCents(source.paid_cents);
  if ("balance_cents" in source) target.balanceDue = fromCents(source.balance_cents);
  if ("amount_cents" in source) target.amount = fromCents(source.amount_cents);
  if ("unit_amount_cents" in source) {
    target.unitPrice = fromCents(source.unit_amount_cents);
  }
}

function fromCents(value: unknown) {
  if (value === null || value === undefined) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount / 100 : null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compact(row: PsaRow) {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  );
}

function isRow(value: unknown): value is PsaRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
