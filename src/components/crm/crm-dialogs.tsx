"use client";

import { useState } from "react";
import { LoaderCircle, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

import type { CrmClient } from "./types";
import type { CrmContact } from "./types";
import type { CrmRetainer } from "./types";

type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  multiline?: boolean;
  options?: Array<{ label: string; value: string }>;
};

function ApiDialog({
  endpoint,
  method = "POST",
  title,
  description,
  triggerLabel,
  triggerIcon = "plus",
  fields,
  fixedValues,
  submitLabel,
  onCreated,
  children,
}: {
  endpoint: string;
  method?: "POST" | "PATCH";
  title: string;
  description: string;
  triggerLabel: string;
  triggerIcon?: "plus" | "pencil";
  fields: Field[];
  fixedValues?: Record<string, string>;
  submitLabel: string;
  onCreated?: (result: Record<string, unknown>) => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const body = {
      ...fixedValues,
      ...Object.fromEntries(
        [...form.entries()].map(([key, value]) => {
          const normalized = String(value).trim();
          return [key, normalized === "" ? null : normalized];
        }),
      ),
    };
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        throw new Error(
          typeof result.error === "string" ? result.error : `Unable to ${submitLabel.toLowerCase()}.`,
        );
      }
      setOpen(false);
      onCreated?.(result);
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerIcon === "pencil" ? "outline" : "default"}>
          {triggerIcon === "pencil" ? <Pencil /> : <Plus />}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            {fields.map((field) => (
              <div
                className={field.multiline ? "space-y-2 sm:col-span-2" : "space-y-2"}
                key={field.name}
              >
                <Label htmlFor={`${title}-${field.name}`}>{field.label}</Label>
                {field.options ? (
                  <Select
                    defaultValue={field.defaultValue}
                    disabled={saving}
                    name={field.name}
                    required={field.required}
                  >
                    <SelectTrigger
                      className="w-full"
                      id={`${title}-${field.name}`}
                    >
                      <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.multiline ? (
                  <Textarea
                    defaultValue={field.defaultValue}
                    disabled={saving}
                    id={`${title}-${field.name}`}
                    name={field.name}
                    placeholder={field.placeholder}
                    required={field.required}
                    rows={4}
                  />
                ) : (
                  <Input
                    defaultValue={field.defaultValue}
                    disabled={saving}
                    id={`${title}-${field.name}`}
                    name={field.name}
                    placeholder={field.placeholder}
                    required={field.required}
                    type={field.type}
                  />
                )}
              </div>
            ))}
            {children}
            {error && (
              <p className="text-sm text-destructive sm:col-span-2" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button disabled={saving} type="submit">
              {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClientDialog({
  client,
  profiles = [],
  accountOptions = [],
}: {
  client?: CrmClient;
  profiles?: Array<{ id: string; name: string }>;
  accountOptions?: Array<{ id: string; name: string }>;
}) {
  const otherAccounts = accountOptions.filter((account) => account.id !== client?.id);
  return (
    <ApiDialog
      description={
        client
          ? "Keep the account record accurate for everyone."
          : "Add an organization to the shared client directory."
      }
      endpoint="/api/clients"
      fields={[
        { name: "name", label: "Company name", required: true, defaultValue: client?.name },
        { name: "industry", label: "Industry", defaultValue: client?.industry ?? "" },
        { name: "website", label: "Website", type: "url", defaultValue: client?.website ?? "" },
        { name: "phone", label: "Phone", type: "tel", defaultValue: client?.phone ?? "" },
        { name: "email", label: "General email", type: "email", defaultValue: client?.email ?? "" },
        {
          name: "ownerId",
          label: "Account owner",
          defaultValue: client?.ownerId ?? "",
          options: [
            { label: "Unassigned", value: "" },
            ...profiles.map((profile) => ({
              label: profile.name,
              value: profile.id,
            })),
          ],
        },
        {
          name: "parentClientId",
          label: "Parent account",
          defaultValue: client?.parentClientId ?? "",
          options: [
            { label: "None", value: "" },
            ...otherAccounts.map((account) => ({
              label: account.name,
              value: account.id,
            })),
          ],
        },
        { name: "notes", label: "Internal notes", multiline: true, defaultValue: client?.notes ?? "" },
      ]}
      fixedValues={client ? { id: client.id } : undefined}
      method={client ? "PATCH" : "POST"}
      submitLabel={client ? "Save client" : "Create client"}
      title={client ? "Edit client" : "New client"}
      triggerIcon={client ? "pencil" : "plus"}
      triggerLabel={client ? "Edit" : "New client"}
    />
  );
}

export function ContactDialog({ clientId }: { clientId: string }) {
  return (
    <ApiDialog
      description="Add a person your team can contact at this organization."
      endpoint="/api/contacts"
      fields={[
        { name: "name", label: "Full name", required: true },
        { name: "title", label: "Role or title" },
        { name: "email", label: "Email", type: "email" },
        { name: "phone", label: "Phone", type: "tel" },
      ]}
      fixedValues={{ clientId }}
      submitLabel="Add contact"
      title="New contact"
      triggerLabel="Add contact"
    />
  );
}

export function ContactEditDialog({ contact }: { contact: CrmContact }) {
  return (
    <ApiDialog
      description="Update contact details and standing across affiliated accounts."
      endpoint="/api/contacts"
      fields={[
        { name: "name", label: "Full name", required: true, defaultValue: contact.name },
        { name: "title", label: "Role or title", defaultValue: contact.title ?? "" },
        { name: "email", label: "Email", type: "email", defaultValue: contact.email ?? "" },
        { name: "phone", label: "Phone", type: "tel", defaultValue: contact.phone ?? "" },
        {
          name: "status",
          label: "Status",
          defaultValue: contact.status ?? "active",
          options: [
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
          ],
        },
      ]}
      fixedValues={{ id: contact.id }}
      method="PATCH"
      submitLabel="Save contact"
      title="Edit contact"
      triggerIcon="pencil"
      triggerLabel="Edit"
    />
  );
}

type DuplicateGroup = {
  email: string;
  contacts: Array<{
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    status: string | null;
  }>;
};

export function ContactDedupPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/contacts/deduplicate");
    const body = (await response.json()) as {
      duplicates?: DuplicateGroup[];
      error?: string;
    };
    if (!response.ok) {
      setError(body.error ?? "Unable to scan for duplicate contacts.");
      setGroups([]);
    } else {
      setGroups(body.duplicates ?? []);
    }
    setLoading(false);
  }

  async function merge(targetId: string, duplicateId: string) {
    setMerging(`${targetId}:${duplicateId}`);
    setError(null);
    const response = await fetch("/api/contacts/deduplicate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetContactId: targetId,
        duplicateContactId: duplicateId,
      }),
    });
    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "Unable to merge contacts.");
    } else {
      await load();
      router.refresh();
    }
    setMerging(null);
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Review duplicates</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Duplicate contacts</DialogTitle>
          <DialogDescription>
            Merge repeated people while preserving cross-client affiliations.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Scanning workspace contacts…
          </p>
        ) : groups.length ? (
          <div className="space-y-4">
            {groups.map((group) => (
              <div className="rounded-lg border p-4" key={group.email}>
                <p className="font-medium">{group.email}</p>
                <div className="mt-3 space-y-2">
                  {group.contacts.map((contact, index) => {
                    const name =
                      [contact.first_name, contact.last_name]
                        .filter(Boolean)
                        .join(" ") || "Contact";
                    const canonical = group.contacts[0];
                    return (
                      <div
                        className="flex items-center justify-between gap-3 text-sm"
                        key={contact.id}
                      >
                        <span>
                          {name}
                          {contact.status === "inactive" ? " · inactive" : ""}
                        </span>
                        {index > 0 && canonical ? (
                          <Button
                            disabled={merging === `${canonical.id}:${contact.id}`}
                            onClick={() => void merge(canonical.id, contact.id)}
                            size="sm"
                            variant="outline"
                          >
                            {merging === `${canonical.id}:${contact.id}` ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              "Merge into primary"
                            )}
                          </Button>
                        ) : (
                          <Badge variant="secondary">Primary</Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No duplicate email addresses were found.
          </p>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button onClick={() => void load()} variant="outline">
            Rescan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActivityDialog({ clientId }: { clientId: string }) {
  return (
    <ApiDialog
      description="Record an interaction so the account history stays complete."
      endpoint="/api/client-activities"
      fields={[
        {
          name: "type",
          label: "Activity type",
          required: true,
          defaultValue: "note",
          options: [
            { label: "Note", value: "note" },
            { label: "Call", value: "call" },
            { label: "Email", value: "email" },
            { label: "Meeting", value: "meeting" },
            { label: "Report", value: "report" },
          ],
        },
        { name: "subject", label: "Subject", required: true },
        {
          name: "occurredAt",
          label: "Date and time",
          required: true,
          type: "datetime-local",
          defaultValue: new Date().toISOString().slice(0, 16),
        },
        { name: "body", label: "Notes", multiline: true },
      ]}
      fixedValues={{ clientId }}
      submitLabel="Add activity"
      title="Log activity"
      triggerLabel="Log activity"
    />
  );
}

export function RetainerDialog({
  clients,
  defaultClientId,
  retainer,
}: {
  clients: Array<{ id: string; name: string }>;
  defaultClientId?: string;
  retainer?: CrmRetainer;
}) {
  return (
    <ApiDialog
      description={
        retainer
          ? "Update the contract terms used for future service periods."
          : "Define the recurring allowance and fixed commercial terms."
      }
      endpoint="/api/retainers"
      fields={[
        {
          name: "name",
          label: "Retainer name",
          required: true,
          defaultValue: retainer?.name,
        },
        {
          name: "cadence",
          label: "Billing cadence",
          required: true,
          defaultValue: retainer?.cadence ?? "monthly",
          options: [
            { label: "Weekly", value: "weekly" },
            { label: "Monthly", value: "monthly" },
            { label: "Quarterly", value: "quarterly" },
            { label: "Annual", value: "annual" },
            { label: "Custom", value: "custom" },
          ],
        },
        {
          name: "allowanceType",
          label: "Allowance model",
          required: true,
          defaultValue: retainer?.allowanceType ?? "fixed_value",
          options: [
            { label: "Fixed value", value: "fixed_value" },
            { label: "Fixed hours", value: "fixed_hours" },
            { label: "Unlimited hours", value: "unlimited_hours" },
            { label: "Task deliverables", value: "deliverables" },
          ],
        },
        {
          name: "value",
          label: "Fixed value per period",
          required: true,
          type: "number",
          defaultValue:
            retainer?.value === null || retainer?.value === undefined
              ? ""
              : String(retainer.value),
        },
        {
          name: "allowanceHours",
          label: "Included hours per period",
          type: "number",
          defaultValue:
            retainer?.allowanceHours === undefined
              ? ""
              : String(retainer.allowanceHours),
        },
        {
          name: "hourlyRate",
          label: "Overage rate",
          type: "number",
          defaultValue:
            retainer?.hourlyRate === null || retainer?.hourlyRate === undefined
              ? ""
              : String(retainer.hourlyRate),
        },
        {
          name: "rolloverPolicy",
          label: "Unused allowance",
          defaultValue: retainer?.rolloverPolicy ?? "none",
          options: [
            { label: "Does not roll over", value: "none" },
            { label: "Rolls to next period", value: "next_period" },
            { label: "Rolls through contract", value: "contract" },
          ],
        },
        {
          name: "overagePolicy",
          label: "Overage treatment",
          defaultValue: retainer?.overagePolicy ?? "do_not_bill",
          options: [
            { label: "Do not bill", value: "do_not_bill" },
            { label: "Bill automatically", value: "bill" },
            { label: "Unlimited", value: "unlimited" },
            { label: "Manual review", value: "manual_review" },
          ],
        },
        {
          name: "invoiceTiming",
          label: "Invoice timing",
          defaultValue: retainer?.invoiceTiming ?? "period_start",
          options: [
            { label: "At period start", value: "period_start" },
            { label: "At period end", value: "period_end" },
            { label: "Manual", value: "manual" },
          ],
        },
        {
          name: "autoRenew",
          label: "Auto renew",
          defaultValue: retainer?.autoRenew ? "true" : "false",
          options: [
            { label: "Yes", value: "true" },
            { label: "No", value: "false" },
          ],
        },
        {
          name: "renewalDays",
          label: "Renewal notice (days)",
          type: "number",
          defaultValue:
            retainer?.renewalDays === null ||
            retainer?.renewalDays === undefined
              ? ""
              : String(retainer.renewalDays),
        },
        {
          name: "startDate",
          label: "Contract start",
          required: true,
          type: "date",
          defaultValue: retainer?.startDate ?? undefined,
        },
        {
          name: "endDate",
          label: "Renewal / end date",
          type: "date",
          defaultValue: retainer?.endDate ?? undefined,
        },
        ...(retainer
          ? [
              {
                name: "status",
                label: "Contract status",
                defaultValue: retainer.status ?? "draft",
                options: [
                  { label: "Draft", value: "draft" },
                  { label: "Active", value: "active" },
                  { label: "Paused", value: "paused" },
                  { label: "Completed", value: "completed" },
                  { label: "Cancelled", value: "cancelled" },
                ],
              },
            ]
          : []),
      ]}
      fixedValues={retainer ? { id: retainer.id } : undefined}
      method={retainer ? "PATCH" : "POST"}
      submitLabel={retainer ? "Save retainer" : "Create retainer"}
      title={retainer ? "Edit retainer" : "New retainer"}
      triggerIcon={retainer ? "pencil" : "plus"}
      triggerLabel={retainer ? "Edit terms" : "New retainer"}
    >
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor="retainer-client">Client</Label>
        <Select
          defaultValue={defaultClientId ?? retainer?.clientId}
          name="clientId"
          required
        >
          <SelectTrigger className="w-full" id="retainer-client">
            <SelectValue placeholder="Select a client" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ApiDialog>
  );
}
