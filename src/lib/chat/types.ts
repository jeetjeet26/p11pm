export type WorkspaceConversationKind = "channel" | "dm";
export type WorkspaceConversationVisibility = "public" | "private";
export type WorkspaceConversationMemberRole = "owner" | "member";
export type WorkspaceProfileRole = "admin" | "manager" | "member" | "viewer";
export type WorkspaceProfileStatus = "active" | "suspended" | "deactivated";

export interface WorkspaceAttachment {
  id: string;
  fileName: string;
  mimeType?: string;
  sizeBytes: number;
}

export interface ChatProfile {
  id: string;
  fullName: string;
  email: string;
  initials: string;
  title: string;
  avatarUrl?: string;
  role: WorkspaceProfileRole;
}

export interface WorkspaceConversationMember {
  profileId: string;
  role: WorkspaceConversationMemberRole;
}

export interface WorkspaceConversation {
  id: string;
  organizationId: string;
  kind: WorkspaceConversationKind;
  visibility: WorkspaceConversationVisibility;
  name?: string;
  slug?: string;
  dmProfileA?: string;
  dmProfileB?: string;
  dmMemberKey?: string;
  members: WorkspaceConversationMember[];
  memberCount: number;
  rosterLoaded: boolean;
  currentMemberRole?: WorkspaceConversationMemberRole;
  canManage: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageId?: string;
  lastMessageBody?: string;
  lastMessageSenderId?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

export interface WorkspaceAdminProfile {
  id: string;
  email: string;
  fullName: string;
  title: string;
  role: WorkspaceProfileRole;
  status: WorkspaceProfileStatus;
  chatEnabled: boolean;
}

export interface WorkspaceAdminChannel {
  id: string;
  name: string;
  slug: string;
  visibility: WorkspaceConversationVisibility;
  createdBy?: string;
  members: WorkspaceConversationMember[];
}

export interface WorkspaceMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  clientNonce: string;
  parentMessageId?: string;
  createdAt: string;
  replyCount: number;
  lastReplyAt?: string;
  threadUnreadCount: number;
  attachments: WorkspaceAttachment[];
}

export interface ChatShellBootstrap {
  currentProfile: ChatProfile;
  profiles: ChatProfile[];
  conversations: WorkspaceConversation[];
}

export interface WorkspaceMessagePage {
  messages: WorkspaceMessage[];
  hasMore: boolean;
}

export interface WorkspaceConversationPageCursor {
  kindRank: number;
  sortAt: string;
  conversationId: string;
}

export interface WorkspaceConversationPage {
  conversations: WorkspaceConversation[];
  hasMore: boolean;
  nextCursor?: WorkspaceConversationPageCursor;
}

export type WorkspaceChatEventType =
  | "message.created"
  | "conversation.upsert"
  | "conversation.revoked"
  | "conversation.read"
  | "thread.read"
  | "workspace.reset"
  | "workspace.revoked";

export interface WorkspaceChatEvent {
  sequence: string;
  type: WorkspaceChatEventType;
  conversationId?: string;
  messageId?: string;
  parentMessageId?: string;
  senderId?: string;
  eventAt: string;
}

export interface WorkspaceChatEventPage {
  events: WorkspaceChatEvent[];
  cursor: string;
  serverCursor: string;
  hasMore: boolean;
  resetRequired: boolean;
}

export interface WorkspaceChatBootstrap {
  currentProfile: ChatProfile;
  profiles: ChatProfile[];
  summaryPage: WorkspaceConversationPage;
  selectedConversationId?: string;
  selectedMessagePage: WorkspaceMessagePage;
  cursor: string;
}
