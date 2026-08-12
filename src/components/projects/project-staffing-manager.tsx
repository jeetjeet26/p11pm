"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StaffingMember {
  profileId: string;
  name: string;
  title: string | null;
  weeklyCapacityMinutes: number;
  role: "lead" | "member" | "reviewer" | "client";
  allocationPercent: number | null;
  currentAllocationPercent: number;
  selected: boolean;
  totalAllocationPercent: number;
  capacityState: "available" | "near" | "over";
}

export function ProjectStaffingManager({
  canManage,
  projectId,
}: {
  canManage: boolean;
  projectId: string;
}) {
  const [members, setMembers] = useState<StaffingMember[]>([]);
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    void fetch(`/api/projects/members?projectId=${encodeURIComponent(projectId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          members?: StaffingMember[];
          error?: string;
        };
        if (!response.ok) throw new Error(result.error ?? "Staffing could not be loaded.");
        setMembers(result.members ?? []);
      })
      .catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Staffing could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, projectId]);

  if (!canManage) return null;

  function update(profileId: string, changes: Partial<StaffingMember>) {
    setMembers((current) =>
      current.map((member) =>
        member.profileId === profileId ? { ...member, ...changes } : member,
      ),
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/projects/members", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        members: members
          .filter((member) => member.selected)
          .map((member) => ({
            profileId: member.profileId,
            role: member.role,
            allocationPercent: member.allocationPercent,
          })),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) setError(result.error ?? "Staffing could not be saved.");
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2"><Users className="size-4" />Project staffing</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign delivery roles and compare planned load with weekly capacity.
          </p>
        </div>
        <Button disabled={saving || loading} onClick={() => void save()} size="sm">
          {saving ? <LoaderCircle className="animate-spin" /> : null}Save staffing
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading capacity…</p> : null}
        {members.map((member) => {
          const proposedTotal =
            member.totalAllocationPercent -
            member.currentAllocationPercent +
            (member.selected ? member.allocationPercent ?? 0 : 0);
          return (
            <div className="grid items-center gap-3 rounded-lg border p-3 sm:grid-cols-[auto_minmax(0,1fr)_140px_120px_auto]" key={member.profileId}>
              <Checkbox
                aria-label={`Staff ${member.name}`}
                checked={member.selected}
                onCheckedChange={(checked) => update(member.profileId, { selected: checked === true })}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.title ?? "Team member"} · {formatHours(member.weeklyCapacityMinutes)} weekly
                </p>
              </div>
              <Select
                disabled={!member.selected}
                onValueChange={(role) => update(member.profileId, { role: role as StaffingMember["role"] })}
                value={member.role}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["lead", "member", "reviewer", "client"].map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                aria-label={`${member.name} allocation percent`}
                disabled={!member.selected}
                max="100"
                min="0"
                onChange={(event) => update(member.profileId, { allocationPercent: event.target.value === "" ? null : Number(event.target.value) })}
                placeholder="Allocation %"
                type="number"
                value={member.allocationPercent ?? ""}
              />
              <Badge variant={proposedTotal > 100 ? "destructive" : proposedTotal >= 85 ? "secondary" : "outline"}>
                {proposedTotal}% load
              </Badge>
            </div>
          );
        })}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function formatHours(minutes: number) {
  return `${(minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}
