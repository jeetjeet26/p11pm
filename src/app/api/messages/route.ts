import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { getProjectMessagesData } from "@/lib/data";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

const idempotencyKey = z.string().trim().min(8).max(200).optional();

const payloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    projectId: z.string().min(2),
    title: z.string().trim().min(3).max(240),
    body: z.string().trim().min(2).max(20_000),
    category: z.enum(["update", "decision", "creative", "client"]),
    idempotencyKey,
  }),
  z.object({
    type: z.literal("comment"),
    projectId: z.string().min(2),
    parentType: z.enum(["message", "todo", "doc"]),
    parentId: z.string().min(1),
    body: z.string().trim().min(1).max(10_000),
    mentionProfileIds: z.array(z.string().min(1)).max(50).default([]),
    attachmentFileIds: z.array(z.string().min(1)).max(20).default([]),
    externalAttachments: z
      .array(
        z.object({
          url: z.url().refine((value) => /^https?:\/\//.test(value)),
          title: z.string().trim().min(1).max(240),
        }),
      )
      .max(20)
      .default([]),
    idempotencyKey,
  }),
]);

const querySchema = z.object({
  projectId: z.string().min(1),
});

function rpcErrorStatus(error: { code?: string }): number {
  if (error.code === "P0002") return 404;
  if (error.code === "42501") return 403;
  return 400;
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  try {
    return Response.json(await getProjectMessagesData(parsed.data.projectId));
  } catch (error) {
    console.error("Load project messages failed:", error);
    return Response.json({ error: "Unable to load project messages." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const demo =
    isDemoModeAllowed() &&
    (await cookies()).get("p11-demo")?.value === "true";
  if (demo) {
    return Response.json(
      {
        item: {
          id: randomUUID(),
          ...parsed.data,
          author_id: "sam",
          sender_id: "sam",
          created_at: new Date().toISOString(),
          comment_count: 0,
        },
        demo: true,
      },
      { status: 201 },
    );
  }

  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const input = parsed.data;
  const result =
    input.type === "message"
      ? await supabase.rpc("create_project_message", {
          target_project_id: input.projectId,
          target_subject: input.title,
          target_body: input.body,
          target_category: input.category,
          requested_actor_id: user.id,
          target_idempotency_key: input.idempotencyKey ?? randomUUID(),
        })
      : await supabase.rpc("create_project_comment", {
          target_project_id: input.projectId,
          target_parent_type: input.parentType,
          target_parent_id: input.parentId,
          target_body: input.body,
          target_mention_profile_ids: [...new Set(input.mentionProfileIds)],
          target_attachment_file_ids: [...new Set(input.attachmentFileIds)],
          target_external_attachments: input.externalAttachments,
          requested_actor_id: user.id,
          target_idempotency_key: input.idempotencyKey ?? randomUUID(),
        });

  if (result.error) {
    console.error("Create message or comment failed:", result.error);
    return Response.json(
      { error: result.error.message },
      { status: rpcErrorStatus(result.error) },
    );
  }

  return Response.json({ item: result.data }, { status: 201 });
}
