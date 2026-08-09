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
let sessionCookies;

function ensureSessionCookies() {
  if (sessionCookies || SESSIONS.length === 0) return;
  const index = (exec.vu.idInTest - 1) % SESSIONS.length;
  sessionCookies = new Map();
  for (const cookie of SESSIONS[index].split(/;\s*/)) {
    const separator = cookie.indexOf("=");
    if (separator <= 0) continue;
    sessionCookies.set(cookie.slice(0, separator), cookie.slice(separator + 1));
  }
}

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
  ensureSessionCookies();
  return {
    ...(sessionCookies?.size
      ? {
          Cookie: [...sessionCookies.entries()]
            .map(([name, value]) => `${name}=${value}`)
            .join("; "),
        }
      : {}),
    ...protectionHeaders,
    "x-load-test": "p11-staging",
  };
}

export function captureResponseCookies(response) {
  ensureSessionCookies();
  const header = response.headers["Set-Cookie"];
  if (!sessionCookies || !header) return;
  for (const cookie of header.split(/,(?=[^;,]+=)/)) {
    const [pair, ...attributes] = cookie.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const expired = attributes.some(
      (attribute) => attribute.trim().toLowerCase() === "max-age=0",
    );
    if (!value || expired) {
      sessionCookies.delete(name);
    } else {
      sessionCookies.set(name, value);
    }
  }
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
