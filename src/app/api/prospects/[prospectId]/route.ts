import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_activity"),
    activityType: z.enum(["note", "call", "email", "meeting", "status_change"]),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().max(20_000).nullable().optional(),
    occurredAt: z.iso.datetime(),
    contactId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    action: z.literal("link_contact"),
    contactId: z.string().uuid(),
    role: z.string().trim().max(160).nullable().optional(),
    isPrimary: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("unlink_contact"),
    contactId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("convert_won"),
    projectName: z.string().trim().min(2).max(160),
    projectCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/)
      .transform((value) => value.toUpperCase()),
    startDate: z.iso.date(),
    createRetainer: z.boolean().default(false),
    retainerName: z.string().trim().min(2).max(160).nullable().optional(),
    retainerFee: z.number().finite().min(0).nullable().optional(),
    retainerIncludedHours: z.number().finite().min(0).max(166_666).nullable().optional(),
    idempotencyKey: z.string().trim().min(8).max(500),
  }).refine(
    (value) =>
      !value.createRetainer ||
      (Boolean(value.retainerName) &&
        value.retainerFee !== null &&
        value.retainerFee !== undefined &&
        value.retainerIncludedHours !== null &&
        value.retainerIncludedHours !== undefined),
    {
      message: "Retainer name, fee, and included hours are required.",
      path: ["retainerName"],
    },
  ),
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ prospectId: string }> },
) {
  const auth = await pipelineContext(false);
  if (!auth.ok) return auth.response;
  const { prospectId } = await params;
  if (!z.string().uuid().safeParse(prospectId).success) {
    return Response.json({ error: "Invalid opportunity." }, { status: 400 });
  }

  const [prospect, contacts, activities, directory, owners] = await Promise.all([
    auth.supabase
      .from("prospects")
      .select(
        "*,client:clients(id,name,status,account_owner_id,parent_client_id),owner:profiles(id,full_name,email),primary_contact:contacts(id,first_name,last_name,email,phone,title,status),won_project:projects(id,name,code),won_retainer:retainers(id,name)",
      )
      .eq("id", prospectId)
      .eq("organization_id", auth.organizationId)
      .maybeSingle(),
    auth.supabase
      .from("prospect_contacts")
      .select(
        "id,role,is_primary,contact:contacts!inner(id,first_name,last_name,email,phone,title,status)",
      )
      .eq("prospect_id", prospectId)
      .eq("organization_id", auth.organizationId)
      .order("is_primary", { ascending: false }),
    auth.supabase
      .from("client_activities")
      .select(
        "id,activity_type,subject,body,occurred_at,direction,source,contact:contacts(first_name,last_name),author:profiles(full_name)",
      )
      .eq("prospect_id", prospectId)
      .eq("organization_id", auth.organizationId)
      .order("occurred_at", { ascending: false })
      .limit(200),
    auth.supabase
      .from("contacts")
      .select(
        "id,first_name,last_name,email,phone,title,status,client_contacts(client_id,role,clients(name))",
      )
      .eq("organization_id", auth.organizationId)
      .order("last_name")
      .limit(500),
    auth.supabase
      .from("profiles")
      .select("id,full_name,email")
      .eq("organization_id", auth.organizationId)
      .eq("status", "active")
      .order("full_name"),
  ]);
  const error =
    prospect.error ??
    contacts.error ??
    activities.error ??
    directory.error ??
    owners.error;
  if (error) {
    console.error("Load opportunity detail failed:", error);
    return Response.json({ error: "Unable to load opportunity." }, { status: 500 });
  }
  if (!prospect.data) {
    return Response.json({ error: "Opportunity not found." }, { status: 404 });
  }
  return Response.json({
    prospect: prospect.data,
    contacts: contacts.data ?? [],
    activities: activities.data ?? [],
    directory: directory.data ?? [],
    owners: owners.data ?? [],
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ prospectId: string }> },
) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid opportunity action." },
      { status: 400 },
    );
  }
  const auth = await pipelineContext(true);
  if (!auth.ok) return auth.response;
  const { prospectId } = await params;
  if (!z.string().uuid().safeParse(prospectId).success) {
    return Response.json({ error: "Invalid opportunity." }, { status: 400 });
  }

  const { data: prospect, error: prospectError } = await auth.supabase
    .from("prospects")
    .select("id,client_id,organization_id")
    .eq("id", prospectId)
    .eq("organization_id", auth.organizationId)
    .maybeSingle();
  if (prospectError) return databaseError(prospectError);
  if (!prospect) {
    return Response.json({ error: "Opportunity not found." }, { status: 404 });
  }

  const input = parsed.data;
  if (input.action === "add_activity") {
    const { data, error } = await auth.supabase
      .from("client_activities")
      .insert({
        organization_id: auth.organizationId,
        client_id: prospect.client_id,
        prospect_id: prospect.id,
        contact_id: input.contactId ?? null,
        activity_type: input.activityType,
        subject: input.subject,
        body: input.body ?? null,
        occurred_at: input.occurredAt,
        created_by: auth.userId,
        source: "manual",
      })
      .select()
      .single();
    if (error) return databaseError(error);
    return Response.json({ activity: data }, { status: 201 });
  }

  if (input.action === "unlink_contact") {
    const { error } = await auth.supabase
      .from("prospect_contacts")
      .delete()
      .eq("organization_id", auth.organizationId)
      .eq("prospect_id", prospect.id)
      .eq("contact_id", input.contactId);
    if (error) return databaseError(error);
    return Response.json({ removed: true });
  }

  if (input.action === "link_contact") {
    if (input.isPrimary) {
      const { error } = await auth.supabase
        .from("prospect_contacts")
        .update({ is_primary: false })
        .eq("organization_id", auth.organizationId)
        .eq("prospect_id", prospect.id)
        .eq("is_primary", true);
      if (error) return databaseError(error);
    }
    const { data, error } = await auth.supabase
      .from("prospect_contacts")
      .upsert(
        {
          organization_id: auth.organizationId,
          prospect_id: prospect.id,
          contact_id: input.contactId,
          role: input.role ?? null,
          is_primary: input.isPrimary,
        },
        { onConflict: "prospect_id,contact_id" },
      )
      .select()
      .single();
    if (error) return databaseError(error);
    return Response.json({ contact: data });
  }

  const { data, error } = await auth.supabase.rpc("convert_prospect_to_won", {
    target_prospect_id: prospect.id,
    target_project_name: input.projectName,
    target_project_code: input.projectCode,
    target_start_date: input.startDate,
    target_create_retainer: input.createRetainer,
    target_retainer_name: input.retainerName ?? null,
    target_retainer_fee_cents:
      input.retainerFee === null || input.retainerFee === undefined
        ? null
        : Math.round(input.retainerFee * 100),
    target_retainer_included_minutes:
      input.retainerIncludedHours === null ||
      input.retainerIncludedHours === undefined
        ? null
        : Math.round(input.retainerIncludedHours * 60),
    target_conversion_key: input.idempotencyKey,
  });
  if (error) return databaseError(error);
  return Response.json({ conversion: data });
}

async function pipelineContext(requireWrite: boolean) {
  const viewer = await getViewer();
  if (!viewer) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (
    (requireWrite && !viewer.capabilities.pipelineWrite) ||
    (!requireWrite &&
      !viewer.capabilities.pipelineWrite &&
      !viewer.capabilities.commercialRead)
  ) {
    return {
      ok: false as const,
      response: Response.json({ error: "Pipeline access required." }, { status: 403 }),
    };
  }
  const supabase = await createClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  return {
    ok: true as const,
    supabase,
    organizationId: viewer.organization.id,
    userId: viewer.user.id,
  };
}

function databaseError(error: { code?: string; message?: string }) {
  const status =
    error.code === "42501" ? 403 : error.code === "23505" ? 409 : 400;
  return Response.json(
    { error: error.message ?? "Opportunity operation failed." },
    { status },
  );
}
