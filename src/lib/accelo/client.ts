import "server-only";

import { z } from "zod";

import {
  ACCELO_READ_ONLY_SCOPE,
  acceloBusinessResourceSchema,
  acceloCollectionSchema,
  acceloRawRecordSchema,
  type AcceloBusinessResource,
  type AcceloPage,
  type AcceloPageRequest,
  type AcceloRecordRequest,
} from "@/lib/accelo/types";

const TOKEN_REFRESH_SKEW_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

const tokenSchema = z
  .object({
    access_token: z.string().min(1).max(16_384),
    expires_in: z.coerce.number().int().min(1).max(86_400).optional(),
  })
  .passthrough();

const querySchema = z
  .object({
    _limit: z.coerce.number().int().min(1).max(100).optional(),
    _page: z.coerce.number().int().min(0).max(100_000).optional(),
    _fields: z.string().min(1).max(4_000).optional(),
    _filters: z.string().min(1).max(8_000).optional(),
    _search: z.string().min(1).max(500).optional(),
  })
  .strict();

const sourceRecordIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[A-Za-z0-9._~-]+$/);

const singleRecordResponseSchema = z
  .object({
    response: z.union([
      acceloRawRecordSchema,
      z.array(acceloRawRecordSchema).length(1).transform(([record]) => record),
    ]),
  })
  .passthrough();

type Fetch = typeof fetch;
type QueryValue = string | number | boolean | undefined;
export type AcceloQuery = Record<string, QueryValue>;

export interface AcceloTelemetryEvent {
  event: "request" | "retry" | "rate_limit";
  resource: AcceloBusinessResource | "token" | "tokeninfo";
  endpoint?:
    | "resource_collection"
    | "resource_record"
    | "contract_collection"
    | "contract_period_collection"
    | "contract_period_record";
  outcome: "success" | "error" | "retry";
  attempt: number;
  status?: number;
  upstreamError?: string;
  statusClass?: "2xx" | "4xx" | "5xx" | "network";
  durationMs?: number;
}

export interface AcceloClientOptions {
  deployment?: string;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: Fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  telemetry?: (event: AcceloTelemetryEvent) => void;
}

export class AcceloClientError extends Error {
  constructor(
    message: string,
    readonly code:
      | "configuration"
      | "invalid_request"
      | "invalid_response"
      | "timeout"
      | "upstream",
    readonly status: number | null = null,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AcceloClientError";
  }
}

export class AcceloClient {
  private readonly deployment: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: Fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly telemetry: (event: AcceloTelemetryEvent) => void;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(options: AcceloClientOptions = {}) {
    this.deployment = normalizeDeployment(
      options.deployment ?? requiredEnv("ACCELO_DEPLOYMENT"),
    );
    this.clientId = options.clientId ?? requiredEnv("ACCELO_CLIENT_ID");
    this.clientSecret =
      options.clientSecret ?? requiredEnv("ACCELO_CLIENT_SECRET");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      1_000,
      60_000,
    );
    this.maxAttempts = boundedInteger(
      options.maxAttempts,
      DEFAULT_MAX_ATTEMPTS,
      1,
      6,
    );
    this.telemetry = options.telemetry ?? emitTelemetry;
  }

  async get<T = unknown>(
    resourceInput: AcceloBusinessResource,
    query: AcceloQuery = {},
  ): Promise<T> {
    const resource = parseBusinessResource(resourceInput);
    const normalizedQuery = parseQuery(query);
    return (await this.requestBusinessResource(
      resource,
      normalizedQuery,
    )) as T;
  }

  async getPage(
    resourceInput: AcceloBusinessResource,
    request: AcceloPageRequest = {},
  ): Promise<AcceloPage> {
    const resource = parseBusinessResource(resourceInput);
    const page = boundedInteger(request.page, 0, 0, 100_000);
    const pageSize = boundedInteger(request.pageSize, 100, 1, 100);
    if (resource === "contract_periods") {
      return this.getContractPeriodsPage(page, request.fields);
    }
    const payload = await this.requestBusinessResource(resource, {
      _limit: pageSize,
      _page: page,
      _fields: request.fields,
      _filters: request.filters,
    });
    return parseCollectionPage(payload, page, pageSize);
  }

  async getRecord(
    resourceInput: AcceloBusinessResource,
    sourceRecordIdInput: string,
    request: AcceloRecordRequest = {},
  ): Promise<Record<string, unknown>> {
    const resource = parseBusinessResource(resourceInput);
    const sourceRecordId = sourceRecordIdSchema.parse(sourceRecordIdInput);
    const query = parseQuery({ _fields: request.fields });
    const payload =
      resource === "contract_periods"
        ? await this.requestResourcePath(
            resource,
            `contracts/periods/${sourceRecordId}`,
            query,
          )
        : await this.requestBusinessResource(resource, query, sourceRecordId);
    const parsed = singleRecordResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AcceloClientError(
        "Accelo returned an invalid single-record response.",
        "invalid_response",
      );
    }
    return parsed.data.response;
  }

  async getReadOnlyStatus(): Promise<Record<string, unknown>> {
    const payload = await this.requestJson(
      "tokeninfo",
      new URL(
        `https://${this.deployment}.api.accelo.com/api/v0/tokeninfo`,
      ),
      `Bearer ${await this.getReadOnlyToken()}`,
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new AcceloClientError(
        "Accelo returned an invalid token status response.",
        "invalid_response",
      );
    }
    return payload as Record<string, unknown>;
  }

  private async requestBusinessResource(
    resource: AcceloBusinessResource,
    query: AcceloQuery,
    sourceRecordId?: string,
  ) {
    return this.requestResourcePath(
      resource,
      `${resource}${sourceRecordId ? `/${sourceRecordId}` : ""}`,
      query,
    );
  }

  private async requestResourcePath(
    resource: AcceloBusinessResource,
    path: string,
    query: AcceloQuery,
  ) {
    const url = new URL(
      `https://${this.deployment}.api.accelo.com/api/v0/${path}`,
    );
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return this.requestJson(
      resource,
      url,
      `Bearer ${await this.getReadOnlyToken()}`,
      endpointLabel(path),
    );
  }

  private async getContractPeriodsPage(
    page: number,
    fields: string | undefined,
  ): Promise<AcceloPage> {
    const contractPayload = await this.requestResourcePath(
      "contract_periods",
      "contracts",
      { _limit: 100, _page: page },
    );
    const contractPage = parseCollectionPage(contractPayload, page, 100);
    if (!contractPage.records.length) {
      return { records: [], hasMore: false, page, total: null };
    }

    const records: Record<string, unknown>[] = [];
    for (const contract of contractPage.records) {
      const contractId = objectId(contract);
      if (!contractId) continue;
      for (let periodPage = 0; periodPage < 100; periodPage += 1) {
        const periodPayload = await this.requestResourcePath(
          "contract_periods",
          `contracts/${contractId}/periods`,
          { _limit: 100, _page: periodPage, _fields: fields },
        );
        const periods = parseCollectionPage(periodPayload, periodPage, 100);
        records.push(
          ...periods.records.map((record) => ({
            ...record,
            contract: record.contract ?? { id: contractId },
            contract_id: record.contract_id ?? contractId,
          })),
        );
        if (!periods.hasMore) break;
        if (periodPage === 99) {
          throw new AcceloClientError(
            "Accelo contract period pagination exceeded its safety bound.",
            "invalid_response",
          );
        }
      }
    }

    return {
      records,
      hasMore: contractPage.hasMore,
      page,
      total: null,
    };
  }

  private async requestJson(
    resource: AcceloBusinessResource | "tokeninfo",
    url: URL,
    authorization: string,
    endpoint?: AcceloTelemetryEvent["endpoint"],
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = this.now();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization,
          },
          cache: "no-store",
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        const retryable = attempt < this.maxAttempts;
        this.telemetry({
          event: retryable ? "retry" : "request",
          resource,
          endpoint,
          outcome: retryable ? "retry" : "error",
          attempt,
          statusClass: "network",
          durationMs: this.now() - startedAt,
        });
        if (!retryable) {
          throw new AcceloClientError(
            isAbortError(error)
              ? "Accelo request timed out."
              : "Accelo request failed.",
            isAbortError(error) ? "timeout" : "upstream",
            null,
            true,
          );
        }
        await this.sleep(this.backoffDelay(attempt, null));
        continue;
      }

      if (response.ok) {
        const payload = await readBoundedJson(response, MAX_RESPONSE_BYTES);
        this.telemetry({
          event: "request",
          resource,
          endpoint,
          outcome: "success",
          attempt,
          statusClass: "2xx",
          durationMs: this.now() - startedAt,
        });
        return payload;
      }

      const retryableStatus =
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599);
      const retryable = retryableStatus && attempt < this.maxAttempts;
      const statusClass = response.status >= 500 ? "5xx" : "4xx";
      const upstreamError = await readUpstreamError(response.clone());
      this.telemetry({
        event:
          response.status === 429
            ? "rate_limit"
            : retryable
              ? "retry"
              : "request",
        resource,
        endpoint,
        outcome: retryable ? "retry" : "error",
        attempt,
        status: response.status,
        upstreamError,
        statusClass,
        durationMs: this.now() - startedAt,
      });
      if (!retryable) {
        throw new AcceloClientError(
          `Accelo ${resource} read failed (${response.status}).`,
          "upstream",
          response.status,
          retryableStatus,
        );
      }
      await this.sleep(
        this.backoffDelay(
          attempt,
          parseRetryAfter(response.headers.get("retry-after"), this.now),
        ),
      );
    }
    throw new AcceloClientError("Accelo request failed.", "upstream");
  }

  private async getReadOnlyToken() {
    if (
      this.cachedToken &&
      this.cachedToken.expiresAt > this.now() + TOKEN_REFRESH_SKEW_MS
    ) {
      return this.cachedToken.value;
    }

    const url = new URL(
      `https://${this.deployment}.api.accelo.com/oauth2/v0/token`,
    );
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: `Basic ${Buffer.from(
              `${this.clientId}:${this.clientSecret}`,
            ).toString("base64")}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: ACCELO_READ_ONLY_SCOPE,
            expires_in: "900",
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        if (attempt >= this.maxAttempts) {
          throw new AcceloClientError(
            isAbortError(error)
              ? "Accelo token request timed out."
              : "Accelo token request failed.",
            isAbortError(error) ? "timeout" : "upstream",
            null,
            true,
          );
        }
        this.telemetry({
          event: "retry",
          resource: "token",
          outcome: "retry",
          attempt,
          statusClass: "network",
        });
        await this.sleep(this.backoffDelay(attempt, null));
        continue;
      }

      if (response.ok) {
        const payload = await readBoundedJson(response, 64 * 1024);
        const token = tokenSchema.safeParse(payload);
        if (!token.success) {
          throw new AcceloClientError(
            "Accelo returned an invalid token response.",
            "invalid_response",
            response.status,
          );
        }
        const lifetime = Math.min(
          900,
          Math.max(60, token.data.expires_in ?? 900),
        );
        this.cachedToken = {
          value: token.data.access_token,
          expiresAt: this.now() + lifetime * 1_000,
        };
        return this.cachedToken.value;
      }

      const retryableStatus =
        response.status === 429 ||
        (response.status >= 500 && response.status <= 599);
      if (!retryableStatus || attempt >= this.maxAttempts) {
        throw new AcceloClientError(
          `Accelo read-only token request failed (${response.status}).`,
          "upstream",
          response.status,
          retryableStatus,
        );
      }
      this.telemetry({
        event: response.status === 429 ? "rate_limit" : "retry",
        resource: "token",
        outcome: "retry",
        attempt,
        statusClass: response.status >= 500 ? "5xx" : "4xx",
      });
      await this.sleep(
        this.backoffDelay(
          attempt,
          parseRetryAfter(response.headers.get("retry-after"), this.now),
        ),
      );
    }
    throw new AcceloClientError("Accelo token request failed.", "upstream");
  }

  private backoffDelay(attempt: number, retryAfterMs: number | null) {
    if (retryAfterMs !== null) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAfterMs));
    }
    const exponential = Math.min(
      MAX_RETRY_DELAY_MS,
      500 * 2 ** Math.max(0, attempt - 1),
    );
    return Math.floor(exponential * (0.75 + this.random() * 0.5));
  }
}

let defaultClient: AcceloClient | null = null;

export async function acceloGet<T>(
  resource: string,
  query: AcceloQuery = {},
): Promise<T> {
  if (resource === "tokeninfo") {
    return (await getDefaultClient().getReadOnlyStatus()) as T;
  }
  const parsedResource = parseBusinessResource(resource);
  return getDefaultClient().get<T>(parsedResource, query);
}

export async function getAcceloReadOnlyStatus() {
  return getDefaultClient().getReadOnlyStatus();
}

function parseCollectionPage(
  payload: unknown,
  page: number,
  pageSize: number,
): AcceloPage {
  const collection = acceloCollectionSchema.safeParse(
    normalizeCollectionPayload(payload),
  );
  if (!collection.success) {
    throw new AcceloClientError(
      "Accelo returned an invalid collection response.",
      "invalid_response",
    );
  }

  const records: Record<string, unknown>[] = [];
  for (const rawRecord of collection.data.response) {
    const record = acceloRawRecordSchema.safeParse(rawRecord);
    if (!record.success) {
      throw new AcceloClientError(
        "Accelo returned an invalid business record.",
        "invalid_response",
      );
    }
    records.push(record.data);
  }

  const meta = collection.data.meta;
  const hasMore =
    meta?.more ??
    (typeof meta?.pages === "number"
      ? page + 1 < meta.pages
      : records.length === pageSize);
  return { records, hasMore, page, total: meta?.total ?? null };
}

function normalizeCollectionPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const envelope = payload as Record<string, unknown>;
  const response = envelope.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return payload;
  }
  const responseRecord = response as Record<string, unknown>;
  const values = Object.values(responseRecord);
  const nestedCollections = values.filter(Array.isArray);
  return {
    ...envelope,
    response:
      "id" in responseRecord
        ? [responseRecord]
        : nestedCollections.length > 0 &&
            nestedCollections.length === values.length
          ? nestedCollections.flat()
          : values,
  };
}

function objectId(record: Record<string, unknown> | undefined) {
  const value = record?.id;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const id = String(value).trim();
  return /^[A-Za-z0-9._~-]+$/.test(id) ? id : null;
}

function endpointLabel(
  path: string,
): NonNullable<AcceloTelemetryEvent["endpoint"]> {
  if (path === "contracts") return "contract_collection";
  if (/^contracts\/periods\/[^/]+$/.test(path)) {
    return "contract_period_record";
  }
  if (/^contracts\/[^/]+\/periods$/.test(path)) {
    return "contract_period_collection";
  }
  return path.includes("/") ? "resource_record" : "resource_collection";
}

function getDefaultClient() {
  defaultClient ??= new AcceloClient();
  return defaultClient;
}

function parseBusinessResource(resource: string) {
  const parsed = acceloBusinessResourceSchema.safeParse(resource);
  if (!parsed.success) {
    throw new AcceloClientError(
      "Unsupported read-only Accelo resource.",
      "invalid_request",
    );
  }
  return parsed.data;
}

function parseQuery(query: AcceloQuery) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    throw new AcceloClientError(
      "Invalid Accelo read query.",
      "invalid_request",
    );
  }
  return parsed.data;
}

export function normalizeDeployment(input: string) {
  const deployment = input
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\.api\.accelo\.com.*$/i, "")
    .replace(/\.accelo\.com.*$/i, "");
  if (!/^[a-z0-9-]+$/.test(deployment)) {
    throw new AcceloClientError(
      "ACCELO_DEPLOYMENT is invalid.",
      "configuration",
    );
  }
  return deployment;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AcceloClientError(
      `${name} is not configured.`,
      "configuration",
    );
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AcceloClientError(
      "Accelo request limit is invalid.",
      "invalid_request",
    );
  }
  return value;
}

export function parseRetryAfter(
  value: string | null,
  now: () => number = Date.now,
) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return Math.min(
      MAX_RETRY_DELAY_MS,
      Math.max(0, Math.ceil(Number(value) * 1_000)),
    );
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - now()));
}

async function readUpstreamError(response: Response) {
  try {
    const text = (await response.text()).slice(0, 1_000);
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }
    const record = payload as Record<string, unknown>;
    const value = record.error ?? record.message ?? record.code;
    const detail =
      typeof value === "string" ? value : JSON.stringify(payload).slice(0, 1_000);
    return detail.replace(/[^\w .,:;()/-]/g, "").slice(0, 200) || undefined;
  } catch {
    return undefined;
  }
}

async function readBoundedJson(response: Response, maximumBytes: number) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AcceloClientError(
      "Accelo response exceeded the size limit.",
      "invalid_response",
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) {
    throw new AcceloClientError(
      "Accelo response exceeded the size limit.",
      "invalid_response",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AcceloClientError(
      "Accelo returned invalid JSON.",
      "invalid_response",
    );
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError" || error.name === "TimeoutError"
      : error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function emitTelemetry(event: AcceloTelemetryEvent) {
  console.info("accelo.client", event);
}
