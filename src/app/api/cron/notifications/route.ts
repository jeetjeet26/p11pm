import {
  isRetryableSlackError,
  postSlackNotification,
  SlackApiError,
  type SlackBlock,
} from "@/lib/integrations/slack";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  boundedBatchSize,
  isCronRequestAuthorized,
} from "@/lib/uploads/cron-auth";

export const runtime = "nodejs";

type ClaimedNotification = {
  id: string;
  channel: string;
  payload: Record<string, unknown>;
  attempt_count: number;
  lock_token: string;
};

function messageBlocks(value: unknown): SlackBlock[] | undefined {
  return Array.isArray(value)
    ? value.filter(
        (block): block is SlackBlock =>
          Boolean(
            block &&
              typeof block === "object" &&
              "type" in block &&
              typeof block.type === "string",
          ),
      )
    : undefined;
}

async function runNotificationWorker(request: Request) {
  if (!isCronRequestAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json(
      { error: "Supabase service role is not configured." },
      { status: 503 },
    );
  }

  const batchSize = boundedBatchSize(
    new URL(request.url).searchParams.get("batchSize"),
    25,
    100,
  );
  const { data, error } = await admin.rpc("claim_slack_notifications", {
    requested_limit: batchSize,
    lease_seconds: 120,
  });
  if (error) {
    console.error("Claim Slack notifications failed:", error);
    return Response.json(
      { error: "Could not claim notifications." },
      { status: 500 },
    );
  }

  const claimed = (Array.isArray(data) ? data : []) as ClaimedNotification[];
  const summary = {
    claimed: claimed.length,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
    leaseErrors: 0,
  };

  for (const notification of claimed) {
    try {
      const text = notification.payload.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new SlackApiError(
          "Slack outbox payload is missing text.",
          400,
          "invalid_payload",
        );
      }

      await postSlackNotification({
        channel: notification.channel,
        text,
        blocks: messageBlocks(notification.payload.blocks),
        threadTs:
          typeof notification.payload.threadTs === "string"
            ? notification.payload.threadTs
            : undefined,
        clientMessageId: notification.id,
      });
      const acknowledged = await admin.rpc("ack_slack_notification", {
        notification_id: notification.id,
        notification_lock_token: notification.lock_token,
      });
      if (acknowledged.error || acknowledged.data !== true) {
        summary.leaseErrors += 1;
        console.error("Acknowledge Slack notification failed:", {
          id: notification.id,
          error: acknowledged.error,
        });
      } else {
        summary.delivered += 1;
      }
    } catch (deliveryError) {
      const message =
        deliveryError instanceof Error
          ? deliveryError.message
          : "Unknown Slack delivery error";
      const code =
        deliveryError instanceof SlackApiError
          ? deliveryError.code
          : undefined;

      if (!isRetryableSlackError(deliveryError)) {
        const deadLettered = await admin.rpc(
          "dead_letter_slack_notification",
          {
            notification_id: notification.id,
            notification_lock_token: notification.lock_token,
            failure_message: message,
            failure_code: code ?? null,
          },
        );
        if (deadLettered.error || deadLettered.data !== true) {
          summary.leaseErrors += 1;
        } else {
          summary.deadLettered += 1;
          console.error("Slack notification dead-lettered:", {
            id: notification.id,
            code,
            attemptCount: notification.attempt_count,
          });
        }
        continue;
      }

      const failed = await admin.rpc("fail_slack_notification", {
        notification_id: notification.id,
        notification_lock_token: notification.lock_token,
        failure_message: message,
        failure_code: code ?? null,
        retry_after_seconds:
          deliveryError instanceof SlackApiError
            ? (deliveryError.retryAfterSeconds ?? null)
            : null,
      });
      if (failed.error) {
        summary.leaseErrors += 1;
      } else if (failed.data === "dead") {
        summary.deadLettered += 1;
      } else {
        summary.retried += 1;
      }
    }
  }

  return Response.json(summary, {
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  return runNotificationWorker(request);
}

export async function POST(request: Request) {
  return runNotificationWorker(request);
}
