import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.string().trim().max(50).optional(),
  priority: z.string().trim().max(50).optional(),
  owner: z.string().uuid().optional(),
  client: z.string().uuid().optional(),
  sla: z
    .enum([
      "all",
      "breached",
      "at_risk",
      "on_track",
      "response_breached",
      "resolution_breached",
      "response_at_risk",
      "resolution_at_risk",
    ])
    .default("all"),
  closed: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

const supportStatuses = new Set([
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
]);
const priorities = new Set(["low", "medium", "high", "urgent"]);

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid support queue filters." }, { status: 400 });
  }
  const client = await createClient();
  if (!client) {
    return Response.json({ error: "Support is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const statusFilters = values(parsed.data.status).filter((value) =>
    supportStatuses.has(value),
  );
  const priorityFilters = values(parsed.data.priority).filter((value) =>
    priorities.has(value),
  );
  const { data, error } = await client.rpc("get_support_queue", {
    requested_limit: parsed.data.limit,
    status_filters: statusFilters.length ? statusFilters : undefined,
    priority_filters: priorityFilters.length ? priorityFilters : undefined,
    owner_filter: parsed.data.owner,
    client_filter: parsed.data.client,
    sla_filter: parsed.data.sla,
    text_filter: parsed.data.q,
    include_closed: parsed.data.closed === "1",
  });
  if (error) {
    console.error("Load support queue failed:", error);
    return Response.json(
      {
        error:
          error.code === "42501"
            ? "Support access is required."
            : "Unable to load the support queue.",
      },
      { status: error.code === "42501" ? 403 : 500 },
    );
  }
  return Response.json(data ?? { tickets: [], summary: {} });
}

function values(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
