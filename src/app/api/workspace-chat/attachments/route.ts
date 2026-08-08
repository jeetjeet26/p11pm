import {
  ChatAccessError,
  requireChatAuthContext,
} from "@/lib/chat/server";
import { MAX_UPLOAD_SIZE } from "@/lib/uploads/contracts";
import {
  finalizeUpload,
  initiateUpload,
  UploadServiceError,
} from "@/lib/uploads/server";
import {
  chatUploadInitiationSchema,
  uploadFinalizationSchema,
} from "@/lib/uploads/validation";

function accessError(error: ChatAccessError) {
  const status = error.message.startsWith("Sign in") ? 401 : 403;
  return Response.json({ error: error.message }, { status });
}

function requestError(error: unknown) {
  if (error instanceof ChatAccessError) return accessError(error);
  if (error instanceof UploadServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Workspace chat attachment upload failed:", error);
  return Response.json(
    { error: "Could not process the attachment." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    // Authentication intentionally precedes reading any request body.
    const context = await requireChatAuthContext();
    const body = (await request.json().catch(() => null)) as {
      sizeBytes?: unknown;
    } | null;
    if (
      typeof body?.sizeBytes === "number" &&
      body.sizeBytes > MAX_UPLOAD_SIZE
    ) {
      return Response.json(
        { error: "Files must be 25 MB or smaller." },
        { status: 413 },
      );
    }
    const parsed = chatUploadInitiationSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload." },
        { status: 400 },
      );
    }

    const session = await initiateUpload(context.supabase, {
      targetKind: "chat_attachment",
      targetId: parsed.data.conversationId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    return requestError(error);
  }
}

export async function PUT(request: Request) {
  try {
    // Authentication intentionally precedes reading any request body.
    const context = await requireChatAuthContext();
    const parsed = uploadFinalizationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json(
        { error: "A valid upload reservation is required." },
        { status: 400 },
      );
    }

    const reservation = await finalizeUpload<
      Record<string, unknown> & { id: string }
    >(
      context.supabase,
      parsed.data.reservationId,
      "chat_attachment",
    );
    if (!reservation) {
      return Response.json(
        { error: "Upload reservation not found." },
        { status: 404 },
      );
    }

    const resource = reservation.resource!;
    const attachment = {
      id: String(resource.id),
      fileName: String(resource.fileName),
      mimeType:
        typeof resource.mimeType === "string" ? resource.mimeType : undefined,
      sizeBytes: Number(resource.sizeBytes),
    };
    return Response.json({
      reservation: { ...reservation, resource: attachment },
      attachment,
    });
  } catch (error) {
    return requestError(error);
  }
}
