"use client";

import { Link2, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";

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
import { Input } from "@/components/ui/input";
import type { CrossLinkSearchResult } from "@/lib/cross-links/types";
import type { WorkLinkKind } from "@/lib/cross-links/types";

export function EntityLinkPicker({
  scope,
  value,
  onChange,
  projectId,
  disabled,
}: {
  scope: "work" | "chat";
  value: CrossLinkSearchResult[];
  onChange: (value: CrossLinkSearchResult[]) => void;
  projectId?: string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CrossLinkSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: query.trim(),
        scope,
      });
      if (projectId) params.set("projectId", projectId);
      setLoading(true);
      setError("");
      void fetch(`/api/cross-links/search?${params}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            results?: CrossLinkSearchResult[];
            error?: string;
          };
          if (!response.ok) throw new Error(body.error ?? "Search failed.");
          setResults(body.results ?? []);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            searchError instanceof Error ? searchError.message : "Search failed.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, projectId, query, scope]);

  function add(result: CrossLinkSearchResult) {
    if (!value.some((item) => item.scope === result.scope && item.id === result.id)) {
      onChange([...value, result]);
    }
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="space-y-2">
      {!!value.length && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item) => (
            <Badge className="gap-1 py-1" key={`${item.scope}-${item.id}`} variant="secondary">
              <Link2 className="size-3" />
              <span className="max-w-48 truncate">{item.title}</span>
              <Button
                aria-label={`Remove ${item.title}`}
                className="-mr-1 size-5 rounded-full p-0"
                onClick={() =>
                  onChange(value.filter((selected) => selected !== item))
                }
                size="icon"
                type="button"
                variant="ghost"
              >
                <X className="size-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <Dialog
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setQuery("");
            setResults([]);
            setError("");
          }
        }}
        open={open}
      >
        <DialogTrigger asChild>
          <Button disabled={disabled} size="sm" type="button" variant="ghost">
            <Link2 />
            Link {scope === "work" ? "work" : "chat"}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Link {scope === "work" ? "workspace work" : "a conversation"}
            </DialogTitle>
            <DialogDescription>
              Search only shows records and conversations you can access.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-controls={listId}
              aria-expanded={open}
              aria-label={`Search ${scope === "work" ? "work" : "chat"}`}
              autoFocus
              className="pl-9"
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                if (nextQuery.trim().length < 2) {
                  setResults([]);
                  setLoading(false);
                  setError("");
                }
              }}
              placeholder={
                scope === "work"
                  ? "Search projects, issues, files…"
                  : "Search conversations, messages, files…"
              }
              role="combobox"
              value={query}
            />
          </div>
          <div
            aria-label="Link search results"
            className="max-h-80 space-y-1 overflow-y-auto"
            id={listId}
            role="listbox"
          >
            {loading && (
              <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Searching…
              </p>
            )}
            {!loading &&
              results.map((result) => (
                <Button
                  className="h-auto w-full justify-start px-3 py-2.5 text-left"
                  key={`${result.scope}-${result.id}`}
                  onClick={() => add(result)}
                  role="option"
                  type="button"
                  variant="ghost"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {result.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {result.context}
                    </span>
                  </span>
                </Button>
              ))}
            {!loading && query.trim().length >= 2 && !results.length && !error && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No accessible results.
              </p>
            )}
            {error && (
              <p className="py-6 text-center text-sm text-destructive">{error}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export async function resolvePastedLink(
  text: string,
  scope: "work" | "chat",
): Promise<CrossLinkSearchResult | undefined> {
  const match = text.match(/https?:\/\/[^\s]+|\/(?:projects|archive|chat|api\/files)\/[^\s]+/);
  if (!match) return undefined;
  const response = await fetch("/api/cross-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "resolve", scope, url: match[0] }),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as {
    result?: CrossLinkSearchResult;
  };
  return body.result;
}

export async function createChatCrossLinks(
  targets: CrossLinkSearchResult[],
  workType: WorkLinkKind,
  workId: string,
) {
  await Promise.all(
    targets.map(async (target) => {
      const response = await fetch("/api/cross-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "link",
          chatType: target.type,
          chatId: target.id,
          workType,
          workId,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Could not create a chat link.");
      }
    }),
  );
}
