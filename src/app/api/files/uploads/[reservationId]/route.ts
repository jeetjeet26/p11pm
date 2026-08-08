import { createClient } from "@/lib/supabase/server";
import {
  getUploadSession,
  reportUploadProgress,
  UploadServiceError,
} from "@/lib/uploads/server";
import {
  uploadFinalizationSchema,
  uploadProgressSchema,
} from "@/lib/uploads/validation";

async function requireAuthenticatedClient() {
  const supabase = await createClient();
  if (!supabase) {
    throw new UploadServiceError("Supabase is not configured.", 503);
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new UploadServiceError("Unauthorized", 401);
  }
  return supabase;
}

function uploadError(error: unknown) {
  if (error instanceof UploadServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Read project upload progress failed:", error);
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
    const supabase = await requireAuthenticatedClient();
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
      supabase,
      parsed.data.reservationId,
      "project_file",
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
    return uploadError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  try {
    // Authentication intentionally precedes reading any request body.
    const supabase = await requireAuthenticatedClient();
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
      supabase,
      reservation.data.reservationId,
      "project_file",
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
    return uploadError(error);
  }
}
