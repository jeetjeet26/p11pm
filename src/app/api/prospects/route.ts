import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const stage = z.enum(["lead", "qualified", "quote", "won", "lost"]);
const prospectFields = {
  clientId: z.string().uuid(),
  primaryContactId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(240),
  stage: stage.default("lead"),
  probability: z.number().int().min(0).max(100).default(20),
  value: z.number().finite().nonnegative().default(0),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  nextAction: z.string().trim().max(2_000).nullable().optional(),
  nextActionAt: z.iso.datetime().nullable().optional(),
  lostReason: z.string().trim().min(3).max(1_000).nullable().optional(),
};
const createSchema = z.object(prospectFields).strict();
const updateSchema = z
  .object(prospectFields)
  .partial()
  .extend({ id: z.string().uuid() })
  .strict()
  .refine((value) => value.stage !== "lost" || Boolean(value.lostReason), {
    message: "A lost reason is required.",
    path: ["lostReason"],
  });

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedStage = url.searchParams.get("stage");
  const parsedStage =
    requestedStage && requestedStage !== "open"
      ? stage.safeParse(requestedStage)
      : null;
  if (parsedStage && !parsedStage.success) {
    return Response.json({ error: "Invalid pipeline stage." }, { status: 400 });
  }
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  let query = supabase
    .from("prospects")
    .select(
      "id,client_id,primary_contact_id,owner_id,title,stage,probability,value_cents,weighted_value_cents,currency,next_action,next_action_at,lost_reason,closed_at,won_project_id,won_retainer_id,converted_at,updated_at,client:clients(name),owner:profiles(full_name),contact:contacts(first_name,last_name,email)",
    )
    .eq("organization_id", viewer.organization.id)
    .order("value_cents", { ascending: false })
    .limit(250);
  if (requestedStage === "open") {
    query = query.not("stage", "in", '("won","lost")');
  } else if (parsedStage?.success) {
    query = query.eq("stage", parsedStage.data);
  }
  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ prospects: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid prospect." },
      { status: 400 },
    );
  }
  return mutate({
    ...parsed.data,
    id: undefined,
  });
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid prospect update." },
      { status: 400 },
    );
  }
  return mutate(parsed.data);
}

async function mutate(
  input: Partial<z.infer<typeof createSchema>> & { id?: string },
) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!viewer.capabilities.pipelineWrite) {
    return Response.json({ error: "Manager access required." }, { status: 403 });
  }
  if (input.stage === "won") {
    return Response.json(
      { error: "Use opportunity conversion to mark an opportunity won." },
      { status: 409 },
    );
  }
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const closed =
    input.stage === "lost"
      ? new Date().toISOString()
      : input.stage
        ? null
        : undefined;
  const row = compact({
    client_id: input.clientId,
    primary_contact_id: input.primaryContactId,
    owner_id: input.ownerId,
    title: input.title,
    stage: input.stage,
    probability: input.probability,
    value_cents:
      input.value === undefined ? undefined : Math.round(input.value * 100),
    currency: input.currency,
    next_action: input.nextAction,
    next_action_at: input.nextActionAt,
    lost_reason:
      input.stage && input.stage !== "lost"
        ? null
        : input.lostReason,
    closed_at: closed,
  });
  const result = input.id
    ? await supabase
        .from("prospects")
        .update(row)
        .eq("id", input.id)
        .eq("organization_id", viewer.organization.id)
        .select()
        .single()
    : await supabase
        .from("prospects")
        .insert({ ...row, organization_id: viewer.organization.id })
        .select()
        .single();
  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 400 });
  }
  return Response.json(
    { prospect: result.data },
    { status: input.id ? 200 : 201 },
  );
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
