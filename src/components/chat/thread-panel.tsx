"use client";

import { LoaderCircle, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MessageItem } from "@/components/chat/message-item";
import { AttachmentPicker } from "@/components/chat/attachment-picker";
import {
  EntityLinkPicker,
  resolvePastedLink,
} from "@/components/cross-links/entity-link-picker";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { mergeWorkspaceMessages } from "@/lib/chat/reconcile";
import {
  removePendingChatAttachments,
  uploadChatAttachments,
} from "@/lib/chat/attachments";
import type {
  ChatProfile,
  WorkspaceChatEvent,
  WorkspaceMessage,
  WorkspaceMessagePage,
} from "@/lib/chat/types";
import type { CrossLinkSearchResult } from "@/lib/cross-links/types";

type ThreadResponse = WorkspaceMessagePage & {
  root?: WorkspaceMessage;
  error?: string;
};

type MessageResponse = {
  message?: WorkspaceMessage;
  error?: string;
};

export function ThreadPanel({
  conversationId,
  currentProfileId,
  rootMessageId,
  focusedMessageId,
  profiles,
  onClose,
  onReply,
  onThreadRead,
  syncEvent,
}: {
  conversationId: string;
  currentProfileId: string;
  rootMessageId: string;
  focusedMessageId?: string;
  profiles: ChatProfile[];
  onClose: () => void;
  onReply: (message: WorkspaceMessage) => void;
  onThreadRead: (rootMessageId: string) => void;
  syncEvent?: WorkspaceChatEvent;
}) {
  const [root, setRoot] = useState<WorkspaceMessage>();
  const [replies, setReplies] = useState<WorkspaceMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [body, setBody] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [linkedWork, setLinkedWork] = useState<CrossLinkSearchResult[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const repliesRef = useRef<WorkspaceMessage[]>([]);
  const pendingForwardRefresh = useRef<Promise<void> | undefined>(undefined);
  const queuedForwardRefresh = useRef(false);
  const lastSyncSequence = useRef("0");
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile] as const)),
    [profiles],
  );

  const updateReplies = useCallback(
    (
      update: (
        current: WorkspaceMessage[],
      ) => WorkspaceMessage[],
    ) => {
      setReplies((current) => {
        const next = update(current);
        repliesRef.current = next;
        return next;
      });
    },
    [],
  );

  const postRead = useCallback(async () => {
    const response = await fetch("/api/workspace-chat/thread-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootMessageId }),
    });
    if (response.ok) onThreadRead(rootMessageId);
    return response.ok;
  }, [onThreadRead, rootMessageId]);

  const refreshReplies = useCallback(async () => {
    const query = new URLSearchParams({
      conversationId,
      threadId: rootMessageId,
    });
    const response = await fetch(
      `/api/workspace-chat/messages?${query.toString()}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as ThreadResponse;
    if (response.ok) {
      setRoot(result.root);
      updateReplies((current) =>
        mergeWorkspaceMessages(current, result.messages),
      );
      setHasMore(result.hasMore);
      setError("");
      void postRead();
    } else {
      setError(result.error ?? "Could not load this thread.");
    }
    setLoading(false);
  }, [conversationId, postRead, rootMessageId, updateReplies]);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({
      conversationId,
      threadId: rootMessageId,
    });
    void fetch(`/api/workspace-chat/messages?${query.toString()}`, {
      cache: "no-store",
    })
      .then(async (response) => ({
        ok: response.ok,
        result: (await response.json()) as ThreadResponse,
      }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (ok) {
          setRoot(result.root);
          repliesRef.current = result.messages;
          setReplies(result.messages);
          setHasMore(result.hasMore);
          setError("");
          void postRead();
        } else {
          setError(result.error ?? "Could not load this thread.");
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, postRead, rootMessageId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [replies]);

  useEffect(() => {
    if (!focusedMessageId) return;
    document
      .getElementById(`chat-message-${focusedMessageId}`)
      ?.scrollIntoView({ block: "center" });
  }, [focusedMessageId, replies]);

  const refreshForwardReplies = useCallback(
    function refreshForwardReplies(): Promise<void> {
      const pending = pendingForwardRefresh.current;
      if (pending) {
        queuedForwardRefresh.current = true;
        return pending;
      }
      queuedForwardRefresh.current = false;

      const request = (async () => {
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const latest = repliesRef.current.at(-1);
          if (!latest) {
            await refreshReplies();
            return;
          }
          const query = new URLSearchParams({
            conversationId,
            threadId: rootMessageId,
            afterCreatedAt: latest.createdAt,
            afterMessageId: latest.id,
          });
          const response = await fetch(
            `/api/workspace-chat/messages?${query.toString()}`,
            { cache: "no-store" },
          );
          const result = (await response.json()) as ThreadResponse;
          if (!response.ok) {
            throw new Error(result.error ?? "Could not catch up this thread.");
          }
          updateReplies((current) =>
            mergeWorkspaceMessages(current, result.messages),
          );
          for (const reply of result.messages) onReply(reply);
          if (!result.hasMore) {
            if (document.visibilityState === "visible") void postRead();
            return;
          }
        }
        throw new Error("Thread catch-up exceeded its safety limit.");
      })()
        .catch((refreshError: unknown) => {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not catch up this thread.",
          );
        })
        .finally(() => {
          pendingForwardRefresh.current = undefined;
          if (queuedForwardRefresh.current) {
            queuedForwardRefresh.current = false;
            void refreshForwardReplies();
          }
        });
      pendingForwardRefresh.current = request;
      return request;
    },
    [
      conversationId,
      onReply,
      postRead,
      refreshReplies,
      rootMessageId,
      updateReplies,
    ],
  );

  useEffect(() => {
    if (
      !syncEvent ||
      syncEvent.sequence === lastSyncSequence.current ||
      syncEvent.parentMessageId !== rootMessageId ||
      syncEvent.conversationId !== conversationId
    ) {
      return;
    }
    lastSyncSequence.current = syncEvent.sequence;
    void refreshForwardReplies();
  }, [
    conversationId,
    refreshForwardReplies,
    rootMessageId,
    syncEvent,
  ]);

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if ((!trimmedBody && !attachmentFiles.length && !linkedWork.length) || sending) return;
    setSending(true);
    setError("");
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
          parentMessageId: rootMessageId,
          body: trimmedBody,
          clientNonce: crypto.randomUUID(),
          attachmentIds,
          workLinks: linkedWork.map((link) => ({
            type: link.type,
            id: link.id,
          })),
        }),
      });
      const result = (await response.json()) as MessageResponse;
      if (response.ok && result.message) {
        updateReplies((current) =>
          mergeWorkspaceMessages(current, [result.message!]),
        );
        onReply(result.message);
        setBody("");
        setAttachmentFiles([]);
        setLinkedWork([]);
        void postRead();
      } else {
        await removePendingChatAttachments(attachmentIds);
        setError(result.error ?? "Could not send the reply.");
      }
    } catch (sendError) {
      if (attachmentIds.length) {
        await removePendingChatAttachments(attachmentIds);
      }
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send the reply.",
      );
    }
    setSending(false);
  }

  async function loadOlderReplies() {
    const oldest = replies[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    setError("");
    const query = new URLSearchParams({
      conversationId,
      threadId: rootMessageId,
      beforeCreatedAt: oldest.createdAt,
      beforeMessageId: oldest.id,
    });
    const response = await fetch(
      `/api/workspace-chat/messages?${query.toString()}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as ThreadResponse;
    if (response.ok) {
      updateReplies((current) =>
        mergeWorkspaceMessages(result.messages, current),
      );
      setHasMore(result.hasMore);
    } else {
      setError(result.error ?? "Could not load earlier replies.");
    }
    setLoadingOlder(false);
  }

  return (
    <aside className="fixed inset-0 z-50 flex min-w-0 flex-col bg-background lg:static lg:z-auto lg:w-[420px] lg:shrink-0 lg:border-l">
      <header className="flex h-16 shrink-0 items-center justify-between border-b px-4">
        <div>
          <h2 className="font-semibold">Thread</h2>
          <p className="text-xs text-muted-foreground">
            {replies.length} {replies.length === 1 ? "reply" : "replies"}
          </p>
        </div>
        <Button
          aria-label="Close thread"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        {loading && !root ? (
          <div className="grid min-h-40 place-items-center">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : root ? (
          <>
            <MessageItem
              author={profileById.get(root.senderId)}
              currentProfileId={currentProfileId}
              message={root}
            />
            <Separator className="my-5" />
            {hasMore && (
              <div className="mb-5 flex justify-center">
                <Button
                  disabled={loadingOlder}
                  onClick={() => void loadOlderReplies()}
                  size="sm"
                  variant="outline"
                >
                  {loadingOlder && (
                    <LoaderCircle className="animate-spin" />
                  )}
                  Load earlier replies
                </Button>
              </div>
            )}
            <div className="space-y-5">
              {replies.map((reply) => (
                <MessageItem
                  author={profileById.get(reply.senderId)}
                  currentProfileId={currentProfileId}
                  key={reply.id}
                  message={reply}
                />
              ))}
            </div>
            {!replies.length && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No replies yet. Start the thread.
              </p>
            )}
            <div ref={bottomRef} />
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This thread is no longer available.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t bg-background p-4">
        {error && (
          <Alert className="mb-3" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AttachmentPicker
          disabled={sending || !root}
          files={attachmentFiles}
          onChange={setAttachmentFiles}
          onError={setError}
        />
        <EntityLinkPicker
          disabled={sending || !root}
          onChange={setLinkedWork}
          scope="work"
          value={linkedWork}
        />
        <form className="flex items-end gap-2" onSubmit={sendReply}>
          <Textarea
            aria-label="Reply in thread"
            className="max-h-40 min-h-11 resize-none py-2.5"
            disabled={!root}
            maxLength={4000}
            onChange={(event) => setBody(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              void resolvePastedLink(pasted, "work").then((result) => {
                if (
                  result &&
                  !linkedWork.some(
                    (link) => link.type === result.type && link.id === result.id,
                  )
                ) {
                  setLinkedWork([...linkedWork, result]);
                }
              });
            }}
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
            placeholder="Reply in thread"
            value={body}
          />
          <Button
            aria-label="Send reply"
            disabled={
              (!body.trim() && !attachmentFiles.length && !linkedWork.length) ||
              sending ||
              !root
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
      </div>
    </aside>
  );
}
