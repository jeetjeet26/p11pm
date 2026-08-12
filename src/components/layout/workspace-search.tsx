"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Building2,
  CheckCircle2,
  File,
  FileText,
  Flag,
  FolderKanban,
  Clock3,
  CreditCard,
  LoaderCircle,
  MessageSquareText,
  Headphones,
  ReceiptText,
  Repeat2,
  Search,
  SquareCheckBig,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  kind:
    | "project"
    | "issue"
    | "comment"
    | "message"
    | "doc"
    | "file"
    | "folder"
    | "milestone"
    | "history"
    | "chat"
    | "decision"
    | "client"
    | "contact"
    | "retainer"
    | "invoice"
    | "activity"
    | "payment"
    | "time"
    | "support"
    | "prospect"
    | "blocker"
    | "approval"
    | "automation"
    | "delivery";
  title: string;
  context?: string;
  href: string;
}

const icons = {
  project: FolderKanban,
  issue: SquareCheckBig,
  comment: MessageSquareText,
  message: MessageSquareText,
  doc: FileText,
  file: File,
  folder: FolderKanban,
  milestone: Flag,
  history: Archive,
  chat: MessageSquareText,
  decision: Flag,
  client: Building2,
  contact: Building2,
  retainer: Repeat2,
  invoice: ReceiptText,
  activity: Activity,
  payment: CreditCard,
  time: Clock3,
  support: Headphones,
  prospect: Building2,
  blocker: AlertTriangle,
  approval: CheckCircle2,
  automation: Bot,
  delivery: AlertTriangle,
};

export function WorkspaceSearch() {
  const router = useRouter();
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    function closeOnOutsideClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", focusSearch);
    window.addEventListener("mousedown", closeOnOutsideClick);
    return () => {
      window.removeEventListener("keydown", focusSearch);
      window.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      const timer = window.setTimeout(() => {
        setResults([]);
        setLoading(false);
        setError(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as {
            results?: SearchResult[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(body.error ?? "Search failed.");
          }
          setResults(body.results ?? []);
          setActiveIndex(0);
          setOpen(true);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted) return;
          setError(
            searchError instanceof Error ? searchError.message : "Search failed.",
          );
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function navigate(result: SearchResult) {
    setOpen(false);
    setQuery("");
    if (result.kind === "file") {
      window.location.assign(result.href);
      return;
    }
    router.push(result.href);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || !results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(
        (index) => (index - 1 + results.length) % results.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) navigate(selected);
    }
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-activedescendant={
          open && results[activeIndex]
            ? `${listId}-${results[activeIndex].kind}-${results[activeIndex].id}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-label="Search projects, support, issues, updates, documents, files, milestones, and history"
        className="h-9 bg-muted/60 pl-9 pr-16"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search work…"
        ref={inputRef}
        role="combobox"
        value={query}
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:block">
        ⌘K
      </kbd>
      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl">
          <div
            aria-label="Search results"
            className="max-h-[min(70dvh,32rem)] overflow-y-auto p-1.5"
            id={listId}
            role="listbox"
          >
            {loading && (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Searching workspace…
              </div>
            )}
            {!loading &&
              results.map((result, index) => {
                const Icon = icons[result.kind];
                return (
                  <button
                    aria-selected={activeIndex === index}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                      activeIndex === index
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted",
                    )}
                    id={`${listId}-${result.kind}-${result.id}`}
                    key={`${result.kind}-${result.id}`}
                    onClick={() => navigate(result)}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                    type="button"
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {result.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {result.context ?? result.kind}
                      </span>
                    </span>
                  </button>
                );
              })}
            {!loading && error && (
              <p className="px-4 py-6 text-center text-sm text-destructive">
                {error}
              </p>
            )}
            {!loading && !error && !results.length && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No matching workspace records found.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
