import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const createSchema = z.object({
  sourceType: z.string().trim().min(1).max(80),
  sourceId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(240),
  href: z.string().startsWith("/").max(2_000),
  projectId: z.string().uuid().optional(),
  note: z.string().trim().max(2_000).optional(),
});

const deleteSchema = z.object({
  sourceType: z.string().trim().min(1).max(80),
  sourceId: z.string().trim().min(1).max(200),
});

export async function GET() {
  const auth = await authenticated();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.client
    .from("saved_workspace_items")
    .select("*")
    .eq("owner_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ items: data ?? [] });
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid saved item." },
      { status: 400 },
    );
  }
  const auth = await authenticated();
  if (!auth.ok) return auth.response;
  const { data, error } = await auth.client
    .from("saved_workspace_items")
    .upsert(
      {
        organization_id: auth.organizationId,
        owner_id: auth.userId,
        project_id: parsed.data.projectId ?? null,
        source_type: parsed.data.sourceType,
        source_id: parsed.data.sourceId,
        title: parsed.data.title,
        href: parsed.data.href,
        note: parsed.data.note ?? null,
      },
      { onConflict: "owner_id,source_type,source_id" },
    )
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ item: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid saved item." }, { status: 400 });
  }
  const auth = await authenticated();
  if (!auth.ok) return auth.response;
  const { error } = await auth.client
    .from("saved_workspace_items")
    .delete()
    .eq("owner_id", auth.userId)
    .eq("source_type", parsed.data.sourceType)
    .eq("source_id", parsed.data.sourceId);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return new Response(null, { status: 204 });
}

async function authenticated() {
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: profile } = await client
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .eq("status", "active")
    .single();
  if (!profile?.organization_id) {
    return {
      ok: false as const,
      response: Response.json({ error: "Workspace membership required." }, { status: 403 }),
    };
  }
  return {
    ok: true as const,
    client,
    userId: user.id,
    organizationId: profile.organization_id,
  };
}
