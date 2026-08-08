import { CalendarDays, CheckCircle2, Circle, ExternalLink } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMyWorkData } from "@/lib/data";

export const metadata = { title: "My assignments" };

export default async function MyWorkPage() {
  const data = await getMyWorkData();
  const assignments = data.todos;

  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">My assignments</h1>
        <p className="mt-2 text-muted-foreground">
          Your open work across every project, sorted by due date.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="Open" value={assignments.length} />
        <Metric label="Due this week" value={assignments.filter(isDueSoon).length} />
        <Metric label="Blocked" value={assignments.filter((todo) => todo.status === "blocked").length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your work queue</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {assignments.map((todo) => {
            const project = data.projects.find((item) => item.id === todo.projectId);
            const overdue = Boolean(todo.dueDate && new Date(`${todo.dueDate}T23:59:59`) < new Date());
            return (
              <div className="flex items-start gap-4 px-5 py-4" key={todo.id}>
                {todo.status === "in_progress" ? <CheckCircle2 className="mt-0.5 size-4 text-primary" /> : <Circle className="mt-0.5 size-4 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <Link className="text-sm font-medium hover:text-primary" href={`/projects/${todo.projectId}`}>{todo.title}</Link>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">{project?.name}</Badge>
                    {todo.dueDate && <span className={overdue ? "font-medium text-destructive" : ""}><CalendarDays className="mr-1 inline size-3" />{overdue ? "Overdue · " : ""}{formatDate(todo.dueDate)}</span>}
                    {todo.status === "blocked" && <Badge variant="destructive">Blocked</Badge>}
                  </div>
                </div>
                <Link aria-label={`Open ${project?.name}`} href={`/projects/${todo.projectId}`}><ExternalLink className="size-4 text-muted-foreground" /></Link>
              </div>
            );
          })}
          {!assignments.length && <div className="p-12 text-center"><CheckCircle2 className="mx-auto size-9 text-emerald-600" /><p className="mt-3 font-medium">You’re caught up.</p><p className="mt-1 text-sm text-muted-foreground">No open assignments match your account.</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></CardContent></Card>;
}

function isDueSoon(todo: { dueDate?: string }) {
  if (!todo.dueDate) return false;
  const days = (new Date(`${todo.dueDate}T23:59:59`).getTime() - Date.now()) / 86_400_000;
  return days >= 0 && days <= 7;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}
