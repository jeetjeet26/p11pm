"use client";

import {
  Check,
  Hash,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AttachmentPicker } from "@/components/chat/attachment-picker";
import { MessageItem } from "@/components/chat/message-item";
import { ThreadPanel } from "@/components/chat/thread-panel";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  removePendingChatAttachments,
  uploadChatAttachments,
} from "@/lib/chat/attachments";
import {
  applyMessageToConversations,
  applyWorkspaceChatEvents,
  clearConversationUnread,
  mergeWorkspaceMessages,
  storeWorkspaceMessagePage,
} from "@/lib/chat/reconcile";
import type {
  WorkspaceMessageCache,
} from "@/lib/chat/reconcile";
import type {
  ChatProfile,
  ChatShellBootstrap,
  WorkspaceChatBootstrap,
  WorkspaceChatEvent,
  WorkspaceChatEventPage,
  WorkspaceConversation,
  WorkspaceConversationMember,
  WorkspaceConversationPageCursor,
  WorkspaceMessage,
  WorkspaceMessagePage,
} from "@/lib/chat/types";
import {
  authenticateWorkspaceRealtime,
  keepWorkspaceRealtimeAuthenticated,
  parseWorkspaceChatBroadcast,
  WorkspaceChatSyncController,
} from "@/lib/chat/sync";
import { canonicalGroupDmName } from "@/lib/chat/validation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ConversationResponse = {
  conversation?: WorkspaceConversation;
  conversations?: WorkspaceConversation[];
  hasMore?: boolean;
  nextCursor?: WorkspaceConversationPageCursor;
  members?: WorkspaceConversationMember[];
  error?: string;
};

type MessageResponse = {
  message?: WorkspaceMessage;
  error?: string;
};

async function requestMessagePage(
  conversationId: string,
  cursor?:
    | { beforeCreatedAt: string; beforeMessageId: string }
    | { afterCreatedAt: string; afterMessageId: string },
  threadId?: string,
) {
  const query = new URLSearchParams({ conversationId });
  if (threadId) query.set("threadId", threadId);
  if (cursor && "beforeCreatedAt" in cursor) {
    query.set("beforeCreatedAt", cursor.beforeCreatedAt);
    query.set("beforeMessageId", cursor.beforeMessageId);
  } else if (cursor) {
    query.set("afterCreatedAt", cursor.afterCreatedAt);
    query.set("afterMessageId", cursor.afterMessageId);
  }
  const response = await fetch(
    `/api/workspace-chat/messages?${query.toString()}`,
    { cache: "no-store" },
  );
  const result = (await response.json()) as WorkspaceMessagePage & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? "Could not load conversation messages.");
  }
  return result;
}

async function requestChatBootstrap(conversationId?: string) {
  const query = new URLSearchParams();
  if (conversationId) query.set("conversationId", conversationId);
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`/api/workspace-chat/bootstrap${suffix}`, {
    cache: "no-store",
  });
  const result = (await response.json()) as WorkspaceChatBootstrap & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? "Could not start P11 Chat.");
  }
  return result;
}

async function requestChatEventPage(
  cursor: string,
  signal: AbortSignal,
) {
  const response = await fetch(
    `/api/workspace-chat/sync?cursor=${encodeURIComponent(cursor)}`,
    { cache: "no-store", signal },
  );
  const result = (await response.json()) as WorkspaceChatEventPage & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? "Could not synchronize P11 Chat.");
  }
  return result;
}

async function requestConversationPage({
  cursor,
  conversationId,
}: {
  cursor?: WorkspaceConversationPageCursor;
  conversationId?: string;
} = {}) {
  const query = new URLSearchParams();
  if (conversationId) query.set("conversationId", conversationId);
  if (cursor) {
    query.set("afterKindRank", String(cursor.kindRank));
    query.set("afterSortAt", cursor.sortAt);
    query.set("afterConversationId", cursor.conversationId);
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`/api/workspace-chat/conversations${suffix}`, {
    cache: "no-store",
  });
  const result = (await response.json()) as ConversationResponse;
  if (!response.ok || !result.conversations) {
    throw new Error(result.error ?? "Could not load conversations.");
  }
  return {
    conversations: result.conversations,
    hasMore: result.hasMore ?? false,
    nextCursor: result.nextCursor,
  };
}

function mergeConversations(
  current: WorkspaceConversation[],
  incoming: WorkspaceConversation[],
) {
  const byId = new Map(
    current.map((conversation) => [conversation.id, conversation] as const),
  );
  for (const conversation of incoming) {
    const existing = byId.get(conversation.id);
    byId.set(
      conversation.id,
      existing?.rosterLoaded && !conversation.rosterLoaded
        ? {
            ...conversation,
            members: existing.members,
            memberCount: existing.memberCount,
            rosterLoaded: true,
          }
        : conversation,
    );
  }
  return [...byId.values()];
}

function conversationMemberIds(conversation: WorkspaceConversation) {
  if (conversation.kind === "dm" && conversation.dmMemberKey) {
    return conversation.dmMemberKey.split(",").filter(Boolean);
  }
  return conversation.members.map((member) => member.profileId);
}

function counterpart(
  conversation: WorkspaceConversation,
  currentProfileId: string,
  profiles: ChatProfile[],
) {
  if (conversation.kind !== "dm") return undefined;
  const memberIds = conversationMemberIds(conversation);
  const otherIds = memberIds.filter((profileId) => profileId !== currentProfileId);
  if (otherIds.length > 1) return undefined;
  const otherId =
    otherIds[0] ??
    (conversation.dmProfileA === currentProfileId
      ? conversation.dmProfileB
      : conversation.dmProfileA);
  return profiles.find((profile) => profile.id === otherId);
}

function conversationName(
  conversation: WorkspaceConversation,
  currentProfileId: string,
  profiles: ChatProfile[],
) {
  if (conversation.kind === "channel") {
    return conversation.name ?? conversation.slug ?? "channel";
  }
  const projectedMemberIds = conversationMemberIds(conversation);
  const memberIds = projectedMemberIds.length
    ? projectedMemberIds
    : [conversation.dmProfileA, conversation.dmProfileB].filter(
        (profileId): profileId is string => Boolean(profileId),
      );
  const names = Object.fromEntries(
    profiles.map((profile) => [profile.id, profile.fullName]),
  );
  return (
    canonicalGroupDmName(currentProfileId, memberIds, names) ||
    counterpart(conversation, currentProfileId, profiles)?.fullName ||
    "Direct message"
  );
}

export function ChatWorkspace({
  initialData,
}: {
  initialData: ChatShellBootstrap;
}) {
  const params = useParams<{ conversationId?: string[] }>();
  const searchParams = useSearchParams();
  const requestedConversationId =
    params.conversationId?.length === 1
      ? params.conversationId[0]
      : undefined;
  const initialConversationId =
    initialData.conversations.find(
      (conversation) => conversation.id === requestedConversationId,
    )?.id ?? initialData.conversations[0].id;
  const [profiles, setProfiles] = useState(initialData.profiles);
  const [selectedConversationId, setSelectedConversationId] = useState(
    initialConversationId,
  );
  const [threadRootMessageId, setThreadRootMessageId] = useState<
    string | undefined
  >(() => searchParams.get("thread") ?? undefined);
  const [conversations, setConversations] = useState(() =>
    clearConversationUnread(
      initialData.conversations,
      initialConversationId,
    ),
  );
  const [conversationCursor, setConversationCursor] =
    useState<WorkspaceConversationPageCursor>();
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [loadingMoreConversations, setLoadingMoreConversations] =
    useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const [messageCache, setMessageCache] = useState<
    WorkspaceMessageCache
  >({});
  const [threadSyncEvent, setThreadSyncEvent] =
    useState<WorkspaceChatEvent>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachmentDrafts, setAttachmentDrafts] = useState<
    Record<string, File[]>
  >({});
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [dmDialogOpen, setDmDialogOpen] = useState(false);
  const [memberSheetOpen, setMemberSheetOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelVisibility, setChannelVisibility] = useState<
    "public" | "private"
  >("public");
  const [channelMemberIds, setChannelMemberIds] = useState<string[]>([]);
  const [dmMemberIds, setDmMemberIds] = useState<string[]>([]);
  const [managedMemberIds, setManagedMemberIds] = useState<string[]>([]);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [updatingMembers, setUpdatingMembers] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const messageCacheRef = useRef<WorkspaceMessageCache>({});
  const conversationsRef = useRef(conversations);
  const pendingMessageRequests = useRef(
    new Map<string, Promise<WorkspaceMessagePage>>(),
  );
  const pendingForwardRequests = useRef(
    new Map<string, Promise<WorkspaceMessagePage>>(),
  );
  const queuedForwardRefreshes = useRef(new Set<string>());
  const pendingRosterRequests = useRef(
    new Map<string, Promise<WorkspaceConversationMember[]>>(),
  );
  const pendingReadIds = useRef(new Set<string>());
  const readTimers = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const selectedConversationIdRef = useRef(initialConversationId);
  const threadRootMessageIdRef = useRef(threadRootMessageId);
  const scrollPositions = useRef(new Map<string, number>());
  const shouldScrollToBottom = useRef(true);
  const seenThreadReplyIds = useRef(new Set<string>());
  const bootstrapRequestId = useRef(0);
  const currentProfileId = initialData.currentProfile.id;
  const selectedMessagePage = messageCache[selectedConversationId];
  const messages = useMemo(
    () => selectedMessagePage?.messages ?? [],
    [selectedMessagePage],
  );
  const hasMoreMessages = selectedMessagePage?.hasMore ?? false;
  const messageBody = drafts[selectedConversationId] ?? "";
  const attachmentFiles = attachmentDrafts[selectedConversationId] ?? [];

  const updateMessageCache = useCallback(
    (
      update: (
        current: WorkspaceMessageCache,
      ) => WorkspaceMessageCache,
    ) => {
      setMessageCache((current) => {
        const next = update(current);
        messageCacheRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateConversations = useCallback(
    (
      update: (
        current: WorkspaceConversation[],
      ) => WorkspaceConversation[],
    ) => {
      setConversations((current) => {
        const next = update(current);
        conversationsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateConversationMessages = useCallback(
    (
      conversationId: string,
      update: (messages: WorkspaceMessage[]) => WorkspaceMessage[],
      hasMore?: boolean,
    ) => {
      updateMessageCache((current) => {
        const entry = current[conversationId];
        return {
          ...current,
          [conversationId]: {
            messages: update(entry?.messages ?? []),
            hasMore: hasMore ?? entry?.hasMore ?? false,
            loadedAt: Date.now(),
          },
        };
      });
    },
    [updateMessageCache],
  );

  const applyHydratedConversationPreview = useCallback(
    (conversationId: string, page: WorkspaceMessagePage) => {
      const latestMessage = page.messages.at(-1);
      if (!latestMessage) return;
      updateConversations((current) =>
        applyMessageToConversations({
          conversations: current,
          message: latestMessage,
          currentProfileId,
          selectedConversationId: selectedConversationIdRef.current,
          incrementUnread: false,
        }),
      );
    },
    [currentProfileId, updateConversations],
  );

  const loadConversation = useCallback(
    (conversationId: string, force = false) => {
      const cached = messageCacheRef.current[conversationId];
      if (!force && cached && !cached.error) {
        return Promise.resolve({
          messages: cached.messages,
          hasMore: cached.hasMore,
        });
      }
      const pending = pendingMessageRequests.current.get(conversationId);
      if (pending) return pending;

      const request = requestMessagePage(conversationId)
        .then((result) => {
          updateMessageCache((current) =>
            storeWorkspaceMessagePage({
              cache: current,
              conversationId,
              page: result,
              merge: force,
            }),
          );
          applyHydratedConversationPreview(conversationId, result);
          if (selectedConversationIdRef.current === conversationId) {
            setError("");
          }
          return result;
        })
        .catch((requestError: unknown) => {
          const message =
            requestError instanceof Error
              ? requestError.message
              : "Could not load conversation messages.";
          updateMessageCache((current) => ({
            ...current,
            [conversationId]: {
              messages: current[conversationId]?.messages ?? [],
              hasMore: current[conversationId]?.hasMore ?? false,
              loadedAt: Date.now(),
              error: message,
            },
          }));
          if (selectedConversationIdRef.current === conversationId) {
            setError(message);
          }
          return {
            messages: messageCacheRef.current[conversationId]?.messages ?? [],
            hasMore: messageCacheRef.current[conversationId]?.hasMore ?? false,
          };
        })
        .finally(() => {
          pendingMessageRequests.current.delete(conversationId);
        });
      pendingMessageRequests.current.set(conversationId, request);
      return request;
    },
    [applyHydratedConversationPreview, updateMessageCache],
  );

  const refreshForwardMessages = useCallback(
    function refreshForwardMessages(
      conversationId: string,
    ): Promise<WorkspaceMessagePage> {
      const pending = pendingForwardRequests.current.get(conversationId);
      if (pending) {
        queuedForwardRefreshes.current.add(conversationId);
        return pending;
      }
      queuedForwardRefreshes.current.delete(conversationId);

      const request = (async () => {
        let latestPage: WorkspaceMessagePage = {
          messages: [],
          hasMore: false,
        };
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const entry = messageCacheRef.current[conversationId];
          const latest = entry?.messages.at(-1);
          if (!entry || !latest) return loadConversation(conversationId, true);

          latestPage = await requestMessagePage(conversationId, {
            afterCreatedAt: latest.createdAt,
            afterMessageId: latest.id,
          });
          updateMessageCache((current) => {
            const currentPage = current[conversationId];
            return {
              ...current,
              [conversationId]: {
                messages: mergeWorkspaceMessages(
                  currentPage?.messages ?? [],
                  latestPage.messages,
                ),
                hasMore: currentPage?.hasMore ?? false,
                loadedAt: Date.now(),
              },
            };
          });
          applyHydratedConversationPreview(conversationId, latestPage);
          if (!latestPage.hasMore) return latestPage;
        }
        throw new Error("Message catch-up exceeded its safety limit.");
      })()
        .catch((requestError: unknown) => {
          if (selectedConversationIdRef.current === conversationId) {
            setError(
              requestError instanceof Error
                ? requestError.message
                : "Could not catch up conversation messages.",
            );
          }
          return {
            messages: [],
            hasMore: false,
          };
        })
        .finally(() => {
          pendingForwardRequests.current.delete(conversationId);
          if (queuedForwardRefreshes.current.delete(conversationId)) {
            void refreshForwardMessages(conversationId);
          }
        });

      pendingForwardRequests.current.set(conversationId, request);
      return request;
    },
    [applyHydratedConversationPreview, loadConversation, updateMessageCache],
  );

  const setMessageBody = useCallback(
    (body: string) => {
      setDrafts((current) => ({
        ...current,
        [selectedConversationId]: body,
      }));
    },
    [selectedConversationId],
  );

  const setAttachmentFiles = useCallback(
    (files: File[]) => {
      setAttachmentDrafts((current) => ({
        ...current,
        [selectedConversationId]: files,
      }));
    },
    [selectedConversationId],
  );

  const flushRead = useCallback(async (conversationId: string) => {
    const response = await fetch("/api/workspace-chat/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    if (!response.ok) return;
    updateConversations((current) =>
      clearConversationUnread(current, conversationId),
    );
  }, [updateConversations]);

  const scheduleRead = useCallback(
    (conversationId: string, needed: boolean) => {
      if (!needed) return;
      pendingReadIds.current.add(conversationId);
      const existing = readTimers.current.get(conversationId);
      if (existing) clearTimeout(existing);
      if (document.visibilityState !== "visible") return;
      readTimers.current.set(
        conversationId,
        setTimeout(() => {
          readTimers.current.delete(conversationId);
          pendingReadIds.current.delete(conversationId);
          void flushRead(conversationId);
        }, 250),
      );
    },
    [flushRead],
  );

  const selectConversation = useCallback(
    (conversationId: string, replace = false) => {
      const viewport = messageViewportRef.current;
      if (viewport) {
        scrollPositions.current.set(
          selectedConversationIdRef.current,
          viewport.scrollTop,
        );
      }
      selectedConversationIdRef.current = conversationId;
      shouldScrollToBottom.current =
        !messageCacheRef.current[conversationId];
      setSelectedConversationId(conversationId);
      setThreadRootMessageId(undefined);
      const unreadCount =
        conversations.find(
          (conversation) => conversation.id === conversationId,
        )?.unreadCount ?? 0;
      updateConversations((current) =>
        clearConversationUnread(current, conversationId),
      );
      const method = replace ? "replaceState" : "pushState";
      window.history[method](null, "", `/chat/${conversationId}`);
      scheduleRead(conversationId, unreadCount > 0);
      void loadConversation(conversationId);
    },
    [conversations, loadConversation, scheduleRead, updateConversations],
  );

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );
  const selectedCounterpart = selectedConversation
    ? counterpart(
        selectedConversation,
        currentProfileId,
        profiles,
      )
    : undefined;
  const selectedMemberProfiles = selectedConversation
    ? conversationMemberIds(selectedConversation)
        .map((profileId) =>
          profiles.find((profile) => profile.id === profileId),
        )
        .filter((profile): profile is ChatProfile => Boolean(profile))
    : [];
  const profileById = useMemo(
    () =>
      new Map(
        profiles.map((profile) => [profile.id, profile] as const),
      ),
    [profiles],
  );
  const dmCandidates = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    return profiles.filter(
      (profile) =>
        profile.id !== currentProfileId &&
        (!query ||
          profile.fullName.toLowerCase().includes(query) ||
          profile.email.toLowerCase().includes(query)),
    );
  }, [currentProfileId, peopleSearch, profiles]);
  const memberCandidates = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return profiles.filter(
      (profile) =>
        (!query ||
          profile.fullName.toLowerCase().includes(query) ||
          profile.email.toLowerCase().includes(query)),
    );
  }, [memberSearch, profiles]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    threadRootMessageIdRef.current = threadRootMessageId;
  }, [threadRootMessageId]);

  const refreshConversation = useCallback(
    async (conversationId: string) => {
      try {
        const page = await requestConversationPage({ conversationId });
        const conversation = page.conversations[0];
        if (!conversation) return;
        updateConversations((current) =>
          mergeConversations(current, [conversation]),
        );
      } catch (refreshError) {
        console.error("Refresh workspace conversation failed:", refreshError);
      }
    },
    [updateConversations],
  );

  const loadMoreConversations = useCallback(async () => {
    if (!conversationCursor || loadingMoreConversations) return;
    setLoadingMoreConversations(true);
    try {
      const page = await requestConversationPage({
        cursor: conversationCursor,
      });
      updateConversations((current) =>
        mergeConversations(current, page.conversations),
      );
      setConversationCursor(page.nextCursor);
      setHasMoreConversations(page.hasMore);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load more conversations.",
      );
    } finally {
      setLoadingMoreConversations(false);
    }
  }, [
    conversationCursor,
    loadingMoreConversations,
    updateConversations,
  ]);

  const loadConversationRoster = useCallback(
    (conversationId: string, force = false) => {
      const currentConversation = conversationsRef.current.find(
        (conversation) => conversation.id === conversationId,
      );
      if (!force && currentConversation?.rosterLoaded) {
        return Promise.resolve(currentConversation.members);
      }
      const pending = pendingRosterRequests.current.get(conversationId);
      if (pending) return pending;

      const request = fetch(
        `/api/workspace-chat/conversations/${conversationId}/members`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          const result = (await response.json()) as ConversationResponse;
          if (!response.ok || !result.members) {
            throw new Error(
              result.error ?? "Could not load conversation members.",
            );
          }
          updateConversations((current) =>
            current.map((conversation) =>
              conversation.id === conversationId
                ? {
                    ...conversation,
                    members: result.members!,
                    memberCount: result.members!.length,
                    rosterLoaded: true,
                  }
                : conversation,
            ),
          );
          return result.members;
        })
        .finally(() => {
          pendingRosterRequests.current.delete(conversationId);
        });
      pendingRosterRequests.current.set(conversationId, request);
      return request;
    },
    [updateConversations],
  );

  const installBootstrap = useCallback(
    (bootstrap: WorkspaceChatBootstrap) => {
      const selectedId =
        bootstrap.selectedConversationId ??
        bootstrap.summaryPage.conversations[0]?.id;
      if (!selectedId) {
        setBootstrapped(true);
        setError("No conversations are available.");
        return;
      }

      const nextConversations = clearConversationUnread(
        bootstrap.summaryPage.conversations,
        selectedId,
      );
      const nextCache: WorkspaceMessageCache = {
        [selectedId]: {
          ...bootstrap.selectedMessagePage,
          loadedAt: Date.now(),
        },
      };
      setProfiles(bootstrap.profiles);
      conversationsRef.current = nextConversations;
      setConversations(nextConversations);
      messageCacheRef.current = nextCache;
      setMessageCache(nextCache);
      selectedConversationIdRef.current = selectedId;
      setSelectedConversationId(selectedId);
      setConversationCursor(bootstrap.summaryPage.nextCursor);
      setHasMoreConversations(bootstrap.summaryPage.hasMore);
      shouldScrollToBottom.current = true;
      setBootstrapped(true);
      setError("");

      const canonicalPath = `/chat/${selectedId}`;
      if (window.location.pathname !== canonicalPath) {
        window.history.replaceState(
          null,
          "",
          `${canonicalPath}${window.location.search}`,
        );
      }
      const unreadCount =
        bootstrap.summaryPage.conversations.find(
          (conversation) => conversation.id === selectedId,
        )?.unreadCount ?? 0;
      scheduleRead(selectedId, unreadCount > 0);
    },
    [scheduleRead],
  );

  const applySyncEvents = useCallback(
    (events: WorkspaceChatEvent[]) => {
      const selectedBefore = selectedConversationIdRef.current;
      const visibleThreadRootMessageId =
        document.visibilityState === "visible"
          ? threadRootMessageIdRef.current
          : undefined;
      const result = applyWorkspaceChatEvents(
        {
          conversations: conversationsRef.current,
          cache: messageCacheRef.current,
          selectedConversationId: selectedBefore,
          currentProfileId,
          visibleThreadRootMessageId,
          knownMessageIds: seenThreadReplyIds.current,
        },
        events,
      );

      conversationsRef.current = result.conversations;
      setConversations(result.conversations);
      messageCacheRef.current = result.cache;
      setMessageCache(result.cache);

      for (const conversationId of result.revokedConversationIds) {
        setDrafts((current) => {
          const next = { ...current };
          delete next[conversationId];
          return next;
        });
        setAttachmentDrafts((current) => {
          const next = { ...current };
          delete next[conversationId];
          return next;
        });
        scrollPositions.current.delete(conversationId);
      }

      if (result.workspaceRevoked) {
        setThreadRootMessageId(undefined);
        setMemberSheetOpen(false);
        setError("Your account no longer has access to P11 Chat.");
        return;
      }

      if (
        result.selectedConversationId &&
        result.selectedConversationId !== selectedBefore
      ) {
        const fallbackId = result.selectedConversationId;
        selectedConversationIdRef.current = fallbackId;
        setSelectedConversationId(fallbackId);
        setThreadRootMessageId(undefined);
        setMemberSheetOpen(false);
        shouldScrollToBottom.current =
          !messageCacheRef.current[fallbackId];
        window.history.replaceState(null, "", `/chat/${fallbackId}`);
        void loadConversation(fallbackId);
      }

      for (const event of events) {
        if (event.type !== "message.created" || !event.messageId) continue;
        const wasKnown = seenThreadReplyIds.current.has(event.messageId);
        if (event.parentMessageId) {
          seenThreadReplyIds.current.add(event.messageId);
          if (
            !wasKnown &&
            event.parentMessageId === threadRootMessageIdRef.current &&
            event.conversationId === selectedConversationIdRef.current
          ) {
            setThreadSyncEvent(event);
          }
        } else if (
          event.conversationId === selectedConversationIdRef.current &&
          event.senderId !== currentProfileId
        ) {
          scheduleRead(event.conversationId, true);
        }
      }

      for (const conversationId of result.hydrateConversationIds) {
        shouldScrollToBottom.current =
          selectedConversationIdRef.current === conversationId;
        void refreshForwardMessages(conversationId);
      }
      for (const conversationId of result.refreshConversationIds) {
        void refreshConversation(conversationId);
      }
      if (result.refreshAllConversations) {
        setDrafts({});
        setAttachmentDrafts({});
        setBootstrapVersion((current) => current + 1);
      }
    },
    [
      currentProfileId,
      loadConversation,
      refreshConversation,
      refreshForwardMessages,
      scheduleRead,
    ],
  );

  const setThreadRead = useCallback((rootMessageId: string) => {
    const conversationId = selectedConversationIdRef.current;
    updateConversationMessages(conversationId, (current) =>
      current.map((message) =>
        message.id === rootMessageId
          ? { ...message, threadUnreadCount: 0 }
          : message,
      )
    );
  }, [updateConversationMessages]);

  const applyThreadReply = useCallback((reply: WorkspaceMessage) => {
    if (!reply.parentMessageId || seenThreadReplyIds.current.has(reply.id)) {
      return;
    }
    seenThreadReplyIds.current.add(reply.id);
    updateConversationMessages(reply.conversationId, (current) =>
      current.map((message) =>
        message.id === reply.parentMessageId
          ? {
              ...message,
              replyCount: message.replyCount + 1,
              lastReplyAt: reply.createdAt,
              threadUnreadCount: 0,
            }
          : message,
      )
    );
  }, [updateConversationMessages]);

  useEffect(() => {
    const canonicalPath = `/chat/${selectedConversationIdRef.current}`;
    if (window.location.pathname !== canonicalPath) {
      window.history.replaceState(
        null,
        "",
        `${canonicalPath}${window.location.search}`,
      );
    }

    function handlePopState() {
      const routeMatch = window.location.pathname.match(/^\/chat\/([^/]+)\/?$/);
      const conversationId = routeMatch?.[1];
      if (
        !conversationId ||
        !conversationsRef.current.some(
          (conversation) => conversation.id === conversationId,
        )
      ) {
        return;
      }
      const viewport = messageViewportRef.current;
      if (viewport) {
        scrollPositions.current.set(
          selectedConversationIdRef.current,
          viewport.scrollTop,
        );
      }
      selectedConversationIdRef.current = conversationId;
      shouldScrollToBottom.current =
        !messageCacheRef.current[conversationId];
      setSelectedConversationId(conversationId);
      setThreadRootMessageId(
        new URLSearchParams(window.location.search).get("thread") ?? undefined,
      );
      void loadConversation(conversationId);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [loadConversation]);

  useEffect(() => {
    function flushVisibleRead() {
      if (document.visibilityState !== "visible") return;
      for (const conversationId of pendingReadIds.current) {
        scheduleRead(conversationId, true);
      }
    }

    document.addEventListener("visibilitychange", flushVisibleRead);
    const timers = readTimers.current;
    return () => {
      document.removeEventListener("visibilitychange", flushVisibleRead);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [scheduleRead]);

  useLayoutEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport || !messageCacheRef.current[selectedConversationId]) return;
    const savedPosition = scrollPositions.current.get(selectedConversationId);
    viewport.scrollTop = savedPosition ?? viewport.scrollHeight;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!selectedMessagePage) return;
    if (!shouldScrollToBottom.current) {
      shouldScrollToBottom.current = true;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedMessagePage]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    const requestId = ++bootstrapRequestId.current;
    let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | undefined;
    let controller: WorkspaceChatSyncController | undefined;
    let stopAuthRefresh: (() => void) | undefined;

    async function startSync() {
      const targetConversationId =
        bootstrapVersion === 0
          ? requestedConversationId
          : selectedConversationIdRef.current;
      const bootstrap = await requestChatBootstrap(targetConversationId);
      if (!active || requestId !== bootstrapRequestId.current) return;
      installBootstrap(bootstrap);

      controller = new WorkspaceChatSyncController(
        bootstrap.cursor,
        requestChatEventPage,
        applySyncEvents,
        () => {
          if (!active) return;
          messageCacheRef.current = {};
          setMessageCache({});
          setDrafts({});
          setAttachmentDrafts({});
          setBootstrapVersion((current) => current + 1);
        },
        (syncError) => {
          if (!active) return;
          console.error("Workspace chat synchronization failed:", syncError);
          document.documentElement.dataset.chatRealtime = "sync-error";
        },
      );

      if (!supabase) {
        document.documentElement.dataset.chatRealtime = "unavailable";
        return;
      }
      const client = supabase;
      document.documentElement.dataset.chatRealtime = "authenticating";
      await authenticateWorkspaceRealtime(client);
      if (!active) return;
      stopAuthRefresh = keepWorkspaceRealtimeAuthenticated(
        client,
        (authError) => {
          console.error(
            "Workspace chat Realtime token refresh failed:",
            authError,
          );
          document.documentElement.dataset.chatRealtime = "auth-error";
        },
      );

      document.documentElement.dataset.chatRealtime = "connecting";
      channel = client
        .channel(`workspace-membership:${currentProfileId}`, {
          config: { private: true },
        })
        .on(
          "broadcast",
          { event: "workspace-chat-sync" },
          (payload) => {
            if (!active) return;
            const event = parseWorkspaceChatBroadcast(payload);
            if (event) controller?.acceptBroadcast(event);
          },
        )
        .subscribe((status, realtimeError) => {
          if (!active) return;
          document.documentElement.dataset.chatRealtime =
            status.toLowerCase();
          if (realtimeError) {
            console.error(
              "Workspace chat Realtime subscription failed:",
              realtimeError,
            );
          }
          if (status === "SUBSCRIBED") controller?.reconnect();
        });
    }

    void startSync().catch((startError: unknown) => {
      if (!active) return;
      document.documentElement.dataset.chatRealtime = "auth-error";
      setBootstrapped(true);
      setError(
        startError instanceof Error
          ? startError.message
          : "Could not start P11 Chat.",
      );
      console.error("Workspace chat startup failed:", startError);
    });

    return () => {
      active = false;
      controller?.dispose();
      stopAuthRefresh?.();
      delete document.documentElement.dataset.chatRealtime;
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, [
    applySyncEvents,
    bootstrapVersion,
    currentProfileId,
    installBootstrap,
    requestedConversationId,
  ]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const conversationId = selectedConversationId;
    const body = messageBody.trim();
    if ((!body && !attachmentFiles.length) || sending) return;
    setSending(true);
    setError("");
    const clientNonce = crypto.randomUUID();
    let attachmentIds: string[] = [];
    try {
      const uploaded = await uploadChatAttachments(
        conversationId,
        attachmentFiles,
      );
      attachmentIds = uploaded.map((attachment) => attachment.id);
      const response = await fetch("/api/workspace-chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          body,
          clientNonce,
          attachmentIds,
        }),
      });
      const result = (await response.json()) as MessageResponse;

      if (response.ok && result.message) {
        shouldScrollToBottom.current =
          selectedConversationIdRef.current === conversationId;
        updateConversationMessages(
          conversationId,
          (current) => mergeWorkspaceMessages(current, [result.message!]),
        );
        updateConversations((current) =>
          applyMessageToConversations({
            conversations: current,
            message: result.message!,
            currentProfileId,
            selectedConversationId: selectedConversationIdRef.current,
            incrementUnread: false,
          }),
        );
        setDrafts((current) => ({ ...current, [conversationId]: "" }));
        setAttachmentDrafts((current) => ({
          ...current,
          [conversationId]: [],
        }));
      } else {
        await removePendingChatAttachments(attachmentIds);
        setError(result.error ?? "Could not send the message.");
      }
    } catch (sendError) {
      if (attachmentIds.length) {
        await removePendingChatAttachments(attachmentIds);
      }
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send the message.",
      );
    }
    setSending(false);
  }

  async function loadOlderMessages() {
    const conversationId = selectedConversationId;
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    setError("");
    shouldScrollToBottom.current = false;
    try {
      const result = await requestMessagePage(conversationId, {
        beforeCreatedAt: oldest.createdAt,
        beforeMessageId: oldest.id,
      });
      updateConversationMessages(
        conversationId,
        (current) => mergeWorkspaceMessages(result.messages, current),
        result.hasMore,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load older messages.",
      );
    }
    setLoadingOlder(false);
  }

  async function createChannel(event: React.FormEvent) {
    event.preventDefault();
    if (!channelName.trim()) return;
    setCreatingConversation(true);
    setError("");
    const response = await fetch("/api/workspace-chat/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "channel",
        name: channelName,
        visibility: channelVisibility,
        memberIds: channelVisibility === "private" ? channelMemberIds : [],
      }),
    });
    const result = (await response.json()) as ConversationResponse;
    if (response.ok && result.conversation) {
      setChannelDialogOpen(false);
      setChannelName("");
      setChannelVisibility("public");
      setChannelMemberIds([]);
      setPeopleSearch("");
      updateConversations((current) =>
        mergeConversations(current, [result.conversation!]),
      );
      selectConversation(result.conversation.id);
    } else {
      setError(result.error ?? "Could not create the channel.");
    }
    setCreatingConversation(false);
  }

  async function startDirectMessage() {
    if (creatingConversation || dmMemberIds.length === 0) return;
    setCreatingConversation(true);
    setError("");
    const response = await fetch("/api/workspace-chat/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "dm", profileIds: dmMemberIds }),
    });
    const result = (await response.json()) as ConversationResponse;
    if (response.ok && result.conversation) {
      setDmDialogOpen(false);
      setPeopleSearch("");
      setDmMemberIds([]);
      updateConversations((current) =>
        mergeConversations(current, [result.conversation!]),
      );
      selectConversation(result.conversation.id);
    } else {
      setError(result.error ?? "Could not start the direct message.");
    }
    setCreatingConversation(false);
  }

  async function updateChannelMembers(event: React.FormEvent) {
    event.preventDefault();
    const conversation = selectedConversation;
    if (
      updatingMembers ||
      !conversation ||
      conversation.kind !== "channel" ||
      conversation.visibility !== "private"
    ) {
      return;
    }
    setUpdatingMembers(true);
    setError("");
    const response = await fetch(
      `/api/workspace-chat/conversations/${conversation.id}/members`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberIds: managedMemberIds }),
      },
    );
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setMemberSheetOpen(false);
      setMemberSearch("");
      await Promise.all([
        refreshConversation(conversation.id),
        loadConversationRoster(conversation.id, true),
      ]);
    } else {
      setError(result.error ?? "Could not update private channel members.");
    }
    setUpdatingMembers(false);
  }

  if (!selectedConversation) {
    return (
      <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        {bootstrapped
          ? "This conversation is no longer available."
          : "Starting P11 Chat…"}
      </div>
    );
  }

  const selectedName = conversationName(
    selectedConversation,
    currentProfileId,
    profiles,
  );

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 border-r bg-muted/25 md:flex md:flex-col">
        <ConversationRail
          conversations={conversations}
          currentProfileId={currentProfileId}
          onCreateChannel={() => setChannelDialogOpen(true)}
          hasMore={hasMoreConversations}
          loadingMore={loadingMoreConversations}
          onLoadMore={() => void loadMoreConversations()}
          onPreload={(conversationId) => {
            void loadConversation(conversationId);
          }}
          onSelect={selectConversation}
          onStartDm={() => setDmDialogOpen(true)}
          profiles={profiles}
          selectedConversationId={selectedConversationId}
        />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-5">
          <Button
            aria-label="Open channels and direct messages"
            className="md:hidden"
            onClick={() => setMobileRailOpen(true)}
            size="icon"
            variant="outline"
          >
            <Menu />
          </Button>
          {selectedConversation.kind === "channel" ? (
            <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
              {selectedConversation.visibility === "private" ? (
                <LockKeyhole className="size-4" />
              ) : (
                <Hash className="size-4" />
              )}
            </div>
          ) : selectedMemberProfiles.length > 2 ? (
            <AvatarStack profiles={selectedMemberProfiles} size="md" />
          ) : (
            <Avatar className="size-9">
              <AvatarImage
                alt=""
                src={selectedCounterpart?.avatarUrl}
              />
              <AvatarFallback className="text-[10px]">
                {selectedCounterpart?.initials ?? "DM"}
              </AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-semibold">
              {selectedConversation.kind === "channel"
                ? `# ${selectedName}`
                : selectedName}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {selectedConversation.kind === "channel"
                ? selectedConversation.visibility === "private"
                  ? `Private channel · ${selectedConversation.memberCount} members`
                  : "Public P11 channel"
                : selectedMemberProfiles.length > 2
                  ? `Group direct message · ${selectedMemberProfiles.length} members`
                  : selectedCounterpart?.title || selectedCounterpart?.email}
            </p>
          </div>
          {selectedConversation.kind === "channel" &&
            selectedConversation.visibility === "private" &&
            selectedConversation.canManage && (
              <Button
                aria-label="Manage private channel members"
                className="ml-auto"
                onClick={() => {
                  void loadConversationRoster(selectedConversation.id)
                    .then((members) => {
                      setManagedMemberIds(
                        members
                          .map((member) => member.profileId)
                          .filter(
                            (profileId) =>
                              profileId === currentProfileId ||
                              profileById.has(profileId),
                          ),
                      );
                      setMemberSheetOpen(true);
                    })
                    .catch((loadError: unknown) => {
                      setError(
                        loadError instanceof Error
                          ? loadError.message
                          : "Could not load channel members.",
                      );
                    });
                }}
                size="sm"
                variant="outline"
              >
                <Settings2 />
                Manage members
              </Button>
            )}
        </header>

        <div
          aria-live="polite"
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            scrollPositions.current.set(
              selectedConversationId,
              event.currentTarget.scrollTop,
            );
          }}
          ref={messageViewportRef}
        >
          <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
            {hasMoreMessages && (
              <div className="mb-5 flex justify-center">
                <Button
                  disabled={loadingOlder}
                  onClick={() => void loadOlderMessages()}
                  size="sm"
                  variant="outline"
                >
                  {loadingOlder && <LoaderCircle className="animate-spin" />}
                  Load earlier messages
                </Button>
              </div>
            )}

            {!selectedMessagePage ? (
              <div className="grid min-h-64 place-items-center">
                <LoaderCircle
                  aria-label="Loading messages"
                  className="size-5 animate-spin text-muted-foreground"
                />
              </div>
            ) : selectedMessagePage.error ? (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {selectedMessagePage.error}
                  </p>
                  <Button
                    className="mt-3"
                    onClick={() => void loadConversation(selectedConversationId)}
                    size="sm"
                    variant="outline"
                  >
                    Try again
                  </Button>
                </div>
              </div>
            ) : !messages.length ? (
              <div className="grid min-h-64 place-items-center text-center">
                <div>
                  <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                    {selectedConversation.kind === "channel" ? (
                      <Hash className="size-5" />
                    ) : (
                      <MessageCircle className="size-5" />
                    )}
                  </div>
                  <h2 className="mt-4 font-semibold">
                    Start the conversation
                  </h2>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Messages appear here instantly for everyone with access.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message) => (
                  <MessageItem
                    author={profileById.get(message.senderId)}
                    key={message.id}
                    message={message}
                    onOpenThread={() => {
                      setThreadRootMessageId(message.id);
                      window.history.pushState(
                        null,
                        "",
                        `/chat/${selectedConversationId}?thread=${message.id}`,
                      );
                    }}
                  />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 border-t bg-background px-4 py-3 sm:px-5">
          <div className="mx-auto max-w-4xl">
            {error && (
              <Alert className="mb-3" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <AttachmentPicker
              disabled={sending}
              files={attachmentFiles}
              onChange={setAttachmentFiles}
              onError={setError}
            />
            <form className="flex items-end gap-2" onSubmit={sendMessage}>
              <Textarea
                aria-label={`Message ${selectedName}`}
                className="max-h-40 min-h-11 resize-none py-2.5"
                maxLength={4000}
                onChange={(event) => setMessageBody(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={
                  selectedConversation.kind === "channel"
                    ? `Message #${selectedName}`
                    : `Message ${selectedName}`
                }
                rows={1}
                value={messageBody}
              />
              <Button
                aria-label="Send message"
                disabled={
                  sending || (!messageBody.trim() && !attachmentFiles.length)
                }
                size="icon"
                type="submit"
              >
                {sending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Send />
                )}
              </Button>
            </form>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line
            </p>
          </div>
        </div>
      </section>

      {threadRootMessageId && (
        <ThreadPanel
          conversationId={selectedConversationId}
          key={threadRootMessageId}
          onClose={() => {
            setThreadRootMessageId(undefined);
            window.history.pushState(
              null,
              "",
              `/chat/${selectedConversationId}`,
            );
          }}
          onReply={applyThreadReply}
          onThreadRead={setThreadRead}
          profiles={profiles}
          rootMessageId={threadRootMessageId}
          syncEvent={threadSyncEvent}
        />
      )}

      <Sheet onOpenChange={setMobileRailOpen} open={mobileRailOpen}>
        <SheetContent className="p-0" side="left">
          <SheetHeader className="sr-only">
            <SheetTitle>P11 Chat conversations</SheetTitle>
            <SheetDescription>
              Choose a channel or direct message.
            </SheetDescription>
          </SheetHeader>
          <ConversationRail
            conversations={conversations}
            currentProfileId={currentProfileId}
            onCreateChannel={() => {
              setMobileRailOpen(false);
              setChannelDialogOpen(true);
            }}
            hasMore={hasMoreConversations}
            loadingMore={loadingMoreConversations}
            onLoadMore={() => void loadMoreConversations()}
            onPreload={(conversationId) => {
              void loadConversation(conversationId);
            }}
            onSelect={(conversationId) => {
              setMobileRailOpen(false);
              selectConversation(conversationId);
            }}
            onStartDm={() => {
              setMobileRailOpen(false);
              setDmDialogOpen(true);
            }}
            profiles={profiles}
            selectedConversationId={selectedConversationId}
          />
        </SheetContent>
      </Sheet>

      <Dialog
        onOpenChange={setChannelDialogOpen}
        open={channelDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a channel</DialogTitle>
            <DialogDescription>
              Public channels are visible to the workspace. Private channels are
              visible only to selected members.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={createChannel}>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Channel name"
                autoFocus
                className="pl-9"
                maxLength={80}
                onChange={(event) => setChannelName(event.target.value)}
                placeholder="creative-review"
                value={channelName}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => setChannelVisibility("public")}
                type="button"
                variant={
                  channelVisibility === "public" ? "default" : "outline"
                }
              >
                <Hash />
                Public
              </Button>
              <Button
                onClick={() => setChannelVisibility("private")}
                type="button"
                variant={
                  channelVisibility === "private" ? "default" : "outline"
                }
              >
                <LockKeyhole />
                Private
              </Button>
            </div>
            {channelVisibility === "private" && (
              <MemberPicker
                disabled={creatingConversation}
                emptyMessage="No teammates match that search."
                onSearchChange={setPeopleSearch}
                onToggle={(profileId) =>
                  setChannelMemberIds((current) =>
                    current.includes(profileId)
                      ? current.filter((id) => id !== profileId)
                      : [...current, profileId],
                  )
                }
                profiles={dmCandidates}
                search={peopleSearch}
                selectedIds={channelMemberIds}
              />
            )}
            <Button
              className="w-full"
              disabled={creatingConversation || !channelName.trim()}
            >
              {creatingConversation && (
                <LoaderCircle className="animate-spin" />
              )}
              Create channel
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={setDmDialogOpen}
        open={dmDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a direct message</DialogTitle>
            <DialogDescription>
              Select one teammate for a direct message or several for an
              immutable group direct message.
            </DialogDescription>
          </DialogHeader>
          <MemberPicker
            disabled={creatingConversation}
            emptyMessage="No teammates match that search."
            onSearchChange={setPeopleSearch}
            onToggle={(profileId) =>
              setDmMemberIds((current) =>
                current.includes(profileId)
                  ? current.filter((id) => id !== profileId)
                  : [...current, profileId],
              )
            }
            profiles={dmCandidates}
            search={peopleSearch}
            selectedIds={dmMemberIds}
          />
          <Button
            className="w-full"
            disabled={creatingConversation || dmMemberIds.length === 0}
            onClick={() => void startDirectMessage()}
          >
            {creatingConversation && <LoaderCircle className="animate-spin" />}
            {dmMemberIds.length > 1
              ? `Start group DM with ${dmMemberIds.length + 1} members`
              : "Start direct message"}
          </Button>
        </DialogContent>
      </Dialog>

      <Sheet onOpenChange={setMemberSheetOpen} open={memberSheetOpen}>
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>Manage private channel members</SheetTitle>
            <SheetDescription>
              Owners remain in the channel. Removed members immediately lose
              access to messages, threads, and files.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-4"
            onSubmit={updateChannelMembers}
          >
            <MemberPicker
              disabled={updatingMembers}
              emptyMessage="No teammates match that search."
              lockedIds={
                selectedConversation.members
                  .filter((member) => member.role === "owner")
                  .map((member) => member.profileId)
              }
              onSearchChange={setMemberSearch}
              onToggle={(profileId) =>
                setManagedMemberIds((current) =>
                  current.includes(profileId)
                    ? current.filter((id) => id !== profileId)
                    : [...current, profileId],
                )
              }
              profiles={memberCandidates}
              search={memberSearch}
              selectedIds={managedMemberIds}
            />
            <Button disabled={updatingMembers}>
              {updatingMembers && <LoaderCircle className="animate-spin" />}
              Save members
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AvatarStack({
  profiles,
  size = "sm",
}: {
  profiles: ChatProfile[];
  size?: "sm" | "md";
}) {
  const shown = profiles.slice(0, 3);
  return (
    <div
      aria-label={`${profiles.length} conversation members`}
      className="flex shrink-0 -space-x-2"
    >
      {shown.map((profile) => (
        <Avatar
          className={cn(
            "border-2 border-background",
            size === "md" ? "size-9" : "size-6",
          )}
          key={profile.id}
        >
          <AvatarImage alt="" src={profile.avatarUrl} />
          <AvatarFallback className={size === "md" ? "text-[9px]" : "text-[7px]"}>
            {profile.initials}
          </AvatarFallback>
        </Avatar>
      ))}
      {profiles.length > 3 && (
        <span
          className={cn(
            "relative grid place-items-center rounded-full border-2 border-background bg-muted font-medium text-muted-foreground",
            size === "md" ? "size-9 text-[9px]" : "size-6 text-[7px]",
          )}
        >
          +{profiles.length - 3}
        </span>
      )}
    </div>
  );
}

function MemberPicker({
  profiles,
  selectedIds,
  search,
  onSearchChange,
  onToggle,
  disabled,
  emptyMessage,
  lockedIds = [],
}: {
  profiles: ChatProfile[];
  selectedIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggle: (profileId: string) => void;
  disabled: boolean;
  emptyMessage: string;
  lockedIds?: string[];
}) {
  return (
    <div className="min-h-0 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search P11 teammates"
          className="pl-9"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search P11 teammates"
          value={search}
        />
      </div>
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {profiles.map((profile) => {
          const selected = selectedIds.includes(profile.id);
          const locked = lockedIds.includes(profile.id);
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-primary/25 bg-primary/5",
              )}
              disabled={disabled || locked}
              key={profile.id}
              onClick={() => onToggle(profile.id)}
              type="button"
            >
              <Avatar className="size-9">
                <AvatarImage alt="" src={profile.avatarUrl} />
                <AvatarFallback className="text-[10px]">
                  {profile.initials}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {profile.fullName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {locked ? "Channel owner" : profile.title || profile.email}
                </span>
              </span>
              <span
                className={cn(
                  "grid size-5 place-items-center rounded border",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input",
                )}
              >
                {selected && <Check className="size-3.5" />}
              </span>
            </button>
          );
        })}
        {!profiles.length && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        )}
      </div>
      {selectedIds.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {selectedIds.length} teammate{selectedIds.length === 1 ? "" : "s"}{" "}
          selected
        </p>
      )}
    </div>
  );
}

function ConversationRail({
  conversations,
  currentProfileId,
  profiles,
  selectedConversationId,
  onCreateChannel,
  hasMore,
  loadingMore,
  onLoadMore,
  onStartDm,
  onPreload,
  onSelect,
}: {
  conversations: WorkspaceConversation[];
  currentProfileId: string;
  profiles: ChatProfile[];
  selectedConversationId: string;
  onCreateChannel: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onStartDm: () => void;
  onPreload: (conversationId: string) => void;
  onSelect: (conversationId: string) => void;
}) {
  const channels = conversations
    .filter((conversation) => conversation.kind === "channel")
    .sort((first, second) =>
      (first.name ?? "").localeCompare(second.name ?? ""),
    );
  const directMessages = conversations
    .filter((conversation) => conversation.kind === "dm")
    .sort((first, second) =>
      conversationName(first, currentProfileId, profiles).localeCompare(
        conversationName(second, currentProfileId, profiles),
      ),
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
        <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
          <MessageCircle className="size-4" />
        </div>
        <div>
          <p className="font-semibold">P11 Chat</p>
          <p className="text-[11px] text-muted-foreground">
            Channels and direct messages
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <section>
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Channels
            </p>
            <Button
              aria-label="Create channel"
              onClick={onCreateChannel}
              size="icon-xs"
              variant="ghost"
            >
              <Plus />
            </Button>
          </div>
          <nav aria-label="Chat channels" className="space-y-0.5">
            {channels.map((conversation) => (
              <ConversationLink
                conversation={conversation}
                currentProfileId={currentProfileId}
                key={conversation.id}
                onPreload={onPreload}
                onSelect={onSelect}
                profiles={profiles}
                selected={conversation.id === selectedConversationId}
              />
            ))}
          </nav>
        </section>

        <Separator className="my-4" />

        <section>
          <div className="mb-1 flex items-center justify-between px-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Direct messages
            </p>
            <Button
              aria-label="Start direct message"
              onClick={onStartDm}
              size="icon-xs"
              variant="ghost"
            >
              <Plus />
            </Button>
          </div>
          <nav aria-label="Direct messages" className="space-y-0.5">
            {directMessages.map((conversation) => (
              <ConversationLink
                conversation={conversation}
                currentProfileId={currentProfileId}
                key={conversation.id}
                onPreload={onPreload}
                onSelect={onSelect}
                profiles={profiles}
                selected={conversation.id === selectedConversationId}
              />
            ))}
            {!directMessages.length && (
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
                onClick={onStartDm}
                type="button"
              >
                <UserRound className="size-4" />
                Message a teammate
              </button>
            )}
          </nav>
        </section>
        {hasMore && (
          <Button
            className="mt-4 w-full"
            disabled={loadingMore}
            onClick={onLoadMore}
            size="sm"
            variant="outline"
          >
            {loadingMore && <LoaderCircle className="animate-spin" />}
            Load more conversations
          </Button>
        )}
      </div>
    </div>
  );
}

function ConversationLink({
  conversation,
  currentProfileId,
  profiles,
  selected,
  onPreload,
  onSelect,
}: {
  conversation: WorkspaceConversation;
  currentProfileId: string;
  profiles: ChatProfile[];
  selected: boolean;
  onPreload: (conversationId: string) => void;
  onSelect: (conversationId: string) => void;
}) {
  const person = counterpart(conversation, currentProfileId, profiles);
  const name = conversationName(conversation, currentProfileId, profiles);
  const memberProfiles = conversationMemberIds(conversation)
    .map((profileId) =>
      profiles.find((profile) => profile.id === profileId),
    )
    .filter((profile): profile is ChatProfile => Boolean(profile));

  return (
    <Button
      asChild
      className={cn(
        "h-9 w-full justify-start gap-2 px-2 font-normal",
        selected && "bg-accent font-medium text-accent-foreground",
      )}
      variant="ghost"
    >
      <Link
        href={`/chat/${conversation.id}`}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          onSelect(conversation.id);
        }}
        onFocus={() => onPreload(conversation.id)}
        onMouseEnter={() => onPreload(conversation.id)}
      >
        {conversation.kind === "channel" ? (
          conversation.visibility === "private" ? (
            <LockKeyhole className="size-4 text-muted-foreground" />
          ) : (
            <Hash className="size-4 text-muted-foreground" />
          )
        ) : memberProfiles.length > 2 ? (
          <AvatarStack profiles={memberProfiles} />
        ) : (
          <Avatar className="size-5">
            <AvatarImage alt="" src={person?.avatarUrl} />
            <AvatarFallback className="text-[7px]">
              {person?.initials ?? "DM"}
            </AvatarFallback>
          </Avatar>
        )}
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        {conversation.unreadCount > 0 && (
          <Badge className="h-5 min-w-5 justify-center px-1.5 text-[10px]">
            {conversation.unreadCount > 99
              ? "99+"
              : conversation.unreadCount}
          </Badge>
        )}
      </Link>
    </Button>
  );
}
