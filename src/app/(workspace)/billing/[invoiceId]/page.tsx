import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  FileText,
  Printer,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  formatMoney,
  invoiceBalance,
  type InvoiceStatus,
} from "@/components/billing/calculations";
import {
  InvoiceActions,
  InvoiceEditDialog,
} from "@/components/billing/invoice-actions";
import { InvoiceCollectionsPanel } from "@/components/billing/invoice-collections-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

interface Invoice {
  id: string;
  client_id: string;
  invoice_number: string;
  subject: string;
  attention_to: string | null;
  service_period_start: string | null;
  service_period_end: string | null;
  status: InvoiceStatus;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  notes: string | null;
  payment_instructions: string | null;
  payment_terms: string | null;
  collection_owner_id: string | null;
  promised_payment_date: string | null;
  collection_notes: string | null;
  collection_promise_notes: string | null;
  delivered_at: string | null;
  delivery_method: string | null;
  client: { name: string; billing_email?: string | null } | { name: string; billing_email?: string | null }[];
}

interface LineItem {
  id: string;
  description: string;
  details: string | null;
  item_type: string;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
}

interface PaymentAllocation {
  id: string;
  amount_cents: number;
  payment:
    | {
        id: string;
        payment_date: string;
        amount_cents: number;
        currency: string;
        method: string;
        reference: string | null;
        notes: string | null;
      }
    | {
        id: string;
        payment_date: string;
        amount_cents: number;
        currency: string;
        method: string;
        reference: string | null;
        notes: string | null;
      }[];
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const viewer = await getViewer();
  const canManage = viewer?.capabilities.commercialWrite ?? false;
  const supabase = await createClient();
  if (!supabase) return <UnavailableInvoice />;

  const [invoiceResult, linesResult, paymentsResult, managersResult, deliveriesResult] =
    await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id,client_id,invoice_number,subject,attention_to,service_period_start,service_period_end,status,issue_date,due_date,currency,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,notes,payment_instructions,payment_terms,collection_owner_id,promised_payment_date,collection_notes,collection_promise_notes,delivered_at,delivery_method,client:clients(name,billing_email)",
      )
      .eq("id", invoiceId)
      .maybeSingle(),
    supabase
      .from("invoice_line_items")
      .select("id,item_type,description,details,quantity,unit_amount_cents,amount_cents")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("payment_allocations")
      .select("id,amount_cents,payment:payments(id,payment_date,amount_cents,currency,method,reference,notes)")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: false }),
    canManage
      ? supabase
          .from("profiles")
          .select("id,full_name")
          .in("role", ["admin", "manager"])
          .eq("status", "active")
          .order("full_name")
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("invoice_deliveries")
          .select("id,status,recipient_email,delivery_method,attempt_count,sent_at,failure_reason")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (invoiceResult.error || linesResult.error || paymentsResult.error) {
    return <UnavailableInvoice />;
  }
  if (!invoiceResult.data) notFound();

  const invoice = invoiceResult.data as unknown as Invoice;
  const lines = (linesResult.data ?? []) as LineItem[];
  const payments = (paymentsResult.data ?? []) as unknown as PaymentAllocation[];
  const client = relation(invoice.client);
  const balance = invoiceBalance({
    total: invoice.total_cents / 100,
    amountPaid: invoice.paid_cents / 100,
    balanceDue: invoice.balance_cents / 100,
  });

  return (
    <div className="space-y-6">
      <Button asChild size="sm" variant="ghost">
        <Link href="/billing"><ArrowLeft /> Back to billing</Link>
      </Button>

      <header className="flex flex-col justify-between gap-5 border-b pb-6 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-3xl font-semibold tracking-tight">
              {invoice.invoice_number}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-4" /> {client?.name ?? "Client"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" /> Due {formatDate(invoice.due_date)}
            </span>
          </div>
          <p className="mt-3 font-medium">{invoice.subject}</p>
          {invoice.attention_to ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Attention: {invoice.attention_to}
            </p>
          ) : null}
        </div>
        <div className="space-y-3">
          <Button asChild variant="outline">
            <Link href={`/billing/${invoice.id}/print`}>
              <Printer />
              Print or save PDF
            </Link>
          </Button>
          {canManage && invoice.status === "draft" ? (
            <InvoiceEditDialog
              invoice={{
                id: invoice.id,
                invoiceNumber: invoice.invoice_number,
                subject: invoice.subject,
                attentionTo: invoice.attention_to,
                issueDate: invoice.issue_date,
                dueDate: invoice.due_date,
                servicePeriodStart: invoice.service_period_start,
                servicePeriodEnd: invoice.service_period_end,
                notes: invoice.notes,
                paymentInstructions: invoice.payment_instructions,
                paymentTerms: invoice.payment_terms,
              }}
            />
          ) : null}
          {canManage ? (
            <InvoiceActions
              balanceDue={balance}
              clientId={invoice.client_id}
              currency={invoice.currency}
              invoiceId={invoice.id}
              invoiceNumber={invoice.invoice_number}
              status={invoice.status}
            />
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
              <CardDescription>
                Issued {formatDate(invoice.issue_date)} · {invoice.currency}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {lines.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Description</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="pr-4 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="max-w-md whitespace-normal pl-4 font-medium">
                          <p>{line.description}</p>
                          {line.details ? (
                            <p className="mt-1 whitespace-pre-wrap text-xs font-normal leading-5 text-muted-foreground">
                              {line.details}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {line.item_type}
                          </p>
                        </TableCell>
                        <TableCell className="text-right font-mono">{line.quantity}</TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMoney(line.unit_amount_cents / 100, invoice.currency)}
                        </TableCell>
                        <TableCell className="pr-4 text-right font-mono font-medium">
                          {formatMoney(line.amount_cents / 100, invoice.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3}>Subtotal</TableCell>
                      <TableCell className="pr-4 text-right font-mono">
                        {formatMoney(invoice.subtotal_cents / 100, invoice.currency)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={3}>Tax</TableCell>
                      <TableCell className="pr-4 text-right font-mono">
                        {formatMoney(invoice.tax_cents / 100, invoice.currency)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-semibold" colSpan={3}>Total</TableCell>
                      <TableCell className="pr-4 text-right font-mono font-semibold">
                        {formatMoney(invoice.total_cents / 100, invoice.currency)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              ) : (
                <div className="grid min-h-40 place-items-center text-center">
                  <div>
                    <FileText className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-2 font-medium">No line items</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      This draft does not have billable lines yet.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment history</CardTitle>
              <CardDescription>Payments allocated to this invoice.</CardDescription>
            </CardHeader>
            <CardContent>
              {payments.length ? (
                <div className="divide-y">
                  {payments.map((allocation) => {
                    const payment = relation(allocation.payment);
                    return (
                      <div className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={allocation.id}>
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                            <CreditCard className="size-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium">{formatDate(payment?.payment_date ?? null)}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {payment?.reference || "Payment recorded"} ·{" "}
                              {formatPaymentMethod(payment?.method)}
                            </p>
                          </div>
                        </div>
                        <p className="shrink-0 font-mono font-medium">
                          {formatMoney(allocation.amount_cents / 100, invoice.currency)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No payments have been recorded.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-mono text-3xl font-semibold tracking-tight">
                {formatMoney(balance, invoice.currency)}
              </p>
              <Separator className="my-4" />
              <dl className="space-y-3 text-sm">
                <AmountRow label="Invoice total" value={formatMoney(invoice.total_cents / 100, invoice.currency)} />
                <AmountRow label="Paid" value={formatMoney(invoice.paid_cents / 100, invoice.currency)} />
                <AmountRow label="Due date" value={formatDate(invoice.due_date)} />
              </dl>
            </CardContent>
          </Card>
          {invoice.notes ? (
            <Card>
              <CardHeader><CardTitle>Invoice note</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {invoice.notes}
                </p>
              </CardContent>
            </Card>
          ) : null}
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Delivery</CardTitle>
                <CardDescription>
                  {invoice.delivered_at
                    ? `Delivered ${formatDate(invoice.delivered_at.slice(0, 10))} via ${invoice.delivery_method ?? "email"}`
                    : "Not yet delivered"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(deliveriesResult.data ?? []).map((delivery) => (
                  <div className="rounded-md border px-3 py-2" key={delivery.id}>
                    <p className="font-medium capitalize">{delivery.status.replaceAll("_", " ")}</p>
                    <p className="text-muted-foreground">{delivery.recipient_email}</p>
                    {delivery.failure_reason ? (
                      <p className="mt-1 text-destructive">{delivery.failure_reason}</p>
                    ) : null}
                  </div>
                ))}
                {!deliveriesResult.data?.length ? (
                  <p className="text-muted-foreground">No delivery attempts queued yet.</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {canManage ? (
        <InvoiceCollectionsPanel
          canManage={canManage}
          collectionNotes={invoice.collection_notes}
          collectionOwnerId={invoice.collection_owner_id}
          collectionPromiseNotes={invoice.collection_promise_notes}
          invoiceId={invoice.id}
          managers={managersResult.data ?? []}
          promisedPaymentDate={invoice.promised_payment_date}
        />
      ) : null}
    </div>
  );
}

function UnavailableInvoice() {
  return (
    <div className="space-y-5">
      <Button asChild size="sm" variant="ghost"><Link href="/billing"><ArrowLeft /> Back to billing</Link></Button>
      <Alert variant="destructive">
        <AlertTitle>Invoice unavailable</AlertTitle>
        <AlertDescription>
          We could not load this invoice. Refresh the page or try again shortly.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const variant =
    status === "void" ? "destructive" :
    status === "draft" ? "outline" :
    status === "paid" ? "default" : "secondary";
  return <Badge className="capitalize" variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium">{value}</dd>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Not set";
  return new Date(`${value}T00:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function formatPaymentMethod(value?: string) {
  return value
    ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Method not set";
}
