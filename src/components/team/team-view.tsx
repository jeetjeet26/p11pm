"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  Gauge,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { Todo, WorkloadLevel } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getWorkload, isOverdue } from "@/lib/workload";

export function TeamView({ data }: { data: TeamData }) {
  const [projectFilter, setProjectFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const filteredTodos = useMemo(
    () =>
      data.todos.filter((todo) => {
        if (todo.status === "completed") return false;
        if (projectFilter !== "all" && todo.projectId !== projectFilter) return false;
        if (
          personFilter !== "all" &&
          todo.assigneeId !== personFilter &&
          !todo.assigneeIds?.includes(personFilter)
        ) return false;
        if (overdueOnly && !isOverdue(todo)) return false;
        return true;
      }),
    [data.todos, overdueOnly, personFilter, projectFilter],
  );

  const teamProfiles = data.profiles.filter(
    (profile) => profile.active && profile.isInternal,
  );
  const visibleProfiles = teamProfiles.filter(
    (profile) => personFilter === "all" || profile.id === personFilter,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
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
        <div className="flex h-8 items-center gap-2 sm:pb-1">
          <Checkbox checked={overdueOnly} id="overdue-only" onCheckedChange={(checked) => setOverdueOnly(checked === true)} />
          <Label htmlFor="overdue-only">Overdue only</Label>
        </div>
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people"><Users /> By person</TabsTrigger>
          <TabsTrigger value="projects"><BriefcaseBusiness /> By project</TabsTrigger>
        </TabsList>
        <TabsContent className="space-y-3 pt-3" value="people">
          {visibleProfiles.map((profile) => {
            const personTodos = filteredTodos.filter(
              (todo) =>
                todo.assigneeId === profile.id ||
                todo.assigneeIds?.includes(profile.id),
            );
            const projectIds = [...new Set(personTodos.map((todo) => todo.projectId))];
            const workload = getWorkload(personTodos);
            return (
              <details className="group rounded-xl border bg-card shadow-xs" key={profile.id}>
                <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                  <Avatar className="size-10"><AvatarFallback>{profile.initials}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{profile.fullName}</h3>
                      <WorkloadBadge level={workload} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{profile.jobTitle}</p>
                  </div>
                  <div className="hidden flex-wrap justify-end gap-1.5 md:flex">
                    {projectIds.slice(0, 3).map((projectId) => {
                      const project = data.projects.find((item) => item.id === projectId);
                      return <Badge key={projectId} variant="secondary">{project?.name}</Badge>;
                    })}
                  </div>
                  <div className="min-w-20 text-right">
                    <p className="text-lg font-semibold">{personTodos.length}</p>
                    <p className="text-[11px] text-muted-foreground">open</p>
                  </div>
                  <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t bg-muted/20 px-5 py-4">
                  {personTodos.length ? (
                    <div className="space-y-5">
                      {projectIds.map((projectId) => {
                        const project = data.projects.find((item) => item.id === projectId);
                        return (
                          <div key={projectId}>
                            <Link className="text-xs font-semibold uppercase tracking-wide text-primary hover:underline" href={`/projects/${projectId}`}>{project?.name}</Link>
                            <div className="mt-2 divide-y rounded-lg border bg-card">
                              {personTodos.filter((todo) => todo.projectId === projectId).map((todo) => <CompactTodo key={todo.id} todo={todo} />)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No open work matches these filters.</p>}
                </div>
              </details>
            );
          })}
        </TabsContent>
        <TabsContent className="grid gap-4 pt-3 lg:grid-cols-2" value="projects">
          {data.projects
            .filter((project) => projectFilter === "all" || project.id === projectFilter)
            .map((project) => {
              const projectTodos = filteredTodos.filter((todo) => todo.projectId === project.id);
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
                        const person = data.profiles.find((profile) => profile.id === id);
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
              const project = data.projects.find((entry) => entry.id === item.projectId);
              return (
                <div className="flex items-center gap-3 rounded-lg border px-4 py-3" key={`${item.type}-${item.id}`}>
                  <div className={cn("grid size-9 place-items-center rounded-lg", new Date(`${item.dueDate}T23:59:59`) < new Date() ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                    {item.type === "Milestone" ? <Gauge className="size-4" /> : <CalendarDays className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{project?.name} · {formatDate(item.dueDate)}</p></div>
                  <Badge variant="secondary">{item.type}</Badge>
                </div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}

function CompactTodo({ todo }: { todo: Todo }) {
  const overdue = isOverdue(todo);
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      {overdue ? <AlertTriangle className="size-4 shrink-0 text-destructive" /> : <span className="size-2 shrink-0 rounded-full bg-primary/60" />}
      <span className="min-w-0 flex-1 truncate">{todo.title}</span>
      {todo.dueDate && <span className={cn("text-xs text-muted-foreground", overdue && "font-medium text-destructive")}>{formatDate(todo.dueDate)}</span>}
      {todo.status === "blocked" && <Badge variant="destructive">Blocked</Badge>}
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
