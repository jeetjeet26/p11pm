"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CalendarRange, Flag, LoaderCircle, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface PlanningItem {
  id: string;
  name: string;
  status: string;
  position: number;
  progress: number;
  at_risk_issue_count: number;
  due_date?: string | null;
  starts_on?: string;
  ends_on?: string;
  goal?: string | null;
  risk_level?: string;
}

export function ProjectPlanning({
  canManage,
  projectId,
}: {
  canManage: boolean;
  projectId: string;
}) {
  const [milestones, setMilestones] = useState<PlanningItem[]>([]);
  const [cycles, setCycles] = useState<PlanningItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [milestoneResponse, cycleResponse] = await Promise.all([
      fetch(`/api/milestones?projectId=${encodeURIComponent(projectId)}`),
      fetch(`/api/cycles?projectId=${encodeURIComponent(projectId)}`),
    ]);
    const milestoneResult = (await milestoneResponse.json().catch(() => ({}))) as {
      milestones?: PlanningItem[];
      error?: string;
    };
    const cycleResult = (await cycleResponse.json().catch(() => ({}))) as {
      cycles?: PlanningItem[];
      error?: string;
    };
    if (!milestoneResponse.ok || !cycleResponse.ok) {
      setError(milestoneResult.error ?? cycleResult.error ?? "Planning could not be loaded.");
    } else {
      setMilestones(milestoneResult.milestones ?? []);
      setCycles(cycleResult.cycles ?? []);
      setError("");
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function setMilestoneStatus(id: string, status: string) {
    const response = await fetch("/api/milestones", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (response.ok) await load();
  }

  async function moveMilestone(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= milestones.length) return;
    const ordered = [...milestones];
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    setMilestones(ordered);
    const response = await fetch("/api/milestones", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, orderedIds: ordered.map((item) => item.id) }),
    });
    if (!response.ok) await load();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><CalendarRange className="size-4" />Delivery plan</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Milestones and cycles use linked issue estimates, completion, and risk.
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <PlanningDialog kind="milestone" onSaved={load} projectId={projectId} />
            <PlanningDialog kind="cycle" onSaved={load} projectId={projectId} />
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        {loading ? (
          <div className="col-span-full flex items-center justify-center py-8 text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />Loading delivery plan
          </div>
        ) : error ? (
          <p className="col-span-full text-sm text-destructive">{error}</p>
        ) : (
          <>
            <PlanningList
              canManage={canManage}
              items={milestones}
              kind="milestone"
              move={moveMilestone}
              setStatus={setMilestoneStatus}
            />
            <PlanningList canManage={false} items={cycles} kind="cycle" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanningList({
  canManage,
  items,
  kind,
  move,
  setStatus,
}: {
  canManage: boolean;
  items: PlanningItem[];
  kind: "milestone" | "cycle";
  move?: (index: number, direction: -1 | 1) => void;
  setStatus?: (id: string, status: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold capitalize">{kind}s</h3>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div className="rounded-lg border p-3" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.due_date
                    ? `Due ${formatDate(item.due_date)}`
                    : item.starts_on && item.ends_on
                      ? `${formatDate(item.starts_on)} – ${formatDate(item.ends_on)}`
                      : "No date"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {item.at_risk_issue_count ? (
                  <Badge variant="destructive"><Flag className="mr-1 size-3" />{item.at_risk_issue_count}</Badge>
                ) : null}
                {canManage && move ? (
                  <>
                    <Button aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} size="icon-sm" variant="ghost"><ArrowUp /></Button>
                    <Button aria-label="Move down" disabled={index === items.length - 1} onClick={() => move(index, 1)} size="icon-sm" variant="ghost"><ArrowDown /></Button>
                  </>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress className="h-1.5 flex-1" value={item.progress} />
              <span className="text-xs tabular-nums text-muted-foreground">{item.progress}%</span>
              {canManage && setStatus ? (
                <Select onValueChange={(value) => setStatus(item.id, value)} value={item.status}>
                  <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["upcoming", "in_progress", "completed", "missed", "cancelled"].map((status) => (
                      <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : <Badge variant="outline">{item.status}</Badge>}
            </div>
          </div>
        ))}
        {!items.length ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No {kind}s yet.</p> : null}
      </div>
    </section>
  );
}

function PlanningDialog({
  kind,
  onSaved,
  projectId,
}: {
  kind: "milestone" | "cycle";
  onSaved: () => Promise<void>;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch(kind === "milestone" ? "/api/milestones" : "/api/cycles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        kind === "milestone"
          ? { projectId, name, description: notes, dueDate: end || null }
          : { projectId, name, goal: notes, startsOn: start, endsOn: end },
      ),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setError(result.error ?? `Could not create ${kind}.`);
    else {
      setOpen(false);
      setName("");
      setNotes("");
      setStart("");
      setEnd("");
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus />{kind}</Button></DialogTrigger>
      <DialogContent>
        <form onSubmit={save}>
          <DialogHeader><DialogTitle>New {kind}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor={`${kind}-name`}>Name</Label><Input id={`${kind}-name`} onChange={(event) => setName(event.target.value)} required value={name} /></div>
            {kind === "cycle" ? <div className="space-y-2"><Label htmlFor="cycle-start">Starts</Label><Input id="cycle-start" onChange={(event) => setStart(event.target.value)} required type="date" value={start} /></div> : null}
            <div className="space-y-2"><Label htmlFor={`${kind}-end`}>{kind === "cycle" ? "Ends" : "Due"}</Label><Input id={`${kind}-end`} onChange={(event) => setEnd(event.target.value)} required={kind === "cycle"} type="date" value={end} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor={`${kind}-notes`}>{kind === "cycle" ? "Goal" : "Description"}</Label><Textarea id={`${kind}-notes`} onChange={(event) => setNotes(event.target.value)} value={notes} /></div>
            {error ? <p className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
          </div>
          <DialogFooter><Button disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : null}Create</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}
