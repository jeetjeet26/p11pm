import { AlertCircle } from "lucide-react";

import { ClientDialog, ContactDedupPanel } from "@/components/crm/crm-dialogs";
import { ClientsDirectory } from "@/components/crm/clients-directory";
import type { ClientsPageData } from "@/components/crm/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getViewer } from "@/lib/auth/viewer";
import * as psaServer from "@/lib/psa/server";

export const metadata = { title: "Clients" };

export default async function ClientsPage({
  searchParams,
}: PageProps<"/clients">) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const ownerId = typeof params.ownerId === "string" ? params.ownerId : undefined;
  const parentClientId =
    typeof params.parentClientId === "string" ? params.parentClientId : undefined;
  const viewer = await getViewer();
  const canManage = viewer?.capabilities.commercialWrite ?? false;
  let data: ClientsPageData;

  try {
    const { getClientsPageData } = psaServer as unknown as {
      getClientsPageData: (input: {
        query: string;
        ownerId?: string;
        parentClientId?: string;
      }) => Promise<unknown>;
    };
    data = (await getClientsPageData({ query, ownerId, parentClientId })) as ClientsPageData;
  } catch {
    return (
      <PageFrame
        accountOptions={[]}
        canManage={canManage}
        count={0}
        profiles={[]}
      >
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Clients could not be loaded</AlertTitle>
          <AlertDescription>
            Refresh the page to try again. If the problem continues, check the
            workspace data connection.
          </AlertDescription>
        </Alert>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      accountOptions={data.accountOptions ?? []}
      canManage={canManage}
      count={data.totalCount ?? data.clients.length}
      profiles={data.owners ?? []}
    >
      <ClientsDirectory
        accountOptions={data.accountOptions ?? []}
        clients={data.clients}
        ownerId={ownerId}
        owners={data.owners ?? []}
        parentClientId={parentClientId}
        query={query}
      />
    </PageFrame>
  );
}

function PageFrame({
  count,
  canManage,
  profiles,
  accountOptions,
  children,
}: {
  count: number;
  canManage: boolean;
  profiles: Array<{ id: string; name: string }>;
  accountOptions: Array<{ id: string; name: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Clients</h1>
            <Badge variant="secondary">{count.toLocaleString()}</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Relationship context, active work, recurring revenue, and account
            health in one directory.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <ContactDedupPanel />
            <ClientDialog accountOptions={accountOptions} profiles={profiles} />
          </div>
        ) : null}
      </header>
      {children}
    </div>
  );
}
