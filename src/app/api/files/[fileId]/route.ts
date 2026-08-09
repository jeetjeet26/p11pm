import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const { data, error } = await supabase.rpc(
    "resolve_basecamp_download_target",
    {
      file_id: fileId,
      archive_entry_id: null,
    },
  );
  if (error) {
    console.error("Read project file failed:", error);
    return Response.json({ error: "Could not read the file." }, { status: 500 });
  }
  const target = data?.[0];
  if (!target) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { error: "File delivery is not configured." },
      { status: 503 },
    );
  }
  const { data: signed, error: signedError } = await admin.storage
    .from(target.bucket_id)
    .createSignedUrl(target.object_path, 60, { download: target.file_name });
  if (signedError) {
    console.error("Sign project file download failed:", signedError);
    return Response.json(
      { error: "Could not download the file." },
      { status: 500 },
    );
  }

  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "private, no-store",
      location: signed.signedUrl,
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const supabase = await createClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase is not configured." },
      { status: 503 },
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const { error } = await supabase.from("files").delete().eq("id", fileId);
  if (error) {
    console.error("Queue project file deletion failed:", error);
    return Response.json(
      { error: "Could not remove the file." },
      { status: 500 },
    );
  }

  // The database trigger writes the object path to the durable deletion outbox.
  return new Response(null, { status: 204 });
}
