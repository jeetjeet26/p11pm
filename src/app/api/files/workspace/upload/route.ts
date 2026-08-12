import { fileWorkspaceUploadSchema } from "@/lib/files/validation";
import { createClient } from "@/lib/supabase/server";
import {
  finalizeWorkspaceUpload,
  initiateWorkspaceUpload,
  UploadServiceError,
} from "@/lib/uploads/server";
import { uploadFinalizationSchema } from "@/lib/uploads/validation";

async function authenticatedClient() {
  const client = await createClient();
  if (!client) throw new UploadServiceError("Supabase is not configured.", 503);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new UploadServiceError("Unauthorized", 401);
  return client;
}

function uploadError(error: unknown) {
  if (error instanceof UploadServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Workspace file upload failed:", error);
  return Response.json({ error: "Could not process the file." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const client = await authenticatedClient();
    const parsed = fileWorkspaceUploadSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload." },
        { status: 400 },
      );
    }
    const session = await initiateWorkspaceUpload(client, {
      folderId: parsed.data.folderId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    return Response.json(session, { status: 201 });
  } catch (error) {
    return uploadError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const client = await authenticatedClient();
    const parsed = uploadFinalizationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json(
        { error: "A valid upload reservation is required." },
        { status: 400 },
      );
    }
    const reservation = await finalizeWorkspaceUpload(
      client,
      parsed.data.reservationId,
    );
    if (!reservation) {
      return Response.json(
        { error: "Upload reservation not found." },
        { status: 404 },
      );
    }
    return Response.json({
      reservation,
      file: reservation.resource,
    });
  } catch (error) {
    return uploadError(error);
  }
}
