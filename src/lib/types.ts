export type ProjectStatus = "active" | "on_hold" | "completed";
export type WorkloadLevel = "light" | "normal" | "heavy";
export type TodoStatus = "open" | "in_progress" | "blocked" | "completed";

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
}

export interface Project {
  id: string;
  name: string;
  client: string;
  description: string;
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
  priority: "low" | "normal" | "high";
  acceloTaskId?: string;
  updatedAt: string;
  version?: number;
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
  dueDate: string;
  acceloMilestoneId?: string;
}

export interface ActivityEvent {
  id: string;
  projectId: string;
  actorId: string;
  verb: string;
  object: string;
  createdAt: string;
}
