import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const ticketIdSchema = z.string().uuid();
const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z
      .enum(["todo", "in_progress", "blocked", "review", "done", "cancelled"])
      .optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    ownerId: z.string().uuid().nullable().optional(),
  })
  .refine(
    ({ status, priority, ownerId }) =>
      status !== undefined || priority !== undefined || ownerId !== undefined,
    "At least one support field must change.",
  );

export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/support/tickets/[ticketId]">,
) {
  const parsedId = ticketIdSchema.safeParse((await params).ticketId);
  if (!parsedId.success) {
    return Response.json({ error: "Invalid support ticket." }, { status: 400 });
  }
  const client = await createClient();
  if (!client) {
    return Response.json({ error: "Support is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await client.rpc("get_support_ticket_detail", {
    target_todo_id: parsedId.data,
  });
  if (error) {
    console.error("Load support ticket failed:", error);
    return Response.json({ error: "Unable to load this ticket." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Ticket not found." }, { status: 404 });
  return Response.json(data);
}

export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/support/tickets/[ticketId]">,
) {
  const [parsedId, parsedBody, viewer] = await Promise.all([
    params.then(({ ticketId }) => ticketIdSchema.safeParse(ticketId)),
    request
      .json()
      .then((body) => updateSchema.safeParse(body))
      .catch(() => updateSchema.safeParse(null)),
    getViewer(),
  ]);
  if (!parsedId.success || !parsedBody.success) {
    return Response.json({ error: "Invalid support ticket update." }, { status: 400 });
  }
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!viewer.capabilities.supportWrite) {
    return Response.json({ error: "Support agent access is required." }, { status: 403 });
  }
  const client = await createClient();
  if (!client) {
    return Response.json({ error: "Support is not configured." }, { status: 503 });
  }
  const changes: Record<string, unknown> = {};
  if (parsedBody.data.status !== undefined) {
    changes.status = parsedBody.data.status;
  }
  if (parsedBody.data.priority !== undefined) {
    changes.priority = parsedBody.data.priority;
  }
  if (parsedBody.data.ownerId !== undefined) {
    changes.owner_id = parsedBody.data.ownerId;
  }
  const { data, error } = await client.rpc("update_support_ticket", {
    target_todo_id: parsedId.data,
    expected_version: parsedBody.data.expectedVersion,
    changes,
    requested_actor_id: viewer.user.id,
  });
  if (error) {
    console.error("Update support ticket failed:", error);
    const status =
      error.code === "40001"
        ? 409
        : error.code === "42501"
          ? 403
          : error.code === "P0002"
            ? 404
            : 400;
    return Response.json({ error: error.message }, { status });
  }
  return Response.json({ ticket: data });
}
