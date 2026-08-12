import type {
  ChatLinkTarget,
  WorkLinkInput,
  WorkLinkKind,
} from "@/lib/cross-links/types";

const uuid =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

function safeUrl(value: string, origin = "https://workspace.local") {
  try {
    return new URL(value, origin);
  } catch {
    return undefined;
  }
}

export function parseWorkLinkUrl(
  value: string,
  origin?: string,
): WorkLinkInput | undefined {
  const url = safeUrl(value, origin);
  if (!url || (origin && url.origin !== new URL(origin).origin)) return undefined;

  const issue = url.pathname.match(
    new RegExp(`^/projects/(${uuid})/issues/(${uuid})/?$`),
  );
  if (issue) return { type: "issue", id: issue[2] };

  const project = url.pathname.match(new RegExp(`^/projects/(${uuid})/?$`));
  if (project) {
    for (const [parameter, type] of [
      ["message", "message"],
      ["doc", "doc"],
      ["file", "file"],
      ["milestone", "milestone"],
      ["comment", "comment"],
    ] as const) {
      const id = url.searchParams.get(parameter);
      if (id && new RegExp(`^${uuid}$`).test(id)) return { type, id };
    }
    return { type: "project", id: project[1] };
  }

  const file = url.pathname.match(new RegExp(`^/api/files/(${uuid})/?$`));
  if (file) return { type: "file", id: file[1] };

  if (url.pathname === "/files") {
    const folderId = url.searchParams.get("folderId");
    if (folderId && new RegExp(`^${uuid}$`).test(folderId)) {
      return { type: "folder", id: folderId };
    }
    const fileId = url.searchParams.get("file");
    if (fileId && new RegExp(`^${uuid}$`).test(fileId)) {
      return { type: "file", id: fileId };
    }
  }

  const archive = url.pathname.match(new RegExp(`^/archive/(${uuid})/?$`));
  const archiveRecord = url.hash.match(
    new RegExp(`^#archive-record-(${uuid})$`),
  );
  if (archive && archiveRecord) {
    return { type: "archive_record", id: archiveRecord[1] };
  }
  return undefined;
}

export function parseChatLinkUrl(
  value: string,
  origin?: string,
): Pick<ChatLinkTarget, "type" | "id"> | undefined {
  const url = safeUrl(value, origin);
  if (!url || (origin && url.origin !== new URL(origin).origin)) return undefined;
  const conversation = url.pathname.match(new RegExp(`^/chat/(${uuid})/?$`));
  if (!conversation) return undefined;
  const attachmentId = url.searchParams.get("attachment");
  if (attachmentId && new RegExp(`^${uuid}$`).test(attachmentId)) {
    return { type: "attachment", id: attachmentId };
  }
  const messageId =
    url.searchParams.get("message") ?? url.searchParams.get("thread");
  if (messageId && new RegExp(`^${uuid}$`).test(messageId)) {
    return { type: "message", id: messageId };
  }
  return { type: "conversation", id: conversation[1] };
}

export function workResourceHref(
  type: WorkLinkKind,
  id: string,
  projectId: string,
) {
  switch (type) {
    case "project":
      return `/projects/${projectId}`;
    case "issue":
      return `/projects/${projectId}/issues/${id}`;
    case "comment":
      return `/projects/${projectId}?comment=${id}`;
    case "message":
      return `/projects/${projectId}?tab=messages&message=${id}`;
    case "doc":
      return `/projects/${projectId}?tab=files&doc=${id}`;
    case "file":
      return `/files?file=${id}`;
    case "folder":
      return `/files?folderId=${id}`;
    case "milestone":
      return `/projects/${projectId}?tab=activity&milestone=${id}`;
    case "archive_record":
      return `/archive/${projectId}#archive-record-${id}`;
  }
}

export function chatEntityHref({
  conversationId,
  rootMessageId,
  messageId,
  attachmentId,
}: {
  conversationId: string;
  rootMessageId?: string;
  messageId?: string;
  attachmentId?: string;
}) {
  const query = new URLSearchParams();
  if (rootMessageId) query.set("thread", rootMessageId);
  if (messageId) query.set("message", messageId);
  if (attachmentId) query.set("attachment", attachmentId);
  const suffix = query.size ? `?${query.toString()}` : "";
  return `/chat/${conversationId}${suffix}`;
}
