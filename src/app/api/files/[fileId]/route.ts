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
  const { data, error } = await supabase
    .from("files")
    .select("bucket_id,object_path,file_name")
    .eq("id", fileId)
    .maybeSingle();
  if (error) {
    console.error("Read project file failed:", error);
    return Response.json({ error: "Could not read the file." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "File not found." }, { status: 404 });
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(data.bucket_id)
    .createSignedUrl(data.object_path, 60, { download: data.file_name });
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
