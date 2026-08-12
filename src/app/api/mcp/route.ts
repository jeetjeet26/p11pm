import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

import { getAppSupabaseClient } from "@/lib/integrations/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuid = z.uuid();
const todoStatus = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
  "cancelled",
]);
const todoPriority = z.enum(["low", "medium", "high", "urgent"]);
const projectStatus = z.enum([
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
]);

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error("MCP tool failed", error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `P11 PM error: ${message}` }],
  };
}

function database() {
  const client = getAppSupabaseClient();
  if (!client) {
    throw new Error(
      "Database is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return client;
}

interface McpScope {
  organizationId: string;
  scopes: Set<string>;
}

const mcpScope = new AsyncLocalStorage<McpScope>();

function currentScope() {
  const scope = mcpScope.getStore();
  if (!scope) throw new Error("MCP request scope is unavailable.");
  return scope;
}

function requireScope(...allowed: string[]) {
  const scope = currentScope();
  if (!allowed.some((permission) => scope.scopes.has(permission))) {
    throw new Error(`This token requires one of: ${allowed.join(", ")}.`);
  }
  return scope;
}

async function assertProjectScope(projectId: string) {
  const { organizationId } = currentScope();
  const { data, error } = await database()
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error || !data) throw new Error("Project is outside this token's scope.");
}

async function scopedProjectIds() {
  const { organizationId } = currentScope();
  const { data, error } = await database()
    .from("projects")
    .select("id")
    .eq("organization_id", organizationId)
    .limit(5_000);
  if (error) throw error;
  return (data ?? []).map((project) => project.id);
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_projects",
      {
        title: "List projects",
        description: "List P11 PM projects, optionally filtered by status.",
        inputSchema: z.object({
          status: projectStatus.optional(),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      },
      async ({ status, limit }) => {
        try {
          const { organizationId } = requireScope("projects:read");
          let query = database()
            .from("projects")
            .select(
              "id,name,code,client_name,description,status,metadata,created_at,updated_at",
            )
            .eq("organization_id", organizationId)
            .order("updated_at", { ascending: false })
            .limit(limit);
          if (status) query = query.eq("status", status);
          const { data, error } = await query;
          if (error) throw error;
          return textResult(data ?? []);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "search_projects",
      {
        title: "Search projects",
        description: "Search project names and descriptions.",
        inputSchema: z.object({
          query: z.string().trim().min(1).max(200),
          limit: z.number().int().min(1).max(50).default(20),
        }),
      },
      async ({ query, limit }) => {
        try {
          const { organizationId } = requireScope("projects:read");
          const client = database();
          const fields =
            "id,name,code,client_name,description,status,metadata,updated_at";
          const [nameMatches, descriptionMatches] = await Promise.all([
            client
              .from("projects")
              .select(fields)
              .eq("organization_id", organizationId)
              .ilike("name", `%${query}%`)
              .order("updated_at", { ascending: false })
              .limit(limit),
            client
              .from("projects")
              .select(fields)
              .eq("organization_id", organizationId)
              .ilike("description", `%${query}%`)
              .order("updated_at", { ascending: false })
              .limit(limit),
          ]);
          if (nameMatches.error) throw nameMatches.error;
          if (descriptionMatches.error) throw descriptionMatches.error;

          const matches = new Map<string, Record<string, unknown>>();
          for (const project of [
            ...(nameMatches.data ?? []),
            ...(descriptionMatches.data ?? []),
          ]) {
            matches.set(String(project.id), project);
          }
          return textResult([...matches.values()].slice(0, limit));
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "project_status",
      {
        title: "Get project status",
        description:
          "Summarize a project with task counts and upcoming milestones.",
        inputSchema: z.object({ projectId: uuid }),
      },
      async ({ projectId }) => {
        try {
          const { organizationId } = requireScope(
            "projects:read",
            "issues:read",
          );
          const client = database();
          const [
            { data: project, error: projectError },
            { data: todos, error: todosError },
            { data: milestones, error: milestonesError },
          ] = await Promise.all([
            client
              .from("projects")
              .select("id,name,code,client_name,description,status,metadata,updated_at")
              .eq("id", projectId)
              .eq("organization_id", organizationId)
              .single(),
            client
              .from("todos")
              .select("id,title,status,priority,due_at,assigned_to")
              .eq("project_id", projectId),
            client
              .from("milestones")
              .select("id,name,description,status,due_date")
              .eq("project_id", projectId)
              .order("due_date", { ascending: true })
              .limit(10),
          ]);
          if (projectError) throw projectError;
          if (todosError) throw todosError;
          if (milestonesError) throw milestonesError;

          const taskRows = todos ?? [];
          const completed = taskRows.filter(
            (todo) => todo.status === "done",
          ).length;
          return textResult({
            project,
            taskSummary: {
              total: taskRows.length,
              completed,
              open: taskRows.length - completed,
              progressPercent: taskRows.length
                ? Math.round((completed / taskRows.length) * 100)
                : 0,
            },
            upcomingMilestones: milestones ?? [],
          });
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "list_todos",
      {
        title: "List todos",
        description: "List P11 PM todos with optional project and status filters.",
        inputSchema: z.object({
          projectId: uuid.optional(),
          assigneeId: uuid.optional(),
          status: todoStatus.optional(),
          limit: z.number().int().min(1).max(200).default(100),
        }),
      },
      async ({ projectId, assigneeId, status, limit }) => {
        try {
          requireScope("issues:read");
          const projectIds = await scopedProjectIds();
          if (projectId) await assertProjectScope(projectId);
          if (!projectIds.length) return textResult([]);
          let query = database()
            .from("todos")
            .select(
              "id,project_id,todo_list_id,title,description,status,priority,assigned_to,due_at,accelo_task_id,sync_status,updated_at,version",
            )
            .in("project_id", projectIds)
            .order("due_at", { ascending: true, nullsFirst: false })
            .limit(limit);
          if (projectId) query = query.eq("project_id", projectId);
          if (assigneeId) query = query.eq("assigned_to", assigneeId);
          if (status) query = query.eq("status", status);
          const { data, error } = await query;
          if (error) throw error;
          return textResult(data ?? []);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "create_todo",
      {
        title: "Create todo",
        description: "Create a todo in a P11 PM project.",
        inputSchema: z.object({
          projectId: uuid,
          listId: uuid.optional(),
          title: z.string().trim().min(1).max(300),
          description: z.string().trim().max(20_000).optional(),
          assigneeId: uuid.optional(),
          subscriberIds: z.array(uuid).max(50).default([]),
          dueDate: z.iso.date().optional(),
          priority: todoPriority.default("medium"),
          actorId: uuid.optional(),
          idempotencyKey: z.string().trim().min(8).max(200).optional(),
        }),
      },
      async (input) => {
        try {
          requireScope("issues:write");
          await assertProjectScope(input.projectId);
          const { data, error } = await database().rpc("create_project_todo", {
            target_project_id: input.projectId,
            target_todo_list_id: input.listId ?? null,
            target_title: input.title,
            target_description: input.description ?? null,
            target_assignee_ids: input.assigneeId ? [input.assigneeId] : [],
            target_completion_subscriber_ids: input.subscriberIds,
            target_due_at: input.dueDate
              ? `${input.dueDate}T17:00:00.000Z`
              : null,
            target_priority: input.priority,
            requested_actor_id:
              input.actorId ?? process.env.MCP_DEFAULT_PROFILE_ID ?? null,
            target_idempotency_key: input.idempotencyKey ?? randomUUID(),
          });
          if (error) throw error;
          return textResult(data);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "update_todo",
      {
        title: "Update todo",
        description:
          "Update todo fields with optimistic concurrency and idempotent retries.",
        inputSchema: z
          .object({
            todoId: uuid,
            expectedVersion: z.number().int().positive(),
            title: z.string().trim().min(1).max(300).optional(),
            description: z.string().trim().max(20_000).nullable().optional(),
            assigneeId: uuid.nullable().optional(),
            dueDate: z.iso.date().nullable().optional(),
            status: todoStatus.optional(),
            priority: todoPriority.optional(),
            actorId: uuid.optional(),
            idempotencyKey: z.string().trim().min(8).max(200).optional(),
          })
          .refine(
            (input) =>
              Object.entries(input).some(
                ([key, value]) =>
                  ![
                    "todoId",
                    "expectedVersion",
                    "actorId",
                    "idempotencyKey",
                  ].includes(key) && value !== undefined,
              ),
            "At least one update field is required.",
          ),
      },
      async ({
        todoId,
        expectedVersion,
        assigneeId,
        dueDate,
        actorId,
        idempotencyKey,
        ...input
      }) => {
        try {
          requireScope("issues:write");
          const { data: scopedTodo, error: scopeError } = await database()
            .from("todos")
            .select("project_id")
            .eq("id", todoId)
            .single<{ project_id: string }>();
          if (scopeError) throw scopeError;
          await assertProjectScope(scopedTodo.project_id);
          const updates: Record<string, unknown> = { ...input };
          if (assigneeId !== undefined) {
            updates.assignee_ids = assigneeId ? [assigneeId] : [];
          }
          if (dueDate !== undefined) {
            updates.due_at = dueDate ? `${dueDate}T17:00:00.000Z` : null;
          }

          const { data, error } = await database().rpc("update_project_todo", {
            target_todo_id: todoId,
            expected_version: expectedVersion,
            changes: updates,
            requested_actor_id:
              actorId ?? process.env.MCP_DEFAULT_PROFILE_ID ?? null,
            target_idempotency_key: idempotencyKey ?? randomUUID(),
          });
          if (error) throw error;
          return textResult(data);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "post_message",
      {
        title: "Post message",
        description: "Post a message to a project's message board.",
        inputSchema: z.object({
          projectId: uuid,
          authorId: uuid,
          title: z.string().trim().min(1).max(240),
          body: z.string().trim().min(1).max(20_000),
          category: z
            .enum(["update", "decision", "creative", "client"])
            .default("update"),
          idempotencyKey: z.string().trim().min(8).max(200).optional(),
        }),
      },
      async (input) => {
        try {
          requireScope("issues:write");
          await assertProjectScope(input.projectId);
          const { data, error } = await database().rpc(
            "create_project_message",
            {
              target_project_id: input.projectId,
              target_subject: input.title,
              target_body: input.body,
              target_category: input.category,
              requested_actor_id: input.authorId,
              target_idempotency_key:
                input.idempotencyKey ?? randomUUID(),
            },
          );
          if (error) throw error;
          return textResult(data);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "post_comment",
      {
        title: "Post comment",
        description: "Post a comment on a message, todo, or document.",
        inputSchema: z.object({
          targetType: z.enum(["message", "todo", "doc"]),
          targetId: uuid,
          authorId: uuid,
          body: z.string().trim().min(1).max(10_000),
          mentionProfileIds: z.array(uuid).max(50).default([]),
          attachmentFileIds: z.array(uuid).max(20).default([]),
          externalAttachments: z
            .array(
              z.object({
                url: z.url(),
                title: z.string().trim().min(1).max(240),
              }),
            )
            .max(20)
            .default([]),
          idempotencyKey: z.string().trim().min(8).max(200).optional(),
        }),
      },
      async (input) => {
        try {
          requireScope("issues:write");
          const targetTable =
            input.targetType === "todo"
              ? "todos"
              : input.targetType === "doc"
                ? "docs"
                : "messages";
          const { data: target, error: targetError } = await database()
            .from(targetTable)
            .select("project_id")
            .eq("id", input.targetId)
            .single<{ project_id: string }>();
          if (targetError) throw targetError;
          await assertProjectScope(target.project_id);

          const { data, error } = await database().rpc(
            "create_project_comment",
            {
              target_project_id: target.project_id,
              target_parent_type: input.targetType,
              target_parent_id: input.targetId,
              target_body: input.body,
              target_mention_profile_ids: input.mentionProfileIds,
              target_attachment_file_ids: input.attachmentFileIds,
              target_external_attachments: input.externalAttachments,
              requested_actor_id: input.authorId,
              target_idempotency_key:
                input.idempotencyKey ?? randomUUID(),
            },
          );
          if (error) throw error;
          return textResult(data);
        } catch (error) {
          return errorResult(error);
        }
      },
    );

    server.registerTool(
      "my_assignments",
      {
        title: "Get my assignments",
        description:
          "List open assignments for a profile. Defaults to MCP_DEFAULT_PROFILE_ID or MCP_DEFAULT_USER_EMAIL.",
        inputSchema: z.object({
          profileId: uuid.optional(),
          email: z.email().optional(),
          includeCompleted: z.boolean().default(false),
          limit: z.number().int().min(1).max(200).default(100),
        }),
      },
      async ({ profileId, email, includeCompleted, limit }) => {
        try {
          const { organizationId } = requireScope("issues:read");
          const client = database();
          let resolvedProfileId =
            profileId ?? process.env.MCP_DEFAULT_PROFILE_ID;
          const resolvedEmail = email ?? process.env.MCP_DEFAULT_USER_EMAIL;

          if (!resolvedProfileId && resolvedEmail) {
            const { data: profile, error: profileError } = await client
              .from("profiles")
              .select("id")
              .eq("organization_id", organizationId)
              .ilike("email", resolvedEmail)
              .maybeSingle<{ id: string }>();
            if (profileError) throw profileError;
            resolvedProfileId = profile?.id;
          }

          if (!resolvedProfileId) {
            throw new Error(
              "Provide profileId or email, or configure MCP_DEFAULT_PROFILE_ID/MCP_DEFAULT_USER_EMAIL.",
            );
          }
          const { data: scopedProfile } = await client
            .from("profiles")
            .select("id")
            .eq("id", resolvedProfileId)
            .eq("organization_id", organizationId)
            .maybeSingle();
          if (!scopedProfile) throw new Error("Profile is outside this token's scope.");
          const projectIds = await scopedProjectIds();
          if (!projectIds.length) return textResult([]);

          let query = client
            .from("todos")
            .select(
              "id,project_id,todo_list_id,title,description,status,priority,due_at,updated_at,version",
            )
            .eq("assigned_to", resolvedProfileId)
            .in("project_id", projectIds)
            .order("due_at", { ascending: true, nullsFirst: false })
            .limit(limit);
          if (!includeCompleted) {
            query = query.not("status", "in", '("done","cancelled")');
          }

          const { data, error } = await query;
          if (error) throw error;
          return textResult(data ?? []);
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  },
  {
    serverInfo: { name: "p11-pm", version: "1.0.0" },
  },
);

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

async function authenticatedHandler(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  const suppliedKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (!suppliedKey) {
    return Response.json(
      { error: "A valid scoped Bearer token is required." },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="P11 PM MCP"' },
      },
    );
  }

  const scope = await resolveMcpScope(suppliedKey);
  if (!scope) {
    return Response.json(
      { error: "The Bearer token is invalid, expired, or revoked." },
      {
        status: 401,
        headers: { "WWW-Authenticate": 'Bearer realm="P11 PM MCP"' },
      },
    );
  }
  return mcpScope.run(scope, () => handler(request));
}

async function resolveMcpScope(suppliedKey: string): Promise<McpScope | null> {
  const client = getAppSupabaseClient();
  if (!client) return null;
  const expectedKey = process.env.MCP_API_KEY;
  if (expectedKey && constantTimeEqual(suppliedKey, expectedKey)) {
    const configuredOrganizationId = process.env.MCP_ORGANIZATION_ID;
    if (configuredOrganizationId) {
      return {
        organizationId: configuredOrganizationId,
        scopes: new Set([
          "projects:read",
          "issues:read",
          "issues:write",
          "chat:read",
        ]),
      };
    }
    const { data: organizations } = await client
      .from("organizations")
      .select("id")
      .limit(2);
    if (organizations?.length === 1) {
      return {
        organizationId: organizations[0].id,
        scopes: new Set([
          "projects:read",
          "issues:read",
          "issues:write",
          "chat:read",
        ]),
      };
    }
    return null;
  }

  const tokenHash = createHash("sha256").update(suppliedKey).digest("hex");
  const now = new Date().toISOString();
  const { data: token, error } = await client
    .from("integration_api_tokens")
    .select("id,organization_id,scopes,expires_at,revoked_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();
  if (error || !token) return null;
  void client
    .from("integration_api_tokens")
    .update({ last_used_at: now })
    .eq("id", token.id)
    .then(({ error: updateError }) => {
      if (updateError) console.warn("MCP token usage update failed:", updateError);
    });
  return {
    organizationId: token.organization_id,
    scopes: new Set(token.scopes ?? []),
  };
}

export {
  authenticatedHandler as DELETE,
  authenticatedHandler as GET,
  authenticatedHandler as POST,
};
