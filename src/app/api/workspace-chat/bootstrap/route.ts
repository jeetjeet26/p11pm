import {
  ChatAccessError,
  getWorkspaceChatBootstrap,
  requireChatContext,
} from "@/lib/chat/server";
import { chatBootstrapSchema } from "@/lib/chat/validation";

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = chatBootstrapSchema.safeParse({
      conversationId: url.searchParams.get("conversationId") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid conversation." },
        { status: 400 },
      );
    }

    const context = await requireChatContext();
    const bootstrap = await getWorkspaceChatBootstrap({
      context,
      conversationId: parsed.data.conversationId,
    });
    return Response.json(bootstrap);
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Bootstrap workspace chat failed:", error);
    return Response.json(
      { error: "Could not start P11 Chat." },
      { status: 500 },
    );
  }
}
