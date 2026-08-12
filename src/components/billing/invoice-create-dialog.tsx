"use client";

import { useState } from "react";
import { FilePlus2, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { formatMoney } from "@/components/billing/calculations";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ClientOption {
  id: string;
  name: string;
}

interface RetainerOption {
  id: string;
  client_id: string;
  name: string;
}

interface DraftLine {
  itemType: "service" | "material" | "fee" | "deposit" | "credit";
  description: string;
  details: string;
  quantity: string;
  unitPrice: string;
  retainerId: string;
}

const emptyLine = (): DraftLine => ({
  itemType: "service",
  description: "",
  details: "",
  quantity: "1",
  unitPrice: "",
  retainerId: "",
});

export function InvoiceCreateDialog({
  clients,
  retainers,
}: {
  clients: ClientOption[];
  retainers: RetainerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [subject, setSubject] = useState("");
  const [attentionTo, setAttentionTo] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(shiftDate(new Date(), 30));
  const [servicePeriodStart, setServicePeriodStart] = useState("");
  const [servicePeriodEnd, setServicePeriodEnd] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [taxTotal, setTaxTotal] = useState("0");
  const [notes, setNotes] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");
  const [paymentTerms, setPaymentTerms] = useState(
    "Invoices unpaid after 30 days may be subject to a monthly finance charge.",
  );
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const subtotal = lines.reduce(
    (sum, line) =>
      sum +
      (line.itemType === "credit" ? -1 : 1) *
        (Number(line.quantity) || 0) *
        (Number(line.unitPrice) || 0),
    0,
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    );
  }

  async function createInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lineItems = lines.map((line) => ({
      description: line.description,
      details: line.details || null,
      itemType: line.itemType,
      retainerId: line.retainerId || null,
      servicePeriodStart: servicePeriodStart || null,
      servicePeriodEnd: servicePeriodEnd || null,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
    }));
    if (!lineItems.length || lineItems.some((line) => !line.description || line.quantity <= 0)) {
      setError("Add at least one complete invoice line.");
      return;
    }
    if (subtotal + (Number(taxTotal) || 0) < 0) {
      setError("Credits cannot make the invoice total negative.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          invoiceNumber,
          subject,
          attentionTo: attentionTo || null,
          billingAddress: addressObject(billingAddress),
          status: "draft",
          issueDate,
          dueDate,
          servicePeriodStart: servicePeriodStart || null,
          servicePeriodEnd: servicePeriodEnd || null,
          currency,
          subtotal,
          taxTotal: Number(taxTotal) || 0,
          total: subtotal + (Number(taxTotal) || 0),
          notes,
          paymentInstructions,
          paymentTerms,
          lineItems,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        invoice?: { id?: string };
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create this invoice.");
      }
      setOpen(false);
      if (result.invoice?.id) router.push(`/billing/${result.invoice.id}`);
      else router.refresh();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create this invoice.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button><FilePlus2 /> New invoice</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={createInvoice}>
          <DialogHeader>
            <DialogTitle>Create draft invoice</DialogTitle>
            <DialogDescription>
              Build a reviewable invoice before it is issued to the client.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <Field htmlFor="invoice-client" label="Client">
              <Select onValueChange={setClientId} required value={clientId}>
                <SelectTrigger className="w-full" id="invoice-client">
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field htmlFor="invoice-number" label="Invoice number">
              <Input
                disabled={saving}
                id="invoice-number"
                maxLength={64}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                placeholder="54930"
                required
                value={invoiceNumber}
              />
            </Field>
            <Field htmlFor="invoice-subject" label="Invoice subject">
              <Input
                disabled={saving}
                id="invoice-subject"
                maxLength={240}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Client – Monthly Marketing Services"
                required
                value={subject}
              />
            </Field>
            <Field htmlFor="invoice-attention" label="Attention">
              <Input
                disabled={saving}
                id="invoice-attention"
                maxLength={240}
                onChange={(event) => setAttentionTo(event.target.value)}
                placeholder="Billing contact"
                value={attentionTo}
              />
            </Field>
            <Field htmlFor="invoice-address" label="Billing address">
              <Textarea
                disabled={saving}
                id="invoice-address"
                maxLength={1_000}
                onChange={(event) => setBillingAddress(event.target.value)}
                placeholder={"Street address\nCity, State ZIP"}
                value={billingAddress}
              />
            </Field>
            <Field htmlFor="invoice-issued" label="Issue date">
              <Input
                disabled={saving}
                id="invoice-issued"
                onChange={(event) => setIssueDate(event.target.value)}
                required
                type="date"
                value={issueDate}
              />
            </Field>
            <Field htmlFor="invoice-due" label="Due date">
              <Input
                disabled={saving}
                id="invoice-due"
                min={issueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
                type="date"
                value={dueDate}
              />
            </Field>
            <Field htmlFor="invoice-period-start" label="Service period start">
              <Input
                disabled={saving}
                id="invoice-period-start"
                onChange={(event) => setServicePeriodStart(event.target.value)}
                type="date"
                value={servicePeriodStart}
              />
            </Field>
            <Field htmlFor="invoice-period-end" label="Service period end">
              <Input
                disabled={saving}
                id="invoice-period-end"
                min={servicePeriodStart}
                onChange={(event) => setServicePeriodEnd(event.target.value)}
                type="date"
                value={servicePeriodEnd}
              />
            </Field>
            <Field htmlFor="invoice-currency" label="Currency">
              <Select onValueChange={setCurrency} value={currency}>
                <SelectTrigger className="w-full" id="invoice-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["USD", "CAD", "GBP", "EUR", "AUD"].map((code) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field htmlFor="invoice-tax" label={`Tax (${currency})`}>
              <Input
                disabled={saving}
                id="invoice-tax"
                min="0"
                onChange={(event) => setTaxTotal(event.target.value)}
                step="0.01"
                type="number"
                value={taxTotal}
              />
            </Field>
            <Field htmlFor="invoice-notes" label="Client note">
              <Textarea
                disabled={saving}
                id="invoice-notes"
                maxLength={2_000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Payment terms or a brief thank-you."
                value={notes}
              />
            </Field>
            <Field htmlFor="invoice-payment" label="Payment instructions">
              <Textarea
                disabled={saving}
                id="invoice-payment"
                maxLength={20_000}
                onChange={(event) => setPaymentInstructions(event.target.value)}
                placeholder="Check and ACH/remittance instructions shown on the invoice."
                value={paymentInstructions}
              />
            </Field>
            <Field htmlFor="invoice-terms" label="Payment terms">
              <Textarea
                disabled={saving}
                id="invoice-terms"
                maxLength={20_000}
                onChange={(event) => setPaymentTerms(event.target.value)}
                value={paymentTerms}
              />
            </Field>
            <div className="space-y-3 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Line items</Label>
                <Button
                  onClick={() => setLines((current) => [...current, emptyLine()])}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Plus /> Add line
                </Button>
              </div>
              {lines.map((line, index) => (
                <div className="space-y-3 rounded-xl border p-3" key={index}>
                  <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
                    <Select
                      onValueChange={(value: DraftLine["itemType"]) =>
                        updateLine(index, { itemType: value })
                      }
                      value={line.itemType}
                    >
                      <SelectTrigger aria-label={`Line ${index + 1} type`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["service", "material", "fee", "deposit", "credit"].map(
                          (type) => (
                            <SelectItem key={type} value={type}>
                              {type[0].toUpperCase() + type.slice(1)}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`Line ${index + 1} description`}
                      onChange={(event) =>
                        updateLine(index, { description: event.target.value })
                      }
                      placeholder="Monthly Marketing Strategy & Support Services"
                      required
                      value={line.description}
                    />
                    <Button
                      aria-label={`Remove line ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <Textarea
                    aria-label={`Line ${index + 1} details`}
                    onChange={(event) =>
                      updateLine(index, { details: event.target.value })
                    }
                    placeholder="Optional fee breakdown, covered services, deposits, or reconciliation details."
                    value={line.details}
                  />
                  <div className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem]">
                    <Select
                      onValueChange={(value) =>
                        updateLine(index, {
                          retainerId: value === "__none" ? "" : value,
                        })
                      }
                      value={line.retainerId || "__none"}
                    >
                      <SelectTrigger aria-label={`Line ${index + 1} retainer`}>
                        <SelectValue placeholder="Against a retainer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No retainer</SelectItem>
                        {retainers
                          .filter((retainer) => retainer.client_id === clientId)
                          .map((retainer) => (
                            <SelectItem key={retainer.id} value={retainer.id}>
                              {retainer.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Input
                      aria-label={`Line ${index + 1} quantity`}
                      min="0.01"
                      onChange={(event) =>
                        updateLine(index, { quantity: event.target.value })
                      }
                      step="0.01"
                      type="number"
                      value={line.quantity}
                    />
                    <Input
                      aria-label={`Line ${index + 1} unit price`}
                      min="0"
                      onChange={(event) =>
                        updateLine(index, { unitPrice: event.target.value })
                      }
                      placeholder="0.00"
                      step="0.01"
                      type="number"
                      value={line.unitPrice}
                    />
                  </div>
                </div>
              ))}
              <div className="flex justify-end border-t pt-3">
                <p className="text-sm text-muted-foreground">
                  Draft total{" "}
                  <span className="ml-3 font-mono text-base font-semibold text-foreground">
                    {formatMoney(subtotal + (Number(taxTotal) || 0), currency)}
                  </span>
                </p>
              </div>
            </div>
            {error ? (
              <Alert className="sm:col-span-2" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={saving || !clients.length} type="submit">
              {saving ? <LoaderCircle className="animate-spin" /> : <FilePlus2 />}
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  children,
  htmlFor,
  label,
}: {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function shiftDate(date: Date, days: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function addressObject(value: string) {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    line1: lines[0] ?? "",
    line2: lines.slice(1).join("\n"),
  };
}
