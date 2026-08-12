import "server-only";

import { Buffer } from "node:buffer";
import { cookies } from "next/headers";

import {
  activityEvents as demoActivity,
  chatMessages as demoChats,
  currentProfile,
  documentItems as demoDocuments,
  messagePosts as demoMessages,
  milestones as demoMilestones,
  profiles as demoProfiles,
  projects as demoProjects,
  todoComments as demoComments,
  todoLists as demoTodoLists,
  todoSubtasks as demoSubtasks,
  todos as demoTodos,
} from "@/lib/demo-data";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import type {
  ActivityPageData,
  DashboardData,
  DueCursor,
  IssueCursor,
  IssueDetailData,
  IssueListFilters,
  MyWorkData,
  ProjectMessagesData,
  ProjectOverviewData,
  ProjectIssuesQuery,
  ProjectsPageData,
  ProjectTodosData,
  TeamData,
  TimestampCursor,
} from "@/lib/project-data/contracts";
import {
  asNumber,
  asRecord,
  asRows,
  mapActivity,
  mapChat,
  mapComment,
  mapDocument,
  mapDueCursor,
  mapIssueCursor,
  mapIssueTransition,
  mapMessage,
  mapMilestone,
  mapProfile,
  mapProject,
  mapSubtask,
  mapTimestampCursor,
  mapTodo,
  mapTodoList,
} from "@/lib/project-data/mappers";
import { createClient } from "@/lib/supabase/server";
import type { Project, Todo, TodoStatus } from "@/lib/types";

async function demoRequested(): Promise<boolean> {
  return (
    isDemoModeAllowed() &&
    (await cookies()).get("p11-demo")?.value === "true"
  );
}

async function callProjectRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  if (!supabase) {
    throw new Error("Supabase is not configured for the production workspace.");
  }
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return asRecord(data);
}

async function mapProjectsWithDetails(value: unknown): Promise<Project[]> {
  const rows = asRows(value);
  const ids = rows.map((row) => String(row.id ?? "")).filter(Boolean);
  if (!ids.length) return [];
  const supabase = await createClient();
  if (!supabase) return rows.map(mapProject);
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id,code,client_id,billing_type,fixed_fee_cents,hourly_rate_cents,billing_cap_cents,commercial_value_cents,billing_cadence,time_rounding_minutes,commercial_currency,accelo_job_id,owner_id,priority,start_date,due_date,budget,currency,archived_at,is_read_only,basecamp_account_id",
    )
    .in("id", ids);
  if (error) throw error;
  const details = new Map(
    (data ?? []).map((project) => [project.id, asRecord(project)]),
  );
  return rows.map((row) =>
    mapProject({
      ...row,
      ...details.get(String(row.id)),
    }),
  );
}

async function mapActivitiesWithDetails(value: unknown) {
  const rows = asRows(value);
  const ids = rows.map((row) => String(row.id ?? "")).filter(Boolean);
  if (!ids.length) return [];
  const supabase = await createClient();
  if (!supabase) return rows.map(mapActivity);
  const { data, error } = await supabase
    .from("activity_events")
    .select("id,entity_type,entity_id,metadata")
    .in("id", ids);
  if (error) throw error;
  const details = new Map(
    (data ?? []).map((event) => [event.id, asRecord(event)]),
  );
  return rows.map((row) =>
    mapActivity({
      ...row,
      ...details.get(String(row.id)),
    }),
  );
}

async function productionOrDemo<T>(
  loadProduction: () => Promise<T>,
  loadDemo: () => T,
): Promise<T> {
  if (await demoRequested()) return loadDemo();
  try {
    return await loadProduction();
  } catch (error) {
    if (!isDemoModeAllowed()) throw error;
    console.warn("Falling back to bounded demo project data:", error);
    return loadDemo();
  }
}

function isTerminalTodo(status: TodoStatus): boolean {
  return status === "completed" || status === "cancelled";
}

function toTeamTodo(todo: Todo): Todo {
  return {
    id: todo.id,
    projectId: todo.projectId,
    listId: todo.listId,
    title: todo.title,
    status: todo.status,
    priority: todo.priority,
    updatedAt: todo.updatedAt,
    ...(todo.assigneeId ? { assigneeId: todo.assigneeId } : {}),
    ...(todo.assigneeIds?.length ? { assigneeIds: todo.assigneeIds } : {}),
    ...(todo.dueDate ? { dueDate: todo.dueDate } : {}),
    ...(todo.issueKey ? { issueKey: todo.issueKey } : {}),
    ...(todo.operationalState
      ? { operationalState: todo.operationalState }
      : {}),
    ...(todo.estimatedMinutes === undefined
      ? {}
      : { estimatedMinutes: todo.estimatedMinutes }),
  };
}

function toDatabaseStatuses(statuses: TodoStatus[] | undefined): string[] | null {
  if (!statuses?.length) return null;
  return statuses.map((status) => {
    if (status === "open") return "todo";
    if (status === "completed") return "done";
    return status;
  });
}

export function encodeIssueCursor(cursor: IssueCursor): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      rank: cursor.rank,
      issueNumber: cursor.issueNumber,
      id: cursor.id,
    }),
  ).toString("base64url");
}

export function decodeIssueCursor(value: string): IssueCursor | undefined {
  if (!/^[A-Za-z0-9_-]{8,512}$/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      typeof parsed.rank !== "string" ||
      !/^[1-9][0-9]*$/.test(parsed.rank) ||
      typeof parsed.issueNumber !== "string" ||
      !/^[1-9][0-9]*$/.test(parsed.issueNumber) ||
      typeof parsed.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(parsed.id)
    ) {
      return undefined;
    }
    return {
      rank: parsed.rank,
      issueNumber: parsed.issueNumber,
      id: parsed.id,
    };
  } catch {
    return undefined;
  }
}

function demoIssues(): Todo[] {
  const projectIssueCounts = new Map<string, number>();
  return demoTodos.map((todo, index) => {
    const issueNumber =
      todo.issueNumber ?? (projectIssueCounts.get(todo.projectId) ?? 0) + 1;
    projectIssueCounts.set(todo.projectId, issueNumber);
    const projectCode =
      todo.issueKey?.split("-").slice(0, -1).join("-") ||
      todo.projectId
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .slice(0, 24);
    return {
      ...todo,
      priority: todo.priority === "normal" ? "medium" : todo.priority,
      issueKey: todo.issueKey ?? `${projectCode}-${issueNumber}`,
      issueNumber,
      issueType: todo.issueType ?? "task",
      rank: todo.rank ?? (index + 1) * 1024,
      operationalState:
        todo.operationalState ??
        (isTerminalTodo(todo.status) ? "historical" : "active"),
      labels: todo.labels ?? [],
      createdAt: todo.createdAt ?? todo.updatedAt,
    };
  });
}

function demoDueDateMatches(todo: Todo, dueState: IssueListFilters["dueState"]) {
  if (!dueState) return true;
  const today = new Date().toISOString().slice(0, 10);
  if (dueState === "no_due_date") return !todo.dueDate;
  if (dueState === "has_due_date") return Boolean(todo.dueDate);
  if (!todo.dueDate || isTerminalTodo(todo.status)) return false;
  if (dueState === "overdue") return todo.dueDate < today;
  if (dueState === "due_today") return todo.dueDate === today;
  const soon = new Date(`${today}T00:00:00.000Z`);
  soon.setUTCDate(soon.getUTCDate() + 7);
  return todo.dueDate >= today && todo.dueDate <= soon.toISOString().slice(0, 10);
}

function filterDemoIssues(todos: Todo[], filters: IssueListFilters): Todo[] {
  const searchText = filters.text?.trim().toLocaleLowerCase();
  return todos.filter((todo) => {
    const assignees = todo.assigneeIds?.length
      ? todo.assigneeIds
      : todo.assigneeId
        ? [todo.assigneeId]
        : [];
    return (
      (!filters.statuses?.length || filters.statuses.includes(todo.status)) &&
      (!filters.priorities?.length ||
        filters.priorities.includes(
          todo.priority === "normal" ? "medium" : todo.priority,
        )) &&
      (!filters.labels?.length ||
        filters.labels.every((label) => todo.labels?.includes(label))) &&
      (!filters.operationalScope?.length ||
        (todo.operationalState !== undefined &&
          filters.operationalScope.includes(todo.operationalState))) &&
      (!filters.assigneeId || assignees.includes(filters.assigneeId)) &&
      (!filters.unassigned || assignees.length === 0) &&
      demoDueDateMatches(todo, filters.dueState) &&
      (!searchText ||
        todo.issueKey?.toLocaleLowerCase().includes(searchText) ||
        todo.title.toLocaleLowerCase().includes(searchText) ||
        todo.description?.toLocaleLowerCase().includes(searchText))
    );
  });
}

function isAfterIssueCursor(todo: Todo, cursor: IssueCursor): boolean {
  const rank = BigInt(todo.rank ?? 0);
  const issueNumber = BigInt(todo.issueNumber ?? 0);
  const cursorRank = BigInt(cursor.rank);
  const cursorIssueNumber = BigInt(cursor.issueNumber);
  return (
    rank > cursorRank ||
    (rank === cursorRank && issueNumber > cursorIssueNumber) ||
    (rank === cursorRank &&
      issueNumber === cursorIssueNumber &&
      todo.id.localeCompare(cursor.id) > 0)
  );
}

function demoActivityFeed(limit: number) {
  return demoActivity.slice(0, limit).map((event) => {
    const actor = demoProfiles.find((profile) => profile.id === event.actorId);
    const project = demoProjects.find((item) => item.id === event.projectId);
    return {
      ...event,
      actorName: actor?.fullName ?? "P11 team",
      actorInitials: actor?.initials ?? "P11",
      projectName: project?.name ?? "Project",
    };
  });
}

function demoDashboard(): DashboardData {
  const openTodos = demoTodos.filter((todo) => !isTerminalTodo(todo.status));
  const now = Date.now();
  return {
    projects: demoProjects.filter((project) => project.status === "active").slice(0, 8),
    activity: demoActivityFeed(5),
    metrics: {
      projectTotal: demoProjects.length,
      activeProjectCount: demoProjects.filter((project) => project.status === "active")
        .length,
      openTodoCount: openTodos.length,
      overdueTodoCount: openTodos.filter(
        (todo) =>
          todo.dueDate &&
          new Date(`${todo.dueDate}T23:59:59`).getTime() < now,
      ).length,
      blockedTodoCount: openTodos.filter((todo) => todo.status === "blocked").length,
    },
    demoMode: true,
  };
}

export async function getDashboardData(
  projectCursor?: TimestampCursor,
  activityCursor?: TimestampCursor,
): Promise<DashboardData> {
  return productionOrDemo<DashboardData>(async () => {
    const row = await callProjectRpc("get_dashboard_project_data", {
      before_project_updated_at: projectCursor?.timestamp ?? null,
      before_project_id: projectCursor?.id ?? null,
      before_activity_created_at: activityCursor?.timestamp ?? null,
      before_activity_id: activityCursor?.id ?? null,
      requested_project_limit: 8,
      requested_activity_limit: 5,
    });
    const metrics = asRecord(row.metrics);
    return {
      projects: await mapProjectsWithDetails(row.projects),
      activity: await mapActivitiesWithDetails(row.activity),
      metrics: {
        projectTotal: asNumber(metrics.project_total),
        activeProjectCount: asNumber(metrics.active_project_count),
        openTodoCount: asNumber(metrics.open_todo_count),
        overdueTodoCount: asNumber(metrics.overdue_todo_count),
        blockedTodoCount: asNumber(metrics.blocked_todo_count),
      },
      nextProjectCursor: mapTimestampCursor(
        row.next_project_cursor,
        "updated_at",
      ),
      nextActivityCursor: mapTimestampCursor(
        row.next_activity_cursor,
        "created_at",
      ),
      demoMode: false,
    };
  }, demoDashboard);
}

export async function getProjectsPageData(
  cursor?: TimestampCursor,
): Promise<ProjectsPageData> {
  return productionOrDemo<ProjectsPageData>(
    async () => {
      const row = await callProjectRpc("get_projects_project_data", {
        before_updated_at: cursor?.timestamp ?? null,
        before_project_id: cursor?.id ?? null,
        requested_limit: 24,
      });
      return {
        projects: await mapProjectsWithDetails(row.projects),
        totalCount: asNumber(row.total_count),
        nextCursor: mapTimestampCursor(row.next_cursor, "updated_at"),
        demoMode: false,
      };
    },
    () => ({
      projects: demoProjects.slice(0, 24),
      totalCount: demoProjects.length,
      demoMode: true,
    }),
  );
}

export async function getProjectOverviewData(
  projectId: string,
): Promise<ProjectOverviewData | null> {
  return productionOrDemo<ProjectOverviewData | null>(
    async () => {
      const [row, supabase] = await Promise.all([
        callProjectRpc("get_project_overview_data", {
          target_project_id: projectId,
          after_milestone_due_date: null,
          after_milestone_id: null,
          requested_milestone_limit: 20,
          requested_document_limit: 50,
          requested_chat_limit: 50,
        }),
        createClient(),
      ]);
      if (!row.project) return null;
      const { data: projectFlags, error: projectFlagsError } = supabase
        ? await supabase
            .from("projects")
            .select(
              "code,client_id,billing_type,fixed_fee_cents,hourly_rate_cents,billing_cap_cents,commercial_value_cents,billing_cadence,time_rounding_minutes,commercial_currency,accelo_job_id,owner_id,priority,start_date,due_date,budget,currency,archived_at,is_read_only,basecamp_account_id",
            )
            .eq("id", projectId)
            .maybeSingle()
        : { data: null, error: null };
      if (projectFlagsError) throw projectFlagsError;
      const counts = asRecord(row.tab_counts);
      const milestoneCursor = asRecord(row.next_milestone_cursor);
      return {
        project: mapProject({
          ...asRecord(row.project),
          ...asRecord(projectFlags),
        }),
        members: asRows(row.members).map(mapProfile),
        milestones: asRows(row.milestones).map(mapMilestone),
        documents: asRows(row.documents).map(mapDocument),
        chats: asRows(row.chats).map(mapChat),
        tabCounts: {
          openTodos: asNumber(counts.open_todos),
          messages: asNumber(counts.messages),
          chats: asNumber(counts.chats),
          documents: asNumber(counts.documents),
        },
        nextMilestoneCursor:
          typeof milestoneCursor.due_date === "string" &&
          typeof milestoneCursor.id === "string"
            ? {
                dueDate: milestoneCursor.due_date,
                id: milestoneCursor.id,
              }
            : undefined,
        demoMode: false,
      };
    },
    () => {
      const project = demoProjects.find((item) => item.id === projectId);
      if (!project) return null;
      return {
        project,
        members: demoProfiles.filter((profile) =>
          project.memberIds.includes(profile.id),
        ),
        milestones: demoMilestones.filter((item) => item.projectId === projectId),
        documents: demoDocuments.filter((item) => item.projectId === projectId),
        chats: demoChats.filter((item) => item.projectId === projectId),
        tabCounts: {
          openTodos: demoTodos.filter(
            (todo) => todo.projectId === projectId && !isTerminalTodo(todo.status),
          ).length,
          messages: demoMessages.filter((item) => item.projectId === projectId).length,
          chats: demoChats.filter((item) => item.projectId === projectId).length,
          documents: demoDocuments.filter((item) => item.projectId === projectId)
            .length,
        },
        demoMode: true,
      };
    },
  );
}

export async function getProjectTodosData(
  projectId: string,
  query: ProjectIssuesQuery = { limit: 50 },
): Promise<ProjectTodosData> {
  return productionOrDemo<ProjectTodosData>(
    async () => {
      const row = await callProjectRpc("get_project_issues_data", {
        target_project_id: projectId,
        after_rank: query.cursor?.rank ?? null,
        after_issue_number: query.cursor?.issueNumber ?? null,
        after_todo_id: query.cursor?.id ?? null,
        requested_limit: query.limit,
        status_filters: toDatabaseStatuses(query.filters?.statuses),
        priority_filters: query.filters?.priorities ?? null,
        label_filters: query.filters?.labels ?? null,
        assignee_filter: query.filters?.assigneeId ?? null,
        unassigned_filter: query.filters?.unassigned ?? false,
        due_state_filter: query.filters?.dueState ?? null,
        text_filter: query.filters?.text ?? null,
        operational_state_filters:
          query.filters?.operationalScope ?? ["active", "triage"],
      });
      const summary = asRecord(row.summary);
      const nextCursor = mapIssueCursor(row.next_cursor);
      const totalCount = asNumber(summary.total_count);
      return {
        todoLists: asRows(row.todo_lists).map(mapTodoList),
        todos: asRows(row.todos).map(mapTodo),
        summary: {
          totalCount,
          activeCount: asNumber(summary.active_count),
          triageCount: asNumber(summary.triage_count),
          historicalCount: asNumber(summary.historical_count),
          blockedCount: asNumber(summary.blocked_count),
          overdueCount: asNumber(summary.overdue_count),
        },
        totalCount,
        hasMore: row.has_more === true,
        nextCursor: nextCursor ? encodeIssueCursor(nextCursor) : undefined,
        demoMode: false,
      };
    },
    () => {
      const filters: IssueListFilters = {
        operationalScope: ["active", "triage"],
        ...query.filters,
      };
      const matchingTodos = filterDemoIssues(
        demoIssues().filter((todo) => todo.projectId === projectId),
        filters,
      ).sort(
        (left, right) =>
          (left.rank ?? 0) - (right.rank ?? 0) ||
          (left.issueNumber ?? 0) - (right.issueNumber ?? 0) ||
          left.id.localeCompare(right.id),
      );
      const cursorFiltered = query.cursor
        ? matchingTodos.filter((todo) => isAfterIssueCursor(todo, query.cursor!))
        : matchingTodos;
      const page = cursorFiltered.slice(0, query.limit);
      const hasMore = cursorFiltered.length > page.length;
      const lastIssue = page.at(-1);
      const nextCursor =
        hasMore && lastIssue?.rank && lastIssue.issueNumber
          ? encodeIssueCursor({
              rank: String(lastIssue.rank),
              issueNumber: String(lastIssue.issueNumber),
              id: lastIssue.id,
            })
          : undefined;
      const summary = {
        totalCount: matchingTodos.length,
        activeCount: matchingTodos.filter(
          (todo) => todo.operationalState === "active",
        ).length,
        triageCount: matchingTodos.filter(
          (todo) => todo.operationalState === "triage",
        ).length,
        historicalCount: matchingTodos.filter(
          (todo) => todo.operationalState === "historical",
        ).length,
        blockedCount: matchingTodos.filter((todo) => todo.status === "blocked")
          .length,
        overdueCount: matchingTodos.filter((todo) =>
          demoDueDateMatches(todo, "overdue"),
        ).length,
      };
      return {
        todoLists: demoTodoLists
          .filter((list) => list.projectId === projectId)
          .map((list) => ({
            ...list,
            issueCount: matchingTodos.filter((todo) => todo.listId === list.id)
              .length,
          })),
        todos: page,
        summary,
        totalCount: summary.totalCount,
        hasMore,
        nextCursor,
        demoMode: true,
      };
    },
  );
}

export async function getIssueDetailData(
  todoId: string,
): Promise<IssueDetailData | null> {
  return productionOrDemo<IssueDetailData | null>(
    async () => {
      const row = await callProjectRpc("get_issue_detail_data", {
        target_todo_id: todoId,
      });
      if (!row.issue) return null;
      return {
        todo: mapTodo(row.issue),
        subtasks: asRows(row.subtasks).map(mapSubtask),
        comments: asRows(row.comments).map(mapComment),
        transitions: asRows(row.transitions).map(mapIssueTransition),
        demoMode: false,
      };
    },
    () => {
      const todo = demoIssues().find((item) => item.id === todoId);
      if (!todo) return null;
      return {
        todo,
        subtasks: demoSubtasks.filter((subtask) => subtask.todoId === todoId),
        comments: demoComments.filter((comment) => comment.todoId === todoId),
        transitions: [],
        demoMode: true,
      };
    },
  );
}

export async function getProjectMessagesData(
  projectId: string,
  cursor?: TimestampCursor,
): Promise<ProjectMessagesData> {
  return productionOrDemo<ProjectMessagesData>(
    async () => {
      const row = await callProjectRpc("get_project_messages_data", {
        target_project_id: projectId,
        before_created_at: cursor?.timestamp ?? null,
        before_message_id: cursor?.id ?? null,
        requested_limit: 50,
      });
      return {
        messages: asRows(row.messages).map(mapMessage),
        nextCursor: mapTimestampCursor(row.next_cursor, "created_at"),
        demoMode: false,
      };
    },
    () => ({
      messages: demoMessages.filter((message) => message.projectId === projectId),
      demoMode: true,
    }),
  );
}

export async function getMyWorkData(
  cursor?: DueCursor,
): Promise<MyWorkData> {
  return productionOrDemo<MyWorkData>(
    async () => {
      const row = await callProjectRpc("get_my_work_project_data", {
        after_due_at: cursor?.dueAt ?? null,
        after_todo_id: cursor?.id ?? null,
        requested_limit: 100,
      });
      return {
        todos: asRows(row.todos).map(mapTodo),
        projects: await mapProjectsWithDetails(row.projects),
        nextCursor: mapDueCursor(row.next_cursor),
        demoMode: false,
      };
    },
    () => {
      const todos = demoTodos
        .filter(
          (todo) =>
            (todo.assigneeId === currentProfile.id ||
              todo.assigneeIds?.includes(currentProfile.id)) &&
            !isTerminalTodo(todo.status),
        )
        .slice(0, 100);
      const projectIds = new Set(todos.map((todo) => todo.projectId));
      return {
        todos,
        projects: demoProjects.filter((project) => projectIds.has(project.id)),
        demoMode: true,
      };
    },
  );
}

export async function getTeamData(cursor?: DueCursor): Promise<TeamData> {
  return productionOrDemo<TeamData>(
    async () => {
      const row = await callProjectRpc("get_team_project_data", {
        after_due_at: cursor?.dueAt ?? null,
        after_todo_id: cursor?.id ?? null,
        requested_limit: 500,
      });
      return {
        profiles: asRows(row.profiles).map(mapProfile),
        projects: asRows(row.projects).map(mapProject),
        todos: asRows(row.todos).map(mapTodo).map(toTeamTodo),
        milestones: asRows(row.milestones).map(mapMilestone),
        nextCursor: mapDueCursor(row.next_cursor),
        demoMode: false,
      };
    },
    () => ({
      profiles: demoProfiles,
      projects: demoProjects,
      todos: demoTodos
        .filter((todo) => !isTerminalTodo(todo.status))
        .slice(0, 500)
        .map(toTeamTodo),
      milestones: demoMilestones,
      demoMode: true,
    }),
  );
}

export async function getActivityPageData(
  cursor?: TimestampCursor,
): Promise<ActivityPageData> {
  return productionOrDemo<ActivityPageData>(
    async () => {
      const row = await callProjectRpc("get_activity_project_data", {
        before_created_at: cursor?.timestamp ?? null,
        before_activity_id: cursor?.id ?? null,
        requested_limit: 50,
      });
      return {
        activity: await mapActivitiesWithDetails(row.activity),
        nextCursor: mapTimestampCursor(row.next_cursor, "created_at"),
        demoMode: false,
      };
    },
    () => ({
      activity: demoActivityFeed(50),
      demoMode: true,
    }),
  );
}
