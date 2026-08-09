import { ArrowLeft, Hash, History } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProjectOverviewData } from "@/lib/data";
import { cn } from "@/lib/utils";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const data = await getProjectOverviewData(projectId);
  if (!data) notFound();
  const { project, members } = data;
  if (project.isReadOnly) redirect(`/archive/${project.id}`);

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
            <div className={cn("mt-1 size-3 shrink-0 rounded-full", project.color)} />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {project.client}
                </p>
                <Badge variant={project.status === "active" ? "default" : "secondary"}>
                  {project.status.replace("_", " ")}
                </Badge>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                {project.description}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            {project.sourceSystem === "basecamp" && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/archive/${project.id}`}>
                  <History />
                  Basecamp history
                </Link>
              </Button>
            )}
            <div className="flex -space-x-2">
              {members.map((member) => (
                <Avatar className="size-8 border-2 border-card" key={member.id}>
                  <AvatarFallback className="text-[10px]">{member.initials}</AvatarFallback>
                </Avatar>
              ))}
            </div>
            {project.slackChannel && (
              <Badge variant="secondary"><Hash className="mr-1 size-3" />{project.slackChannel.replace("#", "")}</Badge>
            )}
          </div>
        </div>
        <div className="mt-6 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${project.progress}%` }} />
          </div>
          <span className="text-xs font-medium text-muted-foreground">{project.progress}% complete</span>
        </div>
      </header>
      <ProjectWorkspace data={data} project={project} />
    </div>
  );
}
