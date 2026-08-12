"use client";

import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Save,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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

type Row = Record<string, unknown>;
type Detail = {
  prospect: Row;
  contacts: Row[];
  activities: Row[];
  directory: Row[];
  owners: Row[];
};

const stages = ["lead", "qualified", "quote", "lost"] as const;

export function OpportunityDetail({
  prospectId,
  canManage,
}: {
  prospectId: string;
  canManage: boolean;
}) {
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/prospects/${prospectId}`);
    const body = (await response.json()) as Detail & { error?: string };
    if (response.ok) setData(body);
    else setError(body.error ?? "Unable to load opportunity.");
    setLoading(false);
  }, [prospectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data) return;
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const stage = String(form.get("stage"));
    const response = await fetch("/api/prospects", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: prospectId,
        title: String(form.get("title")),
        ownerId: nullValue(form.get("ownerId")),
        primaryContactId: nullValue(form.get("primaryContactId")),
        stage,
        probability: Number(form.get("probability")),
        value: Number(form.get("value")),
        currency: String(data.prospect.currency ?? "USD"),
        nextAction: nullValue(form.get("nextAction")),
        nextActionAt: dateTimeValue(form.get("nextActionAt")),
        lostReason: stage === "lost" ? nullValue(form.get("lostReason")) : null,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) await load();
    else setError(body.error ?? "Unable to save opportunity.");
    setSaving(false);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading opportunity…
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-destructive">
          {error || "Opportunity not found."}
        </CardContent>
      </Card>
    );
  }

  const prospect = data.prospect;
  const account = relation(prospect.client);
  const wonProject = relation(prospect.won_project);
  const wonRetainer = relation(prospect.won_retainer);
  const stage = String(prospect.stage);
  const closed = stage === "won" || stage === "lost";

  return (
    <div className="space-y-6">
      <Button asChild className="-ml-2" size="sm" variant="ghost">
        <Link href="/clients/prospects"><ArrowLeft />Pipeline</Link>
      </Button>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {String(prospect.title)}
            </h1>
            <Badge variant={stage === "lost" ? "destructive" : "secondary"}>
              {stage}
            </Badge>
          </div>
          <p className="mt-2 text-muted-foreground">
            {String(account?.name ?? "Client")} ·{" "}
            {money(prospect.value_cents, String(prospect.currency))}
          </p>
        </div>
        {canManage && !closed ? (
          <ConvertDialog prospect={prospect} prospectId={prospectId} />
        ) : null}
      </header>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {wonProject ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-medium">Converted to {String(wonProject.name)}</p>
              <p className="text-sm text-muted-foreground">
                {String(wonProject.code)}
                {wonRetainer ? ` · ${String(wonRetainer.name)}` : ""}
              </p>
            </div>
            <Button asChild size="sm">
              <Link href={`/projects/${wonProject.id}`}>Open project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader><CardTitle>Opportunity details</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
              <Field label="Opportunity">
                <Input
                  defaultValue={String(prospect.title)}
                  disabled={!canManage || closed}
                  name="title"
                  required
                />
              </Field>
              <Field label="Owner">
                <Select
                  defaultValue={nullableString(prospect.owner_id) ?? "unassigned"}
                  disabled={!canManage || closed}
                  name="ownerId"
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {data.owners.map((owner) => (
                      <SelectItem key={String(owner.id)} value={String(owner.id)}>
                        {String(owner.full_name)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Stage">
                <Select
                  defaultValue={stage === "won" ? "qualified" : stage}
                  disabled={!canManage || stage === "won"}
                  name="stage"
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {stages.map((value) => (
                      <SelectItem key={value} value={value}>{label(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Primary contact">
                <Select
                  defaultValue={
                    nullableString(prospect.primary_contact_id) ?? "unassigned"
                  }
                  disabled={!canManage || closed}
                  name="primaryContactId"
                >
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {data.contacts.map((link) => {
                      const contact = relation(link.contact);
                      return contact ? (
                        <SelectItem key={String(contact.id)} value={String(contact.id)}>
                          {contactName(contact)}
                        </SelectItem>
                      ) : null;
                    })}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Value">
                <Input
                  defaultValue={String(Number(prospect.value_cents ?? 0) / 100)}
                  disabled={!canManage || closed}
                  min="0"
                  name="value"
                  step="0.01"
                  type="number"
                />
              </Field>
              <Field label="Probability">
                <Input
                  defaultValue={String(prospect.probability)}
                  disabled={!canManage || closed}
                  max="100"
                  min="0"
                  name="probability"
                  type="number"
                />
              </Field>
              <Field label="Next action">
                <Input
                  defaultValue={nullableString(prospect.next_action) ?? ""}
                  disabled={!canManage || closed}
                  name="nextAction"
                />
              </Field>
              <Field label="Next action date">
                <Input
                  defaultValue={localDateTime(prospect.next_action_at)}
                  disabled={!canManage || closed}
                  name="nextActionAt"
                  type="datetime-local"
                />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="lost-reason">Lost reason</Label>
                <Textarea
                  defaultValue={nullableString(prospect.lost_reason) ?? ""}
                  disabled={!canManage || stage === "won"}
                  id="lost-reason"
                  name="lostReason"
                  placeholder="Required when moving this opportunity to lost"
                />
              </div>
              {canManage && !closed ? (
                <div className="sm:col-span-2">
                  <Button disabled={saving}>
                    {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                    Save opportunity
                  </Button>
                </div>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4" />Contacts
            </CardTitle>
            {canManage && !closed ? (
              <LinkContactDialog data={data} onSaved={load} prospectId={prospectId} />
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {data.contacts.map((link) => {
              const contact = relation(link.contact);
              return contact ? (
                <div className="rounded-lg border p-3" key={String(link.id)}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{contactName(contact)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(link.role ?? contact.title ?? contact.email ?? "Contact")}
                      </p>
                    </div>
                    {link.is_primary ? <Badge variant="secondary">Primary</Badge> : null}
                  </div>
                </div>
              ) : null;
            })}
            {!data.contacts.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No opportunity contacts.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" />Activity & history
          </CardTitle>
          {canManage ? (
            <ActivityDialog onSaved={load} prospectId={prospectId} />
          ) : null}
        </CardHeader>
        <CardContent className="divide-y p-0">
          {data.activities.map((activity) => {
            const author = relation(activity.author);
            return (
              <div className="px-5 py-4" key={String(activity.id)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{String(activity.subject)}</p>
                  <time className="text-xs text-muted-foreground">
                    {new Date(String(activity.occurred_at)).toLocaleString()}
                  </time>
                </div>
                {activity.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {String(activity.body)}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {String(activity.activity_type)} ·{" "}
                  {String(author?.full_name ?? activity.source ?? "System")}
                </p>
              </div>
            );
          })}
          {!data.activities.length ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No activity has been recorded.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ConvertDialog({
  prospect,
  prospectId,
}: {
  prospect: Row;
  prospectId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createRetainer, setCreateRetainer] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/prospects/${prospectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "convert_won",
        projectName: String(form.get("projectName")),
        projectCode: String(form.get("projectCode")).toUpperCase(),
        startDate: String(form.get("startDate")),
        createRetainer,
        retainerName: createRetainer ? String(form.get("retainerName")) : null,
        retainerFee: createRetainer ? Number(form.get("retainerFee")) : null,
        retainerIncludedHours: createRetainer
          ? Number(form.get("retainerIncludedHours"))
          : null,
        idempotencyKey,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      conversion?: { project_id?: string };
      error?: string;
    };
    if (response.ok) {
      setOpen(false);
      const projectId = body.conversion?.project_id;
      if (projectId) router.push(`/projects/${projectId}`);
      else router.refresh();
    } else setError(body.error ?? "Unable to convert opportunity.");
    setSaving(false);
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setIdempotencyKey(crypto.randomUUID());
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button><CheckCircle2 />Mark won & create delivery</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Convert won opportunity</DialogTitle>
            <DialogDescription>
              Creates the linked delivery project and, optionally, its retainer in
              one transaction.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <Field label="Project name">
              <Input
                defaultValue={String(prospect.title)}
                name="projectName"
                required
              />
            </Field>
            <Field label="Project code">
              <Input name="projectCode" pattern="[A-Z0-9][A-Z0-9-]{1,31}" required />
            </Field>
            <Field label="Start date">
              <Input
                defaultValue={new Date().toISOString().slice(0, 10)}
                name="startDate"
                required
                type="date"
              />
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <Checkbox
                checked={createRetainer}
                onCheckedChange={(value) => setCreateRetainer(value === true)}
              />
              Create monthly retainer
            </label>
            {createRetainer ? (
              <>
                <Field label="Retainer name">
                  <Input name="retainerName" required />
                </Field>
                <Field label="Monthly fee">
                  <Input min="0" name="retainerFee" required step="0.01" type="number" />
                </Field>
                <Field label="Included hours">
                  <Input min="0" name="retainerIncludedHours" required type="number" />
                </Field>
              </>
            ) : null}
            {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button disabled={saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : <BriefcaseBusiness />}
              Convert opportunity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LinkContactDialog({
  data,
  prospectId,
  onSaved,
}: {
  data: Detail;
  prospectId: string;
  onSaved: () => Promise<void>;
}) {
  const linked = new Set(
    data.contacts
      .map((item) => relation(item.contact)?.id)
      .filter((id): id is unknown => Boolean(id))
      .map(String),
  );
  const available = data.directory.filter((contact) => !linked.has(String(contact.id)));
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState("");
  const [primary, setPrimary] = useState(false);

  async function save() {
    const response = await fetch(`/api/prospects/${prospectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "link_contact",
        contactId,
        role: role || null,
        isPrimary: primary,
      }),
    });
    if (response.ok) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus />Add</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add opportunity contact</DialogTitle>
          <DialogDescription>
            Contacts can be affiliated with multiple client accounts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Contact">
            <Select onValueChange={setContactId} value={contactId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Choose contact" /></SelectTrigger>
              <SelectContent>
                {available.map((contact) => (
                  <SelectItem key={String(contact.id)} value={String(contact.id)}>
                    {contactName(contact)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Opportunity role">
            <Input onChange={(event) => setRole(event.target.value)} value={role} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={primary}
              onCheckedChange={(value) => setPrimary(value === true)}
            />
            Primary opportunity contact
          </label>
        </div>
        <DialogFooter>
          <Button disabled={!contactId} onClick={() => void save()}>
            <Plus />Add contact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivityDialog({
  prospectId,
  onSaved,
}: {
  prospectId: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/prospects/${prospectId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add_activity",
        activityType: String(form.get("activityType")),
        subject: String(form.get("subject")),
        body: nullValue(form.get("body")),
        occurredAt: new Date(String(form.get("occurredAt"))).toISOString(),
      }),
    });
    if (response.ok) {
      setOpen(false);
      await onSaved();
    }
  }
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus />Log activity</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Log opportunity activity</DialogTitle>
            <DialogDescription>Add a durable sales interaction or note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            <Field label="Type">
              <Select defaultValue="note" name="activityType">
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["note", "call", "email", "meeting"].map((value) => (
                    <SelectItem key={value} value={value}>{label(value)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Subject"><Input name="subject" required /></Field>
            <Field label="Occurred">
              <Input
                defaultValue={new Date().toISOString().slice(0, 16)}
                name="occurredAt"
                required
                type="datetime-local"
              />
            </Field>
            <Field label="Notes"><Textarea name="body" /></Field>
          </div>
          <DialogFooter><Button><Plus />Add activity</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label: title, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{title}</Label>{children}</div>;
}

function relation(value: unknown): Row | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" ? (row as Row) : undefined;
}

function contactName(contact: Row) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    String(contact.email ?? "Contact");
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function nullValue(value: FormDataEntryValue | null) {
  const string = value === null ? "" : String(value).trim();
  return string && string !== "unassigned" ? string : null;
}

function dateTimeValue(value: FormDataEntryValue | null) {
  const string = nullValue(value);
  return string ? new Date(string).toISOString() : null;
}

function localDateTime(value: unknown) {
  const string = nullableString(value);
  return string ? new Date(string).toISOString().slice(0, 16) : "";
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: unknown, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0) / 100);
}
