import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .transform((value) => value.toUpperCase())
    .pipe(
      z
        .string()
        .regex(
          /^[A-Z0-9][A-Z0-9-]{1,31}$/,
          "Use 2–32 letters, numbers, or hyphens.",
        ),
    ),
  clientName: z.string().trim().max(160).optional(),
  clientId: z.string().uuid().nullable().optional(),
  billingType: z
    .enum(["time_and_materials", "fixed_fee", "internal"])
    .default("time_and_materials"),
  fixedFee: z.number().finite().nonnegative().nullable().optional(),
  hourlyRate: z.number().finite().nonnegative().nullable().optional(),
  billingCap: z.number().finite().nonnegative().nullable().optional(),
  commercialValue: z.number().finite().nonnegative().nullable().optional(),
  billingCadence: z
    .enum(["weekly", "monthly", "quarterly", "milestone", "completion"])
    .nullable()
    .optional(),
  timeRoundingMinutes: z
    .union([
      z.literal(1),
      z.literal(5),
      z.literal(6),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ])
    .nullable()
    .optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .default("USD"),
  description: z.string().trim().max(10_000).optional(),
});

const updateProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  clientName: z.string().trim().max(160).nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  billingType: z.enum(["time_and_materials", "fixed_fee", "internal"]),
  fixedFee: z.number().finite().nonnegative().nullable().optional(),
  hourlyRate: z.number().finite().nonnegative().nullable().optional(),
  billingCap: z.number().finite().nonnegative().nullable().optional(),
  commercialValue: z.number().finite().nonnegative().nullable().optional(),
  billingCadence: z
    .enum(["weekly", "monthly", "quarterly", "milestone", "completion"])
    .nullable()
    .optional(),
  timeRoundingMinutes: z
    .union([
      z.literal(1),
      z.literal(5),
      z.literal(6),
      z.literal(10),
      z.literal(15),
      z.literal(30),
      z.literal(60),
    ])
    .nullable()
    .optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  status: z.enum(["planning", "active", "on_hold", "completed", "cancelled"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  ownerId: z.string().uuid().nullable().optional(),
  startDate: z.string().date().nullable().optional(),
  dueDate: z.string().date().nullable().optional(),
  budget: z.number().nonnegative().nullable().optional(),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
  archived: z.boolean().default(false),
});

function projectErrorStatus(error: { code?: string }) {
  if (error.code === "42501") return 403;
  if (error.code === "23505") return 409;
  return 400;
}

export async function POST(request: Request) {
  const parsed = createProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const viewer = await getViewer();
  if (!viewer) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!viewer.capabilities.commercialWrite) {
    return Response.json(
      { error: "Administrator or manager access is required." },
      { status: 403 },
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }

  const client = parsed.data.clientId
    ? await supabase
        .from("clients")
        .select("id,name")
        .eq("id", parsed.data.clientId)
        .eq("organization_id", viewer.organization.id)
        .maybeSingle()
    : { data: null, error: null };
  if (client.error || (parsed.data.clientId && !client.data)) {
    return Response.json({ error: "Client not found." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("projects")
    .insert({
      organization_id: viewer.organization.id,
      name: parsed.data.name,
      code: parsed.data.code,
      client_id: client.data?.id ?? null,
      client_name: client.data?.name ?? parsed.data.clientName ?? null,
      billing_type: parsed.data.billingType,
      fixed_fee_cents: toCents(parsed.data.fixedFee),
      hourly_rate_cents: toCents(parsed.data.hourlyRate),
      billing_cap_cents: toCents(parsed.data.billingCap),
      commercial_value_cents: toCents(parsed.data.commercialValue),
      billing_cadence: parsed.data.billingCadence ?? null,
      time_rounding_minutes: parsed.data.timeRoundingMinutes ?? null,
      commercial_currency: parsed.data.currency,
      description: parsed.data.description || null,
      status: "planning",
      priority: "medium",
      owner_id: viewer.user.id,
    })
    .select(
      "id,name,code,client_id,client_name,billing_type,description,status,priority,owner_id,created_at,updated_at",
    )
    .single();

  if (error) {
    console.error("Project creation failed:", error);
    return Response.json(
      { error: error.message },
      { status: projectErrorStatus(error) },
    );
  }
  return Response.json({ project: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateProjectSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid project update." },
      { status: 400 },
    );
  }
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!viewer.capabilities.commercialWrite) {
    return Response.json({ error: "Manager access required." }, { status: 403 });
  }
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const input = parsed.data;
  const client = input.clientId
    ? await supabase
        .from("clients")
        .select("id,name")
        .eq("id", input.clientId)
        .eq("organization_id", viewer.organization.id)
        .maybeSingle()
    : { data: null, error: null };
  if (client.error || (input.clientId && !client.data)) {
    return Response.json({ error: "Client not found." }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("projects")
    .update({
      name: input.name,
      client_id: client.data?.id ?? null,
      client_name: client.data?.name ?? input.clientName ?? null,
      billing_type: input.billingType,
      fixed_fee_cents: toCents(input.fixedFee),
      hourly_rate_cents: toCents(input.hourlyRate),
      billing_cap_cents: toCents(input.billingCap),
      commercial_value_cents: toCents(input.commercialValue),
      billing_cadence: input.billingCadence ?? null,
      time_rounding_minutes: input.timeRoundingMinutes ?? null,
      commercial_currency: input.currency,
      description: input.description || null,
      status: input.status,
      priority: input.priority,
      owner_id: input.ownerId ?? null,
      start_date: input.startDate ?? null,
      due_date: input.dueDate ?? null,
      budget: input.budget ?? null,
      currency: input.currency,
      archived_at: input.archived ? new Date().toISOString() : null,
    })
    .eq("id", input.id)
    .eq("organization_id", viewer.organization.id)
    .select()
    .single();
  if (error) {
    return Response.json(
      { error: error.message },
      { status: projectErrorStatus(error) },
    );
  }
  return Response.json({ project: data });
}

function toCents(value: number | null | undefined) {
  return value === null || value === undefined ? null : Math.round(value * 100);
}
