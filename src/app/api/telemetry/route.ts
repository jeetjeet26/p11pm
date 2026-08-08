import { trace } from "@opentelemetry/api";
import { z } from "zod";

import { normalizeRoute } from "@/lib/observability/routes";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;
const metricSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    name: z.enum(["CLS", "FCP", "INP", "LCP", "TTFB"]),
    value: z.number().finite().nonnegative().max(600_000),
    delta: z.number().finite().min(-600_000).max(600_000),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    navigationType: z
      .enum([
        "navigate",
        "reload",
        "back-forward",
        "back-forward-cache",
        "prerender",
        "restore",
      ])
      .optional(),
    route: z.string().min(1).max(96),
  })
  .strict();

function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin telemetry is not accepted." }, {
      status: 403,
    });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Telemetry payload is too large." }, {
      status: 413,
    });
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Telemetry payload is too large." }, {
      status: 413,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Telemetry payload must be JSON." }, {
      status: 400,
    });
  }
  const parsed = metricSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid telemetry payload." }, {
      status: 400,
    });
  }

  const route = normalizeRoute(parsed.data.route);
  if (route !== parsed.data.route) {
    return Response.json({ error: "Telemetry route must be normalized." }, {
      status: 400,
    });
  }

  trace
    .getTracer("p11-pm-web-vitals")
    .startActiveSpan("web-vital", (span) => {
      span.setAttributes({
        "app.web_vital.name": parsed.data.name,
        "app.web_vital.value": parsed.data.value,
        "app.web_vital.delta": parsed.data.delta,
        "app.web_vital.rating": parsed.data.rating,
        "app.route": route,
        ...(parsed.data.navigationType
          ? { "app.navigation_type": parsed.data.navigationType }
          : {}),
      });
      console.info("web_vital", {
        name: parsed.data.name,
        value: parsed.data.value,
        delta: parsed.data.delta,
        rating: parsed.data.rating,
        navigationType: parsed.data.navigationType ?? null,
        route,
      });
      span.end();
    });

  return new Response(null, {
    status: 202,
    headers: { "cache-control": "no-store" },
  });
}
