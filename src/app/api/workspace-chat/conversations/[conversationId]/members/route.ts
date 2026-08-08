import {
  ChatAccessError,
  getWorkspaceConversationMembers,
  requireChatAuthContext,
} from "@/lib/chat/server";
import { updateChannelMembersSchema } from "@/lib/chat/validation";

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

function errorCode(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await params;
    const context = await requireChatAuthContext();
    const members = await getWorkspaceConversationMembers({
      context,
      conversationId,
    });
    return Response.json({ members });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Read workspace conversation members failed:", error);
    return Response.json(
      { error: "Could not load conversation members." },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const parsed = updateChannelMembersSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid members." },
        { status: 400 },
      );
    }
    const { conversationId } = await params;
    const context = await requireChatAuthContext();
    const { error } = await context.supabase.rpc(
      "set_workspace_channel_members",
      {
        target_conversation_id: conversationId,
        target_member_ids: parsed.data.memberIds,
      },
    );
    if (error) {
      const code = errorCode(error);
      if (code === "42501") {
        return Response.json({ error: error.message }, { status: 403 });
      }
      if (code === "23514") {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Update private channel members failed:", error);
    return Response.json(
      { error: "Could not update private channel members." },
      { status: 500 },
    );
  }
}
