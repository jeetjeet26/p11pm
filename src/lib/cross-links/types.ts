export const workLinkKinds = [
  "project",
  "issue",
  "comment",
  "message",
  "doc",
  "file",
  "folder",
  "milestone",
  "archive_record",
] as const;

export type WorkLinkKind = (typeof workLinkKinds)[number];
export type ChatLinkKind = "conversation" | "message" | "attachment";

export interface WorkLinkInput {
  type: WorkLinkKind;
  id: string;
}

export interface LinkedWorkResource extends WorkLinkInput {
  projectId: string;
  title: string;
  context: string;
  href: string;
  unavailable?: boolean;
}

export interface ChatLinkTarget {
  type: ChatLinkKind;
  id: string;
  conversationId: string;
  title: string;
  context: string;
  href: string;
  rootMessageId?: string;
  messageId?: string;
  attachmentId?: string;
}

export interface WorkspaceCrossLink {
  id: string;
  chatType: ChatLinkKind;
  conversationId: string;
  workspaceMessageId?: string;
  workspaceAttachmentId?: string;
  work: LinkedWorkResource;
  createdAt: string;
}

export interface WorkBacklink {
  id: string;
  chatType: ChatLinkKind;
  conversationId: string;
  conversationName: string;
  authorName?: string;
  excerpt?: string;
  createdAt: string;
  href: string;
  attachmentName?: string;
}

export interface CrossLinkSearchResult {
  id: string;
  scope: "work" | "chat";
  type: WorkLinkKind | ChatLinkKind;
  title: string;
  context: string;
  href: string;
  projectId?: string;
  conversationId?: string;
  rootMessageId?: string;
  messageId?: string;
  attachmentId?: string;
}
