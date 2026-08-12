"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  Clock3,
  Gauge,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TeamData } from "@/lib/project-data/contracts";
import type { Profile, Project, Todo, WorkloadLevel } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  estimatedMinutes,
  getWorkload,
  isDueSoon,
  isOverdue,
} from "@/lib/workload";

export function TeamView({ data }: { data: TeamData }) {
  const [projectFilter, setProjectFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");

  const filteredTodos = useMemo(
    () =>
      data.todos.filter((todo) => {
        if (
          todo.status === "completed" ||
          todo.status === "cancelled" ||
          operationalState(todo) === "historical"
        ) return false;
        if (projectFilter !== "all" && todo.projectId !== projectFilter) return false;
        if (
          personFilter !== "all" &&
          todo.assigneeId !== personFilter &&
          !todo.assigneeIds?.includes(personFilter)
        ) return false;
        if (signalFilter === "overdue" && !isOverdue(todo)) return false;
        if (signalFilter === "due_soon" && !isDueSoon(todo)) return false;
        if (signalFilter === "blocked" && todo.status !== "blocked") return false;
        if (
          signalFilter === "unassigned" &&
          (todo.assigneeId || todo.assigneeIds?.length)
        ) return false;
        if (signalFilter === "stale" && !isStale(todo)) return false;
        if (signalFilter === "triage" && operationalState(todo) !== "triage") {
          return false;
        }
        return true;
      }),
    [data.todos, personFilter, projectFilter, signalFilter],
  );

  const teamProfiles = data.profiles.filter(
    (profile) => profile.active && profile.isInternal,
  );
  const visibleProfiles = teamProfiles.filter(
    (profile) => personFilter === "all" || profile.id === personFilter,
  );
  const projectsById = useMemo(
    () => new Map(data.projects.map((project) => [project.id, project])),
    [data.projects],
  );
  const profilesById = useMemo(
    () => new Map(data.profiles.map((profile) => [profile.id, profile])),
    [data.profiles],
  );
  const todosByProfile = useMemo(() => {
    const grouped = new Map<string, Todo[]>();
    for (const todo of filteredTodos) {
      const assigneeIds = todo.assigneeIds?.length
        ? todo.assigneeIds
        : todo.assigneeId
          ? [todo.assigneeId]
          : [];
      for (const assigneeId of new Set(assigneeIds)) {
        const todos = grouped.get(assigneeId);
        if (todos) todos.push(todo);
        else grouped.set(assigneeId, [todo]);
      }
    }
    return grouped;
  }, [filteredTodos]);
  const todosByProject = useMemo(() => {
    const grouped = new Map<string, Todo[]>();
    for (const todo of filteredTodos) {
      const todos = grouped.get(todo.projectId);
      if (todos) todos.push(todo);
      else grouped.set(todo.projectId, [todo]);
    }
    return grouped;
  }, [filteredTodos]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:items-end">
        <div className="space-y-2">
          <Label>Project</Label>
          <Select onValueChange={setProjectFilter} value={projectFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {data.projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Person</Label>
          <Select onValueChange={setPersonFilter} value={personFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {teamProfiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.fullName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Attention signal</Label>
          <Select onValueChange={setSignalFilter} value={signalFilter}>
            <SelectTrigger aria-label="Attention signal">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All current work</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="due_soon">Due within 7 days</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              <SelectItem value="stale">No update in 30 days</SelectItem>
              <SelectItem value="triage">Imported triage</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people"><Users /> By person</TabsTrigger>
          <TabsTrigger value="projects"><BriefcaseBusiness /> By project</TabsTrigger>
        </TabsList>
        <TabsContent className="space-y-3 pt-3" value="people">
          {visibleProfiles.map((profile) => (
            <PersonWorkloadRow
              key={profile.id}
              profile={profile}
              projectsById={projectsById}
              todos={todosByProfile.get(profile.id) ?? []}
            />
          ))}
        </TabsContent>
        <TabsContent className="grid gap-4 pt-3 lg:grid-cols-2" value="projects">
          {data.projects
            .filter((project) => projectFilter === "all" || project.id === projectFilter)
            .map((project) => {
              const projectTodos = todosByProject.get(project.id) ?? [];
              const assigneeIds = [
                ...new Set(
                  projectTodos.flatMap((todo) =>
                    todo.assigneeIds?.length
                      ? todo.assigneeIds
                      : todo.assigneeId
                        ? [todo.assigneeId]
                        : [],
                  ),
                ),
              ];
              return (
                <Card key={project.id}>
                  <CardHeader className="flex-row items-start justify-between">
                    <div><CardTitle className="text-base">{project.name}</CardTitle><p className="mt-1 text-xs text-muted-foreground">{project.client}</p></div>
                    <Badge variant="secondary">{projectTodos.length} open</Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4 flex -space-x-2">
                      {assigneeIds.map((id) => {
                        const person = profilesById.get(id);
                        return <Avatar className="size-8 border-2 border-card" key={id}><AvatarFallback className="text-[9px]">{person?.initials}</AvatarFallback></Avatar>;
                      })}
                    </div>
                    <div className="divide-y rounded-lg border">
                      {projectTodos.slice(0, 5).map((todo) => <CompactTodo key={todo.id} todo={todo} />)}
                      {!projectTodos.length && <p className="p-4 text-sm text-muted-foreground">No matching open work.</p>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="flex-row items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><CalendarDays className="size-4" /></div>
          <div><CardTitle className="text-base">What’s due next</CardTitle><p className="mt-1 text-xs text-muted-foreground">A simple deadline list — no calendar grid.</p></div>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {[
            ...data.milestones.map((item) => ({ ...item, type: "Milestone" })),
            ...filteredTodos.filter((todo) => todo.dueDate).map((todo) => ({ id: todo.id, projectId: todo.projectId, title: todo.title, dueDate: todo.dueDate!, type: "To-do" })),
          ]
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
            .slice(0, 8)
            .map((item) => {
              const project = projectsById.get(item.projectId);
              return (
                <div className="group relative flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40" key={`${item.type}-${item.id}`}>
                  <Link
                    aria-label={`Open ${item.title}`}
                    className="absolute inset-0"
                    href={
                      item.type === "To-do"
                        ? `/projects/${item.projectId}/issues/${item.id}`
                        : `/projects/${item.projectId}?tab=activity`
                    }
                  />
                  <div className={cn("pointer-events-none relative grid size-9 place-items-center rounded-lg", new Date(`${item.dueDate}T23:59:59`) < new Date() ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                    {item.type === "Milestone" ? <Gauge className="size-4" /> : <CalendarDays className="size-4" />}
                  </div>
                  <div className="pointer-events-none relative min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{project?.name} · {formatDate(item.dueDate)}</p></div>
                  <Badge className="pointer-events-none relative" variant="secondary">{item.type}</Badge>
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}

function PersonWorkloadRow({
  profile,
  projectsById,
  todos,
}: {
  profile: Profile;
  projectsById: Map<string, Project>;
  todos: Todo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const projectIds = [...new Set(todos.map((todo) => todo.projectId))];
  const todosByProject = useMemo(() => {
    const grouped = new Map<string, Todo[]>();
    for (const todo of todos) {
      const projectTodos = grouped.get(todo.projectId);
      if (projectTodos) projectTodos.push(todo);
      else grouped.set(todo.projectId, [todo]);
    }
    return grouped;
  }, [todos]);
  const workload = getWorkload(todos, new Date(), {
    profileId: profile.id,
    weeklyCapacityHours: (profile.weeklyCapacityMinutes ?? 2_400) / 60,
  });

  return (
    <details
      className="group rounded-xl border bg-card shadow-xs"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <Avatar className="size-10">
          <AvatarFallback>{profile.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{profile.fullName}</h3>
            <WorkloadBadge level={workload} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {profile.jobTitle}
          </p>
        </div>
        <div className="hidden flex-wrap justify-end gap-1.5 md:flex">
          {projectIds.slice(0, 3).map((projectId) => (
            <Badge key={projectId} variant="secondary">
              {projectsById.get(projectId)?.name}
            </Badge>
          ))}
        </div>
        <div className="min-w-20 text-right">
          <p className="text-lg font-semibold">{formatEstimate(todos)}</p>
          <p className="text-[11px] text-muted-foreground">
            {todos.some((todo) => estimatedMinutes(todo) !== undefined)
              ? "estimated"
              : `${todos.length} open`}
          </p>
        </div>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      {expanded && (
        <div className="border-t bg-muted/20 px-5 py-4">
          {todos.length ? (
            <div className="space-y-5">
              {projectIds.map((projectId) => (
                <div key={projectId}>
                  <Link
                    className="text-xs font-semibold uppercase tracking-wide text-primary hover:underline"
                    href={`/projects/${projectId}`}
                  >
                    {projectsById.get(projectId)?.name}
                  </Link>
                  <div className="mt-2 divide-y rounded-lg border bg-card">
                    {(todosByProject.get(projectId) ?? []).map((todo) => (
                      <CompactTodo key={todo.id} todo={todo} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No open work matches these filters.
            </p>
          )}
        </div>
      )}
    </details>
  );
}

function CompactTodo({ todo }: { todo: Todo }) {
  const overdue = isOverdue(todo);
  return (
    <div className="group relative flex items-center gap-3 px-4 py-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring hover:bg-muted/50">
      <Link
        aria-label={`Open ${todo.title}`}
        className="absolute inset-0"
        href={`/projects/${todo.projectId}/issues/${todo.id}`}
      />
      {overdue ? <AlertTriangle className="size-4 shrink-0 text-destructive" /> : <span className="size-2 shrink-0 rounded-full bg-primary/60" />}
      <span className="pointer-events-none relative min-w-0 flex-1 truncate">
        <span className="mr-2 font-mono text-[10px] font-semibold text-primary">
          {issueKey(todo)}
        </span>
        {todo.title}
      </span>
      {estimatedMinutes(todo) !== undefined && (
        <span className="pointer-events-none relative text-xs text-muted-foreground">
          {formatMinutes(estimatedMinutes(todo) ?? 0)}
        </span>
      )}
      {todo.dueDate && <span className={cn("pointer-events-none relative text-xs text-muted-foreground", overdue && "font-medium text-destructive")}>{overdue ? `${overdueDays(todo)}d overdue` : formatDate(todo.dueDate)}</span>}
      {isStale(todo) && <Badge className="pointer-events-none relative" variant="outline"><Clock3 className="mr-1 size-3" />Stale</Badge>}
      {todo.status === "blocked" && <Badge className="pointer-events-none relative" variant="destructive">Blocked</Badge>}
    </div>
  );
}

function WorkloadBadge({ level }: { level: WorkloadLevel }) {
  const styles = {
    light: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
    normal: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    heavy: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  };
  return <Badge className={styles[level]}>{level[0].toUpperCase() + level.slice(1)} load</Badge>;
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

function isStale(todo: Todo) {
  return (
    !["completed", "cancelled"].includes(todo.status) &&
    Date.now() - new Date(todo.updatedAt).getTime() > 30 * 86_400_000
  );
}

function issueKey(todo: Todo) {
  return "issueKey" in todo &&
    typeof (todo as Todo & { issueKey?: unknown }).issueKey === "string"
    ? (todo as Todo & { issueKey: string }).issueKey
    : todo.id.slice(0, 8).toUpperCase();
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

function formatEstimate(todos: Todo[]) {
  const estimates = todos
    .map(estimatedMinutes)
    .filter((minutes): minutes is number => minutes !== undefined);
  if (!estimates.length) return todos.length;
  return formatMinutes(estimates.reduce((total, minutes) => total + minutes, 0));
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}
