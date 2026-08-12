import { Banknote, Clock3, Gauge, Landmark, TrendingUp } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export async function ProjectCommercialSummary({
  projectId,
}: {
  projectId: string;
}) {
  const supabase = await createClient();
  if (!supabase) return null;

  const [summaryResult, timeResult, directRetainersResult, projectResult] =
    await Promise.all([
    supabase.rpc("get_project_commercial_summary", {
      target_project_id: projectId,
    }),
    supabase
      .from("time_entries")
      .select("retainer_period_id")
      .eq("project_id", projectId)
      .not("retainer_period_id", "is", null)
      .limit(1_000),
    supabase
      .from("retainer_projects")
      .select("retainer_id")
      .eq("project_id", projectId)
      .limit(100),
    supabase
      .from("projects")
      .select(
        "billing_type,fixed_fee_cents,hourly_rate_cents,billing_cap_cents,commercial_value_cents,billing_cadence,commercial_currency",
      )
      .eq("id", projectId)
      .maybeSingle(),
  ]);
  if (
    summaryResult.error ||
    timeResult.error ||
    directRetainersResult.error ||
    projectResult.error ||
    !summaryResult.data
  ) {
    return null;
  }

  const time = timeResult.data ?? [];
  const retainerIds = [
    ...new Set(
      time
        .map((entry) => entry.retainer_period_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const periodResult = retainerIds.length
    ? await supabase
        .from("retainer_periods")
        .select("retainer_id")
        .in("id", retainerIds)
    : { data: [], error: null };
  const linkedRetainerIds = [
    ...new Set([
      ...(periodResult.data ?? []).map((period) => period.retainer_id),
      ...(directRetainersResult.data ?? []).map((link) => link.retainer_id),
    ]),
  ];
  const retainerResult = linkedRetainerIds.length
    ? await supabase
        .from("retainers")
        .select("id,name")
        .in("id", linkedRetainerIds)
        .order("name")
    : { data: [], error: null };

  const summary = summaryResult.data as Record<string, unknown>;
  const hours = Number(summary.logged_minutes ?? 0) / 60;
  const unbilled = Number(summary.unbilled_cents ?? 0) / 100;
  const billed = Number(summary.billed_cents ?? 0) / 100;
  const margin =
    summary.gross_margin_percent === null ||
    summary.gross_margin_percent === undefined
      ? undefined
      : Number(summary.gross_margin_percent);
  const project = projectResult.data;
  const contractValue =
    Number(project?.commercial_value_cents ?? project?.fixed_fee_cents ?? 0) /
    100;

  const metrics = [
    { label: "Logged time", value: `${hours.toFixed(1)}h`, icon: Clock3 },
    {
      label: "Approved unbilled",
      value: currency(unbilled),
      icon: Gauge,
    },
    { label: "Invoiced", value: currency(billed), icon: Banknote },
    ...(margin !== undefined
      ? [
          {
            label: "Gross margin",
            value: `${Math.round(margin)}%`,
            icon: TrendingUp,
          },
        ]
      : []),
    ...(contractValue > 0
      ? [
          {
            label:
              project?.billing_type === "fixed_fee"
                ? "Fixed fee"
                : "Engagement value",
            value: currency(
              contractValue,
              project?.commercial_currency ?? "USD",
            ),
            icon: Landmark,
          },
        ]
      : []),
  ];

  return (
    <section aria-label="Project commercial summary">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold">Commercial summary</h2>
          <p className="text-sm text-muted-foreground">
            Approved time, billings, and delivery economics.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="flex items-start justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">{metric.label}</p>
                <p className="mt-1 text-xl font-semibold">{metric.value}</p>
              </div>
              <metric.icon className="size-4 text-primary" />
            </CardContent>
          </Card>
        ))}
      </div>
      {(retainerResult.data ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Retainers</span>
          {(retainerResult.data ?? []).map((retainer) => (
            <Badge asChild key={retainer.id} variant="secondary">
              <Link href={`/retainers/${retainer.id}`}>{retainer.name}</Link>
            </Badge>
          ))}
        </div>
      )}
    </section>
  );
}

function currency(value: number, code = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(value);
}
