import { registerOTel } from "@vercel/otel";

import { SafeAttributeSpanProcessor } from "@/lib/observability/otel";

export function register() {
  // Next's default fetch spans include full outbound URLs. Those URLs can hold
  // signed Storage tokens or record identifiers, so route/RPC spans remain on
  // while automatic fetch spans stay disabled.
  process.env.NEXT_OTEL_FETCH_DISABLED = "1";

  registerOTel({
    serviceName: "p11-pm",
    attributes: {
      "service.namespace": "p11",
    },
    attributesFromHeaders: () => ({}),
    instrumentations: [],
    spanProcessors: [new SafeAttributeSpanProcessor(), "auto"],
  });
}
