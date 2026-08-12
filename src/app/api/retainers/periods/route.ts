import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const statusSchema = z.enum(["planned", "open", "closed", "cancelled"]);
const periodFields = {
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  includedMinutes: z.number().int().min(0).max(10_000_000),
  rolloverMinutes: z.number().int().min(0).max(10_000_000).default(0),
  feeCents: z.number().int().min(0),
  forecastMinutes: z.number().int().min(0).max(10_000_000).nullable().optional(),
  status: statusSchema.default("planned"),
};

const createSchema = z
  .object({
    retainerId: z.string().uuid(),
    ...periodFields,
  })
  .refine((value) => value.periodEnd >= value.periodStart, {
    message: "Period end must be on or after its start.",
  });

const updateSchema = z
  .object({
    id: z.string().uuid(),
    periodStart: periodFields.periodStart.optional(),
    periodEnd: periodFields.periodEnd.optional(),
    includedMinutes: periodFields.includedMinutes.optional(),
    rolloverMinutes: periodFields.rolloverMinutes.optional(),
    feeCents: periodFields.feeCents.optional(),
    forecastMinutes: periodFields.forecastMinutes,
    status: statusSchema.optional(),
    locked: z.boolean().optional(),
    invoiceId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => Object.entries(value).some(([key, item]) => key !== "id" && item !== undefined),
    { message: "Provide at least one period change." },
  );

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const retainerId = new URL(request.url).searchParams.get("retainerId");
  if (!retainerId || !z.string().uuid().safeParse(retainerId).success) {
    return Response.json({ error: "Invalid retainer." }, { status: 400 });
  }
  const client = await createClient();
  if (!client) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const { data, error } = await client
    .from("retainer_periods")
    .select("*")
    .eq("organization_id", viewer.organization.id)
    .eq("retainer_id", retainerId)
    .order("period_start", { ascending: false });
  if (error) return databaseError(error);
  return Response.json({ periods: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues[0]?.message);
  const context = await managerContext();
  if (!context.ok) return context.response;
  const { data: retainer } = await context.client
    .from("retainers")
    .select("id,organization_id,client_id,allowance_type,currency")
    .eq("id", parsed.data.retainerId)
    .eq("organization_id", context.viewer.organization.id)
    .maybeSingle();
  if (!retainer) return Response.json({ error: "Retainer not found." }, { status: 404 });
  const { data, error } = await context.client
    .from("retainer_periods")
    .insert({
      organization_id: retainer.organization_id,
      client_id: retainer.client_id,
      retainer_id: retainer.id,
      period_start: parsed.data.periodStart,
      period_end: parsed.data.periodEnd,
      included_minutes: parsed.data.includedMinutes,
      rollover_minutes: parsed.data.rolloverMinutes,
      fee_cents: parsed.data.feeCents,
      forecast_minutes: parsed.data.forecastMinutes ?? null,
      forecast_updated_at:
        parsed.data.forecastMinutes === undefined ? null : new Date().toISOString(),
      allowance_type: retainer.allowance_type,
      currency: retainer.currency,
      status: parsed.data.status,
      closed_at:
        parsed.data.status === "closed" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return databaseError(error);
  return Response.json({ period: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error.issues[0]?.message);
  const context = await managerContext();
  if (!context.ok) return context.response;
  const input = parsed.data;
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};
  if (input.periodStart !== undefined) update.period_start = input.periodStart;
  if (input.periodEnd !== undefined) update.period_end = input.periodEnd;
  if (input.includedMinutes !== undefined) update.included_minutes = input.includedMinutes;
  if (input.rolloverMinutes !== undefined) update.rollover_minutes = input.rolloverMinutes;
  if (input.feeCents !== undefined) update.fee_cents = input.feeCents;
  if (input.forecastMinutes !== undefined) {
    update.forecast_minutes = input.forecastMinutes;
    update.forecast_updated_at = now;
  }
  if (input.status !== undefined) {
    update.status = input.status;
    update.closed_at = input.status === "closed" ? now : null;
  }
  if (input.locked !== undefined) {
    update.locked_at = input.locked ? now : null;
    update.locked_by = input.locked ? context.viewer.profile.id : null;
  }
  if (input.invoiceId !== undefined) {
    update.invoice_id = input.invoiceId;
    update.invoiced_at = input.invoiceId ? now : null;
  }
  const { data, error } = await context.client
    .from("retainer_periods")
    .update(update)
    .eq("id", input.id)
    .eq("organization_id", context.viewer.organization.id)
    .select()
    .maybeSingle();
  if (error) return databaseError(error);
  if (!data) return Response.json({ error: "Retainer period not found." }, { status: 404 });
  return Response.json({ period: data });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !z.string().uuid().safeParse(id).success) {
    return validationError("Invalid retainer period.");
  }
  const context = await managerContext();
  if (!context.ok) return context.response;
  const { data, error } = await context.client
    .from("retainer_periods")
    .delete()
    .eq("id", id)
    .eq("organization_id", context.viewer.organization.id)
    .is("external_id", null)
    .is("locked_at", null)
    .is("invoiced_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseError(error);
  if (!data) {
    return Response.json(
      { error: "Imported, locked, or invoiced periods cannot be deleted." },
      { status: 409 },
    );
  }
  return new Response(null, { status: 204 });
}

async function managerContext() {
  const viewer = await getViewer();
  if (!viewer) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (viewer.role !== "admin" && viewer.role !== "manager") {
    return {
      ok: false as const,
      response: Response.json({ error: "Manager access required." }, { status: 403 }),
    };
  }
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json({ error: "Supabase is not configured." }, { status: 503 }),
    };
  }
  return { ok: true as const, client, viewer };
}

function validationError(error = "Invalid retainer period.") {
  return Response.json({ error }, { status: 400 });
}

function databaseError(error: { code?: string; message: string }) {
  return Response.json(
    { error: error.message },
    { status: error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400 },
  );
}
