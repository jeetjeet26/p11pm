"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, LoaderCircle, MailPlus, RotateCcw, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
}

export function InviteAdmin() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/invites");
    const result = (await response.json()) as { invites?: Invite[] };
    if (response.ok) setInvites(result.invites ?? []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createInvite(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/admin/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const result = (await response.json()) as { inviteUrl?: string };
    if (response.ok) {
      setInviteUrl(result.inviteUrl ?? "");
      setEmail("");
      await load();
    }
    setSaving(false);
  }

  async function updateInvite(id: string, action: "resend" | "revoke") {
    setSaving(true);
    const response = await fetch("/api/admin/invites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    const result = (await response.json()) as { inviteUrl?: string };
    if (response.ok) {
      setInviteUrl(result.inviteUrl ?? "");
      await load();
    }
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MailPlus className="size-4" />
          Workspace invitations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]"
          onSubmit={createInvite}
        >
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select onValueChange={setRole} value={role}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="self-end" disabled={saving}>
            {saving && <LoaderCircle className="animate-spin" />}
            Invite
          </Button>
        </form>
        {inviteUrl && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
            <code className="min-w-0 flex-1 truncate text-xs">{inviteUrl}</code>
            <Button
              aria-label="Copy invitation URL"
              onClick={() => void navigator.clipboard.writeText(inviteUrl)}
              size="icon-sm"
              variant="outline"
            >
              <Copy />
            </Button>
          </div>
        )}
        <div className="divide-y">
          {invites.map((invite) => (
            <div
              className="flex flex-col justify-between gap-3 py-3 sm:flex-row sm:items-center"
              key={invite.id}
            >
              <div>
                <p className="text-sm font-medium">{invite.email}</p>
                <p className="text-xs text-muted-foreground">
                  {invite.role} · expires{" "}
                  {new Date(invite.expires_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{invite.status}</Badge>
                {invite.status === "pending" && (
                  <>
                    <Button
                      aria-label="Regenerate invitation link"
                      disabled={saving}
                      onClick={() => void updateInvite(invite.id, "resend")}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <RotateCcw />
                    </Button>
                    <Button
                      aria-label="Revoke invitation"
                      disabled={saving}
                      onClick={() => void updateInvite(invite.id, "revoke")}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <X />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
