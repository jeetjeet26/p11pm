import {
  ChatAccessError,
  requireChatAuthContext,
} from "@/lib/chat/server";

const INLINE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const { attachmentId } = await params;
    const context = await requireChatAuthContext();
    const { data, error } = await context.supabase
      .from("workspace_message_attachments")
      .select("object_path,file_name,mime_type")
      .eq("id", attachmentId)
      .not("message_id", "is", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return Response.json({ error: "Attachment not found." }, { status: 404 });
    }

    const inline =
      new URL(request.url).searchParams.get("inline") === "1" &&
      INLINE_IMAGE_TYPES.has(data.mime_type ?? "");
    const signed = inline
      ? await context.supabase.storage
          .from("workspace-chat-files")
          .createSignedUrl(data.object_path, 60)
      : await context.supabase.storage
          .from("workspace-chat-files")
          .createSignedUrl(data.object_path, 60, {
            download: data.file_name,
          });
    if (signed.error) throw signed.error;

    return new Response(null, {
      status: 302,
      headers: {
        "cache-control": "private, no-store",
        location: signed.data.signedUrl,
      },
    });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Download workspace chat attachment failed:", error);
    return Response.json(
      { error: "Could not download the attachment." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
) {
  try {
    const { attachmentId } = await params;
    const context = await requireChatAuthContext();
    const { error: deleteError } = await context.supabase
      .from("workspace_message_attachments")
      .delete()
      .eq("id", attachmentId)
      .eq("uploader_id", context.userId)
      .is("message_id", null);
    if (deleteError) throw deleteError;

    // The metadata delete transaction durably queues the Storage object.
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ChatAccessError) return accessError(error);
    console.error("Delete pending workspace chat attachment failed:", error);
    return Response.json(
      { error: "Could not remove the pending attachment." },
      { status: 500 },
    );
  }
}
