"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flag,
  History,
  Link as LinkIcon,
  LoaderCircle,
  Pencil,
  Paperclip,
  Plus,
  Send,
  Tags,
  Timer,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  createChatCrossLinks,
  EntityLinkPicker,
  resolvePastedLink,
} from "@/components/cross-links/entity-link-picker";
import { LinkedConversations } from "@/components/cross-links/linked-conversations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { currentProfile } from "@/lib/demo-data";
import type { CrossLinkSearchResult } from "@/lib/cross-links/types";
import type {
  DocumentItem,
  Profile,
  Project,
  Todo,
  TodoComment,
  TodoSubtask,
} from "@/lib/types";
import { uploadProjectFile } from "@/lib/uploads/project-files";
import { cn } from "@/lib/utils";

export interface IssueTransition {
  id: string;
  actorId?: string;
  fromStatus?: string;
  toStatus: string;
  createdAt: string;
}

export interface IssueDetailData {
  todo: Todo;
  subtasks: TodoSubtask[];
  comments: TodoComment[];
  transitions?: IssueTransition[];
}

export function IssueDetail({
  detail,
  loading = false,
  profiles,
  project,
  onClose,
  onDetailChange,
  onTodoChange,
}: {
  detail: IssueDetailData;
  loading?: boolean;
  profiles: Profile[];
  project: Project;
  onClose?: () => void;
  onDetailChange: (detail: IssueDetailData) => void;
  onTodoChange: (todo: Todo) => void;
}) {
  const searchParams = useSearchParams();
  const { todo, subtasks, comments, transitions = [] } = detail;
  const [newSubtask, setNewSubtask] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentFile, setCommentFile] = useState<DocumentItem | null>(null);
  const [commentChatLinks, setCommentChatLinks] = useState<
    CrossLinkSearchResult[]
  >([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planningOptions, setPlanningOptions] = useState<{
    milestones: Array<{ id: string; name: string }>;
    cycles: Array<{ id: string; name: string }>;
  }>({ milestones: [], cycles: [] });
  const commentFileRef = useRef<HTMLInputElement>(null);
  const assigneeIds = todo.assigneeIds?.length
    ? todo.assigneeIds
    : todo.assigneeId
      ? [todo.assigneeId]
      : [];
  const assignees = profiles.filter((profile) => assigneeIds.includes(profile.id));
  const subscribers = profiles.filter((profile) =>
    (todo.completionSubscriberIds ?? []).includes(profile.id),
  );

  useEffect(() => {
    const commentId = searchParams.get("comment");
    if (!commentId) return;
    document
      .getElementById(`issue-comment-${commentId}`)
      ?.scrollIntoView({ block: "center" });
  }, [comments, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(`/api/milestones?projectId=${encodeURIComponent(project.id)}`, {
        signal: controller.signal,
      }).then((response) => response.json()),
      fetch(`/api/cycles?projectId=${encodeURIComponent(project.id)}`, {
        signal: controller.signal,
      }).then((response) => response.json()),
    ])
      .then(([milestones, cycles]) => {
        if (controller.signal.aborted) return;
        setPlanningOptions({
          milestones: Array.isArray(milestones.milestones)
            ? milestones.milestones.map((item: { id: string; name: string }) => ({
                id: item.id,
                name: item.name,
              }))
            : [],
          cycles: Array.isArray(cycles.cycles)
            ? cycles.cycles.map((item: { id: string; name: string }) => ({
                id: item.id,
                name: item.name,
              }))
            : [],
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [project.id]);

  async function updatePlanning(changes: {
    milestoneId?: string | null;
    cycleId?: string | null;
    riskLevel?: Todo["riskLevel"];
    riskReason?: string | null;
  }) {
    setWorking(true);
    setError(null);
    const response = await fetch("/api/issues/planning", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        issueId: todo.id,
        expectedVersion: todo.version ?? 1,
        ...changes,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      issue?: {
        milestone_id?: string | null;
        cycle_id?: string | null;
        risk_level?: Todo["riskLevel"];
        risk_reason?: string | null;
        version?: number;
      };
      error?: string;
    };
    if (!response.ok || !result.issue) {
      setError(result.error ?? "Planning could not be updated.");
    } else {
      const updated: Todo = {
        ...todo,
        milestoneId: result.issue.milestone_id ?? undefined,
        cycleId: result.issue.cycle_id ?? undefined,
        riskLevel: result.issue.risk_level ?? "none",
        riskReason: result.issue.risk_reason ?? undefined,
        version: result.issue.version ?? (todo.version ?? 1) + 1,
      };
      onDetailChange({ ...detail, todo: updated });
      onTodoChange(updated);
    }
    setWorking(false);
  }

  async function updateIssue(
    changes: Partial<
      Pick<
        Todo,
        | "status"
        | "priority"
        | "title"
        | "description"
        | "dueDate"
        | "assigneeIds"
        | "completionSubscriberIds"
        | "issueType"
        | "operationalState"
        | "labels"
        | "estimatedMinutes"
        | "actualMinutes"
      >
    >,
  ) {
    setWorking(true);
    setError(null);
    const previous = todo;
    const optimistic = { ...todo, ...changes };
    onDetailChange({ ...detail, todo: optimistic });
    onTodoChange(optimistic);

    try {
      const response = await fetch("/api/todos", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: todo.id,
          expectedVersion: todo.version ?? 1,
          idempotencyKey: crypto.randomUUID(),
          ...changes,
        }),
      });
      const body = (await response.json()) as {
        todo?: Todo & Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !body.todo) {
        throw new Error(body.error ?? "Unable to update this issue.");
      }
      const updated = mergeTodoResponse(optimistic, body.todo);
      onDetailChange({ ...detail, todo: updated });
      onTodoChange(updated);
    } catch (updateError) {
      onDetailChange({ ...detail, todo: previous });
      onTodoChange(previous);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update this issue.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function addSubtask(event: React.FormEvent) {
    event.preventDefault();
    if (!newSubtask.trim()) return;
    const title = newSubtask.trim();
    setNewSubtask("");
    setError(null);
    try {
      const response = await fetch("/api/subtasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          todoId: todo.id,
          title,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const result = (await response.json()) as {
        subtask?: TodoSubtask & Record<string, unknown>;
        error?: string;
      };
      if (!response.ok || !result.subtask) {
        throw new Error(result.error ?? "Unable to add the subtask.");
      }
      const row = result.subtask;
      onDetailChange({
        ...detail,
        subtasks: [
          ...subtasks,
          {
            id: String(row.id),
            todoId: String(row.todoId ?? row.todo_id ?? todo.id),
            title: String(row.title ?? title),
            position: Number(row.position ?? subtasks.length),
            version: Number(row.version ?? 1),
          },
        ],
      });
    } catch (subtaskError) {
      setNewSubtask(title);
      setError(
        subtaskError instanceof Error
          ? subtaskError.message
          : "Unable to add the subtask.",
      );
    }
  }

  async function toggleSubtask(subtask: TodoSubtask, completed: boolean) {
    const previous = subtasks;
    const completedAt = completed ? new Date().toISOString() : undefined;
    const optimistic = subtasks.map((item) =>
      item.id === subtask.id ? { ...item, completedAt } : item,
    );
    onDetailChange({ ...detail, subtasks: optimistic });
    try {
      const response = await fetch("/api/subtasks", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: subtask.id,
          completed,
          expectedVersion: subtask.version ?? 1,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      if (response.ok) return;
      throw new Error("Unable to update the subtask.");
    } catch {
      onDetailChange({ ...detail, subtasks: previous });
      setError("Unable to update the subtask.");
    }
  }

  async function uploadCommentFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    setError(null);
    try {
      const uploaded = await uploadProjectFile(project.id, file);
      setCommentFile({
        id: uploaded.id,
        projectId: uploaded.projectId,
        title: uploaded.title,
        kind: "file",
        authorId: uploaded.authorId ?? currentProfile.id,
        size: uploaded.size,
        updatedAt: uploaded.updatedAt,
      });
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Unable to upload this attachment.",
      );
    } finally {
      setWorking(false);
      event.target.value = "";
    }
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setWorking(true);
    setError(null);
    const text = commentBody.trim();
    const mentionedProfileIds = profiles
      .filter((profile) =>
        new RegExp(
          `@(?:${escapeRegExp(profile.fullName)}|${escapeRegExp(profile.fullName.split(" ")[0])})\\b`,
          "i",
        ).test(text),
      )
      .map((profile) => profile.id);
    let response: Response;
    try {
      response = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "comment",
          projectId: project.id,
          parentType: "todo",
          parentId: todo.id,
          body: text,
          mentionProfileIds: mentionedProfileIds,
          attachmentFileIds: commentFile ? [commentFile.id] : [],
          idempotencyKey: crypto.randomUUID(),
        }),
      });
    } catch {
      setError("Unable to reach the server. Your comment was not posted.");
      setWorking(false);
      return;
    }
    let result: { item?: Record<string, unknown>; error?: string };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      setError("The server returned an invalid response. Your comment was not posted.");
      setWorking(false);
      return;
    }
    if (!response.ok || !result.item) {
      setError(result.error ?? "Unable to add this comment.");
      setWorking(false);
      return;
    }
    const createdComment = result.item;
    if (commentChatLinks.length) {
      try {
        await createChatCrossLinks(
          commentChatLinks,
          "comment",
          String(createdComment.id),
        );
      } catch (linkError) {
        setError(
          linkError instanceof Error
            ? linkError.message
            : "Comment posted, but its chat link could not be saved.",
        );
      }
    }
    onDetailChange({
      ...detail,
      comments: [
        ...comments,
        {
          id: String(createdComment.id),
          todoId: todo.id,
          authorId: String(createdComment.author_id ?? currentProfile.id),
          body: text,
          createdAt: String(createdComment.created_at ?? new Date().toISOString()),
          mentionedProfileIds,
          attachments: commentFile
            ? [
                {
                  id: `attachment-${createdComment.id}`,
                  title: commentFile.title,
                  fileId: commentFile.id,
                },
              ]
            : [],
        },
      ],
    });
    setCommentBody("");
    setCommentFile(null);
    setCommentChatLinks([]);
    setWorking(false);
  }

  const completedSubtasks = subtasks.filter((item) => item.completedAt).length;
  const issueKey =
    ("issueKey" in todo && typeof todo.issueKey === "string" && todo.issueKey) ||
    todo.id.slice(0, 8).toUpperCase();

  return (
    <article
      aria-label={`${issueKey}: ${todo.title}`}
      aria-busy={loading}
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <header className="shrink-0 border-b px-5 py-4 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-xs font-semibold text-primary">
                {issueKey}
              </p>
              <Badge variant="outline">{issueType(todo)}</Badge>
              <Badge variant="secondary">{operationalState(todo)}</Badge>
            </div>
            <h2 className="mt-2 text-lg font-semibold leading-6">{todo.title}</h2>
          </div>
          {onClose && (
            <Button
              aria-label="Close issue"
              className="absolute right-3 top-3"
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <X />
            </Button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Select
            disabled={loading || working}
            onValueChange={(value) =>
              void updateIssue({ status: value as Todo["status"] })
            }
            value={todo.status}
          >
            <SelectTrigger aria-label="Issue status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">To do</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="review">Review</SelectItem>
              <SelectItem value="completed">Done</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select
            disabled={loading || working}
            onValueChange={(value) =>
              void updateIssue({ priority: value as Todo["priority"] })
            }
            value={todo.priority}
          >
            <SelectTrigger aria-label="Issue priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low priority</SelectItem>
              <SelectItem value="normal">Normal priority</SelectItem>
              <SelectItem value="medium">Medium priority</SelectItem>
              <SelectItem value="high">High priority</SelectItem>
              <SelectItem value="urgent">Urgent priority</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <EditIssueDialog
          disabled={loading || working}
          onSave={updateIssue}
          profiles={profiles}
          todo={todo}
        />
        {error && (
          <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5"
        data-testid="issue-detail-scroll"
      >
        {loading ? (
          <div
            className="flex min-h-52 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-5 animate-spin" />
            Loading latest details…
          </div>
        ) : (
          <div className="space-y-6">
          <section className="grid gap-4 text-sm sm:grid-cols-2">
            <PeopleField
              icon={UserRoundCheck}
              label="Assigned to"
              people={assignees}
            />
            <PeopleField icon={Bell} label="When done" people={subscribers} />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Due date</p>
              <p className="mt-2 flex items-center gap-2 font-medium">
                <CalendarDays className="size-4 text-muted-foreground" />
                {todo.dueDate ? formatDate(todo.dueDate) : "No due date"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Source</p>
              <p className="mt-2">
                {todo.acceloTaskId ? "Imported record" : "P11 PM"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Estimate
              </p>
              <p className="mt-2 flex items-center gap-2 font-medium">
                <Timer className="size-4 text-muted-foreground" />
                {formatMinutes(optionalNumber(todo, "estimatedMinutes"))}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Actual time
              </p>
              <p className="mt-2 flex items-center gap-2 font-medium">
                <Clock3 className="size-4 text-muted-foreground" />
                {formatMinutes(optionalNumber(todo, "actualMinutes"))}
              </p>
            </div>
            {optionalString(todo, "sourceCreatedAt") && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Source lineage
                </p>
                <p className="mt-2 flex items-center gap-2 text-xs">
                  <History className="size-4 text-muted-foreground" />
                  Created in source{" "}
                  {formatDateTime(optionalString(todo, "sourceCreatedAt")!)}
                </p>
              </div>
            )}
            {optionalStrings(todo, "labels").length > 0 && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground">Labels</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {optionalStrings(todo, "labels").map((label) => (
                    <Badge key={label} variant="outline">
                      <Tags className="mr-1 size-3" />
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </section>

          <Separator />

          <section>
            <div className="mb-3 flex items-center gap-2">
              <Flag className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Planning and risk</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                disabled={working}
                onValueChange={(value) =>
                  void updatePlanning({
                    milestoneId: value === "__none" ? null : value,
                  })
                }
                value={todo.milestoneId ?? "__none"}
              >
                <SelectTrigger aria-label="Issue milestone"><SelectValue placeholder="Milestone" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No milestone</SelectItem>
                  {planningOptions.milestones.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                disabled={working}
                onValueChange={(value) =>
                  void updatePlanning({ cycleId: value === "__none" ? null : value })
                }
                value={todo.cycleId ?? "__none"}
              >
                <SelectTrigger aria-label="Issue cycle"><SelectValue placeholder="Cycle" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No cycle</SelectItem>
                  {planningOptions.cycles.map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                disabled={working}
                onValueChange={(value) =>
                  void updatePlanning({ riskLevel: value as Todo["riskLevel"] })
                }
                value={todo.riskLevel ?? "none"}
              >
                <SelectTrigger aria-label="Issue risk"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["none", "low", "medium", "high"].map((value) => (
                    <SelectItem key={value} value={value}>{value} risk</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="sm:col-span-3"
                defaultValue={todo.riskReason ?? ""}
                disabled={working}
                key={`${todo.id}-${todo.riskReason ?? ""}`}
                onBlur={(event) => {
                  const value = event.currentTarget.value.trim();
                  if (value !== (todo.riskReason ?? "")) {
                    void updatePlanning({ riskReason: value || null });
                  }
                }}
                placeholder="Risk reason or mitigation"
              />
            </div>
          </section>

          <Separator />

          <section>
            <p className="text-xs font-medium text-muted-foreground">Description</p>
            <div className="mt-2 whitespace-pre-wrap text-sm leading-6">
              {todo.description ? (
                <LinkedText text={todo.description} />
              ) : (
                <span className="text-muted-foreground">
                  No additional description.
                </span>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Subtasks</h3>
              <span className="text-xs text-muted-foreground">
                {completedSubtasks}/{subtasks.length}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {subtasks.map((subtask) => (
                <label className="flex items-start gap-2 text-sm" key={subtask.id}>
                  <Checkbox
                    checked={Boolean(subtask.completedAt)}
                    className="mt-0.5"
                    onCheckedChange={(checked) =>
                      void toggleSubtask(subtask, checked === true)
                    }
                  />
                  <span
                    className={cn(
                      subtask.completedAt && "text-muted-foreground line-through",
                    )}
                  >
                    {subtask.title}
                  </span>
                </label>
              ))}
              <form className="flex gap-2 pt-1" onSubmit={addSubtask}>
                <Input
                  aria-label="New subtask"
                  onChange={(event) => setNewSubtask(event.target.value)}
                  placeholder="Add a subtask…"
                  value={newSubtask}
                />
                <Button
                  aria-label="Add subtask"
                  disabled={!newSubtask.trim()}
                  size="icon"
                  variant="outline"
                >
                  <Plus />
                </Button>
              </form>
            </div>
          </section>

          <section className="border-t pt-5">
            <LinkedConversations compact workId={todo.id} workType="issue" />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Discussion</h3>
              <span className="text-xs text-muted-foreground">
                {comments.length} comments
              </span>
            </div>
            <div className="mt-4 space-y-5">
              {comments.map((comment) => {
                const author = profiles.find(
                  (profile) => profile.id === comment.authorId,
                );
                return (
                  <div
                    className="flex gap-3"
                    id={`issue-comment-${comment.id}`}
                    key={comment.id}
                  >
                    <Avatar className="size-8 shrink-0">
                      <AvatarFallback className="text-[10px]">
                        {author?.initials ?? "P11"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-semibold">
                          {author?.fullName ?? "P11 team"}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {formatDateTime(comment.createdAt)}
                          {comment.editedAt ? " · edited" : ""}
                        </span>
                      </p>
                      <div className="mt-1 whitespace-pre-wrap text-sm leading-6">
                        <LinkedText text={comment.body} />
                      </div>
                      {comment.attachments.map((attachment) => (
                        <a
                          className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-muted"
                          href={
                            attachment.externalUrl ??
                            (attachment.fileId
                              ? `/api/files/${attachment.fileId}`
                              : "#")
                          }
                          key={attachment.id}
                          rel="noreferrer"
                          target={
                            attachment.externalUrl || attachment.fileId
                              ? "_blank"
                              : undefined
                          }
                        >
                          <Paperclip className="size-3.5" />
                          {attachment.title}
                        </a>
                      ))}
                      <LinkedConversations
                        compact
                        workId={comment.id}
                        workType="comment"
                      />
                    </div>
                  </div>
                );
              })}
              {!comments.length && (
                <p className="text-sm text-muted-foreground">
                  No discussion yet. Add the first comment below.
                </p>
              )}
            </div>
            <form className="mt-5 space-y-2" onSubmit={addComment}>
              <Textarea
                className="min-h-24"
                onChange={(event) => setCommentBody(event.target.value)}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  void resolvePastedLink(pasted, "chat").then((result) => {
                    if (
                      result &&
                      !commentChatLinks.some(
                        (link) => link.type === result.type && link.id === result.id,
                      )
                    ) {
                      setCommentChatLinks([...commentChatLinks, result]);
                    }
                  });
                }}
                placeholder="Add a comment… Use @Name to mention someone."
                value={commentBody}
              />
              <EntityLinkPicker
                disabled={working}
                onChange={setCommentChatLinks}
                scope="chat"
                value={commentChatLinks}
              />
              {commentFile && (
                <Badge variant="secondary">
                  <Paperclip className="mr-1 size-3" />
                  {commentFile.title}
                </Badge>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <input
                    className="hidden"
                    onChange={uploadCommentFile}
                    ref={commentFileRef}
                    type="file"
                  />
                  <Button
                    disabled={working}
                    onClick={() => commentFileRef.current?.click()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Paperclip />
                    Attach
                  </Button>
                </div>
                <Button
                  disabled={working || !commentBody.trim()}
                  size="sm"
                >
                  {working ? <LoaderCircle className="animate-spin" /> : <Send />}
                  Comment
                </Button>
              </div>
            </form>
          </section>

          <section className="border-t pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Status history</h3>
              <Activity className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-3 space-y-3">
              {transitions.map((transition) => {
                const actor = profiles.find(
                  (profile) => profile.id === transition.actorId,
                );
                return (
                  <div className="flex gap-3 text-xs" key={transition.id}>
                    <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div>
                      <p>
                        <span className="font-medium">
                          {actor?.fullName ?? "P11 team"}
                        </span>{" "}
                        moved this issue
                        {transition.fromStatus
                          ? ` from ${formatStatus(transition.fromStatus)}`
                          : ""}{" "}
                        to {formatStatus(transition.toStatus)}.
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        {formatDateTime(transition.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              {!transitions.length && (
                <p className="text-xs text-muted-foreground">
                  Status transitions will appear here as the issue moves through
                  the workflow.
                </p>
              )}
            </div>
          </section>

          {subscribers.length > 0 && (
            <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Bell className="size-3.5" />
              {subscribers.length}{" "}
              {subscribers.length === 1 ? "person" : "people"} will be notified
              when this issue is completed or commented on.
            </p>
          )}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t bg-muted/30 px-5 py-3">
        <Button
          className="w-full"
          disabled={loading || working}
          onClick={() =>
            void updateIssue({
              status: (todo.status === "completed"
                ? "open"
                : "completed") as Todo["status"],
            })
          }
          variant={todo.status === "completed" ? "outline" : "default"}
        >
          <CheckCircle2 />
          {todo.status === "completed" ? "Reopen issue" : "Mark done"}
        </Button>
      </footer>
    </article>
  );
}

function EditIssueDialog({
  disabled,
  onSave,
  profiles,
  todo,
}: {
  disabled: boolean;
  onSave: (
    changes: Partial<
      Pick<
        Todo,
        | "title"
        | "description"
        | "dueDate"
        | "assigneeIds"
        | "completionSubscriberIds"
        | "issueType"
        | "operationalState"
        | "labels"
        | "estimatedMinutes"
        | "actualMinutes"
      >
    >,
  ) => Promise<void>;
  profiles: Profile[];
  todo: Todo;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [dueDate, setDueDate] = useState(todo.dueDate ?? "");
  const [issueKind, setIssueKind] = useState(todo.issueType ?? "task");
  const [scope, setScope] = useState(todo.operationalState ?? "active");
  const [labels, setLabels] = useState((todo.labels ?? []).join(", "));
  const [estimate, setEstimate] = useState(
    todo.estimatedMinutes === undefined ? "" : String(todo.estimatedMinutes),
  );
  const [actual, setActual] = useState(
    todo.actualMinutes === undefined ? "" : String(todo.actualMinutes),
  );
  const [assigneeIds, setAssigneeIds] = useState(
    todo.assigneeIds?.length
      ? todo.assigneeIds
      : todo.assigneeId
        ? [todo.assigneeId]
        : [],
  );
  const [subscriberIds, setSubscriberIds] = useState(
    todo.completionSubscriberIds ?? [],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await onSave({
      title,
      description: description || undefined,
      dueDate: dueDate || undefined,
      issueType: issueKind as Todo["issueType"],
      operationalState: scope as Todo["operationalState"],
      labels: labels
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
      estimatedMinutes: estimate ? Number(estimate) : undefined,
      actualMinutes: actual ? Number(actual) : undefined,
      assigneeIds,
      completionSubscriberIds: subscriberIds,
    });
    setOpen(false);
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          className="mt-3 w-full"
          disabled={disabled}
          size="sm"
          variant="outline"
        >
          <Pencil />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Edit issue</DialogTitle>
            <DialogDescription>
              Update ownership, scope, estimates, labels, and delivery details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor={`edit-title-${todo.id}`}>Title</Label>
              <Input
                id={`edit-title-${todo.id}`}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`edit-description-${todo.id}`}>Description</Label>
              <Textarea
                id={`edit-description-${todo.id}`}
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  onValueChange={(value) =>
                    setIssueKind(value as NonNullable<Todo["issueType"]>)
                  }
                  value={issueKind}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="task">Task</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                    <SelectItem value="bug">Bug</SelectItem>
                    <SelectItem value="epic">Epic</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Operational scope</Label>
                <Select
                  onValueChange={(value) =>
                    setScope(value as NonNullable<Todo["operationalState"]>)
                  }
                  value={scope}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="triage">Triage</SelectItem>
                    <SelectItem value="historical">Historical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`edit-due-${todo.id}`}>Due date</Label>
                <Input
                  id={`edit-due-${todo.id}`}
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                  value={dueDate}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor={`edit-estimate-${todo.id}`}>Estimate (minutes)</Label>
                <Input
                  id={`edit-estimate-${todo.id}`}
                  min="0"
                  onChange={(event) => setEstimate(event.target.value)}
                  type="number"
                  value={estimate}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`edit-actual-${todo.id}`}>Actual (minutes)</Label>
                <Input
                  id={`edit-actual-${todo.id}`}
                  min="0"
                  onChange={(event) => setActual(event.target.value)}
                  type="number"
                  value={actual}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`edit-labels-${todo.id}`}>Labels</Label>
                <Input
                  id={`edit-labels-${todo.id}`}
                  onChange={(event) => setLabels(event.target.value)}
                  placeholder="client, launch"
                  value={labels}
                />
              </div>
            </div>
            <PeopleChecklist
              label="Assignees"
              onChange={setAssigneeIds}
              profiles={profiles}
              value={assigneeIds}
            />
            <PeopleChecklist
              label="Notify when done"
              onChange={setSubscriberIds}
              profiles={profiles}
              value={subscriberIds}
            />
          </div>
          <DialogFooter>
            <Button disabled={disabled || !title.trim()}>Save issue</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PeopleChecklist({
  label,
  onChange,
  profiles,
  value,
}: {
  label: string;
  onChange: (value: string[]) => void;
  profiles: Profile[];
  value: string[];
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
        {profiles.map((profile) => (
          <label className="flex items-center gap-2 text-sm" key={profile.id}>
            <Checkbox
              checked={value.includes(profile.id)}
              onCheckedChange={() =>
                onChange(
                  value.includes(profile.id)
                    ? value.filter((id) => id !== profile.id)
                    : [...value, profile.id],
                )
              }
            />
            {profile.fullName}
          </label>
        ))}
      </div>
    </div>
  );
}

function PeopleField({
  icon: Icon,
  label,
  people,
}: {
  icon: typeof Bell;
  label: string;
  people: Profile[];
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {people.length ? (
          people.map((person) => (
            <Badge key={person.id} variant="secondary">
              <Icon className="mr-1 size-3" />
              {person.fullName}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-muted-foreground">Nobody</span>
        )}
      </div>
    </div>
  );
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[A-Za-z]+(?:\s[A-Za-z]+)?)/g);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          className="inline-flex items-center gap-1 break-all text-primary underline-offset-4 hover:underline"
          href={part}
          key={`${part}-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          <LinkIcon className="size-3" />
          {part}
        </a>
      );
    }
    if (part.startsWith("@")) {
      return (
        <span className="font-medium text-primary" key={`${part}-${index}`}>
          {part}
        </span>
      );
    }
    return <span key={`${index}-${part.slice(0, 12)}`}>{part}</span>;
  });
}

function mergeTodoResponse(
  current: Todo,
  response: Todo & Record<string, unknown>,
): Todo {
  const row = response as Record<string, unknown>;
  return {
    ...current,
    ...response,
    id: String(row.id ?? current.id),
    projectId: String(row.projectId ?? row.project_id ?? current.projectId),
    listId: String(row.listId ?? row.todo_list_id ?? current.listId),
    title: String(row.title ?? current.title),
    description:
      row.description === null
        ? undefined
        : row.description
          ? String(row.description)
          : current.description,
    dueDate:
      row.dueDate === null || row.due_at === null
        ? undefined
        : String(row.dueDate ?? row.due_at ?? current.dueDate ?? "").slice(0, 10) ||
          undefined,
    status: normalizeStatus(row.status ?? current.status),
    priority: normalizePriority(row.priority ?? current.priority),
    updatedAt: String(row.updatedAt ?? row.updated_at ?? current.updatedAt),
    version: Number(row.version ?? current.version ?? 1),
  };
}

function normalizeStatus(value: unknown): Todo["status"] {
  const status = String(value);
  const map: Record<string, string> = {
    todo: "open",
    done: "completed",
  };
  return (map[status] ?? status) as Todo["status"];
}

function normalizePriority(value: unknown): Todo["priority"] {
  return String(value) as Todo["priority"];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) =>
    character.toUpperCase(),
  );
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function optionalString(todo: Todo, key: string) {
  const value = (todo as Todo & Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function optionalNumber(todo: Todo, key: string) {
  const value = (todo as Todo & Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalStrings(todo: Todo, key: string) {
  const value = (todo as Todo & Record<string, unknown>)[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function issueType(todo: Todo) {
  return optionalString(todo, "issueType")?.replaceAll("_", " ") ?? "task";
}

function operationalState(todo: Todo) {
  return optionalString(todo, "operationalState")?.replaceAll("_", " ") ?? "active";
}

function formatMinutes(minutes: number | undefined) {
  if (minutes === undefined) return "Not estimated";
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
