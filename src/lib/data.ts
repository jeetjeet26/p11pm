import "server-only";

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
  MyWorkData,
  PositionCursor,
  ProjectMessagesData,
  ProjectOverviewData,
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
  mapMessage,
  mapMilestone,
  mapPositionCursor,
  mapProfile,
  mapProject,
  mapSubtask,
  mapTimestampCursor,
  mapTodo,
  mapTodoList,
} from "@/lib/project-data/mappers";
import { createClient } from "@/lib/supabase/server";

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
  const openTodos = demoTodos.filter((todo) => todo.status !== "completed");
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
      projects: asRows(row.projects).map(mapProject),
      activity: asRows(row.activity).map(mapActivity),
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
        projects: asRows(row.projects).map(mapProject),
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
      const row = await callProjectRpc("get_project_overview_data", {
        target_project_id: projectId,
        after_milestone_due_date: null,
        after_milestone_id: null,
        requested_milestone_limit: 20,
        requested_document_limit: 50,
        requested_chat_limit: 50,
      });
      if (!row.project) return null;
      const counts = asRecord(row.tab_counts);
      const milestoneCursor = asRecord(row.next_milestone_cursor);
      return {
        project: mapProject(row.project),
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
            (todo) => todo.projectId === projectId && todo.status !== "completed",
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
  cursor?: PositionCursor,
): Promise<ProjectTodosData> {
  return productionOrDemo<ProjectTodosData>(
    async () => {
      const row = await callProjectRpc("get_project_todos_data", {
        target_project_id: projectId,
        after_list_position: cursor?.listPosition ?? null,
        after_todo_position: cursor?.todoPosition ?? null,
        after_todo_id: cursor?.id ?? null,
        requested_limit: 100,
      });
      return {
        todoLists: asRows(row.todo_lists).map(mapTodoList),
        todos: asRows(row.todos).map(mapTodo),
        todoSubtasks: asRows(row.subtasks).map(mapSubtask),
        todoComments: asRows(row.comments).map(mapComment),
        nextCursor: mapPositionCursor(row.next_cursor),
        demoMode: false,
      };
    },
    () => {
      const todos = demoTodos.filter((todo) => todo.projectId === projectId);
      const todoIds = new Set(todos.map((todo) => todo.id));
      return {
        todoLists: demoTodoLists.filter((list) => list.projectId === projectId),
        todos,
        todoSubtasks: demoSubtasks.filter((subtask) => todoIds.has(subtask.todoId)),
        todoComments: demoComments.filter((comment) => todoIds.has(comment.todoId)),
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
        projects: asRows(row.projects).map(mapProject),
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
            todo.status !== "completed",
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
        requested_limit: 300,
      });
      return {
        profiles: asRows(row.profiles).map(mapProfile),
        projects: asRows(row.projects).map(mapProject),
        todos: asRows(row.todos).map(mapTodo),
        milestones: asRows(row.milestones).map(mapMilestone),
        nextCursor: mapDueCursor(row.next_cursor),
        demoMode: false,
      };
    },
    () => ({
      profiles: demoProfiles,
      projects: demoProjects,
      todos: demoTodos.filter((todo) => todo.status !== "completed").slice(0, 300),
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
        activity: asRows(row.activity).map(mapActivity),
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
