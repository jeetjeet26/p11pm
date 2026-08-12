import "server-only";

import { createClient } from "@/lib/supabase/server";

export interface CommercialSnapshot {
  activeClients: number;
  activeRetainers: number;
  retainerBurnPercent: number;
  unbilledValue: number;
  outstandingBalance: number;
  cashCollectedThisMonth: number;
  grossMarginPercent?: number;
}

export interface CommercialOperationsReport {
  available: boolean;
  utilization: {
    loggedMinutes: number;
    billableMinutes: number;
    capacityMinutes: number;
    percent?: number;
  };
  unapprovedTime: {
    entries: number;
    minutes: number;
    value: number;
  };
  jobMargins: Array<{
    projectId: string;
    projectName: string;
    clientName: string;
    loggedMinutes: number;
    billedValue: number;
    unbilledValue: number;
    grossMarginPercent?: number;
  }>;
  renewals: Array<{
    id: string;
    name: string;
    clientName: string;
    endDate: string;
    daysRemaining: number;
    value: number;
  }>;
  accountsReceivable: {
    available: boolean;
    open: number;
    buckets: Array<{ label: string; value: number }>;
  };
  pipeline: {
    prospectClients: number;
    planningJobs: number;
    fixedFeeValue: number;
    weightedValue: number;
  };
  capacity: Array<{
    profileId: string;
    name: string;
    capacityMinutes: number;
    scheduledMinutes: number;
    availableMinutes: number;
    utilizationPercent: number;
  }>;
  metadata?: {
    days: number;
    generatedAt?: string;
    projectId?: string | null;
    completeness?: Record<string, boolean>;
  };
}

export async function getCommercialSnapshot(): Promise<CommercialSnapshot> {
  const supabase = await createClient();
  if (!supabase) return emptySnapshot();
  const { data, error } = await supabase.rpc("get_commercial_snapshot");
  if (error || !data || typeof data !== "object") return emptySnapshot();
  const snapshot = data as Record<string, unknown>;
  const allowance = Number(snapshot.retainer_allowance_minutes ?? 0);
  const consumed = Number(snapshot.retainer_used_minutes ?? 0);
  const margin =
    snapshot.gross_margin_percent === null ||
    snapshot.gross_margin_percent === undefined
      ? undefined
      : Number(snapshot.gross_margin_percent);
  return {
    activeClients: Number(snapshot.active_clients ?? 0),
    activeRetainers: Number(snapshot.active_retainers ?? 0),
    retainerBurnPercent: allowance
      ? Math.round((consumed / allowance) * 100)
      : 0,
    unbilledValue: Number(snapshot.unbilled_cents ?? 0) / 100,
    outstandingBalance: Number(snapshot.outstanding_cents ?? 0) / 100,
    cashCollectedThisMonth:
      Number(snapshot.cash_collected_month_cents ?? 0) / 100,
    grossMarginPercent:
      margin !== undefined && Number.isFinite(margin) ? margin : undefined,
  };
}

export async function getCommercialOperationsReport({
  days = 90,
  projectId,
}: {
  days?: number;
  projectId?: string;
} = {}): Promise<CommercialOperationsReport> {
  const supabase = await createClient();
  if (!supabase) return emptyOperationsReport();
  const { data, error } = await supabase.rpc("get_commercial_operations_report", {
    requested_days: Math.max(7, Math.min(days, 365)),
    target_project_id: projectId ?? undefined,
  });
  if (error || !data || typeof data !== "object") {
    console.error("Commercial operations report unavailable:", error);
    return emptyOperationsReport();
  }
  return mapOperationsReport(data as Record<string, unknown>);
}

export async function exportCommercialReportCsv({
  reportKind = "operations",
  days = 90,
  projectId,
}: {
  reportKind?: "operations" | "delivery";
  days?: number;
  projectId?: string;
} = {}) {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("export_commercial_report_csv", {
    report_kind: reportKind,
    requested_days: Math.max(7, Math.min(days, 365)),
    target_project_id: projectId ?? undefined,
  });
  if (error || !data || typeof data !== "object") {
    console.error("Commercial report export unavailable:", error);
    return null;
  }
  return data as Record<string, unknown>;
}

function mapOperationsReport(payload: Record<string, unknown>): CommercialOperationsReport {
  const utilization = asRecord(payload.utilization);
  const unapprovedTime = asRecord(payload.unapprovedTime);
  const accountsReceivable = asRecord(payload.accountsReceivable);
  const pipeline = asRecord(payload.pipeline);
  const metadata = asRecord(payload.metadata);
  return {
    available: Boolean(payload.available ?? true),
    metadata: {
      days: numberValue(metadata.days, 90),
      generatedAt: optionalString(metadata.generatedAt),
      projectId: optionalString(metadata.projectId),
      completeness: asRecord(metadata.completeness) as Record<string, boolean>,
    },
    utilization: {
      loggedMinutes: numberValue(utilization.loggedMinutes),
      billableMinutes: numberValue(utilization.billableMinutes),
      capacityMinutes: numberValue(utilization.capacityMinutes),
      percent: optionalNumber(utilization.percent),
    },
    unapprovedTime: {
      entries: numberValue(unapprovedTime.entries),
      minutes: numberValue(unapprovedTime.minutes),
      value: numberValue(unapprovedTime.value),
    },
    jobMargins: arrayValue(payload.jobMargins).map((row) => {
      const job = asRecord(row);
      return {
        projectId: String(job.projectId ?? ""),
        projectName: String(job.projectName ?? "Project"),
        clientName: String(job.clientName ?? "Client"),
        loggedMinutes: numberValue(job.loggedMinutes),
        billedValue: numberValue(job.billedValue),
        unbilledValue: numberValue(job.unbilledValue),
        grossMarginPercent: optionalNumber(job.grossMarginPercent),
      };
    }),
    renewals: arrayValue(payload.renewals).map((row) => {
      const renewal = asRecord(row);
      return {
        id: String(renewal.id ?? ""),
        name: String(renewal.name ?? "Retainer"),
        clientName: String(renewal.clientName ?? "Client"),
        endDate: String(renewal.endDate ?? ""),
        daysRemaining: numberValue(renewal.daysRemaining),
        value: numberValue(renewal.value),
      };
    }),
    accountsReceivable: {
      available: Boolean(accountsReceivable.available),
      open: numberValue(accountsReceivable.open),
      buckets: arrayValue(accountsReceivable.buckets).map((row) => {
        const bucket = asRecord(row);
        return {
          label: String(bucket.label ?? "Bucket"),
          value: numberValue(bucket.value),
        };
      }),
    },
    pipeline: {
      prospectClients: numberValue(pipeline.prospectClients),
      planningJobs: numberValue(pipeline.planningJobs),
      fixedFeeValue: numberValue(pipeline.fixedFeeValue),
      weightedValue: numberValue(pipeline.weightedValue),
    },
    capacity: arrayValue(payload.capacity).map((row) => {
      const person = asRecord(row);
      return {
        profileId: String(person.profileId ?? ""),
        name: String(person.name ?? "Staff"),
        capacityMinutes: numberValue(person.capacityMinutes),
        scheduledMinutes: numberValue(person.scheduledMinutes),
        availableMinutes: numberValue(person.availableMinutes),
        utilizationPercent: numberValue(person.utilizationPercent),
      };
    }),
  };
}

function emptySnapshot(): CommercialSnapshot {
  return {
    activeClients: 0,
    activeRetainers: 0,
    retainerBurnPercent: 0,
    unbilledValue: 0,
    outstandingBalance: 0,
    cashCollectedThisMonth: 0,
  };
}

function emptyOperationsReport(): CommercialOperationsReport {
  return {
    available: false,
    utilization: {
      loggedMinutes: 0,
      billableMinutes: 0,
      capacityMinutes: 0,
    },
    unapprovedTime: { entries: 0, minutes: 0, value: 0 },
    jobMargins: [],
    renewals: [],
    accountsReceivable: {
      available: false,
      open: 0,
      buckets: [
        { label: "Current", value: 0 },
        { label: "1–30", value: 0 },
        { label: "31–60", value: 0 },
        { label: "61–90", value: 0 },
        { label: "90+", value: 0 },
      ],
    },
    pipeline: {
      prospectClients: 0,
      planningJobs: 0,
      fixedFeeValue: 0,
      weightedValue: 0,
    },
    capacity: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown, fallback = 0) {
  const result = Number(value ?? fallback);
  return Number.isFinite(result) ? result : fallback;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function optionalString(value: unknown) {
  return value === null || value === undefined ? undefined : String(value);
}
