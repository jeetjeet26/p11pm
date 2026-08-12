import { AlertCircle, Clock3, Repeat2, WalletCards } from "lucide-react";

import { RetainerDialog } from "@/components/crm/crm-dialogs";
import { RetainersList } from "@/components/crm/retainers-view";
import type { RetainersPageData } from "@/components/crm/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getViewer } from "@/lib/auth/viewer";
import * as psaServer from "@/lib/psa/server";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Retainers" };

export default async function RetainersPage() {
  const viewer = await getViewer();
  const canManage = viewer?.capabilities.commercialWrite ?? false;
  let data: RetainersPageData;
  try {
    const { getRetainersPageData } = psaServer as unknown as {
      getRetainersPageData: () => Promise<unknown>;
    };
    data = (await getRetainersPageData()) as RetainersPageData;
  } catch {
    return (
      <PageHeader count={0}>
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Retainers could not be loaded</AlertTitle>
          <AlertDescription>
            Refresh the page to try again. No agreement data was changed.
          </AlertDescription>
        </Alert>
      </PageHeader>
    );
  }

  const supabase = await createClient();
  if (supabase && data.retainers.length) {
    const { data: contracts } = await supabase
      .from("retainers")
      .select(
        "id,cadence,start_date,end_date,fee_cents,overage_rate_cents,rollover_policy,currency",
      )
      .in("id", data.retainers.map((retainer) => retainer.id));
    const byId = new Map((contracts ?? []).map((contract) => [contract.id, contract]));
    data.retainers = data.retainers.map((retainer) => {
      const contract = byId.get(retainer.id);
      return contract
        ? {
            ...retainer,
            cadence: contract.cadence,
            startDate: contract.start_date,
            endDate: contract.end_date,
            value: contract.fee_cents / 100,
            hourlyRate:
              contract.overage_rate_cents === null
                ? null
                : contract.overage_rate_cents / 100,
            overagePolicy: contract.rollover_policy,
            currency: contract.currency,
          }
        : retainer;
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const active = data.retainers.filter(
    (item) =>
      item.status === "active" &&
      (!item.startDate || item.startDate <= today) &&
      (!item.endDate || item.endDate >= today),
  );
  const allowance = active.reduce((sum, item) => sum + item.allowanceHours, 0);
  const value = active.reduce(
    (sum, item) => sum + (item.value ?? 0) * cadencePeriodsPerYear(item.cadence),
    0,
  );

  return (
    <PageHeader
      action={
        canManage ? <RetainerDialog clients={data.clients ?? []} /> : undefined
      }
      count={data.totalCount ?? data.retainers.length}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Summary icon={Repeat2} label="Active retainers" value={active.length.toLocaleString()} />
        <Summary icon={Clock3} label="Monthly allowance" value={`${allowance.toLocaleString()}h`} />
        <Summary icon={WalletCards} label="Annual contract value" value={formatCurrency(value)} />
      </div>
      <RetainersList retainers={data.retainers} />
    </PageHeader>
  );
}

function PageHeader({
  count,
  action,
  children,
}: {
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">Retainers</h1>
            <Badge variant="secondary">{count.toLocaleString()}</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Track recurring allowance, delivery pace, projected overage, and
            commercial value.
          </p>
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

function Summary({ icon: Icon, label, value }: { icon: typeof Repeat2; label: string; value: string }) {
  return <Card size="sm"><CardContent className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><span><span className="block text-xl font-semibold">{value}</span><span className="text-xs text-muted-foreground">{label}</span></span></CardContent></Card>;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function cadencePeriodsPerYear(cadence?: string | null) {
  if (cadence === "weekly") return 52;
  if (cadence === "monthly") return 12;
  if (cadence === "quarterly") return 4;
  return 1;
}
