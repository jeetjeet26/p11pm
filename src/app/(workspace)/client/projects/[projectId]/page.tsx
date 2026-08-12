import { CalendarDays, CheckCircle2, Download, FileText } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientApprovalActions } from "@/components/client/client-approval-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppSupabaseClient } from "@/lib/integrations/supabase";
import { createClient } from "@/lib/supabase/server";

export default async function SharedProjectPage({
  params,
}: PageProps<"/client/projects/[projectId]">) {
  const { projectId } = await params;
  const client = await createClient();
  if (!client) redirect("/login");
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  const { data: grant } = await client
    .from("guest_project_access")
    .select("id,access_role,expires_at")
    .eq("project_id", projectId)
    .eq("profile_id", user.id)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle();
  if (!grant) notFound();
  const service = getAppSupabaseClient();
  if (!service) notFound();
  const [project, milestones, docs, sharedFiles, approvals] = await Promise.all([
    service
      .from("projects")
      .select("id,name,client_name,description,status,due_date")
      .eq("id", projectId)
      .single(),
    service
      .from("milestones")
      .select("id,name,description,status,due_date")
      .eq("project_id", projectId)
      .order("due_date"),
    service
      .from("docs")
      .select("id,title,status,updated_at")
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(100),
    service
      .from("file_shares")
      .select(
        "id,permission,file:files!file_shares_file_id_fkey(id,project_id,file_name,mime_type,size_bytes)",
      )
      .eq("shared_with_profile_id", user.id)
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .eq("file.project_id", projectId),
    service
      .from("work_approvals")
      .select("id,title,description,status,due_at")
      .eq("project_id", projectId)
      .eq("reviewer_id", user.id)
      .order("created_at", { ascending: false }),
  ]);
  if (!project.data) notFound();

  return (
    <div className="space-y-7">
      <header className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{project.data.status.replaceAll("_", " ")}</Badge>
          <Badge variant="secondary">{grant.access_role}</Badge>
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {project.data.name}
        </h1>
        <p className="mt-1 text-sm font-medium text-muted-foreground">
          {project.data.client_name}
        </p>
        {project.data.description && (
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {project.data.description}
          </p>
        )}
      </header>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="size-4" />
              Milestones
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {(milestones.data ?? []).map((milestone) => (
              <div className="flex items-start justify-between gap-3 px-5 py-4" key={milestone.id}>
                <div>
                  <p className="font-medium">{milestone.name}</p>
                  {milestone.description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {milestone.description}
                    </p>
                  )}
                </div>
                <Badge variant="secondary">
                  {milestone.status} · {milestone.due_date}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              Shared documents
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {(docs.data ?? []).map((doc) => (
              <div className="flex items-center justify-between px-5 py-4" key={doc.id}>
                <p className="font-medium">{doc.title}</p>
                <Badge variant="secondary">{doc.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="size-4" />
              Shared files
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {(sharedFiles.data ?? []).map((share) => {
              const file = Array.isArray(share.file) ? share.file[0] : share.file;
              if (!file) return null;
              return (
                <div
                  className="flex items-center justify-between gap-3 px-5 py-4"
                  key={share.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{file.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {share.permission} access
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/files/${file.id}`}>
                      <Download />
                      Download
                    </a>
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4" />
            Your approvals
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {(approvals.data ?? []).map((approval) => (
            <div
              className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
              key={approval.id}
            >
              <div>
                <p className="font-medium">{approval.title}</p>
                {approval.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {approval.description}
                  </p>
                )}
              </div>
              <ClientApprovalActions
                approvalId={approval.id}
                initialStatus={approval.status}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
