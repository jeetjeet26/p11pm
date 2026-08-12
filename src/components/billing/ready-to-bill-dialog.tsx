"use client";

import { useMemo, useState } from "react";
import { FileClock, LoaderCircle } from "lucide-react";
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

export interface ReadyToBillGroup {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  currency: string;
  entries: Array<{
    id: string;
    entryDate: string;
    description: string;
    durationMinutes: number;
    amount: number;
  }>;
}

export function ReadyToBillDialog({ groups }: { groups: ReadyToBillGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState(groupId(groups[0]));
  const group = groups.find((item) => groupId(item) === groupKey) ?? groups[0];
  const [selectedIds, setSelectedIds] = useState<string[]>(
    group?.entries.map((entry) => entry.id) ?? [],
  );
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [subject, setSubject] = useState("");
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(shiftDate(30));
  const [taxTotal, setTaxTotal] = useState("0");
  const selectedEntries = useMemo(
    () => group?.entries.filter((entry) => selectedIds.includes(entry.id)) ?? [],
    [group, selectedIds],
  );
  const total = selectedEntries.reduce((sum, entry) => sum + entry.amount, 0);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!group || !selectedIds.length) {
      setError("Select at least one approved time entry.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: group.clientId,
          projectId: group.projectId,
          invoiceNumber,
          subject: subject || `${group.clientName} – ${group.projectName}`,
          issueDate,
          dueDate,
          timeEntryIds: selectedIds,
          taxTotal: Number(taxTotal) || 0,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        invoice?: { id?: string };
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create invoice from time.");
      }
      setOpen(false);
      if (result.invoice?.id) router.push(`/billing/${result.invoice.id}`);
      else router.refresh();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create invoice from time.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={!groups.length} variant="outline">
          <FileClock />
          Ready to bill
          {groups.length ? ` (${groups.reduce((sum, item) => sum + item.entries.length, 0)})` : ""}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={createDraft}>
          <DialogHeader>
            <DialogTitle>Create invoice from approved time</DialogTitle>
            <DialogDescription>
              Select one client project and turn its approved billable entries into
              a linked draft invoice.
            </DialogDescription>
          </DialogHeader>
          {group ? (
            <div className="grid gap-4 py-5 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="billable-group">Client project</Label>
                <Select
                  onValueChange={(value) => {
                    setGroupKey(value);
                    const next = groups.find((item) => groupId(item) === value);
                    setSelectedIds(next?.entries.map((entry) => entry.id) ?? []);
                    setSubject(
                      next ? `${next.clientName} – ${next.projectName}` : "",
                    );
                  }}
                  value={groupKey}
                >
                  <SelectTrigger className="w-full" id="billable-group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((item) => (
                      <SelectItem key={groupId(item)} value={groupId(item)}>
                        {item.clientName} · {item.projectName} ({item.entries.length})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field htmlFor="time-invoice-number" label="Invoice number">
                <Input
                  id="time-invoice-number"
                  onChange={(event) => setInvoiceNumber(event.target.value)}
                  required
                  value={invoiceNumber}
                />
              </Field>
              <Field htmlFor="time-invoice-subject" label="Subject">
                <Input
                  id="time-invoice-subject"
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder={`${group.clientName} – ${group.projectName}`}
                  value={subject}
                />
              </Field>
              <Field htmlFor="time-invoice-issued" label="Issue date">
                <Input
                  id="time-invoice-issued"
                  onChange={(event) => setIssueDate(event.target.value)}
                  required
                  type="date"
                  value={issueDate}
                />
              </Field>
              <Field htmlFor="time-invoice-due" label="Due date">
                <Input
                  id="time-invoice-due"
                  min={issueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  required
                  type="date"
                  value={dueDate}
                />
              </Field>
              <Field htmlFor="time-invoice-tax" label={`Tax (${group.currency})`}>
                <Input
                  id="time-invoice-tax"
                  min="0"
                  onChange={(event) => setTaxTotal(event.target.value)}
                  step="0.01"
                  type="number"
                  value={taxTotal}
                />
              </Field>
              <div className="flex items-end justify-end text-sm">
                <span className="text-muted-foreground">
                  Selected subtotal{" "}
                  <strong className="ml-2 font-mono text-foreground">
                    {formatMoney(total, group.currency)}
                  </strong>
                </span>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Approved entries</Label>
                <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {group.entries.map((entry) => (
                    <label
                      className="flex cursor-pointer items-start gap-3 p-3 text-sm"
                      key={entry.id}
                    >
                      <input
                        checked={selectedIds.includes(entry.id)}
                        className="mt-1 size-4 accent-primary"
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, entry.id]
                              : current.filter((id) => id !== entry.id),
                          )
                        }
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{entry.description}</span>
                        <span className="text-xs text-muted-foreground">
                          {entry.entryDate} · {formatDuration(entry.durationMinutes)}
                        </span>
                      </span>
                      <span className="font-mono">
                        {formatMoney(entry.amount, group.currency)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              {error ? (
                <Alert className="sm:col-span-2" variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : (
            <p className="py-8 text-sm text-muted-foreground">
              There is no approved billable time ready to invoice.
            </p>
          )}
          <DialogFooter>
            <Button disabled={saving || !selectedIds.length} type="submit">
              {saving ? <LoaderCircle className="animate-spin" /> : <FileClock />}
              Create linked draft
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

function groupId(group?: ReadyToBillGroup) {
  return group ? `${group.clientId}:${group.projectId}` : "";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
