import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FolderKanban,
} from "lucide-react";
import Link from "next/link";

import { ProjectCard } from "@/components/projects/project-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardData } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Home" };

const P11_TIME_ZONE = "America/Los_Angeles";

async function getGreetingName(): Promise<string> {
  const supabase = await createClient();
  if (!supabase) return "team";
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "team";
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const fullName =
    profile?.full_name ||
    (typeof user.user_metadata.full_name === "string"
      ? user.user_metadata.full_name
      : "") ||
    user.email ||
    "team";
  return fullName.trim().split(/\s+/)[0] || "team";
}

export default async function DashboardPage() {
  const [data, greetingName] = await Promise.all([
    getDashboardData(),
    getGreetingName(),
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
            label: "Open assignments",
            value: data.metrics.openTodoCount,
            detail: "Across the whole team",
            icon: CheckCircle2,
          },
          {
            label: "Overdue",
            value: data.metrics.overdueTodoCount,
            detail: data.metrics.overdueTodoCount ? "Needs follow-up" : "Everything on track",
            icon: Clock3,
            alert: data.metrics.overdueTodoCount > 0,
          },
          {
            label: "Blocked",
            value: data.metrics.blockedTodoCount,
            detail: "Waiting on decisions or access",
            icon: AlertTriangle,
            alert: data.metrics.blockedTodoCount > 0,
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
                      <span className="font-medium">{event.object}</span>
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
