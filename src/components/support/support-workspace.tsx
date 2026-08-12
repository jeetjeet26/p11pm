"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Headphones,
  LoaderCircle,
  MessageSquareText,
  Search,
  Send,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };

interface SupportTicket {
  todo_id: string;
  client_id: string;
  requester_contact_id?: string | null;
  source_provider: string;
  external_id?: string | null;
  source_status?: string | null;
  opened_at: string;
  first_response_due_at?: string | null;
  first_response_at?: string | null;
  resolution_due_at?: string | null;
  last_customer_message_at?: string | null;
  last_team_response_at?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  title: string;
  description?: string | null;
  status: SupportStatus;
  priority: SupportPriority;
  assigned_to?: string | null;
  version: number;
  updated_at: string;
  client_name: string;
  requester_name?: string | null;
  requester_email?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  issue_key: string;
  sla_state: string;
  requester_phone?: string | null;
  source_url?: string | null;
}

interface SupportComment {
  id: string;
  author_id?: string | null;
  author_name?: string | null;
  body: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface SupportDetail {
  ticket: SupportTicket;
  comments: SupportComment[];
  transitions: Array<{
    id: string;
    from_status: string;
    to_status: string;
    created_at: string;
  }>;
}

type SupportStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";
type SupportPriority = "low" | "medium" | "high" | "urgent";

const initialSummary = {
  open: 0,
  unassigned: 0,
  breached: 0,
  at_risk: 0,
  closed: 0,
};

export function SupportWorkspace({
  canWrite,
  clients,
  initialTicketId,
  profiles,
}: {
  canWrite: boolean;
  clients: Option[];
  initialTicketId?: string;
  profiles: Option[];
}) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [summary, setSummary] = useState(initialSummary);
  const [selectedId, setSelectedId] = useState(initialTicketId);
  const [detail, setDetail] = useState<SupportDetail | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("all");
  const [owner, setOwner] = useState("all");
  const [client, setClient] = useState("all");
  const [sla, setSla] = useState("all");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialTicketId));
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "200" });
    if (query.trim()) params.set("q", query.trim());
    if (status === "closed") {
      params.set("status", "done,cancelled");
      params.set("closed", "1");
    } else if (status !== "open" && status !== "all") {
      params.set("status", status);
    } else if (status === "all") {
      params.set("closed", "1");
    }
    if (priority !== "all") params.set("priority", priority);
    if (owner !== "all") params.set("owner", owner);
    if (client !== "all") params.set("client", client);
    if (sla !== "all") params.set("sla", sla);
    try {
      const response = await fetch(`/api/support/tickets?${params}`, { signal });
      const body = (await response.json()) as {
        tickets?: SupportTicket[];
        summary?: typeof initialSummary;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Unable to load support.");
      setTickets(body.tickets ?? []);
      setSummary({ ...initialSummary, ...body.summary });
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load support.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [client, owner, priority, query, sla, status]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => void loadQueue(controller.signal),
      query ? 250 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadQueue, query]);

  const loadDetail = useCallback(async (ticketId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`);
      const body = (await response.json()) as SupportDetail & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load this ticket.");
      setDetail(body);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load this ticket.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => void loadDetail(selectedId), 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, selectedId]);

  function selectTicket(ticketId: string) {
    setSelectedId(ticketId);
    window.history.pushState(null, "", `/support/${ticketId}`);
  }

  function closeDetail() {
    setSelectedId(undefined);
    setDetail(null);
    window.history.pushState(null, "", "/support");
  }

  async function refreshSelected() {
    await Promise.all([
      loadQueue(),
      selectedId ? loadDetail(selectedId) : Promise.resolve(),
    ]);
  }

  return (
    <div className="space-y-6" data-testid="support-workspace">
      <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Headphones className="size-5" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Support</h1>
              <p className="mt-1 text-muted-foreground">
                Client requests, ownership, response targets, and correspondence.
              </p>
            </div>
          </div>
        </div>
        {!canWrite && <Badge variant="secondary">Read only</Badge>}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Headphones} label="Open tickets" value={summary.open} />
        <Metric
          alert={summary.breached > 0}
          icon={AlertTriangle}
          label="SLA breached"
          value={summary.breached}
        />
        <Metric icon={Clock3} label="At risk" value={summary.at_risk} />
        <Metric icon={UserRound} label="Unassigned" value={summary.unassigned} />
      </section>

      <Card className="gap-0 py-0">
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_repeat(5,minmax(130px,auto))]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search support tickets"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search ticket, client, requester…"
              value={query}
            />
          </div>
          <Filter
            label="Status"
            onChange={setStatus}
            options={[
              ["open", "Open"],
              ["all", "All"],
              ["todo", "New"],
              ["in_progress", "In progress"],
              ["blocked", "Blocked"],
              ["review", "Waiting / review"],
              ["closed", "Closed"],
            ]}
            value={status}
          />
          <Filter
            label="Priority"
            onChange={setPriority}
            options={[
              ["all", "Any priority"],
              ["urgent", "Urgent"],
              ["high", "High"],
              ["medium", "Medium"],
              ["low", "Low"],
            ]}
            value={priority}
          />
          <Filter
            label="SLA"
            onChange={setSla}
            options={[
              ["all", "Any SLA"],
              ["breached", "Breached"],
              ["at_risk", "At risk"],
              ["on_track", "On track"],
            ]}
            value={sla}
          />
          <Filter
            label="Owner"
            onChange={setOwner}
            options={[
              ["all", "Any owner"],
              ...profiles.map((profile) => [profile.id, profile.name] as [string, string]),
            ]}
            value={owner}
          />
          <Filter
            label="Client"
            onChange={setClient}
            options={[
              ["all", "Any client"],
              ...clients.map((item) => [item.id, item.name] as [string, string]),
            ]}
            value={client}
          />
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(390px,500px)]">
        <Card className="gap-0 overflow-hidden py-0">
          {loading ? (
            <CardContent className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              Loading support queue…
            </CardContent>
          ) : tickets.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Client / requester</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((ticket) => (
                  <TableRow
                    className={cn(
                      "cursor-pointer",
                      selectedId === ticket.todo_id && "bg-primary/5",
                    )}
                    key={ticket.todo_id}
                    onClick={() => selectTicket(ticket.todo_id)}
                  >
                    <TableCell className="max-w-80 whitespace-normal">
                      <Link
                        className="font-medium hover:text-primary"
                        href={`/support/${ticket.todo_id}`}
                        onNavigate={(event) => {
                          event.preventDefault();
                          selectTicket(ticket.todo_id);
                        }}
                      >
                        {ticket.title}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{ticket.issue_key}</span>
                        <PriorityBadge priority={ticket.priority} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <p>{ticket.client_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ticket.requester_name ?? ticket.requester_email ?? "No requester"}
                      </p>
                    </TableCell>
                    <TableCell>{ticket.owner_name ?? "Unassigned"}</TableCell>
                    <TableCell><StatusBadge status={ticket.status} /></TableCell>
                    <TableCell><SlaBadge value={ticket.sla_state} /></TableCell>
                    <TableCell>{age(ticket.opened_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
              <CheckCircle2 className="size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No tickets match these filters</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Change a filter or include closed requests.
              </p>
            </CardContent>
          )}
        </Card>

        <aside className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border bg-card shadow-sm xl:block">
          <TicketDetail
            canWrite={canWrite}
            detail={detail}
            loading={detailLoading}
            onClose={closeDetail}
            onRefresh={refreshSelected}
            profiles={profiles}
          />
        </aside>
      </div>

      {selectedId && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-background xl:hidden">
          <TicketDetail
            canWrite={canWrite}
            detail={detail}
            loading={detailLoading}
            onClose={closeDetail}
            onRefresh={refreshSelected}
            profiles={profiles}
          />
        </div>
      )}
    </div>
  );
}

function TicketDetail({
  canWrite,
  detail,
  loading,
  onClose,
  onRefresh,
  profiles,
}: {
  canWrite: boolean;
  detail: SupportDetail | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  profiles: Option[];
}) {
  const [working, setWorking] = useState(false);
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  if (loading && !detail) {
    return (
      <div className="flex min-h-80 items-center justify-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Loading ticket…
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center px-8 text-center">
        <MessageSquareText className="size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">Open a support ticket</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a row to review its requester, SLA, and correspondence.
        </p>
      </div>
    );
  }
  const { ticket, comments } = detail;

  async function update(changes: Record<string, unknown>) {
    setWorking(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/support/tickets/${ticket.todo_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: ticket.version, ...changes }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to update ticket.");
      }
      await onRefresh();
    } catch (updateError) {
      setActionError(
        updateError instanceof Error ? updateError.message : "Unable to update ticket.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function postComment(event: React.FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    setWorking(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/support/tickets/${ticket.todo_id}/comments`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: comment }),
        },
      );
      if (!response.ok) throw new Error("Unable to post support comment.");
      setComment("");
      await onRefresh();
    } catch (commentError) {
      setActionError(
        commentError instanceof Error
          ? commentError.message
          : "Unable to post support comment.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <article>
      <header className="border-b p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-semibold text-primary">{ticket.issue_key}</p>
            <h2 className="mt-2 text-xl font-semibold">{ticket.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {ticket.client_name} · opened {formatDateTime(ticket.opened_at)}
            </p>
          </div>
          <Button aria-label="Close ticket detail" onClick={onClose} size="sm" variant="ghost">
            Close
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Select
            disabled={!canWrite || working}
            onValueChange={(value) => void update({ status: value })}
            value={ticket.status}
          >
            <SelectTrigger aria-label="Support status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">New</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="review">Waiting / review</SelectItem>
              <SelectItem value="done">Resolved</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select
            disabled={!canWrite || working}
            onValueChange={(value) => void update({ priority: value })}
            value={ticket.priority}
          >
            <SelectTrigger aria-label="Support priority"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select
            disabled={!canWrite || working}
            onValueChange={(value) =>
              void update({ ownerId: value === "unassigned" ? null : value })
            }
            value={ticket.assigned_to ?? "unassigned"}
          >
            <SelectTrigger aria-label="Support owner" className="col-span-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="space-y-6 p-5">
        {actionError && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}
        <section className="grid gap-4 text-sm sm:grid-cols-2">
          <Field label="Requester" value={ticket.requester_name ?? "Not provided"} />
          <Field label="Requester email" value={ticket.requester_email ?? "Not provided"} />
          <Field label="First response" value={slaTime(ticket.first_response_at, ticket.first_response_due_at)} />
          <Field label="Resolution target" value={slaTime(ticket.resolved_at, ticket.resolution_due_at)} />
          <Field label="Source status" value={ticket.source_status ?? ticket.status} />
          <Field label="Source" value={ticket.source_provider} />
        </section>
        <section>
          <h3 className="text-sm font-semibold">Request</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {ticket.description || "No additional description was provided."}
          </p>
        </section>
        <section className="border-t pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Correspondence</h3>
            <Badge variant="secondary">{comments.length}</Badge>
          </div>
          <div className="mt-4 space-y-4">
            {comments.map((item) => (
              <div className="rounded-lg border p-3" key={item.id}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium">
                    {item.author_name ??
                      (item.metadata?.direction === "inbound" ? ticket.requester_name : null) ??
                      "Accelo correspondence"}
                  </span>
                  <span className="text-muted-foreground">{formatDateTime(item.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.body}</p>
              </div>
            ))}
            {!comments.length && (
              <p className="text-sm text-muted-foreground">No correspondence imported yet.</p>
            )}
          </div>
          {canWrite && (
            <form className="mt-4 space-y-2" onSubmit={postComment}>
              <Textarea
                aria-label="Add internal support comment"
                onChange={(event) => setComment(event.target.value)}
                placeholder="Add an internal response or handoff note…"
                value={comment}
              />
              <Button disabled={working || !comment.trim()} size="sm">
                {working ? <LoaderCircle className="animate-spin" /> : <Send />}
                Add comment
              </Button>
            </form>
          )}
        </section>
      </div>
    </article>
  );
}

function Metric({
  alert = false,
  icon: Icon,
  label,
  value,
}: {
  alert?: boolean;
  icon: typeof Headphones;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <Icon className={cn("size-5 text-muted-foreground", alert && "text-destructive")} />
      </CardContent>
    </Card>
  );
}

function Filter({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>{name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1">{value}</p>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: SupportPriority }) {
  return priority === "medium" ? null : (
    <Badge variant={priority === "urgent" || priority === "high" ? "destructive" : "outline"}>
      {priority}
    </Badge>
  );
}

function StatusBadge({ status }: { status: SupportStatus }) {
  return (
    <Badge variant={status === "blocked" ? "destructive" : status === "done" ? "secondary" : "outline"}>
      {status === "todo" ? "New" : status.replaceAll("_", " ")}
    </Badge>
  );
}

function SlaBadge({ value }: { value: string }) {
  const danger = value.endsWith("_breached");
  return (
    <Badge variant={danger ? "destructive" : value.endsWith("_at_risk") ? "secondary" : "outline"}>
      {value.replaceAll("_", " ")}
    </Badge>
  );
}

function slaTime(actual?: string | null, due?: string | null) {
  if (actual) return `Met ${formatDateTime(actual)}`;
  if (due) return formatDateTime(due);
  return "No target";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function age(value: string) {
  const hours = Math.max(0, Date.now() - new Date(value).getTime()) / 3_600_000;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
