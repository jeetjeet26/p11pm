import { databaseError, requireFileAuth } from "@/lib/files/server";
import { commentCreateSchema } from "@/lib/files/validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const { fileId } = await params;
  const { data, error } = await auth.client
    .from("file_comments")
    .select(
      "id,file_id,parent_id,body,author_id,created_at,updated_at,author:profiles!file_comments_author_id_fkey(full_name)",
    )
    .eq("file_id", fileId)
    .order("created_at");
  if (error) return databaseError(error);
  return Response.json({
    comments: (data ?? []).map((item) => {
      const author = Array.isArray(item.author) ? item.author[0] : item.author;
      return {
        id: item.id,
        fileId: item.file_id,
        parentId: item.parent_id,
        body: item.body,
        authorId: item.author_id,
        authorName: author?.full_name ?? "P11 teammate",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
    }),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await requireFileAuth();
  if (!auth.ok) return auth.response;
  const parsed = commentCreateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid comment." },
      { status: 400 },
    );
  }
  const { fileId } = await params;
  const { data, error } = await auth.client
    .from("file_comments")
    .insert({
      file_id: fileId,
      parent_id: parsed.data.parentId ?? null,
      author_id: auth.userId,
      body: parsed.data.body,
    })
    .select("id,file_id,parent_id,body,author_id,created_at,updated_at")
    .single();
  if (error) return databaseError(error);
  return Response.json({ comment: data }, { status: 201 });
}
