import {
  ChatAccessError,
  getWorkspaceChatEventPage,
  requireChatContext,
} from "@/lib/chat/server";
import { chatSyncPageSchema } from "@/lib/chat/validation";

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = chatSyncPageSchema.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid sync cursor." },
        { status: 400 },
      );
    }

    const context = await requireChatContext();
    const page = await getWorkspaceChatEventPage({
      context,
      cursor: parsed.data.cursor,
    });
    return Response.json(page);
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Catch up workspace chat failed:", error);
    return Response.json(
      { error: "Could not synchronize P11 Chat." },
      { status: 500 },
    );
  }
}
