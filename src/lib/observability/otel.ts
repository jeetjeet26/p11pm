import type { AttributeValue } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { normalizeRoute } from "./routes";

const SENSITIVE_ATTRIBUTE =
  /(?:authorization|cookie|body|content|email|file(?:name)?|signed|secret|token|query|statement|http\.target|http\.url|url\.full|url\.query|user\.id|profile\.id|project\.id|conversation\.id|message\.id|attachment\.id|next\.page|next\.segment)/i;
const SAFE_ATTRIBUTE =
  /^(?:app\.(?:navigation_type|route|web_vital\.(?:delta|name|rating|value))|db\.(?:operation(?:\.name)?|system(?:\.name)?)|error\.type|http\.(?:method|request\.method|response\.status_code|route|status_code)|network\.protocol\.(?:name|version)|next\.route|rpc\.(?:method|service|system)|server\.port)$/;
const SENSITIVE_VALUE =
  /(?:https?:\/\/\S+|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|[a-f0-9]{8}-[a-f0-9-]{27,}|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|(?:authorization|cookie|password|secret|signature|token)(?:=|:\s*))/i;

function hasSensitiveValue(value: AttributeValue | undefined): boolean {
  if (typeof value === "string") return SENSITIVE_VALUE.test(value);
  return Array.isArray(value)
    ? value.some(
        (item) => typeof item === "string" && SENSITIVE_VALUE.test(item),
      )
    : false;
}

function redactAttributes(attributes: ReadableSpan["attributes"]): void {
  const mutable = attributes as Record<string, AttributeValue | undefined>;

  for (const key of ["next.route", "http.route", "app.route"]) {
    const value = mutable[key];
    if (typeof value === "string") mutable[key] = normalizeRoute(value);
  }

  for (const key of Object.keys(mutable)) {
    if (
      !SAFE_ATTRIBUTE.test(key) ||
      SENSITIVE_ATTRIBUTE.test(key) ||
      /(?:^|\.)id$/.test(key) ||
      hasSensitiveValue(mutable[key])
    ) {
      delete mutable[key];
    }
  }
}

function redactSpan(span: ReadableSpan | Span): void {
  redactAttributes(span.attributes);
  if (span.status?.message) {
    (span.status as { message?: string }).message = undefined;
  }
  for (const event of span.events) {
    if (SENSITIVE_VALUE.test(event.name)) {
      (event as { name: string }).name = "event";
    }
    if (event.attributes) {
      for (const key of Object.keys(event.attributes)) {
        delete (event.attributes as Record<string, AttributeValue | undefined>)[key];
      }
    }
  }
  for (const link of span.links) redactAttributes(link.attributes ?? {});

  const route =
    typeof span.attributes["next.route"] === "string"
      ? span.attributes["next.route"]
      : typeof span.attributes["http.route"] === "string"
        ? span.attributes["http.route"]
        : null;
  const method =
    typeof span.attributes["http.method"] === "string"
      ? span.attributes["http.method"]
      : null;
  const pathInName = span.name.match(/\s(\/\S*)$/)?.[1];
  const safeRoute = route ?? (pathInName ? normalizeRoute(pathInName) : null);
  const containsUrl = /https?:\/\/\S+/i.test(span.name);
  const isDatabaseSpan = typeof span.attributes["db.system"] === "string";
  const containsSensitiveValue = SENSITIVE_VALUE.test(span.name);
  if (!safeRoute && !containsUrl && !isDatabaseSpan && !containsSensitiveValue) {
    return;
  }

  const safeName = safeRoute
    ? method
      ? `${method} ${safeRoute}`
      : `next ${safeRoute}`
    : isDatabaseSpan
      ? "database request"
      : containsUrl
        ? method
          ? `${method} outbound request`
          : "outbound request"
        : "application operation";
  if ("updateName" in span && typeof span.updateName === "function") {
    span.updateName(safeName);
  } else {
    (span as { name: string }).name = safeName;
  }
}

export class SafeAttributeSpanProcessor implements SpanProcessor {
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onStart(): void {}

  onEnding(span: Span): void {
    redactSpan(span);
  }

  onEnd(span: ReadableSpan): void {
    redactSpan(span);
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
