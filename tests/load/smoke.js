import { check } from "k6";
import http from "k6/http";

import { BASE_URL, deploymentProtectionHeaders } from "./lib/config.js";

export const options = {
  scenarios: {
    public_smoke: {
      executor: "shared-iterations",
      iterations: 3,
      maxDuration: "30s",
      vus: 1,
    },
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
    checks: ["rate==1"],
    http_req_duration: ["p(95)<1500"],
    http_req_failed: ["rate<0.001"],
  },
};

export default function publicSmoke() {
  const protectionHeaders = deploymentProtectionHeaders();
  const login = http.get(`${BASE_URL}/login`, {
    headers: protectionHeaders,
    redirects: 0,
  });
  check(login, {
    "login is reachable": (response) => response.status === 200,
  });

  const telemetry = http.post(
    `${BASE_URL}/api/telemetry`,
    JSON.stringify({
      schemaVersion: "1.0.0",
      name: "TTFB",
      value: login.timings.waiting,
      delta: login.timings.waiting,
      rating: "good",
      navigationType: "navigate",
      route: "/login",
    }),
    {
      headers: {
        ...protectionHeaders,
        "content-type": "application/json",
      },
      redirects: 0,
    },
  );
  check(telemetry, {
    "telemetry is accepted": (response) => response.status === 202,
  });
}
