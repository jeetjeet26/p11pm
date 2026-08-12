#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "organizations",
  "profiles",
  "clients",
  "contacts",
  "projects",
  "invoices",
  "invoice_line_items",
  "payments",
  "payment_allocations",
  "time_entries",
  "source_records",
  "finance_audit_events",
  "production_audit_events",
];

function parseArgs(argv) {
  const options = {
    organizationId: process.env.ORGANIZATION_ID ?? "",
    exportKind: "full",
    outputDir: "exports",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--organization-id") options.organizationId = argv[++index] ?? "";
    else if (arg === "--kind") options.exportKind = argv[++index] ?? "full";
    else if (arg === "--output") options.outputDir = argv[++index] ?? "exports";
  }
  if (!options.organizationId) {
    throw new Error("--organization-id is required.");
  }
  return options;
}

async function exportTable(client, table, organizationId) {
  const query = client.from(table).select("*");
  const filtered =
    table === "organizations"
      ? query.eq("id", organizationId)
      : query.eq("organization_id", organizationId);
  const { data, error } = await filtered.limit(100_000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: exportRun, error: beginError } = await client.rpc(
    "begin_organization_export",
    {
      target_organization_id: options.organizationId,
      target_export_kind: options.exportKind,
      target_requested_by: null,
    },
  );
  if (beginError) throw new Error(beginError.message);

  const manifest = {};
  const rowCounts = {};
  for (const table of TABLES) {
    const rows = await exportTable(client, table, options.organizationId);
    manifest[table] = rows;
    rowCounts[table] = rows.length;
  }

  const serialized = JSON.stringify(manifest);
  const checksum = createHash("sha256").update(serialized).digest("hex");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.resolve(options.outputDir, options.organizationId, stamp);
  await mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "manifest.json");
  const checksumPath = path.join(outputDir, "checksum.sha256");
  await writeFile(manifestPath, serialized);
  await writeFile(checksumPath, `${checksum}  manifest.json\n`);

  const { error: completeError } = await client.rpc("complete_organization_export", {
    target_export_id: exportRun.id,
    target_manifest: {
      path: manifestPath,
      tables: TABLES,
      generated_at: new Date().toISOString(),
    },
    target_checksum_sha256: checksum,
    target_row_counts: rowCounts,
  });
  if (completeError) throw new Error(completeError.message);

  console.log(
    JSON.stringify(
      {
        exportRunId: exportRun.id,
        outputDir,
        checksum,
        rowCounts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
