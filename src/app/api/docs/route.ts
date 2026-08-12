import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { isDemoModeAllowed } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Invalid identifier.");

const createDocSchema = z.object({
  projectId: identifierSchema,
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(100_000).default(""),
});

const readDocSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
});

const updateDocSchema = createDocSchema.extend({
  id: identifierSchema,
  expectedVersion: z.number().int().positive(),
});

type DocRow = {
  id: string;
  project_id: string;
  title: string;
  content: unknown;
  plain_text: string | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function docResponse(row: DocRow) {
  const structuredBody =
    typeof row.content === "object" &&
    row.content !== null &&
    "body" in row.content &&
    typeof row.content.body === "string"
      ? row.content.body
      : "";
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.plain_text ?? structuredBody,
    kind: "doc" as const,
    authorId: row.created_by ?? row.updated_by ?? "",
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function isDemoRequest() {
  return (
    isDemoModeAllowed() &&
    (await cookies()).get("p11-demo")?.value === "true"
  );
}

function databaseErrorStatus(error: { code?: string }) {
  if (error.code === "42501") return 403;
  if (error.code === "23505") return 409;
  return 400;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = readDocSchema.safeParse({
    id: searchParams.get("id"),
    projectId: searchParams.get("projectId"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
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
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("docs")
    .select(
      "id,project_id,title,content,plain_text,status,version,created_by,updated_by,created_at,updated_at",
    )
    .eq("id", parsed.data.id)
    .eq("project_id", parsed.data.projectId)
    .maybeSingle<DocRow>();
  if (error) {
    console.error("Document read failed:", error);
    return Response.json(
      { error: error.message },
      { status: databaseErrorStatus(error) },
    );
  }
  if (!data) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }
  return Response.json({ doc: docResponse(data) });
}

export async function POST(request: Request) {
  const parsed = createDocSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  if (await isDemoRequest()) {
    const timestamp = new Date().toISOString();
    return Response.json({
      doc: {
        id: randomUUID(),
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        body: parsed.data.body,
        kind: "doc",
        authorId: "sam",
        status: "draft",
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      demo: true,
    }, { status: 201 });
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
    .select(
      "id,project_id,title,content,plain_text,status,version,created_by,updated_by,created_at,updated_at",
    )
    .single<DocRow>();

  if (error) {
    console.error("Document creation failed:", error);
    return Response.json(
      { error: error.message },
      { status: databaseErrorStatus(error) },
    );
  }
  return Response.json({ doc: docResponse(data) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = updateDocSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  if (await isDemoRequest()) {
    const timestamp = new Date().toISOString();
    return Response.json({
      doc: {
        id: parsed.data.id,
        projectId: parsed.data.projectId,
        title: parsed.data.title,
        body: parsed.data.body,
        kind: "doc",
        authorId: "sam",
        status: "draft",
        version: parsed.data.expectedVersion + 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      demo: true,
    });
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
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("docs")
    .update({
      title: parsed.data.title,
      content: { type: "p11-document", body: parsed.data.body },
      plain_text: parsed.data.body,
      updated_by: user.id,
      version: parsed.data.expectedVersion + 1,
    })
    .eq("id", parsed.data.id)
    .eq("project_id", parsed.data.projectId)
    .eq("version", parsed.data.expectedVersion)
    .select(
      "id,project_id,title,content,plain_text,status,version,created_by,updated_by,created_at,updated_at",
    )
    .maybeSingle<DocRow>();
  if (error) {
    console.error("Document update failed:", error);
    return Response.json(
      { error: error.message },
      { status: databaseErrorStatus(error) },
    );
  }
  if (!data) {
    return Response.json(
      { error: "This document changed after you opened it. Reopen it and try again." },
      { status: 409 },
    );
  }
  return Response.json({ doc: docResponse(data) });
}
