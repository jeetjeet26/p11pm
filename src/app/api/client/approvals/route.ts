import { z } from "zod";

import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  approvalId: z.string().uuid(),
  status: z.enum(["approved", "changes_requested", "rejected"]),
  note: z.string().trim().max(10_000).optional(),
});

export async function PATCH(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid approval response." }, { status: 400 });
  }
  const client = await createClient();
  const {
    data: { user },
  } = client ? await client.auth.getUser() : { data: { user: null } };
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const service = getAppSupabaseClient();
  if (!service) {
    return Response.json({ error: "Database is not configured." }, { status: 503 });
  }
  const { data: approval } = await service
    .from("work_approvals")
    .select("id,project_id,reviewer_id,status")
    .eq("id", parsed.data.approvalId)
    .eq("reviewer_id", user.id)
    .eq("status", "pending")
    .maybeSingle();
  if (!approval) {
    return Response.json({ error: "Approval is unavailable." }, { status: 404 });
  }
  const { data, error } = await service
    .from("work_approvals")
    .update({
      status: parsed.data.status,
      response_note: parsed.data.note ?? null,
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", approval.id)
    .eq("reviewer_id", user.id)
    .eq("status", "pending")
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ approval: data });
}
