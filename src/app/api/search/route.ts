import { z } from "zod";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

interface SearchResult {
  id: string;
  kind:
    | "project"
    | "issue"
    | "comment"
    | "message"
    | "doc"
    | "file"
    | "folder"
    | "milestone"
    | "history"
    | "chat"
    | "decision"
    | "client"
    | "contact"
    | "retainer"
    | "invoice"
    | "activity"
    | "payment"
    | "time"
    | "support"
    | "prospect"
    | "blocker"
    | "approval"
    | "automation"
    | "delivery";
  title: string;
  context?: string;
  href: string;
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Search requires between 2 and 100 characters." },
      { status: 400 },
    );
  }
  const supabase = await createClient();
  if (!supabase) {
    return Response.json({ error: "Search is not configured." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const escaped = parsed.data.q.replace(/[,%_()]/g, " ").trim();
  if (escaped.length < 2) {
    return Response.json({ results: [] });
  }
  const pattern = `%${escaped}%`;
  const [
    projects,
    issues,
    comments,
    messages,
    docs,
    files,
    folders,
    milestones,
    history,
    chatMessages,
    decisions,
    clients,
    contacts,
    retainers,
    invoices,
    activities,
    payments,
    timeEntries,
    supportTickets,
    prospects,
    blockers,
    approvals,
    automations,
  ] =
    await Promise.all([
    supabase
      .from("projects")
      .select("id,name,client_name")
      .or(`name.ilike.${pattern},client_name.ilike.${pattern},code.ilike.${pattern}`)
      .limit(6),
    supabase
      .from("todos")
      .select("id,project_id,title,description,issue_number,operational_state,projects(name,code)")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .limit(8),
    supabase
      .from("comments")
      .select("id,project_id,todo_id,body,projects(name)")
      .ilike("body", pattern)
      .limit(5),
    supabase
      .from("messages")
      .select("id,project_id,subject,body,status,projects(name)")
      .or(`subject.ilike.${pattern},body.ilike.${pattern}`)
      .limit(5),
    supabase
      .from("docs")
      .select("id,project_id,title,status,projects(name)")
      .or(`title.ilike.${pattern},plain_text.ilike.${pattern}`)
      .limit(5),
    supabase
      .from("files")
      .select("id,project_id,folder_id,file_name,projects(name)")
      .ilike("file_name", pattern)
      .limit(5),
    supabase
      .from("file_folders")
      .select("id,project_id,client_id,name")
      .is("trashed_at", null)
      .ilike("name", pattern)
      .limit(6),
    supabase
      .from("milestones")
      .select("id,project_id,name,status,projects(name)")
      .ilike("name", pattern)
      .limit(5),
    supabase
      .from("basecamp_archive_records")
      .select("id,project_id,title,record_type")
      .or(`title.ilike.${pattern},plain_text.ilike.${pattern}`)
      .limit(5),
    supabase
      .from("workspace_messages")
      .select("id,conversation_id,body,created_at,workspace_conversations(name,kind)")
      .ilike("body", pattern)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("work_decisions")
      .select("id,project_id,title,summary,status,projects(name)")
      .or(`title.ilike.${pattern},summary.ilike.${pattern}`)
      .order("decided_at", { ascending: false })
      .limit(6),
    supabase
      .from("clients")
      .select("id,name,status")
      .or(`name.ilike.${pattern},billing_email.ilike.${pattern}`)
      .limit(8),
    supabase
      .from("contacts")
      .select(
        "id,first_name,last_name,email,title,client_contacts(client_id,is_primary)",
      )
      .or(
        `first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`,
      )
      .limit(8),
    supabase
      .from("retainers")
      .select("id,name,status,end_date,renewal_days,auto_renew,clients(name)")
      .or(`name.ilike.${pattern},contract_type.ilike.${pattern}`)
      .limit(6),
    supabase
      .from("invoices")
      .select("id,invoice_number,status,promised_payment_date,collection_notes,clients(name)")
      .or(`invoice_number.ilike.${pattern},collection_notes.ilike.${pattern}`)
      .limit(6),
    supabase
      .from("client_activities")
      .select("id,client_id,subject,activity_type,clients(name)")
      .or(`subject.ilike.${pattern},body.ilike.${pattern}`)
      .order("occurred_at", { ascending: false })
      .limit(8),
    supabase
      .from("payments")
      .select(
        "id,client_id,reference,method,clients(name),payment_allocations(invoice_id)",
      )
      .or(`reference.ilike.${pattern},notes.ilike.${pattern}`)
      .order("payment_date", { ascending: false })
      .limit(6),
    supabase
      .from("time_entries")
      .select("id,project_id,description,entry_date,status,projects(name)")
      .ilike("description", pattern)
      .order("entry_date", { ascending: false })
      .limit(6),
    supabase
      .from("support_tickets")
      .select(
        "todo_id,external_id,source_status,todos!inner(title,description,status,priority),clients(name)",
      )
      .limit(500),
    viewer.capabilities.pipelineWrite || viewer.capabilities.commercialRead
      ? supabase
          .from("prospects")
          .select("id,title,stage,next_action,next_action_at,client:clients(name)")
          .or(`title.ilike.${pattern},next_action.ilike.${pattern}`)
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("issue_blockers")
      .select("id,project_id,title,reason,status,projects(name)")
      .or(`title.ilike.${pattern},reason.ilike.${pattern}`)
      .limit(8),
    supabase
      .from("work_approvals")
      .select("id,project_id,title,description,status,projects(name)")
      .or(`title.ilike.${pattern},description.ilike.${pattern}`)
      .limit(8),
    viewer.role === "admin" || viewer.role === "manager"
      ? supabase
          .from("automation_rules")
          .select("id,project_id,name,trigger_type,action_type")
          .ilike("name", pattern)
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    ]);

  if (projects.error || issues.error) {
    console.error("Workspace search failed:", projects.error ?? issues.error);
    return Response.json({ error: "Workspace search is temporarily unavailable." }, { status: 500 });
  }
  for (const optionalError of [
    comments.error,
    messages.error,
    docs.error,
    files.error,
    folders.error,
    milestones.error,
    history.error,
    chatMessages.error,
    decisions.error,
    clients.error,
    contacts.error,
    retainers.error,
    invoices.error,
    activities.error,
    payments.error,
    timeEntries.error,
    supportTickets.error,
    prospects.error,
    blockers.error,
    approvals.error,
    automations.error,
  ]) {
    if (optionalError) console.warn("Optional search source unavailable:", optionalError);
  }

  const supportRows = (supportTickets.data ?? []).filter((ticket) => {
    const todo = relation(ticket.todos);
    const client = relation(ticket.clients);
    const haystack = [
      ticket.external_id,
      ticket.source_status,
      todo?.title,
      todo?.description,
      client?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(escaped.toLowerCase());
  });
  const supportIds = new Set(
    (supportTickets.data ?? []).map((ticket) => ticket.todo_id),
  );
  const results: SearchResult[] = [
    ...(projects.data ?? []).map((project) => ({
      id: project.id,
      kind: "project" as const,
      title: project.name,
      context: project.client_name ?? "Project",
      href: `/projects/${project.id}`,
    })),
    ...(issues.data ?? [])
      .filter(
        (issue) =>
          !supportIds.has(issue.id),
      )
      .map((issue) => {
      const project = relation(issue.projects);
      return {
        id: issue.id,
        kind: "issue" as const,
        title: issue.title,
        context: `${project?.code && issue.issue_number ? `${project.code}-${issue.issue_number} · ` : ""}${project?.name ?? "Issue"} · ${issue.operational_state}`,
        href: `/projects/${issue.project_id}/issues/${issue.id}`,
      };
      }),
    ...(comments.data ?? [])
      .filter((comment) => comment.todo_id)
      .map((comment) => {
        const project = relation(comment.projects);
        return {
          id: comment.id,
          kind: "comment" as const,
          title: excerpt(comment.body),
          context: `Comment · ${project?.name ?? "Project"}`,
          href: `/projects/${comment.project_id}/issues/${comment.todo_id}`,
        };
      }),
    ...(messages.data ?? []).map((message) => {
      const project = relation(message.projects);
      return {
        id: message.id,
        kind: message.status === "failed" ? ("delivery" as const) : ("message" as const),
        title: message.subject || excerpt(message.body),
        context: `${message.status === "failed" ? "Delivery failed" : "Project update"} · ${project?.name ?? "Project"}`,
        href: `/projects/${message.project_id}?tab=messages&message=${message.id}`,
      };
    }),
    ...(docs.data ?? []).map((doc) => {
      const project = relation(doc.projects);
      return {
        id: doc.id,
        kind: "doc" as const,
        title: doc.title,
        context: `Document · ${project?.name ?? "Project"}`,
        href: `/projects/${doc.project_id}?tab=files&doc=${doc.id}`,
      };
    }),
    ...(files.data ?? []).map((file) => {
      const project = relation(file.projects);
      return {
        id: file.id,
        kind: "file" as const,
        title: file.file_name,
        context: `File · ${project?.name ?? "Project"}`,
        href: `/files?file=${file.id}${file.folder_id ? `&folderId=${file.folder_id}` : ""}`,
      };
    }),
    ...(folders.data ?? []).map((folder) => ({
      id: folder.id,
      kind: "folder" as const,
      title: folder.name,
      context: folder.project_id
        ? "Project folder"
        : folder.client_id
          ? "Client folder"
          : "Workspace folder",
      href: `/files?folderId=${folder.id}`,
    })),
    ...(milestones.data ?? []).map((milestone) => {
      const project = relation(milestone.projects);
      return {
        id: milestone.id,
        kind: "milestone" as const,
        title: milestone.name,
        context: `Milestone · ${project?.name ?? "Project"}`,
        href: `/projects/${milestone.project_id}?tab=activity&milestone=${milestone.id}`,
      };
    }),
    ...(history.data ?? [])
      .filter((record) => record.project_id)
      .map((record) => ({
        id: record.id,
        kind: "history" as const,
        title: record.title || "Historical record",
        context: `History · ${record.record_type.replaceAll("_", " ")}`,
        href: `/archive/${record.project_id}?q=${encodeURIComponent(parsed.data.q)}#archive-record-${record.id}`,
      })),
    ...(chatMessages.data ?? []).map((message) => {
      const conversation = relation(message.workspace_conversations);
      return {
        id: message.id,
        kind: "chat" as const,
        title: excerpt(message.body),
        context: `Chat · ${conversation?.name ?? "Conversation"}`,
        href: `/chat/${message.conversation_id}?message=${message.id}`,
      };
    }),
    ...(decisions.data ?? []).map((decision) => {
      const project = relation(decision.projects);
      return {
        id: decision.id,
        kind: "decision" as const,
        title: decision.title,
        context: `Decision · ${project?.name ?? "Project"} · ${decision.status}`,
        href: `/roadmap?decision=${decision.id}`,
      };
    }),
    ...(clients.data ?? []).map((client) => ({
      id: client.id,
      kind: "client" as const,
      title: client.name,
      context: `Client · ${client.status}`,
      href: `/clients/${client.id}`,
    })),
    ...(contacts.data ?? []).map((contact) => {
      const links = Array.isArray(contact.client_contacts)
        ? contact.client_contacts
        : [];
      const clientLink =
        links.find((link) => link.is_primary) ?? links[0];
      return {
        id: contact.id,
        kind: "contact" as const,
        title:
          `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
          contact.email ||
          "Contact",
        context: contact.title || contact.email || "Contact",
        href: clientLink?.client_id
          ? `/clients/${clientLink.client_id}?contact=${contact.id}`
          : `/clients?q=${encodeURIComponent(
              `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() ||
                contact.email ||
                "",
            )}`,
      };
    }),
    ...(retainers.data ?? []).map((retainer) => ({
      id: retainer.id,
      kind: "retainer" as const,
      title: retainer.name,
      context: `Retainer · ${retainer.status}${
        retainer.end_date ? ` · ${retainer.auto_renew ? "renews" : "ends"} ${retainer.end_date}` : ""
      }`,
      href: `/retainers/${retainer.id}`,
    })),
    ...(invoices.data ?? []).map((invoice) => ({
      id: invoice.id,
      kind: "invoice" as const,
      title: invoice.invoice_number,
      context: `Invoice · ${invoice.status}${
        invoice.promised_payment_date
          ? ` · payment promised ${invoice.promised_payment_date}`
          : ""
      }`,
      href: `/billing/${invoice.id}`,
    })),
    ...(activities.data ?? []).map((activity) => {
      const client = relation(activity.clients);
      return {
        id: activity.id,
        kind: "activity" as const,
        title: activity.subject,
        context: `${activity.activity_type} · ${client?.name ?? "Client"}`,
        href: `/clients/${activity.client_id}`,
      };
    }),
    ...(payments.data ?? []).map((payment) => {
      const client = relation(payment.clients);
      const allocation = payment.payment_allocations[0];
      return {
        id: payment.id,
        kind: "payment" as const,
        title: payment.reference || "Payment",
        context: `${payment.method} · ${client?.name ?? "Client"}`,
        href: allocation?.invoice_id
          ? `/billing/${allocation.invoice_id}`
          : "/billing",
      };
    }),
    ...(timeEntries.data ?? []).map((entry) => {
      const project = relation(entry.projects);
      return {
        id: entry.id,
        kind: "time" as const,
        title: entry.description,
        context: `Time · ${entry.status}${
          entry.status === "submitted" ? " · awaiting approval" : ""
        } · ${project?.name ?? entry.entry_date}`,
        href: `/projects/${entry.project_id}`,
      };
    }),
    ...supportRows.map((ticket) => {
      const todo = relation(ticket.todos);
      const client = relation(ticket.clients);
      return {
        id: ticket.todo_id,
        kind: "support" as const,
        title: todo?.title ?? `Support ${ticket.external_id ?? ""}`.trim(),
        context: `Support · ${client?.name ?? "Client"} · ${ticket.source_status ?? todo?.status ?? "open"}`,
        href: `/support/${ticket.todo_id}`,
      };
    }),
    ...(prospects.data ?? []).map((prospect) => {
      const client = relation(prospect.client);
      return {
        id: prospect.id,
        kind: "prospect" as const,
        title: prospect.title,
        context: `Opportunity · ${client?.name ?? "Prospect"} · ${
          prospect.next_action
            ? `next ${prospect.next_action}${prospect.next_action_at ? ` ${prospect.next_action_at.slice(0, 10)}` : ""}`
            : prospect.stage
        }`,
        href: `/clients/prospects/${prospect.id}`,
      };
    }),
    ...(blockers.data ?? []).map((blocker) => {
      const project = relation(blocker.projects);
      return {
        id: blocker.id,
        kind: "blocker" as const,
        title: blocker.title,
        context: `Blocker · ${project?.name ?? "Project"} · ${blocker.status}`,
        href: `/projects/${blocker.project_id}?tab=planning`,
      };
    }),
    ...(approvals.data ?? []).map((approval) => {
      const project = relation(approval.projects);
      return {
        id: approval.id,
        kind: "approval" as const,
        title: approval.title,
        context: `Approval · ${project?.name ?? "Project"} · ${approval.status}`,
        href: `/roadmap?approval=${approval.id}`,
      };
    }),
    ...(automations.data ?? []).map((automation) => ({
      id: automation.id,
      kind: "automation" as const,
      title: automation.name,
      context: `Automation · ${automation.trigger_type} → ${automation.action_type}`,
      href: "/roadmap",
    })),
  ];

  const ranked = results
    .map((result, index) => ({
      result,
      index,
      score: searchScore(result, parsed.data.q),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result);
  return Response.json({ results: ranked.slice(0, 24) });
}

function searchScore(result: SearchResult, query: string) {
  const normalized = query.toLowerCase();
  const title = result.title.toLowerCase();
  const context = result.context?.toLowerCase() ?? "";
  let score = 0;
  if (title === normalized) score += 100;
  else if (title.startsWith(normalized)) score += 60;
  else if (title.includes(normalized)) score += 35;
  if (context.includes(normalized)) score += 10;
  if (result.kind === "issue") score += 8;
  if (result.kind === "project") score += 6;
  if (result.kind === "decision") score += 5;
  if (result.kind === "support") score += 9;
  if (result.kind === "prospect") score += 7;
  if (result.kind === "blocker" || result.kind === "approval") score += 8;
  return score;
}

function relation(
  value: unknown,
):
  | {
      name?: string;
      code?: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
    }
  | undefined {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object"
      ? (value[0] as {
          name?: string;
          code?: string;
          title?: string;
          description?: string;
          status?: string;
          priority?: string;
        })
      : undefined;
  }
  return value && typeof value === "object"
    ? (value as {
        name?: string;
        code?: string;
        title?: string;
        description?: string;
        status?: string;
        priority?: string;
      })
    : undefined;
}

function excerpt(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 96 ? `${compact.slice(0, 93)}…` : compact;
}
