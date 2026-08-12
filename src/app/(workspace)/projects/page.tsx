import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { ProjectCard } from "@/components/projects/project-card";
import { ProjectCreateDialog } from "@/components/projects/project-create-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import { getProjectsPageData } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Projects" };

const PROJECTS_PER_PAGE = 24;
const MAX_PAGE = 100;

export default async function ProjectsPage({
  searchParams,
}: PageProps<"/projects">) {
  const query = await searchParams;
  const requestedPage = Math.min(
    Math.max(Number.parseInt(String(query.page ?? "1"), 10) || 1, 1),
    MAX_PAGE,
  );
  let currentPage = 1;
  let data = await getProjectsPageData();

  while (currentPage < requestedPage && data.nextCursor) {
    data = await getProjectsPageData(data.nextCursor);
    currentPage += 1;
  }

  const firstVisible = data.projects.length
    ? (currentPage - 1) * PROJECTS_PER_PAGE + 1
    : 0;
  const lastVisible = firstVisible + data.projects.length - 1;
  const viewer = data.demoMode ? null : await getViewer();
  const canCreate = viewer?.capabilities.commercialWrite ?? false;
  const supabase = data.demoMode ? null : await createClient();
  const { data: clients } = supabase
    ? await supabase
        .from("clients")
        .select("id,name")
        .order("name")
        .limit(1_000)
    : { data: [] };

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
        <ProjectCreateDialog canCreate={canCreate} clients={clients ?? []} />
      </header>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {data.projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
      <nav
        aria-label="Projects pagination"
        className="flex flex-col items-center justify-between gap-3 border-t pt-5 sm:flex-row"
      >
        <p className="text-sm text-muted-foreground">
          Showing {firstVisible.toLocaleString()}–{lastVisible.toLocaleString()} of{" "}
          {data.totalCount.toLocaleString()} projects
        </p>
        <div className="flex items-center gap-2">
          {currentPage > 1 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={projectPageHref(currentPage - 1)}>
                <ChevronLeft />
                Previous
              </Link>
            </Button>
          ) : (
            <Button disabled size="sm" variant="outline">
              <ChevronLeft />
              Previous
            </Button>
          )}
          <span className="min-w-16 text-center text-sm font-medium">
            Page {currentPage}
          </span>
          {data.nextCursor ? (
            <Button asChild size="sm" variant="outline">
              <Link href={projectPageHref(currentPage + 1)}>
                Next
                <ChevronRight />
              </Link>
            </Button>
          ) : (
            <Button disabled size="sm" variant="outline">
              Next
              <ChevronRight />
            </Button>
          )}
        </div>
      </nav>
    </div>
  );
}

function projectPageHref(page: number) {
  return page <= 1 ? "/projects" : `/projects?page=${page}`;
}
