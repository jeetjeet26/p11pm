import { z } from "zod";

import type { CrossLinkSearchResult } from "@/lib/cross-links/types";
import type { WorkLinkKind } from "@/lib/cross-links/types";
import { chatEntityHref, workResourceHref } from "@/lib/cross-links/urls";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
  scope: z.enum(["work", "chat"]).default("work"),
  projectId: z.string().uuid().optional(),
});

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function excerpt(value: unknown, fallback: string) {
  const compact = text(value).replace(/\s+/g, " ").trim();
  return compact.length > 96 ? `${compact.slice(0, 93)}…` : compact || fallback;
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid link search." },
      { status: 400 },
    );
  }
  const client = await createClient();
  if (!client) {
    return Response.json({ error: "Search is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const escaped = parsed.data.q.replace(/[,%_()]/g, " ").trim();
  const pattern = `%${escaped}%`;
  try {
    const results =
      parsed.data.scope === "work"
        ? await searchWork(client, pattern, parsed.data.projectId)
        : await searchChat(client, pattern);
    return Response.json({ results: results.slice(0, 30) });
  } catch (error) {
    console.error("Cross-link search failed:", error);
    return Response.json(
      { error: "Link search is temporarily unavailable." },
      { status: 500 },
    );
  }
}

async function searchWork(
  client: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  pattern: string,
  projectId?: string,
): Promise<CrossLinkSearchResult[]> {
  let issuesQuery = client
    .from("todos")
    .select("id,project_id,title,issue_number,projects(name,code)")
    .or(`title.ilike.${pattern},description.ilike.${pattern}`)
    .limit(8);
  let commentsQuery = client
    .from("comments")
    .select("id,project_id,body")
    .ilike("body", pattern)
    .limit(5);
  let messagesQuery = client
    .from("messages")
    .select("id,project_id,subject,body")
    .or(`subject.ilike.${pattern},body.ilike.${pattern}`)
    .limit(5);
  let docsQuery = client
    .from("docs")
    .select("id,project_id,title,status")
    .or(`title.ilike.${pattern},plain_text.ilike.${pattern}`)
    .limit(5);
  let filesQuery = client
    .from("files")
    .select("id,project_id,file_name,mime_type")
    .ilike("file_name", pattern)
    .limit(5);
  let foldersQuery = client
    .from("file_folders")
    .select("id,project_id,name")
    .is("trashed_at", null)
    .ilike("name", pattern)
    .limit(6);
  let milestonesQuery = client
    .from("milestones")
    .select("id,project_id,name,status")
    .ilike("name", pattern)
    .limit(5);
  let archiveQuery = client
    .from("basecamp_archive_records")
    .select("id,project_id,title,record_type")
    .or(`title.ilike.${pattern},plain_text.ilike.${pattern}`)
    .limit(5);
  if (projectId) {
    issuesQuery = issuesQuery.eq("project_id", projectId);
    commentsQuery = commentsQuery.eq("project_id", projectId);
    messagesQuery = messagesQuery.eq("project_id", projectId);
    docsQuery = docsQuery.eq("project_id", projectId);
    filesQuery = filesQuery.eq("project_id", projectId);
    foldersQuery = foldersQuery.eq("project_id", projectId);
    milestonesQuery = milestonesQuery.eq("project_id", projectId);
    archiveQuery = archiveQuery.eq("project_id", projectId);
  }
  const [projects, issues, comments, messages, docs, files, folders, milestones, archive] =
    await Promise.all([
      client
        .from("projects")
        .select("id,name,code,client_name")
        .or(`name.ilike.${pattern},code.ilike.${pattern},client_name.ilike.${pattern}`)
        .limit(6),
      issuesQuery,
      commentsQuery,
      messagesQuery,
      docsQuery,
      filesQuery,
      foldersQuery,
      milestonesQuery,
      archiveQuery,
    ]);
  const failed = [
    projects,
    issues,
    comments,
    messages,
    docs,
    files,
    folders,
    milestones,
    archive,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;

  return [
    ...((projects.data ?? []) as Row[]).map((row) =>
      workResult("project", row, text(row.id), text(row.name, "Project"), "Project"),
    ),
    ...((issues.data ?? []) as Row[]).map((row) =>
      workResult(
        "issue",
        row,
        text(row.project_id),
        text(row.title, "Issue"),
        row.issue_number ? `Issue #${String(row.issue_number)}` : "Issue",
      ),
    ),
    ...((comments.data ?? []) as Row[]).map((row) =>
      workResult(
        "comment",
        row,
        text(row.project_id),
        excerpt(row.body, "Comment"),
        "Comment",
      ),
    ),
    ...((messages.data ?? []) as Row[]).map((row) =>
      workResult(
        "message",
        row,
        text(row.project_id),
        text(row.subject) || excerpt(row.body, "Project update"),
        "Project update",
      ),
    ),
    ...((docs.data ?? []) as Row[]).map((row) =>
      workResult(
        "doc",
        row,
        text(row.project_id),
        text(row.title, "Document"),
        "Document",
      ),
    ),
    ...((files.data ?? []) as Row[]).map((row) =>
      workResult(
        "file",
        row,
        text(row.project_id),
        text(row.file_name, "File"),
        text(row.mime_type, "File"),
      ),
    ),
    ...((folders.data ?? []) as Row[]).map((row) =>
      workResult(
        "folder",
        row,
        text(row.project_id),
        text(row.name, "Folder"),
        "File folder",
      ),
    ),
    ...((milestones.data ?? []) as Row[]).map((row) =>
      workResult(
        "milestone",
        row,
        text(row.project_id),
        text(row.name, "Milestone"),
        "Milestone",
      ),
    ),
    ...((archive.data ?? []) as Row[]).map((row) =>
      workResult(
        "archive_record",
        row,
        text(row.project_id),
        text(row.title, "Historical record"),
        `History · ${text(row.record_type, "record").replaceAll("_", " ")}`,
      ),
    ),
  ];
}

function workResult(
  type: CrossLinkSearchResult["type"],
  row: Row,
  projectId: string,
  title: string,
  context: string,
): CrossLinkSearchResult {
  return {
    id: text(row.id),
    scope: "work",
    type,
    title,
    context,
    projectId,
    href: workResourceHref(type as WorkLinkKind, text(row.id), projectId),
  };
}

async function searchChat(
  client: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  pattern: string,
): Promise<CrossLinkSearchResult[]> {
  const [conversations, messages, attachments] = await Promise.all([
    client
      .from("workspace_conversations")
      .select("id,kind,name")
      .ilike("name", pattern)
      .limit(8),
    client
      .from("workspace_messages")
      .select("id,conversation_id,parent_message_id,body")
      .ilike("body", pattern)
      .limit(12),
    client
      .from("workspace_message_attachments")
      .select("id,conversation_id,message_id,file_name")
      .not("message_id", "is", null)
      .ilike("file_name", pattern)
      .limit(8),
  ]);
  const failed = [conversations, messages, attachments].find(
    (result) => result.error,
  );
  if (failed?.error) throw failed.error;
  return [
    ...((conversations.data ?? []) as Row[]).map((row) => ({
      id: text(row.id),
      scope: "chat" as const,
      type: "conversation" as const,
      title:
        text(row.kind) === "channel"
          ? `#${text(row.name, "channel")}`
          : "Direct message",
      context: "Conversation",
      conversationId: text(row.id),
      href: chatEntityHref({ conversationId: text(row.id) }),
    })),
    ...((messages.data ?? []) as Row[]).map((row) => {
      const parentMessageId = text(row.parent_message_id);
      return {
        id: text(row.id),
        scope: "chat" as const,
        type: "message" as const,
        title: excerpt(row.body, "Chat message"),
        context: parentMessageId ? "Thread reply" : "Chat message",
        conversationId: text(row.conversation_id),
        rootMessageId: parentMessageId || text(row.id),
        messageId: text(row.id),
        href: chatEntityHref({
          conversationId: text(row.conversation_id),
          rootMessageId: parentMessageId || undefined,
          messageId: text(row.id),
        }),
      };
    }),
    ...((attachments.data ?? []) as Row[]).map((row) => ({
      id: text(row.id),
      scope: "chat" as const,
      type: "attachment" as const,
      title: text(row.file_name, "Chat attachment"),
      context: "Chat attachment",
      conversationId: text(row.conversation_id),
      messageId: text(row.message_id),
      attachmentId: text(row.id),
      href: chatEntityHref({
        conversationId: text(row.conversation_id),
        messageId: text(row.message_id),
        attachmentId: text(row.id),
      }),
    })),
  ];
}
