"use client";

import { useEffect, useState } from "react";
import {
  Download,
  File,
  Link2,
  MessageCircle,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatProfile, WorkspaceMessage } from "@/lib/chat/types";
import { chatEntityHref } from "@/lib/cross-links/urls";

const MessageExtras = dynamic(() =>
  import("@/components/chat/message-extras").then(
    (module) => module.MessageExtras,
  ),
);

function formatMessageTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function canPreviewImage(mimeType?: string) {
  return ["image/gif", "image/jpeg", "image/png", "image/webp"].includes(
    mimeType ?? "",
  );
}

export function MessageItem({
  message,
  author,
  currentProfileId,
  onOpenThread,
}: {
  message: WorkspaceMessage;
  author?: ChatProfile;
  currentProfileId?: string;
  onOpenThread?: () => void;
}) {
  const [body, setBody] = useState(message.body);
  const [draft, setDraft] = useState(message.body);
  const [editing, setEditing] = useState(false);
  const [deleted, setDeleted] = useState(Boolean(message.deletedAt));
  const [working, setWorking] = useState(false);
  const ownMessage = currentProfileId === message.senderId;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBody(message.body);
      setDraft(message.body);
      setDeleted(Boolean(message.deletedAt));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function saveEdit() {
    if (!draft.trim() || draft.trim() === body) {
      setEditing(false);
      return;
    }
    setWorking(true);
    const response = await fetch("/api/workspace-chat/messages", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: message.id, body: draft.trim() }),
    });
    if (response.ok) {
      setBody(draft.trim());
      setEditing(false);
    }
    setWorking(false);
  }

  async function deleteMessage() {
    setWorking(true);
    const response = await fetch("/api/workspace-chat/messages", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: message.id }),
    });
    if (response.ok) {
      setDeleted(true);
      setBody("Message deleted");
    }
    setWorking(false);
  }

  const permalink = chatEntityHref({
    conversationId: message.conversationId,
    rootMessageId: message.parentMessageId,
    messageId: message.id,
  });
  return (
    <article className="flex gap-3" id={`chat-message-${message.id}`}>
      <Avatar className="mt-0.5 size-9 shrink-0">
        <AvatarImage alt="" src={author?.avatarUrl} />
        <AvatarFallback className="text-[10px]">
          {author?.initials ?? "P11"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">
            {author?.fullName ?? "P11 teammate"}
          </span>
          <Link
            aria-label="Copyable link to this message"
            className="text-[11px] text-muted-foreground hover:underline"
            href={permalink}
          >
            <time dateTime={message.createdAt}>
              {formatMessageTime(message.createdAt)}
            </time>
          </Link>
        </div>
        {editing ? (
          <div className="mt-2 flex gap-2">
            <Input
              aria-label="Edit message"
              disabled={working}
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
            <Button disabled={working || !draft.trim()} onClick={() => void saveEdit()} size="sm">
              Save
            </Button>
            <Button disabled={working} onClick={() => setEditing(false)} size="sm" variant="ghost">
              Cancel
            </Button>
          </div>
        ) : (
          <p
            className={`mt-1 whitespace-pre-wrap break-words text-sm leading-6 ${deleted ? "italic text-muted-foreground" : ""}`}
          >
            {body}
            {(message.editedAt || body !== message.body) && !deleted ? (
              <span className="ml-1 text-[10px] text-muted-foreground">(edited)</span>
            ) : null}
          </p>
        )}
        {!!message.links?.length && (
          <div className="mt-2 grid max-w-xl gap-2 sm:grid-cols-2">
            {message.links.map((link) => (
              <Link
                className="group rounded-lg border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50"
                href={link.work.href}
                key={link.id}
              >
                <span className="flex items-start gap-2">
                  <Link2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">
                      {link.work.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {link.work.context}
                    </span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
        {!!message.attachments.length && (
          <div className="mt-2 grid max-w-xl gap-2 sm:grid-cols-2">
            {message.attachments.map((attachment) => {
              const href = `/api/workspace-chat/attachments/${attachment.id}`;
              return (
                <a
                  className="group overflow-hidden rounded-lg border bg-muted/20 transition-colors hover:bg-muted/50"
                  href={href}
                  id={`chat-attachment-${attachment.id}`}
                  key={attachment.id}
                >
                  {canPreviewImage(attachment.mimeType) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt={attachment.fileName}
                      className="max-h-56 w-full object-cover"
                      loading="lazy"
                      src={`${href}?inline=1`}
                    />
                  )}
                  <span className="flex items-center gap-2 px-3 py-2">
                    <File className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {attachment.fileName}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {formatFileSize(attachment.sizeBytes)}
                      </span>
                    </span>
                    <Download className="size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </span>
                </a>
              );
            })}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {onOpenThread && (
            <Button
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={onOpenThread}
              size="sm"
              variant="ghost"
            >
              <MessageCircle className="size-3.5" />
              {message.replyCount
                ? `${message.replyCount} ${message.replyCount === 1 ? "reply" : "replies"}`
                : "Reply"}
              {message.threadUnreadCount > 0 && (
                <Badge className="ml-1 h-5 min-w-5 justify-center px-1.5 text-[10px]">
                  {message.threadUnreadCount > 99
                    ? "99+"
                    : message.threadUnreadCount}
                </Badge>
              )}
            </Button>
          )}
          {!deleted && (
            <MessageExtras
              authorName={author?.fullName ?? "P11 teammate"}
              body={body}
              currentProfileId={currentProfileId}
              message={message}
              permalink={permalink}
            />
          )}
          {ownMessage && !deleted && (
            <>
              <Button
                aria-label="Edit message"
                className="h-7 px-2 text-xs text-muted-foreground"
                disabled={working}
                onClick={() => setEditing(true)}
                size="sm"
                variant="ghost"
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                aria-label="Delete message"
                className="h-7 px-2 text-xs text-muted-foreground"
                disabled={working}
                onClick={() => void deleteMessage()}
                size="sm"
                variant="ghost"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
