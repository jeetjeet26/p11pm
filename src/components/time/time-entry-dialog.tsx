"use client";

import { useState } from "react";
import { Clock3, LoaderCircle, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

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

export interface TimeEntryOption {
  id: string;
  name: string;
  clientId?: string | null;
  projectId?: string | null;
}

export interface EditableTimeEntry {
  id: string;
  projectId: string | null;
  clientId: string | null;
  retainerId: string | null;
  todoId: string | null;
  entryDate: string;
  durationMinutes: number;
  description: string;
  billable: boolean;
  status: string;
  rejectionReason?: string | null;
}

interface TimeEntryDialogProps {
  clients: TimeEntryOption[];
  entry?: EditableTimeEntry;
  issues: TimeEntryOption[];
  projects: TimeEntryOption[];
  retainers: TimeEntryOption[];
}

export function TimeEntryDialog({
  clients,
  entry,
  issues,
  projects,
  retainers,
}: TimeEntryDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(entry?.clientId ?? "");
  const [projectId, setProjectId] = useState(entry?.projectId ?? "");
  const [retainerId, setRetainerId] = useState(entry?.retainerId ?? "");
  const [todoId, setTodoId] = useState(entry?.todoId ?? "");
  const [entryDate, setEntryDate] = useState(
    entry?.entryDate ?? new Date().toISOString().slice(0, 10),
  );
  const [hours, setHours] = useState(
    entry ? String(Math.floor(entry.durationMinutes / 60)) : "",
  );
  const [minutes, setMinutes] = useState(
    entry ? String(entry.durationMinutes % 60) : "",
  );
  const [description, setDescription] = useState(entry?.description ?? "");
  const [billable, setBillable] = useState(entry?.billable ?? true);

  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const durationMinutes =
      (Number.parseInt(hours || "0", 10) || 0) * 60 +
      (Number.parseInt(minutes || "0", 10) || 0);
    if (durationMinutes <= 0) {
      setError("Enter a duration greater than zero.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        entry ? `/api/time-entries?id=${encodeURIComponent(entry.id)}` : "/api/time-entries",
        {
          method: entry ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(entry ? { id: entry.id } : {}),
            clientId: clientId || null,
            projectId: projectId || null,
            retainerId: retainerId || null,
            todoId: todoId || null,
            entryDate,
            durationMinutes,
            description,
            billable,
            ...(entry?.status === "rejected" ? { status: "submitted" } : {}),
          }),
        },
      );
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to save this time entry.");
      }
      setOpen(false);
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save this time entry.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size={entry ? "icon-sm" : "default"} variant={entry ? "ghost" : "default"}>
          {entry ? <Pencil /> : <Plus />}
          <span className={entry ? "sr-only" : undefined}>
            {entry ? "Edit time entry" : "Add time"}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={saveEntry}>
          <DialogHeader>
            <DialogTitle>{entry ? "Edit time entry" : "Log time"}</DialogTitle>
            <DialogDescription>
              Record the work performed and where it should be billed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <Field label="Date" htmlFor={`entry-date-${entry?.id ?? "new"}`}>
              <Input
                disabled={saving}
                id={`entry-date-${entry?.id ?? "new"}`}
                onChange={(event) => setEntryDate(event.target.value)}
                required
                type="date"
                value={entryDate}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hours" htmlFor={`entry-hours-${entry?.id ?? "new"}`}>
                <Input
                  disabled={saving}
                  id={`entry-hours-${entry?.id ?? "new"}`}
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => setHours(event.target.value)}
                  type="number"
                  value={hours}
                />
              </Field>
              <Field label="Minutes" htmlFor={`entry-minutes-${entry?.id ?? "new"}`}>
                <Input
                  disabled={saving}
                  id={`entry-minutes-${entry?.id ?? "new"}`}
                  inputMode="numeric"
                  max="59"
                  min="0"
                  onChange={(event) => setMinutes(event.target.value)}
                  type="number"
                  value={minutes}
                />
              </Field>
            </div>
            <Field label="Client" htmlFor={`entry-client-${entry?.id ?? "new"}`}>
              <Select
                onValueChange={(value) => {
                  setClientId(value);
                  if (
                    projectId &&
                    projects.find((project) => project.id === projectId)?.clientId !==
                      value
                  ) {
                    setProjectId("");
                  }
                  if (
                    retainerId &&
                    retainers.find((retainer) => retainer.id === retainerId)?.clientId !==
                      value
                  ) {
                    setRetainerId("");
                  }
                }}
                required
                value={clientId}
              >
                <SelectTrigger className="w-full" id={`entry-client-${entry?.id ?? "new"}`}>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Project" htmlFor={`entry-project-${entry?.id ?? "new"}`}>
              <Select
                onValueChange={(value) => {
                  setProjectId(value);
                  if (
                    todoId &&
                    issues.find((issue) => issue.id === todoId)?.projectId !== value
                  ) {
                    setTodoId("");
                  }
                }}
                required
                value={projectId}
              >
                <SelectTrigger className="w-full" id={`entry-project-${entry?.id ?? "new"}`}>
                  <SelectValue placeholder="Select project" />
                </SelectTrigger>
                <SelectContent>
                  {projects
                    .filter((project) => !clientId || project.clientId === clientId)
                    .map((project) => (
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Issue" htmlFor={`entry-issue-${entry?.id ?? "new"}`}>
              <Select
                onValueChange={(value) => setTodoId(value === "__none" ? "" : value)}
                value={todoId || "__none"}
              >
                <SelectTrigger className="w-full" id={`entry-issue-${entry?.id ?? "new"}`}>
                  <SelectValue placeholder="Optional issue" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No issue</SelectItem>
                  {issues
                    .filter((issue) => !projectId || issue.projectId === projectId)
                    .map((issue) => (
                      <SelectItem key={issue.id} value={issue.id}>{issue.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Retainer" htmlFor={`entry-retainer-${entry?.id ?? "new"}`}>
              <Select
                onValueChange={(value) =>
                  setRetainerId(value === "__none" ? "" : value)
                }
                value={retainerId || "__none"}
              >
                <SelectTrigger className="w-full" id={`entry-retainer-${entry?.id ?? "new"}`}>
                  <SelectValue placeholder="Optional retainer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No retainer</SelectItem>
                  {retainers
                    .filter((retainer) => !clientId || retainer.clientId === clientId)
                    .map((retainer) => (
                      <SelectItem key={retainer.id} value={retainer.id}>{retainer.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="flex items-end">
              <label className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                <input
                  checked={billable}
                  className="size-4 accent-primary"
                  disabled={saving}
                  onChange={(event) => setBillable(event.target.checked)}
                  type="checkbox"
                />
                Billable time
              </label>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`entry-description-${entry?.id ?? "new"}`}>Work performed</Label>
              <Textarea
                className="min-h-24"
                disabled={saving}
                id={`entry-description-${entry?.id ?? "new"}`}
                maxLength={2_000}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the outcome, not just the activity."
                required
                value={description}
              />
            </div>
            {error ? (
              <Alert className="sm:col-span-2" variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            {entry?.status === "rejected" && entry.rejectionReason ? (
              <Alert className="sm:col-span-2" variant="destructive">
                <AlertDescription>
                  Returned by manager: {entry.rejectionReason}. Saving will resubmit
                  the corrected entry.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={saving} type="submit">
              {saving ? <LoaderCircle className="animate-spin" /> : <Clock3 />}
              {entry?.status === "rejected"
                ? "Save and resubmit"
                : entry
                  ? "Save changes"
                  : "Log time"}
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
