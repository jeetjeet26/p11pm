import { describe, expect, it, vi } from "vitest";

import {
  applyMessageToConversations,
  applyWorkspaceChatEvents,
  clearConversationUnread,
  reconcileConversationAccess,
  mergeRealtimeMessage,
  mergeWorkspaceMessages,
  storeWorkspaceMessagePage,
} from "@/lib/chat/reconcile";
import type {
  WorkspaceChatEvent,
  WorkspaceConversation,
  WorkspaceMessage,
} from "@/lib/chat/types";
import {
  WorkspaceChatSyncController,
  workspaceChatSyncReducer,
} from "@/lib/chat/sync";
import {
  canonicalDmPair,
  canonicalGroupDmName,
  canShowWorkspaceAdmin,
  channelSlug,
  createConversationSchema,
  createMessageSchema,
  normalizeMemberIds,
} from "@/lib/chat/validation";

const conversation: WorkspaceConversation = {
  id: "conversation",
  organizationId: "organization",
  kind: "channel",
  visibility: "public",
  name: "general",
  slug: "general",
  members: [],
  memberCount: 0,
  rosterLoaded: false,
  canManage: false,
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
  unreadCount: 0,
};

function message(
  overrides: Partial<WorkspaceMessage> = {},
): WorkspaceMessage {
  return {
    id: "message-1",
    conversationId: "conversation",
    senderId: "person-a",
    body: "Hello",
    clientNonce: "nonce-1",
    createdAt: "2026-08-07T10:00:00.000Z",
    replyCount: 0,
    threadUnreadCount: 0,
    attachments: [],
    ...overrides,
  };
}

function syncEvent(
  sequence: number,
  overrides: Partial<WorkspaceChatEvent> = {},
): WorkspaceChatEvent {
  return {
    sequence: String(sequence),
    type: "message.created",
    conversationId: conversation.id,
    messageId: `message-${sequence}`,
    senderId: "person-b",
    eventAt: `2026-08-07T10:0${sequence}:00.000Z`,
    ...overrides,
  };
}

describe("workspace chat helpers", () => {
  it("creates stable Slack-style channel slugs", () => {
    expect(channelSlug("  Créative Review & QA  ")).toBe(
      "creative-review-qa",
    );
  });

  it("canonicalizes a direct-message pair", () => {
    expect(canonicalDmPair("person-z", "person-a")).toEqual([
      "person-a",
      "person-z",
    ]);
  });

  it("normalizes exact group rosters independent of selection order", () => {
    expect(
      normalizeMemberIds(["person-c", "person-a", "person-c"], "person-b"),
    ).toEqual(["person-a", "person-b", "person-c"]);
  });

  it("builds deterministic group-DM names without the current person", () => {
    expect(
      canonicalGroupDmName(
        "person-a",
        ["person-c", "person-a", "person-b"],
        {
          "person-a": "Aaron",
          "person-b": "Zoe",
          "person-c": "Bea",
        },
      ),
    ).toBe("Bea, Zoe");
  });

  it("validates channel visibility and multi-member DM input", () => {
    expect(
      createConversationSchema.safeParse({
        kind: "channel",
        name: "Private review",
        visibility: "private",
        memberIds: [crypto.randomUUID()],
      }).success,
    ).toBe(true);
    expect(
      createConversationSchema.safeParse({
        kind: "dm",
        profileIds: [],
      }).success,
    ).toBe(false);
  });

  it("deduplicates API and realtime copies by client nonce", () => {
    const apiMessage = message();
    const realtimeMessage = message({ id: "database-message" });
    expect(mergeWorkspaceMessages([apiMessage], [realtimeMessage])).toEqual([
      realtimeMessage,
    ]);
  });

  it("orders equal-timestamp messages by database ID", () => {
    const laterId = message({ id: "message-b", clientNonce: "nonce-b" });
    const earlierId = message({ id: "message-a", clientNonce: "nonce-a" });
    expect(mergeWorkspaceMessages([laterId], [earlierId]).map(({ id }) => id)).toEqual([
      "message-a",
      "message-b",
    ]);
  });

  it("keeps rapid-switch responses scoped to their conversation", () => {
    const first = storeWorkspaceMessagePage({
      cache: {},
      conversationId: "conversation-b",
      page: {
        messages: [
          message({
            id: "message-b",
            conversationId: "conversation-b",
          }),
        ],
        hasMore: false,
      },
      merge: false,
      loadedAt: 1,
    });
    const withLateResponse = storeWorkspaceMessagePage({
      cache: first,
      conversationId: "conversation-a",
      page: {
        messages: [
          message({
            id: "message-a",
            conversationId: "conversation-a",
          }),
        ],
        hasMore: true,
      },
      merge: false,
      loadedAt: 2,
    });

    expect(withLateResponse["conversation-b"].messages[0].id).toBe(
      "message-b",
    );
    expect(withLateResponse["conversation-a"].hasMore).toBe(true);
  });

  it("merges reconnect catch-up gaps into an existing cache page", () => {
    const cached = storeWorkspaceMessagePage({
      cache: {},
      conversationId: "conversation",
      page: { messages: [message()], hasMore: true },
      merge: false,
      loadedAt: 1,
    });
    const caughtUp = storeWorkspaceMessagePage({
      cache: cached,
      conversationId: "conversation",
      page: {
        messages: [
          message({
            id: "message-2",
            clientNonce: "nonce-2",
            createdAt: "2026-08-07T10:01:00.000Z",
          }),
        ],
        hasMore: false,
      },
      merge: true,
      loadedAt: 2,
    });

    expect(
      caughtUp.conversation.messages.map((item) => item.id),
    ).toEqual(["message-1", "message-2"]);
    expect(caughtUp.conversation.hasMore).toBe(true);
  });

  it("does not let a realtime placeholder erase thread or attachment data", () => {
    const hydrated = message({
      replyCount: 2,
      threadUnreadCount: 1,
      attachments: [
        {
          id: "attachment",
          fileName: "review.pdf",
          mimeType: "application/pdf",
          sizeBytes: 512,
        },
      ],
    });
    const placeholder = message({
      id: "realtime-id",
      replyCount: 0,
      threadUnreadCount: 0,
      attachments: [],
    });

    expect(mergeRealtimeMessage([hydrated], placeholder)).toEqual([
      hydrated,
    ]);
  });

  it("clears only the selected conversation unread count", () => {
    const other = {
      ...conversation,
      id: "other-conversation",
      unreadCount: 4,
    };
    const cleared = clearConversationUnread(
      [{ ...conversation, unreadCount: 3 }, other],
      conversation.id,
    );

    expect(cleared.map((item) => item.unreadCount)).toEqual([0, 4]);
  });

  it("increments unread only for a different, unselected conversation", () => {
    const updated = applyMessageToConversations({
      conversations: [conversation],
      message: message({ senderId: "person-b" }),
      currentProfileId: "person-a",
      selectedConversationId: "another-conversation",
      incrementUnread: true,
    });
    expect(updated[0].unreadCount).toBe(1);
    expect(updated[0].lastMessageBody).toBe("Hello");
  });

  it("evicts revoked conversation data and selects a safe fallback", () => {
    const revoked = {
      ...conversation,
      id: "private-conversation",
      visibility: "private" as const,
      members: [{ profileId: "person-a", role: "member" as const }],
    };
    const cache = {
      [conversation.id]: {
        messages: [message()],
        hasMore: false,
        loadedAt: 1,
      },
      [revoked.id]: {
        messages: [
          message({
            id: "private-message",
            conversationId: revoked.id,
          }),
        ],
        hasMore: false,
        loadedAt: 2,
      },
    };

    const reconciled = reconcileConversationAccess({
      conversations: [conversation],
      cache,
      selectedConversationId: revoked.id,
    });
    expect(reconciled.selectedConversationId).toBe(conversation.id);
    expect(reconciled.revokedConversationId).toBe(revoked.id);
    expect(reconciled.cache[revoked.id]).toBeUndefined();
    expect(reconciled.cache[conversation.id]).toBeDefined();
  });

  it("deduplicates sync events and fills a detected gap in order", () => {
    const gap = workspaceChatSyncReducer(
      { cursor: "1", buffered: [] },
      { type: "broadcast", event: syncEvent(3) },
    );
    expect(gap.applied).toEqual([]);
    expect(gap.needsCatchUp).toBe(true);

    const caughtUp = workspaceChatSyncReducer(gap.state, {
      type: "catch-up",
      events: [syncEvent(2), syncEvent(3), syncEvent(3)],
      hasMore: false,
      resetRequired: false,
    });
    expect(caughtUp.applied.map((event) => event.sequence)).toEqual([
      "2",
      "3",
    ]);
    expect(caughtUp.state.cursor).toBe("3");
    expect(caughtUp.state.buffered).toEqual([]);

    const duplicate = workspaceChatSyncReducer(caughtUp.state, {
      type: "broadcast",
      event: syncEvent(3),
    });
    expect(duplicate.applied).toEqual([]);
    expect(duplicate.state.cursor).toBe("3");
  });

  it("always requests durable catch-up after reconnect", () => {
    const result = workspaceChatSyncReducer(
      { cursor: "8", buffered: [] },
      { type: "reconnect" },
    );
    expect(result.needsCatchUp).toBe(true);
    expect(result.applied).toEqual([]);
    expect(result.state.cursor).toBe("8");
  });

  it("retries an empty catch-up page before resetting a buffered gap", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        events: [],
        cursor: "1",
        serverCursor: "3",
        hasMore: false,
        resetRequired: false,
      })
      .mockResolvedValueOnce({
        events: [syncEvent(2), syncEvent(3)],
        cursor: "3",
        serverCursor: "3",
        hasMore: false,
        resetRequired: false,
      });
    const onEvents = vi.fn();
    const onReset = vi.fn();
    const controller = new WorkspaceChatSyncController(
      "1",
      fetchPage,
      onEvents,
      onReset,
      vi.fn(),
    );

    controller.acceptBroadcast(syncEvent(3));

    await vi.waitFor(() => {
      expect(onEvents).toHaveBeenCalledWith([syncEvent(2), syncEvent(3)]);
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(controller.cursor).toBe("3");
    expect(onReset).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("resets bootstrap state when retention prunes the durable cursor", async () => {
    const onEvents = vi.fn();
    const onReset = vi.fn();
    const controller = new WorkspaceChatSyncController(
      "4",
      vi.fn().mockResolvedValue({
        events: [syncEvent(6)],
        cursor: "6",
        serverCursor: "6",
        hasMore: false,
        resetRequired: true,
      }),
      onEvents,
      onReset,
      vi.fn(),
    );

    controller.reconnect();

    await vi.waitFor(() => {
      expect(onReset).toHaveBeenCalledOnce();
    });
    expect(onEvents).not.toHaveBeenCalled();
    expect(controller.cursor).toBe("4");
    controller.dispose();
  });

  it("updates a background summary without hydrating its messages", () => {
    const background = {
      ...conversation,
      id: "background",
      lastMessageBody: "Previous body",
    };
    const result = applyWorkspaceChatEvents(
      {
        conversations: [conversation, background],
        cache: {
          background: {
            messages: [
              message({
                id: "old-background",
                conversationId: "background",
              }),
            ],
            hasMore: false,
            loadedAt: 1,
          },
        },
        selectedConversationId: conversation.id,
        currentProfileId: "person-a",
      },
      [
        syncEvent(1, {
          conversationId: background.id,
          messageId: "new-background",
        }),
      ],
    );

    expect(result.hydrateConversationIds).toEqual([]);
    expect(result.cache.background.messages).toHaveLength(1);
    expect(
      result.conversations.find((item) => item.id === background.id),
    ).toMatchObject({
      lastMessageId: "new-background",
      lastMessageBody: "Previous body",
      unreadCount: 1,
    });
  });

  it("immediately evicts revoked private channels and group DMs", () => {
    const privateChannel = {
      ...conversation,
      id: "private-channel",
      visibility: "private" as const,
    };
    const groupDm = {
      ...conversation,
      id: "group-dm",
      kind: "dm" as const,
      visibility: "private" as const,
      dmMemberKey: "person-a,person-b,person-c",
      memberCount: 3,
    };
    const result = applyWorkspaceChatEvents(
      {
        conversations: [privateChannel, groupDm, conversation],
        cache: {
          [privateChannel.id]: {
            messages: [
              message({ conversationId: privateChannel.id }),
            ],
            hasMore: false,
            loadedAt: 1,
          },
          [groupDm.id]: {
            messages: [message({ conversationId: groupDm.id })],
            hasMore: false,
            loadedAt: 1,
          },
        },
        selectedConversationId: privateChannel.id,
        currentProfileId: "person-a",
      },
      [
        syncEvent(1, {
          type: "conversation.revoked",
          conversationId: privateChannel.id,
          messageId: undefined,
          senderId: undefined,
        }),
        syncEvent(2, {
          type: "conversation.revoked",
          conversationId: groupDm.id,
          messageId: undefined,
          senderId: undefined,
        }),
      ],
    );

    expect(result.revokedConversationIds).toEqual([
      privateChannel.id,
      groupDm.id,
    ]);
    expect(result.cache[privateChannel.id]).toBeUndefined();
    expect(result.cache[groupDm.id]).toBeUndefined();
    expect(result.selectedConversationId).toBe(conversation.id);
  });

  it("shows workspace administration only to active admins", () => {
    expect(canShowWorkspaceAdmin("admin", "active")).toBe(true);
    expect(canShowWorkspaceAdmin("admin", "suspended")).toBe(false);
    expect(canShowWorkspaceAdmin("member", "active")).toBe(false);
  });

  it("rejects oversized messages before they reach the database", () => {
    expect(
      createMessageSchema.safeParse({
        conversationId: crypto.randomUUID(),
        body: "x".repeat(4001),
        clientNonce: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
