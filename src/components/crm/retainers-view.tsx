import {
  AlertTriangle,
  CalendarRange,
  Clock3,
  Gauge,
  Repeat2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { RetainerPeriodManager } from "./retainer-period-manager";
import type { CrmRetainer, RetainerDetailData } from "./types";

export function RetainersList({ retainers }: { retainers: CrmRetainer[] }) {
  if (!retainers.length) {
    return (
      <Card>
        <CardContent className="py-14 text-center">
          <Repeat2 className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No retainers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a recurring agreement to track allowance, usage, and value.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {retainers.map((retainer) => {
        const burn = ratio(retainer.loggedHours, retainer.allowanceHours);
        const over = retainer.projectedHours
          ? Math.max(0, retainer.projectedHours - retainer.allowanceHours)
          : 0;
        return (
          <Link className="group outline-none" href={`/retainers/${retainer.id}`} key={retainer.id}>
            <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:ring-foreground/20 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {retainer.clientName || "Client"}
                  </p>
                  <CardTitle className="mt-1">{retainer.name}</CardTitle>
                </div>
                <Badge variant={burn > 100 ? "destructive" : "secondary"}>
                  {retainer.status || "active"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span>{formatHours(retainer.loggedHours)} logged</span>
                    <span className="text-muted-foreground">
                      {formatHours(retainer.allowanceHours)} allowance
                    </span>
                  </div>
                  <Progress
                    aria-label={`${Math.round(burn)} percent of allowance used`}
                    className={cn(burn > 100 && "[&_[data-slot=progress-indicator]]:bg-destructive")}
                    value={Math.min(100, burn)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3 border-t pt-4 text-xs">
                  <MiniMetric label="Burn" value={`${Math.round(burn)}%`} />
                  <MiniMetric label="Projected over" value={formatHours(over)} />
                  <MiniMetric
                    label={`${retainer.cadence ?? "period"} value`}
                    value={formatCurrency(retainer.value ?? 0, retainer.currency ?? undefined)}
                  />
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

export function RetainerDetail({
  canManage = false,
  data,
}: {
  canManage?: boolean;
  data: RetainerDetailData;
}) {
  const { retainer, periods } = data;
  const burn = ratio(retainer.loggedHours, retainer.allowanceHours);
  const projected = retainer.projectedHours ?? retainer.loggedHours;
  const overage = Math.max(0, projected - retainer.allowanceHours);
  const periodLabel =
    retainer.periodStart && retainer.periodEnd
      ? `${formatDate(retainer.periodStart)} – ${formatDate(retainer.periodEnd)}`
      : "Current service period";

  return (
    <div className="space-y-6">
      {overage > 0 && (
        <Card className="bg-destructive/5 ring-destructive/20">
          <CardContent className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">Projected allowance overage</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Current pace projects {formatHours(overage)} beyond this period’s allowance.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" /> {periodLabel}
          </p>
          <CardTitle>Current period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat icon={Clock3} label="Allowance" value={formatHours(retainer.allowanceHours)} />
            <Stat icon={Gauge} label="Logged" value={formatHours(retainer.loggedHours)} />
            <Stat icon={Repeat2} label="Billable" value={formatHours(retainer.billableHours)} />
            <Stat icon={TrendingUp} label="Projected over" value={formatHours(overage)} warning={overage > 0} />
            <Stat icon={WalletCards} label="Fixed period value" value={formatCurrency(retainer.value ?? 0, retainer.currency ?? undefined)} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">{Math.round(burn)}% consumed</span>
              <span className="text-muted-foreground">
                {formatHours(Math.max(0, retainer.allowanceHours - retainer.loggedHours))} remaining
              </span>
            </div>
            <Progress
              aria-label={`${Math.round(burn)} percent of allowance used`}
              className={cn("h-2", burn > 100 && "[&_[data-slot=progress-indicator]]:bg-destructive")}
              value={Math.min(100, burn)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contract terms</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Term label="Cadence" value={titleCase(retainer.cadence ?? "monthly")} />
          <Term
            label="Fixed value"
            value={`${formatCurrency(retainer.value ?? 0, retainer.currency ?? undefined)} / ${retainer.cadence ?? "period"}`}
          />
          <Term
            label="Overage"
            value={
              retainer.hourlyRate === null || retainer.hourlyRate === undefined
                ? "Not billed"
                : `${formatCurrency(retainer.hourlyRate, retainer.currency ?? undefined)} / hour`
            }
          />
          <Term
            label="Renewal / end"
            value={retainer.endDate ? formatDate(retainer.endDate) : "Ongoing"}
          />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Period history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Source periods, allowance performance, locks, and forecast.
            </p>
          </div>
          {canManage ? <RetainerPeriodManager retainerId={retainer.id} /> : null}
        </div>
        {periods.length ? (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Period</TableHead>
                  <TableHead>Allowance</TableHead>
                  <TableHead>Logged</TableHead>
                  <TableHead>Billable</TableHead>
                  <TableHead>Forecast</TableHead>
                  <TableHead>Burn</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Value</TableHead>
                  {canManage ? <TableHead><span className="sr-only">Actions</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => {
                  const periodBurn = ratio(period.loggedHours, period.allowanceHours);
                  return (
                    <TableRow key={period.id}>
                      <TableCell className="pl-4 font-medium">
                        {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
                      </TableCell>
                      <TableCell>{formatHours(period.allowanceHours)}</TableCell>
                      <TableCell>{formatHours(period.loggedHours)}</TableCell>
                      <TableCell>{formatHours(period.billableHours)}</TableCell>
                      <TableCell>
                        {formatHours(period.forecastHours ?? period.projectedHours ?? period.loggedHours)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={periodBurn > 100 ? "destructive" : "secondary"}>
                          {Math.round(periodBurn)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline">{period.status ?? "planned"}</Badge>
                          {period.invoicedAt ? <Badge>Invoiced</Badge> : period.lockedAt ? <Badge variant="secondary">Locked</Badge> : null}
                          {period.externalId ? <Badge variant="outline">Imported</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="pr-4 text-right font-mono">
                        {formatCurrency(period.value ?? 0, retainer.currency ?? undefined)}
                      </TableCell>
                      {canManage ? (
                        <TableCell>
                          <RetainerPeriodManager period={period} retainerId={retainer.id} />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        ) : (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Period history will appear after the first rollover.</CardContent></Card>
        )}
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value, warning }: { icon: typeof Clock3; label: string; value: string; warning?: boolean }) {
  return <div className="rounded-lg bg-muted/40 p-3"><Icon className={cn("size-4 text-muted-foreground", warning && "text-destructive")} /><p className={cn("mt-3 text-xl font-semibold", warning && "text-destructive")}>{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>;
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return <div><p className="font-semibold">{value}</p><p className="mt-0.5 text-muted-foreground">{label}</p></div>;
}

function Term({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function ratio(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function formatHours(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

function formatCurrency(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
