import { describe, expect, it } from "vitest";

import {
  capacitySignal,
  forecastPeriodMinutes,
  roundTimeMinutes,
} from "@/lib/time-workflow";

describe("planning and time workflow calculations", () => {
  it("rounds time up using project increments and caps a day", () => {
    expect(roundTimeMinutes(1, 15)).toBe(15);
    expect(roundTimeMinutes(16, 15)).toBe(30);
    expect(roundTimeMinutes(1_439, 60)).toBe(1_440);
  });

  it("prefers a manager forecast and otherwise forecasts from period pace", () => {
    expect(
      forecastPeriodMinutes({
        usedMinutes: 600,
        manualForecastMinutes: 900,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        now: new Date("2026-08-11T00:00:00Z"),
      }),
    ).toBe(900);
    expect(
      forecastPeriodMinutes({
        usedMinutes: 600,
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        now: new Date("2026-08-11T00:00:00Z"),
      }),
    ).toBeGreaterThan(1_700);
  });

  it("classifies staffing capacity thresholds", () => {
    expect(capacitySignal(50)).toBe("available");
    expect(capacitySignal(85)).toBe("near");
    expect(capacitySignal(101)).toBe("over");
  });
});
