import {
  ChatAccessError,
  getWorkspaceThreadRoot,
  getWorkspaceMessagePage,
  mapWorkspaceMessage,
  requireChatAuthContext,
} from "@/lib/chat/server";
import {
  createMessageSchema,
  messagePageSchema,
} from "@/lib/chat/validation";

type Row = Record<string, unknown>;

function errorCode(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = messagePageSchema.safeParse({
      conversationId: url.searchParams.get("conversationId"),
      threadId: url.searchParams.get("threadId") ?? undefined,
      beforeCreatedAt: url.searchParams.get("beforeCreatedAt") ?? undefined,
      beforeMessageId: url.searchParams.get("beforeMessageId") ?? undefined,
      afterCreatedAt: url.searchParams.get("afterCreatedAt") ?? undefined,
      afterMessageId: url.searchParams.get("afterMessageId") ?? undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid message cursor." },
        { status: 400 },
      );
    }

    const context = await requireChatAuthContext();
    const page = await getWorkspaceMessagePage({
      context,
      ...parsed.data,
    });
    const root = parsed.data.threadId
      ? await getWorkspaceThreadRoot({
          context,
            conversationId: parsed.data.conversationId,
          rootMessageId: parsed.data.threadId,
        })
      : undefined;
    if (parsed.data.threadId && !root) {
      return Response.json({ error: "Thread not found." }, { status: 404 });
    }
    return Response.json({ ...page, root });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Read workspace messages failed:", error);
    return Response.json(
      { error: "Could not load conversation messages." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createMessageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid message." },
        { status: 400 },
      );
    }

    const context = await requireChatAuthContext();
    let body = parsed.data.body;
    if (!body && parsed.data.attachmentIds.length) {
      const { data: attachments, error: attachmentError } =
        await context.supabase
          .from("workspace_message_attachments")
          .select("id,file_name")
          .in("id", parsed.data.attachmentIds)
          .eq("conversation_id", parsed.data.conversationId)
          .eq("uploader_id", context.userId)
          .is("message_id", null);
      if (
        attachmentError ||
        attachments?.length !== parsed.data.attachmentIds.length
      ) {
        return Response.json(
          { error: "One or more attachments are unavailable." },
          { status: 400 },
        );
      }
      body =
        attachments.length === 1
          ? attachments[0].file_name
          : `Shared ${attachments.length} files`;
    }

    const { data: sent, error } = await context.supabase.rpc(
      "send_workspace_message",
      {
        target_conversation_id: parsed.data.conversationId,
        target_body: body,
        target_client_nonce: parsed.data.clientNonce,
        target_parent_message_id: parsed.data.parentMessageId ?? null,
        target_attachment_ids: parsed.data.attachmentIds,
      },
    );

    if (error) {
      if (errorCode(error) === "42501") {
        return Response.json(
          { error: "You do not have access to this conversation." },
          { status: 403 },
        );
      }
      if (errorCode(error) === "23514") {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const sentRow = sent as Row;
    const { data, error: messageError } = await context.supabase
      .from("workspace_messages")
      .select(
        "id,conversation_id,sender_id,body,client_nonce,parent_message_id,created_at,workspace_message_attachments(id,file_name,mime_type,size_bytes)",
      )
      .eq("id", String(sentRow.id))
      .single();
    if (messageError) throw messageError;

    return Response.json(
      { message: mapWorkspaceMessage(data as Row) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Create workspace message failed:", error);
    return Response.json(
      { error: "Could not send the message." },
      { status: 500 },
    );
  }
}
