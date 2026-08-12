import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Gauge,
  Repeat2,
} from "lucide-react";
import Link from "next/link";

import { ProjectCard } from "@/components/projects/project-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getViewer } from "@/lib/auth/viewer";
import { getCommercialSnapshot } from "@/lib/commercial-reports";
import { getDashboardData } from "@/lib/data";
import { getDeliveryReport } from "@/lib/reports";

export const metadata = { title: "Home" };

const P11_TIME_ZONE = "America/Los_Angeles";

async function getGreetingName(): Promise<string> {
  const viewer = await getViewer();
  const fullName =
    viewer?.profile.fullName || viewer?.user.email || "team";
  return fullName.trim().split(/\s+/)[0] || "team";
}

export default async function DashboardPage() {
  const [data, greetingName, delivery, commercial] = await Promise.all([
    getDashboardData(),
    getGreetingName(),
    getDeliveryReport(),
    getCommercialSnapshot(),
  ]);
  const now = new Date();
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: P11_TIME_ZONE,
    }).format(now),
  );
  const greeting =
    localHour < 12 ? "Good morning" : localHour < 17 ? "Good afternoon" : "Good evening";
  const displayDate = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: P11_TIME_ZONE,
    weekday: "long",
  }).format(now);
  const activeProjects = data.projects;
  const currentIssueCount = delivery.available
    ? delivery.projectHealth.reduce(
        (total, project) => total + project.active,
        0,
      )
    : data.metrics.openTodoCount;

  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">{displayDate}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            {greeting}, {greetingName}.
          </h1>
          <p className="mt-2 text-muted-foreground">
            Here’s what needs attention across P11’s active work.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/team">
            Open team view
            <ArrowRight />
          </Link>
        </Button>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Active projects",
            value: data.metrics.activeProjectCount,
            detail: `${data.metrics.projectTotal} total`,
            icon: FolderKanban,
          },
          {
            label: "Current issues",
            value: currentIssueCount,
            detail: delivery.available
              ? "Active work; triage/history excluded"
              : "Across the whole team",
            icon: CheckCircle2,
          },
          {
            label: "Overdue",
            value: delivery.available
              ? delivery.overdueCount
              : data.metrics.overdueTodoCount,
            detail: (delivery.available
              ? delivery.overdueCount
              : data.metrics.overdueTodoCount)
              ? "Needs follow-up"
              : "Everything on track",
            icon: Clock3,
            alert:
              (delivery.available
                ? delivery.overdueCount
                : data.metrics.overdueTodoCount) > 0,
          },
          {
            label: "Blocked",
            value: delivery.available
              ? delivery.blockedCount
              : data.metrics.blockedTodoCount,
            detail: "Waiting on decisions or access",
            icon: AlertTriangle,
            alert:
              (delivery.available
                ? delivery.blockedCount
                : data.metrics.blockedTodoCount) > 0,
          },
        ].map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-start justify-between p-5">
              <div>
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight">{metric.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
              </div>
              <div className={`grid size-9 place-items-center rounded-lg ${metric.alert ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
                <metric.icon className="size-4" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              Agency operations
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Client, retainer, billing, and cash signals.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/billing">Open billing</Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[
            {
              label: "Active clients",
              value: commercial.activeClients.toLocaleString(),
              detail: "Current client relationships",
              icon: Building2,
            },
            {
              label: "Active retainers",
              value: commercial.activeRetainers.toLocaleString(),
              detail: `${commercial.retainerBurnPercent}% allowance burn`,
              icon: Repeat2,
            },
            {
              label: "Approved unbilled",
              value: formatMoney(commercial.unbilledValue),
              detail: "Ready for invoice preparation",
              icon: Gauge,
            },
            {
              label: "Outstanding",
              value: formatMoney(commercial.outstandingBalance),
              detail: "Open receivables",
              icon: Banknote,
            },
            {
              label: "Cash this month",
              value: formatMoney(commercial.cashCollectedThisMonth),
              detail: "Recorded payments",
              icon: Banknote,
            },
            {
              label: "Gross margin",
              value:
                commercial.grossMarginPercent === undefined
                  ? "—"
                  : `${commercial.grossMarginPercent}%`,
              detail: "Logged labor at snapshot rates",
              icon: Gauge,
            },
          ].map((metric) => (
            <Card key={metric.label}>
              <CardContent className="flex items-start justify-between p-5">
                <div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{metric.value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {metric.detail}
                  </p>
                </div>
                <metric.icon className="size-4 text-primary" />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Active projects</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Current client work, assignments, and delivery status.
              </p>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/projects">View all</Link>
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {activeProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Latest activity</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/activity">All</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-5">
            {data.activity.slice(0, 5).map((event) => {
              return (
                <div className="flex gap-3" key={event.id}>
                  <Avatar className="size-8">
                    <AvatarFallback className="text-[11px]">{event.actorInitials}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 text-sm">
                    <p>
                      <span className="font-medium">{event.actorName}</span>{" "}
                      <span className="text-muted-foreground">{event.verb}</span>{" "}
                      {activityHref(event) ? (
                        <Link
                          className="font-medium text-primary hover:underline"
                          href={activityHref(event)!}
                        >
                          {event.object}
                        </Link>
                      ) : (
                        <span className="font-medium">{event.object}</span>
                      )}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge className="max-w-36 truncate" variant="secondary">
                        {event.projectName}
                      </Badge>
                      <span>{new Date(event.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function activityHref(event: {
  projectId: string;
  entityType?: string;
  entityId?: string;
}) {
  return event.entityId &&
    (event.entityType === "todo" || event.entityType === "todos")
    ? `/projects/${event.projectId}/issues/${event.entityId}`
    : undefined;
}
