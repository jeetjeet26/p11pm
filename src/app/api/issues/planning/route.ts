import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const updateSchema = z.object({
  issueId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  milestoneId: z.string().uuid().nullable().optional(),
  cycleId: z.string().uuid().nullable().optional(),
  riskLevel: z.enum(["none", "low", "medium", "high"]).optional(),
  riskReason: z.string().trim().max(2_000).nullable().optional(),
});

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const client = await createClient();
  if (!client) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const input = parsed.data;
  const { data, error } = await client
    .from("todos")
    .update({
      ...(input.milestoneId !== undefined ? { milestone_id: input.milestoneId } : {}),
      ...(input.cycleId !== undefined ? { cycle_id: input.cycleId } : {}),
      ...(input.riskLevel !== undefined ? { risk_level: input.riskLevel } : {}),
      ...(input.riskReason !== undefined ? { risk_reason: input.riskReason } : {}),
    })
    .eq("id", input.issueId)
    .eq("version", input.expectedVersion)
    .select("id,milestone_id,cycle_id,risk_level,risk_reason,version")
    .maybeSingle();
  if (error) {
    return Response.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }
  if (!data) {
    return Response.json(
      { error: "Issue changed elsewhere. Refresh before updating planning." },
      { status: 409 },
    );
  }
  return Response.json({ issue: data });
}
