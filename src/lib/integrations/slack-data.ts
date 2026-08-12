import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppSupabaseClient } from "@/lib/integrations/supabase";

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  description: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  organization_id: string;
}

interface TodoRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  due_at: string | null;
}

function database(): SupabaseClient {
  const client = getAppSupabaseClient();
  if (!client) {
    throw new Error(
      "P11 PM database is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return client;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function findProject(reference: string): Promise<ProjectRow> {
  const client = database();
  const organizationId = await slackOrganizationId();
  let query = client
    .from("projects")
    .select("id,name,status,description")
    .eq("organization_id", organizationId)
    .limit(1);

  query = isUuid(reference)
    ? query.eq("id", reference)
    : query.ilike("name", reference.trim());

  const { data, error } = await query.maybeSingle<ProjectRow>();
  if (error) throw error;
  if (!data) {
    throw new Error(`No project matched "${reference}".`);
  }
  return data;
}

async function findSlackProfile(
  slackUserId: string,
): Promise<ProfileRow | null> {
  const organizationId = await slackOrganizationId();
  const { data, error } = await database()
    .from("profiles")
    .select("id,full_name,organization_id")
    .eq("organization_id", organizationId)
    .contains("preferences", { slack_user_id: slackUserId })
    .maybeSingle<ProfileRow>();

  if (error) throw error;
  return data;
}

export async function createTaskFromSlack(input: {
  projectReference: string;
  title: string;
  description?: string;
  slackUserId?: string;
}): Promise<{ id: string; project: ProjectRow }> {
  const client = database();
  const project = await findProject(input.projectReference);
  const profile = input.slackUserId
    ? await findSlackProfile(input.slackUserId)
    : null;

  const { data, error } = await client.rpc("create_project_todo", {
    target_project_id: project.id,
    target_todo_list_id: null,
    target_title: input.title.trim(),
    target_description: input.description?.trim() || null,
    target_assignee_ids: profile ? [profile.id] : [],
    target_completion_subscriber_ids: [],
    target_due_at: null,
    target_priority: "medium",
    requested_actor_id: profile?.id ?? null,
    target_idempotency_key: randomUUID(),
  });

  if (error) throw error;
  return { id: String((data as { id: unknown }).id), project };
}

export async function formatMyTasks(slackUserId: string): Promise<string> {
  const client = database();
  const profile = await findSlackProfile(slackUserId);
  if (!profile) {
    return "Your Slack account is not linked to a P11 PM profile.";
  }

  const { data: assignments, error: assignmentsError } = await client
    .from("todo_assignees")
    .select("todo_id")
    .eq("profile_id", profile.id)
    .limit(2_000);
  if (assignmentsError) throw assignmentsError;
  const assignedIds = (assignments ?? []).map((assignment) => assignment.todo_id);
  let query = client
    .from("todos")
    .select("id,project_id,title,status,due_at")
    .not("status", "in", '("done","cancelled")')
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(20);
  query = assignedIds.length
    ? query.or(`assigned_to.eq.${profile.id},id.in.(${assignedIds.join(",")})`)
    : query.eq("assigned_to", profile.id);
  const { data, error } = await query.returns<TodoRow[]>();
  if (error) throw error;
  if (!data?.length) return "You have no open P11 PM tasks.";

  const projectIds = [...new Set(data.map((todo) => todo.project_id))];
  const { data: projects, error: projectsError } = await client
    .from("projects")
    .select("id,name")
    .eq("organization_id", profile.organization_id)
    .in("id", projectIds)
    .returns<Array<{ id: string; name: string }>>();
  if (projectsError) throw projectsError;

  const projectNames = new Map(
    (projects ?? []).map((project) => [project.id, project.name]),
  );
  const lines = data.map((todo) => {
    const due = todo.due_at ? ` — due ${todo.due_at.slice(0, 10)}` : "";
    return `• ${todo.title} (${projectNames.get(todo.project_id) ?? "Project"})${due}`;
  });

  return `*${profile.full_name ?? "Your"} open tasks*\n${lines.join("\n")}`;
}

async function slackOrganizationId() {
  const configured = process.env.SLACK_ORGANIZATION_ID;
  if (configured) return configured;
  const { data, error } = await database()
    .from("organizations")
    .select("id")
    .limit(2);
  if (error) throw error;
  if (data?.length !== 1) {
    throw new Error(
      "Set SLACK_ORGANIZATION_ID when more than one organization exists.",
    );
  }
  return data[0].id;
}

export async function formatProjectStatus(
  projectReference: string,
): Promise<string> {
  const client = database();
  const project = await findProject(projectReference);
  const [{ count: openCount, error: openError }, { count: doneCount, error: doneError }] =
    await Promise.all([
      client
        .from("todos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id)
        .not("status", "in", '("done","cancelled")'),
      client
        .from("todos")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id)
        .eq("status", "done"),
    ]);

  if (openError) throw openError;
  if (doneError) throw doneError;
  const total = (openCount ?? 0) + (doneCount ?? 0);
  const progress = total ? Math.round(((doneCount ?? 0) / total) * 100) : 0;

  return [
    `*${project.name}* — ${project.status.replaceAll("_", " ")}`,
    `${progress}% complete · ${openCount ?? 0} open · ${doneCount ?? 0} completed`,
    project.description?.trim() || null,
  ]
    .filter(Boolean)
    .join("\n");
}
