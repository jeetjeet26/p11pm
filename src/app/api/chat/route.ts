import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const chatSchema = z.object({
  projectId: z.string().min(2),
  body: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  const parsed = chatSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  if ((await cookies()).get("p11-demo")?.value === "true") {
    return Response.json({
      message: {
        id: randomUUID(),
        projectId: parsed.data.projectId,
        authorId: "sam",
        body: parsed.data.body,
        createdAt: new Date().toISOString(),
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

  const { data, error } = await supabase
    .from("chat_messages")
    .insert({
      project_id: parsed.data.projectId,
      conversation_id: parsed.data.projectId,
      content: parsed.data.body,
      profile_id: user.id,
      role: "user",
    })
    .select()
    .single();

  if (error) {
    console.error("Create chat message failed:", error);
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ message: data }, { status: 201 });
}
