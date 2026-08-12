import { randomUUID } from "node:crypto";
import { z } from "zod";

import { runAutomationCycle } from "@/lib/automation/server";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const optionalText = z.string().trim().max(10_000).optional();

const payloadSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_issue_from_message"),
    messageId: uuid,
    projectId: uuid,
    title: z.string().trim().min(2).max(300),
    dueDate: z.string().date().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    assigneeIds: z.array(uuid).max(20).default([]),
  }),
  z.object({
    action: z.literal("create_decision"),
    projectId: uuid,
    title: z.string().trim().min(3).max(240),
    summary: z.string().trim().min(1).max(10_000),
    rationale: optionalText,
    ownerId: uuid.optional(),
    sourceConversationId: uuid.optional(),
    sourceMessageId: uuid.optional(),
  }),
  z.object({
    action: z.literal("request_approval"),
    projectId: uuid,
    title: z.string().trim().min(3).max(240),
    description: optionalText,
    subjectType: z.enum([
      "project",
      "issue",
      "decision",
      "doc",
      "file",
      "milestone",
    ]),
    subjectId: uuid,
    reviewerId: uuid,
    dueAt: z.iso.datetime().optional(),
    sourceConversationId: uuid.optional(),
    sourceMessageId: uuid.optional(),
  }),
  z.object({
    action: z.literal("respond_approval"),
    approvalId: uuid,
    status: z.enum(["approved", "changes_requested", "rejected", "cancelled"]),
    responseNote: optionalText,
  }),
  z.object({
    action: z.literal("create_dependency"),
    projectId: uuid,
    predecessorTodoId: uuid,
    successorTodoId: uuid,
    relationship: z
      .enum(["blocks", "relates_to", "duplicates", "parent"])
      .default("blocks"),
    reason: optionalText,
  }),
  z.object({
    action: z.literal("create_cycle"),
    projectId: uuid.optional(),
    name: z.string().trim().min(2).max(120),
    goal: optionalText,
    startsOn: z.string().date(),
    endsOn: z.string().date(),
  }),
  z.object({
    action: z.literal("bind_channel"),
    projectId: uuid,
    conversationId: uuid,
    isPrimary: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("create_automation"),
    projectId: uuid.optional(),
    name: z.string().trim().min(3).max(160),
    triggerType: z.enum([
      "issue_created",
      "status_changed",
      "assignment_changed",
      "due_soon",
      "overdue",
      "stale",
      "approval_completed",
    ]),
    triggerConfig: z.record(z.string(), z.unknown()).default({}),
    actionType: z.enum([
      "notify",
      "create_follow_up",
      "request_approval",
      "post_update",
      "assign",
      "change_status",
    ]),
    actionConfig: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal("toggle_automation"),
    ruleId: uuid,
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("run_automation"),
    ruleId: uuid,
  }),
  z.object({
    action: z.literal("retry_automation"),
    runId: uuid,
  }),
  z.object({
    action: z.literal("create_blocker"),
    projectId: uuid,
    todoId: uuid,
    title: z.string().trim().min(2).max(240),
    reason: optionalText,
    ownerId: uuid.optional(),
    expectedResolutionAt: z.iso.datetime().optional(),
    sourceConversationId: uuid.optional(),
    sourceMessageId: uuid.optional(),
  }),
  z.object({
    action: z.literal("create_template"),
    name: z.string().trim().min(3).max(160),
    description: optionalText,
    templateType: z.enum(["project", "issue", "checklist", "approval", "channel"]),
    configuration: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({
    action: z.literal("create_recurring"),
    projectId: uuid,
    title: z.string().trim().min(2).max(300),
    description: optionalText,
    cadence: z.enum(["daily", "weekly", "monthly", "quarterly"]),
    nextRunAt: z.iso.datetime(),
    assigneeIds: z.array(uuid).max(50).default([]),
    dueOffsetDays: z.number().int().min(0).max(365).default(0),
  }),
  z.object({
    action: z.literal("create_goal"),
    projectId: uuid.optional(),
    title: z.string().trim().min(3).max(240),
    description: optionalText,
    ownerId: uuid.optional(),
    targetDate: z.string().date().optional(),
  }),
  z.object({
    action: z.literal("create_change_request"),
    projectId: uuid,
    title: z.string().trim().min(3).max(240),
    description: z.string().trim().min(1).max(10_000),
    impactSummary: optionalText,
    reviewerId: uuid.optional(),
  }),
]);

const querySchema = z.object({
  projectId: uuid.optional(),
  scope: z.enum(["all", "bindings"]).default("all"),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: "Invalid operations query." }, { status: 400 });
  }
  const auth = await authenticatedContext();
  if (!auth.ok) return auth.response;
  const { client, organizationId } = auth;
  const projectId = parsed.data.projectId;
  if (parsed.data.scope === "bindings") {
    let query = client
      .from("project_channel_bindings")
      .select("*,workspace_conversations(id,name,kind)")
      .eq("organization_id", organizationId)
      .order("is_primary", { ascending: false });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) {
      return Response.json({ error: "Unable to load project channels." }, { status: 400 });
    }
    return Response.json({ bindings: data ?? [] });
  }

  const decisionsQuery = client
    .from("work_decisions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("decided_at", { ascending: false })
    .limit(100);
  const approvalsQuery = client
    .from("work_approvals")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  const dependenciesQuery = client
    .from("issue_dependencies")
    .select(
      "*,predecessor:todos!issue_dependencies_predecessor_todo_id_fkey(id,title,issue_number,status),successor:todos!issue_dependencies_successor_todo_id_fkey(id,title,issue_number,status)",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  const cyclesQuery = client
    .from("work_cycles")
    .select("*,cycle_issues(todo_id)")
    .eq("organization_id", organizationId)
    .order("starts_on", { ascending: false })
    .limit(50);
  const bindingsQuery = client
    .from("project_channel_bindings")
    .select("*,workspace_conversations(id,name,kind)")
    .eq("organization_id", organizationId)
    .order("is_primary", { ascending: false });
  const automationsQuery = client
    .from("automation_rules")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  const automationRunsQuery = client
    .from("automation_rule_runs")
    .select("*,attempts:automation_run_attempts(*)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  const projectsQuery = client
    .from("projects")
    .select("id,name,code,status")
    .eq("organization_id", organizationId)
    .order("name")
    .limit(500);
  const profilesQuery = client
    .from("profiles")
    .select("id,full_name,email,role")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("full_name")
    .limit(500);
  const issuesQuery = client
    .from("todos")
    .select("id,project_id,title,issue_number,status")
    .not("status", "in", "(done,cancelled)")
    .order("updated_at", { ascending: false })
    .limit(500);
  const blockersQuery = client
    .from("issue_blockers")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  const templatesQuery = client
    .from("work_templates")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name")
    .limit(200);
  const recurringQuery = client
    .from("recurring_work_rules")
    .select("*")
    .eq("organization_id", organizationId)
    .order("next_run_at")
    .limit(200);
  const goalsQuery = client
    .from("work_goals")
    .select("*")
    .eq("organization_id", organizationId)
    .order("target_date", { ascending: true, nullsFirst: false })
    .limit(200);
  const changesQuery = client
    .from("project_change_requests")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (projectId) {
    decisionsQuery.eq("project_id", projectId);
    approvalsQuery.eq("project_id", projectId);
    dependenciesQuery.eq("project_id", projectId);
    cyclesQuery.eq("project_id", projectId);
    bindingsQuery.eq("project_id", projectId);
    automationsQuery.eq("project_id", projectId);
    issuesQuery.eq("project_id", projectId);
    blockersQuery.eq("project_id", projectId);
    recurringQuery.eq("project_id", projectId);
    goalsQuery.eq("project_id", projectId);
    changesQuery.eq("project_id", projectId);
  }

  const [
    decisions,
    approvals,
    dependencies,
    cycles,
    bindings,
    automations,
    automationRuns,
    projects,
    profiles,
    issues,
    blockers,
    templates,
    recurring,
    goals,
    changes,
  ] =
    await Promise.all([
      decisionsQuery,
      approvalsQuery,
      dependenciesQuery,
      cyclesQuery,
      bindingsQuery,
      automationsQuery,
      automationRunsQuery,
      projectsQuery,
      profilesQuery,
      issuesQuery,
      blockersQuery,
      templatesQuery,
      recurringQuery,
      goalsQuery,
      changesQuery,
    ]);
  const failed = [
    decisions,
    approvals,
    dependencies,
    cycles,
    bindings,
    automations,
    automationRuns,
    projects,
    profiles,
    issues,
    blockers,
    templates,
    recurring,
    goals,
    changes,
  ].find((result) => result.error);
  if (failed?.error) {
    console.error("Load operating system data failed:", failed.error);
    return Response.json(
      { error: "Unable to load planning data." },
      { status: 500 },
    );
  }
  return Response.json({
    decisions: decisions.data ?? [],
    approvals: approvals.data ?? [],
    dependencies: dependencies.data ?? [],
    cycles: cycles.data ?? [],
    bindings: bindings.data ?? [],
    automations: automations.data ?? [],
    automationRuns: automationRuns.data ?? [],
    projects: projects.data ?? [],
    profiles: profiles.data ?? [],
    issues: issues.data ?? [],
    blockers: blockers.data ?? [],
    templates: templates.data ?? [],
    recurring: recurring.data ?? [],
    goals: goals.data ?? [],
    changes: changes.data ?? [],
  });
}

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid operation." },
      { status: 400 },
    );
  }
  const auth = await authenticatedContext();
  if (!auth.ok) return auth.response;
  const { client, organizationId, role, userId } = auth;
  const input = parsed.data;

  if (
    input.action === "toggle_automation" ||
    input.action === "run_automation" ||
    input.action === "retry_automation"
  ) {
    if (role !== "admin" && role !== "manager") {
      return Response.json({ error: "Manager access required." }, { status: 403 });
    }
    if (input.action === "toggle_automation") {
      const { data, error } = await client
        .from("automation_rules")
        .update({ enabled: input.enabled, updated_at: new Date().toISOString() })
        .eq("id", input.ruleId)
        .eq("organization_id", organizationId)
        .select()
        .single();
      if (error) return databaseError("update automation", error);
      return Response.json({ item: data });
    }
    if (input.action === "run_automation") {
      const { data: rule, error: ruleError } = await client
        .from("automation_rules")
        .select("id")
        .eq("id", input.ruleId)
        .eq("organization_id", organizationId)
        .single();
      if (ruleError || !rule) return databaseError("load automation", ruleError);
      const { data, error } = await client
        .from("automation_rule_runs")
        .insert({
          organization_id: organizationId,
          rule_id: rule.id,
          event_key: `manual:${randomUUID()}`,
          trigger_source_type: "manual",
          input: {},
          requested_by: userId,
        })
        .select()
        .single();
      if (error) return databaseError("queue automation", error);
      try {
        await runAutomationCycle(client, { organizationId });
      } catch (cycleError) {
        console.warn("Immediate automation execution failed:", cycleError);
      }
      return Response.json({ item: data }, { status: 201 });
    }
    const { data, error } = await client
      .from("automation_rule_runs")
      .update({
        status: "retry",
        available_at: new Date().toISOString(),
        completed_at: null,
        last_error: null,
      })
      .eq("id", input.runId)
      .eq("organization_id", organizationId)
      .eq("status", "failed")
      .select()
      .maybeSingle();
    if (error) return databaseError("retry automation", error);
    if (!data) {
      return Response.json(
        { error: "Only failed automation runs can be retried." },
        { status: 409 },
      );
    }
    try {
      await runAutomationCycle(client, { organizationId });
    } catch (cycleError) {
      console.warn("Automation retry execution failed:", cycleError);
    }
    return Response.json({ item: data });
  }

  if (input.action === "create_issue_from_message") {
    const { data: todo, error } = await client.rpc(
      "create_issue_from_workspace_message",
      {
      target_message_id: input.messageId,
      target_project_id: input.projectId,
      target_title: input.title,
      target_assignee_ids: input.assigneeIds,
      target_due_at: input.dueDate
        ? `${input.dueDate}T17:00:00.000Z`
        : null,
      target_priority: input.priority,
      requested_actor_id: userId,
      target_idempotency_key: randomUUID(),
      },
    );
    if (error || !todo) return databaseError("create issue from chat", error);
    const todoId = String((todo as { id: string }).id);
    if (input.assigneeIds.length) {
      await client.from("workspace_inbox_items").upsert(
        input.assigneeIds.map((recipientId) => ({
          organization_id: organizationId,
          recipient_id: recipientId,
          actor_id: userId,
          project_id: input.projectId,
          kind: "assignment",
          title: `Assigned: ${input.title}`,
          body: "This issue was created from a workspace chat message.",
          href: `/projects/${input.projectId}/issues/${todoId}`,
          source_type: "issue",
          source_id: todoId,
          priority: input.priority === "urgent" ? "urgent" : "normal",
        })),
        { onConflict: "recipient_id,kind,source_type,source_id" },
      );
    }
    await audit(client, organizationId, userId, input.projectId, {
      action: "issue.created_from_chat",
      entityType: "issue",
      entityId: todoId,
      metadata: { sourceMessageId: input.messageId },
    });
    return Response.json({ item: todo, linked: true }, { status: 201 });
  }

  if (input.action === "create_decision") {
    const { data, error } = await client
      .from("work_decisions")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId,
        title: input.title,
        summary: input.summary,
        rationale: input.rationale ?? null,
        owner_id: input.ownerId ?? userId,
        source_conversation_id: input.sourceConversationId ?? null,
        source_message_id: input.sourceMessageId ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create decision", error);
    await audit(client, organizationId, userId, input.projectId, {
      action: "decision.created",
      entityType: "decision",
      entityId: data.id,
    });
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "request_approval") {
    const { data, error } = await client
      .from("work_approvals")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId,
        title: input.title,
        description: input.description ?? null,
        subject_type: input.subjectType,
        subject_id: input.subjectId,
        requested_by: userId,
        reviewer_id: input.reviewerId,
        due_at: input.dueAt ?? null,
        source_conversation_id: input.sourceConversationId ?? null,
        source_message_id: input.sourceMessageId ?? null,
      })
      .select()
      .single();
    if (error) return databaseError("request approval", error);
    await client.from("workspace_inbox_items").upsert(
      {
        organization_id: organizationId,
        recipient_id: input.reviewerId,
        actor_id: userId,
        project_id: input.projectId,
        kind: "approval",
        title: input.title,
        body: input.description ?? "Your approval is requested.",
        href: `/roadmap?approval=${data.id}`,
        source_type: "approval",
        source_id: data.id,
        priority: "high",
      },
      { onConflict: "recipient_id,kind,source_type,source_id" },
    );
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "respond_approval") {
    const { data: approval } = await client
      .from("work_approvals")
      .select("reviewer_id,requested_by")
      .eq("id", input.approvalId)
      .single();
    const canRespond =
      approval &&
      (role === "admin" ||
        role === "manager" ||
        (input.status === "cancelled"
          ? approval.requested_by === userId
          : approval.reviewer_id === userId));
    if (!canRespond) {
      return Response.json(
        { error: "Only the reviewer can record this decision." },
        { status: 403 },
      );
    }
    const { data, error } = await client
      .from("work_approvals")
      .update({
        status: input.status,
        response_note: input.responseNote ?? null,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.approvalId)
      .select()
      .single();
    if (error) return databaseError("respond to approval", error);
    await client
      .from("workspace_inbox_items")
      .update({ completed_at: new Date().toISOString() })
      .eq("recipient_id", userId)
      .eq("source_type", "approval")
      .eq("source_id", input.approvalId);
    return Response.json({ item: data });
  }

  if (input.action === "create_dependency") {
    const { data: todos, error: todoError } = await client
      .from("todos")
      .select("id,project_id")
      .in("id", [input.predecessorTodoId, input.successorTodoId]);
    if (
      todoError ||
      todos?.length !== 2 ||
      todos.some((todo) => todo.project_id !== input.projectId)
    ) {
      return Response.json(
        { error: "Both issues must belong to the selected project." },
        { status: 400 },
      );
    }
    const { data, error } = await client
      .from("issue_dependencies")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId,
        predecessor_todo_id: input.predecessorTodoId,
        successor_todo_id: input.successorTodoId,
        relationship: input.relationship,
        reason: input.reason ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create dependency", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "create_cycle") {
    const { data, error } = await client
      .from("work_cycles")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId ?? null,
        name: input.name,
        goal: input.goal ?? null,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create cycle", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "bind_channel") {
    if (input.isPrimary) {
      await client
        .from("project_channel_bindings")
        .update({ is_primary: false })
        .eq("project_id", input.projectId)
        .eq("is_primary", true);
    }
    const { data, error } = await client
      .from("project_channel_bindings")
      .upsert(
        {
          organization_id: organizationId,
          project_id: input.projectId,
          conversation_id: input.conversationId,
          is_primary: input.isPrimary,
          created_by: userId,
        },
        { onConflict: "project_id,conversation_id" },
      )
      .select()
      .single();
    if (error) return databaseError("bind project channel", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "create_blocker") {
    const { data, error } = await client
      .from("issue_blockers")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId,
        todo_id: input.todoId,
        title: input.title,
        reason: input.reason ?? null,
        owner_id: input.ownerId ?? userId,
        expected_resolution_at: input.expectedResolutionAt ?? null,
        source_conversation_id: input.sourceConversationId ?? null,
        source_message_id: input.sourceMessageId ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create blocker", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "create_template") {
    const { data, error } = await client
      .from("work_templates")
      .insert({
        organization_id: organizationId,
        name: input.name,
        description: input.description ?? null,
        template_type: input.templateType,
        configuration: input.configuration,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create template", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "create_recurring") {
    const { data, error } = await client
      .from("recurring_work_rules")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId,
        title: input.title,
        description: input.description ?? null,
        cadence: input.cadence,
        next_run_at: input.nextRunAt,
        assignee_ids: input.assigneeIds,
        due_offset_days: input.dueOffsetDays,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create recurring work", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "create_goal") {
    const { data, error } = await client
      .from("work_goals")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId ?? null,
        title: input.title,
        description: input.description ?? null,
        owner_id: input.ownerId ?? userId,
        target_date: input.targetDate ?? null,
        created_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create goal", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action === "create_change_request") {
    const { data, error } = await client
      .from("project_change_requests")
      .insert({
        organization_id: organizationId,
        project_id: input.projectId,
        title: input.title,
        description: input.description,
        impact_summary: input.impactSummary ?? null,
        reviewer_id: input.reviewerId ?? null,
        requested_by: userId,
      })
      .select()
      .single();
    if (error) return databaseError("create change request", error);
    return Response.json({ item: data }, { status: 201 });
  }

  if (input.action !== "create_automation") {
    return Response.json({ error: "Unsupported operation." }, { status: 400 });
  }
  const { data, error } = await client
    .from("automation_rules")
    .insert({
      organization_id: organizationId,
      project_id: input.projectId ?? null,
      name: input.name,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig,
      action_type: input.actionType,
      action_config: input.actionConfig,
      created_by: userId,
    })
    .select()
    .single();
  if (error) return databaseError("create automation", error);
  return Response.json({ item: data }, { status: 201 });
}

async function authenticatedContext() {
  const client = await createClient();
  if (!client) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Supabase is not configured." },
        { status: 503 },
      ),
    };
  }
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const { data: profile } = await client
    .from("profiles")
    .select("organization_id,role")
    .eq("id", user.id)
    .eq("status", "active")
    .single();
  if (!profile?.organization_id) {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Active workspace membership required." },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true as const,
    client,
    userId: user.id,
    organizationId: profile.organization_id,
    role: String(profile.role),
  };
}

function databaseError(
  operation: string,
  error: { message?: string; code?: string } | null,
) {
  console.error(`Unable to ${operation}:`, error);
  const status = error?.code === "42501" ? 403 : 400;
  return Response.json(
    { error: error?.message ?? `Unable to ${operation}.` },
    { status },
  );
}

async function audit(
  client: Awaited<ReturnType<typeof createClient>> & object,
  organizationId: string,
  actorId: string,
  projectId: string | null,
  event: {
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await client.from("workspace_audit_events").insert({
    organization_id: organizationId,
    project_id: projectId,
    actor_id: actorId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    metadata: event.metadata ?? {},
  });
  if (error) console.warn("Audit event write failed:", error);
}
