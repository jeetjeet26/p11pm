import { ArrowUpRight, BriefcaseBusiness, Hash, Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Project } from "@/lib/types";

const statusLabels: Record<Project["status"], string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link className="group block h-full" href={`/projects/${project.id}`}>
      <Card className="h-full gap-0 py-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/35 group-hover:shadow-md">
        <CardHeader className="space-y-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className={cn("grid size-10 place-items-center rounded-xl text-white", project.color)}>
              <BriefcaseBusiness className="size-5" />
            </div>
            <ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {project.client}
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{project.name}</h2>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">
            {project.description}
          </p>
          <div className="mt-5">
            <div className="mb-2 flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{project.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                aria-label={`${project.progress}% complete`}
                className="h-full rounded-full bg-primary"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="mt-auto flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" />
              {project.memberIds.length}
            </span>
            {project.slackChannel && (
              <span className="flex items-center gap-0.5">
                <Hash className="size-3.5" />
                {project.slackChannel.replace("#", "")}
              </span>
            )}
          </div>
          <Badge variant={project.status === "active" ? "default" : "secondary"}>
            {statusLabels[project.status]}
          </Badge>
        </CardFooter>
      </Card>
    </Link>
  );
}
