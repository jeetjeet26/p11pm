"use client";

import { LoaderCircle, Plus, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

interface StakeholderContact {
  id: string;
  name: string;
  email: string | null;
}

interface StakeholderLink {
  id: string;
  contactId: string;
  name: string;
  role: string | null;
  isPrimary: boolean;
}

export function ProjectStakeholderManager({
  contacts,
  links,
  projectId,
}: {
  contacts: StakeholderContact[];
  links: StakeholderLink[];
  projectId: string;
}) {
  const router = useRouter();
  const [contactId, setContactId] = useState("");
  const [role, setRole] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (!contactId || saving) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/projects/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        contactId,
        role: role || null,
        isPrimary,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      setContactId("");
      setRole("");
      setIsPrimary(false);
      router.refresh();
    } else {
      setError(result.error ?? "Could not add the stakeholder.");
    }
    setSaving(false);
  }

  async function remove(id: string) {
    if (saving) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/projects/contacts", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (response.ok) router.refresh();
    else {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Could not remove the stakeholder.");
    }
    setSaving(false);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <UsersRound />
          Manage
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Project stakeholders</DialogTitle>
          <DialogDescription>
            Associate client contacts with this job and identify the primary
            decision maker.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {links.map((link) => (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
              key={link.id}
            >
              <div>
                <p className="text-sm font-medium">{link.name}</p>
                <p className="text-xs text-muted-foreground">
                  {link.role || "Stakeholder"}
                  {link.isPrimary ? " · Primary" : ""}
                </p>
              </div>
              <Button
                aria-label={`Remove ${link.name}`}
                disabled={saving}
                onClick={() => void remove(link.id)}
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="grid gap-3 rounded-lg bg-muted/40 p-3">
            <div className="space-y-2">
              <Label>Client contact</Label>
              <Select onValueChange={setContactId} value={contactId}>
                <SelectTrigger><SelectValue placeholder="Select a contact" /></SelectTrigger>
                <SelectContent>
                  {contacts
                    .filter(
                      (contact) =>
                        !links.some((link) => link.contactId === contact.id),
                    )
                    .map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.name}
                        {contact.email ? ` · ${contact.email}` : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stakeholder-role">Role</Label>
              <Input
                id="stakeholder-role"
                onChange={(event) => setRole(event.target.value)}
                placeholder="Decision maker, billing contact, approver…"
                value={role}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isPrimary}
                onCheckedChange={(checked) => setIsPrimary(checked === true)}
              />
              Primary project stakeholder
            </label>
            <Button disabled={!contactId || saving} onClick={() => void add()}>
              {saving ? <LoaderCircle className="animate-spin" /> : <Plus />}
              Add stakeholder
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
