import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrintInvoiceButton } from "@/components/billing/print-invoice-button";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

interface PrintableInvoice {
  id: string;
  invoice_number: string;
  subject: string;
  attention_to: string | null;
  billing_address: Record<string, unknown>;
  issue_date: string;
  due_date: string;
  service_period_start: string | null;
  service_period_end: string | null;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string | null;
  payment_instructions: string | null;
  payment_terms: string | null;
  client:
    | {
        name: string;
        billing_email: string | null;
        billing_address: Record<string, unknown>;
      }
    | {
        name: string;
        billing_email: string | null;
        billing_address: Record<string, unknown>;
      }[];
}

interface PrintableLine {
  id: string;
  item_type: "service" | "material" | "fee" | "deposit" | "credit";
  description: string;
  details: string | null;
  quantity: number;
  unit_amount_cents: number;
  amount_cents: number;
}

export default async function PrintableInvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  const supabase = await createClient();
  if (!supabase) notFound();

  const [invoiceResult, linesResult] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "id,invoice_number,subject,attention_to,billing_address,issue_date,due_date,service_period_start,service_period_end,currency,subtotal_cents,tax_cents,total_cents,notes,payment_instructions,payment_terms,client:clients(name,billing_email,billing_address)",
      )
      .eq("id", invoiceId)
      .maybeSingle(),
    supabase
      .from("invoice_line_items")
      .select(
        "id,item_type,description,details,quantity,unit_amount_cents,amount_cents",
      )
      .eq("invoice_id", invoiceId)
      .order("position"),
  ]);
  if (invoiceResult.error || linesResult.error || !invoiceResult.data) notFound();

  const invoice = invoiceResult.data as unknown as PrintableInvoice;
  const lines = (linesResult.data ?? []) as PrintableLine[];
  const client = relation(invoice.client);
  const address = hasAddress(invoice.billing_address)
    ? invoice.billing_address
    : client?.billing_address;
  const sections = [
    {
      label: "Services",
      lines: lines.filter((line) => line.item_type !== "material"),
    },
    {
      label: "Materials",
      lines: lines.filter((line) => line.item_type === "material"),
    },
  ].filter((section) => section.lines.length);

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .invoice-print, .invoice-print * { visibility: visible; }
          .invoice-print { position: absolute; inset: 0; width: 100%; }
          .invoice-print-actions { display: none !important; }
          @page { margin: 0.55in; }
        }
      `}</style>
      <div className="invoice-print mx-auto max-w-4xl bg-white p-6 text-slate-950 sm:p-10">
        <div className="invoice-print-actions mb-8 flex items-center justify-between">
          <Button asChild variant="ghost">
            <Link href={`/billing/${invoice.id}`}>
              <ArrowLeft />
              Invoice detail
            </Link>
          </Button>
          <PrintInvoiceButton />
        </div>

        <header className="flex items-start justify-between gap-8 border-b-2 border-slate-900 pb-8">
          <div>
            <p className="text-2xl font-bold tracking-tight">P11creative, Inc.</p>
            <p className="mt-1 text-sm text-slate-600">Client services invoice</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold">INVOICE</p>
            <dl className="mt-4 grid grid-cols-[auto_auto] gap-x-5 gap-y-1 text-sm">
              <dt className="text-slate-500">Invoice No</dt>
              <dd className="font-semibold">{invoice.invoice_number}</dd>
              <dt className="text-slate-500">Date</dt>
              <dd>{formatDate(invoice.issue_date)}</dd>
              <dt className="text-slate-500">Due</dt>
              <dd>{formatDate(invoice.due_date)}</dd>
            </dl>
          </div>
        </header>

        <section className="grid gap-8 py-8 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Bill to
            </p>
            <p className="mt-2 text-lg font-semibold">{client?.name ?? "Client"}</p>
            {addressLines(address).map((line) => (
              <p className="text-sm text-slate-700" key={line}>
                {line}
              </p>
            ))}
            {invoice.attention_to ? (
              <p className="mt-2 text-sm">
                <span className="text-slate-500">Attention:</span>{" "}
                {invoice.attention_to}
              </p>
            ) : null}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Invoice subject
            </p>
            <p className="mt-2 text-lg font-semibold">{invoice.subject}</p>
            {invoice.service_period_start && invoice.service_period_end ? (
              <p className="mt-2 text-sm text-slate-600">
                Service period {formatDate(invoice.service_period_start)} –{" "}
                {formatDate(invoice.service_period_end)}
              </p>
            ) : null}
          </div>
        </section>

        {sections.map((section) => (
          <section className="mb-8" key={section.label}>
            <h2 className="border-b bg-slate-100 px-3 py-2 text-sm font-bold uppercase tracking-wider">
              {section.label}
            </h2>
            <div className="divide-y">
              {section.lines.map((line) => (
                <div className="grid grid-cols-[1fr_auto] gap-6 px-3 py-4" key={line.id}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{line.description}</p>
                      {line.item_type !== "service" &&
                      line.item_type !== "material" ? (
                        <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase">
                          {line.item_type}
                        </span>
                      ) : null}
                    </div>
                    {line.details ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {line.details}
                      </p>
                    ) : null}
                    {line.quantity !== 1 ? (
                      <p className="mt-1 text-xs text-slate-500">
                        {line.quantity} ×{" "}
                        {money(line.unit_amount_cents, invoice.currency)}
                      </p>
                    ) : null}
                  </div>
                  <p className="font-mono font-semibold">
                    {money(line.amount_cents, invoice.currency)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}

        <div className="ml-auto w-full max-w-sm border-t-2 border-slate-900 pt-3">
          <Amount label="Subtotal" value={money(invoice.subtotal_cents, invoice.currency)} />
          <Amount label="Total tax" value={money(invoice.tax_cents, invoice.currency)} />
          <div className="mt-3 flex justify-between border-t pt-3 text-xl font-bold">
            <span>Total</span>
            <span className="font-mono">{money(invoice.total_cents, invoice.currency)}</span>
          </div>
        </div>

        {invoice.notes ? (
          <p className="mt-10 whitespace-pre-wrap text-sm leading-6">{invoice.notes}</p>
        ) : null}
        <footer className="mt-10 grid gap-6 border-t pt-6 text-xs leading-5 text-slate-600 sm:grid-cols-2">
          {invoice.payment_instructions ? (
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-900">
                Payment methods
              </p>
              <p className="mt-2 whitespace-pre-wrap">{invoice.payment_instructions}</p>
            </div>
          ) : null}
          {invoice.payment_terms ? (
            <div>
              <p className="font-bold uppercase tracking-wider text-slate-900">
                Terms
              </p>
              <p className="mt-2 whitespace-pre-wrap">{invoice.payment_terms}</p>
            </div>
          ) : null}
        </footer>
      </div>
    </>
  );
}

function Amount({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function relation<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value;
}

function hasAddress(value: Record<string, unknown> | undefined) {
  return Boolean(value && Object.values(value).some(Boolean));
}

function addressLines(value: Record<string, unknown> | undefined) {
  if (!value) return [];
  return [
    value.line1,
    value.line2,
    [value.city, value.region, value.postalCode].filter(Boolean).join(", "),
    value.country,
  ].filter((item): item is string => typeof item === "string" && Boolean(item));
}
