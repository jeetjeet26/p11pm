#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = { manifestPath: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifestPath = argv[++index] ?? "";
  }
  if (!options.manifestPath) {
    throw new Error("--manifest is required.");
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(options.manifestPath);
  const checksumPath = path.join(path.dirname(manifestPath), "checksum.sha256");
  const manifest = await readFile(manifestPath, "utf8");
  const actual = createHash("sha256").update(manifest).digest("hex");
  let expected = "";
  try {
    const checksumFile = await readFile(checksumPath, "utf8");
    expected = checksumFile.trim().split(/\s+/)[0] ?? "";
  } catch {
    expected = "";
  }
  const parsed = JSON.parse(manifest);
  const rowCounts = Object.fromEntries(
    Object.entries(parsed).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0]),
  );
  const verified = expected ? expected === actual : null;
  const result = {
    manifestPath,
    checksum: actual,
    expectedChecksum: expected || null,
    verified,
    rowCounts,
    status: verified === false ? "checksum_mismatch" : "ok",
  };
  console.log(JSON.stringify(result, null, 2));
  if (verified === false) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
