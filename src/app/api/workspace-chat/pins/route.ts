import { z } from "zod";

import { ChatAccessError, requireChatAuthContext } from "@/lib/chat/server";

const payloadSchema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  title: z.string().trim().min(1).max(240),
});

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!conversationId || !z.string().uuid().safeParse(conversationId).success) {
    return Response.json({ error: "Invalid conversation." }, { status: 400 });
  }
  try {
    const context = await requireChatAuthContext();
    const { data, error } = await context.supabase
      .from("workspace_pins")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ pins: data ?? [] });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    return Response.json({ error: "Unable to load pins." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid pin." }, { status: 400 });
  }
  try {
    const context = await requireChatAuthContext();
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .single();
    if (!profile?.organization_id) {
      return Response.json({ error: "Workspace membership required." }, { status: 403 });
    }
    const { data, error } = await context.supabase
      .from("workspace_pins")
      .upsert(
        {
          organization_id: profile.organization_id,
          conversation_id: parsed.data.conversationId,
          message_id: parsed.data.messageId,
          title: parsed.data.title,
          pinned_by: context.userId,
        },
        { onConflict: "conversation_id,message_id" },
      )
      .select()
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ pin: data }, { status: 201 });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    return Response.json({ error: "Unable to pin message." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const messageId = new URL(request.url).searchParams.get("messageId");
  if (!messageId || !z.string().uuid().safeParse(messageId).success) {
    return Response.json({ error: "Invalid pin." }, { status: 400 });
  }
  try {
    const context = await requireChatAuthContext();
    const { error } = await context.supabase
      .from("workspace_pins")
      .delete()
      .eq("message_id", messageId)
      .eq("pinned_by", context.userId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    return Response.json({ error: "Unable to remove pin." }, { status: 500 });
  }
}
