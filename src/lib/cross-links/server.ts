import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ChatLinkKind,
  ChatLinkTarget,
  LinkedWorkResource,
  WorkBacklink,
  WorkLinkInput,
  WorkLinkKind,
  WorkspaceCrossLink,
} from "@/lib/cross-links/types";
import {
  chatEntityHref,
  workResourceHref,
} from "@/lib/cross-links/urls";

type Row = Record<string, unknown>;

const workSelections: Record<
  WorkLinkKind,
  { table: string; columns: string }
> = {
  project: { table: "projects", columns: "id,name,code" },
  issue: {
    table: "todos",
    columns: "id,project_id,title,issue_number,operational_state",
  },
  comment: {
    table: "comments",
    columns: "id,project_id,todo_id,doc_id,body,metadata",
  },
  message: { table: "messages", columns: "id,project_id,subject,body" },
  doc: { table: "docs", columns: "id,project_id,title,status" },
  file: { table: "files", columns: "id,project_id,file_name,mime_type,size_bytes" },
  folder: {
    table: "file_folders",
    columns: "id,project_id,name,description",
  },
  milestone: { table: "milestones", columns: "id,project_id,name,status" },
  archive_record: {
    table: "basecamp_archive_records",
    columns: "id,project_id,title,record_type",
  },
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function excerpt(value: unknown, fallback: string) {
  const compact = text(value).replace(/\s+/g, " ").trim();
  if (!compact) return fallback;
  return compact.length > 100 ? `${compact.slice(0, 97)}…` : compact;
}

function titleFor(type: WorkLinkKind, row: Row) {
  switch (type) {
    case "project":
      return text(row.name, "Project");
    case "issue":
      return text(row.title, "Issue");
    case "comment":
      return excerpt(row.body, "Comment");
    case "message":
      return text(row.subject) || excerpt(row.body, "Project update");
    case "doc":
      return text(row.title, "Document");
    case "file":
      return text(row.file_name, "File");
    case "folder":
      return text(row.name, "Folder");
    case "milestone":
      return text(row.name, "Milestone");
    case "archive_record":
      return text(row.title, "Historical record");
  }
}

function contextFor(type: WorkLinkKind, row: Row) {
  switch (type) {
    case "project":
      return text(row.code) ? `Project · ${text(row.code)}` : "Project";
    case "issue":
      return row.issue_number
        ? `Issue #${String(row.issue_number)} · ${text(row.operational_state, "active")}`
        : "Issue";
    case "comment":
      return "Comment";
    case "message":
      return "Project update";
    case "doc":
      return `Document · ${text(row.status, "draft")}`;
    case "file":
      return text(row.mime_type, "File");
    case "folder":
      return "File folder";
    case "milestone":
      return `Milestone · ${text(row.status, "planned")}`;
    case "archive_record":
      return `History · ${text(row.record_type, "record").replaceAll("_", " ")}`;
  }
}

export async function resolveWorkResource(
  client: SupabaseClient,
  input: WorkLinkInput,
): Promise<LinkedWorkResource | undefined> {
  const selection = workSelections[input.type];
  const { data, error } = await client
    .from(selection.table)
    .select(selection.columns)
    .eq("id", input.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const row = data as unknown as Row;
  const projectId =
    input.type === "project" ? input.id : text(row.project_id);
  if (!projectId && input.type !== "file" && input.type !== "folder") {
    return undefined;
  }
  let href = workResourceHref(input.type, input.id, projectId);
  if (input.type === "comment") {
    const todoId = text(row.todo_id);
    const docId = text(row.doc_id);
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Row)
        : {};
    const messageId = text(metadata.message_id);
    if (todoId) {
      href = `/projects/${projectId}/issues/${todoId}?comment=${input.id}`;
    } else if (docId) {
      href = `/projects/${projectId}?tab=files&doc=${docId}&comment=${input.id}`;
    } else if (messageId) {
      href = `/projects/${projectId}?tab=messages&message=${messageId}&comment=${input.id}`;
    }
  }
  return {
    ...input,
    projectId,
    title: titleFor(input.type, row),
    context: contextFor(input.type, row),
    href,
  };
}

export async function getMessageCrossLinks(
  client: SupabaseClient,
  messageIds: string[],
) {
  const byMessage = new Map<string, WorkspaceCrossLink[]>();
  if (!messageIds.length) return byMessage;
  const { data, error } = await client
    .from("workspace_cross_links")
    .select(
      "id,chat_type,conversation_id,workspace_message_id,workspace_attachment_id,work_type,work_id,created_at",
    )
    .in("workspace_message_id", messageIds)
    .order("created_at");
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const resources = new Map<string, LinkedWorkResource>();
  await Promise.all(
    rows.map(async (row) => {
      const input = {
        type: text(row.work_type) as WorkLinkKind,
        id: text(row.work_id),
      };
      const key = `${input.type}:${input.id}`;
      if (!resources.has(key)) {
        const resource = await resolveWorkResource(client, input);
        if (resource) resources.set(key, resource);
      }
    }),
  );
  for (const row of rows) {
    const messageId = text(row.workspace_message_id);
    const key = `${text(row.work_type)}:${text(row.work_id)}`;
    const work = resources.get(key);
    if (!messageId || !work) continue;
    const link: WorkspaceCrossLink = {
      id: text(row.id),
      chatType: text(row.chat_type) as ChatLinkKind,
      conversationId: text(row.conversation_id),
      workspaceMessageId: messageId,
      workspaceAttachmentId: text(row.workspace_attachment_id) || undefined,
      work,
      createdAt: text(row.created_at),
    };
    byMessage.set(messageId, [...(byMessage.get(messageId) ?? []), link]);
  }
  return byMessage;
}

export async function resolveChatTarget(
  client: SupabaseClient,
  type: ChatLinkKind,
  id: string,
): Promise<ChatLinkTarget | undefined> {
  if (type === "conversation") {
    const { data, error } = await client
      .from("workspace_conversations")
      .select("id,kind,name,slug")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    const row = data as Row;
    return {
      type,
      id,
      conversationId: id,
      title:
        text(row.kind) === "channel"
          ? `#${text(row.name, "channel")}`
          : "Direct message",
      context: "Conversation",
      href: chatEntityHref({ conversationId: id }),
    };
  }

  if (type === "message") {
    const { data, error } = await client
      .from("workspace_messages")
      .select("id,conversation_id,parent_message_id,body")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    const row = data as Row;
    const conversationId = text(row.conversation_id);
    const parentMessageId = text(row.parent_message_id);
    return {
      type,
      id,
      conversationId,
      title: excerpt(row.body, "Chat message"),
      context: parentMessageId ? "Thread reply" : "Chat message",
      rootMessageId: parentMessageId || id,
      messageId: id,
      href: chatEntityHref({
        conversationId,
        rootMessageId: parentMessageId || undefined,
        messageId: id,
      }),
    };
  }

  const { data, error } = await client
    .from("workspace_message_attachments")
    .select("id,conversation_id,message_id,file_name")
    .eq("id", id)
    .not("message_id", "is", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const row = data as Row;
  const conversationId = text(row.conversation_id);
  const messageId = text(row.message_id);
  const messageTarget = messageId
    ? await resolveChatTarget(client, "message", messageId)
    : undefined;
  return {
    type,
    id,
    conversationId,
    title: text(row.file_name, "Chat attachment"),
    context: "Chat attachment",
    rootMessageId: messageTarget?.rootMessageId,
    messageId,
    attachmentId: id,
    href: chatEntityHref({
      conversationId,
      rootMessageId: messageTarget?.rootMessageId,
      messageId,
      attachmentId: id,
    }),
  };
}

export async function getWorkBacklinks(
  client: SupabaseClient,
  input: WorkLinkInput,
): Promise<WorkBacklink[]> {
  const { data, error } = await client
    .from("workspace_cross_links")
    .select(
      "id,chat_type,conversation_id,workspace_message_id,workspace_attachment_id,created_at",
    )
    .eq("work_type", input.type)
    .eq("work_id", input.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const links = (data ?? []) as Row[];
  return Promise.all(
    links.map(async (link) => {
      const type = text(link.chat_type) as ChatLinkKind;
      const chatId =
        type === "conversation"
          ? text(link.conversation_id)
          : type === "message"
            ? text(link.workspace_message_id)
            : text(link.workspace_attachment_id);
      const target = await resolveChatTarget(client, type, chatId);
      const conversation = await resolveChatTarget(
        client,
        "conversation",
        text(link.conversation_id),
      );
      return {
        id: text(link.id),
        chatType: type,
        conversationId: text(link.conversation_id),
        conversationName: conversation?.title ?? "Chat",
        excerpt: target?.type === "message" ? target.title : undefined,
        attachmentName:
          target?.type === "attachment" ? target.title : undefined,
        createdAt: text(link.created_at),
        href:
          target?.href ??
          chatEntityHref({ conversationId: text(link.conversation_id) }),
      };
    }),
  );
}
