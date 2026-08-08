import exec from "k6/execution";

const baseUrl = (__ENV.K6_BASE_URL || "").replace(/\/$/, "");

if (!baseUrl) {
  throw new Error("K6_BASE_URL is required.");
}
if (!/^https?:\/\/[^/?#]+(?::\d+)?$/.test(baseUrl)) {
  throw new Error("K6_BASE_URL must be an origin without a path or query.");
}

function loadSessions() {
  if (__ENV.K6_SESSION_FILE) {
    const parsed = JSON.parse(open(__ENV.K6_SESSION_FILE));
    if (
      !Array.isArray(parsed) ||
      parsed.some((value) => typeof value !== "string" || !value.includes("="))
    ) {
      throw new Error("K6_SESSION_FILE must contain a JSON array of Cookie headers.");
    }
    return parsed;
  }
  return __ENV.K6_SESSION_COOKIE ? [__ENV.K6_SESSION_COOKIE] : [];
}

export const BASE_URL = baseUrl;
export const SESSIONS = loadSessions();

export function deploymentProtectionHeaders() {
  const protectionBypass = (
    __ENV.K6_VERCEL_AUTOMATION_BYPASS_SECRET || ""
  ).trim();
  return protectionBypass
    ? { "x-vercel-protection-bypass": protectionBypass }
    : {};
}

export function headersForVirtualUser() {
  const protectionHeaders = deploymentProtectionHeaders();
  if (SESSIONS.length === 0 && Object.keys(protectionHeaders).length === 0) {
    return {};
  }
  const index =
    SESSIONS.length > 0 ? (exec.vu.idInTest - 1) % SESSIONS.length : 0;
  return {
    ...(SESSIONS.length > 0 ? { Cookie: SESSIONS[index] } : {}),
    ...protectionHeaders,
    "x-load-test": "p11-staging",
  };
}

export function requireSessionCapacity(virtualUsers) {
  if (SESSIONS.length === 0) {
    throw new Error(
      "Authenticated load requires K6_SESSION_FILE or K6_SESSION_COOKIE.",
    );
  }
  if (
    SESSIONS.length < virtualUsers &&
    __ENV.K6_ALLOW_SHARED_SESSION !== "true"
  ) {
    throw new Error(
      `Profile requires ${virtualUsers} sessions; received ${SESSIONS.length}. ` +
        "Set K6_ALLOW_SHARED_SESSION=true only for a non-certifying smoke run.",
    );
  }
}
