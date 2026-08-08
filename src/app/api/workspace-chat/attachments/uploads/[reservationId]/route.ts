import {
  ChatAccessError,
  requireChatAuthContext,
} from "@/lib/chat/server";
import {
  getUploadSession,
  reportUploadProgress,
  UploadServiceError,
} from "@/lib/uploads/server";
import {
  uploadFinalizationSchema,
  uploadProgressSchema,
} from "@/lib/uploads/validation";

function requestError(error: unknown) {
  if (error instanceof ChatAccessError) {
    const status = error.message.startsWith("Sign in") ? 401 : 403;
    return Response.json({ error: error.message }, { status });
  }
  if (error instanceof UploadServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Read chat attachment upload progress failed:", error);
  return Response.json(
    { error: "Could not read upload progress." },
    { status: 500 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  try {
    const context = await requireChatAuthContext();
    const parsed = uploadFinalizationSchema.safeParse({
      reservationId: (await params).reservationId,
    });
    if (!parsed.success) {
      return Response.json(
        { error: "Upload reservation not found." },
        { status: 404 },
      );
    }

    const session = await getUploadSession(
      context.supabase,
      parsed.data.reservationId,
      "chat_attachment",
    );
    if (!session) {
      return Response.json(
        { error: "Upload reservation not found." },
        { status: 404 },
      );
    }
    return Response.json(session, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return requestError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  try {
    // Authentication intentionally precedes reading any request body.
    const context = await requireChatAuthContext();
    const reservation = uploadFinalizationSchema.safeParse({
      reservationId: (await params).reservationId,
    });
    const progress = uploadProgressSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!reservation.success || !progress.success) {
      return Response.json(
        { error: "Valid upload progress is required." },
        { status: 400 },
      );
    }

    const result = await reportUploadProgress(
      context.supabase,
      reservation.data.reservationId,
      "chat_attachment",
      progress.data.bytesUploaded,
    );
    if (!result) {
      return Response.json(
        { error: "Upload reservation not found." },
        { status: 404 },
      );
    }
    return Response.json({ reservation: result });
  } catch (error) {
    return requestError(error);
  }
}
