import { createHash } from "node:crypto";

export function stableUuid(...parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part)).join("\0"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function sourceUuid({
  organizationId,
  accountId,
  entityType,
  sourceId,
}) {
  return stableUuid(
    "basecamp",
    organizationId,
    accountId,
    entityType,
    sourceId,
  );
}

export function manifestSha256(entries) {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  )) {
    hash.update(entry.fileName);
    hash.update("\0");
    hash.update(String(entry.sizeBytes));
    hash.update("\0");
    hash.update(entry.crc32);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function contentObjectPath(organizationId, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("A lowercase SHA-256 digest is required.");
  }
  return `basecamp-blobs/${organizationId}/${sha256.slice(0, 2)}/${sha256}`;
}
