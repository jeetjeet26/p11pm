import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

const SLACK_SIGNATURE_VERSION = "v0";
const MAX_SLACK_REQUEST_AGE_SECONDS = 5 * 60;

export interface SlackVerificationInput {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  signingSecret?: string;
  now?: number;
}

export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface SlackNotification {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  threadTs?: string;
  clientMessageId?: string;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

const PERMANENT_SLACK_ERRORS = new Set([
  "account_inactive",
  "channel_not_found",
  "invalid_auth",
  "invalid_blocks",
  "invalid_payload",
  "is_archived",
  "msg_too_long",
  "no_text",
  "not_authed",
  "not_in_channel",
  "token_revoked",
]);

export class SlackApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SlackApiError";
  }
}

export function isRetryableSlackError(error: unknown) {
  if (!(error instanceof SlackApiError)) return true;
  if (error.status === 429 || error.status >= 500) return true;
  return !error.code || !PERMANENT_SLACK_ERRORS.has(error.code);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifySlackRequest({
  rawBody,
  signature,
  timestamp,
  signingSecret = process.env.SLACK_SIGNING_SECRET ?? "",
  now = Date.now(),
}: SlackVerificationInput): boolean {
  if (!signingSecret || !signature || !timestamp || !/^\d+$/.test(timestamp)) {
    return false;
  }

  const requestTime = Number(timestamp);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(requestTime) ||
    Math.abs(nowSeconds - requestTime) > MAX_SLACK_REQUEST_AGE_SECONDS
  ) {
    return false;
  }

  const base = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac(
    "sha256",
    signingSecret,
  )
    .update(base, "utf8")
    .digest("hex")}`;

  return safeEqual(expected, signature);
}

export function verifySlackHttpRequest(
  request: Request,
  rawBody: string,
): boolean {
  return verifySlackRequest({
    rawBody,
    signature: request.headers.get("x-slack-signature"),
    timestamp: request.headers.get("x-slack-request-timestamp"),
  });
}

export async function callSlackApi<T extends SlackApiResponse>(
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error("Slack is not configured. Set SLACK_BOT_TOKEN.");
  }

  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const result = (await response.json().catch(() => ({
    ok: false,
    error: "invalid_response",
  }))) as T;
  if (!response.ok || !result.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds =
      retryAfterHeader && /^\d+$/.test(retryAfterHeader)
        ? Math.min(Number(retryAfterHeader), 86_400)
        : undefined;
    console.error("Slack API request failed", {
      method,
      status: response.status,
      error: result.error,
    });
    throw new SlackApiError(
      `Slack API ${method} failed${result.error ? `: ${result.error}` : "."}`,
      response.status,
      result.error,
      retryAfterSeconds,
    );
  }

  return result;
}

export async function postSlackNotification({
  channel,
  text,
  blocks,
  threadTs,
  clientMessageId,
}: SlackNotification): Promise<void> {
  await callSlackApi("chat.postMessage", {
    channel,
    text,
    ...(blocks ? { blocks } : {}),
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(clientMessageId ? { client_msg_id: clientMessageId } : {}),
  });
}

export async function respondToSlackCommand(
  responseUrl: string,
  payload: {
    text: string;
    response_type?: "ephemeral" | "in_channel";
    blocks?: SlackBlock[];
  },
): Promise<void> {
  const url = new URL(responseUrl);
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com") {
    throw new Error("Slack response URL is invalid.");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Slack command response failed", { status: response.status });
    throw new Error("Unable to send the Slack command response.");
  }
}

export function isSlackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_SIGNING_SECRET && process.env.SLACK_BOT_TOKEN,
  );
}
