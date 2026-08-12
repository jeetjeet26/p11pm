"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Clock3,
  Headphones,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface UnifiedInboxItem {
  id: string;
  kind: string;
  title: string;
  body?: string;
  href: string;
  priority: string;
  createdAt: string;
  readAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  snoozedUntil?: string;
  source: "persisted" | "attention" | "chat" | "support";
}

export function InboxView() {
  const [items, setItems] = useState<UnifiedInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "open" | "chat" | "support" | "work" | "done"
  >("open");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox");
      const body = (await response.json()) as {
        items?: UnifiedInboxItem[];
        error?: string;
      };
      if (!response.ok || !body.items) {
        throw new Error(body.error ?? "Unable to load your inbox.");
      }
      setItems(body.items);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load your inbox.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "done") return Boolean(item.completedAt);
        if (item.completedAt) return false;
        if (filter === "chat") return item.source === "chat";
        if (filter === "support") return item.source === "support";
        if (filter === "work") {
          return item.source !== "chat" && item.source !== "support";
        }
        return true;
      }),
    [filter, items],
  );

  async function update(
    item: UnifiedInboxItem,
    action: "read" | "acknowledge" | "complete" | "snooze" | "reopen",
  ) {
    if (item.source !== "persisted") return;
    setWorkingId(item.id);
    setError(null);
    try {
      const response = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          action,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update this inbox item.");
      }
      window.dispatchEvent(new Event("inbox:changed"));
      await load();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update this inbox item.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Bell className="size-5" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
            <p className="mt-1 text-muted-foreground">
              Messages, assignments, approvals, deadlines, and blockers in one queue.
            </p>
          </div>
        </div>
      </header>

      <nav aria-label="Inbox filters" className="flex flex-wrap gap-2">
        {(["open", "chat", "support", "work", "done"] as const).map((value) => (
          <Button
            key={value}
            onClick={() => setFilter(value)}
            size="sm"
            variant={filter === value ? "default" : "outline"}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </nav>

      {loading ? (
        <Card>
          <CardContent className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Building your attention queue…
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button className="mt-4" onClick={() => void load()} variant="outline">
              <RotateCcw />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="divide-y p-0">
            {visible.map((item) => (
              <article
                className={cn(
                  "grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]",
                  !item.readAt && item.source === "persisted" && "bg-primary/5",
                )}
                key={item.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.priority === "urgent" ? "destructive" : "secondary"}>
                      {item.kind.replaceAll("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </div>
                  <Link
                    className="mt-2 block font-medium hover:text-primary hover:underline"
                    href={item.href}
                    onClick={() => void update(item, "read")}
                  >
                    {item.title}
                  </Link>
                  {item.body && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.body}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 self-center">
                  {item.source === "chat" && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={item.href}>
                        <MessageCircle />
                        Open
                      </Link>
                    </Button>
                  )}
                  {item.source === "support" && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={item.href}>
                        <Headphones />
                        Open
                      </Link>
                    </Button>
                  )}
                  {item.source === "persisted" && !item.completedAt && (
                    <>
                      <Button
                        aria-label="Snooze for one day"
                        disabled={workingId === item.id}
                        onClick={() => void update(item, "snooze")}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Clock3 />
                      </Button>
                      <Button
                        aria-label="Acknowledge"
                        disabled={workingId === item.id}
                        onClick={() => void update(item, "acknowledge")}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Check />
                      </Button>
                      <Button
                        aria-label="Complete"
                        disabled={workingId === item.id}
                        onClick={() => void update(item, "complete")}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <CheckCheck />
                      </Button>
                    </>
                  )}
                  {item.source === "persisted" && item.completedAt && (
                    <Button
                      disabled={workingId === item.id}
                      onClick={() => void update(item, "reopen")}
                      size="sm"
                      variant="outline"
                    >
                      <RotateCcw />
                      Reopen
                    </Button>
                  )}
                </div>
              </article>
            ))}
            {!visible.length && (
              <div className="p-12 text-center">
                <CheckCheck className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium">Nothing needs attention here</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  New mentions, assignments, approvals, and deadlines will appear
                  automatically.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
