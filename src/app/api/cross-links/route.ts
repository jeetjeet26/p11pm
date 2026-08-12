import { z } from "zod";

import {
  getWorkBacklinks,
  resolveChatTarget,
  resolveWorkResource,
} from "@/lib/cross-links/server";
import { workLinkKinds } from "@/lib/cross-links/types";
import { parseChatLinkUrl, parseWorkLinkUrl } from "@/lib/cross-links/urls";
import { createClient } from "@/lib/supabase/server";

const workType = z.enum(workLinkKinds);
const querySchema = z.object({
  workType,
  workId: z.string().uuid(),
});
const deleteQuerySchema = z.object({
  linkId: z.string().uuid(),
});
const payloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("resolve"),
    scope: z.enum(["work", "chat"]),
    url: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    action: z.literal("link"),
    chatType: z.enum(["conversation", "message", "attachment"]),
    chatId: z.string().uuid(),
    workType,
    workId: z.string().uuid(),
  }),
]);

async function authenticatedClient() {
  const client = await createClient();
  if (!client) return { error: "Supabase is not configured.", status: 503 };
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 };
  return { client };
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid backlink query." },
      { status: 400 },
    );
  }
  const auth = await authenticatedClient();
  if (!auth.client) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const backlinks = await getWorkBacklinks(auth.client, {
      type: parsed.data.workType,
      id: parsed.data.workId,
    });
    return Response.json({ backlinks });
  } catch (error) {
    console.error("Load cross-link backlinks failed:", error);
    return Response.json(
      { error: "Unable to load linked conversations." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid cross-link request." },
      { status: 400 },
    );
  }
  const auth = await authenticatedClient();
  if (!auth.client) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  try {
    if (parsed.data.action === "resolve") {
      const origin = new URL(request.url).origin;
      if (parsed.data.scope === "work") {
        const input = parseWorkLinkUrl(parsed.data.url, origin);
        if (!input) {
          return Response.json(
            { error: "This is not a recognized workspace link." },
            { status: 400 },
          );
        }
        const resource = await resolveWorkResource(auth.client, input);
        return resource
          ? Response.json({ result: { ...resource, scope: "work" } })
          : Response.json({ error: "Linked work is unavailable." }, { status: 404 });
      }
      const input = parseChatLinkUrl(parsed.data.url, origin);
      if (!input) {
        return Response.json(
          { error: "This is not a recognized chat link." },
          { status: 400 },
        );
      }
      const target = await resolveChatTarget(auth.client, input.type, input.id);
      return target
        ? Response.json({ result: { ...target, scope: "chat" } })
        : Response.json({ error: "Linked chat is unavailable." }, { status: 404 });
    }

    const { data, error } = await auth.client.rpc(
      "link_workspace_chat_entity",
      {
        target_chat_type: parsed.data.chatType,
        target_chat_id: parsed.data.chatId,
        target_work_type: parsed.data.workType,
        target_work_id: parsed.data.workId,
      },
    );
    if (error) {
      const status = error.code === "42501" ? 403 : 400;
      return Response.json({ error: error.message }, { status });
    }
    return Response.json({ link: data }, { status: 201 });
  } catch (error) {
    console.error("Create or resolve cross-link failed:", error);
    return Response.json(
      { error: "Unable to process this cross-link." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const parsed = deleteQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid cross-link." }, { status: 400 });
  }
  const auth = await authenticatedClient();
  if (!auth.client) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const { error, count } = await auth.client
    .from("workspace_cross_links")
    .delete({ count: "exact" })
    .eq("id", parsed.data.linkId);
  if (error) {
    return Response.json({ error: error.message }, { status: 403 });
  }
  if (!count) {
    return Response.json(
      { error: "Only the link creator can remove this link." },
      { status: 403 },
    );
  }
  return new Response(null, { status: 204 });
}
