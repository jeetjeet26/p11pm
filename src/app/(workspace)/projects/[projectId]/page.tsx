import { notFound, redirect } from "next/navigation";

import type { IssueFilters } from "@/components/issues/issue-workspace";
import { ProjectPageContent } from "@/components/projects/project-page-content";
import type { WorkspaceTab } from "@/components/projects/project-workspace";
import { getViewer } from "@/lib/auth/viewer";
import { getProjectOverviewData } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const [data, query, viewer] = await Promise.all([
    getProjectOverviewData(projectId),
    searchParams,
    getViewer(),
  ]);
  if (!data) notFound();
  if (data.project.isReadOnly) redirect(`/archive/${data.project.id}`);
  const supabase = await createClient();
  const { data: clients } = supabase
    ? await supabase
        .from("clients")
        .select("id,name")
        .order("name")
        .limit(1_000)
    : { data: [] };

  return (
    <ProjectPageContent
      clients={clients ?? []}
      canManage={viewer?.capabilities.commercialWrite ?? false}
      data={data}
      initialTab={tabValue(query.tab)}
      issueFilters={issueFilters(query)}
    />
  );
}

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : undefined;
}

function tabValue(input: string | string[] | undefined): WorkspaceTab {
  const tab = value(input);
  return ["issues", "board", "activity", "messages", "files"].includes(
    tab ?? "",
  )
    ? (tab as WorkspaceTab)
    : "issues";
}

function issueFilters(
  query: Record<string, string | string[] | undefined>,
): Partial<IssueFilters> {
  return {
    query: value(query.q) ?? "",
    status: value(query.status) ?? "open_work",
    priority: value(query.priority) ?? "all",
    label: value(query.label) ?? "",
    assignee: value(query.assignee) ?? "all",
    due: value(query.due) ?? "all",
    scope: value(query.scope) ?? "current",
  };
}
