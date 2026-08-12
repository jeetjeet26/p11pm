import type { AcceloBusinessResource } from "@/lib/accelo/types";

export function normalizeAcceloRecord(
  resource: AcceloBusinessResource,
  record: Record<string, unknown>,
) {
  const base = {
    source_id: text(record.id),
    source_updated_at: timestamp(
      record.date_modified ?? record.date_updated ?? record.date_logged,
    ),
    source_deleted: sourceDeleted(record),
    source_retired_at: timestamp(
      record.date_deleted ?? record.date_retired ?? record.date_archived,
    ),
  };
  switch (resource) {
    case "companies":
      return compact({
        ...base,
        name: text(record.name) || `Accelo company ${text(record.id)}`,
        status: companyStatus(record.standing),
        phone: text(record.phone),
        website: text(record.website),
        billing_address: address(record.postal_address),
        source_created_at: timestamp(record.date_created),
        owner_source_id:
          objectId(record.account_manager) ||
          objectId(record.manager) ||
          objectId(record.owner),
        currency: currencyCode(record),
      });
    case "contacts":
      return compact({
        ...base,
        first_name: text(record.firstname) || "Unknown",
        last_name: text(record.surname),
        email: email(record.email),
        phone: text(record.mobile),
        title: text(record.title),
        status: activeStatus(record.standing),
      });
    case "affiliations":
      return compact({
        ...base,
        company_source_id: objectId(record.company),
        contact_source_id: objectId(record.contact),
        role: text(record.position),
        position: text(record.position),
        standing: text(record.standing),
        email: email(record.email),
        phone: text(record.phone) || text(record.mobile),
        receives_invoices: text(record.invoice_method) !== "",
      });
    case "staff":
      return compact({
        ...base,
        first_name: text(record.firstname),
        last_name: text(record.surname),
        email: email(record.email),
        title: text(record.title) || text(record.position),
        status: activeStatus(record.standing),
        timezone: text(record.timezone),
      });
    case "jobs":
      return compact({
        ...base,
        company_source_id: objectId(record.company),
        title: text(record.title),
        code: text(record.custom_id) || `ACC-${text(record.id)}`,
        status: jobStatus(record.standing),
        billing_type: jobBillingType(record.job_type ?? record.type),
        manager_source_id: objectId(record.manager),
        start_date: date(record.date_started ?? record.date_commenced),
        due_date: date(record.date_due),
        completed_at: timestamp(record.date_completed),
        hourly_rate_cents: cents(record.rate_charged ?? record.rate),
        currency: currencyCode(record),
        contact_source_ids: relatedIds(
          record.contacts ?? record.contact_ids ?? record.contact,
        ),
        affiliation_source_ids: relatedIds(
          record.affiliations ?? record.affiliation_ids ?? record.affiliation,
        ),
      });
    case "contracts": {
      const template = object(record.period_template);
      const allowanceType = allowanceTypeValue(template.allowance_type);
      return compact({
        ...base,
        company_source_id: objectId(record.company),
        job_source_id: objectId(record.job),
        title: text(record.title),
        status: contractStatus(record.standing),
        contract_type: objectTitle(record.contract_type) || text(record.type),
        start_date: date(record.date_started),
        end_date: date(record.date_expires),
        cadence: cadence(template.duration_unit),
        included_minutes:
          allowanceType === "fixed_hours"
            ? secondsToMinutes(template.allowance_time)
            : 0,
        fee_cents: cents(template.amount ?? record.value),
        allowance_type: allowanceType,
        allowance_value_cents:
          allowanceType === "fixed_value"
            ? cents(template.allowance_amount ?? template.amount ?? record.value)
            : null,
        overage_rate_cents: cents(template.rate_charged ?? template.rate),
        overage_policy: contractOverage(record.contract_type),
        currency: currencyCode(record, template),
        auto_renew: bool(record.auto_renew),
        renewal_days: integer(record.renew_days),
        period_template_source_id:
          objectId(record.period_template) || text(record.period_template_id),
      });
    }
    case "contract_periods": {
      const allowance = object(record.allowance);
      const consumption = object(record.consumption);
      const rollover = object(record.rollover);
      const overage = object(record.overage);
      const allowanceType = allowanceTypeValue(
        record.allowance_type ?? allowance.type,
      );
      return compact({
        ...base,
        contract_source_id: referenceId(record.contract_id ?? record.contract),
        period_start: date(
          record.date_commenced ??
            record.date_started ??
            record.date_start ??
            record.period_start,
        ),
        period_end: date(
          record.date_expires ??
            record.date_ended ??
            record.date_end ??
            record.period_end,
        ),
        status: contractPeriodStatus(record.standing ?? record.status),
        closed_at: timestamp(record.date_closed),
        allowance_type: allowanceType,
        included_minutes: secondsToMinutes(
          record.allowance_time ??
            allowance.time ??
            record.included_time ??
            record.included_seconds,
        ),
        included_value_cents: cents(
          record.allowance_amount ??
            allowance.amount ??
            record.included_value ??
            record.included_amount,
        ),
        consumed_minutes: secondsToMinutes(
          record.consumed_time ??
            consumption.time ??
            record.usage_time ??
            record.used_time,
        ),
        consumed_value_cents: cents(
          record.consumed_amount ??
            consumption.amount ??
            record.usage_amount ??
            record.used_amount,
        ),
        rollover_minutes: secondsToMinutes(
          record.rollover_time ?? rollover.time,
        ),
        rollover_value_cents: cents(
          record.rollover_amount ?? rollover.amount,
        ),
        overage_minutes: secondsToMinutes(
          record.overage_time ?? overage.time,
        ),
        overage_value_cents: cents(
          record.overage_amount ?? overage.amount,
        ),
        fee_cents: cents(record.amount ?? record.fee ?? allowance.amount),
        currency: currencyCode(record, allowance),
        template_revision:
          integer(record.template_revision ?? record.revision) ?? 1,
      });
    }
    case "activities":
      return compact({
        ...base,
        against_type: text(record.against_type),
        against_source_id:
          referenceId(record.against) || text(record.against_id),
        staff_source_id: objectId(record.staff),
        activity_type: activityType(record.medium),
        subject: text(record.subject) || activityType(record.medium),
        body:
          text(record.body) ||
          text(record.preview_body) ||
          text(record.details),
        occurred_at:
          timestamp(record.date_logged ?? record.date_started ?? record.date_created) ??
          new Date(0).toISOString(),
        duration_minutes: secondsToMinutes(
          number(record.billable) + number(record.nonbillable),
        ),
        billable_seconds: number(record.billable),
        nonbillable_seconds: number(record.nonbillable),
        billing_rate_cents: cents(record.rate_charged ?? record.rate),
        invoice_source_id: objectId(record.invoice_id),
        contract_period_source_id:
          objectId(record.contract_period) ||
          objectId(record.contract_period_id),
        contact_source_id:
          objectId(record.contact) || objectId(record.contact_id),
        participant_contact_source_ids: relatedIds(
          record.participants ?? record.contacts ?? record.contact_ids,
        ),
        participant_affiliation_source_ids: relatedIds(
          record.participant_affiliations ??
            record.affiliations ??
            record.affiliation_ids,
        ),
        direction: activityDirection(record),
        currency: currencyCode(record),
      });
    case "invoices":
      return compact({
        ...base,
        against_type: text(record.against_type),
        against_source_id: text(record.against_id),
        affiliation_source_id:
          objectId(record.affiliation) || text(record.affiliation_id),
        invoice_number: text(record.invoice_number) || text(record.id),
        subject: text(record.subject) || "Professional services",
        issue_date: date(record.date_raised),
        due_date: date(record.date_due),
        amount_cents: cents(record.amount),
        tax_cents: cents(record.tax),
        outstanding_cents: cents(record.outstanding),
        notes: text(record.notes),
        currency: currencyCode(record),
      });
    case "payments":
      return compact({
        ...base,
        against_type: text(record.against_type),
        against_source_id: text(record.against_id),
        amount_cents: cents(record.amount),
        paid_at: timestamp(record.date_created),
        method_source_id:
          objectId(record.payment_method) || text(record.method_id),
        reference: text(record.receipt_id),
        direction: text(record.direction),
        currency: currencyCode(record),
      });
    case "prospects":
      return compact({
        ...base,
        affiliation_source_id: objectId(record.affiliation),
        contact_source_id: objectId(record.contact),
        owner_source_id: objectId(record.manager),
        title: text(record.title),
        stage: prospectStage(record.standing),
        probability:
          integer(object(record.prospect_probability).value) ??
          integer(record.weighting) ??
          20,
        value_cents: cents(record.value),
        next_action: text(record.comments),
        next_action_at: timestamp(record.date_due),
        closed_at: timestamp(
          record.date_won ?? record.date_lost ?? record.date_cancelled,
        ),
        currency: currencyCode(record),
      });
    case "tasks":
      return compact({
        ...base,
        job_source_id: objectId(record.job) || objectId(record.task_job),
        title: text(record.title),
        description: text(record.description),
        status: taskStatus(record.standing),
        assigned_staff_source_id: objectId(record.assignee),
        due_at: timestamp(record.date_due),
        completed_at: timestamp(record.date_completed),
        estimated_minutes: secondsToMinutes(record.budgeted),
        actual_minutes: secondsToMinutes(record.logged),
      });
    case "issues":
      return compact({
        ...base,
        company_source_id: objectId(record.company),
        contract_source_id: objectId(record.contract),
        owner_source_id:
          objectId(record.owner) ||
          objectId(record.manager) ||
          objectId(record.assignee),
        contact_source_id:
          objectId(record.contact) || objectId(record.contact_id),
        affiliation_source_id:
          objectId(record.affiliation) || objectId(record.affiliation_id),
        title: text(record.title),
        description: text(record.description),
        source_state: text(record.standing ?? record.status),
        source_status:
          objectTitle(record.issue_status) ||
          text(record.standing ?? record.status),
        status: issueStatus(record.standing ?? record.status),
        priority: issuePriority(record.priority),
        due_at: timestamp(record.date_due),
        opened_at: timestamp(
          record.date_opened ?? record.date_raised ?? record.date_created,
        ),
        first_response_due_at: timestamp(
          record.date_first_response_due ?? record.first_response_due,
        ),
        first_response_at: timestamp(
          record.date_first_responded ?? record.date_first_response,
        ),
        resolution_due_at: timestamp(
          record.date_resolution_due ?? record.date_due,
        ),
        last_customer_message_at: timestamp(
          record.date_last_customer_message ?? record.date_last_requester_message,
        ),
        last_team_response_at: timestamp(
          record.date_last_staff_response ?? record.date_last_response,
        ),
        resolved_at: timestamp(
          record.date_resolved ?? record.date_completed,
        ),
        closed_at: timestamp(record.date_closed),
        completed_at: timestamp(
          record.date_closed ?? record.date_resolved ?? record.date_completed,
        ),
        source_url: text(record.url ?? record.web_url),
      });
    case "milestones":
      return compact({
        ...base,
        job_source_id: objectId(record.job),
        name: text(record.title) || text(record.name),
        description: text(record.description),
        status: milestoneStatus(record.standing),
        due_date: date(record.date_due),
        completed_at: timestamp(record.date_completed),
      });
  }
}

export function fieldsForAcceloResource(resource: AcceloBusinessResource) {
  if (resource === "jobs") {
    return "_ALL,job_type(),job_status(),company(),manager()";
  }
  if (resource === "contracts") {
    return "_ALL,contract_type(),contract_status(),company(),manager(),period_template(),job()";
  }
  if (resource === "contract_periods") {
    return "_ALL";
  }
  if (resource === "activities") {
    return "subject,body,preview_body,medium,direction,date_logged,date_modified,billable,nonbillable,rate_charged,currency,against_type,against_id,invoice_id,contract_period(),staff(),contact(),participants(),affiliations()";
  }
  if (resource === "invoices") return "_ALL,affiliation(company())";
  if (resource === "prospects") {
    return "_ALL,prospect_type(),prospect_status(),prospect_probability()";
  }
  if (resource === "issues") {
    return "_ALL";
  }
  if (resource === "tasks") return "_ALL,task_type(),task_status(),job(),assignee()";
  return "_ALL";
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== null && item !== undefined),
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function objectId(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return text(value);
  return text(object(value).id);
}
function referenceId(value: unknown) {
  const identifier = objectId(value);
  return identifier.includes("/")
    ? (identifier.split("/").filter(Boolean).at(-1) ?? "")
    : identifier;
}
function objectTitle(value: unknown) {
  return text(object(value).title);
}
function objectCode(value: unknown) {
  const item = object(value);
  return text(item.code ?? item.iso_code ?? item.currency);
}
function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}
function email(value: unknown) {
  const result = text(value).toLowerCase();
  return result.includes("@") ? result : null;
}
function number(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}
function integer(value: unknown) {
  const result = Number(value);
  return Number.isInteger(result) ? result : null;
}
function cents(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.round(result * 100) : 0;
}
function currencyCode(...values: unknown[]) {
  for (const value of values) {
    const candidate = (objectCode(value) || text(value)).toUpperCase();
    if (/^[A-Z]{3}$/.test(candidate)) return candidate;
    const nested = object(value);
    for (const key of ["currency", "currency_code", "code"]) {
      const nestedCandidate = (
        objectCode(nested[key]) || text(nested[key])
      ).toUpperCase();
      if (/^[A-Z]{3}$/.test(nestedCandidate)) return nestedCandidate;
    }
  }
  return "USD";
}
function bool(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}
function timestamp(value: unknown) {
  if (typeof value === "number" || /^\d+$/.test(text(value))) {
    const result = new Date(Number(value) * 1_000);
    return Number.isNaN(result.valueOf()) ? null : result.toISOString();
  }
  const result = new Date(text(value));
  return Number.isNaN(result.valueOf()) ? null : result.toISOString();
}
function date(value: unknown) {
  return timestamp(value)?.slice(0, 10) ?? null;
}
function address(value: unknown) {
  if (typeof value === "string") return { line1: value };
  return object(value);
}
function secondsToMinutes(value: unknown) {
  return Math.max(0, Math.round(number(value) / 60));
}
function relatedIds(value: unknown) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((item) => objectId(item))
        .filter(Boolean)
        .map((item) =>
          item.includes("/")
            ? (item.split("/").filter(Boolean).at(-1) ?? "")
            : item,
        )
        .filter(Boolean),
    ),
  );
}
function sourceDeleted(record: Record<string, unknown>) {
  const standing = text(record.standing ?? record.status).toLowerCase();
  return (
    bool(record.deleted ?? record.is_deleted ?? record.retired) ||
    standing === "deleted" ||
    standing === "retired"
  );
}
function companyStatus(value: unknown) {
  const standing = text(value);
  return standing === "prospect"
    ? "prospect"
    : standing === "inactive"
      ? "inactive"
      : "active";
}
function activeStatus(value: unknown) {
  return text(value) === "inactive" ? "inactive" : "active";
}
function jobStatus(value: unknown) {
  const standing = text(value);
  if (standing === "complete") return "completed";
  if (standing === "paused") return "on_hold";
  if (standing === "inactive") return "cancelled";
  return "active";
}
function jobBillingType(value: unknown) {
  const title = (objectTitle(value) || text(value)).toLowerCase();
  if (title.includes("fixed")) return "fixed_fee";
  if (title.includes("internal")) return "internal";
  return "time_and_materials";
}
function contractStatus(value: unknown) {
  const standing = text(value);
  return standing === "complete"
    ? "completed"
    : standing === "cancelled"
      ? "cancelled"
      : standing === "pending"
        ? "draft"
        : "active";
}
function contractPeriodStatus(value: unknown) {
  const result = text(value).toLowerCase();
  if (result === "closed" || result === "complete") return "closed";
  if (result === "cancelled" || result === "inactive") return "cancelled";
  if (result === "planned" || result === "pending") return "planned";
  return "open";
}
function allowanceTypeValue(value: unknown) {
  const result = text(value);
  return result === "fixed_hours" ||
    result === "unlimited_hours" ||
    result === "deliverables"
    ? result
    : "fixed_value";
}
function cadence(value: unknown) {
  const result = text(value);
  return result === "week"
    ? "weekly"
    : result === "year"
      ? "annual"
      : result === "quarter"
        ? "quarterly"
        : "monthly";
}
function contractOverage(value: unknown) {
  const title = (objectTitle(value) || text(value)).toLowerCase();
  if (title.includes("bill overage")) return "bill";
  if (title.includes("unlimited")) return "unlimited";
  return "do_not_bill";
}
function activityType(value: unknown) {
  const result = text(value);
  return result === "email" ||
    result === "meeting" ||
    result === "report" ||
    result === "event_log"
    ? result
    : "note";
}
function activityDirection(record: Record<string, unknown>) {
  const explicit = text(record.direction).toLowerCase();
  if (explicit === "inbound" || explicit === "outbound" || explicit === "internal") {
    return explicit;
  }
  if (bool(record.inbound)) return "inbound";
  if (bool(record.outbound)) return "outbound";
  return "internal";
}
function prospectStage(value: unknown) {
  const result = text(value);
  return result === "won"
    ? "won"
    : result === "lost"
      ? "lost"
      : "quote";
}
function taskStatus(value: unknown) {
  const result = text(value);
  return result === "complete"
    ? "done"
    : result === "started" || result === "accepted"
      ? "in_progress"
      : result === "paused"
        ? "blocked"
        : "todo";
}
function issuePriority(value: unknown) {
  const result = text(value).toLowerCase();
  return result.includes("critical") || result.includes("urgent")
    ? "urgent"
    : result.includes("high")
      ? "high"
      : result.includes("low")
        ? "low"
        : "medium";
}
function issueStatus(value: unknown) {
  const result = (objectTitle(value) || text(value)).toLowerCase();
  if (
    result.includes("cancel") ||
    result.includes("invalid") ||
    result.includes("duplicate")
  ) {
    return "cancelled";
  }
  if (
    result.includes("closed") ||
    result.includes("complete") ||
    result.includes("resolved")
  ) {
    return "done";
  }
  if (
    result.includes("blocked") ||
    result.includes("hold") ||
    result.includes("stalled")
  ) {
    return "blocked";
  }
  if (
    result.includes("waiting") ||
    result.includes("client") ||
    result.includes("customer") ||
    result.includes("review")
  ) {
    return "review";
  }
  if (
    result.includes("progress") ||
    result.includes("active") ||
    result.includes("assigned") ||
    result.includes("accepted")
  ) {
    return "in_progress";
  }
  return "todo";
}
function milestoneStatus(value: unknown) {
  const result = text(value);
  return result === "complete"
    ? "completed"
    : result === "active"
      ? "in_progress"
      : "upcoming";
}
