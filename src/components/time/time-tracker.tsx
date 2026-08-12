"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Square, Timer, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";

import type { TimeEntryOption } from "@/components/time/time-entry-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RunningTimer {
  id: string;
  project_id: string;
  todo_id: string | null;
  description: string;
  started_at: string;
  project?: { name?: string } | Array<{ name?: string }>;
}

export function TimeTracker({
  issues,
  projects,
}: {
  issues: TimeEntryOption[];
  projects: TimeEntryOption[];
}) {
  const router = useRouter();
  const [timer, setTimer] = useState<RunningTimer | null>(null);
  const [projectId, setProjectId] = useState("");
  const [issueId, setIssueId] = useState("");
  const [description, setDescription] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/time-entries/timer", { signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        if (!controller.signal.aborted) setTimer(result.timer ?? null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!timer) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [timer]);

  async function start() {
    setWorking(true);
    setError("");
    const response = await fetch("/api/time-entries/timer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "start",
        projectId,
        issueId: issueId || null,
        description,
        billable: true,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      timer?: RunningTimer;
      error?: string;
    };
    if (!response.ok) setError(result.error ?? "Timer could not start.");
    else setTimer(result.timer ?? null);
    setWorking(false);
  }

  async function stop() {
    if (!timer) return;
    setWorking(true);
    setError("");
    const response = await fetch("/api/time-entries/timer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop", timerId: timer.id }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setError(result.error ?? "Timer could not stop.");
    else {
      setTimer(null);
      setDescription("");
      setIssueId("");
      router.refresh();
    }
    setWorking(false);
  }

  async function discard() {
    if (!timer || !window.confirm("Discard this running timer without logging time?")) return;
    setWorking(true);
    const response = await fetch(
      `/api/time-entries/timer?timerId=${encodeURIComponent(timer.id)}`,
      { method: "DELETE" },
    );
    if (response.ok) setTimer(null);
    else {
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      setError(result.error ?? "Timer could not be discarded.");
    }
    setWorking(false);
  }

  const project = Array.isArray(timer?.project) ? timer?.project[0] : timer?.project;
  return (
    <div className="rounded-xl border bg-card p-3">
      {timer ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{timer.description}</p>
            <p className="text-xs text-muted-foreground">
              {project?.name ?? "Project"} · {elapsed(timer.started_at, now)}
            </p>
          </div>
          <Button disabled={working} onClick={() => void stop()} size="sm">
            {working ? <LoaderCircle className="animate-spin" /> : <Square />}Stop and log
          </Button>
          <Button aria-label="Discard timer" disabled={working} onClick={() => void discard()} size="icon-sm" variant="ghost"><Trash2 /></Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[180px_180px_minmax(180px,1fr)_auto]">
          <Select
            onValueChange={(value) => {
              setProjectId(value);
              if (issues.find((issue) => issue.id === issueId)?.projectId !== value) {
                setIssueId("");
              }
            }}
            value={projectId}
          >
            <SelectTrigger aria-label="Timer project"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select onValueChange={(value) => setIssueId(value === "__none" ? "" : value)} value={issueId || "__none"}>
            <SelectTrigger aria-label="Timer issue"><SelectValue placeholder="Issue" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">No issue</SelectItem>
              {issues.filter((issue) => issue.projectId === projectId).map((issue) => <SelectItem key={issue.id} value={issue.id}>{issue.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input aria-label="Timer description" onChange={(event) => setDescription(event.target.value)} placeholder="What are you working on?" value={description} />
          <Button disabled={working || !projectId || !description.trim()} onClick={() => void start()}><Timer />Start</Button>
        </div>
      )}
      {error ? <Alert className="mt-3" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    </div>
  );
}

function elapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, "0")).join(":");
}
