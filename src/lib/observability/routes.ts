const STATIC_ROUTES = new Set([
  "/",
  "/activity",
  "/admin",
  "/chat",
  "/dashboard",
  "/invite",
  "/login",
  "/my-work",
  "/projects",
  "/team",
  "/api/admin/bootstrap",
  "/api/auth/accept-invite",
  "/api/auth/demo",
  "/api/auth/logout",
  "/api/chat",
  "/api/cron/cleanup",
  "/api/cron/notifications",
  "/api/docs",
  "/api/files",
  "/api/mcp",
  "/api/messages",
  "/api/slack/commands",
  "/api/slack/events",
  "/api/slack/interactions",
  "/api/subtasks",
  "/api/telemetry",
  "/api/todos",
  "/api/workspace-chat/attachments",
  "/api/workspace-chat/bootstrap",
  "/api/workspace-chat/conversations",
  "/api/workspace-chat/messages",
  "/api/workspace-chat/read",
  "/api/workspace-chat/sync",
  "/api/workspace-chat/thread-read",
  "/auth/callback",
]);

function pathnameOf(value: string): string {
  const withoutRouteGroups = value.replace(/\/\([^/]+\)/g, "");
  try {
    return new URL(withoutRouteGroups, "https://telemetry.invalid").pathname;
  } catch {
    return "/";
  }
}

export function normalizeRoute(value: string): string {
  const pathname = pathnameOf(value).replace(/\/+$/, "") || "/";
  if (STATIC_ROUTES.has(pathname)) return pathname;
  if (/^\/projects\/[^/]+$/.test(pathname)) return "/projects/[projectId]";
  if (/^\/chat\/.+$/.test(pathname)) return "/chat/[conversationId]";
  if (/^\/api\/files\/[^/]+$/.test(pathname)) return "/api/files/[fileId]";
  if (/^\/api\/files\/uploads\/[^/]+$/.test(pathname)) {
    return "/api/files/uploads/[reservationId]";
  }
  if (/^\/api\/admin\/profiles\/[^/]+$/.test(pathname)) {
    return "/api/admin/profiles/[profileId]";
  }
  if (/^\/api\/workspace-chat\/attachments\/[^/]+$/.test(pathname)) {
    return "/api/workspace-chat/attachments/[attachmentId]";
  }
  if (
    /^\/api\/workspace-chat\/attachments\/uploads\/[^/]+$/.test(pathname)
  ) {
    return "/api/workspace-chat/attachments/uploads/[reservationId]";
  }
  if (
    /^\/api\/workspace-chat\/conversations\/[^/]+\/members$/.test(pathname)
  ) {
    return "/api/workspace-chat/conversations/[conversationId]/members";
  }
  return "/other";
}

export function sanitizeTelemetryUrl(value: string): string {
  const route = normalizeRoute(value);
  try {
    const url = new URL(value, "https://telemetry.invalid");
    return `${url.origin === "https://telemetry.invalid" ? "" : url.origin}${route}`;
  } catch {
    return route;
  }
}
