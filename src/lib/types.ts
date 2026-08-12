export type ProjectStatus =
  | "planning"
  | "active"
  | "on_hold"
  | "completed"
  | "cancelled";
export type ProjectBillingType =
  | "time_and_materials"
  | "fixed_fee"
  | "internal";
export type WorkloadLevel = "light" | "normal" | "heavy";
export type TodoStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "review"
  | "completed"
  | "cancelled";
export type TodoPriority = "low" | "medium" | "high" | "urgent";
export type IssueType = "task" | "story" | "bug" | "epic";
export type OperationalState = "active" | "triage" | "historical";

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  initials: string;
  role: "admin" | "manager" | "member" | "viewer";
  jobTitle: string;
  active: boolean;
  isInternal: boolean;
  acceloStaffId?: string;
  slackUserId?: string;
  timeZone?: string;
  weeklyCapacityMinutes?: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  clientId?: string;
  description: string;
  code?: string;
  ownerId?: string;
  priority?: TodoPriority;
  startDate?: string;
  dueDate?: string;
  budget?: number;
  currency?: string;
  billingType?: ProjectBillingType;
  fixedFee?: number;
  hourlyRate?: number;
  billingCap?: number;
  commercialValue?: number;
  billingCadence?: "weekly" | "monthly" | "quarterly" | "milestone" | "completion";
  timeRoundingMinutes?: 1 | 5 | 6 | 10 | 15 | 30 | 60;
  archivedAt?: string;
  status: ProjectStatus;
  color: string;
  acceloJobId?: string;
  slackChannel?: string;
  isReadOnly?: boolean;
  sourceSystem?: string;
  progress: number;
  updatedAt: string;
  memberIds: string[];
}

export interface TodoList {
  id: string;
  projectId: string;
  name: string;
  position: number;
  issueCount?: number;
}

export interface Todo {
  id: string;
  projectId: string;
  listId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  assigneeIds?: string[];
  completionSubscriberIds?: string[];
  dueDate?: string;
  status: TodoStatus;
  /** `normal` remains a temporary display alias for legacy demo/UI data. */
  priority: TodoPriority | "normal";
  issueKey?: string;
  issueNumber?: number;
  issueType?: IssueType;
  rank?: number;
  operationalState?: OperationalState;
  labels?: string[];
  estimatedMinutes?: number;
  actualMinutes?: number;
  milestoneId?: string;
  cycleId?: string;
  riskLevel?: "none" | "low" | "medium" | "high";
  riskReason?: string;
  acceloTaskId?: string;
  createdAt?: string;
  completedAt?: string;
  sourceCreatedAt?: string;
  updatedAt: string;
  version?: number;
}

export interface IssueStatusTransition {
  id: string;
  todoId: string;
  fromStatus: TodoStatus;
  toStatus: TodoStatus;
  actorId?: string;
  issueVersion: number;
  createdAt: string;
}

export interface TodoSubtask {
  id: string;
  todoId: string;
  title: string;
  position: number;
  completedAt?: string;
  completedBy?: string;
  version?: number;
}

export interface CommentAttachment {
  id: string;
  title: string;
  fileId?: string;
  externalUrl?: string;
}

export interface TodoComment {
  id: string;
  todoId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  parentCommentId?: string;
  mentionedProfileIds: string[];
  attachments: CommentAttachment[];
}

export interface MessagePost {
  id: string;
  projectId: string;
  title: string;
  body: string;
  category: "update" | "decision" | "creative" | "client";
  authorId: string;
  createdAt: string;
  commentCount: number;
}

export interface ChatMessage {
  id: string;
  projectId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  projectId: string;
  title: string;
  kind: "doc" | "file";
  authorId: string;
  size?: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status?: "upcoming" | "in_progress" | "completed" | "missed" | "cancelled";
  ownerId?: string;
  completedAt?: string;
  dueDate: string;
  position?: number;
  riskLevel?: "none" | "low" | "medium" | "high";
  riskReason?: string;
  acceloMilestoneId?: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  actorId: string;
  verb: string;
  object: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
