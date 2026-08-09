import type {
  ActivityFeedItem,
  DueCursor,
  PositionCursor,
  TimestampCursor,
} from "@/lib/project-data/contracts";
import type {
  ChatMessage,
  DocumentItem,
  MessagePost,
  Milestone,
  Profile,
  Project,
  Todo,
  TodoComment,
  TodoList,
  TodoSubtask,
} from "@/lib/types";

export type DataRow = Record<string, unknown>;

export function asRecord(value: unknown): DataRow {
  return typeof value === "object" && value !== null ? (value as DataRow) : {};
}

export function asRows(value: unknown): DataRow[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "P11"
  );
}

export function mapProfile(value: unknown): Profile {
  const row = asRecord(value);
  const fullName = asString(row.full_name, "P11 teammate");
  const email = asString(row.email);
  const preferences = asRecord(row.preferences);
  return {
    id: asString(row.id),
    fullName,
    email,
    initials: asString(row.initials) || initials(fullName),
    role: asString(row.role, "member") as Profile["role"],
    jobTitle: asString(row.title, "Team member"),
    active: asString(row.status, "active") === "active",
    isInternal:
      typeof preferences.is_internal === "boolean"
        ? preferences.is_internal
        : email.toLowerCase().endsWith("@p11.com") ||
          email.toLowerCase().endsWith("@p11creative.com"),
    acceloStaffId: preferences.accelo_staff_id
      ? String(preferences.accelo_staff_id)
      : undefined,
    slackUserId: asString(preferences.slack_user_id) || undefined,
  };
}

export function mapProject(value: unknown): Project {
  const row = asRecord(value);
  const metadata = asRecord(row.metadata);
  const sourceStatus = asString(row.status, "active");
  const status: Project["status"] =
    sourceStatus === "completed" || sourceStatus === "cancelled"
      ? "completed"
      : sourceStatus === "on_hold" || sourceStatus === "planning"
        ? "on_hold"
        : "active";
  return {
    id: asString(row.id),
    name: asString(row.name),
    client: asString(row.client_name, "P11 client"),
    description: asString(row.description),
    status,
    color: asString(metadata.color, "bg-sky-500"),
    acceloJobId: metadata.accelo_job_id
      ? String(metadata.accelo_job_id)
      : undefined,
    slackChannel:
      asString(metadata.slack_channel_name) ||
      asString(metadata.slack_channel) ||
      undefined,
    isReadOnly: row.is_read_only === true,
    sourceSystem:
      asString(row.source_system) ||
      (row.basecamp_account_id ? "basecamp" : undefined),
    progress: Math.max(0, Math.min(100, asNumber(row.progress, asNumber(metadata.progress)))),
    updatedAt: asString(row.updated_at, new Date(0).toISOString()),
    memberIds: asStrings(row.member_ids),
  };
}

export function mapTodoList(value: unknown): TodoList {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    name: asString(row.title),
    position: asNumber(row.position),
  };
}

export function mapTodo(value: unknown): Todo {
  const row = asRecord(value);
  const statusMap: Record<string, Todo["status"]> = {
    todo: "open",
    in_progress: "in_progress",
    blocked: "blocked",
    review: "in_progress",
    done: "completed",
    cancelled: "completed",
  };
  const sourcePriority = asString(row.priority, "medium");
  const assigneeIds = asStrings(row.assignee_ids);
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    listId: asString(row.todo_list_id),
    title: asString(row.title),
    description: asString(row.description) || undefined,
    assigneeId: asString(row.assigned_to) || undefined,
    assigneeIds,
    completionSubscriberIds: asStrings(row.completion_subscriber_ids),
    dueDate:
      (asString(row.due_on) || asString(row.due_at)).slice(0, 10) || undefined,
    status: statusMap[asString(row.status, "todo")] ?? "open",
    priority:
      sourcePriority === "medium"
        ? "normal"
        : sourcePriority === "urgent"
          ? "high"
          : (sourcePriority as Todo["priority"]),
    acceloTaskId: row.accelo_task_id ? String(row.accelo_task_id) : undefined,
    updatedAt: asString(row.updated_at, new Date(0).toISOString()),
    version: asNumber(row.version, 1),
  };
}

export function mapSubtask(value: unknown): TodoSubtask {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    todoId: asString(row.todo_id),
    title: asString(row.title),
    position: asNumber(row.position),
    completedAt: asString(row.completed_at) || undefined,
    completedBy: asString(row.completed_by) || undefined,
    version: asNumber(row.version, 1),
  };
}

export function mapComment(value: unknown): TodoComment {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    todoId: asString(row.todo_id),
    authorId: asString(row.author_id),
    body: asString(row.body),
    createdAt: asString(row.created_at),
    editedAt: row.is_edited ? asString(row.updated_at) || undefined : undefined,
    parentCommentId: asString(row.parent_comment_id) || undefined,
    mentionedProfileIds: asRows(row.comment_mentions)
      .map((mention) => asString(mention.profile_id))
      .filter(Boolean),
    attachments: asRows(row.comment_attachments).map((attachment) => ({
      id: asString(attachment.id),
      title: asString(attachment.title, "Attachment"),
      fileId: asString(attachment.file_id) || undefined,
      externalUrl: asString(attachment.external_url) || undefined,
    })),
  };
}

export function mapMessage(value: unknown): MessagePost {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.subject, "Project update"),
    body: asString(row.body),
    category: asString(
      asRecord(row.metadata).category,
      "update",
    ) as MessagePost["category"],
    authorId: asString(row.sender_id),
    createdAt: asString(row.created_at),
    commentCount: asNumber(row.comment_count),
  };
}

export function mapMilestone(value: unknown): Milestone {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.name),
    dueDate: asString(row.due_date),
    acceloMilestoneId: row.accelo_milestone_id
      ? String(row.accelo_milestone_id)
      : undefined,
  };
}

export function mapChat(value: unknown): ChatMessage {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    authorId: asString(row.profile_id),
    body: asString(row.content),
    createdAt: asString(row.created_at),
  };
}

export function mapDocument(value: unknown): DocumentItem {
  const row = asRecord(value);
  const kind = asString(row.kind) === "file" ? "file" : "doc";
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    title: asString(row.title),
    kind,
    authorId: asString(row.author_id),
    size:
      typeof row.size_bytes === "number"
        ? `${Math.max(1, Math.round(row.size_bytes / 1024))} KB`
        : undefined,
    updatedAt: asString(row.updated_at),
  };
}

export function mapActivity(value: unknown): ActivityFeedItem {
  const row = asRecord(value);
  const actorName = asString(row.actor_name, "P11 team");
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    actorId: asString(row.actor_id),
    verb: asString(row.action),
    object: asString(row.summary, "Project activity"),
    createdAt: asString(row.created_at),
    actorName,
    actorInitials: initials(actorName),
    projectName: asString(row.project_name, "Project"),
  };
}

export function mapTimestampCursor(
  value: unknown,
  timestampKey: "updated_at" | "created_at" = "created_at",
): TimestampCursor | undefined {
  const row = asRecord(value);
  const timestamp = asString(row[timestampKey]);
  const id = asString(row.id);
  return timestamp && id ? { timestamp, id } : undefined;
}

export function mapPositionCursor(value: unknown): PositionCursor | undefined {
  const row = asRecord(value);
  const id = asString(row.id);
  return id
    ? {
        listPosition: asNumber(row.list_position),
        todoPosition: asNumber(row.todo_position),
        id,
      }
    : undefined;
}

export function mapDueCursor(value: unknown): DueCursor | undefined {
  const row = asRecord(value);
  const dueAt = asString(row.due_at);
  const id = asString(row.id);
  return dueAt && id ? { dueAt, id } : undefined;
}
