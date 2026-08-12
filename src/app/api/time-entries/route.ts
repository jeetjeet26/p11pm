import { mapPsaRow, timeEntryUpdateRow } from "@/lib/psa/mappers";
import {
  createPsaRouteHandlers,
  getPsaContext,
  psaDatabaseError,
  psaValidationError,
} from "@/lib/psa/server";
import {
  bulkTimeEntryStatusSchema,
  createTimeEntrySchema,
  timeEntryQuerySchema,
  updateTimeEntrySchema,
} from "@/lib/psa/validation";
import { getViewer } from "@/lib/auth/viewer";
import { roundTimeMinutes } from "@/lib/time-workflow";

const publicTimeEntryColumns =
  "id,organization_id,client_id,project_id,profile_id,todo_id,retainer_period_id,entry_date,minutes,description,billable,status,billing_rate_cents,currency,billable_amount_cents,approved_by,approved_at,invoiced_at,rejection_reason,source,external_id,created_at,updated_at";

const handlers = createPsaRouteHandlers({
  table: "time_entries",
  responseKey: "timeEntries",
  querySchema: timeEntryQuerySchema,
  createSchema: createTimeEntrySchema,
  updateSchema: updateTimeEntrySchema,
  select: publicTimeEntryColumns,
  orderColumn: "entry_date",
  fromColumn: "entry_date",
  toColumn: "entry_date",
  filters: {
    id: "id",
    clientId: "client_id",
    projectId: "project_id",
    profileId: "profile_id",
    status: "status",
    billable: "billable",
  },
  mapUpdate: (input) => timeEntryUpdateRow(input),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("format") !== "csv") return handlers.GET(request);
  const viewer = await getViewer();
  if (!viewer?.capabilities.timeApprove) {
    return Response.json({ error: "Manager access required." }, { status: 403 });
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  let query = auth.client
    .from("time_entries")
    .select(
      "entry_date,minutes,description,billable,status,currency,billable_amount_cents,rejection_reason,profile:profiles(full_name,email),client:clients(name),project:projects(name),issue:todos(issue_number,title)",
    )
    .eq("organization_id", auth.organizationId)
    .order("entry_date");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const clientId = url.searchParams.get("clientId");
  const projectId = url.searchParams.get("projectId");
  const profileId = url.searchParams.get("profileId");
  const status = url.searchParams.get("status");
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);
  if (clientId) query = query.eq("client_id", clientId);
  if (projectId) query = query.eq("project_id", projectId);
  if (profileId) query = query.eq("profile_id", profileId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.limit(10_000);
  if (error) return psaDatabaseError("export time entries", error);
  const csv = toCsv(data ?? []);
  return new Response(csv, {
    headers: {
      "content-disposition": `attachment; filename="time-entries-${new Date().toISOString().slice(0, 10)}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const bulk = bulkTimeEntryStatusSchema.safeParse(body);
  if (bulk.success) {
    const viewer = await getViewer();
    if (!viewer?.capabilities.timeApprove) {
      return Response.json(
        { error: "Time approval access required." },
        { status: 403 },
      );
    }
    const auth = await getPsaContext();
    if (!auth.ok) return auth.response;
    if (bulk.data.status === "approved") {
      const { data, error } = await auth.client.rpc("approve_time_entries", {
        target_time_entry_ids: bulk.data.ids,
      });
      if (error) return psaDatabaseError("approve time entries", error);
      return Response.json({ updatedCount: Number(data ?? 0) });
    }
    const { data, error } = await auth.client
      .from("time_entries")
      .update({
        status: "rejected",
        rejection_reason: bulk.data.rejectionReason,
        approved_by: null,
        approved_at: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", bulk.data.ids)
      .eq("organization_id", auth.organizationId)
      .eq("status", "submitted")
      .select("id");
    if (error) return psaDatabaseError("reject time entries", error);
    return Response.json({ updatedCount: data?.length ?? 0 });
  }

  const parsed = updateTimeEntrySchema.safeParse(body);
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message);
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  if (input.status === "approved") {
    const viewer = await getViewer();
    if (!viewer?.capabilities.timeApprove) {
      return Response.json(
        { error: "Time approval access required." },
        { status: 403 },
      );
    }
    const { error } = await auth.client.rpc("approve_time_entries", {
      target_time_entry_ids: [input.id],
    });
    if (error) return psaDatabaseError("approve time entry", error);
  } else {
    const update = timeEntryUpdateRow(input);
    if (input.durationMinutes !== undefined) {
      const rounded = await roundedMinutes(
        auth,
        input.projectId,
        input.id,
        input.durationMinutes,
      );
      if (!rounded.ok) return rounded.response;
      update.minutes = rounded.minutes;
    }
    if (input.retainerId !== undefined || input.entryDate !== undefined) {
      const resolved = await resolveUpdatedRetainerPeriod(auth, input);
      if (!resolved.ok) return resolved.response;
      update.retainer_period_id = resolved.retainerPeriodId;
    }
    if (
      input.status === "draft" ||
      input.status === "submitted" ||
      input.status === "rejected"
    ) {
      update.approved_by = null;
      update.approved_at = null;
    }
    if (input.status === "draft" || input.status === "submitted") {
      update.rejection_reason = null;
    }
    if (!Object.keys(update).length) {
      return psaValidationError("Provide at least one field to update.");
    }
    const { error } = await auth.client
      .from("time_entries")
      .update(update)
      .eq("id", input.id)
      .eq("organization_id", auth.organizationId);
    if (error) return psaDatabaseError("update time entry", error);
  }
  const { data, error } = await auth.client
    .from("time_entries")
    .select(publicTimeEntryColumns)
    .eq("id", input.id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (error) return psaDatabaseError("load time entry", error);
  if (!data) {
    return Response.json({ error: "Time entry not found." }, { status: 404 });
  }
  return Response.json({
    timeEntry: mapPsaRow(data as Record<string, unknown>),
  });
}

export async function POST(request: Request) {
  const parsed = createTimeEntrySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return psaValidationError(parsed.error.issues[0]?.message);
  }
  const auth = await getPsaContext();
  if (!auth.ok) return auth.response;
  const input = parsed.data;
  const rounded = await roundedMinutes(
    auth,
    input.projectId,
    undefined,
    input.durationMinutes,
  );
  if (!rounded.ok) return rounded.response;
  let retainerPeriodId = input.retainerPeriodId ?? null;
  if (!retainerPeriodId && input.retainerId) {
    const resolved = await findRetainerPeriod(
      auth,
      input.retainerId,
      input.entryDate,
    );
    if (!resolved.ok) return resolved.response;
    retainerPeriodId = resolved.retainerPeriodId;
  }
  const { data, error } = await auth.client.rpc("log_time_entry", {
    target_project_id: input.projectId,
    target_entry_date: input.entryDate,
    target_minutes: rounded.minutes,
    target_description: input.description,
    target_billable: input.billable,
    target_retainer_period_id: retainerPeriodId,
    target_todo_id: input.todoId ?? null,
    target_profile_id: input.profileId ?? auth.userId,
    target_external_id: null,
  });
  if (error) return psaDatabaseError("log time entry", error);
  return Response.json(
    { timeEntry: mapPsaRow(data as Record<string, unknown>) },
    { status: 201 },
  );
}

async function roundedMinutes(
  auth: Extract<Awaited<ReturnType<typeof getPsaContext>>, { ok: true }>,
  projectId: string | undefined,
  entryId: string | undefined,
  minutes: number,
) {
  let resolvedProjectId = projectId;
  if (!resolvedProjectId && entryId) {
    const { data: entry } = await auth.client
      .from("time_entries")
      .select("project_id")
      .eq("id", entryId)
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    resolvedProjectId = entry?.project_id;
  }
  if (!resolvedProjectId) {
    return {
      ok: false as const,
      response: psaValidationError("A project is required for time rounding."),
    };
  }
  const { data: project, error } = await auth.client
    .from("projects")
    .select("time_rounding_minutes")
    .eq("id", resolvedProjectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (error) {
    return {
      ok: false as const,
      response: psaDatabaseError("load project rounding", error),
    };
  }
  if (!project) {
    return {
      ok: false as const,
      response: Response.json({ error: "Project not found." }, { status: 404 }),
    };
  }
  const increment = project.time_rounding_minutes ?? 1;
  return {
    ok: true as const,
    minutes: roundTimeMinutes(minutes, increment),
  };
}

function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = [
    "date",
    "person",
    "email",
    "client",
    "project",
    "issue",
    "description",
    "minutes",
    "billable",
    "status",
    "amount",
    "currency",
    "rejection_reason",
  ];
  const values = rows.map((row) => {
    const profile = relation(row.profile);
    const client = relation(row.client);
    const project = relation(row.project);
    const issue = relation(row.issue);
    return [
      row.entry_date,
      profile?.full_name,
      profile?.email,
      client?.name,
      project?.name,
      issue ? `#${issue.issue_number} ${issue.title}` : "",
      row.description,
      row.minutes,
      row.billable,
      row.status,
      Number(row.billable_amount_cents ?? 0) / 100,
      row.currency,
      row.rejection_reason,
    ];
  });
  return [headers, ...values]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function relation(value: unknown): Record<string, unknown> | undefined {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === "object" ? (item as Record<string, unknown>) : undefined;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function resolveUpdatedRetainerPeriod(
  auth: Extract<Awaited<ReturnType<typeof getPsaContext>>, { ok: true }>,
  input: {
    id: string;
    retainerId?: string | null;
    retainerPeriodId?: string | null;
    entryDate?: string;
  },
) {
  if (input.retainerId === null) {
    return { ok: true as const, retainerPeriodId: null };
  }
  const { data: existing, error } = await auth.client
    .from("time_entries")
    .select("entry_date,retainer_period_id,retainer_periods(retainer_id)")
    .eq("id", input.id)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (error) {
    return {
      ok: false as const,
      response: psaDatabaseError("load time entry retainer", error),
    };
  }
  if (!existing) {
    return {
      ok: false as const,
      response: Response.json({ error: "Time entry not found." }, { status: 404 }),
    };
  }
  const relation = Array.isArray(existing.retainer_periods)
    ? existing.retainer_periods[0]
    : existing.retainer_periods;
  const retainerId = input.retainerId ?? relation?.retainer_id ?? null;
  if (!retainerId) {
    return {
      ok: true as const,
      retainerPeriodId: input.retainerPeriodId ?? existing.retainer_period_id,
    };
  }
  return findRetainerPeriod(
    auth,
    retainerId,
    input.entryDate ?? existing.entry_date,
  );
}

async function findRetainerPeriod(
  auth: Extract<Awaited<ReturnType<typeof getPsaContext>>, { ok: true }>,
  retainerId: string,
  entryDate: string,
) {
  const { data: period, error } = await auth.client
    .from("retainer_periods")
    .select("id,status,locked_at,invoiced_at")
    .eq("organization_id", auth.organizationId)
    .eq("retainer_id", retainerId)
    .lte("period_start", entryDate)
    .gte("period_end", entryDate)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return {
      ok: false as const,
      response: psaDatabaseError("resolve retainer period", error),
    };
  }
  if (!period) {
    return {
      ok: false as const,
      response: psaValidationError(
        "No retainer period covers this time entry date.",
      ),
    };
  }
  if (
    period.locked_at ||
    period.invoiced_at ||
    period.status === "closed" ||
    period.status === "cancelled"
  ) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "This retainer period is locked, invoiced, or closed." },
        { status: 409 },
      ),
    };
  }
  return { ok: true as const, retainerPeriodId: period.id };
}
