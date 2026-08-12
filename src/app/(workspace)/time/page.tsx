import { AlertCircle } from "lucide-react";

import { TimesheetWorkspace, type TimesheetEntry } from "@/components/time/timesheet-workspace";
import type { TimeEntryOption } from "@/components/time/time-entry-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Time" };

interface TimeRow {
  id: string;
  profile_id: string;
  client_id: string | null;
  project_id: string | null;
  todo_id: string | null;
  entry_date: string;
  minutes: number;
  description: string;
  billable: boolean;
  status: string;
  billing_rate_cents: number | null;
  currency: string | null;
  invoiced_at: string | null;
  rejection_reason: string | null;
  retainer_period_id: string | null;
  client: { name: string } | { name: string }[] | null;
  project: { name: string } | { name: string }[] | null;
  profile: { full_name: string } | { full_name: string }[] | null;
  issue:
    | { title: string; issue_number: number }
    | { title: string; issue_number: number }[]
    | null;
  retainer_period:
    | { retainer_id: string; retainer: { name: string } | { name: string }[] | null }
    | {
        retainer_id: string;
        retainer: { name: string } | { name: string }[] | null;
      }[]
    | null;
}

export default async function TimePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestedWeek = typeof query.week === "string" ? query.week : undefined;
  const weekStart = startOfWeek(requestedWeek);
  const weekEnd = shiftDate(weekStart, 6);
  const viewer = await getViewer();
  const canApprove = viewer?.capabilities.timeApprove ?? false;
  const supabase = await createClient();

  if (!supabase || !viewer) {
    return (
      <TimesheetWorkspace
        canApprove={false}
        clients={[]}
        entries={[]}
        issues={[]}
        pendingApprovals={[]}
        profiles={[]}
        projects={[]}
        retainers={[]}
        weekEnd={weekEnd}
        weekStart={weekStart}
      />
    );
  }

  const entriesQuery = supabase
    .from("time_entries")
    .select(
      "id,profile_id,client_id,project_id,todo_id,retainer_period_id,entry_date,minutes,description,billable,status,billing_rate_cents,currency,invoiced_at,rejection_reason,client:clients(name),project:projects(name),profile:profiles!time_entries_organization_id_profile_id_fkey(full_name),issue:todos(title,issue_number),retainer_period:retainer_periods(retainer_id,retainer:retainers(name))",
    )
    .gte("entry_date", weekStart)
    .lte("entry_date", weekEnd)
    .order("entry_date", { ascending: false });

  const [timeResult, clientsResult, projectsResult, retainersResult, issuesResult, profilesResult] = await Promise.all([
    entriesQuery,
    supabase.from("clients").select("id,name").eq("status", "active").order("name").limit(250),
    supabase.from("projects").select("id,name,client_id").order("name").limit(250),
    supabase.from("retainers").select("id,name,client_id").eq("status", "active").order("name").limit(250),
    supabase
      .from("todos")
      .select("id,title,issue_number,project_id")
      .not("status", "in", '("done","cancelled")')
      .order("issue_number")
      .limit(1_000),
    canApprove
      ? supabase
          .from("profiles")
          .select("id,full_name")
          .eq("organization_id", viewer.organization.id)
          .eq("status", "active")
          .order("full_name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const firstError =
    timeResult.error ??
    clientsResult.error ??
    projectsResult.error ??
    retainersResult.error ??
    issuesResult.error ??
    profilesResult.error;
  if (firstError) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Time</h1>
          <p className="mt-2 text-muted-foreground">Weekly time and approvals.</p>
        </header>
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Timesheet unavailable</AlertTitle>
          <AlertDescription>
            We could not load time data. Refresh the page or try again shortly.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const rows = (timeResult.data ?? []) as unknown as TimeRow[];
  const mapped = rows.map(mapTimeRow);
  return (
    <TimesheetWorkspace
      canApprove={canApprove}
      clients={(clientsResult.data ?? []) as TimeEntryOption[]}
      entries={mapped.filter((entry) => entry.profileId === viewer.profile.id)}
      issues={(issuesResult.data ?? []).map((issue) => ({
        id: issue.id,
        name: `#${issue.issue_number} ${issue.title}`,
        projectId: issue.project_id,
      }))}
      pendingApprovals={
        canApprove
          ? mapped.filter((entry) => entry.profileId !== viewer.profile.id)
          : []
      }
      profiles={(profilesResult.data ?? []).map((profile) => ({
        id: profile.id,
        name: profile.full_name,
      }))}
      projects={(projectsResult.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        clientId: project.client_id,
      }))}
      retainers={(retainersResult.data ?? []).map((retainer) => ({
        id: retainer.id,
        name: retainer.name,
        clientId: retainer.client_id,
      }))}
      weekEnd={weekEnd}
      weekStart={weekStart}
    />
  );
}

function mapTimeRow(row: TimeRow): TimesheetEntry & { profileId: string } {
  const period = relation(row.retainer_period);
  return {
    id: row.id,
    profileId: row.profile_id,
    clientId: row.client_id,
    projectId: row.project_id,
    todoId: row.todo_id,
    retainerId: period?.retainer_id ?? null,
    entryDate: row.entry_date,
    durationMinutes: row.minutes,
    description: row.description,
    billable: row.billable,
    status: row.status,
    rejectionReason: row.rejection_reason,
    billRate: row.billing_rate_cents === null ? null : row.billing_rate_cents / 100,
    currency: row.currency ?? "USD",
    clientName: relation(row.client)?.name ?? "No client",
    projectName: relation(row.project)?.name ?? "General",
    issueName: relation(row.issue)
      ? `#${relation(row.issue)?.issue_number} ${relation(row.issue)?.title}`
      : null,
    retainerName: relation(period?.retainer ?? null)?.name ?? null,
    profileName: relation(row.profile)?.full_name ?? "Team member",
  };
}

function relation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] : value;
}

function startOfWeek(value?: string) {
  const candidate =
    value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date();
  if (Number.isNaN(candidate.getTime())) return startOfWeek();
  const day = candidate.getDay();
  candidate.setDate(candidate.getDate() - (day === 0 ? 6 : day - 1));
  return candidate.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
