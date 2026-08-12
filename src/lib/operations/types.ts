export type InboxKind =
  | "mention"
  | "assignment"
  | "thread_reply"
  | "approval"
  | "due"
  | "overdue"
  | "blocker"
  | "watch"
  | "automation"
  | "integration";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body?: string;
  href: string;
  projectId?: string;
  priority: "low" | "normal" | "high" | "urgent";
  readAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  snoozedUntil?: string;
  createdAt: string;
}

export interface WorkDecision {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  rationale?: string;
  status: "proposed" | "active" | "superseded" | "reversed";
  ownerId?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  decidedAt: string;
}

export interface WorkApproval {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  subjectType: "project" | "issue" | "decision" | "doc" | "file" | "milestone";
  subjectId: string;
  requestedBy: string;
  reviewerId: string;
  status:
    | "pending"
    | "approved"
    | "changes_requested"
    | "rejected"
    | "cancelled";
  responseNote?: string;
  dueAt?: string;
  createdAt: string;
}

export interface IssueDependency {
  id: string;
  projectId: string;
  predecessorTodoId: string;
  successorTodoId: string;
  relationship: "blocks" | "relates_to" | "duplicates" | "parent";
  reason?: string;
  createdAt: string;
}

export interface WorkCycle {
  id: string;
  projectId?: string;
  name: string;
  goal?: string;
  startsOn: string;
  endsOn: string;
  status: "planned" | "active" | "completed" | "cancelled";
}

export interface ConversationBrief {
  conversationId: string;
  projectId?: string;
  summary: string;
  decisions: string[];
  actions: string[];
  blockers: string[];
  openQuestions: string[];
  citations: Array<{ messageId: string; href: string; excerpt: string }>;
  sourceMessageCount: number;
  updatedAt: string;
}
