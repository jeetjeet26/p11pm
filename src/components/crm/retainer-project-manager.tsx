"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function RetainerProjectManager({
  availableProjects,
  linkedProjects,
  retainerId,
}: {
  availableProjects: Array<{ id: string; name: string }>;
  linkedProjects: Array<{ id: string; name: string }>;
  retainerId: string;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function mutate(method: "POST" | "DELETE", targetProjectId: string) {
    setSaving(true);
    setError("");
    const response = await fetch("/api/retainers/projects", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ retainerId, projectId: targetProjectId }),
    });
    if (response.ok) {
      setProjectId("");
      router.refresh();
    } else {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not update funded jobs.");
    }
    setSaving(false);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus />
          Funded jobs
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Jobs funded by this contract</DialogTitle>
          <DialogDescription>
            Link delivery jobs explicitly instead of inferring the relationship
            only after time is logged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {linkedProjects.map((project) => (
            <div
              className="flex items-center justify-between rounded-lg border p-3"
              key={project.id}
            >
              <span className="text-sm font-medium">{project.name}</span>
              <Button
                aria-label={`Unlink ${project.name}`}
                disabled={saving}
                onClick={() => void mutate("DELETE", project.id)}
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Select onValueChange={setProjectId} value={projectId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select a client job" />
              </SelectTrigger>
              <SelectContent>
                {availableProjects
                  .filter(
                    (project) =>
                      !linkedProjects.some((linked) => linked.id === project.id),
                  )
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!projectId || saving}
              onClick={() => void mutate("POST", projectId)}
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Link
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
