"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ChevronRight,
  CircleDashed,
  Filter,
  LayoutList,
  LoaderCircle,
  Plus,
  Rows3,
  Search,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import {
  IssueDetail,
  type IssueDetailData,
  type IssueTransition,
} from "@/components/issues/issue-detail";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectTodosData } from "@/lib/project-data/contracts";
import type {
  Profile,
  Project,
  Todo,
  TodoComment,
  TodoList,
  TodoSubtask,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type IssueView = "issues" | "board";

export interface IssueFilters {
  query: string;
  status: string;
  priority: string;
  label: string;
  assignee: string;
  due: string;
  scope: string;
}

const defaultFilters: IssueFilters = {
  query: "",
  status: "open_work",
  priority: "all",
  label: "",
  assignee: "all",
  due: "all",
  scope: "current",
};

interface IssuePageData extends ProjectTodosData {
  hasMore?: boolean;
  nextCursor?: ProjectTodosData["nextCursor"] | string;
  totalCount?: number;
}

export function IssueWorkspace({
  initialFilters,
  initialIssueId,
  profiles,
  project,
  view,
}: {
  initialFilters?: Partial<IssueFilters>;
  initialIssueId?: string;
  profiles: Profile[];
  project: Project;
  view: IssueView;
}) {
  const [filters, setFilters] = useState<IssueFilters>({
    ...defaultFilters,
    ...initialFilters,
  });
  const [todos, setTodos] = useState<Todo[]>([]);
  const todosRef = useRef<Todo[]>([]);
  const [lists, setLists] = useState<TodoList[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState(initialIssueId);
  const [detail, setDetail] = useState<IssueDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialIssueId));
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailCacheRef = useRef(new Map<string, IssueDetailData>());
  const isDesktop = useMediaQuery("(min-width: 80rem)");
  const restoredScroll = useRef(false);
  const scrollStorageKey = `project-issues-scroll:${project.id}:${view}`;

  const loadPage = useCallback(
    async ({
      append = false,
      cursor,
      signal,
    }: {
      append?: boolean;
      cursor?: string;
      signal?: AbortSignal;
    } = {}) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setListError(null);
      const params = new URLSearchParams({
        projectId: project.id,
        limit: "75",
        scope: filters.scope,
      });
      if (filters.query.trim()) params.set("q", filters.query.trim());
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.priority !== "all") params.set("priority", filters.priority);
      if (filters.label.trim()) params.set("label", filters.label.trim());
      if (filters.assignee !== "all") params.set("assignee", filters.assignee);
      if (filters.due !== "all") params.set("due", filters.due);
      if (cursor) params.set("cursor", cursor);

      try {
        const response = await fetch(`/api/todos?${params}`, { signal });
        const body = (await response.json()) as
          | IssuePageData
          | { error?: string };
        if (!response.ok || !("todos" in body)) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : "Unable to load project issues.",
          );
        }
        const page = body as IssuePageData;
        setLists(page.todoLists);
        setTodos((current) =>
          append
            ? mergeUniqueTodos(current, page.todos)
            : page.todos.map(normalizeTodo),
        );
        const cursorValue = page.nextCursor;
        setNextCursor(
          typeof cursorValue === "string"
            ? cursorValue
            : cursorValue
              ? encodeCursor(cursorValue)
              : undefined,
        );
        setHasMore(
          page.hasMore ??
            Boolean(cursorValue && page.todos.length >= 75),
        );
        setTotalCount(page.totalCount);
      } catch (error) {
        if (signal?.aborted) return;
        setListError(
          error instanceof Error ? error.message : "Unable to load project issues.",
        );
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filters, project.id],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadPage({ signal: controller.signal });
    }, filters.query ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPage, filters.query]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSelectedIssueId(initialIssueId), 0);
    return () => window.clearTimeout(timer);
  }, [initialIssueId]);

  useEffect(() => {
    function handlePopState() {
      const issueId = issueIdFromProjectPath(
        window.location.pathname,
        project.id,
      );
      if (issueId === null) return;

      setFilters(filtersFromSearchParams(window.location.search));
      setSelectedIssueId(issueId);
      if (!issueId) {
        setDetail(null);
        setDetailError(null);
        setDetailLoading(false);
        return;
      }

      const cached = detailCacheRef.current.get(issueId);
      const summary = todosRef.current.find((todo) => todo.id === issueId);
      setDetailLoading(!cached);
      setDetail(
        cached ??
          (summary
            ? { todo: summary, subtasks: [], comments: [], transitions: [] }
            : null),
      );
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [project.id]);

  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  useEffect(() => {
    if (loading || selectedIssueId || restoredScroll.current) return;
    restoredScroll.current = true;
    const stored = window.sessionStorage.getItem(scrollStorageKey);
    const position = stored ? Number(stored) : 0;
    if (!Number.isFinite(position) || position <= 0) return;
    window.requestAnimationFrame(() => window.scrollTo({ top: position }));
  }, [loading, scrollStorageKey, selectedIssueId]);

  useEffect(() => {
    if (!selectedIssueId) {
      const timer = window.setTimeout(() => {
        setDetail(null);
        setDetailError(null);
        setDetailLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const cached = detailCacheRef.current.get(selectedIssueId);
    if (cached) {
      const timer = window.setTimeout(() => {
        setDetail(cached);
        setDetailError(null);
        setDetailLoading(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setDetailLoading(true);
      setDetailError(null);
      void fetch(`/api/todos/${encodeURIComponent(selectedIssueId)}`, {
        signal: controller.signal,
      })
      .then(async (response) => {
        const body = (await response.json()) as
          | { detail?: unknown; error?: string }
          | Record<string, unknown>;
        if (!response.ok) {
          throw new Error(
            "error" in body && typeof body.error === "string"
              ? body.error
              : "Unable to load issue details.",
          );
        }
        const selectedSummary = todosRef.current.find(
          (todo) => todo.id === selectedIssueId,
        );
        const nextDetail = normalizeDetail(
          "detail" in body && body.detail ? body.detail : body,
          selectedSummary,
        );
        detailCacheRef.current.set(selectedIssueId, nextDetail);
        setDetail(nextDetail);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const selectedSummary = todosRef.current.find(
          (todo) => todo.id === selectedIssueId,
        );
        if (selectedSummary) {
          setDetail({
            todo: selectedSummary,
            subtasks: [],
            comments: [],
            transitions: [],
          });
        }
        setDetailError(
          error instanceof Error ? error.message : "Unable to load issue details.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedIssueId]);

  function updateFilters(changes: Partial<IssueFilters>) {
    const next = { ...filters, ...changes };
    setLoading(true);
    setFilters(next);
    window.history.replaceState(
      null,
      "",
      issueWorkspaceHref(project.id, selectedIssueId, next, view),
    );
  }

  function selectIssue(todo: Todo) {
    window.sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
    const cached = detailCacheRef.current.get(todo.id);
    setSelectedIssueId(todo.id);
    setDetailError(null);
    setDetailLoading(!cached);
    setDetail((current) =>
      current?.todo.id === todo.id
        ? current
        : (cached ?? {
            todo,
            subtasks: [],
            comments: [],
            transitions: [],
          }),
    );
    const href = issueHref(project.id, todo.id, filters, view);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.pushState(null, "", href);
    }
  }

  function closeIssue() {
    setSelectedIssueId(undefined);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    const href = issueWorkspaceHref(project.id, undefined, filters, view);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.pushState(null, "", href);
    }
  }

  function handleDetailChange(nextDetail: IssueDetailData) {
    detailCacheRef.current.set(nextDetail.todo.id, nextDetail);
    setDetail(nextDetail);
  }

  function handleTodoChange(updated: Todo) {
    setTodos((current) =>
      current.map((todo) => (todo.id === updated.id ? updated : todo)),
    );
    const cached = detailCacheRef.current.get(updated.id);
    if (cached) {
      detailCacheRef.current.set(updated.id, { ...cached, todo: updated });
    }
    setDetail((current) =>
      current?.todo.id === updated.id ? { ...current, todo: updated } : current,
    );
  }

  const summary = useMemo(() => {
    const open = todos.filter(
      (todo) => todo.status !== "completed" && todo.status !== "cancelled",
    );
    return {
      loaded: todos.length,
      open: open.length,
      blocked: open.filter((todo) => todo.status === "blocked").length,
      overdue: open.filter(isOverdue).length,
      unassigned: open.filter(
        (todo) => !todo.assigneeId && !todo.assigneeIds?.length,
      ).length,
    };
  }, [todos]);

  return (
    <div className="space-y-5" data-testid="issue-workspace">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <IssueMetric label="Visible work" value={totalCount ?? summary.open} />
        <IssueMetric alert label="Overdue" value={summary.overdue} />
        <IssueMetric alert label="Blocked" value={summary.blocked} />
        <IssueMetric label="Unassigned" value={summary.unassigned} />
      </section>

      <Card className="gap-0 py-0">
        <CardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(6,minmax(120px,auto))_auto]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search issues"
                className="pl-9"
                onChange={(event) =>
                  updateFilters({ query: event.target.value })
                }
                placeholder="Search key, title, or description"
                value={filters.query}
              />
            </div>
            <FilterSelect
              label="Status"
              onChange={(status) => updateFilters({ status })}
              options={[
                ["open_work", "Open work"],
                ["all", "Any status"],
                ["open", "To do"],
                ["in_progress", "In progress"],
                ["blocked", "Blocked"],
                ["review", "Review"],
                ["completed", "Done"],
                ["cancelled", "Cancelled"],
              ]}
              value={filters.status}
            />
            <FilterSelect
              label="Priority"
              onChange={(priority) => updateFilters({ priority })}
              options={[
                ["all", "Any priority"],
                ["urgent", "Urgent"],
                ["high", "High"],
                ["medium", "Medium"],
                ["low", "Low"],
              ]}
              value={filters.priority}
            />
            <Input
              aria-label="Filter by label"
              onChange={(event) =>
                updateFilters({ label: event.target.value })
              }
              placeholder="Label"
              value={filters.label}
            />
            <FilterSelect
              label="Assignee"
              onChange={(assignee) => updateFilters({ assignee })}
              options={[
                ["all", "Anyone"],
                ["unassigned", "Unassigned"],
                ...profiles.map(
                  (profile) => [profile.id, profile.fullName] as [string, string],
                ),
              ]}
              value={filters.assignee}
            />
            <FilterSelect
              label="Due"
              onChange={(due) => updateFilters({ due })}
              options={[
                ["all", "Any due date"],
                ["overdue", "Overdue"],
                ["due_soon", "Due soon"],
                ["no_due_date", "No due date"],
              ]}
              value={filters.due}
            />
            <FilterSelect
              label="Scope"
              onChange={(scope) => updateFilters({ scope })}
              options={[
                ["current", "Current + triage"],
                ["active", "Active only"],
                ["triage", "Needs triage"],
                ["historical", "Historical"],
                ["all", "All records"],
              ]}
              value={filters.scope}
            />
            <CreateIssueDialog
              lists={lists}
              onCreated={(todo) => {
                setTodos((current) => [todo, ...current]);
                selectIssue(todo);
              }}
              profiles={profiles}
              project={project}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {summary.loaded} loaded
              {typeof totalCount === "number" ? ` of ${totalCount}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Filter className="size-3.5" />
              Filters are saved in the URL
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,480px)]">
        <section className="min-w-0">
          {loading ? (
            <IssueLoading />
          ) : listError ? (
            <IssueError message={listError} onRetry={() => void loadPage()} />
          ) : view === "board" ? (
            <IssueBoard
              filters={filters}
              onSelect={selectIssue}
              onTodoChange={handleTodoChange}
              profiles={profiles}
              project={project}
              selectedIssueId={selectedIssueId}
              todos={todos}
            />
          ) : (
            <IssueList
              filters={filters}
              onSelect={selectIssue}
              onTodoChange={handleTodoChange}
              profiles={profiles}
              project={project}
              selectedIssueId={selectedIssueId}
              todos={todos}
            />
          )}

          {!loading && !listError && hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                disabled={loadingMore || !nextCursor}
                onClick={() =>
                  void loadPage({ append: true, cursor: nextCursor })
                }
                variant="outline"
              >
                {loadingMore ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ArrowDown />
                )}
                Load more issues
              </Button>
            </div>
          )}
        </section>

        <aside
          aria-label="Selected issue details"
          className="sticky top-32 hidden h-[calc(100dvh-9rem)] min-h-0 overflow-hidden rounded-xl border bg-card shadow-sm xl:block"
        >
          <IssueDetailState
            detail={detail}
            error={detailError}
            loading={detailLoading}
            onClose={closeIssue}
            onDetailChange={handleDetailChange}
            onTodoChange={handleTodoChange}
            profiles={profiles}
            project={project}
          />
        </aside>
      </div>

      <Sheet
        onOpenChange={(open) => {
          if (!open && selectedIssueId && !isDesktop) closeIssue();
        }}
        open={Boolean(selectedIssueId) && !isDesktop}
      >
        <SheetContent
          className="w-full gap-0 p-0 sm:w-[min(92vw,42rem)] sm:max-w-2xl xl:hidden"
          showCloseButton={false}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Issue details</SheetTitle>
            <SheetDescription>
              Review and update the selected project issue.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <IssueDetailState
              detail={detail}
              error={detailError}
              loading={detailLoading}
              onClose={closeIssue}
              onDetailChange={handleDetailChange}
              onTodoChange={handleTodoChange}
              profiles={profiles}
              project={project}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function IssueList({
  filters,
  onSelect,
  onTodoChange,
  profiles,
  project,
  selectedIssueId,
  todos,
}: {
  filters: IssueFilters;
  onSelect: (todo: Todo) => void;
  onTodoChange: (todo: Todo) => void;
  profiles: Profile[];
  project: Project;
  selectedIssueId?: string;
  todos: Todo[];
}) {
  if (!todos.length) return <IssueEmpty />;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b bg-muted/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid-cols-[minmax(0,1fr)_120px_130px_100px]">
        <span>Issue</span>
        <span className="hidden sm:block">Assignee</span>
        <span className="hidden sm:block">Status</span>
        <span>Due</span>
      </div>
      <div className="divide-y">
        {todos.map((todo) => (
          <IssueRow
            filters={filters}
            key={todo.id}
            onSelect={onSelect}
            onTodoChange={onTodoChange}
            profiles={profiles}
            project={project}
            selected={selectedIssueId === todo.id}
            todo={todo}
          />
        ))}
      </div>
    </Card>
  );
}

function IssueRow({
  filters,
  onSelect,
  onTodoChange,
  profiles,
  project,
  selected,
  todo,
}: {
  filters: IssueFilters;
  onSelect: (todo: Todo) => void;
  onTodoChange: (todo: Todo) => void;
  profiles: Profile[];
  project: Project;
  selected: boolean;
  todo: Todo;
}) {
  const people = getAssignees(todo, profiles);
  const issueKey = getIssueKey(todo);
  const href = issueHref(project.id, todo.id, filters, "issues");

  async function toggleCompleted(checked: boolean) {
    const previous = todo;
    const optimistic = {
      ...todo,
      status: (checked ? "completed" : "open") as Todo["status"],
    };
    onTodoChange(optimistic);
    try {
      const response = await fetch("/api/todos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: todo.id,
          status: optimistic.status,
          expectedVersion: todo.version ?? 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (!response.ok) onTodoChange(previous);
    } catch {
      onTodoChange(previous);
    }
  }

  return (
    <div
      className={cn(
        "group relative isolate grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_120px_130px_100px]",
        selected && "bg-primary/5",
      )}
      data-issue-id={todo.id}
    >
      <Link
        aria-label={`Open ${issueKey}: ${todo.title}`}
        className="absolute inset-0 z-10 rounded-none"
        href={href}
        onKeyDown={activateLinkWithSpace}
        onNavigate={(event) => {
          event.preventDefault();
          onSelect(todo);
        }}
        prefetch={false}
        scroll={false}
      />
      <div className="pointer-events-none relative z-20 flex min-w-0 items-start gap-3">
        <Checkbox
          aria-label={`Complete ${todo.title}`}
          checked={todo.status === "completed"}
          className="pointer-events-auto relative z-30 mt-0.5"
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(checked) => void toggleCompleted(checked === true)}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold text-primary">
              {issueKey}
            </span>
            <PriorityBadge priority={String(todo.priority)} />
          </div>
          <p
            className={cn(
              "mt-1 truncate text-sm font-medium",
              todo.status === "completed" &&
                "text-muted-foreground line-through",
            )}
          >
            {todo.title}
          </p>
        </div>
      </div>
      <div className="pointer-events-none relative z-20 hidden items-center sm:flex">
        <AvatarStack people={people} />
      </div>
      <div className="pointer-events-none relative z-20 hidden sm:block">
        <StatusBadge status={String(todo.status)} />
      </div>
      <div className="pointer-events-none relative z-20 flex items-center justify-end gap-2 text-xs">
        {todo.dueDate ? (
          <span
            className={cn(
              "whitespace-nowrap text-muted-foreground",
              isOverdue(todo) && "font-medium text-destructive",
            )}
          >
            {formatDate(todo.dueDate)}
          </span>
        ) : (
          <span className="text-muted-foreground">No date</span>
        )}
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </div>
  );
}

function IssueBoard({
  filters,
  onSelect,
  onTodoChange,
  profiles,
  project,
  selectedIssueId,
  todos,
}: {
  filters: IssueFilters;
  onSelect: (todo: Todo) => void;
  onTodoChange: (todo: Todo) => void;
  profiles: Profile[];
  project: Project;
  selectedIssueId?: string;
  todos: Todo[];
}) {
  const columns: Array<{ id: string; label: string }> = [
    { id: "open", label: "To do" },
    { id: "in_progress", label: "In progress" },
    { id: "blocked", label: "Blocked" },
    { id: "review", label: "Review" },
    { id: "completed", label: "Done" },
    { id: "cancelled", label: "Cancelled" },
  ];

  async function moveIssue(todo: Todo, status: string, rank: number) {
    if (todo.status === status && todo.rank === rank) return;
    const previous = todo;
    const optimistic = {
      ...todo,
      status: status as Todo["status"],
      rank,
    };
    onTodoChange(optimistic);
    try {
      const response = await fetch("/api/todos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: todo.id,
          status,
          rank,
          expectedVersion: todo.version ?? 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as {
        todo?: Todo & Record<string, unknown>;
      };
      if (!response.ok || !body.todo) throw new Error("Move failed");
      onTodoChange(normalizeTodo({ ...optimistic, ...body.todo }));
    } catch {
      onTodoChange(previous);
    }
  }

  return (
    <div className="overflow-x-auto pb-3">
      <div className="grid min-w-max grid-flow-col auto-cols-[290px] gap-4">
        {columns.map((column) => {
          const columnTodos = todos.filter((todo) => todo.status === column.id);
          return (
            <section
              aria-label={`${column.label} issues`}
              className="rounded-xl border bg-muted/30"
              key={column.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const todoId = event.dataTransfer.getData("text/issue-id");
                const todo = todos.find((item) => item.id === todoId);
                if (!todo) return;
                void moveIssue(todo, column.id, (columnTodos.length + 1) * 1024);
              }}
            >
              <header className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="text-sm font-semibold">{column.label}</h3>
                <Badge variant="secondary">{columnTodos.length}</Badge>
              </header>
              <div className="min-h-28 space-y-2 p-2">
                {columnTodos.map((todo) => {
                  const issueKey = getIssueKey(todo);
                  return (
                    <article
                      className={cn(
                        "group relative cursor-grab rounded-lg border bg-card p-3 shadow-xs transition-colors focus-within:ring-2 focus-within:ring-ring hover:border-primary/30 active:cursor-grabbing",
                        selectedIssueId === todo.id && "border-primary/40 bg-primary/5",
                      )}
                      draggable
                      key={todo.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/issue-id", todo.id);
                      }}
                    >
                      <Link
                        aria-label={`Open ${issueKey}: ${todo.title}`}
                        className="absolute inset-0"
                        href={issueHref(
                          project.id,
                          todo.id,
                          filters,
                          "board",
                        )}
                        onKeyDown={activateLinkWithSpace}
                        onNavigate={(event) => {
                          event.preventDefault();
                          onSelect(todo);
                        }}
                        prefetch={false}
                        scroll={false}
                      />
                      <div className="pointer-events-none">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-semibold text-primary">
                            {issueKey}
                          </span>
                          <PriorityBadge priority={String(todo.priority)} />
                        </div>
                        <h4 className="mt-2 line-clamp-3 text-sm font-medium leading-5">
                          {todo.title}
                        </h4>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <AvatarStack people={getAssignees(todo, profiles)} />
                          {todo.dueDate && (
                            <span
                              className={cn(
                                "text-[11px] text-muted-foreground",
                                isOverdue(todo) && "font-medium text-destructive",
                              )}
                            >
                              {formatDate(todo.dueDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
                {!columnTodos.length && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                    No issues
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function IssueDetailState({
  detail,
  error,
  loading,
  onClose,
  onDetailChange,
  onTodoChange,
  profiles,
  project,
}: {
  detail: IssueDetailData | null;
  error: string | null;
  loading: boolean;
  onClose?: () => void;
  onDetailChange: (detail: IssueDetailData) => void;
  onTodoChange: (todo: Todo) => void;
  profiles: Profile[];
  project: Project;
}) {
  if (loading && !detail) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading issue…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <CircleDashed className="size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Open an issue</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Select any row to inspect its description, discussion, and history.
        </p>
      </div>
    );
  }
  return (
    <div className="relative h-full">
      {error && (
        <p className="absolute inset-x-5 top-24 z-10 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <IssueDetail
        detail={detail}
        loading={loading}
        onClose={onClose}
        onDetailChange={onDetailChange}
        onTodoChange={onTodoChange}
        profiles={profiles}
        project={project}
      />
    </div>
  );
}

function CreateIssueDialog({
  lists,
  onCreated,
  profiles,
  project,
}: {
  lists: TodoList[];
  onCreated: (todo: Todo) => void;
  profiles: Profile[];
  project: Project;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [issueType, setIssueType] = useState("task");
  const [description, setDescription] = useState("");
  const [estimateMinutes, setEstimateMinutes] = useState("");
  const [labels, setLabels] = useState("");
  const [error, setError] = useState<string | null>(null);

  const effectiveListId = listId || lists[0]?.id || "";

  async function createIssue(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          listId: effectiveListId,
          title,
          description: description || undefined,
          assigneeIds,
          dueDate: dueDate || undefined,
          priority,
          issueType,
          estimatedMinutes: estimateMinutes
            ? Number(estimateMinutes)
            : undefined,
          labels: labels
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as {
        todo?: Todo & Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !body.todo) {
        setError(body.error ?? "Unable to create this issue.");
        return;
      }
      const created = normalizeTodo({
        ...body.todo,
        projectId: project.id,
        listId: effectiveListId,
        assigneeIds,
      });
      onCreated(created);
      setTitle("");
      setDueDate("");
      setDescription("");
      setEstimateMinutes("");
      setLabels("");
      setAssigneeIds([]);
      setOpen(false);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Create
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={createIssue}>
          <DialogHeader>
            <DialogTitle>Create issue</DialogTitle>
            <DialogDescription>
              Add a clear, prioritized unit of work to this project.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="issue-title">Summary</Label>
              <Input
                id="issue-title"
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="issue-description">Description</Label>
              <Textarea
                id="issue-description"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Outcome, acceptance criteria, and relevant context"
                value={description}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-2">
                <Label>List</Label>
                <Select onValueChange={setListId} value={effectiveListId}>
                  <SelectTrigger aria-label="Issue list">
                    <SelectValue placeholder="Choose list" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select onValueChange={setIssueType} value={issueType}>
                  <SelectTrigger aria-label="Issue type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                    <SelectItem value="bug">Bug</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select onValueChange={setPriority} value={priority}>
                  <SelectTrigger aria-label="Issue priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue-date">Due date</Label>
                <Input
                  id="issue-date"
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                  value={dueDate}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="issue-estimate">Estimate (minutes)</Label>
                <Input
                  id="issue-estimate"
                  min="0"
                  onChange={(event) => setEstimateMinutes(event.target.value)}
                  step="15"
                  type="number"
                  value={estimateMinutes}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issue-labels">Labels</Label>
                <Input
                  id="issue-labels"
                  onChange={(event) => setLabels(event.target.value)}
                  placeholder="client, launch, analytics"
                  value={labels}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Assignees</Label>
              <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                {profiles.map((profile) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 text-sm"
                    key={profile.id}
                  >
                    <Checkbox
                      checked={assigneeIds.includes(profile.id)}
                      onCheckedChange={() =>
                        setAssigneeIds((current) =>
                          current.includes(profile.id)
                            ? current.filter((id) => id !== profile.id)
                            : [...current, profile.id],
                        )
                      }
                    />
                    <Avatar className="size-6">
                      <AvatarFallback className="text-[9px]">
                        {profile.initials}
                      </AvatarFallback>
                    </Avatar>
                    {profile.fullName}
                  </label>
                ))}
              </div>
            </div>
            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button disabled={saving || !listId || !title.trim()}>
              {saving && <LoaderCircle className="animate-spin" />}
              Create issue
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FilterSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, optionLabel]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function IssueMetric({
  alert = false,
  label,
  value,
}: {
  alert?: boolean;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        {alert && value > 0 ? (
          <AlertTriangle className="size-5 text-destructive" />
        ) : (
          <Rows3 className="size-5 text-muted-foreground" />
        )}
      </CardContent>
    </Card>
  );
}

function IssueLoading() {
  return (
    <Card>
      <CardContent className="flex min-h-60 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading issues…
      </CardContent>
    </Card>
  );
}

function IssueError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent
        className="flex min-h-60 flex-col items-center justify-center text-center"
        role="alert"
      >
        <AlertTriangle className="size-7 text-destructive" />
        <p className="mt-3 font-medium">Issues could not be loaded</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
        <Button className="mt-4" onClick={onRetry} variant="outline">
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function IssueEmpty() {
  return (
    <Card>
      <CardContent className="flex min-h-60 flex-col items-center justify-center text-center">
        <LayoutList className="size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">No issues match these filters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Broaden the filters or create a new issue.
        </p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "blocked"
      ? "destructive"
      : status === "completed"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant}>
      {status.replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase())}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "normal" || priority === "medium") return null;
  return (
    <Badge
      variant={priority === "urgent" || priority === "high" ? "destructive" : "outline"}
    >
      {priority}
    </Badge>
  );
}

function AvatarStack({ people }: { people: Profile[] }) {
  if (!people.length) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <UserRound className="size-3.5" />
        Unassigned
      </span>
    );
  }
  return (
    <span
      aria-label={people.map((person) => person.fullName).join(", ")}
      className="flex -space-x-1"
    >
      {people.slice(0, 3).map((person) => (
        <Avatar className="size-6 border border-card" key={person.id}>
          <AvatarFallback className="text-[8px]">{person.initials}</AvatarFallback>
        </Avatar>
      ))}
      {people.length > 3 && (
        <span className="grid size-6 place-items-center rounded-full border border-card bg-muted text-[8px] font-medium">
          +{people.length - 3}
        </span>
      )}
    </span>
  );
}

function getAssignees(todo: Todo, profiles: Profile[]) {
  const ids = todo.assigneeIds?.length
    ? todo.assigneeIds
    : todo.assigneeId
      ? [todo.assigneeId]
      : [];
  return profiles.filter((profile) => ids.includes(profile.id));
}

function getIssueKey(todo: Todo) {
  const value =
    "issueKey" in todo && typeof todo.issueKey === "string"
      ? todo.issueKey
      : undefined;
  return value || todo.id.slice(0, 8).toUpperCase();
}

function issueHref(
  projectId: string,
  todoId: string,
  filters: IssueFilters,
  view: IssueView,
) {
  return `/projects/${projectId}/issues/${todoId}?${filtersToSearchParams(filters, view)}`;
}

function issueWorkspaceHref(
  projectId: string,
  issueId: string | undefined,
  filters: IssueFilters,
  view: IssueView,
) {
  return issueId
    ? issueHref(projectId, issueId, filters, view)
    : `/projects/${projectId}?${filtersToSearchParams(filters, view)}`;
}

function issueIdFromProjectPath(pathname: string, projectId: string) {
  const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== "projects" || segments[1] !== projectId) return null;
  if (segments.length === 2) return undefined;
  if (segments.length === 4 && segments[2] === "issues") return segments[3];
  return null;
}

function filtersFromSearchParams(search: string): IssueFilters {
  const params = new URLSearchParams(search);
  return {
    query: params.get("q") ?? defaultFilters.query,
    status: params.get("status") ?? defaultFilters.status,
    priority: params.get("priority") ?? defaultFilters.priority,
    label: params.get("label") ?? defaultFilters.label,
    assignee: params.get("assignee") ?? defaultFilters.assignee,
    due: params.get("due") ?? defaultFilters.due,
    scope: params.get("scope") ?? defaultFilters.scope,
  };
}

function filtersToSearchParams(filters: IssueFilters, view: IssueView) {
  const params = new URLSearchParams({ tab: view });
  if (filters.query) params.set("q", filters.query);
  if (filters.status !== defaultFilters.status) params.set("status", filters.status);
  if (filters.priority !== defaultFilters.priority) {
    params.set("priority", filters.priority);
  }
  if (filters.label) params.set("label", filters.label);
  if (filters.assignee !== defaultFilters.assignee) {
    params.set("assignee", filters.assignee);
  }
  if (filters.due !== defaultFilters.due) params.set("due", filters.due);
  if (filters.scope !== defaultFilters.scope) params.set("scope", filters.scope);
  return params.toString();
}

function mergeUniqueTodos(current: Todo[], incoming: Todo[]) {
  const map = new Map(current.map((todo) => [todo.id, todo]));
  for (const todo of incoming) map.set(todo.id, normalizeTodo(todo));
  return [...map.values()];
}

function normalizeTodo(value: Todo | Record<string, unknown>): Todo {
  const row = value as Record<string, unknown>;
  const sourceStatus = String(row.status ?? "open");
  const statusMap: Record<string, string> = {
    todo: "open",
    done: "completed",
  };
  const sourcePriority = String(row.priority ?? "normal");
  return {
    ...(value as Todo),
    id: String(row.id),
    projectId: String(row.projectId ?? row.project_id ?? ""),
    listId: String(row.listId ?? row.todo_list_id ?? ""),
    title: String(row.title ?? ""),
    description: row.description ? String(row.description) : undefined,
    assigneeId: String(row.assigneeId ?? row.assigned_to ?? "") || undefined,
    assigneeIds: Array.isArray(row.assigneeIds)
      ? row.assigneeIds.map(String)
      : Array.isArray(row.assignee_ids)
        ? row.assignee_ids.map(String)
        : [],
    completionSubscriberIds: Array.isArray(row.completionSubscriberIds)
      ? row.completionSubscriberIds.map(String)
      : Array.isArray(row.completion_subscriber_ids)
        ? row.completion_subscriber_ids.map(String)
        : [],
    dueDate:
      String(row.dueDate ?? row.due_on ?? row.due_at ?? "").slice(0, 10) ||
      undefined,
    status: (statusMap[sourceStatus] ?? sourceStatus) as Todo["status"],
    priority: sourcePriority as Todo["priority"],
    updatedAt: String(row.updatedAt ?? row.updated_at ?? ""),
    version: Number(row.version ?? 1),
  };
}

function normalizeDetail(value: unknown, fallback?: Todo): IssueDetailData {
  const row =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const rawTodo =
    (typeof row.todo === "object" && row.todo !== null
      ? row.todo
      : fallback) ?? fallback;
  if (!rawTodo) throw new Error("The issue detail response did not include an issue.");
  const rawSubtasks = Array.isArray(row.subtasks)
    ? row.subtasks
    : Array.isArray(row.todoSubtasks)
      ? row.todoSubtasks
      : [];
  const rawComments = Array.isArray(row.comments)
    ? row.comments
    : Array.isArray(row.todoComments)
      ? row.todoComments
      : [];
  const rawTransitions = Array.isArray(row.transitions) ? row.transitions : [];
  return {
    todo: normalizeTodo(rawTodo as Todo & Record<string, unknown>),
    subtasks: rawSubtasks.map(normalizeSubtask),
    comments: rawComments.map(normalizeComment),
    transitions: rawTransitions.map(normalizeTransition),
  };
}

function normalizeSubtask(value: unknown): TodoSubtask {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    todoId: String(row.todoId ?? row.todo_id ?? ""),
    title: String(row.title ?? ""),
    position: Number(row.position ?? 0),
    completedAt: String(row.completedAt ?? row.completed_at ?? "") || undefined,
    completedBy:
      String(row.completedBy ?? row.completed_by ?? "") || undefined,
    version: Number(row.version ?? 1),
  };
}

function normalizeComment(value: unknown): TodoComment {
  const row = value as Record<string, unknown>;
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
    : Array.isArray(row.comment_attachments)
      ? row.comment_attachments
      : [];
  return {
    id: String(row.id),
    todoId: String(row.todoId ?? row.todo_id ?? ""),
    authorId: String(row.authorId ?? row.author_id ?? ""),
    body: String(row.body ?? ""),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    editedAt: String(row.editedAt ?? row.updated_at ?? "") || undefined,
    parentCommentId:
      String(row.parentCommentId ?? row.parent_comment_id ?? "") || undefined,
    mentionedProfileIds: Array.isArray(row.mentionedProfileIds)
      ? row.mentionedProfileIds.map(String)
      : [],
    attachments: attachments.map((attachment) => {
      const item = attachment as Record<string, unknown>;
      return {
        id: String(item.id),
        title: String(item.title ?? "Attachment"),
        fileId: String(item.fileId ?? item.file_id ?? "") || undefined,
        externalUrl:
          String(item.externalUrl ?? item.external_url ?? "") || undefined,
      };
    }),
  };
}

function normalizeTransition(value: unknown): IssueTransition {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    actorId: String(row.actorId ?? row.actor_id ?? "") || undefined,
    fromStatus:
      String(row.fromStatus ?? row.from_status ?? "") || undefined,
    toStatus: String(row.toStatus ?? row.to_status ?? ""),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
  };
}

function encodeCursor(value: unknown) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function isOverdue(todo: Todo) {
  return Boolean(
    todo.dueDate &&
      new Date(`${todo.dueDate.slice(0, 10)}T23:59:59`).getTime() < Date.now() &&
      todo.status !== "completed" &&
      todo.status !== "cancelled",
  );
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function activateLinkWithSpace(
  event: React.KeyboardEvent<HTMLAnchorElement>,
) {
  if (event.key !== " ") return;
  event.preventDefault();
  event.currentTarget.click();
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
