"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SaveWorkspaceItemButton({
  href,
  sourceId,
  sourceType,
  title,
}: {
  href: string;
  sourceId: string;
  sourceType: string;
  title: string;
}) {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    const response = await fetch("/api/saved", {
      method: saved ? "DELETE" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ href, sourceId, sourceType, title }),
    });
    if (response.ok) setSaved(!saved);
    setSaving(false);
  }

  return (
    <Button
      aria-label={saved ? "Remove saved item" : "Save for later"}
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
      disabled={saving}
      onClick={() => void toggle()}
      size="sm"
      variant="ghost"
    >
      {saving ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : saved ? (
        <BookmarkCheck className="size-3.5" />
      ) : (
        <Bookmark className="size-3.5" />
      )}
      {saved ? "Saved" : "Save"}
    </Button>
  );
}
