"use client";

import { useState } from "react";
import { BrainCircuit, LoaderCircle } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Intelligence {
  health: "on_track" | "watch" | "at_risk";
  explanation: string;
  statusDraft: string;
  risks: string[];
  nextActions: string[];
  citations: Array<{ id: string; type: string; href: string; title: string }>;
}

export function ProjectIntelligence({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/briefs/project", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const result = (await response.json()) as {
        intelligence?: Intelligence;
        error?: string;
      };
      if (!response.ok || !result.intelligence) {
        throw new Error(result.error ?? "Unable to analyze project delivery.");
      }
      setIntelligence(result.intelligence);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Unable to analyze project delivery.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && !intelligence) void analyze();
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <BrainCircuit />
          Delivery brief
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Delivery intelligence</DialogTitle>
          <DialogDescription>
            Evidence-backed risk explanation and a status draft for human review.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Reviewing issues, blockers, decisions, and approvals…
          </div>
        ) : intelligence ? (
          <div className="space-y-5">
            <div className="flex items-center gap-2">
              <Badge variant={intelligence.health === "at_risk" ? "destructive" : "secondary"}>
                {intelligence.health.replaceAll("_", " ")}
              </Badge>
              <p className="text-sm">{intelligence.explanation}</p>
            </div>
            <Section items={intelligence.risks} title="Risks" />
            <Section items={intelligence.nextActions} title="Suggested next actions" />
            <section>
              <h3 className="text-sm font-semibold">Status draft</h3>
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm leading-6">
                {intelligence.statusDraft}
              </p>
            </section>
            {!!intelligence.citations.length && (
              <section>
                <h3 className="text-sm font-semibold">Evidence</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {intelligence.citations.map((citation) => (
                    <Button asChild key={`${citation.type}-${citation.id}`} size="sm" variant="outline">
                      <Link href={citation.href}>{citation.title}</Link>
                    </Button>
                  ))}
                </div>
              </section>
            )}
            <div className="flex justify-end border-t pt-4">
              <Button onClick={() => void analyze()} size="sm" variant="outline">
                <BrainCircuit />
                Refresh analysis
              </Button>
            </div>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-destructive">{error}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ items, title }: { items: string[]; title: string }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}-${item.slice(0, 20)}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
