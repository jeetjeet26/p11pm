"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ProjectOption {
  id: string;
  name: string;
  code?: string;
}

export function QuickCapture() {
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/operations", { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { projects?: ProjectOption[] };
        if (!response.ok) return;
        setProjects(body.projects ?? []);
        setProjectId(body.projects?.[0]?.id ?? "");
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          listId: null,
          title,
          description: description || undefined,
          dueDate: dueDate || undefined,
          priority,
          issueType: "task",
          labels: ["quick-capture"],
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to capture issue.");
      setTitle("");
      setDescription("");
      setDueDate("");
      setSaved(true);
    } catch (captureError) {
      setError(
        captureError instanceof Error ? captureError.message : "Unable to capture issue.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Quick capture</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5" onSubmit={submit}>
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
            <Label htmlFor="capture-title">What needs to happen?</Label>
            <Input
              autoFocus
              id="capture-title"
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capture-description">Context</Label>
            <Textarea
              className="min-h-36"
              id="capture-description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Outcome, request, or source context"
              value={description}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select onValueChange={setPriority} value={priority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="capture-due">Due date</Label>
              <Input
                id="capture-due"
                onChange={(event) => setDueDate(event.target.value)}
                type="date"
                value={dueDate}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && (
            <p className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="size-4" />
              Captured. Add another while it is fresh.
            </p>
          )}
          <Button className="h-12" disabled={saving || !projectId || !title.trim()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Send />}
            Capture issue
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
