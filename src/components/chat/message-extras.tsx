"use client";

import { useState } from "react";
import { Check, ShieldAlert } from "lucide-react";

import { MessageWorkActions } from "@/components/chat/message-work-actions";
import { PinMessageButton } from "@/components/chat/pin-message-button";
import { SaveWorkspaceItemButton } from "@/components/saved/save-workspace-item-button";
import { Button } from "@/components/ui/button";
import type { WorkspaceMessage } from "@/lib/chat/types";

export function MessageExtras({
  authorName,
  body,
  currentProfileId,
  message,
  permalink,
}: {
  authorName: string;
  body: string;
  currentProfileId?: string;
  message: WorkspaceMessage;
  permalink: string;
}) {
  const [signals, setSignals] = useState(message.signals ?? []);

  async function toggleSignal(
    signal: WorkspaceMessage["signals"][number]["signal"],
  ) {
    if (!currentProfileId) return;
    const existing = signals.find((item) => item.signal === signal);
    const active = !existing?.profileIds.includes(currentProfileId);
    setSignals((current) => {
      const currentSignal = current.find((item) => item.signal === signal);
      if (!currentSignal) {
        return active ? [...current, { signal, profileIds: [currentProfileId] }] : current;
      }
      return current.map((item) =>
        item.signal === signal
          ? {
              ...item,
              profileIds: active
                ? [...new Set([...item.profileIds, currentProfileId])]
                : item.profileIds.filter((id) => id !== currentProfileId),
            }
          : item,
      );
    });
    const response = await fetch("/api/workspace-chat/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: message.id, signal, active }),
    });
    if (!response.ok) setSignals(message.signals ?? []);
  }

  return (
    <>
      <MessageWorkActions
        body={body}
        conversationId={message.conversationId}
        messageId={message.id}
      />
      <SaveWorkspaceItemButton
        href={permalink}
        sourceId={message.id}
        sourceType="chat_message"
        title={`${authorName}: ${body.slice(0, 120)}`}
      />
      <PinMessageButton
        conversationId={message.conversationId}
        messageId={message.id}
        title={body.slice(0, 240)}
      />
      {currentProfileId && (
        <>
          <SignalButton
            active={isSignalActive(signals, "acknowledged", currentProfileId)}
            count={signalCount(signals, "acknowledged")}
            icon={Check}
            label="Ack"
            onClick={() => void toggleSignal("acknowledged")}
          />
          <SignalButton
            active={isSignalActive(signals, "approved", currentProfileId)}
            count={signalCount(signals, "approved")}
            icon={Check}
            label="Approve"
            onClick={() => void toggleSignal("approved")}
          />
          <SignalButton
            active={isSignalActive(signals, "blocked", currentProfileId)}
            count={signalCount(signals, "blocked")}
            icon={ShieldAlert}
            label="Blocked"
            onClick={() => void toggleSignal("blocked")}
          />
        </>
      )}
    </>
  );
}

function SignalButton({
  active,
  count,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: typeof Check;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className="h-7 gap-1 px-2 text-xs"
      onClick={onClick}
      size="sm"
      variant={active ? "secondary" : "ghost"}
    >
      <Icon className="size-3.5" />
      {label}
      {count > 0 && <span>{count}</span>}
    </Button>
  );
}

function signalCount(
  signals: WorkspaceMessage["signals"],
  signal: WorkspaceMessage["signals"][number]["signal"],
) {
  return signals.find((item) => item.signal === signal)?.profileIds.length ?? 0;
}

function isSignalActive(
  signals: WorkspaceMessage["signals"],
  signal: WorkspaceMessage["signals"][number]["signal"],
  profileId: string,
) {
  return Boolean(
    signals
      .find((item) => item.signal === signal)
      ?.profileIds.includes(profileId),
  );
}
