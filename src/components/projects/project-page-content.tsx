import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Hash,
  History,
  ListTodo,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";

import type { IssueFilters } from "@/components/issues/issue-workspace";
import { LinkedConversations } from "@/components/cross-links/linked-conversations";
import {
  ProjectWorkspace,
  type WorkspaceTab,
} from "@/components/projects/project-workspace";
import { ProjectChannelBinding } from "@/components/projects/project-channel-binding";
import { ProjectCommercialSummary } from "@/components/projects/project-commercial-summary";
import { ProjectIntelligence } from "@/components/projects/project-intelligence";
import { ProjectPlanning } from "@/components/projects/project-planning";
import { ProjectSettingsDialog } from "@/components/projects/project-settings-dialog";
import { ProjectStaffingManager } from "@/components/projects/project-staffing-manager";
import { ProjectStakeholders } from "@/components/projects/project-stakeholders";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProjectOverviewData } from "@/lib/project-data/contracts";
import { cn } from "@/lib/utils";

export function ProjectPageContent({
  data,
  initialIssueId,
  initialTab,
  issueFilters,
  clients = [],
  canManage = false,
}: {
  data: ProjectOverviewData;
  initialIssueId?: string;
  initialTab: WorkspaceTab;
  issueFilters?: Partial<IssueFilters>;
  clients?: Array<{ id: string; name: string }>;
  canManage?: boolean;
}) {
  const { project, members } = data;
  const projectCode =
    "code" in project && typeof project.code === "string"
      ? project.code
      : undefined;
  const priority =
    "priority" in project && typeof project.priority === "string"
      ? project.priority
      : undefined;
  const owner = members.find((member) => member.id === project.ownerId);

  return (
    <div className="space-y-6">
      <Button asChild className="-ml-2" size="sm" variant="ghost">
        <Link href="/projects">
          <ArrowLeft />
          All projects
        </Link>
      </Button>
      <header className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-start">
          <div className="flex gap-4">
            <div
              className={cn("mt-1 size-3 shrink-0 rounded-full", project.color)}
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {projectCode && (
                  <Badge className="font-mono" variant="outline">
                    {projectCode}
                  </Badge>
                )}
                {project.clientId ? (
                  <Link
                    className="text-xs font-semibold uppercase tracking-wider text-primary hover:underline"
                    href={`/clients/${project.clientId}`}
                  >
                    {project.client}
                  </Link>
                ) : (
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {project.client}
                  </p>
                )}
                <Badge
                  variant={project.status === "active" ? "default" : "secondary"}
                >
                  {project.status.replace("_", " ")}
                </Badge>
                {priority && <Badge variant="secondary">{priority} priority</Badge>}
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {project.name}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {project.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            {canManage ? (
              <ProjectSettingsDialog clients={clients} project={project} />
            ) : null}
            <ProjectIntelligence projectId={project.id} />
            {project.sourceSystem === "basecamp" && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/archive/${project.id}`}>
                  <History />
                  Historical archive
                </Link>
              </Button>
            )}
            <div className="flex -space-x-2">
              {members.slice(0, 8).map((member) => (
                <Avatar className="size-8 border-2 border-card" key={member.id}>
                  <AvatarFallback className="text-[10px]">
                    {member.initials}
                  </AvatarFallback>
                </Avatar>
              ))}
            </div>
            {project.slackChannel && (
              <Badge variant="secondary">
                <Hash className="mr-1 size-3" />
                {project.slackChannel.replace("#", "")}
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4 text-xs">
          <Badge variant="outline">
            <ListTodo className="mr-1 size-3" />
            {data.tabCounts.openTodos.toLocaleString()} imported open records
          </Badge>
          <Badge variant="outline">
            <Users className="mr-1 size-3" />
            {members.length} members
          </Badge>
          {owner && (
            <Badge variant="outline">
              <UserRound className="mr-1 size-3" />
              Owner: {owner.fullName}
            </Badge>
          )}
          {project.dueDate && (
            <Badge variant="outline">
              <CalendarDays className="mr-1 size-3" />
              Due {formatDate(project.dueDate)}
            </Badge>
          )}
          {project.budget !== undefined && (
            <Badge variant="outline">
              <Banknote className="mr-1 size-3" />
              {new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: project.currency ?? "USD",
                maximumFractionDigits: 0,
              }).format(project.budget)}
            </Badge>
          )}
          {project.billingType && (
            <Badge variant="outline">
              {project.billingType === "time_and_materials"
                ? "Time & materials"
                : project.billingType === "fixed_fee"
                  ? "Fixed fee"
                  : "Internal"}
            </Badge>
          )}
          <span className="text-muted-foreground">
            Imported records are separated into active, triage, and historical
            scopes in the issue navigator.
          </span>
        </div>
      </header>
      <ProjectStakeholders canManage={canManage} projectId={project.id} />
      <ProjectStaffingManager canManage={canManage} projectId={project.id} />
      <ProjectPlanning canManage={canManage} projectId={project.id} />
      <ProjectCommercialSummary projectId={project.id} />
      <LinkedConversations workId={project.id} workType="project" />
      <ProjectChannelBinding projectId={project.id} />
      <ProjectWorkspace
        data={data}
        initialIssueId={initialIssueId}
        initialTab={initialTab}
        issueFilters={issueFilters}
        project={project}
      />
    </div>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
