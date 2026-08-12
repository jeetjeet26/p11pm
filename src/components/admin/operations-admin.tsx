"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  Copy,
  Database,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AdminData {
  integrations: Array<{ name: string; configured: boolean }>;
  tokens: Array<Record<string, unknown>>;
  guests: Array<Record<string, unknown>>;
  projects: Array<{ id: string; name: string; code?: string }>;
  profiles: Array<{ id: string; full_name: string; email: string; role: string }>;
  viewer: {
    role: "admin" | "manager";
    canManageTokens: boolean;
    canManageGuests: boolean;
  };
}

interface AcceloHealth {
  configured: boolean;
  enabled: boolean;
  live: boolean;
  health:
    | "healthy"
    | "degraded"
    | "stale"
    | "disabled"
    | "unconfigured"
    | "unknown";
  mode: "read-only";
  scope: string;
  resources: Array<{
    resource: string;
    syncedAt: string | null;
    ageMinutes: number | null;
    status: "fresh" | "stale" | "overdue" | "unknown";
    count: number | null;
  }>;
  heartbeat: { at: string | null; ageMinutes: number | null };
  authority: {
    state: string;
    entities?: Array<{
      entity_type: string;
      state: string;
      previous_state: string | null;
      transitioned_at: string;
    }>;
    providerWritesAllowed: false;
    configuredWriteMode: boolean;
  };
  counts: {
    runs: number;
    scanned: number;
    created: number;
    updated: number;
    failed: number;
  };
  quarantines: { records: number; latestAt: string | null };
  drift: {
    unresolved: number;
    byEntity: Record<string, number>;
    oldestAt: string | null;
  };
  latestRuns: Array<{
    id: string;
    kind: string;
    direction: string;
    status: string;
    scanned: number;
    changed: number;
    failed: number;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }>;
  error: string | null;
}

const emptyData: AdminData = {
  integrations: [],
  tokens: [],
  guests: [],
  projects: [],
  profiles: [],
  viewer: {
    role: "manager",
    canManageTokens: false,
    canManageGuests: true,
  },
};

export function OperationsAdmin({
  viewerRole,
}: {
  viewerRole: "admin" | "manager";
}) {
  const [data, setData] = useState(emptyData);
  const [accelo, setAccelo] = useState<AcceloHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [tokenScopes, setTokenScopes] = useState(["projects:read"]);
  const [revealedToken, setRevealedToken] = useState("");
  const [projectId, setProjectId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [accessRole, setAccessRole] = useState("reviewer");
  const [canAccessChat, setCanAccessChat] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [operationsResponse, acceloResponse] = await Promise.all([
      fetch("/api/admin/operations"),
      fetch("/api/admin/accelo"),
    ]);
    const [body, acceloBody] = await Promise.all([
      operationsResponse.json() as Promise<AdminData & { error?: string }>,
      acceloResponse.json() as Promise<AcceloHealth & { error?: string }>,
    ]);
    if (operationsResponse.ok) {
      setData(body);
      setProjectId((current) => current || body.projects[0]?.id || "");
      setProfileId((current) => current || body.profiles[0]?.id || "");
    } else {
      setError(body.error ?? "Unable to load operations administration.");
    }
    if (acceloResponse.ok) setAccelo(acceloBody);
    else setAccelo(null);
    setError((current) =>
      operationsResponse.ok && acceloResponse.ok
        ? null
        : current ??
          acceloBody.error ??
          "Unable to load complete integration health.",
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    if (!data.viewer.canManageTokens) return;
    setSaving(true);
    const response = await fetch("/api/admin/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create_token",
        name: tokenName,
        scopes: tokenScopes,
      }),
    });
    const result = (await response.json()) as { token?: string; error?: string };
    if (response.ok && result.token) {
      setRevealedToken(result.token);
      setTokenName("");
      await load();
    } else {
      setError(result.error ?? "Unable to create token.");
    }
    setSaving(false);
  }

  async function updateAccelo(action: "enable_shadow" | "disable_schedule") {
    if (viewerRole !== "admin" || saving) return;
    setSaving(true);
    setError(null);
    const response = await fetch("/api/admin/accelo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(result.error ?? "Could not update Accelo shadow polling.");
    } else {
      await load();
    }
    setSaving(false);
  }

  async function grantGuest(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/admin/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "grant_guest",
        projectId,
        profileId,
        accessRole,
        canAccessChat,
      }),
    });
    if (response.ok) await load();
    else {
      const result = (await response.json()) as { error?: string };
      setError(result.error ?? "Unable to grant guest access.");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading administration…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Access & integrations
          </h1>
          <Badge variant="outline">{viewerRole}</Badge>
        </div>
        <p className="mt-2 text-muted-foreground">
          Scoped service access, guest collaboration, and connection health.
        </p>
      </header>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Accelo operating health</h2>
            <p className="text-sm text-muted-foreground">
              Database-observed sync state; provider access remains read-only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {viewerRole === "admin" ? (
              <Button
                disabled={saving}
                onClick={() =>
                  void updateAccelo(
                    accelo?.enabled ? "disable_schedule" : "enable_shadow",
                  )
                }
                size="sm"
                variant="outline"
              >
                {accelo?.enabled ? "Pause polling" : "Enable shadow inventory"}
              </Button>
            ) : null}
            <Button onClick={() => void load()} size="sm" variant="outline">
              <RefreshCw />
              Refresh
            </Button>
          </div>
        </div>
        {accelo ? (
          <AcceloHealthPanel health={accelo} />
        ) : (
          <Card>
            <CardContent className="flex min-h-28 items-center gap-3 p-5 text-sm text-muted-foreground">
              <CircleOff className="size-5" />
              Accelo operational health is unavailable.
            </CardContent>
          </Card>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {data.integrations.map((integration) => (
          <Card key={integration.name}>
            <CardContent className="flex items-center justify-between p-5">
              <div>
                <p className="font-medium">{integration.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {integration.configured ? "Configured" : "Needs configuration"}
                </p>
              </div>
              {integration.configured ? (
                <CheckCircle2 className="size-5 text-primary" />
              ) : (
                <CircleOff className="size-5 text-muted-foreground" />
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              Scoped API tokens
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {data.viewer.canManageTokens ? (
              <form className="space-y-4" onSubmit={createToken}>
                <div className="space-y-2">
                  <Label htmlFor="token-name">Token name</Label>
                  <Input
                    id="token-name"
                    onChange={(event) => setTokenName(event.target.value)}
                    placeholder="Reporting connector"
                    required
                    value={tokenName}
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    "projects:read",
                    "issues:read",
                    "issues:write",
                    "chat:read",
                  ].map((scope) => (
                    <label className="flex items-center gap-2 text-sm" key={scope}>
                      <Checkbox
                        checked={tokenScopes.includes(scope)}
                        onCheckedChange={() =>
                          setTokenScopes((current) =>
                            current.includes(scope)
                              ? current.filter((item) => item !== scope)
                              : [...current, scope],
                          )
                        }
                      />
                      {scope}
                    </label>
                  ))}
                </div>
                <Button disabled={saving || !tokenScopes.length}>
                  {saving && <LoaderCircle className="animate-spin" />}
                  Create token
                </Button>
              </form>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                API token changes require an administrator. Managers can review
                existing token status.
              </div>
            )}
            {revealedToken && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs font-medium">Copy now—this is shown once.</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs">
                    {revealedToken}
                  </code>
                  <Button
                    aria-label="Copy token"
                    onClick={() => void navigator.clipboard.writeText(revealedToken)}
                    size="icon-sm"
                    variant="outline"
                  >
                    <Copy />
                  </Button>
                </div>
              </div>
            )}
            <div className="divide-y">
              {data.tokens.map((token) => (
                <div className="flex items-center justify-between py-3" key={String(token.id)}>
                  <div>
                    <p className="text-sm font-medium">{String(token.name)}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(token.token_prefix)}… ·{" "}
                      {Array.isArray(token.scopes) ? token.scopes.join(", ") : ""}
                    </p>
                  </div>
                  <Badge variant={token.revoked_at ? "secondary" : "outline"}>
                    {token.revoked_at ? "Revoked" : "Active"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-4" />
              Guest project access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <form className="grid gap-4" onSubmit={grantGuest}>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select onValueChange={setProjectId} value={projectId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.code ? `${project.code} · ` : ""}{project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Person</Label>
                <Select onValueChange={setProfileId} value={profileId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {data.profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.full_name} · {profile.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Access</Label>
                  <Select onValueChange={setAccessRole} value={accessRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="commenter">Commenter</SelectItem>
                      <SelectItem value="reviewer">Reviewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <Checkbox
                    checked={canAccessChat}
                    onCheckedChange={(checked) => setCanAccessChat(checked === true)}
                  />
                  Allow bound chat
                </label>
              </div>
              <Button disabled={saving || !projectId || !profileId}>
                <ShieldCheck />
                Grant access
              </Button>
            </form>
            <div className="divide-y">
              {data.guests.map((grant) => (
                <div className="py-3" key={String(grant.id)}>
                  <p className="text-sm font-medium">
                    {relatedName(grant.profiles, "full_name")} ·{" "}
                    {relatedName(grant.projects, "name")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {String(grant.access_role)}
                    {grant.can_access_chat ? " · bound chat allowed" : ""}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AcceloHealthPanel({ health }: { health: AcceloHealth }) {
  const isHealthy = health.health === "healthy";
  const hasRisk =
    health.health === "degraded" ||
    health.health === "stale" ||
    health.authority.configuredWriteMode;
  return (
    <Card className={hasRisk ? "border-destructive/40" : undefined}>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              {isHealthy ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              Accelo · read-only
            </CardTitle>
            <p className="mt-2 max-w-3xl break-all font-mono text-xs text-muted-foreground">
              {health.scope}
            </p>
          </div>
          <Badge variant={isHealthy ? "default" : hasRisk ? "destructive" : "secondary"}>
            {health.health}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <HealthSummary
            icon={Activity}
            label="Heartbeat"
            value={formatAge(health.heartbeat.ageMinutes)}
          />
          <HealthSummary
            icon={Database}
            label="Scanned"
            value={health.counts.scanned.toLocaleString()}
          />
          <HealthSummary
            icon={CheckCircle2}
            label="Changed"
            value={(health.counts.created + health.counts.updated).toLocaleString()}
          />
          <HealthSummary
            alert={health.quarantines.records > 0}
            icon={AlertTriangle}
            label="Quarantined"
            value={health.quarantines.records.toLocaleString()}
          />
          <HealthSummary
            alert={health.drift.unresolved > 0}
            icon={AlertTriangle}
            label="Unresolved drift"
            value={health.drift.unresolved.toLocaleString()}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {health.resources.map((resource) => (
            <div className="rounded-lg border p-3" key={resource.resource}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium capitalize">{resource.resource}</p>
                <Badge
                  variant={
                    resource.status === "fresh"
                      ? "outline"
                      : resource.status === "unknown"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {resource.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {resource.ageMinutes === null
                  ? "No resource heartbeat recorded"
                  : `Updated ${formatAge(resource.ageMinutes)} ago`}
                {resource.count === null
                  ? ""
                  : ` · ${resource.count.toLocaleString()} records`}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <p className="mb-2 text-sm font-medium">Latest runs</p>
            <div className="divide-y rounded-lg border">
              {health.latestRuns.slice(0, 5).map((run) => (
                <div
                  className="grid gap-2 p-3 text-xs sm:grid-cols-[100px_100px_minmax(0,1fr)_auto]"
                  key={run.id}
                >
                  <Badge variant={run.status === "succeeded" ? "outline" : "secondary"}>
                    {run.status}
                  </Badge>
                  <span className="capitalize text-muted-foreground">{run.kind}</span>
                  <span>
                    {run.scanned.toLocaleString()} scanned ·{" "}
                    {run.changed.toLocaleString()} changed ·{" "}
                    {run.failed.toLocaleString()} failed
                  </span>
                  <time
                    className="text-muted-foreground"
                    dateTime={run.completedAt ?? run.startedAt ?? undefined}
                  >
                    {formatTimestamp(run.completedAt ?? run.startedAt)}
                  </time>
                  {run.error && (
                    <p className="text-destructive sm:col-span-4">{run.error}</p>
                  )}
                </div>
              ))}
              {!health.latestRuns.length && (
                <p className="p-4 text-sm text-muted-foreground">
                  No synchronization runs recorded.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Authority state</p>
              <p className="mt-1 text-sm font-medium">
                {health.authority.state.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Provider writes blocked
              </p>
            </div>
            {health.authority.entities?.length ? (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Entity authority</p>
                <div className="mt-2 space-y-1">
                  {health.authority.entities.map((entity) => (
                    <div
                      className="flex justify-between gap-2 text-xs"
                      key={entity.entity_type}
                    >
                      <span className="capitalize">{entity.entity_type}</span>
                      <span className="text-muted-foreground">
                        {entity.state.replaceAll("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {Object.keys(health.drift.byEntity).length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Drift by entity</p>
                <p className="mt-1 text-sm font-medium">
                  {Object.entries(health.drift.byEntity)
                    .map(([entity, count]) => `${entity} ${count}`)
                    .join(" · ")}
                </p>
              </div>
            )}
            {(health.error || health.authority.configuredWriteMode) && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs font-medium text-destructive">
                  {health.authority.configuredWriteMode
                    ? "Write-mode drift detected"
                    : health.error}
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HealthSummary({
  alert = false,
  icon: Icon,
  label,
  value,
}: {
  alert?: boolean;
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={alert ? "text-destructive" : "text-primary"} />
        {label}
      </div>
      <p className={alert ? "mt-2 text-lg font-semibold text-destructive" : "mt-2 text-lg font-semibold"}>
        {value}
      </p>
    </div>
  );
}

function formatAge(minutes: number | null) {
  if (minutes === null) return "Unknown";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1_440)}d`;
}

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relatedName(value: unknown, key: string) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return "Unknown";
  return String((row as Record<string, unknown>)[key] ?? "Unknown");
}
