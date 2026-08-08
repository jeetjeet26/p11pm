import type {
  WorkspaceChatEvent,
  WorkspaceConversation,
  WorkspaceMessage,
  WorkspaceMessagePage,
} from "@/lib/chat/types";

export type WorkspaceMessageCacheEntry = WorkspaceMessagePage & {
  error?: string;
  loadedAt: number;
};

export type WorkspaceMessageCache = Record<
  string,
  WorkspaceMessageCacheEntry
>;

export function evictWorkspaceMessageCache(
  cache: WorkspaceMessageCache,
  conversationId: string,
) {
  const next = { ...cache };
  delete next[conversationId];
  return next;
}

export function reconcileConversationAccess({
  conversations,
  cache,
  selectedConversationId,
}: {
  conversations: WorkspaceConversation[];
  cache: WorkspaceMessageCache;
  selectedConversationId: string;
}) {
  const stillAccessible = conversations.some(
    (conversation) => conversation.id === selectedConversationId,
  );
  return {
    cache: stillAccessible
      ? cache
      : evictWorkspaceMessageCache(cache, selectedConversationId),
    selectedConversationId: stillAccessible
      ? selectedConversationId
      : conversations[0]?.id,
    revokedConversationId: stillAccessible
      ? undefined
      : selectedConversationId,
  };
}

function compareMessages(first: WorkspaceMessage, second: WorkspaceMessage) {
  const timestampOrder = first.createdAt.localeCompare(second.createdAt);
  return timestampOrder || first.id.localeCompare(second.id);
}

export function mergeWorkspaceMessages(
  current: WorkspaceMessage[],
  incoming: WorkspaceMessage[],
) {
  const byIdentity = new Map<string, WorkspaceMessage>();

  for (const message of [...current, ...incoming]) {
    const nonceKey = `${message.senderId}:${message.clientNonce}`;
    const existing =
      byIdentity.get(message.id) ??
      [...byIdentity.values()].find(
        (candidate) =>
          `${candidate.senderId}:${candidate.clientNonce}` === nonceKey,
      );

    if (existing) byIdentity.delete(existing.id);
    byIdentity.set(message.id, message);
  }

  return [...byIdentity.values()].sort(compareMessages);
}

export function mergeRealtimeMessage(
  current: WorkspaceMessage[],
  incoming: WorkspaceMessage,
) {
  const alreadyHydrated = current.some(
    (message) =>
      message.id === incoming.id ||
      (message.senderId === incoming.senderId &&
        message.clientNonce === incoming.clientNonce),
  );
  return alreadyHydrated
    ? current
    : mergeWorkspaceMessages(current, [incoming]);
}

export function storeWorkspaceMessagePage({
  cache,
  conversationId,
  page,
  merge,
  loadedAt = Date.now(),
}: {
  cache: WorkspaceMessageCache;
  conversationId: string;
  page: WorkspaceMessagePage;
  merge: boolean;
  loadedAt?: number;
}): WorkspaceMessageCache {
  const current = cache[conversationId];
  return {
    ...cache,
    [conversationId]: {
      messages: merge
        ? mergeWorkspaceMessages(current?.messages ?? [], page.messages)
        : page.messages,
      hasMore: merge
        ? (current?.hasMore ?? false) || page.hasMore
        : page.hasMore,
      loadedAt,
    },
  };
}

export function clearConversationUnread(
  conversations: WorkspaceConversation[],
  conversationId: string,
) {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? { ...conversation, unreadCount: 0 }
      : conversation,
  );
}

export function applyMessageToConversations({
  conversations,
  message,
  currentProfileId,
  selectedConversationId,
  incrementUnread,
}: {
  conversations: WorkspaceConversation[];
  message: WorkspaceMessage;
  currentProfileId: string;
  selectedConversationId: string;
  incrementUnread: boolean;
}) {
  return conversations.map((conversation) => {
    if (conversation.id !== message.conversationId) return conversation;
    const isOlderThanCurrent =
      conversation.lastMessageAt &&
      (message.createdAt < conversation.lastMessageAt ||
        (message.createdAt === conversation.lastMessageAt &&
          conversation.lastMessageId &&
          message.id < conversation.lastMessageId));
    if (isOlderThanCurrent) return conversation;
    const shouldIncrement =
      incrementUnread &&
      message.senderId !== currentProfileId &&
      message.conversationId !== selectedConversationId &&
      conversation.lastMessageId !== message.id;

    return {
      ...conversation,
      lastMessageId: message.id,
      lastMessageBody: message.body,
      lastMessageSenderId: message.senderId,
      lastMessageAt: message.createdAt,
      unreadCount: conversation.unreadCount + (shouldIncrement ? 1 : 0),
    };
  });
}

export interface WorkspaceChatEventSnapshot {
  conversations: WorkspaceConversation[];
  cache: WorkspaceMessageCache;
  selectedConversationId?: string;
  currentProfileId: string;
  visibleThreadRootMessageId?: string;
  knownMessageIds?: ReadonlySet<string>;
}

export interface WorkspaceChatEventResult {
  conversations: WorkspaceConversation[];
  cache: WorkspaceMessageCache;
  selectedConversationId?: string;
  revokedConversationIds: string[];
  hydrateConversationIds: string[];
  hydrateThreadRootIds: string[];
  refreshConversationIds: string[];
  refreshAllConversations: boolean;
  workspaceRevoked: boolean;
}

export function applyWorkspaceChatEvents(
  snapshot: WorkspaceChatEventSnapshot,
  events: WorkspaceChatEvent[],
): WorkspaceChatEventResult {
  let conversations = snapshot.conversations;
  let cache = snapshot.cache;
  let selectedConversationId = snapshot.selectedConversationId;
  const revokedConversationIds = new Set<string>();
  const hydrateConversationIds = new Set<string>();
  const hydrateThreadRootIds = new Set<string>();
  const refreshConversationIds = new Set<string>();
  let refreshAllConversations = false;
  let workspaceRevoked = false;

  for (const event of events) {
    if (event.type === "workspace.revoked") {
      revokedConversationIds.clear();
      for (const conversation of conversations) {
        revokedConversationIds.add(conversation.id);
      }
      conversations = [];
      cache = {};
      selectedConversationId = undefined;
      workspaceRevoked = true;
      continue;
    }

    if (event.type === "workspace.reset") {
      cache = {};
      refreshAllConversations = true;
      continue;
    }

    const conversationId = event.conversationId;
    if (!conversationId) continue;

    if (event.type === "conversation.revoked") {
      conversations = conversations.filter(
        (conversation) => conversation.id !== conversationId,
      );
      cache = evictWorkspaceMessageCache(cache, conversationId);
      revokedConversationIds.add(conversationId);
      if (selectedConversationId === conversationId) {
        selectedConversationId = conversations[0]?.id;
      }
      continue;
    }

    if (event.type === "conversation.upsert") {
      refreshConversationIds.add(conversationId);
      continue;
    }

    if (event.type === "conversation.read") {
      conversations = clearConversationUnread(conversations, conversationId);
      continue;
    }

    if (event.type === "thread.read" && event.messageId) {
      const entry = cache[conversationId];
      if (entry) {
        cache = {
          ...cache,
          [conversationId]: {
            ...entry,
            messages: entry.messages.map((message) =>
              message.id === event.messageId
                ? { ...message, threadUnreadCount: 0 }
                : message,
            ),
          },
        };
      }
      continue;
    }

    if (
      event.type !== "message.created" ||
      !event.messageId ||
      !event.senderId
    ) {
      continue;
    }

    if (event.parentMessageId) {
      const alreadyKnown =
        snapshot.knownMessageIds?.has(event.messageId) ?? false;
      const entry = cache[conversationId];
      if (entry && !alreadyKnown) {
        cache = {
          ...cache,
          [conversationId]: {
            ...entry,
            messages: entry.messages.map((message) => {
              if (message.id !== event.parentMessageId) return message;
              const visibleThread =
                selectedConversationId === conversationId &&
                snapshot.visibleThreadRootMessageId === event.parentMessageId;
              const shouldIncrementUnread =
                event.senderId !== snapshot.currentProfileId && !visibleThread;
              return {
                ...message,
                replyCount: message.replyCount + 1,
                lastReplyAt: event.eventAt,
                threadUnreadCount:
                  message.threadUnreadCount +
                  (shouldIncrementUnread ? 1 : 0),
              };
            }),
          },
        };
      }
      if (
        selectedConversationId === conversationId &&
        snapshot.visibleThreadRootMessageId === event.parentMessageId &&
        !alreadyKnown
      ) {
        hydrateThreadRootIds.add(event.parentMessageId);
      }
      continue;
    }

    conversations = conversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const shouldIncrement =
        event.senderId !== snapshot.currentProfileId &&
        conversationId !== selectedConversationId &&
        conversation.lastMessageId !== event.messageId;
      return {
        ...conversation,
        lastMessageId: event.messageId,
        lastMessageSenderId: event.senderId,
        lastMessageAt: event.eventAt,
        unreadCount:
          conversation.unreadCount + (shouldIncrement ? 1 : 0),
      };
    });

    const entry = cache[conversationId];
    const alreadyHydrated =
      entry?.messages.some((message) => message.id === event.messageId) ??
      false;
    if (
      selectedConversationId === conversationId &&
      entry &&
      !alreadyHydrated
    ) {
      hydrateConversationIds.add(conversationId);
    }
  }

  return {
    conversations,
    cache,
    selectedConversationId,
    revokedConversationIds: [...revokedConversationIds],
    hydrateConversationIds: [...hydrateConversationIds],
    hydrateThreadRootIds: [...hydrateThreadRootIds],
    refreshConversationIds: [...refreshConversationIds],
    refreshAllConversations,
    workspaceRevoked,
  };
}
