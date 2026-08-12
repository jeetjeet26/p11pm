"use client";

import { useCallback, useEffect, useState } from "react";
import { Hash, LoaderCircle, MessageCircle, Plus } from "lucide-react";
import Link from "next/link";

import { EntityLinkPicker } from "@/components/cross-links/entity-link-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CrossLinkSearchResult } from "@/lib/cross-links/types";

interface Binding {
  id: string;
  conversation_id: string;
  is_primary: boolean;
  workspace_conversations?: {
    id: string;
    name?: string;
    kind: string;
  };
}

export function ProjectChannelBinding({ projectId }: { projectId: string }) {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [selection, setSelection] = useState<CrossLinkSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/operations?scope=bindings&projectId=${encodeURIComponent(projectId)}`,
    );
    const body = (await response.json()) as { bindings?: Binding[] };
    if (response.ok) setBindings(body.bindings ?? []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function bind() {
    const target = selection[0];
    if (!target?.conversationId) return;
    setSaving(true);
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "bind_channel",
        projectId,
        conversationId: target.conversationId,
        isPrimary: bindings.length === 0,
      }),
    });
    if (response.ok) {
      setSelection([]);
      await load();
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
        <div className="min-w-48">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="size-4" />
            Project channels
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Give conversation a durable project home.
          </p>
        </div>
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {loading ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
          ) : (
            bindings.map((binding) => (
              <Button asChild key={binding.id} size="sm" variant="outline">
                <Link href={`/chat/${binding.conversation_id}`}>
                  <Hash />
                  {binding.workspace_conversations?.name ?? "Conversation"}
                  {binding.is_primary && <Badge variant="secondary">Primary</Badge>}
                </Link>
              </Button>
            ))
          )}
        </div>
        <div className="flex min-w-64 items-center gap-2">
          <div className="min-w-0 flex-1">
            <EntityLinkPicker
              disabled={saving}
              onChange={(value) => setSelection(value.slice(-1))}
              scope="chat"
              value={selection}
            />
          </div>
          <Button
            disabled={saving || !selection.length}
            onClick={() => void bind()}
            size="sm"
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Bind
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
