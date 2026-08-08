import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifySlackRequest } from "@/lib/integrations/slack";

const secret = "test-signing-secret";
const now = 1_800_000_000_000;
const timestamp = String(Math.floor(now / 1000));
const body = "command=%2Fpm&text=my+tasks";
const signature = `v0=${createHmac("sha256", secret)
  .update(`v0:${timestamp}:${body}`)
  .digest("hex")}`;

describe("Slack request verification", () => {
  it("accepts a current request with a valid signature", () => {
    expect(
      verifySlackRequest({
        rawBody: body,
        signature,
        timestamp,
        signingSecret: secret,
        now,
      }),
    ).toBe(true);
  });

  it("rejects a modified body", () => {
    expect(
      verifySlackRequest({
        rawBody: `${body}&tampered=true`,
        signature,
        timestamp,
        signingSecret: secret,
        now,
      }),
    ).toBe(false);
  });

  it("rejects requests outside the five-minute replay window", () => {
    expect(
      verifySlackRequest({
        rawBody: body,
        signature,
        timestamp,
        signingSecret: secret,
        now: now + 301_000,
      }),
    ).toBe(false);
  });
});
