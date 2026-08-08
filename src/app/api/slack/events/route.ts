import { after } from "next/server";

import {
  postSlackNotification,
  verifySlackHttpRequest,
} from "@/lib/integrations/slack";

export const runtime = "nodejs";

interface SlackEvent {
  bot_id?: string;
  channel?: string;
  text?: string;
  ts?: string;
  type?: string;
  user?: string;
}

interface SlackEventEnvelope {
  challenge?: string;
  event?: SlackEvent;
  event_id?: string;
  type?: string;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.SLACK_SIGNING_SECRET) {
    return Response.json(
      { error: "Slack request verification is not configured." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  if (!verifySlackHttpRequest(request, rawBody)) {
    return Response.json({ error: "Invalid Slack signature." }, { status: 401 });
  }

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (payload.type === "url_verification") {
    if (!payload.challenge) {
      return Response.json({ error: "Missing challenge." }, { status: 400 });
    }
    return Response.json({ challenge: payload.challenge });
  }

  // Slack retries acknowledged events when an earlier acknowledgement is lost.
  if (request.headers.has("x-slack-retry-num")) {
    return Response.json({ ok: true });
  }

  const event = payload.event;
  if (
    payload.type === "event_callback" &&
    event?.type === "app_mention" &&
    event.channel &&
    !event.bot_id
  ) {
    after(async () => {
      try {
        await postSlackNotification({
          channel: event.channel!,
          threadTs: event.ts,
          text: "Use `/pm my tasks`, `/pm project status Project name`, or `/pm create task Project name | Task title`.",
        });
      } catch (error) {
        console.error("Slack app mention response failed", {
          eventId: payload.event_id,
          error,
        });
      }
    });
  }

  return Response.json({ ok: true });
}
