"use client";

import { useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
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

function projectCode(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

export function ProjectCreateDialog({
  canCreate,
  clients = [],
}: {
  canCreate: boolean;
  clients?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [clientName, setClientName] = useState("");
  const [clientId, setClientId] = useState("");
  const [billingType, setBillingType] = useState<
    "time_and_materials" | "fixed_fee" | "internal"
  >("time_and_materials");
  const [fixedFee, setFixedFee] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [billingCap, setBillingCap] = useState("");
  const [commercialValue, setCommercialValue] = useState("");
  const [billingCadence, setBillingCadence] = useState<
    "weekly" | "monthly" | "quarterly" | "milestone" | "completion"
  >("monthly");
  const [timeRoundingMinutes, setTimeRoundingMinutes] = useState("15");
  const [currency, setCurrency] = useState("USD");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          code,
          clientId: clientId || null,
          clientName,
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
          currency,
          description,
        }),
      });
      const result = (await response.json()) as {
        project?: { id?: string };
        error?: string;
      };
      if (!response.ok || !result.project?.id) {
        throw new Error(result.error ?? "Unable to create this project.");
      }
      setOpen(false);
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create this project.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          disabled={!canCreate}
          title={
            canCreate
              ? "Create project"
              : "Project creation requires an administrator or manager"
          }
        >
          <Plus />
          New job
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={createProject}>
          <DialogHeader>
            <DialogTitle>Create a client job</DialogTitle>
            <DialogDescription>
              Set up delivery and commercial terms for a new engagement.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                autoFocus
                disabled={saving}
                id="project-name"
                maxLength={160}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setName(nextName);
                  if (!codeEdited) setCode(projectCode(nextName));
                }}
                required
                value={name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-code">Project code</Label>
              <Input
                className="font-mono uppercase"
                disabled={saving}
                id="project-code"
                maxLength={32}
                onChange={(event) => {
                  setCodeEdited(true);
                  setCode(projectCode(event.target.value));
                }}
                pattern="[A-Z0-9][A-Z0-9-]{1,31}"
                placeholder="CLIENT-WEB"
                required
                value={code}
              />
              <p className="text-xs text-muted-foreground">
                2–32 letters, numbers, or hyphens.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Client</Label>
                {clients.length ? (
                  <Select
                    disabled={saving}
                    onValueChange={(value) => {
                      setClientId(value === "none" ? "" : value);
                      setClientName(
                        clients.find((client) => client.id === value)?.name ?? "",
                      );
                    }}
                    value={clientId || "none"}
                  >
                    <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
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
                  <Input
                    disabled={saving}
                    id="project-client"
                    maxLength={160}
                    onChange={(event) => setClientName(event.target.value)}
                    value={clientName}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Billing model</Label>
                <Select
                  disabled={saving}
                  onValueChange={(value) =>
                    setBillingType(value as typeof billingType)
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
              </div>
            </div>
            {billingType !== "internal" ? (
              <div className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
                {billingType === "fixed_fee" ? (
                  <div className="space-y-2">
                    <Label htmlFor="project-fixed-fee">Fixed fee</Label>
                    <Input
                      disabled={saving}
                      id="project-fixed-fee"
                      min="0"
                      onChange={(event) => setFixedFee(event.target.value)}
                      required
                      step="0.01"
                      type="number"
                      value={fixedFee}
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="project-hourly-rate">Default hourly rate</Label>
                      <Input
                        disabled={saving}
                        id="project-hourly-rate"
                        min="0"
                        onChange={(event) => setHourlyRate(event.target.value)}
                        step="0.01"
                        type="number"
                        value={hourlyRate}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="project-billing-cap">Billing cap</Label>
                      <Input
                        disabled={saving}
                        id="project-billing-cap"
                        min="0"
                        onChange={(event) => setBillingCap(event.target.value)}
                        step="0.01"
                        type="number"
                        value={billingCap}
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="project-commercial-value">Engagement value</Label>
                  <Input
                    disabled={saving}
                    id="project-commercial-value"
                    min="0"
                    onChange={(event) => setCommercialValue(event.target.value)}
                    step="0.01"
                    type="number"
                    value={commercialValue}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Billing cadence</Label>
                  <Select
                    disabled={saving}
                    onValueChange={(value) =>
                      setBillingCadence(value as typeof billingCadence)
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
                </div>
                {billingType === "time_and_materials" ? (
                  <div className="space-y-2">
                    <Label>Time rounding</Label>
                    <Select
                      disabled={saving}
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
                  </div>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="project-currency">Currency</Label>
                  <Input
                    disabled={saving}
                    id="project-currency"
                    maxLength={3}
                    onChange={(event) =>
                      setCurrency(event.target.value.toUpperCase())
                    }
                    value={currency}
                  />
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                className="min-h-28"
                disabled={saving}
                id="project-description"
                maxLength={10_000}
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button disabled={saving} type="submit">
              {saving ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Plus />
              )}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
