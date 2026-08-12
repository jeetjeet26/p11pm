import { notFound, redirect } from "next/navigation";

import type { IssueFilters } from "@/components/issues/issue-workspace";
import { ProjectPageContent } from "@/components/projects/project-page-content";
import type { WorkspaceTab } from "@/components/projects/project-workspace";
import { getProjectOverviewData } from "@/lib/data";

export default async function ProjectIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId, issueId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const data = await getProjectOverviewData(projectId);
  if (!data) notFound();
  if (data.project.isReadOnly) redirect(`/archive/${data.project.id}`);

  return (
    <ProjectPageContent
      data={data}
      initialIssueId={issueId}
      initialTab={tabValue(query.tab)}
      issueFilters={issueFilters(query)}
    />
  );
}

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : undefined;
}

function tabValue(input: string | string[] | undefined): WorkspaceTab {
  return value(input) === "board" ? "board" : "issues";
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
