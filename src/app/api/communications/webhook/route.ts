import { createHash } from "node:crypto";

import { z } from "zod";

import { getAppSupabaseClient } from "@/lib/integrations/supabase";

const webhookSchema = z.object({
  organizationId: z.string().uuid(),
  provider: z.enum(["resend", "google", "microsoft"]),
  eventId: z.string().min(1).max(200),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: Request) {
  const signature = request.headers.get("x-communication-webhook-signature");
  const secret = process.env.COMMUNICATION_WEBHOOK_SECRET?.trim();
  const rawBody = await request.text();
  if (secret) {
    const expected = createHash("sha256")
      .update(`${secret}:${rawBody}`)
      .digest("hex");
    if (signature !== expected) {
      return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
    }
  }

  const parsed = webhookSchema.safeParse(JSON.parse(rawBody || "{}"));
  if (!parsed.success) {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  const client = getAppSupabaseClient();
  if (!client) {
    return Response.json({ error: "Webhook processing unavailable." }, { status: 503 });
  }

  const { data, error } = await client.rpc("ingest_communication_webhook", {
    target_organization_id: parsed.data.organizationId,
    target_provider: parsed.data.provider,
    target_event_id: parsed.data.eventId,
    target_payload: parsed.data.payload,
  });
  if (error) {
    return Response.json({ error: "Unable to ingest webhook event." }, { status: 500 });
  }

  return Response.json({ event: data, duplicate: Boolean(data) }, { status: 202 });
}
