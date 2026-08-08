import { Plus } from "lucide-react";

import { ProjectCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProjectsPageData } from "@/lib/data";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const data = await getProjectsPageData();
  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
            <Badge variant="secondary">{data.totalCount}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">
            Every client job, conversation, file, and assignment in one place.
          </p>
        </div>
        <Button disabled title="Project creation is managed by workspace administrators">
          <Plus />
          New project
        </Button>
      </header>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </div>
  );
}
