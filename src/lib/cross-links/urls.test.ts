import { describe, expect, it } from "vitest";

import {
  chatEntityHref,
  parseChatLinkUrl,
  parseWorkLinkUrl,
  workResourceHref,
} from "@/lib/cross-links/urls";

const projectId = "22000000-0000-4000-8000-000000000001";
const issueId = "24000000-0000-4000-8000-000000000001";
const conversationId = "28000000-0000-4000-8000-000000000001";
const messageId = "27000000-0000-4000-8000-000000000001";
const folderId = "26000000-0000-4000-8000-000000000001";

describe("cross-link URLs", () => {
  it("recognizes canonical work URLs", () => {
    expect(
      parseWorkLinkUrl(`/projects/${projectId}/issues/${issueId}`),
    ).toEqual({ type: "issue", id: issueId });
    expect(
      parseWorkLinkUrl(
        `https://app.test/projects/${projectId}?tab=messages&message=${messageId}`,
        "https://app.test",
      ),
    ).toEqual({ type: "message", id: messageId });
    expect(parseWorkLinkUrl(`/files?folderId=${folderId}`)).toEqual({
      type: "folder",
      id: folderId,
    });
  });

  it("rejects a pasted URL from another origin", () => {
    expect(
      parseWorkLinkUrl(
        `https://outside.test/projects/${projectId}`,
        "https://app.test",
      ),
    ).toBeUndefined();
  });

  it("builds exact project and chat deep links", () => {
    expect(workResourceHref("issue", issueId, projectId)).toBe(
      `/projects/${projectId}/issues/${issueId}`,
    );
    expect(
      chatEntityHref({
        conversationId,
        rootMessageId: messageId,
        messageId: issueId,
      }),
    ).toBe(
      `/chat/${conversationId}?thread=${messageId}&message=${issueId}`,
    );
    expect(
      parseChatLinkUrl(`/chat/${conversationId}?thread=${messageId}`),
    ).toEqual({ type: "message", id: messageId });
  });
});
