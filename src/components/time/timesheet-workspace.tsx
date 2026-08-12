"use client";

import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Download,
  LoaderCircle,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
import {
  EditableTimeEntry,
  TimeEntryDialog,
  type TimeEntryOption,
} from "@/components/time/time-entry-dialog";
import { TimeTracker } from "@/components/time/time-tracker";

export interface TimesheetEntry extends EditableTimeEntry {
  billRate: number | null;
  clientName: string;
  currency: string;
  profileId: string;
  profileName: string;
  projectName: string;
  retainerName: string | null;
  issueName: string | null;
  status: string;
  rejectionReason?: string | null;
}

interface TimesheetWorkspaceProps {
  canApprove: boolean;
  clients: TimeEntryOption[];
  entries: TimesheetEntry[];
  pendingApprovals: TimesheetEntry[];
  issues: TimeEntryOption[];
  profiles: TimeEntryOption[];
  projects: TimeEntryOption[];
  retainers: TimeEntryOption[];
  weekEnd: string;
  weekStart: string;
}

export function TimesheetWorkspace({
  canApprove,
  clients,
  entries,
  pendingApprovals,
  issues,
  profiles,
  projects,
  retainers,
  weekEnd,
  weekStart,
}: TimesheetWorkspaceProps) {
  const router = useRouter();
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managerProject, setManagerProject] = useState("all");
  const [managerProfile, setManagerProfile] = useState("all");
  const [managerStatus, setManagerStatus] = useState("submitted");
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const billableMinutes = entries.reduce(
    (sum, entry) => sum + (entry.billable ? entry.durationMinutes : 0),
    0,
  );
  const draftEntries = entries.filter((entry) => entry.status === "draft");
  const targetMinutes = 40 * 60;
  const managerEntries = pendingApprovals.filter(
    (entry) =>
      (managerProject === "all" || entry.projectId === managerProject) &&
      (managerProfile === "all" || entry.profileId === managerProfile) &&
      (managerStatus === "all" || entry.status === managerStatus),
  );
  const actionableEntries = managerEntries.filter(
    (entry) => entry.status === "submitted",
  );
  const exportParams = new URLSearchParams({
    format: "csv",
    from: weekStart,
    to: weekEnd,
  });
  if (managerProject !== "all") exportParams.set("projectId", managerProject);
  if (managerProfile !== "all") exportParams.set("profileId", managerProfile);
  if (managerStatus !== "all") exportParams.set("status", managerStatus);

  async function updateStatus(ids: string[], status: string) {
    const rejectionReason =
      status === "rejected"
        ? window.prompt("Why is this time being returned?")
        : null;
    if (status === "rejected" && !rejectionReason?.trim()) return;
    setWorkingId(
      ids.length === 1
        ? ids[0]
        : status === "submitted"
          ? "week"
          : "approval-queue",
    );
    setError(null);
    try {
      if (status === "approved" || status === "rejected") {
        const response = await fetch("/api/time-entries", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ids,
            status,
            rejectionReason: rejectionReason?.trim() || undefined,
          }),
        });
        const result = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? `Unable to mark time as ${status}.`);
        }
      } else {
        await Promise.all(ids.map(async (id) => {
          const response = await fetch(`/api/time-entries?id=${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, status }),
          });
          const result = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          if (!response.ok) {
            throw new Error(result.error ?? `Unable to mark time as ${status}.`);
          }
        }));
      }
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to update time entries.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Time</h1>
          <p className="mt-2 text-muted-foreground">
            Your weekly ledger for delivery, utilization, and billing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="icon" variant="outline">
            <Link aria-label="Previous week" href={`/time?week=${shiftDate(weekStart, -7)}`}>
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-44 text-center text-sm font-medium">
            {formatWeek(weekStart, weekEnd)}
          </div>
          <Button asChild size="icon" variant="outline">
            <Link aria-label="Next week" href={`/time?week=${shiftDate(weekStart, 7)}`}>
              <ArrowRight />
            </Link>
          </Button>
          <TimeEntryDialog clients={clients} issues={issues} projects={projects} retainers={retainers} />
        </div>
      </div>

      <TimeTracker issues={issues} projects={projects} />

      {error ? (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total logged" value={formatDuration(totalMinutes)}>
          <Progress
            aria-label={`${Math.round((totalMinutes / targetMinutes) * 100)}% of weekly target`}
            className="mt-3"
            value={Math.min(100, (totalMinutes / targetMinutes) * 100)}
          />
        </MetricCard>
        <MetricCard label="Billable" value={formatDuration(billableMinutes)}>
          <p className="mt-2 text-xs text-muted-foreground">
            {totalMinutes ? Math.round((billableMinutes / totalMinutes) * 100) : 0}% utilization
          </p>
        </MetricCard>
        <MetricCard label="Ready to submit" value={`${draftEntries.length} entries`}>
          <Button
            className="mt-3"
            disabled={!draftEntries.length || workingId === "week"}
            onClick={() => updateStatus(draftEntries.map((entry) => entry.id), "submitted")}
            size="sm"
            variant="outline"
          >
            {workingId === "week" ? <LoaderCircle className="animate-spin" /> : <Send />}
            Submit week
          </Button>
        </MetricCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My timesheet</CardTitle>
          <CardDescription>Entries from Monday through Sunday.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Work</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                  <TableHead><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="pl-4 text-muted-foreground">
                      {formatDay(entry.entryDate)}
                    </TableCell>
                    <TableCell className="max-w-72 whitespace-normal">
                      <p className="font-medium">{entry.description}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{entry.clientName}</p>
                    </TableCell>
                    <TableCell>
                      <p>{entry.projectName}</p>
                      {entry.issueName ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{entry.issueName}</p>
                      ) : null}
                      {entry.retainerName ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {entry.retainerName}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell><StatusBadge status={entry.status} /></TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatDuration(entry.durationMinutes)}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {entry.status === "draft" || entry.status === "rejected" ? (
                        <TimeEntryDialog
                          clients={clients}
                          entry={entry}
                          issues={issues}
                          projects={projects}
                          retainers={retainers}
                        />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyTimesheet />
          )}
        </CardContent>
      </Card>

      {canApprove ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Manager approvals</CardTitle>
              <CardDescription>
                Review submitted time before it enters billing.
              </CardDescription>
            </div>
            {actionableEntries.length ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  disabled={workingId === "approval-queue"}
                  onClick={() =>
                    updateStatus(
                      actionableEntries.map((entry) => entry.id),
                      "rejected",
                    )
                  }
                  size="sm"
                  variant="outline"
                >
                  <X /> Return all
                </Button>
                <Button
                  disabled={workingId === "approval-queue"}
                  onClick={() =>
                    updateStatus(
                      actionableEntries.map((entry) => entry.id),
                      "approved",
                    )
                  }
                  size="sm"
                >
                  {workingId === "approval-queue" ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Approve all
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <Select onValueChange={setManagerProject} value={managerProject}>
                <SelectTrigger aria-label="Filter approvals by project"><SelectValue placeholder="All projects" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select onValueChange={setManagerProfile} value={managerProfile}>
                <SelectTrigger aria-label="Filter approvals by person"><SelectValue placeholder="All people" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All people</SelectItem>
                  {profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select onValueChange={setManagerStatus} value={managerStatus}>
                <SelectTrigger aria-label="Filter approvals by status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {["draft", "submitted", "approved", "rejected", "invoiced"].map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button asChild variant="outline">
                <a href={`/api/time-entries?${exportParams}`}><Download />Export CSV</a>
              </Button>
            </div>
            {managerEntries.length ? managerEntries.map((entry) => (
              <div
                className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center"
                key={entry.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{entry.profileName}</p>
                    <Badge variant="secondary">{formatDuration(entry.durationMinutes)}</Badge>
                    {entry.billable ? <Badge variant="outline">Billable</Badge> : null}
                  </div>
                  <p className="mt-1 truncate text-sm">{entry.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.clientName} · {entry.projectName} · {formatDay(entry.entryDate)}
                  </p>
                  {entry.rejectionReason ? (
                    <p className="mt-1 text-xs text-destructive">
                      Returned: {entry.rejectionReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {entry.status === "submitted" ? <Button
                    disabled={workingId === entry.id}
                    onClick={() => updateStatus([entry.id], "rejected")}
                    size="sm"
                    variant="outline"
                  >
                    <X /> Return
                  </Button> : null}
                  {entry.status === "submitted" ? <Button
                    disabled={workingId === entry.id}
                    onClick={() => updateStatus([entry.id], "approved")}
                    size="sm"
                  >
                    {workingId === entry.id ? <LoaderCircle className="animate-spin" /> : <Check />}
                    Approve
                  </Button> : null}
                </div>
              </div>
            )) : (
              <div className="grid min-h-36 place-items-center text-center">
                <div>
                  <Check className="mx-auto mb-2 size-6 text-muted-foreground" />
                  <p className="font-medium">Approval queue is clear</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Submitted time will appear here.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetricCard({
  children,
  label,
  value,
}: {
  children: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        {children}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "rejected" ? "destructive" :
    status === "draft" ? "outline" :
    status === "approved" || status === "invoiced" ? "default" : "secondary";
  return <Badge className="capitalize" variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

function EmptyTimesheet() {
  return (
    <div className="grid min-h-56 place-items-center px-6 text-center">
      <div>
        <div className="mx-auto grid size-10 place-items-center rounded-full bg-muted">
          <Clock3 className="size-5 text-muted-foreground" />
        </div>
        <p className="mt-3 font-medium">No time logged this week</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add an entry to keep utilization and billing current.
        </p>
      </div>
    </div>
  );
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatDay(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatWeek(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  return `${startDate.toLocaleDateString([], { month: "short", day: "numeric" })} – ${endDate.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
