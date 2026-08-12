import { AlertCircle, ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientOverview } from "@/components/crm/client-overview";
import { ClientDialog } from "@/components/crm/crm-dialogs";
import type { ClientDetailData } from "@/components/crm/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/auth/viewer";
import * as psaServer from "@/lib/psa/server";

export async function generateMetadata({
  params,
}: PageProps<"/clients/[clientId]">) {
  const { clientId } = await params;
  return { title: `Client ${clientId}` };
}

export default async function ClientDetailPage({
  params,
}: PageProps<"/clients/[clientId]">) {
  const { clientId } = await params;
  const viewer = await getViewer();
  const canManage = viewer?.capabilities.commercialWrite ?? false;
  let data: ClientDetailData;
  let formOptions: {
    clients: Array<{ id: string; name: string }>;
    owners: Array<{ id: string; full_name: string }>;
  } = { clients: [], owners: [] };

  try {
    const { getClientDetailData, getClientFormOptions } = psaServer as unknown as {
      getClientDetailData: (id: string) => Promise<unknown>;
      getClientFormOptions: () => Promise<{
        clients: Array<{ id: string; name: string }>;
        owners: Array<{ id: string; full_name: string }>;
      }>;
    };
    const [result, options] = await Promise.all([
      getClientDetailData(clientId),
      canManage ? getClientFormOptions() : Promise.resolve(formOptions),
    ]);
    if (!result) notFound();
    data = result as unknown as ClientDetailData;
    formOptions = options;
  } catch (error) {
    if (isNotFoundError(error)) throw error;
    return (
      <div className="space-y-6">
        <BackLink />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Client could not be loaded</AlertTitle>
          <AlertDescription>
            Refresh the page to try again. The client record was not changed.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <BackLink />
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{data.client.name}</h1>
            <Badge variant="secondary">{data.client.status || "active"}</Badge>
          </div>
          <p className="mt-2 text-muted-foreground">
            {data.client.industry || "Client account"}
            {data.client.ownerName ? ` · Owned by ${data.client.ownerName}` : ""}
            {data.client.parentClientName
              ? ` · Subsidiary of ${data.client.parentClientName}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.client.parentClientId ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/clients/${data.client.parentClientId}`}>
                Parent account
              </Link>
            </Button>
          ) : null}
          {data.client.website && (
            <Button asChild size="sm" variant="outline">
              <a href={data.client.website} rel="noreferrer" target="_blank">
                Website <ExternalLink />
              </a>
            </Button>
          )}
          {canManage ? (
            <ClientDialog
              accountOptions={formOptions.clients
                .filter((account) => account.id !== data.client.id)
                .map((account) => ({ id: account.id, name: account.name }))}
              client={data.client}
              profiles={formOptions.owners.map((owner) => ({
                id: owner.id,
                name: owner.full_name,
              }))}
            />
          ) : null}
        </div>
      </header>
      <ClientOverview canManage={canManage} data={data} />
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild className="-ml-2" size="sm" variant="ghost">
      <Link href="/clients"><ArrowLeft />All clients</Link>
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
