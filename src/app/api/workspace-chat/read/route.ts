import {
  ChatAccessError,
  requireChatAuthContext,
} from "@/lib/chat/server";
import { markReadSchema } from "@/lib/chat/validation";

function errorCode(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

export async function POST(request: Request) {
  try {
    const parsed = markReadSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid conversation." },
        { status: 400 },
      );
    }

    const context = await requireChatAuthContext();
    const { data, error } = await context.supabase.rpc(
      "mark_workspace_conversation_read",
      { target_conversation_id: parsed.data.conversationId },
    );

    if (error) {
      if (errorCode(error) === "42501") {
        return Response.json(
          { error: "You do not have access to this conversation." },
          { status: 403 },
        );
      }
      throw error;
    }

    const result = data as { read_at?: string; updated?: boolean } | null;
    return Response.json({
      readAt: result?.read_at,
      updated: result?.updated ?? false,
    });
  } catch (error) {
    if (error instanceof ChatAccessError) {
      const status = error.message.startsWith("Sign in") ? 401 : 403;
      return Response.json({ error: error.message }, { status });
    }
    console.error("Update workspace chat read state failed:", error);
    return Response.json(
      { error: "Could not update the read state." },
      { status: 500 },
    );
  }
}
