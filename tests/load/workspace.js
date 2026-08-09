import { check, group, sleep } from "k6";
import http from "k6/http";
import { Rate, Trend } from "k6/metrics";

import {
  BASE_URL,
  captureResponseCookies,
  headersForVirtualUser,
  requireSessionCapacity,
} from "./lib/config.js";

const profile = __ENV.K6_PROFILE || "target";
const profileConfiguration = {
  target: {
    scenario: {
      executor: "per-vu-iterations",
      iterations: 1,
      maxDuration: "2m",
      vus: 33,
    },
    virtualUsers: 33,
  },
  navigation: {
    scenario: {
      duration: "60s",
      executor: "constant-vus",
      gracefulStop: "15s",
      vus: 33,
    },
    virtualUsers: 33,
  },
  burst: {
    scenario: {
      duration: "5m",
      executor: "constant-vus",
      gracefulStop: "30s",
      vus: 66,
    },
    virtualUsers: 66,
  },
  soak: {
    scenario: {
      duration: "60m",
      executor: "constant-vus",
      gracefulStop: "60s",
      vus: 33,
    },
    virtualUsers: 33,
  },
};

if (!profileConfiguration[profile]) {
  throw new Error(`Unknown K6_PROFILE: ${profile}`);
}

const selected = profileConfiguration[profile];
const serverErrors = new Rate("server_errors");
const authenticatedTtfb = new Trend("authenticated_ttfb", true);

export const options = {
  scenarios: {
    [profile]: selected.scenario,
  },
  systemTags: [
    "status",
    "method",
    "name",
    "group",
    "check",
    "scenario",
    "expected_response",
  ],
  thresholds: {
    authenticated_ttfb: ["p(95)<800", "p(99)<1500"],
    checks: ["rate==1"],
    http_req_failed: ["rate<0.001"],
    server_errors: ["rate<0.001"],
  },
};

export function setup() {
  requireSessionCapacity(selected.virtualUsers);
  return { profile };
}

function readRoute(route, headers, routeTag = route) {
  const response = http.get(`${BASE_URL}${route}`, {
    headers,
    redirects: 0,
    tags: { name: routeTag, route: routeTag },
  });
  captureResponseCookies(response);
  serverErrors.add(response.status >= 500);
  authenticatedTtfb.add(response.timings.waiting, { route: routeTag });
  check(response, {
    [`${routeTag} returned 200`]: (result) => result.status === 200,
  });
}

export default function workspaceScenario() {
  const headers = headersForVirtualUser();

  group("bounded workspace navigation", () => {
    readRoute("/dashboard", headers);
    readRoute("/projects", headers);
    if (__ENV.K6_PROJECT_ID) {
      readRoute(
        `/projects/${encodeURIComponent(__ENV.K6_PROJECT_ID)}`,
        headers,
        "/projects/[projectId]",
      );
    }
    readRoute("/team", headers);
    readRoute("/chat", headers);
  });

  if (__ENV.K6_CHAT_CONVERSATION_ID) {
    const route = `/api/workspace-chat/messages?conversationId=${encodeURIComponent(
      __ENV.K6_CHAT_CONVERSATION_ID,
    )}`;
    const response = http.get(`${BASE_URL}${route}`, {
      headers,
      redirects: 0,
      tags: {
        name: "/api/workspace-chat/messages",
        route: "/api/workspace-chat/messages",
      },
    });
    captureResponseCookies(response);
    serverErrors.add(response.status >= 500);
    check(response, {
      "chat page is authorized": (result) => result.status === 200,
    });
  }

  if (profile !== "target") sleep(1);
}
