"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface InvoiceCollectionsPanelProps {
  invoiceId: string;
  canManage: boolean;
  collectionOwnerId: string | null;
  promisedPaymentDate: string | null;
  collectionNotes: string | null;
  collectionPromiseNotes: string | null;
  managers: Array<{ id: string; full_name: string }>;
}

export function InvoiceCollectionsPanel({
  invoiceId,
  canManage,
  collectionOwnerId,
  promisedPaymentDate,
  collectionNotes,
  collectionPromiseNotes,
  managers,
}: InvoiceCollectionsPanelProps) {
  const router = useRouter();
  const [ownerId, setOwnerId] = useState(collectionOwnerId ?? "");
  const [promiseDate, setPromiseDate] = useState(promisedPaymentDate ?? "");
  const [notes, setNotes] = useState(collectionNotes ?? "");
  const [promiseNotes, setPromiseNotes] = useState(collectionPromiseNotes ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  async function saveCollections() {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/collections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          collectionOwnerId: ownerId || null,
          promisedPaymentDate: promiseDate || null,
          collectionNotes: notes || null,
          collectionPromiseNotes: promiseNotes || null,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update collections.");
      }
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update collections.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div>
        <h2 className="text-base font-semibold">Collections</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Track owner, promise date, notes, and reminders for overdue balances.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <Label htmlFor="collection-owner">Collection owner</Label>
          <select
            className="h-9 rounded-md border bg-background px-3"
            id="collection-owner"
            onChange={(event) => setOwnerId(event.target.value)}
            value={ownerId}
          >
            <option value="">Unassigned</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          <Label htmlFor="promise-date">Promised payment date</Label>
          <Input
            id="promise-date"
            onChange={(event) => setPromiseDate(event.target.value)}
            type="date"
            value={promiseDate}
          />
        </label>
      </div>
      <label className="grid gap-2 text-sm">
        <Label htmlFor="collection-notes">Collection notes</Label>
        <Textarea
          id="collection-notes"
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          value={notes}
        />
      </label>
      <label className="grid gap-2 text-sm">
        <Label htmlFor="promise-notes">Promise notes</Label>
        <Textarea
          id="promise-notes"
          onChange={(event) => setPromiseNotes(event.target.value)}
          rows={2}
          value={promiseNotes}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button disabled={working} onClick={() => void saveCollections()} type="button">
        {working ? <LoaderCircle className="animate-spin" /> : null}
        Save collections
      </Button>
    </div>
  );
}
