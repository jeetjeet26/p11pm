import type {
  ActivityFeedItem,
  DueCursor,
  IssueCursor,
  PositionCursor,
  TimestampCursor,
} from "@/lib/project-data/contracts";
import type {
  ChatMessage,
  DocumentItem,
  IssueStatusTransition,
  IssueType,
  MessagePost,
  Milestone,
  OperationalState,
  Profile,
  Project,
  Todo,
  TodoComment,
  TodoList,
  TodoPriority,
  TodoStatus,
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

export function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
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
    timeZone: asString(row.timezone) || undefined,
    weeklyCapacityMinutes:
      typeof row.weekly_capacity_minutes === "number"
        ? row.weekly_capacity_minutes
        : undefined,
  };
}

export function mapProject(value: unknown): Project {
  const row = asRecord(value);
  const metadata = asRecord(row.metadata);
  const sourceStatus = asString(row.status, "active");
  const status: Project["status"] = [
    "planning",
    "active",
    "on_hold",
    "completed",
    "cancelled",
  ].includes(sourceStatus)
    ? (sourceStatus as Project["status"])
    : "active";
  const priority = mapTodoPriority(row.priority);
  return {
    id: asString(row.id),
    name: asString(row.name),
    client: asString(row.client_name, "P11 client"),
    clientId: asString(row.client_id) || undefined,
    description: asString(row.description),
    status,
    code: asString(row.code) || undefined,
    ownerId: asString(row.owner_id) || undefined,
    priority,
    startDate: asString(row.start_date).slice(0, 10) || undefined,
    dueDate: asString(row.due_date).slice(0, 10) || undefined,
    budget: asOptionalNumber(row.budget),
    currency:
      asString(row.commercial_currency) || asString(row.currency) || undefined,
    billingType:
      row.billing_type === "fixed_fee" || row.billing_type === "internal"
        ? row.billing_type
        : "time_and_materials",
    fixedFee:
      asOptionalNumber(row.fixed_fee_cents) === undefined
        ? undefined
        : Number(row.fixed_fee_cents) / 100,
    hourlyRate:
      asOptionalNumber(row.hourly_rate_cents) === undefined
        ? undefined
        : Number(row.hourly_rate_cents) / 100,
    billingCap:
      asOptionalNumber(row.billing_cap_cents) === undefined
        ? undefined
        : Number(row.billing_cap_cents) / 100,
    commercialValue:
      asOptionalNumber(row.commercial_value_cents) === undefined
        ? undefined
        : Number(row.commercial_value_cents) / 100,
    billingCadence:
      row.billing_cadence === "weekly" ||
      row.billing_cadence === "monthly" ||
      row.billing_cadence === "quarterly" ||
      row.billing_cadence === "milestone" ||
      row.billing_cadence === "completion"
        ? row.billing_cadence
        : undefined,
    timeRoundingMinutes:
      row.time_rounding_minutes === 1 ||
      row.time_rounding_minutes === 5 ||
      row.time_rounding_minutes === 6 ||
      row.time_rounding_minutes === 10 ||
      row.time_rounding_minutes === 15 ||
      row.time_rounding_minutes === 30 ||
      row.time_rounding_minutes === 60
        ? row.time_rounding_minutes
        : undefined,
    archivedAt: asString(row.archived_at) || undefined,
    color: asString(metadata.color, "bg-sky-500"),
    acceloJobId:
      asString(row.accelo_job_id) ||
      (metadata.accelo_job_id ? String(metadata.accelo_job_id) : undefined),
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
  const issueCount = asOptionalNumber(row.issue_count);
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    name: asString(row.title),
    position: asNumber(row.position),
    ...(issueCount === undefined ? {} : { issueCount }),
  };
}

export function mapTodoStatus(value: unknown): TodoStatus {
  const statusMap: Record<string, TodoStatus> = {
    todo: "open",
    open: "open",
    in_progress: "in_progress",
    blocked: "blocked",
    review: "review",
    done: "completed",
    completed: "completed",
    cancelled: "cancelled",
  };
  return statusMap[asString(value, "todo")] ?? "open";
}

function mapTodoPriority(value: unknown): TodoPriority {
  const priority = asString(value, "medium");
  return priority === "low" ||
    priority === "medium" ||
    priority === "high" ||
    priority === "urgent"
    ? priority
    : "medium";
}

function mapIssueType(value: unknown): IssueType {
  const issueType = asString(value, "task");
  return issueType === "story" || issueType === "bug" || issueType === "epic"
    ? issueType
    : "task";
}

function mapOperationalState(value: unknown): OperationalState {
  const operationalState = asString(value, "active");
  return operationalState === "triage" || operationalState === "historical"
    ? operationalState
    : "active";
}

export function mapTodo(value: unknown): Todo {
  const row = asRecord(value);
  const assigneeIds = asStrings(row.assignee_ids);
  const issueNumber = asOptionalNumber(row.issue_number);
  const rank = asOptionalNumber(row.rank);
  const estimatedMinutes = asOptionalNumber(row.estimated_minutes);
  const actualMinutes = asOptionalNumber(row.actual_minutes);
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
    status: mapTodoStatus(row.status),
    priority: mapTodoPriority(row.priority),
    issueKey: asString(row.issue_key) || undefined,
    issueNumber,
    issueType: mapIssueType(row.issue_type),
    rank,
    operationalState: mapOperationalState(row.operational_state),
    labels: asStrings(row.labels),
    estimatedMinutes,
    actualMinutes,
    milestoneId: asString(row.milestone_id) || undefined,
    cycleId: asString(row.cycle_id) || undefined,
    riskLevel:
      (asString(row.risk_level, "none") as Todo["riskLevel"]) ?? "none",
    riskReason: asString(row.risk_reason) || undefined,
    acceloTaskId: row.accelo_task_id ? String(row.accelo_task_id) : undefined,
    createdAt: asString(row.created_at, new Date(0).toISOString()),
    completedAt: asString(row.completed_at) || undefined,
    sourceCreatedAt: asString(row.source_created_at) || undefined,
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

export function mapIssueTransition(value: unknown): IssueStatusTransition {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    todoId: asString(row.todo_id),
    fromStatus: mapTodoStatus(row.from_status),
    toStatus: mapTodoStatus(row.to_status),
    actorId: asString(row.actor_id) || undefined,
    issueVersion: asNumber(row.issue_version, 1),
    createdAt: asString(row.created_at, new Date(0).toISOString()),
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
    description: asString(row.description) || undefined,
    status: asString(row.status, "planned") as Milestone["status"],
    ownerId: asString(row.owner_id) || undefined,
    completedAt: asString(row.completed_at) || undefined,
    dueDate: asString(row.due_date),
    position: asOptionalNumber(row.position),
    riskLevel: asString(row.risk_level, "none") as Milestone["riskLevel"],
    riskReason: asString(row.risk_reason) || undefined,
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
    entityType: asString(row.entity_type) || undefined,
    entityId: asString(row.entity_id) || undefined,
    metadata: asRecord(row.metadata),
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

export function mapIssueCursor(value: unknown): IssueCursor | undefined {
  const row = asRecord(value);
  const rank = asString(row.rank);
  const issueNumber = asString(row.issue_number);
  const id = asString(row.id);
  return rank && issueNumber && id ? { rank, issueNumber, id } : undefined;
}

export function mapDueCursor(value: unknown): DueCursor | undefined {
  const row = asRecord(value);
  const dueAt = asString(row.due_at);
  const id = asString(row.id);
  return dueAt && id ? { dueAt, id } : undefined;
}
