export function roundTimeMinutes(minutes: number, increment: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  const safeIncrement =
    Number.isInteger(increment) && increment > 0 ? increment : 1;
  return Math.min(1_440, Math.ceil(minutes / safeIncrement) * safeIncrement);
}

export function forecastPeriodMinutes({
  usedMinutes,
  manualForecastMinutes,
  periodStart,
  periodEnd,
  now = new Date(),
}: {
  usedMinutes: number;
  manualForecastMinutes?: number | null;
  periodStart: string;
  periodEnd: string;
  now?: Date;
}) {
  if (
    manualForecastMinutes !== null &&
    manualForecastMinutes !== undefined &&
    Number.isFinite(manualForecastMinutes)
  ) {
    return Math.max(0, manualForecastMinutes);
  }
  const start = new Date(`${periodStart}T00:00:00Z`).getTime();
  const end = new Date(`${periodEnd}T00:00:00Z`).getTime();
  const current = now.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || current <= start) {
    return Math.max(0, usedMinutes);
  }
  if (current >= end) return Math.max(0, usedMinutes);
  const elapsed = Math.max(1, current - start);
  const duration = Math.max(elapsed, end - start + 86_400_000);
  return Math.round(Math.max(0, usedMinutes) * (duration / elapsed));
}

export function capacitySignal(allocationPercent: number) {
  if (allocationPercent > 100) return "over" as const;
  if (allocationPercent >= 85) return "near" as const;
  return "available" as const;
}
