"use client";

import { useEffect, useState } from "react";
import { FileSearch, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ConversationBrief as ConversationBriefData } from "@/lib/operations/types";

export function ConversationBrief({ conversationId }: { conversationId: string }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState<ConversationBriefData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(
      `/api/briefs?conversationId=${encodeURIComponent(conversationId)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          brief?: ConversationBriefData | null;
        };
        if (response.ok) setBrief(result.brief ?? null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [conversationId, open]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/briefs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const result = (await response.json()) as {
        brief?: ConversationBriefData;
        error?: string;
      };
      if (!response.ok || !result.brief) {
        throw new Error(result.error ?? "Unable to generate a catch-up brief.");
      }
      setBrief(result.brief);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to generate a catch-up brief.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="ml-auto" size="sm" variant="outline">
          <FileSearch />
          Catch up
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Conversation brief</DialogTitle>
          <DialogDescription>
            A source-grounded view of decisions, actions, blockers, and open questions.
          </DialogDescription>
        </DialogHeader>
        {brief ? (
          <div className="space-y-5">
            <p className="whitespace-pre-wrap text-sm leading-6">{brief.summary}</p>
            <BriefSection items={brief.decisions} label="Decisions" />
            <BriefSection items={brief.actions} label="Actions" />
            <BriefSection items={brief.blockers} label="Blockers" />
            <BriefSection items={brief.openQuestions} label="Open questions" />
            {!!brief.citations.length && (
              <section>
                <h3 className="text-sm font-semibold">Sources</h3>
                <div className="mt-2 space-y-2">
                  {brief.citations.map((citation) => (
                    <Link
                      className="block rounded-lg border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
                      href={citation.href}
                      key={citation.messageId}
                    >
                      {citation.excerpt}
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <div className="flex items-center justify-between border-t pt-4">
              <Badge variant="secondary">
                {brief.sourceMessageCount} source messages
              </Badge>
              <Button disabled={loading} onClick={() => void generate()} size="sm">
                {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                Refresh brief
              </Button>
            </div>
          </div>
        ) : (
          <div className="py-10 text-center">
            <FileSearch className="mx-auto size-9 text-muted-foreground" />
            <p className="mt-3 font-medium">No brief yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Generate a cited summary without changing or acting on the conversation.
            </p>
            <Button
              className="mt-5"
              disabled={loading}
              onClick={() => void generate()}
            >
              {loading ? <LoaderCircle className="animate-spin" /> : <FileSearch />}
              Generate catch-up
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function BriefSection({ items, label }: { items: string[]; label: string }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">{label}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${label}-${index}-${item.slice(0, 20)}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
