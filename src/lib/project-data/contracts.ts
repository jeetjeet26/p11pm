import type {
  ActivityEvent,
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

export interface TimestampCursor {
  timestamp: string;
  id: string;
}

export interface PositionCursor {
  listPosition: number;
  todoPosition: number;
  id: string;
}

export interface DueCursor {
  dueAt: string;
  id: string;
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
  todoSubtasks: TodoSubtask[];
  todoComments: TodoComment[];
  nextCursor?: PositionCursor;
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
