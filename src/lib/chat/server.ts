import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ChatProfile,
  WorkspaceConversation,
  WorkspaceConversationMember,
  WorkspaceAttachment,
  WorkspaceAdminChannel,
  WorkspaceAdminProfile,
  WorkspaceChatBootstrap,
  WorkspaceChatEvent,
  WorkspaceChatEventPage,
  WorkspaceMessage,
  WorkspaceMessagePage,
  WorkspaceConversationPage,
  WorkspaceConversationPageCursor,
} from "@/lib/chat/types";
import { getMessageCrossLinks } from "@/lib/cross-links/server";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

export class ChatAccessError extends Error {
  constructor(message = "Your account does not have access to P11 Chat.") {
    super(message);
    this.name = "ChatAccessError";
  }
}

export interface ChatRequestContext {
  supabase: SupabaseClient;
  userId: string;
  organizationId: string;
  currentProfile: ChatProfile;
}

export interface ChatAuthContext {
  supabase: SupabaseClient;
  userId: string;
}

export interface WorkspaceAdminContext extends ChatAuthContext {
  organizationId: string;
  currentProfile: ChatProfile;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown) {
  const result = asString(value);
  return result || undefined;
}

function initials(fullName: string) {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function mapChatProfile(row: Row): ChatProfile {
  const fullName = asString(row.full_name, "P11 teammate");
  return {
    id: asString(row.id),
    fullName,
    email: asString(row.email),
    initials: initials(fullName),
    title: asString(row.title, "P11 team"),
    avatarUrl: asOptionalString(row.avatar_url),
    role: asString(row.role, "member") as ChatProfile["role"],
  };
}

export function mapConversation(row: Row): WorkspaceConversation {
  const memberRows = Array.isArray(row.members) ? row.members : [];
  const members: WorkspaceConversationMember[] = memberRows.map((member) => {
    const item = member as Row;
    return {
      profileId: asString(item.profile_id),
      role: asString(
        item.member_role,
        "member",
      ) as WorkspaceConversationMember["role"],
    };
  });
  return {
    id: asString(row.conversation_id ?? row.id),
    organizationId: asString(row.organization_id),
    kind: asString(row.kind, "channel") as WorkspaceConversation["kind"],
    visibility: asString(
      row.visibility,
      row.kind === "dm" ? "private" : "public",
    ) as WorkspaceConversation["visibility"],
    name: asOptionalString(row.name),
    slug: asOptionalString(row.slug),
    dmProfileA: asOptionalString(row.dm_profile_a),
    dmProfileB: asOptionalString(row.dm_profile_b),
    dmMemberKey: asOptionalString(row.dm_member_key),
    members,
    memberCount: Number(row.member_count ?? members.length),
    rosterLoaded: row.roster_loaded === true,
    currentMemberRole: asOptionalString(
      row.current_member_role,
    ) as WorkspaceConversation["currentMemberRole"],
    canManage: row.can_manage === true,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    lastMessageId: asOptionalString(row.last_message_id),
    lastMessageBody: asOptionalString(row.last_message_body),
    lastMessageSenderId: asOptionalString(row.last_message_sender_id),
    lastMessageAt: asOptionalString(row.last_message_at),
    unreadCount: Number(row.unread_count ?? 0),
  };
}

export function mapWorkspaceMessage(row: Row): WorkspaceMessage {
  const attachmentRows = row.attachments ?? row.workspace_message_attachments;
  const attachments: WorkspaceAttachment[] = Array.isArray(attachmentRows)
    ? attachmentRows.map((attachment) => {
        const item = attachment as Row;
        return {
          id: asString(item.id),
          fileName: asString(item.file_name),
          mimeType: asOptionalString(item.mime_type),
          sizeBytes: Number(item.size_bytes ?? 0),
        };
      })
    : [];

  return {
    id: asString(row.message_id ?? row.id),
    conversationId: asString(row.conversation_id),
    senderId: asString(row.sender_id),
    body: asString(row.body),
    clientNonce: asString(row.client_nonce),
    parentMessageId: asOptionalString(row.parent_message_id),
    createdAt: asString(row.created_at),
    editedAt: asOptionalString(row.edited_at),
    deletedAt: asOptionalString(row.deleted_at),
    replyCount: Number(row.reply_count ?? 0),
    lastReplyAt: asOptionalString(row.last_reply_at),
    threadUnreadCount: Number(row.thread_unread_count ?? 0),
    attachments,
    links: [],
    signals: [],
  };
}

async function hydrateMessageLinks(
  client: SupabaseClient,
  messages: WorkspaceMessage[],
) {
  if (!messages.length) return messages;
  const messageIds = messages.map((message) => message.id);
  const [links, metadata, signals] = await Promise.all([
    getMessageCrossLinks(client, messageIds),
    client
      .from("workspace_messages")
      .select("id,edited_at,deleted_at")
      .in("id", messageIds),
    client
      .from("workspace_message_signals")
      .select("message_id,profile_id,signal")
      .in("message_id", messageIds),
  ]);
  if (metadata.error) {
    console.warn("Workspace message metadata hydration failed:", metadata.error);
  }
  if (signals.error) {
    console.warn("Workspace message signal hydration failed:", signals.error);
  }
  const metadataById = new Map(
    (metadata.data ?? []).map((item) => [item.id, item] as const),
  );
  const signalsByMessage = new Map<
    string,
    Map<WorkspaceMessage["signals"][number]["signal"], string[]>
  >();
  for (const item of signals.data ?? []) {
    const messageSignals =
      signalsByMessage.get(item.message_id) ??
      new Map<WorkspaceMessage["signals"][number]["signal"], string[]>();
    const signal =
      item.signal as WorkspaceMessage["signals"][number]["signal"];
    messageSignals.set(signal, [
      ...(messageSignals.get(signal) ?? []),
      item.profile_id,
    ]);
    signalsByMessage.set(item.message_id, messageSignals);
  }
  return messages.map((message) => ({
    ...message,
    editedAt: metadataById.get(message.id)?.edited_at ?? message.editedAt,
    deletedAt: metadataById.get(message.id)?.deleted_at ?? message.deletedAt,
    links: links.get(message.id) ?? [],
    signals: [...(signalsByMessage.get(message.id)?.entries() ?? [])].map(
      ([signal, profileIds]) => ({ signal, profileIds }),
    ),
  }));
}

function mapConversationPage(value: unknown): WorkspaceConversationPage {
  const row = isRow(value) ? value : {};
  const conversations = Array.isArray(row.conversations)
    ? (row.conversations as Row[]).map(mapConversation)
    : [];
  const cursor = isRow(row.next_cursor) ? row.next_cursor : undefined;
  return {
    conversations,
    hasMore: row.has_more === true,
    nextCursor: cursor
      ? {
          kindRank: Number(cursor.kind_rank ?? 0),
          sortAt: asString(cursor.sort_at),
          conversationId: asString(cursor.conversation_id),
        }
      : undefined,
  };
}

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapWorkspaceChatEvent(value: unknown): WorkspaceChatEvent | undefined {
  if (!isRow(value)) return undefined;
  const sequence = asString(value.sequence);
  const type = asString(value.type) as WorkspaceChatEvent["type"];
  const eventAt = asString(value.event_at);
  if (!sequence || !type || !eventAt) return undefined;
  return {
    sequence,
    type,
    conversationId: asOptionalString(value.conversation_id),
    messageId: asOptionalString(value.message_id),
    parentMessageId: asOptionalString(value.parent_message_id),
    senderId: asOptionalString(value.sender_id),
    eventAt,
  };
}

export async function requireChatAuthContext(): Promise<ChatAuthContext> {
  const supabase = await createClient();
  if (!supabase) throw new ChatAccessError("Supabase is not configured.");

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) throw new ChatAccessError("Sign in to use P11 Chat.");

  return { supabase, userId: user.id };
}

export async function requireChatContext(): Promise<ChatRequestContext> {
  const { supabase, userId } = await requireChatAuthContext();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,organization_id,email,full_name,title,avatar_url,role,status,chat_enabled",
    )
    .eq("id", userId)
    .eq("status", "active")
    .eq("chat_enabled", true)
    .not("organization_id", "is", null)
    .maybeSingle();

  if (profileError || !profile?.organization_id) {
    throw new ChatAccessError();
  }

  return {
    supabase,
    userId,
    organizationId: String(profile.organization_id),
    currentProfile: mapChatProfile(profile as Row),
  };
}

export async function getChatProfiles(context: ChatRequestContext) {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("id,email,full_name,title,avatar_url,role")
    .eq("organization_id", context.organizationId)
    .eq("status", "active")
    .eq("chat_enabled", true)
    .order("full_name");

  if (error) throw error;
  return ((data ?? []) as Row[]).map(mapChatProfile);
}

export async function requireWorkspaceAdminContext(): Promise<WorkspaceAdminContext> {
  const { supabase, userId } = await requireChatAuthContext();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id,organization_id,email,full_name,title,avatar_url,role,status")
    .eq("id", userId)
    .eq("status", "active")
    .eq("role", "admin")
    .not("organization_id", "is", null)
    .maybeSingle();
  if (error || !profile?.organization_id) {
    throw new ChatAccessError("Workspace administrator access is required.");
  }
  return {
    supabase,
    userId,
    organizationId: String(profile.organization_id),
    currentProfile: mapChatProfile(profile as Row),
  };
}

export async function getWorkspaceAdminProfiles(
  context: WorkspaceAdminContext,
): Promise<WorkspaceAdminProfile[]> {
  const { data, error } = await context.supabase.rpc(
    "get_workspace_admin_profiles",
  );
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as Row[]).map((row) => ({
    id: asString(row.id),
    email: asString(row.email),
    fullName: asString(row.full_name),
    title: asString(row.title),
    role: asString(row.role, "member") as WorkspaceAdminProfile["role"],
    status: asString(
      row.status,
      "deactivated",
    ) as WorkspaceAdminProfile["status"],
    chatEnabled: row.chat_enabled === true,
    permissions: mapWorkspacePermissions(row.permissions),
  }));
}

function mapWorkspacePermissions(value: unknown) {
  const permissions =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Row)
      : {};
  return {
    commercialRead: permissions["commercial.read"] === true,
    commercialWrite: permissions["commercial.write"] === true,
    timeApprove: permissions["time.approve"] === true,
    pipelineWrite: permissions["pipeline.write"] === true,
    supportRead: permissions["support.read"] === true,
    supportWrite: permissions["support.write"] === true,
  };
}

export async function getWorkspaceAdminChannels(
  context: WorkspaceAdminContext,
): Promise<WorkspaceAdminChannel[]> {
  const { data, error } = await context.supabase.rpc(
    "get_workspace_admin_channels",
  );
  if (error) throw error;
  if (!Array.isArray(data)) return [];
  return (data as Row[]).map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    slug: asString(row.slug),
    visibility: asString(
      row.visibility,
      "public",
    ) as WorkspaceAdminChannel["visibility"],
    createdBy: asOptionalString(row.created_by),
    members: (Array.isArray(row.members) ? row.members : []).map((member) => {
      const item = member as Row;
      return {
        profileId: asString(item.profile_id),
        role: asString(
          item.member_role,
          "member",
        ) as WorkspaceConversationMember["role"],
      };
    }),
  }));
}

export async function getConversationSummaries(
  context: ChatAuthContext,
) {
  const page = await getConversationSummariesPage({ context });
  return page.conversations;
}

export async function getConversationSummariesPage({
  context,
  cursor,
  limit = 50,
  conversationId,
}: {
  context: ChatAuthContext;
  cursor?: WorkspaceConversationPageCursor;
  limit?: number;
  conversationId?: string;
}): Promise<WorkspaceConversationPage> {
  const { data, error } = await context.supabase.rpc(
    "get_workspace_conversation_summaries_page",
    {
      after_kind_rank: cursor?.kindRank ?? null,
      after_sort_at: cursor?.sortAt ?? null,
      after_conversation_id: cursor?.conversationId ?? null,
      requested_limit: limit,
      target_conversation_id: conversationId ?? null,
    },
  );
  if (error) throw error;
  return mapConversationPage(data);
}

export async function getWorkspaceConversationMembers({
  context,
  conversationId,
}: {
  context: ChatAuthContext;
  conversationId: string;
}) {
  const { data, error } = await context.supabase.rpc(
    "get_workspace_conversation_members",
    { target_conversation_id: conversationId },
  );
  if (error) throw error;
  return ((data ?? []) as Row[]).map((row) => ({
    profileId: asString(row.profile_id),
    role: asString(
      row.member_role,
      "member",
    ) as WorkspaceConversationMember["role"],
  }));
}

export async function getWorkspaceChatBootstrap({
  context,
  conversationId,
}: {
  context: ChatAuthContext;
  conversationId?: string;
}): Promise<WorkspaceChatBootstrap> {
  const { data, error } = await context.supabase.rpc(
    "get_workspace_chat_bootstrap",
    {
      target_conversation_id: conversationId ?? null,
      requested_summary_limit: 50,
      requested_message_limit: 50,
    },
  );
  if (error) throw error;
  if (!isRow(data) || !isRow(data.viewer)) {
    throw new ChatAccessError();
  }

  const summaryPage = mapConversationPage(data.summary_page);
  const selectedSummary = isRow(data.selected_summary)
    ? mapConversation({
        ...data.selected_summary,
        members: Array.isArray(data.selected_members)
          ? data.selected_members
          : [],
        member_count: Array.isArray(data.selected_members)
          ? data.selected_members.length
          : data.selected_summary.member_count,
        roster_loaded: true,
      })
    : undefined;
  if (
    selectedSummary &&
    !summaryPage.conversations.some(
      (conversation) => conversation.id === selectedSummary.id,
    )
  ) {
    summaryPage.conversations.push(selectedSummary);
  } else if (selectedSummary) {
    summaryPage.conversations = summaryPage.conversations.map((conversation) =>
      conversation.id === selectedSummary.id ? selectedSummary : conversation,
    );
  }

  const rawMessagePage = isRow(data.selected_message_page)
    ? data.selected_message_page
    : {};
  const messageRows = Array.isArray(rawMessagePage.messages)
    ? (rawMessagePage.messages as Row[])
    : [];
  const selectedMessages = await hydrateMessageLinks(
    context.supabase,
    messageRows.map(mapWorkspaceMessage).reverse(),
  );

  return {
    currentProfile: mapChatProfile(data.viewer),
    profiles: Array.isArray(data.profiles)
      ? (data.profiles as Row[]).map(mapChatProfile)
      : [],
    summaryPage,
    selectedConversationId:
      asOptionalString(data.selected_conversation_id),
    selectedMessagePage: {
      messages: selectedMessages,
      hasMore: rawMessagePage.has_more === true,
    },
    cursor: asString(data.cursor, "0"),
  };
}

export async function getWorkspaceChatEventPage({
  context,
  cursor,
  limit = 200,
}: {
  context: ChatAuthContext;
  cursor: string;
  limit?: number;
}): Promise<WorkspaceChatEventPage> {
  const { data, error } = await context.supabase.rpc(
    "get_workspace_chat_events",
    {
      after_sequence: cursor,
      requested_limit: limit,
    },
  );
  if (error) throw error;
  const row = isRow(data) ? data : {};
  return {
    events: Array.isArray(row.events)
      ? row.events
          .map(mapWorkspaceChatEvent)
          .filter((event): event is WorkspaceChatEvent => Boolean(event))
      : [],
    cursor: asString(row.cursor, cursor),
    serverCursor: asString(row.server_cursor, cursor),
    hasMore: row.has_more === true,
    resetRequired: row.reset_required === true,
  };
}

export async function getWorkspaceMessagePage({
  context,
  conversationId,
  threadId,
  beforeCreatedAt,
  beforeMessageId,
  afterCreatedAt,
  afterMessageId,
}: {
  context: ChatAuthContext;
  conversationId: string;
  threadId?: string;
  beforeCreatedAt?: string;
  beforeMessageId?: string;
  afterCreatedAt?: string;
  afterMessageId?: string;
}): Promise<WorkspaceMessagePage> {
  const forward = Boolean(afterCreatedAt && afterMessageId);
  const { data, error } = await context.supabase.rpc(
    forward
      ? "get_workspace_messages_delta_v1"
      : "get_workspace_messages_page_v4",
    {
      target_conversation_id: conversationId,
      target_parent_message_id: threadId ?? null,
      ...(forward
        ? {
            after_created_at: afterCreatedAt ?? null,
            after_message_id: afterMessageId ?? null,
          }
        : {
            before_created_at: beforeCreatedAt ?? null,
            before_message_id: beforeMessageId ?? null,
          }),
      requested_limit: 51,
    },
  );

  if (error) throw error;
  const rows = await hydrateMessageLinks(
    context.supabase,
    ((data ?? []) as Row[]).map(mapWorkspaceMessage),
  );
  const hasMore = rows.length > 50;
  return {
    messages: forward
      ? rows.slice(0, 50)
      : rows.slice(0, 50).reverse(),
    hasMore,
  };
}

export async function getWorkspaceThreadRoot({
  context,
  conversationId,
  rootMessageId,
}: {
  context: ChatAuthContext;
  conversationId: string;
  rootMessageId: string;
}) {
  const { data, error } = await context.supabase
    .from("workspace_messages")
    .select(
      "id,conversation_id,sender_id,body,client_nonce,parent_message_id,created_at,workspace_message_attachments(id,file_name,mime_type,size_bytes)",
    )
    .eq("id", rootMessageId)
    .eq("conversation_id", conversationId)
    .is("parent_message_id", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  return (
    await hydrateMessageLinks(context.supabase, [
      mapWorkspaceMessage(data as Row),
    ])
  )[0];
}

