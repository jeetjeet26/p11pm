"use client";

import { useState } from "react";
import { LoaderCircle, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";

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
import type { Project } from "@/lib/types";

export function ProjectSettingsDialog({
  project,
  clients = [],
}: {
  project: Project;
  clients?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.client);
  const [clientId, setClientId] = useState(project.clientId ?? "");
  const [billingType, setBillingType] = useState(
    project.billingType ?? "time_and_materials",
  );
  const [fixedFee, setFixedFee] = useState(
    project.fixedFee === undefined ? "" : String(project.fixedFee),
  );
  const [hourlyRate, setHourlyRate] = useState(
    project.hourlyRate === undefined ? "" : String(project.hourlyRate),
  );
  const [billingCap, setBillingCap] = useState(
    project.billingCap === undefined ? "" : String(project.billingCap),
  );
  const [commercialValue, setCommercialValue] = useState(
    project.commercialValue === undefined ? "" : String(project.commercialValue),
  );
  const [billingCadence, setBillingCadence] = useState(
    project.billingCadence ?? "monthly",
  );
  const [timeRoundingMinutes, setTimeRoundingMinutes] = useState(
    String(project.timeRoundingMinutes ?? 15),
  );
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState(project.status);
  const [priority, setPriority] = useState(project.priority ?? "medium");
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [dueDate, setDueDate] = useState(project.dueDate ?? "");
  const [budget, setBudget] = useState(
    project.budget === undefined ? "" : String(project.budget),
  );
  const [currency, setCurrency] = useState(project.currency ?? "USD");
  const [archived, setArchived] = useState(Boolean(project.archivedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          name,
          clientId: clientId || null,
          clientName: clientName || null,
          billingType,
          fixedFee: fixedFee ? Number(fixedFee) : null,
          hourlyRate: hourlyRate ? Number(hourlyRate) : null,
          billingCap: billingCap ? Number(billingCap) : null,
          commercialValue: commercialValue ? Number(commercialValue) : null,
          billingCadence: billingType === "internal" ? null : billingCadence,
          timeRoundingMinutes:
            billingType === "time_and_materials"
              ? Number(timeRoundingMinutes)
              : null,
          description: description || null,
          status,
          priority,
          ownerId: project.ownerId ?? null,
          startDate: startDate || null,
          dueDate: dueDate || null,
          budget: budget ? Number(budget) : null,
          currency,
          archived,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update this project.");
      }
      setOpen(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to update this project.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Settings2 />
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Project settings</DialogTitle>
            <DialogDescription>
              Update delivery ownership, dates, budget, priority, and lifecycle.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input onChange={(event) => setName(event.target.value)} required value={name} /></Field>
              <Field label="Client">
                {clients.length ? (
                  <Select
                    onValueChange={(value) => {
                      setClientId(value === "none" ? "" : value);
                      setClientName(
                        clients.find((client) => client.id === value)?.name ?? "",
                      );
                    }}
                    value={clientId || "none"}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No client</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input onChange={(event) => setClientName(event.target.value)} value={clientName} />
                )}
              </Field>
            </div>
            {billingType !== "internal" ? (
              <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                {billingType === "fixed_fee" ? (
                  <Field label="Fixed fee">
                    <Input
                      min="0"
                      onChange={(event) => setFixedFee(event.target.value)}
                      required
                      step="0.01"
                      type="number"
                      value={fixedFee}
                    />
                  </Field>
                ) : (
                  <>
                    <Field label="Default hourly rate">
                      <Input
                        min="0"
                        onChange={(event) => setHourlyRate(event.target.value)}
                        step="0.01"
                        type="number"
                        value={hourlyRate}
                      />
                    </Field>
                    <Field label="Billing cap">
                      <Input
                        min="0"
                        onChange={(event) => setBillingCap(event.target.value)}
                        step="0.01"
                        type="number"
                        value={billingCap}
                      />
                    </Field>
                  </>
                )}
                <Field label="Engagement value">
                  <Input
                    min="0"
                    onChange={(event) => setCommercialValue(event.target.value)}
                    step="0.01"
                    type="number"
                    value={commercialValue}
                  />
                </Field>
                <Field label="Billing cadence">
                  <Select
                    onValueChange={(value) =>
                      setBillingCadence(
                        value as NonNullable<Project["billingCadence"]>,
                      )
                    }
                    value={billingCadence}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="milestone">By milestone</SelectItem>
                      <SelectItem value="completion">On completion</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {billingType === "time_and_materials" ? (
                  <Field label="Time rounding">
                    <Select
                      onValueChange={setTimeRoundingMinutes}
                      value={timeRoundingMinutes}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1, 5, 6, 10, 15, 30, 60].map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes} minute{minutes === 1 ? "" : "s"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </div>
            ) : null}
            <Field label="Description">
              <Textarea
                className="min-h-28"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Select onValueChange={(value) => setStatus(value as Project["status"])} value={status}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planning">Planning</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_hold">On hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select onValueChange={(value) => setPriority(value as NonNullable<Project["priority"]>)} value={priority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Billing model">
                <Select
                  onValueChange={(value) =>
                    setBillingType(value as NonNullable<Project["billingType"]>)
                  }
                  value={billingType}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time_and_materials">Time & materials</SelectItem>
                    <SelectItem value="fixed_fee">Fixed fee</SelectItem>
                    <SelectItem value="internal">Internal</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date"><Input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} /></Field>
              <Field label="Due date"><Input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Budget"><Input min="0" onChange={(event) => setBudget(event.target.value)} step="0.01" type="number" value={budget} /></Field>
              <Field label="Currency"><Input maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} value={currency} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
                type="checkbox"
              />
              Archive this project
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button disabled={saving || !name.trim()}>
              {saving && <LoaderCircle className="animate-spin" />}
              Save project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
