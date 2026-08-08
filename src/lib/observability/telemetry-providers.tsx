"use client";

import {
  Analytics,
  type BeforeSendEvent as AnalyticsEvent,
} from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { useReportWebVitals } from "next/web-vitals";

import { normalizeRoute, sanitizeTelemetryUrl } from "./routes";

type WebVitalsCallback = Parameters<typeof useReportWebVitals>[0];
type SpeedInsightsEvent = {
  route?: string;
  type: "vital";
  url: string;
};

function sanitizeAnalyticsEvent(event: AnalyticsEvent): AnalyticsEvent {
  return { ...event, url: sanitizeTelemetryUrl(event.url) };
}

function sanitizeSpeedInsightsEvent(
  event: SpeedInsightsEvent,
): SpeedInsightsEvent {
  return {
    ...event,
    route: normalizeRoute(event.route ?? event.url),
    url: sanitizeTelemetryUrl(event.url),
  };
}

const reportWebVital: WebVitalsCallback = (metric) => {
  if (process.env.NODE_ENV !== "production") return;
  if (!["CLS", "FCP", "INP", "LCP", "TTFB"].includes(metric.name)) return;

  const body = JSON.stringify({
    schemaVersion: "1.0.0",
    name: metric.name,
    value: metric.value,
    delta: metric.delta,
    rating: metric.rating,
    navigationType: metric.navigationType,
    route: normalizeRoute(window.location.pathname),
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/telemetry",
      new Blob([body], { type: "application/json" }),
    );
    return;
  }
  void fetch("/api/telemetry", {
    body,
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  });
};

export function TelemetryProviders() {
  useReportWebVitals(reportWebVital);

  return (
    <>
      <Analytics beforeSend={sanitizeAnalyticsEvent} />
      <SpeedInsights beforeSend={sanitizeSpeedInsightsEvent} />
    </>
  );
}
