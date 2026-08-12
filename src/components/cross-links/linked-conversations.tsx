"use client";

import { Link2, LoaderCircle, MessageCircle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  WorkBacklink,
  WorkLinkKind,
} from "@/lib/cross-links/types";

export function LinkedConversations({
  workType,
  workId,
  compact = false,
}: {
  workType: WorkLinkKind;
  workId: string;
  compact?: boolean;
}) {
  const [backlinks, setBacklinks] = useState<WorkBacklink[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function removeLink(linkId: string) {
    setRemovingId(linkId);
    const response = await fetch(
      `/api/cross-links?linkId=${encodeURIComponent(linkId)}`,
      { method: "DELETE" },
    );
    if (response.ok) {
      setBacklinks((current) => current.filter((item) => item.id !== linkId));
    }
    setRemovingId(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ workType, workId });
    void fetch(`/api/cross-links?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { backlinks?: WorkBacklink[] };
        if (response.ok) setBacklinks(body.backlinks ?? []);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        console.warn("Unable to load linked conversations:", error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workId, workType]);

  if (!loading && !backlinks.length) return null;

  const content = (
    <>
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Loading linked conversations…
        </p>
      ) : (
        <div className="space-y-2">
          {backlinks.map((backlink) => (
            <div className="flex items-center gap-1" key={backlink.id}>
              <Button
                asChild
                className="h-auto min-w-0 flex-1 justify-start px-3 py-2 text-left"
                variant="ghost"
              >
                <Link href={backlink.href}>
                  <MessageCircle className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {backlink.attachmentName ??
                        backlink.excerpt ??
                        backlink.conversationName}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {backlink.chatType.replace("_", " ")} ·{" "}
                      {new Date(backlink.createdAt).toLocaleString()}
                    </span>
                  </span>
                </Link>
              </Button>
              <Button
                aria-label="Remove conversation link"
                disabled={removingId === backlink.id}
                onClick={() => void removeLink(backlink.id)}
                size="icon-sm"
                variant="ghost"
              >
                {removingId === backlink.id ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <X />
                )}
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <section className="mt-3 rounded-lg border bg-muted/20 p-3">
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <Link2 className="size-3.5" />
          Linked conversations
        </h4>
        {content}
      </section>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Link2 className="size-4" />
          Linked conversations
        </CardTitle>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
