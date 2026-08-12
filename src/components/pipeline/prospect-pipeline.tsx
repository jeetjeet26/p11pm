"use client";

import { CircleDollarSign, LoaderCircle, Plus } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const stages = ["lead", "qualified", "quote", "won", "lost"] as const;
type Stage = (typeof stages)[number];

export interface ProspectView {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  stage: Stage;
  probability: number;
  valueCents: number;
  weightedValueCents: number;
  currency: string;
  nextAction: string | null;
  nextActionAt: string | null;
  ownerName: string | null;
}

export function ProspectPipeline({
  canManage,
  clients,
  prospects,
}: {
  canManage: boolean;
  clients: Array<{ id: string; name: string }>;
  prospects: ProspectView[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<Stage>("lead");
  const [probability, setProbability] = useState("20");
  const [value, setValue] = useState("");
  const [nextAction, setNextAction] = useState("");
  const openProspects = prospects.filter(
    (prospect) => prospect.stage !== "won" && prospect.stage !== "lost",
  );
  const openValue = openProspects.reduce(
    (sum, prospect) => sum + prospect.valueCents,
    0,
  );
  const weightedValue = openProspects.reduce(
    (sum, prospect) => sum + prospect.weightedValueCents,
    0,
  );

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch("/api/prospects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        title,
        stage,
        probability: Number(probability),
        value: Number(value) || 0,
        currency: "USD",
        nextAction: nextAction || null,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setOpen(false);
      setClientId("");
      setTitle("");
      setValue("");
      setNextAction("");
      router.refresh();
    } else {
      setError(result.error ?? "Could not create this opportunity.");
    }
    setSaving(false);
  }

  async function move(id: string, nextStage: Stage) {
    setSaving(true);
    const response = await fetch("/api/prospects", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, stage: nextStage }),
    });
    if (response.ok) router.refresh();
    else {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not move this opportunity.");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Prospects</h1>
          <p className="mt-2 text-muted-foreground">
            Lightweight opportunity tracking for client relationships.
          </p>
        </div>
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger asChild>
            <Button disabled={!canManage || !clients.length}>
              <Plus />
              New opportunity
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={create}>
              <DialogHeader>
                <DialogTitle>New opportunity</DialogTitle>
                <DialogDescription>
                  Track value, confidence, ownership, and the next action.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-5 sm:grid-cols-2">
                <Field label="Client">
                  <Select onValueChange={setClientId} value={clientId}>
                    <SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger>
                    <SelectContent>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Stage">
                  <Select
                    onValueChange={(value) => setStage(value as Stage)}
                    value={stage}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stages.slice(0, 3).map((item) => (
                        <SelectItem key={item} value={item}>
                          {stageLabel(item)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Opportunity">
                  <Input
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </Field>
                <Field label="Value">
                  <Input
                    min="0"
                    onChange={(event) => setValue(event.target.value)}
                    step="0.01"
                    type="number"
                    value={value}
                  />
                </Field>
                <Field label="Probability">
                  <Input
                    max="100"
                    min="0"
                    onChange={(event) => setProbability(event.target.value)}
                    type="number"
                    value={probability}
                  />
                </Field>
                <Field label="Next action">
                  <Input
                    onChange={(event) => setNextAction(event.target.value)}
                    value={nextAction}
                  />
                </Field>
              </div>
              {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button disabled={saving || !clientId || !title.trim()}>
                  {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  Create opportunity
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Open pipeline" value={money(openValue, "USD")} />
        <Summary label="Weighted forecast" value={money(weightedValue, "USD")} />
        <Summary label="Open opportunities" value={String(openProspects.length)} />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 xl:grid-cols-5">
        {stages.map((column) => {
          const items = prospects.filter((prospect) => prospect.stage === column);
          return (
            <section className="space-y-3" key={column}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{stageLabel(column)}</h2>
                <Badge variant="secondary">{items.length}</Badge>
              </div>
              {items.map((prospect) => (
                <Card key={prospect.id}>
                  <CardContent className="space-y-3 p-4">
                    <div>
                      <Link
                        className="font-medium hover:text-primary hover:underline"
                        href={`/clients/prospects/${prospect.id}`}
                      >
                        {prospect.title}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {prospect.clientName}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1 font-mono">
                        <CircleDollarSign className="size-3.5" />
                        {money(prospect.valueCents, prospect.currency)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {prospect.probability}%
                      </span>
                    </div>
                    {prospect.nextAction ? (
                      <p className="text-xs leading-5 text-muted-foreground">
                        Next: {prospect.nextAction}
                      </p>
                    ) : null}
                    {canManage &&
                    prospect.stage !== "won" &&
                    prospect.stage !== "lost" ? (
                      <Select
                        disabled={saving}
                        onValueChange={(value) =>
                          void move(prospect.id, value as Stage)
                        }
                        value={prospect.stage}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {stages.slice(0, 3).map((item) => (
                            <SelectItem key={item} value={item}>
                              {stageLabel(item)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function stageLabel(stage: Stage) {
  return stage === "qualified"
    ? "Qualified"
    : stage[0].toUpperCase() + stage.slice(1);
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
