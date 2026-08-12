#!/usr/bin/env node

import process from "node:process";

const REQUIRED_EXTERNAL_CHECKS = [
  {
    id: "supabase_pitr_enabled",
    description: "Confirm Supabase Point-in-Time Recovery is enabled for the production project.",
    status: "manual_required",
  },
  {
    id: "supabase_storage_backups",
    description: "Confirm storage bucket backups/replication policy for project-files and workspace-chat-files.",
    status: "manual_required",
  },
  {
    id: "restore_drill_completed",
    description: "Run an isolated restore drill and attach evidence to the DR runbook template.",
    status: "manual_required",
  },
];

function parseArgs(argv) {
  const options = {
    projectRef: process.env.SUPABASE_PROJECT_REF ?? "",
    pitrEnabled: process.env.SUPABASE_PITR_ENABLED ?? "",
    storageBackupPolicy: process.env.SUPABASE_STORAGE_BACKUP_POLICY ?? "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-ref") options.projectRef = argv[++index] ?? "";
    else if (arg === "--pitr-enabled") options.pitrEnabled = argv[++index] ?? "";
    else if (arg === "--storage-backup-policy") {
      options.storageBackupPolicy = argv[++index] ?? "";
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = REQUIRED_EXTERNAL_CHECKS.map((check) => ({ ...check }));
  if (options.pitrEnabled) {
    const enabled = options.pitrEnabled.toLowerCase() === "true";
    checks[0] = {
      ...checks[0],
      status: enabled ? "pass" : "fail",
      observed: enabled,
      note: enabled
        ? "PITR flag supplied by operator."
        : "PITR flag explicitly false; do not assume recovery coverage.",
    };
  }
  if (options.storageBackupPolicy) {
    checks[1] = {
      ...checks[1],
      status: "pass",
      observed: options.storageBackupPolicy,
    };
  }
  const unresolved = checks.filter((check) => check.status === "manual_required");
  const report = {
    generatedAt: new Date().toISOString(),
    projectRef: options.projectRef || null,
    rpoTargetMinutes: 60,
    rtoTargetMinutes: 240,
    checks,
    summary: {
      pass: checks.filter((check) => check.status === "pass").length,
      fail: checks.filter((check) => check.status === "fail").length,
      manualRequired: unresolved.length,
    },
    disclaimer:
      "This script verifies locally supplied evidence only. External Supabase PITR/storage settings must be confirmed in the Supabase dashboard or API before cutover.",
    ready: unresolved.length === 0 && checks.every((check) => check.status !== "fail"),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
