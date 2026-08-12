import {
  ChatAccessError,
  getWorkspaceThreadRoot,
  getWorkspaceMessagePage,
  mapWorkspaceMessage,
  requireChatAuthContext,
} from "@/lib/chat/server";
import { getMessageCrossLinks } from "@/lib/cross-links/server";
import {
  createMessageSchema,
  messagePageSchema,
} from "@/lib/chat/validation";
import { z } from "zod";

type Row = Record<string, unknown>;
const editMessageSchema = z.object({
  messageId: z.string().uuid(),
  body: z.string().trim().min(1).max(4_000),
});
const deleteMessageSchema = z.object({
  messageId: z.string().uuid(),
});

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
    } else if (!body && parsed.data.workLinks.length) {
      body =
        parsed.data.workLinks.length === 1
          ? "Linked a work item"
          : `Linked ${parsed.data.workLinks.length} work items`;
    }

    const { data: sent, error } = await context.supabase.rpc(
      "send_workspace_message",
      {
        target_conversation_id: parsed.data.conversationId,
        target_body: body,
        target_client_nonce: parsed.data.clientNonce,
        target_parent_message_id: parsed.data.parentMessageId ?? null,
        target_attachment_ids: parsed.data.attachmentIds,
        target_work_links: parsed.data.workLinks,
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

    const message = mapWorkspaceMessage(data as Row);
    const links = await getMessageCrossLinks(context.supabase, [message.id]);
    await createMentionInboxItems({
      context,
      body: message.body,
      conversationId: message.conversationId,
      messageId: message.id,
    });
    return Response.json(
      { message: { ...message, links: links.get(message.id) ?? [] } },
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

export async function PATCH(request: Request) {
  try {
    const parsed = editMessageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid message edit." }, { status: 400 });
    }
    const context = await requireChatAuthContext();
    const { data, error } = await context.supabase
      .from("workspace_messages")
      .update({ body: parsed.data.body })
      .eq("id", parsed.data.messageId)
      .eq("sender_id", context.userId)
      .is("deleted_at", null)
      .select(
        "id,conversation_id,sender_id,body,client_nonce,parent_message_id,created_at,edited_at,deleted_at,workspace_message_attachments(id,file_name,mime_type,size_bytes)",
      )
      .single();
    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    const message = mapWorkspaceMessage(data as Row);
    const links = await getMessageCrossLinks(context.supabase, [message.id]);
    return Response.json({
      message: { ...message, links: links.get(message.id) ?? [] },
    });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    return Response.json({ error: "Could not edit message." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const parsed = deleteMessageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "Invalid message deletion." }, { status: 400 });
    }
    const context = await requireChatAuthContext();
    const { error } = await context.supabase
      .from("workspace_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", parsed.data.messageId)
      .eq("sender_id", context.userId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    return Response.json({ error: "Could not delete message." }, { status: 500 });
  }
}

async function createMentionInboxItems({
  body,
  context,
  conversationId,
  messageId,
}: {
  body: string;
  context: Awaited<ReturnType<typeof requireChatAuthContext>>;
  conversationId: string;
  messageId: string;
}) {
  if (!body.includes("@")) return;
  const { data: current } = await context.supabase
    .from("profiles")
    .select("organization_id,full_name")
    .eq("id", context.userId)
    .single();
  if (!current?.organization_id) return;
  const { data: profiles, error } = await context.supabase
    .from("profiles")
    .select("id,full_name")
    .eq("organization_id", current.organization_id)
    .eq("status", "active")
    .neq("id", context.userId)
    .limit(500);
  if (error) {
    console.warn("Chat mention profile lookup failed:", error);
    return;
  }
  const mentioned = (profiles ?? []).filter((profile) => {
    const names = [profile.full_name, profile.full_name.split(/\s+/)[0]].filter(
      Boolean,
    );
    return names.some((name) =>
      new RegExp(`@${escapeRegExp(name)}\\b`, "i").test(body),
    );
  });
  if (!mentioned.length) return;
  const href = `/chat/${conversationId}?message=${messageId}`;
  const { error: insertError } = await context.supabase
    .from("workspace_inbox_items")
    .upsert(
      mentioned.map((profile) => ({
        organization_id: current.organization_id,
        recipient_id: profile.id,
        actor_id: context.userId,
        project_id: null,
        kind: "mention",
        title: `${current.full_name ?? "A teammate"} mentioned you`,
        body: body.slice(0, 500),
        href,
        source_type: "chat_message",
        source_id: messageId,
        priority: "high",
      })),
      { onConflict: "recipient_id,kind,source_type,source_id" },
    );
  if (insertError) console.warn("Chat mention inbox write failed:", insertError);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
