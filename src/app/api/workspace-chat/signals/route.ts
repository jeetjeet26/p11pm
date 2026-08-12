import { z } from "zod";

import { ChatAccessError, requireChatAuthContext } from "@/lib/chat/server";

const payloadSchema = z.object({
  messageId: z.string().uuid(),
  signal: z.enum(["acknowledged", "approved", "needs_changes", "blocked", "done"]),
  active: z.boolean(),
});

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid work signal." }, { status: 400 });
  }
  try {
    const context = await requireChatAuthContext();
    const query = context.supabase
      .from("workspace_message_signals");
    const result = parsed.data.active
      ? await query.upsert(
          {
            message_id: parsed.data.messageId,
            profile_id: context.userId,
            signal: parsed.data.signal,
          },
          { onConflict: "message_id,profile_id,signal" },
        )
      : await query
          .delete()
          .eq("message_id", parsed.data.messageId)
          .eq("profile_id", context.userId)
          .eq("signal", parsed.data.signal);
    if (result.error) {
      return Response.json({ error: result.error.message }, { status: 400 });
    }
    return Response.json({ active: parsed.data.active });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    return Response.json({ error: "Unable to update work signal." }, { status: 500 });
  }
}
