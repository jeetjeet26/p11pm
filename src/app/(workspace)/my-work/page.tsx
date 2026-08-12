import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  Timer,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOperationalTodos } from "@/lib/attention-data";
import { getMyWorkData } from "@/lib/data";
import type { Todo } from "@/lib/types";
import { estimatedMinutes, isDueSoon, isOverdue } from "@/lib/workload";

export const metadata = { title: "My assignments" };

export default async function MyWorkPage() {
  const [data, operationalTodos] = await Promise.all([
    getMyWorkData(),
    getOperationalTodos({ assignedToViewer: true, limit: 500 }),
  ]);
  const assignments = (operationalTodos ?? data.todos)
    .filter(
      (todo) =>
        !["completed", "cancelled"].includes(todo.status) &&
        operationalState(todo) !== "historical",
    )
    .sort((left, right) => attentionScore(right) - attentionScore(left));
  const estimates = assignments
    .map(estimatedMinutes)
    .filter((minutes): minutes is number => minutes !== undefined);

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">My assignments</h1>
        <p className="mt-2 text-muted-foreground">
          Your current work across every project, ordered by delivery risk.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Open" value={assignments.length} />
        <Metric
          label="Due this week"
          value={assignments.filter((todo) => isDueSoon(todo)).length}
        />
        <Metric label="Blocked" value={assignments.filter((todo) => todo.status === "blocked").length} />
        <Metric
          label={estimates.length ? "Estimated workload" : "Needs estimates"}
          value={
            estimates.length
              ? `${Math.round(estimates.reduce((sum, minutes) => sum + minutes, 0) / 60)}h`
              : assignments.length
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your work queue</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {assignments.map((todo) => {
            const project = data.projects.find((item) => item.id === todo.projectId);
            const overdue = isOverdue(todo);
            const estimate = estimatedMinutes(todo);
            return (
              <div className="group relative flex items-start gap-4 px-5 py-4 transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring hover:bg-muted/40" key={todo.id}>
                <Link
                  aria-label={`Open ${todo.title}`}
                  className="absolute inset-0"
                  href={`/projects/${todo.projectId}/issues/${todo.id}`}
                />
                {todo.status === "blocked" ? (
                  <AlertTriangle className="relative mt-0.5 size-4 text-destructive" />
                ) : todo.status === "in_progress" || todo.status === "review" ? (
                  <CheckCircle2 className="relative mt-0.5 size-4 text-primary" />
                ) : (
                  <Circle className="relative mt-0.5 size-4 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="pointer-events-none relative text-sm font-medium">
                    <span className="mr-2 font-mono text-[10px] font-semibold text-primary">
                      {issueKey(todo)}
                    </span>
                    {todo.title}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge className="pointer-events-none relative" variant="secondary">{project?.name}</Badge>
                    {todo.dueDate && <span className={overdue ? "pointer-events-none relative font-medium text-destructive" : "pointer-events-none relative"}><CalendarDays className="mr-1 inline size-3" />{overdue ? `${overdueDays(todo)}d overdue` : formatDate(todo.dueDate)}</span>}
                    {estimate !== undefined && <span className="pointer-events-none relative"><Timer className="mr-1 inline size-3" />{formatMinutes(estimate)}</span>}
                    {isStale(todo) && <Badge className="pointer-events-none relative" variant="outline"><Clock3 className="mr-1 size-3" />Stale</Badge>}
                    {operationalState(todo) === "triage" && <Badge className="pointer-events-none relative" variant="outline">Needs triage</Badge>}
                    {todo.status === "blocked" && <Badge className="pointer-events-none relative" variant="destructive">Blocked</Badge>}
                  </div>
                </div>
                <Link
                  aria-label={`Open ${todo.title}`}
                  className="relative"
                  href={`/projects/${todo.projectId}/issues/${todo.id}`}
                >
                  <ExternalLink className="size-4 text-muted-foreground" />
                </Link>
              </div>
            );
          })}
          {!assignments.length && <div className="p-12 text-center"><CheckCircle2 className="mx-auto size-9 text-emerald-600" /><p className="mt-3 font-medium">You’re caught up.</p><p className="mt-1 text-sm text-muted-foreground">No open assignments match your account.</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></CardContent></Card>;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function operationalState(todo: Todo) {
  return "operationalState" in todo &&
    typeof (todo as Todo & { operationalState?: unknown }).operationalState ===
      "string"
    ? (todo as Todo & { operationalState: string }).operationalState
    : "active";
}

function issueKey(todo: Todo) {
  return "issueKey" in todo &&
    typeof (todo as Todo & { issueKey?: unknown }).issueKey === "string"
    ? (todo as Todo & { issueKey: string }).issueKey
    : todo.id.slice(0, 8).toUpperCase();
}

function isStale(todo: Todo) {
  return Date.now() - new Date(todo.updatedAt).getTime() > 30 * 86_400_000;
}

function overdueDays(todo: Todo) {
  if (!todo.dueDate) return 0;
  return Math.max(
    1,
    Math.floor(
      (Date.now() - new Date(`${todo.dueDate}T23:59:59`).getTime()) /
        86_400_000,
    ),
  );
}

function attentionScore(todo: Todo) {
  return (
    (todo.status === "blocked" ? 100 : 0) +
    (isOverdue(todo) ? 50 + overdueDays(todo) : 0) +
    (isDueSoon(todo) ? 20 : 0) +
    (isStale(todo) ? 10 : 0) +
    (String(todo.priority) === "urgent"
      ? 40
      : String(todo.priority) === "high"
        ? 20
        : 0)
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
