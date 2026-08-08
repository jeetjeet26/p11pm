import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const docSchema = z.object({
  projectId: z.string().min(2),
  title: z.string().trim().min(2).max(240),
  body: z.string().trim().max(100_000).default(""),
});

export async function POST(request: Request) {
  const parsed = docSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  if ((await cookies()).get("p11-demo")?.value === "true") {
    return Response.json({
      doc: {
        id: randomUUID(),
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        kind: "doc",
        authorId: "sam",
        updatedAt: new Date().toISOString(),
      },
      demo: true,
    });
  }

  const supabase = await createClient();
  if (!supabase) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const slugBase =
    parsed.data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "doc";
  const { data, error } = await supabase
    .from("docs")
    .insert({
      project_id: parsed.data.projectId,
      title: parsed.data.title,
      slug: `${slugBase}-${randomUUID().slice(0, 8)}`,
      content: { type: "p11-document", body: parsed.data.body },
      plain_text: parsed.data.body,
      created_by: user.id,
      updated_by: user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("Document creation failed:", error);
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ doc: data }, { status: 201 });
}
