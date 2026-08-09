import { describe, expect, it } from "vitest";

import { normalizeRoute, sanitizeTelemetryUrl } from "./routes";

describe("observability route normalization", () => {
  it("removes identifiers and query strings from known dynamic routes", () => {
    expect(normalizeRoute("/projects/8b6d9cc4?token=secret")).toBe(
      "/projects/[projectId]",
    );
    expect(normalizeRoute("/chat/private-conversation#thread")).toBe(
      "/chat/[conversationId]",
    );
    expect(normalizeRoute("/archive/private-project?from=2020-01-01")).toBe(
      "/archive/[projectId]",
    );
    expect(normalizeRoute("/api/archive/files/private-entry")).toBe(
      "/api/archive/files/[entryId]",
    );
  });

  it("normalizes Next route groups and API identifiers", () => {
    expect(normalizeRoute("/(workspace)/team")).toBe("/team");
    expect(
      normalizeRoute(
        "/api/workspace-chat/conversations/room-id/members?email=x@example.com",
      ),
    ).toBe("/api/workspace-chat/conversations/[conversationId]/members");
    expect(normalizeRoute("/api/files/uploads/private-reservation")).toBe(
      "/api/files/uploads/[reservationId]",
    );
    expect(
      normalizeRoute(
        "/api/workspace-chat/attachments/uploads/private-reservation",
      ),
    ).toBe("/api/workspace-chat/attachments/uploads/[reservationId]");
  });

  it("collapses unknown paths instead of leaking their segments", () => {
    expect(normalizeRoute("/customer/acme-private-record")).toBe("/other");
  });

  it("preserves only origin and normalized route in telemetry URLs", () => {
    expect(
      sanitizeTelemetryUrl(
        "https://pm.example.com/projects/internal-id?invite=secret#details",
      ),
    ).toBe("https://pm.example.com/projects/[projectId]");
  });
});
