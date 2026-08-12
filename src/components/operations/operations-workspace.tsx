"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CalendarRange,
  CheckCircle2,
  GitBranch,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Scale,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type OperationKind = "decision" | "approval" | "dependency" | "cycle" | "automation";

interface ProjectOption {
  id: string;
  name: string;
  code?: string;
}

interface ProfileOption {
  id: string;
  full_name: string;
}

interface IssueOption {
  id: string;
  project_id: string;
  title: string;
  issue_number?: number;
}

interface OperationsData {
  projects: ProjectOption[];
  profiles: ProfileOption[];
  issues: IssueOption[];
  decisions: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
  cycles: Array<Record<string, unknown>>;
  automations: Array<Record<string, unknown>>;
  automationRuns: Array<Record<string, unknown>>;
}

const emptyData: OperationsData = {
  projects: [],
  profiles: [],
  issues: [],
  decisions: [],
  approvals: [],
  dependencies: [],
  cycles: [],
  automations: [],
  automationRuns: [],
};

export function OperationsWorkspace() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/operations");
      const body = (await response.json()) as OperationsData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load roadmap.");
      setData(body);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load roadmap.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pendingApprovals = data.approvals.filter(
    (item) => item.status === "pending",
  ).length;
  const activeCycles = data.cycles.filter((item) => item.status === "active").length;
  const activeDecisions = data.decisions.filter(
    (item) => item.status === "active",
  ).length;

  const activeAutomations = data.automations.filter(
    (item) => item.enabled !== false,
  ).length;
  const failedRuns = data.automationRuns.filter(
    (item) => item.status === "failed",
  ).length;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading the operating roadmap…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Roadmap & operations</h1>
          <p className="mt-2 text-muted-foreground">
            Decisions, approvals, dependencies, cycles, and automation in one view.
          </p>
        </div>
        <OperationDialog data={data} kind="decision" onCreated={load} />
      </header>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon={Scale} label="Active decisions" value={activeDecisions} />
        <Metric icon={CheckCircle2} label="Pending approvals" value={pendingApprovals} />
        <Metric icon={GitBranch} label="Dependencies" value={data.dependencies.length} />
        <Metric icon={CalendarRange} label="Active cycles" value={activeCycles} />
        <Metric icon={Bot} label="Automation failures" value={failedRuns} />
      </section>

      <Tabs defaultValue="decisions">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="cycles">Cycles</TabsTrigger>
          <TabsTrigger value="automations">
            Automations ({activeAutomations})
          </TabsTrigger>
          <TabsTrigger value="automation-runs">Run history</TabsTrigger>
        </TabsList>

        <OperationTab
          action={<OperationDialog data={data} kind="decision" onCreated={load} />}
          empty="Capture a decision from project work or chat."
          items={data.decisions}
          title="Decision log"
          value="decisions"
        />
        <OperationTab
          action={<OperationDialog data={data} kind="approval" onCreated={load} />}
          empty="Request a durable review or approval."
          items={data.approvals}
          title="Approval queue"
          value="approvals"
        />
        <OperationTab
          action={<OperationDialog data={data} kind="dependency" onCreated={load} />}
          empty="Connect issues to make delivery risk explicit."
          items={data.dependencies}
          title="Issue dependencies"
          value="dependencies"
        />
        <OperationTab
          action={<OperationDialog data={data} kind="cycle" onCreated={load} />}
          empty="Create a planning cycle with a goal and date range."
          items={data.cycles}
          title="Planning cycles"
          value="cycles"
        />
        <OperationTab
          action={<OperationDialog data={data} kind="automation" onCreated={load} />}
          empty="Add a rule to escalate risk or reduce routine coordination."
          items={data.automations}
          onReload={load}
          title="Automation rules"
          value="automations"
        />
        <AutomationRunHistory onReload={load} runs={data.automationRuns} />
      </Tabs>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Scale;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function OperationTab({
  action,
  empty,
  items,
  title,
  value,
  onReload,
}: {
  action: React.ReactNode;
  empty: string;
  items: Array<Record<string, unknown>>;
  title: string;
  value: string;
  onReload?: () => Promise<void>;
}) {
  return (
    <TabsContent value={value}>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {action}
        </CardHeader>
        <CardContent className="divide-y p-0">
          {items.map((item) => (
            <OperationRow
              item={item}
              key={String(item.id)}
              onReload={onReload}
              value={value}
            />
          ))}
          {!items.length && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {empty}
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function OperationRow({
  item,
  value,
  onReload,
}: {
  item: Record<string, unknown>;
  value: string;
  onReload?: () => Promise<void>;
}) {
  const [status, setStatus] = useState(String(item.status ?? ""));
  const [enabled, setEnabled] = useState(item.enabled !== false);
  const [working, setWorking] = useState(false);
  const title = String(item.title ?? item.name ?? relationshipTitle(item));
  const projectId = String(item.project_id ?? "");
  const description = String(
    item.summary ??
      item.description ??
      item.goal ??
      item.reason ??
      automationDescription(item) ??
      "",
  );

  async function respondToApproval(
    nextStatus: "approved" | "changes_requested",
  ) {
    setWorking(true);
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "respond_approval",
        approvalId: item.id,
        status: nextStatus,
      }),
    });
    if (response.ok) setStatus(nextStatus);
    setWorking(false);
  }

  async function automationAction(
    action: "toggle_automation" | "run_automation",
    payload: Record<string, unknown>,
  ) {
    setWorking(true);
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    if (response.ok) {
      if (action === "toggle_automation") {
        setEnabled(payload.enabled === true);
      }
      await onReload?.();
    }
    setWorking(false);
  }

  return (
    <div className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{title}</p>
          <Badge variant="secondary">
            {value === "automations"
              ? enabled
                ? String(item.trigger_type)
                : "disabled"
              : String(status || item.relationship || item.trigger_type || value)}
          </Badge>
        </div>
        {description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {value === "approvals" && status === "pending" && (
          <>
            <Button
              disabled={working}
              onClick={() => void respondToApproval("approved")}
              size="sm"
            >
              Approve
            </Button>
            <Button
              disabled={working}
              onClick={() => void respondToApproval("changes_requested")}
              size="sm"
              variant="outline"
            >
              Request changes
            </Button>
          </>
        )}
        {value === "automations" && (
          <>
            <Button
              disabled={working}
              onClick={() =>
                void automationAction("toggle_automation", {
                  ruleId: item.id,
                  enabled: !enabled,
                })
              }
              size="sm"
              variant="outline"
            >
              {enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              disabled={working || !enabled}
              onClick={() =>
                void automationAction("run_automation", { ruleId: item.id })
              }
              size="sm"
              variant="outline"
            >
              <Play />
              Run now
            </Button>
          </>
        )}
        {projectId && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${projectId}`}>Open project</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function OperationDialog({
  data,
  kind,
  onCreated,
}: {
  data: OperationsData;
  kind: OperationKind;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [firstIssueId, setFirstIssueId] = useState("");
  const [secondIssueId, setSecondIssueId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [triggerType, setTriggerType] = useState("overdue");
  const [actionType, setActionType] = useState("notify");

  const projectIssues = useMemo(
    () => data.issues.filter((issue) => issue.project_id === projectId),
    [data.issues, projectId],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const payload =
      kind === "decision"
        ? {
            action: "create_decision",
            projectId,
            title,
            summary: body,
          }
        : kind === "approval"
          ? {
              action: "request_approval",
              projectId,
              title,
              description: body,
              subjectType: "project",
              subjectId: projectId,
              reviewerId,
            }
          : kind === "dependency"
            ? {
                action: "create_dependency",
                projectId,
                predecessorTodoId: firstIssueId,
                successorTodoId: secondIssueId,
                relationship: "blocks",
                reason: body || undefined,
              }
            : kind === "cycle"
              ? {
                  action: "create_cycle",
                  projectId,
                  name: title,
                  goal: body || undefined,
                  startsOn,
                  endsOn,
                }
              : {
                  action: "create_automation",
                  projectId: projectId || undefined,
                  name: title,
                  triggerType,
                  triggerConfig: {},
                  actionType,
                  actionConfig: {},
                };
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to save.");
      setTitle("");
      setBody("");
      setOpen(false);
      await onCreated();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save.");
    } finally {
      setSaving(false);
    }
  }

  const label = {
    decision: "Decision",
    approval: "Approval",
    dependency: "Dependency",
    cycle: "Cycle",
    automation: "Automation",
  }[kind];

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant={kind === "decision" ? "default" : "outline"}>
          {kind === "automation" ? <Bot /> : <Plus />}
          Add {label.toLowerCase()}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add {label.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Keep coordination durable, attributable, and connected to delivery.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Field label="Project">
              <Select onValueChange={setProjectId} value={projectId}>
                <SelectTrigger><SelectValue placeholder="Choose project" /></SelectTrigger>
                <SelectContent>
                  {data.projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code ? `${project.code} · ` : ""}{project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {kind === "dependency" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <IssueSelect
                  issues={projectIssues}
                  label="Blocking issue"
                  onChange={setFirstIssueId}
                  value={firstIssueId}
                />
                <IssueSelect
                  issues={projectIssues}
                  label="Blocked issue"
                  onChange={setSecondIssueId}
                  value={secondIssueId}
                />
              </div>
            ) : (
              <Field label={kind === "cycle" ? "Cycle name" : "Title"}>
                <Input
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  value={title}
                />
              </Field>
            )}
            {kind === "approval" && (
              <Field label="Reviewer">
                <Select onValueChange={setReviewerId} value={reviewerId}>
                  <SelectTrigger><SelectValue placeholder="Choose reviewer" /></SelectTrigger>
                  <SelectContent>
                    {data.profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {kind === "cycle" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Starts"><Input onChange={(event) => setStartsOn(event.target.value)} required type="date" value={startsOn} /></Field>
                <Field label="Ends"><Input onChange={(event) => setEndsOn(event.target.value)} required type="date" value={endsOn} /></Field>
              </div>
            )}
            {kind === "automation" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="When">
                  <Select onValueChange={setTriggerType} value={triggerType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="overdue">Issue becomes overdue</SelectItem>
                      <SelectItem value="stale">Issue becomes stale</SelectItem>
                      <SelectItem value="status_changed">Status changes</SelectItem>
                      <SelectItem value="approval_completed">Approval completes</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Then">
                  <Select onValueChange={setActionType} value={actionType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="notify">Notify owner</SelectItem>
                      <SelectItem value="create_follow_up">Create follow-up</SelectItem>
                      <SelectItem value="post_update">Post update</SelectItem>
                      <SelectItem value="request_approval">Request approval</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {kind !== "automation" && (
              <Field label={kind === "decision" ? "Decision summary" : "Context"}>
                <Textarea
                  className="min-h-28"
                  onChange={(event) => setBody(event.target.value)}
                  required={kind === "decision"}
                  value={body}
                />
              </Field>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={
                saving ||
                !projectId ||
                (kind === "approval" && !reviewerId) ||
                (kind === "dependency" && (!firstIssueId || !secondIssueId))
              }
            >
              {saving && <LoaderCircle className="animate-spin" />}
              Save {label.toLowerCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function IssueSelect({
  issues,
  label,
  onChange,
  value,
}: {
  issues: IssueOption[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Field label={label}>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger><SelectValue placeholder="Choose issue" /></SelectTrigger>
        <SelectContent>
          {issues.map((issue) => (
            <SelectItem key={issue.id} value={issue.id}>
              {issue.issue_number ? `#${issue.issue_number} · ` : ""}{issue.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function relationshipTitle(item: Record<string, unknown>) {
  const predecessor = item.predecessor as Record<string, unknown> | undefined;
  const successor = item.successor as Record<string, unknown> | undefined;
  return `${String(predecessor?.title ?? "Issue")} → ${String(successor?.title ?? "Issue")}`;
}

function automationDescription(item: Record<string, unknown>) {
  if (!item.trigger_type || !item.action_type) return "";
  return `When ${String(item.trigger_type).replaceAll("_", " ")}, ${String(item.action_type).replaceAll("_", " ")}.`;
}

function AutomationRunHistory({
  runs,
  onReload,
}: {
  runs: Array<Record<string, unknown>>;
  onReload: () => Promise<void>;
}) {
  const [workingId, setWorkingId] = useState<string | null>(null);

  async function retry(runId: string) {
    setWorkingId(runId);
    await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "retry_automation", runId }),
    });
    await onReload();
    setWorkingId(null);
  }

  return (
    <TabsContent value="automation-runs">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Automation run history</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {runs.map((run) => {
            const attempts = Array.isArray(run.attempts) ? run.attempts : [];
            const latestAttempt = attempts[attempts.length - 1] as
              | Record<string, unknown>
              | undefined;
            return (
              <div
                className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
                key={String(run.id)}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{String(run.event_key)}</p>
                    <Badge
                      variant={
                        run.status === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {String(run.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {String(run.attempt_count ?? 0)} attempt(s)
                    {run.last_error ? ` · ${String(run.last_error)}` : ""}
                    {latestAttempt?.error ? ` · ${String(latestAttempt.error)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {run.created_at
                      ? new Date(String(run.created_at)).toLocaleString()
                      : "Queued"}
                  </p>
                </div>
                {run.status === "failed" ? (
                  <Button
                    disabled={workingId === String(run.id)}
                    onClick={() => void retry(String(run.id))}
                    size="sm"
                    variant="outline"
                  >
                    {workingId === String(run.id) ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    Retry
                  </Button>
                ) : null}
              </div>
            );
          })}
          {!runs.length && (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Automation runs will appear here after rules execute.
            </div>
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}
