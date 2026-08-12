import { AlertCircle, CircleDollarSign, Clock3, FileText, WalletCards } from "lucide-react";
import Link from "next/link";

import {
  agingBucket,
  formatMoney,
  invoiceAgeInDays,
  invoiceBalance,
  type InvoiceStatus,
} from "@/components/billing/calculations";
import { InvoiceCreateDialog } from "@/components/billing/invoice-create-dialog";
import {
  ReadyToBillDialog,
  type ReadyToBillGroup,
} from "@/components/billing/ready-to-bill-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Billing" };

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  client: { name: string } | { name: string }[] | null;
}

interface BillableTimeRow {
  id: string;
  client_id: string;
  project_id: string;
  entry_date: string;
  description: string;
  minutes: number;
  billable_amount_cents: number;
  currency: string;
  client: { name: string } | { name: string }[] | null;
  project: { name: string } | { name: string }[] | null;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const statusFilter = typeof query.status === "string" ? query.status : "all";
  const viewer = await getViewer();
  const canManage = viewer?.capabilities.commercialWrite ?? false;
  const supabase = await createClient();
  let invoices: InvoiceRow[] = [];
  let clients: { id: string; name: string }[] = [];
  let retainers: { id: string; client_id: string; name: string }[] = [];
  let readyToBill: ReadyToBillGroup[] = [];
  let loadError = false;

  if (supabase) {
    let invoiceQuery = supabase
      .from("invoices")
      .select(
        "id,invoice_number,status,issue_date,due_date,currency,total_cents,paid_cents,balance_cents,client:clients(name)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") invoiceQuery = invoiceQuery.eq("status", statusFilter);

    const [invoiceResult, clientResult, retainerResult, timeResult] = await Promise.all([
      invoiceQuery,
      supabase.from("clients").select("id,name").eq("status", "active").order("name").limit(250),
      supabase
        .from("retainers")
        .select("id,client_id,name")
        .eq("status", "active")
        .order("name")
        .limit(500),
      canManage
        ? supabase
            .from("time_entries")
            .select(
              "id,client_id,project_id,entry_date,description,minutes,billable_amount_cents,currency,client:clients(name),project:projects(name)",
            )
            .eq("status", "approved")
            .eq("billable", true)
            .order("entry_date", { ascending: true })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);
    loadError = Boolean(
      invoiceResult.error || clientResult.error || retainerResult.error || timeResult.error,
    );
    invoices = (invoiceResult.data ?? []) as unknown as InvoiceRow[];
    clients = clientResult.data ?? [];
    retainers = retainerResult.data ?? [];
    readyToBill = groupBillableTime(
      (timeResult.data ?? []) as unknown as BillableTimeRow[],
    );
  }

  const outstanding = invoices.reduce((sum, invoice) => sum + invoiceBalance({
    total: invoice.total_cents / 100,
    amountPaid: invoice.paid_cents / 100,
    balanceDue: invoice.balance_cents / 100,
  }), 0);
  const overdue = invoices.reduce((sum, invoice) => {
    const age = invoiceAgeInDays(invoice.due_date, invoice.status);
    return age > 0 ? sum + invoiceBalance({
      total: invoice.total_cents / 100,
      amountPaid: invoice.paid_cents / 100,
      balanceDue: invoice.balance_cents / 100,
    }) : sum;
  }, 0);
  const paid = invoices.reduce((sum, invoice) => sum + Number(invoice.paid_cents || 0) / 100, 0);
  const primaryCurrency = invoices[0]?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Billing</h1>
          <p className="mt-2 text-muted-foreground">
            Draft, issue, and collect client invoices from one ledger.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <ReadyToBillDialog groups={readyToBill} />
            <InvoiceCreateDialog clients={clients} retainers={retainers} />
          </div>
        ) : null}
      </header>

      {loadError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Billing data unavailable</AlertTitle>
          <AlertDescription>
            We could not load the invoice ledger. Refresh or try again shortly.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={WalletCards}
          label="Outstanding"
          value={formatMoney(outstanding, primaryCurrency)}
        />
        <SummaryCard
          icon={Clock3}
          label="Overdue"
          value={formatMoney(overdue, primaryCurrency)}
        />
        <SummaryCard
          icon={CircleDollarSign}
          label="Collected"
          value={formatMoney(paid, primaryCurrency)}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="navigation" aria-label="Invoice status filters">
        {["all", "draft", "issued", "partially_paid", "overdue", "paid", "void"].map((status) => (
          <Button
            asChild
            key={status}
            size="sm"
            variant={statusFilter === status ? "secondary" : "ghost"}
          >
            <Link href={status === "all" ? "/billing" : `/billing?status=${status}`}>
              {status[0].toUpperCase() + status.slice(1)}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {invoices.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Invoice</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Aging</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-4 text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => {
                  const age = invoiceAgeInDays(invoice.due_date, invoice.status);
                  const balance = invoiceBalance({
                    total: invoice.total_cents / 100,
                    amountPaid: invoice.paid_cents / 100,
                    balanceDue: invoice.balance_cents / 100,
                  });
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="pl-4">
                        <Link
                          className="font-mono font-medium text-primary hover:underline"
                          href={`/billing/${invoice.id}`}
                        >
                          {invoice.invoice_number}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{relation(invoice.client)?.name ?? "Client"}</TableCell>
                      <TableCell><InvoiceStatusBadge status={invoice.status} /></TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(invoice.issue_date)}
                      </TableCell>
                      <TableCell>
                        <span className={age > 30 ? "font-medium text-destructive" : "text-muted-foreground"}>
                          {agingBucket(age)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(invoice.total_cents / 100, invoice.currency)}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-mono font-medium">
                        {formatMoney(balance, invoice.currency)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="grid min-h-64 place-items-center px-6 text-center">
              <div>
                <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
                  <FileText className="size-5 text-muted-foreground" />
                </div>
                <p className="mt-3 font-medium">No invoices found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter === "all"
                    ? "Create a draft when client work is ready to bill."
                    : `There are no ${statusFilter} invoices.`}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof WalletCards;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const variant =
    status === "void" ? "destructive" :
    status === "draft" ? "outline" :
    status === "paid" ? "default" : "secondary";
  return <Badge className="capitalize" variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

function groupBillableTime(rows: BillableTimeRow[]): ReadyToBillGroup[] {
  const groups = new Map<string, ReadyToBillGroup>();
  for (const row of rows) {
    const key = `${row.client_id}:${row.project_id}`;
    const group = groups.get(key) ?? {
      clientId: row.client_id,
      clientName: relation(row.client)?.name ?? "Client",
      projectId: row.project_id,
      projectName: relation(row.project)?.name ?? "Project",
      currency: row.currency,
      entries: [],
    };
    group.entries.push({
      id: row.id,
      entryDate: row.entry_date,
      description: row.description,
      durationMinutes: row.minutes,
      amount: row.billable_amount_cents / 100,
    });
    groups.set(key, group);
  }
  return [...groups.values()];
}
