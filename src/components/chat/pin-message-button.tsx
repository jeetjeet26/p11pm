"use client";

import { useState } from "react";
import { Pin, PinOff } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PinMessageButton({
  conversationId,
  messageId,
  title,
}: {
  conversationId: string;
  messageId: string;
  title: string;
}) {
  const [pinned, setPinned] = useState(false);
  const [working, setWorking] = useState(false);

  async function toggle() {
    setWorking(true);
    const response = await fetch(
      pinned
        ? `/api/workspace-chat/pins?messageId=${encodeURIComponent(messageId)}`
        : "/api/workspace-chat/pins",
      {
        method: pinned ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: pinned ? undefined : JSON.stringify({ conversationId, messageId, title }),
      },
    );
    if (response.ok) setPinned(!pinned);
    setWorking(false);
  }

  return (
    <Button
      aria-label={pinned ? "Remove pin" : "Pin for conversation"}
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
      disabled={working}
      onClick={() => void toggle()}
      size="sm"
      variant="ghost"
    >
      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
      {pinned ? "Pinned" : "Pin"}
    </Button>
  );
}
