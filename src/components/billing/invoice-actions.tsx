"use client";

import { useState } from "react";
import { Ban, CheckCircle2, LoaderCircle, Pencil, ReceiptText, Send } from "lucide-react";
import { useRouter } from "next/navigation";

import { formatMoney, type InvoiceStatus } from "@/components/billing/calculations";
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

interface InvoiceActionsProps {
  balanceDue: number;
  clientId: string;
  currency: string;
  invoiceId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
}

export interface EditableInvoiceDraft {
  id: string;
  invoiceNumber: string;
  subject: string;
  attentionTo: string | null;
  issueDate: string | null;
  dueDate: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  notes: string | null;
  paymentInstructions: string | null;
  paymentTerms: string | null;
}

export function InvoiceActions(props: InvoiceActionsProps) {
  const router = useRouter();
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: "issued" | "void") {
    setWorking(status);
    setError(null);
    try {
      const response = await fetch(
        `/api/invoices?id=${encodeURIComponent(props.invoiceId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: props.invoiceId, status }),
        },
      );
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Unable to ${status} invoice.`);
      router.refresh();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "Unable to update invoice.",
      );
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {props.status === "draft" ? (
          <Button disabled={Boolean(working)} onClick={() => setStatus("issued")}>
            {working === "issued" ? <LoaderCircle className="animate-spin" /> : <Send />}
            Issue invoice
          </Button>
        ) : null}
        {props.balanceDue > 0 && props.status !== "draft" && props.status !== "void" ? (
          <PaymentDialog {...props} />
        ) : null}
        {props.status !== "void" && props.status !== "paid" ? (
          <VoidDialog
            invoiceNumber={props.invoiceNumber}
            loading={working === "void"}
            onConfirm={() => setStatus("void")}
          />
        ) : null}
      </div>
    </div>
  );
}

function PaymentDialog({
  balanceDue,
  clientId,
  currency,
  invoiceId,
  invoiceNumber,
}: InvoiceActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(balanceDue));
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<
    "bank_transfer" | "card" | "check" | "cash" | "credit" | "other"
  >("bank_transfer");

  async function recordPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const numericAmount = Number(amount);
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          invoiceId,
          paymentDate,
          amount: numericAmount,
          currency,
          method,
          reference,
          notes,
          allocations: [{ invoiceId, amount: numericAmount }],
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to record payment.");
      setOpen(false);
      router.refresh();
    } catch (paymentError) {
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : "Unable to record payment.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="outline"><ReceiptText /> Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={recordPayment}>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Apply a payment to {invoiceNumber}. Remaining balance:{" "}
              {formatMoney(balanceDue, currency)}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="grid grid-cols-2 gap-3">
              <Field htmlFor="payment-amount" label={`Amount (${currency})`}>
                <Input
                  id="payment-amount"
                  max={balanceDue}
                  min="0.01"
                  onChange={(event) => setAmount(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={amount}
                />
              </Field>
              <Field htmlFor="payment-date" label="Payment date">
                <Input
                  id="payment-date"
                  onChange={(event) => setPaymentDate(event.target.value)}
                  required
                  type="date"
                  value={paymentDate}
                />
              </Field>
            </div>
            <Field htmlFor="payment-reference" label="Reference">
              <Input
                id="payment-reference"
                maxLength={160}
                onChange={(event) => setReference(event.target.value)}
                placeholder="ACH, check, or transaction number"
                value={reference}
              />
            </Field>
            <Field htmlFor="payment-method" label="Payment method">
              <Select
                onValueChange={(value: typeof method) => setMethod(value)}
                value={method}
              >
                <SelectTrigger className="w-full" id="payment-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field htmlFor="payment-notes" label="Internal note">
              <Textarea
                id="payment-notes"
                maxLength={2_000}
                onChange={(event) => setNotes(event.target.value)}
                value={notes}
              />
            </Field>
            {error ? (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={saving} type="submit">
              {saving ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InvoiceEditDialog({ invoice }: { invoice: EditableInvoiceDraft }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const optional = (name: string) => {
      const value = String(form.get(name) ?? "").trim();
      return value || null;
    };
    try {
      const response = await fetch(
        `/api/invoices?id=${encodeURIComponent(invoice.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: invoice.id,
            invoiceNumber: String(form.get("invoiceNumber") ?? "").trim(),
            subject: String(form.get("subject") ?? "").trim(),
            attentionTo: optional("attentionTo"),
            issueDate: String(form.get("issueDate") ?? ""),
            dueDate: String(form.get("dueDate") ?? ""),
            servicePeriodStart: optional("servicePeriodStart"),
            servicePeriodEnd: optional("servicePeriodEnd"),
            notes: optional("notes"),
            paymentInstructions: optional("paymentInstructions"),
            paymentTerms: optional("paymentTerms"),
          }),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save this invoice.");
      }
      setOpen(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save this invoice.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="outline"><Pencil /> Edit draft</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Edit draft invoice</DialogTitle>
            <DialogDescription>
              Update invoice details before issuing. Linked line items remain intact.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <Field htmlFor="edit-invoice-number" label="Invoice number">
              <Input defaultValue={invoice.invoiceNumber} id="edit-invoice-number" name="invoiceNumber" required />
            </Field>
            <Field htmlFor="edit-invoice-subject" label="Subject">
              <Input defaultValue={invoice.subject} id="edit-invoice-subject" name="subject" required />
            </Field>
            <Field htmlFor="edit-invoice-attention" label="Attention">
              <Input defaultValue={invoice.attentionTo ?? ""} id="edit-invoice-attention" name="attentionTo" />
            </Field>
            <Field htmlFor="edit-invoice-issued" label="Issue date">
              <Input defaultValue={invoice.issueDate ?? ""} id="edit-invoice-issued" name="issueDate" required type="date" />
            </Field>
            <Field htmlFor="edit-invoice-due" label="Due date">
              <Input defaultValue={invoice.dueDate ?? ""} id="edit-invoice-due" name="dueDate" required type="date" />
            </Field>
            <Field htmlFor="edit-invoice-period-start" label="Service period start">
              <Input defaultValue={invoice.servicePeriodStart ?? ""} id="edit-invoice-period-start" name="servicePeriodStart" type="date" />
            </Field>
            <Field htmlFor="edit-invoice-period-end" label="Service period end">
              <Input defaultValue={invoice.servicePeriodEnd ?? ""} id="edit-invoice-period-end" name="servicePeriodEnd" type="date" />
            </Field>
            <Field htmlFor="edit-invoice-notes" label="Client note">
              <Textarea defaultValue={invoice.notes ?? ""} id="edit-invoice-notes" name="notes" />
            </Field>
            <Field htmlFor="edit-invoice-instructions" label="Payment instructions">
              <Textarea defaultValue={invoice.paymentInstructions ?? ""} id="edit-invoice-instructions" name="paymentInstructions" />
            </Field>
            <Field htmlFor="edit-invoice-terms" label="Payment terms">
              <Textarea defaultValue={invoice.paymentTerms ?? ""} id="edit-invoice-terms" name="paymentTerms" />
            </Field>
            {error ? (
              <Alert className="sm:col-span-2" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={saving} type="submit">
              {saving ? <LoaderCircle className="animate-spin" /> : <Pencil />}
              Save draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog({
  invoiceNumber,
  loading,
  onConfirm,
}: {
  invoiceNumber: string;
  loading: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="destructive"><Ban /> Void</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void {invoiceNumber}?</DialogTitle>
          <DialogDescription>
            This removes the invoice from receivables. Its audit history will be preserved.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button
            disabled={loading}
            onClick={() => {
              onConfirm();
              setOpen(false);
            }}
            variant="destructive"
          >
            {loading ? <LoaderCircle className="animate-spin" /> : <Ban />}
            Void invoice
          </Button>
        </DialogFooter>
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
