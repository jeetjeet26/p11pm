"use client";

import { useEffect, useState } from "react";
import { CircleDotDashed, ListPlus, LoaderCircle, Scale } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface MessageWorkActionsProps {
  body: string;
  conversationId: string;
  messageId: string;
}

interface ProjectOption {
  id: string;
  name: string;
  code?: string;
}

interface ProfileOption {
  id: string;
  full_name: string;
}

export function MessageWorkActions({
  body,
  conversationId,
  messageId,
}: MessageWorkActionsProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"issue" | "decision">("issue");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState(() => firstLine(body));
  const [summary, setSummary] = useState(body);
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open || projects.length) return;
    const controller = new AbortController();
    void fetch("/api/operations", { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as {
          projects?: ProjectOption[];
          profiles?: ProfileOption[];
        };
        if (!response.ok) return;
        setProjects(result.projects ?? []);
        setProfiles(result.profiles ?? []);
        setProjectId((current) => current || result.projects?.[0]?.id || "");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [open, projects.length]);

  async function createWork(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const payload =
      kind === "issue"
        ? {
            action: "create_issue_from_message",
            messageId,
            projectId,
            title,
            dueDate: dueDate || undefined,
            assigneeIds: assigneeId ? [assigneeId] : [],
          }
        : {
            action: "create_decision",
            projectId,
            title,
            summary,
            sourceConversationId: conversationId,
            sourceMessageId: messageId,
          };
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create work from this message.");
      }
      setSuccess(kind === "issue" ? "Issue created and linked." : "Decision captured.");
      window.setTimeout(() => setOpen(false), 900);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to create work from this message.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button
          aria-label="Turn this message into work"
          className="mt-1 h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          size="sm"
          variant="ghost"
        >
          <ListPlus className="size-3.5" />
          Create work
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={createWork}>
          <DialogHeader>
            <DialogTitle>Turn conversation into durable work</DialogTitle>
            <DialogDescription>
              Preserve this message as the source and send future work back to its
              project context.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <Tabs onValueChange={(value) => setKind(value as typeof kind)} value={kind}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="issue">
                  <CircleDotDashed />
                  Issue
                </TabsTrigger>
                <TabsTrigger value="decision">
                  <Scale />
                  Decision
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="space-y-2">
              <Label>Project</Label>
              <Select onValueChange={setProjectId} value={projectId}>
                <SelectTrigger><SelectValue placeholder="Choose project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.code ? `${project.code} · ` : ""}{project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`message-work-title-${messageId}`}>Title</Label>
              <Input
                id={`message-work-title-${messageId}`}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </div>
            {kind === "issue" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Assignee</Label>
                  <Select onValueChange={setAssigneeId} value={assigneeId}>
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`message-work-date-${messageId}`}>Due date</Label>
                  <Input
                    id={`message-work-date-${messageId}`}
                    onChange={(event) => setDueDate(event.target.value)}
                    type="date"
                    value={dueDate}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor={`message-work-summary-${messageId}`}>Decision</Label>
                <Textarea
                  className="min-h-32"
                  id={`message-work-summary-${messageId}`}
                  onChange={(event) => setSummary(event.target.value)}
                  required
                  value={summary}
                />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-primary">{success}</p>}
          </div>
          <DialogFooter>
            <Button disabled={saving || !projectId || !title.trim()}>
              {saving && <LoaderCircle className="animate-spin" />}
              {kind === "issue" ? "Create linked issue" : "Capture decision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function firstLine(value: string) {
  const compact = value.split("\n")[0]?.trim() || "Follow up from chat";
  return compact.length > 100 ? `${compact.slice(0, 97)}…` : compact;
}
