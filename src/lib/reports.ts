import { createClient } from "@/lib/supabase/server";

export interface DeliveryReport {
  available: boolean;
  capturedSince?: string;
  throughputLast7Days: number;
  medianCycleHours?: number;
  workInProgress: number;
  blockedCount: number;
  medianBlockedHours?: number;
  overdueCount: number;
  overdueAgeBuckets: Array<{ label: string; count: number }>;
  weeklyThroughput: Array<{ week: string; count: number }>;
  projectHealth: Array<{
    projectId: string;
    projectName: string;
    active: number;
    blocked: number;
    overdue: number;
    estimatedMinutes: number;
  }>;
  metadata?: {
    days: number;
    generatedAt?: string;
    projectId?: string | null;
  };
}

export async function getDeliveryReport({
  days = 90,
  projectId,
}: {
  days?: number;
  projectId?: string;
} = {}): Promise<DeliveryReport> {
  const supabase = await createClient();
  if (!supabase) return emptyReport();
  const { data, error } = await supabase.rpc("get_delivery_report", {
    requested_days: Math.max(7, Math.min(days, 365)),
    target_project_id: projectId ?? undefined,
  });
  if (error || !data || typeof data !== "object") {
    console.error("Delivery report unavailable:", error);
    return emptyReport();
  }
  const payload = data as Record<string, unknown>;
  const metadata = asRecord(payload.metadata);
  const weeklyThroughput = arrayValue(payload.weeklyThroughput).map((row) => {
    const week = asRecord(row);
    return {
      week: String(week.week ?? ""),
      count: numberValue(week.count),
    };
  });
  const overdueAgeBuckets = arrayValue(payload.overdueAgeBuckets).map((row) => {
    const bucket = asRecord(row);
    return {
      label: String(bucket.label ?? "Bucket"),
      count: numberValue(bucket.count),
    };
  });
  const projectHealth = arrayValue(payload.projectHealth).map((row) => {
    const project = asRecord(row);
    return {
      projectId: String(project.projectId ?? ""),
      projectName: String(project.projectName ?? "Project"),
      active: numberValue(project.active),
      blocked: numberValue(project.blocked),
      overdue: numberValue(project.overdue),
      estimatedMinutes: numberValue(project.estimatedMinutes),
    };
  });
  return {
    available: Boolean(payload.available ?? true),
    capturedSince: optionalString(payload.capturedSince),
    throughputLast7Days: numberValue(payload.throughputLast7Days),
    medianCycleHours: optionalNumber(payload.medianCycleHours),
    workInProgress: numberValue(payload.workInProgress),
    blockedCount: numberValue(payload.blockedCount),
    medianBlockedHours: optionalNumber(payload.medianBlockedHours),
    overdueCount: numberValue(payload.overdueCount),
    overdueAgeBuckets,
    weeklyThroughput,
    projectHealth,
    metadata: {
      days: numberValue(metadata.days, 90),
      generatedAt: optionalString(metadata.generatedAt),
      projectId: optionalString(metadata.projectId),
    },
  };
}

function emptyReport(): DeliveryReport {
  return {
    available: false,
    throughputLast7Days: 0,
    workInProgress: 0,
    blockedCount: 0,
    overdueCount: 0,
    overdueAgeBuckets: [],
    weeklyThroughput: [],
    projectHealth: [],
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
