import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const ticketIdSchema = z.string().uuid();
const commentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/support/tickets/[ticketId]/comments">,
) {
  const [parsedId, parsedBody, viewer] = await Promise.all([
    params.then(({ ticketId }) => ticketIdSchema.safeParse(ticketId)),
    request
      .json()
      .then((body) => commentSchema.safeParse(body))
      .catch(() => commentSchema.safeParse(null)),
    getViewer(),
  ]);
  if (!parsedId.success || !parsedBody.success) {
    return Response.json({ error: "Invalid support comment." }, { status: 400 });
  }
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!viewer.capabilities.supportWrite) {
    return Response.json({ error: "Support agent access is required." }, { status: 403 });
  }
  const client = await createClient();
  if (!client) {
    return Response.json({ error: "Support is not configured." }, { status: 503 });
  }
  const { data, error } = await client.rpc("add_support_ticket_comment", {
    target_todo_id: parsedId.data,
    target_body: parsedBody.data.body,
    requested_actor_id: viewer.user.id,
  });
  if (error) {
    console.error("Add support comment failed:", error);
    return Response.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : error.code === "P0002" ? 404 : 400 },
    );
  }
  return Response.json({ comment: data }, { status: 201 });
}
