"use client";

import { LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { CrmContact } from "@/components/crm/types";

export function ContactAffiliationActions({
  clientId,
  contact,
}: {
  clientId: string;
  contact: CrmContact;
}) {
  const router = useRouter();
  const [role, setRole] = useState(contact.role ?? "");
  const [isPrimary, setIsPrimary] = useState(Boolean(contact.isPrimary));
  const [receivesInvoices, setReceivesInvoices] = useState(
    Boolean(contact.receivesInvoices),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/contacts/affiliations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        contactId: contact.id,
        role: role || null,
        position: role || null,
        isPrimary,
        receivesInvoices,
      }),
    });
    if (response.ok) router.refresh();
    else {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not update this affiliation.");
    }
    setSaving(false);
  }

  async function remove() {
    if (!contact.affiliationId) return;
    setSaving(true);
    const response = await fetch("/api/contacts/affiliations", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: contact.affiliationId }),
    });
    if (response.ok) router.refresh();
    else {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not remove this affiliation.");
    }
    setSaving(false);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <Pencil />
          Affiliation
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact.name}</DialogTitle>
          <DialogDescription>
            Manage this person’s role and billing relationship with the client.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`affiliation-role-${contact.id}`}>Role</Label>
            <Input
              id={`affiliation-role-${contact.id}`}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Property manager, decision maker, approver…"
              value={role}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isPrimary}
              onCheckedChange={(checked) => setIsPrimary(checked === true)}
            />
            Primary relationship contact
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={receivesInvoices}
              onCheckedChange={(checked) =>
                setReceivesInvoices(checked === true)
              }
            />
            Receives invoices
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button
            disabled={saving || !contact.affiliationId}
            onClick={() => void remove()}
            variant="ghost"
          >
            <Trash2 />
            Remove from client
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Pencil />}
            Save affiliation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
