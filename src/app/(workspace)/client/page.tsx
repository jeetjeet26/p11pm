import { CheckCircle2, FolderKanban, MessageSquareText } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Client portal" };

export default async function ClientPortalPage() {
  const client = await createClient();
  const {
    data: { user },
  } = client ? await client.auth.getUser() : { data: { user: null } };
  const grants =
    client && user
      ? await client
          .from("guest_project_access")
          .select("id,project_id,access_role,can_access_chat,expires_at")
          .eq("profile_id", user.id)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
          .order("created_at", { ascending: false })
      : { data: [] };
  const service = getAppSupabaseClient();
  const projectIds = (grants.data ?? []).map((grant) => grant.project_id);
  const [projects, approvals] =
    service && user
      ? await Promise.all([
          projectIds.length
            ? service
                .from("projects")
                .select("id,name,client_name,status,due_date,description")
                .in("id", projectIds)
            : Promise.resolve({ data: [] }),
          service
            .from("work_approvals")
            .select("id,project_id,title,description,status,due_at")
            .eq("reviewer_id", user.id)
            .order("created_at", { ascending: false })
            .limit(100),
        ])
      : [{ data: [] }, { data: [] }];
  const projectsById = new Map(
    (projects.data ?? []).map((project) => [project.id, project] as const),
  );

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Client portal</h1>
        <p className="mt-2 text-muted-foreground">
          Deliverables, milestones, and approvals shared with you.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Shared projects
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(grants.data ?? []).map((grant) => {
            const project = projectsById.get(grant.project_id);
            if (!project) return null;
            return (
              <Card key={grant.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <FolderKanban className="size-5 text-muted-foreground" />
                    <Badge variant="secondary">{grant.access_role}</Badge>
                  </div>
                  <CardTitle className="mt-3 text-lg">{String(project.name)}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-3 text-sm text-muted-foreground">
                    {project.description ?? "Project deliverables and status."}
                  </p>
                  <Button asChild className="mt-4" size="sm">
                    <Link href={`/client/projects/${project.id}`}>Open project</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4" />
            Review requests
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {(approvals.data ?? []).map((approval) => (
            <div
              className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
              key={approval.id}
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{approval.title}</p>
                  <Badge variant="secondary">{approval.status}</Badge>
                </div>
                {approval.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {approval.description}
                  </p>
                )}
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href={`/client/projects/${approval.project_id}`}>
                  <MessageSquareText />
                  Review
                </Link>
              </Button>
            </div>
          ))}
          {!(approvals.data ?? []).length && (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No review requests are waiting.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
