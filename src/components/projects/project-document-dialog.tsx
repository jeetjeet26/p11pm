"use client";

import { useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

import {
  createChatCrossLinks,
  EntityLinkPicker,
  resolvePastedLink,
} from "@/components/cross-links/entity-link-picker";
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
import { Textarea } from "@/components/ui/textarea";
import type { CrossLinkSearchResult } from "@/lib/cross-links/types";
import type { DocumentItem } from "@/lib/types";

interface DocumentPayload extends DocumentItem {
  body: string;
  status: "draft" | "published" | "archived";
  version: number;
  createdAt: string;
}

export function ProjectDocumentDialog({
  demoMode,
  document,
  onSaved,
  projectId,
  trigger,
}: {
  demoMode: boolean;
  document?: DocumentItem;
  onSaved: (document: DocumentItem) => void;
  projectId: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(document?.title ?? "");
  const [body, setBody] = useState("");
  const [version, setVersion] = useState<number | null>(document ? null : 1);
  const [links, setLinks] = useState<CrossLinkSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(document);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setError(null);
    setLinks([]);
    setLoading(false);

    if (!document) {
      setTitle("");
      setBody("");
      setVersion(1);
      return;
    }

    setTitle(document.title);
    setBody("");
    setVersion(null);
    if (demoMode) {
      setVersion(1);
      return;
    }

    setLoading(true);
    void fetch(
      `/api/docs?id=${encodeURIComponent(document.id)}&projectId=${encodeURIComponent(projectId)}`,
    )
      .then(async (response) => {
        const result = (await response.json()) as {
          doc?: DocumentPayload;
          error?: string;
        };
        if (!response.ok || !result.doc) {
          throw new Error(result.error ?? "Unable to open this document.");
        }
        setTitle(result.doc.title);
        setBody(result.doc.body);
        setVersion(result.doc.version);
      })
      .catch((loadError: unknown) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to open this document.",
        );
      })
      .finally(() => setLoading(false));
  }

  async function saveDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing && version === null) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/docs", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(document
            ? { id: document.id, expectedVersion: version }
            : {}),
          projectId,
          title,
          body,
        }),
      });
      const result = (await response.json()) as {
        doc?: DocumentPayload;
        error?: string;
      };
      if (!response.ok || !result.doc) {
        throw new Error(result.error ?? "Unable to save this document.");
      }
      if (!editing && links.length) {
        await createChatCrossLinks(links, "doc", result.doc.id);
      }
      onSaved(result.doc);
      setOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save this document.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={saveDocument}>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit project doc" : "Create a project doc"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the working document and save a new version."
                : "Capture a brief, decision, or working note."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor={`doc-title-${document?.id ?? "new"}`}>Title</Label>
              <Input
                disabled={loading || saving}
                id={`doc-title-${document?.id ?? "new"}`}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                required
                value={title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`doc-body-${document?.id ?? "new"}`}>Content</Label>
              <Textarea
                className="min-h-72"
                disabled={loading || saving}
                id={`doc-body-${document?.id ?? "new"}`}
                maxLength={100_000}
                onChange={(event) => setBody(event.target.value)}
                onPaste={(event) => {
                  if (editing) return;
                  const pasted = event.clipboardData.getData("text");
                  void resolvePastedLink(pasted, "chat").then((result) => {
                    if (
                      result &&
                      !links.some(
                        (link) =>
                          link.type === result.type && link.id === result.id,
                      )
                    ) {
                      setLinks((current) => [...current, result]);
                    }
                  });
                }}
                value={body}
              />
              {!editing && (
                <EntityLinkPicker
                  disabled={loading || saving}
                  onChange={setLinks}
                  scope="chat"
                  value={links}
                />
              )}
            </div>
            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Opening document…
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={loading || saving || (editing && version === null)}
              type="submit"
            >
              {saving ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <FileText />
              )}
              {editing ? "Save changes" : "Create doc"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
