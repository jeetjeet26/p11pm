"use client";

import {
  Hash,
  LoaderCircle,
  LockKeyhole,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  WorkspaceAdminChannel,
  WorkspaceAdminProfile,
  WorkspaceConversationMember,
  WorkspaceProfileRole,
  WorkspaceProfileStatus,
} from "@/lib/chat/types";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function WorkspaceAdmin({
  initialProfiles,
  initialChannels,
}: {
  initialProfiles: WorkspaceAdminProfile[];
  initialChannels: WorkspaceAdminChannel[];
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [channels, setChannels] = useState(initialChannels);
  const [error, setError] = useState("");
  const privateChannels = channels.filter(
    (channel) => channel.visibility === "private",
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="size-5" />
          <p className="text-sm font-medium">Trusted workspace controls</p>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Workspace administration
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Manage P11 people and private-channel membership. Administrator access
          does not reveal private messages, threads, or files unless the
          administrator is explicitly a member.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">
            <Users />
            People
          </TabsTrigger>
          <TabsTrigger value="channels">
            <LockKeyhole />
            Private channels
          </TabsTrigger>
        </TabsList>
        <TabsContent className="mt-4" value="people">
          <Card>
            <CardHeader>
              <CardTitle>People and access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {profiles.map((profile) => (
                <AdminProfileRow
                  key={profile.id}
                  onError={setError}
                  onSaved={(next) =>
                    setProfiles((current) =>
                      current.map((item) =>
                        item.id === next.id ? next : item,
                      ),
                    )
                  }
                  profile={profile}
                />
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent className="mt-4" value="channels">
          <div className="grid gap-4 lg:grid-cols-2">
            {privateChannels.map((channel) => (
              <AdminChannelCard
                channel={channel}
                key={channel.id}
                onError={setError}
                onSaved={(members) =>
                  setChannels((current) =>
                    current.map((item) =>
                      item.id === channel.id ? { ...item, members } : item,
                    ),
                  )
                }
                profiles={profiles}
              />
            ))}
            {!privateChannels.length && (
              <Card className="lg:col-span-2">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No private channels have been created.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AdminProfileRow({
  profile,
  onSaved,
  onError,
}: {
  profile: WorkspaceAdminProfile;
  onSaved: (profile: WorkspaceAdminProfile) => void;
  onError: (message: string) => void;
}) {
  const [role, setRole] = useState(profile.role);
  const [status, setStatus] = useState(profile.status);
  const [chatEnabled, setChatEnabled] = useState(profile.chatEnabled);
  const [permissions, setPermissions] = useState(profile.permissions);
  const [saving, setSaving] = useState(false);
  const changed =
    role !== profile.role ||
    status !== profile.status ||
    chatEnabled !== profile.chatEnabled ||
    JSON.stringify(permissions) !== JSON.stringify(profile.permissions);

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    onError("");
    const response = await fetch(`/api/admin/profiles/${profile.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, status, chatEnabled, permissions }),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      onSaved({ ...profile, role, status, chatEnabled, permissions });
    } else {
      onError(result.error ?? "Could not update the workspace profile.");
    }
    setSaving(false);
  }

  return (
    <div className="grid gap-3 rounded-xl border p-3 md:grid-cols-[minmax(220px,1fr)_150px_160px_130px_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9">
          <AvatarFallback className="text-[10px]">
            {initials(profile.fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{profile.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {profile.email}
          </p>
        </div>
      </div>
      <Select
        onValueChange={(value) => setRole(value as WorkspaceProfileRole)}
        value={role}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="manager">Manager</SelectItem>
          <SelectItem value="member">Member</SelectItem>
          <SelectItem value="viewer">Viewer</SelectItem>
        </SelectContent>
      </Select>
      <Select
        onValueChange={(value) => setStatus(value as WorkspaceProfileStatus)}
        value={status}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="deactivated">Deactivated</SelectItem>
        </SelectContent>
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={chatEnabled}
          onCheckedChange={(checked) => setChatEnabled(checked === true)}
        />
        Chat access
      </label>
      <Button
        disabled={!changed || saving}
        onClick={() => void save()}
        size="sm"
      >
        {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
        Save
      </Button>
      <div className="flex flex-wrap gap-x-5 gap-y-2 md:col-span-5">
        {[
          ["commercialRead", "View commercial data"],
          ["commercialWrite", "Manage commercial data"],
          ["timeApprove", "Approve time"],
          ["pipelineWrite", "Manage pipeline"],
          ["supportRead", "View support"],
          ["supportWrite", "Manage support"],
        ].map(([key, label]) => (
          <label className="flex items-center gap-2 text-xs" key={key}>
            <Checkbox
              checked={permissions[key as keyof typeof permissions]}
              disabled={saving || role === "admin"}
              onCheckedChange={(checked) =>
                setPermissions((current) => ({
                  ...current,
                  [key]: checked === true,
                }))
              }
            />
            {label}
          </label>
        ))}
        {role === "admin" || role === "manager" ? (
          <span className="text-xs text-muted-foreground">
            {role === "admin"
              ? "Administrators always have every capability."
              : "Managers retain commercial, approval, pipeline, and support access by default."}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AdminChannelCard({
  channel,
  profiles,
  onSaved,
  onError,
}: {
  channel: WorkspaceAdminChannel;
  profiles: WorkspaceAdminProfile[];
  onSaved: (members: WorkspaceConversationMember[]) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState(() =>
    channel.members
      .filter((member) => {
        const profile = profiles.find((item) => item.id === member.profileId);
        return (
          member.role === "member" &&
          profile?.status === "active" &&
          profile.chatEnabled
        );
      })
      .map((member) => member.profileId),
  );
  const [saving, setSaving] = useState(false);
  const ownerIds = channel.members
    .filter((member) => member.role === "owner")
    .map((member) => member.profileId);
  const existingMemberIds = channel.members.map((member) => member.profileId);
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile] as const)),
    [profiles],
  );
  const candidates = profiles.filter(
    (profile) =>
      (ownerIds.includes(profile.id) ||
        existingMemberIds.includes(profile.id) ||
        (profile.status === "active" && profile.chatEnabled)) &&
      (!search ||
        profile.fullName.toLowerCase().includes(search.toLowerCase()) ||
        profile.email.toLowerCase().includes(search.toLowerCase())),
  );

  async function saveMembers() {
    setSaving(true);
    onError("");
    const response = await fetch(
      `/api/workspace-chat/conversations/${channel.id}/members`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberIds: selectedIds }),
      },
    );
    const result = (await response.json()) as { error?: string };
    if (response.ok) {
      const finalIds = [...new Set([...selectedIds, ...ownerIds])];
      const members = finalIds.map((profileId) => ({
        profileId,
        role: ownerIds.includes(profileId) ? "owner" : "member",
      })) satisfies WorkspaceConversationMember[];
      onSaved(members);
      setOpen(false);
      setSearch("");
    } else {
      onError(result.error ?? "Could not update private channel members.");
    }
    setSaving(false);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
              <LockKeyhole className="size-4" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate"># {channel.name}</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {channel.members.length} members · /{channel.slug}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {channel.members.slice(0, 6).map((member) => (
              <Badge key={member.profileId} variant="secondary">
                {profileById.get(member.profileId)?.fullName ?? "P11 teammate"}
              </Badge>
            ))}
            {channel.members.length > 6 && (
              <Badge variant="outline">+{channel.members.length - 6}</Badge>
            )}
          </div>
          <Button
            className="mt-4 w-full"
            onClick={() => {
              setSelectedIds(
                channel.members
                  .filter((member) => {
                    const profile = profiles.find(
                      (item) => item.id === member.profileId,
                    );
                    return (
                      member.role === "member" &&
                      profile?.status === "active" &&
                      profile.chatEnabled
                    );
                  })
                  .map((member) => member.profileId),
              );
              setOpen(true);
            }}
            variant="outline"
          >
            <Users />
            Manage members
          </Button>
        </CardContent>
      </Card>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage # {channel.name}</DialogTitle>
            <DialogDescription>
              Membership changes take effect immediately. Channel owners cannot
              be removed here.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search workspace people"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search workspace people"
            value={search}
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {candidates.map((profile) => {
              const owner = ownerIds.includes(profile.id);
              const selected = owner || selectedIds.includes(profile.id);
              return (
                <label
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted"
                  key={profile.id}
                >
                  <Checkbox
                    checked={selected}
                    disabled={owner || saving}
                    onCheckedChange={(checked) =>
                      setSelectedIds((current) =>
                        checked === true
                          ? [...new Set([...current, profile.id])]
                          : current.filter((id) => id !== profile.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {profile.fullName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {owner ? "Channel owner" : profile.email}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <Button disabled={saving} onClick={() => void saveMembers()}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Hash />}
            Save channel members
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
