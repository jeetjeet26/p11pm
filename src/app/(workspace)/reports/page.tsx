import {
  Activity,
  AlertTriangle,
  Banknote,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Clock3,
  Gauge,
  Repeat2,
  ShieldAlert,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCommercialOperationsReport,
  getCommercialSnapshot,
} from "@/lib/commercial-reports";
import { getDeliveryReport } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Delivery reports" };

export default async function ReportsPage({
  searchParams,
}: PageProps<"/reports">) {
  const query = await searchParams;
  const projectId =
    typeof query.project === "string" ? query.project : undefined;
  const requestedDays = Number(
    typeof query.days === "string" ? query.days : "90",
  );
  const days = [30, 90, 180, 365].includes(requestedDays) ? requestedDays : 90;
  const client = await createClient();
  const [report, projects, commercial, operations] = await Promise.all([
    getDeliveryReport({ days, projectId }),
    client
      ? client
          .from("projects")
          .select("id,name,code")
          .eq("is_read_only", false)
          .order("name")
          .limit(500)
      : Promise.resolve({ data: [] }),
    getCommercialSnapshot(),
    getCommercialOperationsReport({ days, projectId }),
  ]);
  const maxThroughput = Math.max(
    1,
    ...report.weeklyThroughput.map((week) => week.count),
  );

  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Delivery signals</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Reports
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Throughput and cycle time use recorded status transitions only.
            Imported timestamps are not treated as invented delivery history.
          </p>
        </div>
        {report.capturedSince && (
          <Badge variant="secondary">
            Capturing since {formatDate(report.capturedSince)}
          </Badge>
        )}
      </header>

      <form
        className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
        method="get"
      >
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Project
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
            defaultValue={projectId ?? ""}
            name="project"
          >
            <option value="">All accessible projects</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.code ? `${project.code} · ` : ""}
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reporting window
          <select
            className="h-9 rounded-md border bg-background px-3 text-sm text-foreground"
            defaultValue={String(days)}
            name="days"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">365 days</option>
          </select>
        </label>
        <Button className="self-end">Apply filters</Button>
      </form>

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <a href={`/api/reports/export?kind=operations&days=${days}${projectId ? `&project=${projectId}` : ""}`}>
            Export operations CSV
          </a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={`/api/reports/export?kind=delivery&days=${days}${projectId ? `&project=${projectId}` : ""}`}>
            Export delivery CSV
          </a>
        </Button>
      </div>

      {!report.capturedSince && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-5">
            <Activity className="mt-0.5 size-5 text-primary" />
            <div>
              <p className="font-medium">Trustworthy reporting starts now</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Status transition capture is enabled. Cycle-time and throughput
                trends will populate as active issues move through the workflow.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <ReportMetric
          icon={TrendingUp}
          label="Weekly throughput"
          value={report.throughputLast7Days}
        />
        <ReportMetric
          icon={Clock3}
          label="Median cycle time"
          value={
            report.medianCycleHours === undefined
              ? "Collecting"
              : formatDuration(report.medianCycleHours)
          }
        />
        <ReportMetric
          icon={Gauge}
          label="Work in progress"
          value={report.workInProgress}
        />
        <ReportMetric
          alert={report.blockedCount > 0}
          icon={ShieldAlert}
          label="Blocked"
          value={report.blockedCount}
        />
        <ReportMetric
          alert={report.overdueCount > 0}
          icon={AlertTriangle}
          label="Overdue"
          value={report.overdueCount}
        />
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">
            Commercial health
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Current CRM, retainer, utilization, and receivables snapshot.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ReportMetric
            icon={Building2}
            label="Active clients"
            value={commercial.activeClients}
          />
          <ReportMetric
            icon={Repeat2}
            label="Active retainers"
            value={`${commercial.activeRetainers} · ${commercial.retainerBurnPercent}% burn`}
          />
          <ReportMetric
            icon={Gauge}
            label="Approved unbilled"
            value={formatMoney(commercial.unbilledValue)}
          />
          <ReportMetric
            icon={Banknote}
            label="Outstanding"
            value={formatMoney(commercial.outstandingBalance)}
          />
          <ReportMetric
            icon={Banknote}
            label="Cash this month"
            value={formatMoney(commercial.cashCollectedThisMonth)}
          />
          <ReportMetric
            icon={TrendingUp}
            label="Gross margin"
            value={
              commercial.grossMarginPercent === undefined
                ? "Collecting"
                : `${commercial.grossMarginPercent}%`
            }
          />
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold tracking-tight">
            Operating outlook
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bounded live views of time, pipeline, contracts, receivables, and
            weekly capacity.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <ReportMetric
            icon={Gauge}
            label="Utilization"
            value={
              !operations.available
                ? "Unavailable"
                : operations.utilization.percent === undefined
                ? "Collecting"
                : `${operations.utilization.percent}%`
            }
          />
          <ReportMetric
            alert={operations.unapprovedTime.entries > 0}
            icon={Clock3}
            label="Unapproved time"
            value={
              operations.available
                ? `${formatHours(operations.unapprovedTime.minutes)} · ${formatMoney(operations.unapprovedTime.value)}`
                : "Unavailable"
            }
          />
          <ReportMetric
            icon={BriefcaseBusiness}
            label={`Pipeline · ${operations.pipeline.prospectClients} open`}
            value={
              operations.available
                ? `${formatMoney(operations.pipeline.weightedValue)} weighted`
                : "Unavailable"
            }
          />
          <ReportMetric
            alert={
              operations.renewals[0] !== undefined &&
              operations.renewals[0].daysRemaining <= 30
            }
            icon={CalendarClock}
            label="Renewals (180d)"
            value={operations.available ? operations.renewals.length : "Unavailable"}
          />
          <ReportMetric
            alert={operations.accountsReceivable.open > 0}
            icon={Banknote}
            label="Open receivables"
            value={
              operations.available && operations.accountsReceivable.available
                ? formatMoney(operations.accountsReceivable.open)
                : "Unavailable"
            }
          />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Job margin</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {operations.jobMargins.map((job) => (
              <div
                className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_100px_110px_80px] sm:items-center"
                key={job.projectId}
              >
                <div className="min-w-0">
                  <Button asChild className="h-auto max-w-full justify-start p-0" variant="link">
                    <Link className="truncate" href={`/projects/${job.projectId}`}>
                      {job.projectName}
                    </Link>
                  </Button>
                  <p className="truncate text-xs text-muted-foreground">
                    {job.clientName}
                  </p>
                </div>
                <HealthValue
                  label="Billed"
                  value={formatMoney(job.billedValue)}
                />
                <HealthValue
                  label="Unbilled"
                  value={formatMoney(job.unbilledValue)}
                />
                <HealthValue
                  alert={
                    job.grossMarginPercent !== undefined &&
                    job.grossMarginPercent < 30
                  }
                  label="Margin"
                  value={
                    job.grossMarginPercent === undefined
                      ? "—"
                      : `${job.grossMarginPercent}%`
                  }
                />
              </div>
            ))}
            {!operations.jobMargins.length && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Margin detail is available to managers when jobs have financial
                activity.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accounts receivable aging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {operations.accountsReceivable.available ? (
              operations.accountsReceivable.buckets.map((bucket) => (
              <div key={bucket.label}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{bucket.label}</span>
                  <span className="font-semibold">{formatMoney(bucket.value)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${operations.accountsReceivable.open ? Math.max(1, (bucket.value / operations.accountsReceivable.open) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Receivables aging is available to managers when operational
                database access is configured.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contract renewals</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {operations.renewals.slice(0, 8).map((renewal) => (
              <div className="flex items-center justify-between gap-4 px-5 py-3" key={renewal.id}>
                <div className="min-w-0">
                  <Button asChild className="h-auto max-w-full justify-start p-0" variant="link">
                    <Link className="truncate" href={`/retainers/${renewal.id}`}>
                      {renewal.name}
                    </Link>
                  </Button>
                  <p className="truncate text-xs text-muted-foreground">
                    {renewal.clientName} · {formatMoney(renewal.value)}
                  </p>
                </div>
                <Badge variant={renewal.daysRemaining <= 30 ? "destructive" : "secondary"}>
                  {renewal.daysRemaining}d
                </Badge>
              </div>
            ))}
            {!operations.renewals.length && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                No active contracts end in the next 180 days.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />
              Weekly capacity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {operations.capacity.map((person) => (
              <div key={person.profileId}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{person.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatHours(person.scheduledMinutes)} /{" "}
                    {formatHours(person.capacityMinutes)} ·{" "}
                    {person.utilizationPercent}%
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      person.utilizationPercent > 100
                        ? "h-full rounded-full bg-destructive"
                        : "h-full rounded-full bg-primary"
                    }
                    style={{
                      width: `${Math.min(person.utilizationPercent, 100)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {!operations.capacity.length && (
              <p className="text-sm text-muted-foreground">
                No staff capacity records are available.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weekly throughput</CardTitle>
          </CardHeader>
          <CardContent>
            {report.weeklyThroughput.length ? (
              <div className="flex h-64 items-end gap-2">
                {report.weeklyThroughput.map((week) => (
                  <div
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                    key={week.week}
                  >
                    <span className="mb-1 text-center text-[10px] font-medium">
                      {week.count || ""}
                    </span>
                    <div
                      aria-label={`${week.count} issues completed during week of ${week.week}`}
                      className="min-h-1 rounded-t bg-primary"
                      style={{
                        height: `${Math.max(2, (week.count / maxThroughput) * 85)}%`,
                      }}
                    />
                    <span className="mt-2 truncate text-center text-[9px] text-muted-foreground">
                      {formatShortDate(week.week)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyReportState />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overdue aging</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.overdueAgeBuckets.map((bucket) => (
              <div key={bucket.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{bucket.label}</span>
                  <span className="font-semibold">{bucket.count}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive"
                    style={{
                      width: `${report.overdueCount ? (bucket.count / report.overdueCount) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted-foreground">
              Current age distribution only; no synthetic historical snapshots.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project health</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {report.projectHealth.map((project) => (
            <div
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_repeat(4,100px)] sm:items-center"
              key={project.projectId}
            >
              <Button asChild className="h-auto justify-start p-0" variant="link">
                <Link href={`/projects/${project.projectId}`}>
                  {project.projectName}
                </Link>
              </Button>
              <HealthValue label="Active" value={project.active} />
              <HealthValue
                alert={project.blocked > 0}
                label="Blocked"
                value={project.blocked}
              />
              <HealthValue
                alert={project.overdue > 0}
                label="Overdue"
                value={project.overdue}
              />
              <HealthValue
                label="Estimate"
                value={
                  project.estimatedMinutes
                    ? `${Math.round(project.estimatedMinutes / 60)}h`
                    : "—"
                }
              />
            </div>
          ))}
          {!report.projectHealth.length && (
            <div className="p-10">
              <EmptyReportState />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportMetric({
  alert = false,
  icon: Icon,
  label,
  value,
}: {
  alert?: boolean;
  icon: typeof Activity;
  label: string;
  value: number | string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
        </div>
        <div
          className={
            alert
              ? "grid size-9 place-items-center rounded-lg bg-destructive/10 text-destructive"
              : "grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"
          }
        >
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function HealthValue({
  alert = false,
  label,
  value,
}: {
  alert?: boolean;
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground sm:hidden">
        {label}
      </p>
      <p className={alert ? "font-semibold text-destructive" : "font-medium"}>
        {value}
      </p>
    </div>
  );
}

function EmptyReportState() {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center text-center">
      <Activity className="size-7 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">No transition data yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Move an active issue through the workflow to begin the series.
      </p>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(hours: number) {
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${(hours / 24).toFixed(hours < 240 ? 1 : 0)}d`;
}

function formatHours(minutes: number) {
  return `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)}h`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
