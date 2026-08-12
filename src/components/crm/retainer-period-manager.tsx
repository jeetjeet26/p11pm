"use client";

import { useState } from "react";
import { LoaderCircle, Lock, Pencil, Plus, Unlock } from "lucide-react";
import { useRouter } from "next/navigation";

import type { RetainerPeriod } from "@/components/crm/types";
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

export function RetainerPeriodManager({
  period,
  retainerId,
}: {
  period?: RetainerPeriod;
  retainerId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [periodStart, setPeriodStart] = useState(period?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(period?.periodEnd ?? "");
  const [includedHours, setIncludedHours] = useState(
    period ? String(Math.max(0, period.allowanceHours - period.rolloverHours)) : "",
  );
  const [rolloverHours, setRolloverHours] = useState(
    period ? String(period.rolloverHours) : "0",
  );
  const [fee, setFee] = useState(period?.value == null ? "" : String(period.value));
  const [forecastHours, setForecastHours] = useState(
    period?.forecastHours == null ? "" : String(period.forecastHours),
  );
  const [status, setStatus] = useState(period?.status ?? "planned");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch("/api/retainers/periods", {
      method: period ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(period ? { id: period.id } : { retainerId }),
        periodStart,
        periodEnd,
        includedMinutes: Math.round(Number(includedHours) * 60),
        rolloverMinutes: Math.round(Number(rolloverHours) * 60),
        feeCents: Math.round(Number(fee) * 100),
        forecastMinutes:
          forecastHours.trim() === "" ? null : Math.round(Number(forecastHours) * 60),
        status,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Could not save the period.");
    } else {
      setOpen(false);
      router.refresh();
    }
    setSaving(false);
  }

  async function toggleLock() {
    if (!period) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/retainers/periods", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: period.id, locked: !period.lockedAt }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setError(result.error ?? "Could not update the period lock.");
    else router.refresh();
    setSaving(false);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {period ? (
        <Button
          aria-label={period.lockedAt ? "Unlock period" : "Lock period"}
          disabled={saving || Boolean(period.invoicedAt)}
          onClick={() => void toggleLock()}
          size="icon-sm"
          variant="ghost"
        >
          {period.lockedAt ? <Unlock /> : <Lock />}
        </Button>
      ) : null}
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger asChild>
          <Button size={period ? "icon-sm" : "sm"} variant={period ? "ghost" : "outline"}>
            {period ? <Pencil /> : <Plus />}
            <span className={period ? "sr-only" : undefined}>
              {period ? "Edit period" : "Add period"}
            </span>
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={save}>
            <DialogHeader>
              <DialogTitle>{period ? "Edit service period" : "Add service period"}</DialogTitle>
              <DialogDescription>
                Imported source identity remains unchanged; these controls manage native
                dates, allowance, forecast, and lifecycle.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5 sm:grid-cols-2">
              <Field label="Starts" id="period-start">
                <Input id="period-start" onChange={(event) => setPeriodStart(event.target.value)} required type="date" value={periodStart} />
              </Field>
              <Field label="Ends" id="period-end">
                <Input id="period-end" onChange={(event) => setPeriodEnd(event.target.value)} required type="date" value={periodEnd} />
              </Field>
              <Field label="Included hours" id="period-included">
                <Input id="period-included" min="0" onChange={(event) => setIncludedHours(event.target.value)} required step="0.25" type="number" value={includedHours} />
              </Field>
              <Field label="Rollover hours" id="period-rollover">
                <Input id="period-rollover" min="0" onChange={(event) => setRolloverHours(event.target.value)} required step="0.25" type="number" value={rolloverHours} />
              </Field>
              <Field label="Period value" id="period-fee">
                <Input id="period-fee" min="0" onChange={(event) => setFee(event.target.value)} required step="0.01" type="number" value={fee} />
              </Field>
              <Field label="Forecast hours" id="period-forecast">
                <Input id="period-forecast" min="0" onChange={(event) => setForecastHours(event.target.value)} placeholder="Use pace forecast" step="0.25" type="number" value={forecastHours} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Label>Status</Label>
                <Select onValueChange={setStatus} value={status}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["planned", "open", "closed", "cancelled"].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {error ? <Alert className="sm:col-span-2" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            </div>
            <DialogFooter>
              <Button disabled={saving}>
                {saving ? <LoaderCircle className="animate-spin" /> : null}
                Save period
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ children, id, label }: { children: React.ReactNode; id: string; label: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
