import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const { entryId } = await params;
  if (!UUID.test(entryId)) {
    return Response.json({ error: "Invalid archive entry." }, { status: 400 });
  }
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

  const { data, error } = await supabase.rpc(
    "resolve_basecamp_download_target",
    {
      file_id: null,
      archive_entry_id: entryId,
    },
  );
  if (error) {
    console.error("Authorize Basecamp archive download failed:", error);
    return Response.json({ error: "Could not authorize the file." }, { status: 500 });
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
  const inline =
    request.headers.get("sec-fetch-dest") === "image" &&
    String(target.mime_type ?? "").startsWith("image/");
  const { data: signed, error: signedError } = await admin.storage
    .from(target.bucket_id)
    .createSignedUrl(
      target.object_path,
      60,
      inline ? undefined : { download: target.file_name },
    );
  if (signedError) {
    console.error("Sign Basecamp archive download failed:", signedError);
    return Response.json({ error: "Could not deliver the file." }, { status: 500 });
  }
  return new Response(null, {
    status: 302,
    headers: {
      "cache-control": "private, no-store",
      location: signed.signedUrl,
    },
  });
}
