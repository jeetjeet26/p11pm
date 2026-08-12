import { z } from "zod";

import { getIssueDetailData } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

const todoIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Invalid issue identifier.");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ todoId: string }> },
) {
  const parsed = todoIdSchema.safeParse((await params).todoId);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid issue identifier." },
      { status: 400 },
    );
  }

  try {
    const detail = await getIssueDetailData(parsed.data);
    if (!detail) {
      return Response.json({ error: "Issue not found." }, { status: 404 });
    }
    const client = await createClient();
    if (!client) return Response.json(detail);
    const { data: planning } = await client
      .from("todos")
      .select("milestone_id,cycle_id,risk_level,risk_reason")
      .eq("id", parsed.data)
      .maybeSingle();
    return Response.json({
      ...detail,
      todo: {
        ...detail.todo,
        milestoneId: planning?.milestone_id ?? undefined,
        cycleId: planning?.cycle_id ?? undefined,
        riskLevel: planning?.risk_level ?? "none",
        riskReason: planning?.risk_reason ?? undefined,
      },
    });
  } catch (error) {
    console.error("Load issue detail failed:", error);
    return Response.json({ error: "Unable to load issue detail." }, { status: 400 });
  }
}
