import { Download, File, MessageCircle } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatProfile, WorkspaceMessage } from "@/lib/chat/types";

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
  onOpenThread,
}: {
  message: WorkspaceMessage;
  author?: ChatProfile;
  onOpenThread?: () => void;
}) {
  return (
    <article className="flex gap-3">
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
          <time
            className="text-[11px] text-muted-foreground"
            dateTime={message.createdAt}
          >
            {formatMessageTime(message.createdAt)}
          </time>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
          {message.body}
        </p>
        {!!message.attachments.length && (
          <div className="mt-2 grid max-w-xl gap-2 sm:grid-cols-2">
            {message.attachments.map((attachment) => {
              const href = `/api/workspace-chat/attachments/${attachment.id}`;
              return (
                <a
                  className="group overflow-hidden rounded-lg border bg-muted/20 transition-colors hover:bg-muted/50"
                  href={href}
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
        {onOpenThread && (
          <Button
            className="mt-1.5 h-7 gap-1.5 px-2 text-xs text-muted-foreground"
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
      </div>
    </article>
  );
}
