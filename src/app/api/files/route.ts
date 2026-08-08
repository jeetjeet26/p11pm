import { createClient } from "@/lib/supabase/server";
import { MAX_UPLOAD_SIZE } from "@/lib/uploads/contracts";
import {
  finalizeUpload,
  initiateUpload,
  UploadServiceError,
} from "@/lib/uploads/server";
import {
  projectUploadInitiationSchema,
  uploadFinalizationSchema,
} from "@/lib/uploads/validation";

type ProjectFile = {
  id: string;
  projectId: string;
  title: string;
  kind: "file";
  authorId?: string;
  sizeBytes: number;
  size: string;
  updatedAt: string;
};

function uploadError(error: unknown) {
  if (error instanceof UploadServiceError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("Project file upload failed:", error);
  return Response.json({ error: "Could not process the file." }, { status: 500 });
}

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

function projectFile(resource: Record<string, unknown>): ProjectFile {
  const sizeBytes = Number(resource.sizeBytes ?? 0);
  return {
    id: String(resource.id),
    projectId: String(resource.projectId),
    title: String(resource.title),
    kind: "file",
    authorId:
      typeof resource.authorId === "string" ? resource.authorId : undefined,
    sizeBytes,
    size: `${Math.max(1, Math.round(sizeBytes / 1024))} KB`,
    updatedAt: String(resource.updatedAt),
  };
}

export async function POST(request: Request) {
  try {
    // Authentication intentionally precedes reading any request body.
    const supabase = await requireAuthenticatedClient();
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
    const parsed = projectUploadInitiationSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid upload." },
        { status: 400 },
      );
    }

    const session = await initiateUpload(supabase, {
      targetKind: "project_file",
      targetId: parsed.data.projectId,
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
    // Authentication intentionally precedes reading any request body.
    const supabase = await requireAuthenticatedClient();
    const parsed = uploadFinalizationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json(
        { error: "A valid upload reservation is required." },
        { status: 400 },
      );
    }

    const reservation = await finalizeUpload<Record<string, unknown> & { id: string }>(
      supabase,
      parsed.data.reservationId,
      "project_file",
    );
    if (!reservation) {
      return Response.json(
        { error: "Upload reservation not found." },
        { status: 404 },
      );
    }

    const file = projectFile(reservation.resource!);
    return Response.json({
      reservation: { ...reservation, resource: file },
      file,
    });
  } catch (error) {
    return uploadError(error);
  }
}
