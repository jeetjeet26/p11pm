import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  clientId: z.string().uuid(),
  before: z.iso.datetime().optional(),
  type: z
    .enum(["note", "call", "email", "meeting", "report", "event_log", "status_change"])
    .optional(),
  source: z.enum(["manual", "accelo", "email", "calendar", "api"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid timeline query." },
      { status: 400 },
    );
  }
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const { data, error } = await supabase.rpc("get_relationship_timeline", {
    target_client_id: parsed.data.clientId,
    before_occurred_at: parsed.data.before ?? null,
    target_activity_type: parsed.data.type ?? null,
    target_source: parsed.data.source ?? null,
    search_query: parsed.data.q ?? null,
    result_limit: parsed.data.limit,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  const rows = (data ?? []) as Array<{
    has_more?: boolean;
    occurred_at?: string;
    [key: string]: unknown;
  }>;
  return Response.json({
    activities: rows,
    hasMore: rows.some((row) => row.has_more),
    nextCursor: rows.at(-1)?.occurred_at ?? null,
  });
}
