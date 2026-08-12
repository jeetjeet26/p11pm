"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Database,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  Search,
  Shield,
  Truck,
} from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";

interface OperatorData {
  deadLetters: {
    storage_deletion_outbox?: Array<Record<string, unknown>>;
    slack_notification_outbox?: Array<Record<string, unknown>>;
    invoice_deliveries?: Array<Record<string, unknown>>;
  };
  health: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  unresolved: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  securityMatrix: Array<{
    table_category: string;
    table_name: string;
    role: string;
    operation: string;
    allowed: boolean;
    notes: string | null;
  }>;
}

const emptyData: OperatorData = {
  deadLetters: {},
  health: [],
  alerts: [],
  unresolved: [],
  deliveries: [],
  securityMatrix: [],
};

export function OperatorConsole() {
  const [data, setData] = useState(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditCategory, setAuditCategory] = useState<string>("all");
  const [auditEvents, setAuditEvents] = useState<Array<Record<string, unknown>>>([]);
  const [retryReason, setRetryReason] = useState("Operator retry requested");
  const [selectedUnresolved, setSelectedUnresolved] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/operator");
      const body = (await response.json()) as OperatorData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Unable to load operator console.");
      setData(body);
      setSelectedUnresolved((current) => current || String(body.unresolved[0]?.id ?? ""));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load operator console.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function searchAudit() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/operator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "search_audit",
          actionCategory: auditCategory === "all" ? undefined : auditCategory,
          limit: 50,
        }),
      });
      const body = (await response.json()) as {
        events?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Audit search failed.");
      setAuditEvents(body.events ?? []);
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Audit search failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryUnresolved() {
    if (!selectedUnresolved) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/operator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "retry_unresolved",
          unresolvedId: selectedUnresolved,
          reason: retryReason,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Retry failed.");
      await load();
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  }

  const deadLetterCount =
    (data.deadLetters.storage_deletion_outbox?.length ?? 0) +
    (data.deadLetters.slack_notification_outbox?.length ?? 0) +
    (data.deadLetters.invoice_deliveries?.length ?? 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            Production operator console
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Dead letters, Accelo retries, audit search, delivery failures, and security matrices.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard
            icon={<AlertTriangle className="size-4" />}
            label="Open alerts"
            value={String(data.alerts.length)}
          />
          <MetricCard
            icon={<Database className="size-4" />}
            label="Dead letters"
            value={String(deadLetterCount)}
          />
          <MetricCard
            icon={<Truck className="size-4" />}
            label="Delivery queue"
            value={String(data.deliveries.length)}
          />
          <MetricCard
            icon={<FileWarning className="size-4" />}
            label="Unresolved Accelo"
            value={String(data.unresolved.length)}
          />
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Accelo unresolved retry</h3>
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="unresolved-id">Unresolved dependency</Label>
              <Select value={selectedUnresolved} onValueChange={setSelectedUnresolved}>
                <SelectTrigger id="unresolved-id">
                  <SelectValue placeholder="Select unresolved row" />
                </SelectTrigger>
                <SelectContent>
                  {data.unresolved.map((row) => (
                    <SelectItem key={String(row.id)} value={String(row.id)}>
                      {String(row.entity_type)} · {String(row.source_record_id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="retry-reason">Reason</Label>
              <Input
                id="retry-reason"
                value={retryReason}
                onChange={(event) => setRetryReason(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void retryUnresolved()} disabled={busy || !selectedUnresolved}>
                Retry
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Immutable audit search</h3>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="audit-category">Category</Label>
              <Select value={auditCategory} onValueChange={setAuditCategory}>
                <SelectTrigger id="audit-category" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="privileged">Privileged</SelectItem>
                  <SelectItem value="finance">Finance</SelectItem>
                  <SelectItem value="authority">Authority</SelectItem>
                  <SelectItem value="export">Export</SelectItem>
                  <SelectItem value="share">Share</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void searchAudit()} disabled={busy}>
              <Search className="size-4" />
              Search audit
            </Button>
          </div>
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Action</th>
                  <th className="px-3 py-2 text-left">Correlation</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((event) => (
                  <tr key={String(event.id)} className="border-t">
                    <td className="px-3 py-2">{String(event.created_at ?? "")}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{String(event.action_category)}</Badge>
                    </td>
                    <td className="px-3 py-2">{String(event.action_type)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {String(event.request_correlation_id ?? "").slice(0, 8)}
                    </td>
                  </tr>
                ))}
                {!auditEvents.length ? (
                  <tr>
                    <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                      Run a search to load audit events.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Tenant / role security matrix</h3>
          <Textarea
            readOnly
            className="min-h-40 font-mono text-xs"
            value={JSON.stringify(data.securityMatrix.slice(0, 40), null, 2)}
          />
        </section>
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
