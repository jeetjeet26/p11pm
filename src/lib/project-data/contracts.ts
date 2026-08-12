import type {
  ActivityEvent,
  ChatMessage,
  DocumentItem,
  IssueStatusTransition,
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

export interface TimestampCursor {
  timestamp: string;
  id: string;
}

export interface PositionCursor {
  listPosition: number;
  todoPosition: number;
  id: string;
}

export interface IssueCursor {
  rank: string;
  issueNumber: string;
  id: string;
}

export interface DueCursor {
  dueAt: string;
  id: string;
}

export type IssueDueState =
  | "overdue"
  | "due_today"
  | "due_soon"
  | "no_due_date"
  | "has_due_date";

export interface IssueListFilters {
  statuses?: TodoStatus[];
  priorities?: TodoPriority[];
  labels?: string[];
  assigneeId?: string;
  unassigned?: boolean;
  dueState?: IssueDueState;
  text?: string;
  operationalScope?: OperationalState[];
}

export interface ProjectIssuesQuery {
  limit: number;
  cursor?: IssueCursor;
  filters?: IssueListFilters;
}

export interface ActivityFeedItem extends ActivityEvent {
  actorName: string;
  actorInitials: string;
  projectName: string;
}

export interface DashboardData {
  projects: Project[];
  activity: ActivityFeedItem[];
  metrics: {
    projectTotal: number;
    activeProjectCount: number;
    openTodoCount: number;
    overdueTodoCount: number;
    blockedTodoCount: number;
  };
  nextProjectCursor?: TimestampCursor;
  nextActivityCursor?: TimestampCursor;
  demoMode: boolean;
}

export interface ProjectsPageData {
  projects: Project[];
  totalCount: number;
  nextCursor?: TimestampCursor;
  demoMode: boolean;
}

export interface ProjectOverviewData {
  project: Project;
  members: Profile[];
  milestones: Milestone[];
  documents: DocumentItem[];
  chats: ChatMessage[];
  tabCounts: {
    openTodos: number;
    messages: number;
    chats: number;
    documents: number;
  };
  nextMilestoneCursor?: {
    dueDate: string;
    id: string;
  };
  demoMode: boolean;
}

export interface ProjectTodosData {
  todoLists: TodoList[];
  todos: Todo[];
  summary: {
    totalCount: number;
    activeCount: number;
    triageCount: number;
    historicalCount: number;
    blockedCount: number;
    overdueCount: number;
  };
  totalCount?: number;
  hasMore?: boolean;
  nextCursor?: string;
  demoMode: boolean;
}

export interface IssueDetailData {
  todo: Todo;
  subtasks: TodoSubtask[];
  comments: TodoComment[];
  transitions: IssueStatusTransition[];
  demoMode: boolean;
}

export interface ProjectMessagesData {
  messages: MessagePost[];
  nextCursor?: TimestampCursor;
  demoMode: boolean;
}

export interface MyWorkData {
  todos: Todo[];
  projects: Project[];
  nextCursor?: DueCursor;
  demoMode: boolean;
}

export interface TeamData {
  profiles: Profile[];
  projects: Project[];
  todos: Todo[];
  milestones: Milestone[];
  nextCursor?: DueCursor;
  demoMode: boolean;
}

export interface ActivityPageData {
  activity: ActivityFeedItem[];
  nextCursor?: TimestampCursor;
  demoMode: boolean;
}
