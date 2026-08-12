import { AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { RetainerDialog } from "@/components/crm/crm-dialogs";
import { RetainerProjectManager } from "@/components/crm/retainer-project-manager";
import { RetainerDetail } from "@/components/crm/retainers-view";
import type { RetainerDetailData } from "@/components/crm/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import * as psaServer from "@/lib/psa/server";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: PageProps<"/retainers/[retainerId]">) {
  const { retainerId } = await params;
  return { title: `Retainer ${retainerId}` };
}

export default async function RetainerDetailPage({
  params,
}: PageProps<"/retainers/[retainerId]">) {
  const { retainerId } = await params;
  const viewer = await getViewer();
  const canManage = viewer?.capabilities.commercialWrite ?? false;
  let data: RetainerDetailData;

  try {
    const { getRetainerDetailData } = psaServer as unknown as {
      getRetainerDetailData: (id: string) => Promise<unknown>;
    };
    const result = await getRetainerDetailData(retainerId);
    if (!result) notFound();
    data = result as unknown as RetainerDetailData;
  } catch (error) {
    if (isNotFoundError(error)) throw error;
    return (
      <div className="space-y-6">
        <BackLink />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Retainer could not be loaded</AlertTitle>
          <AlertDescription>
            Refresh the page to try again. The agreement was not changed.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  let clients = [{ id: data.retainer.clientId, name: data.retainer.clientName ?? "Client" }];
  let linkedProjects: Array<{ id: string; name: string }> = [];
  let availableProjects: Array<{ id: string; name: string }> = [];
  const supabase = await createClient();
  if (supabase) {
    const [contractResult, clientsResult, projectsResult, availableProjectsResult] =
      await Promise.all([
      supabase
        .from("retainers")
        .select(
          "id,client_id,name,status,cadence,start_date,end_date,included_minutes,fee_cents,overage_rate_cents,rollover_policy,currency,allowance_type,allowance_value_cents,overage_policy,auto_renew,renewal_days,invoice_timing",
        )
        .eq("id", retainerId)
        .maybeSingle(),
      supabase.from("clients").select("id,name").order("name").limit(500),
      supabase
        .from("retainer_projects")
        .select("project:projects(id,name)")
        .eq("retainer_id", retainerId)
        .limit(100),
      supabase
        .from("projects")
        .select("id,name")
        .eq("client_id", data.retainer.clientId)
        .in("status", ["planning", "active", "on_hold"])
        .order("name")
        .limit(500),
    ]);
    if (contractResult.data) {
      const contract = contractResult.data;
      data.retainer = {
        ...data.retainer,
        clientId: contract.client_id,
        name: contract.name,
        status: contract.status,
        cadence: contract.cadence,
        startDate: contract.start_date,
        endDate: contract.end_date,
        allowanceHours: contract.included_minutes / 60,
        value: contract.fee_cents / 100,
        hourlyRate:
          contract.overage_rate_cents === null
            ? null
            : contract.overage_rate_cents / 100,
        rolloverPolicy: contract.rollover_policy,
        allowanceType: contract.allowance_type,
        allowanceValue:
          contract.allowance_value_cents === null
            ? null
            : contract.allowance_value_cents / 100,
        overagePolicy: contract.overage_policy,
        autoRenew: contract.auto_renew,
        renewalDays: contract.renewal_days,
        invoiceTiming: contract.invoice_timing,
        currency: contract.currency,
      };
    }
    if (clientsResult.data?.length) clients = clientsResult.data;
    linkedProjects = (projectsResult.data ?? []).flatMap((item) => {
      const project = Array.isArray(item.project) ? item.project[0] : item.project;
      return project ? [project] : [];
    });
    availableProjects = availableProjectsResult.data ?? [];
  }

  return (
    <div className="space-y-7">
      <BackLink />
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{data.retainer.name}</h1>
            <Badge variant="secondary">{data.retainer.status || "active"}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">
            {data.retainer.clientName || "Client retainer"} · recurring service agreement
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <RetainerProjectManager
              availableProjects={availableProjects}
              linkedProjects={linkedProjects}
              retainerId={retainerId}
            />
            <RetainerDialog clients={clients} retainer={data.retainer} />
          </div>
        ) : null}
      </header>
      {linkedProjects.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Funded jobs</span>
          {linkedProjects.map((project) => (
            <Badge asChild key={project.id} variant="outline">
              <Link href={`/projects/${project.id}`}>{project.name}</Link>
            </Badge>
          ))}
        </div>
      ) : null}
      <RetainerDetail canManage={canManage} data={data} />
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild className="-ml-2" size="sm" variant="ghost">
      <Link href="/retainers"><ArrowLeft />All retainers</Link>
    </Button>
  );
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_HTTP_ERROR_FALLBACK;404")
  );
}
