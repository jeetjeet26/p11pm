#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, lstat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const ALLOWED_ENVIRONMENTS = new Set([
  "ci",
  "preview",
  "staging",
  "production-candidate",
  "production",
]);
const ALLOWED_STATUSES = new Set(["pass", "fail", "not-run"]);

function parseArguments(argv) {
  const options = {
    artifacts: [],
    checks: [],
    environment: "ci",
    output: null,
    requireClean: false,
    requirePassing: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-clean") {
      options.requireClean = true;
      continue;
    }
    const [flag, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (!value || (!inlineValue && value.startsWith("--"))) {
      throw new Error(`${flag} requires a value.`);
    }
    if (!inlineValue) index += 1;

    if (flag === "--artifact") options.artifacts.push(value);
    else if (flag === "--check") options.checks.push(value);
    else if (flag === "--require-passing") {
      options.requirePassing.push(
        ...value.split(",").map((item) => item.trim()).filter(Boolean),
      );
    } else if (
      [
        "--deployment-id",
        "--deployment-url",
        "--environment",
        "--output",
        "--region",
        "--rollback-target",
      ].includes(flag)
    ) {
      options[flag.slice(2).replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase(),
      )] = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!ALLOWED_ENVIRONMENTS.has(options.environment)) {
    throw new Error(`Unsupported evidence environment: ${options.environment}`);
  }
  return options;
}

function git(...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function parsePair(value, label) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${label} must use name=value syntax.`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function validateName(value, label) {
  if (!/^[a-z0-9]+(?:[-_.:][a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} has an invalid name: ${value}`);
  }
}

function safeDeploymentReference(value) {
  if (!value) return null;
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  try {
    const url = new URL(/^https?:\/\//.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Deployment references must use HTTP or HTTPS.");
    }
    return url.origin;
  } catch {
    if (/^[a-zA-Z0-9._-]+$/.test(value)) return value;
    throw new Error("Invalid deployment reference.");
  }
}

function relativeFile(filePath) {
  const absolutePath = path.resolve(ROOT, filePath);
  const relativePath = path.relative(ROOT, absolutePath);
  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    throw new Error(`Evidence file must be inside the repository: ${filePath}`);
  }
  return { absolutePath, relativePath: relativePath.replaceAll("\\", "/") };
}

async function artifactRecord(pair) {
  const [name, filePath] = parsePair(pair, "--artifact");
  validateName(name, "Artifact");
  const { absolutePath, relativePath } = relativeFile(filePath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile()) throw new Error(`Artifact is not a file: ${filePath}`);
  return {
    name,
    path: relativePath,
    bytes: metadata.size,
    sha256: await sha256(absolutePath),
  };
}

function checkRecord(pair) {
  const [name, status] = parsePair(pair, "--check");
  validateName(name, "Check");
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`Check ${name} has unsupported status ${status}.`);
  }
  return { name, status, detail: null };
}

async function migrationRecords() {
  const migrationDirectory = path.join(ROOT, "supabase", "migrations");
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      path: `supabase/migrations/${file}`,
      sha256: await sha256(path.join(migrationDirectory, file)),
    })),
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const commit = git("rev-parse", "HEAD");
  const checkedOutBranch = (() => {
    try {
      return git("branch", "--show-current") || null;
    } catch {
      return null;
    }
  })();
  const ref =
    checkedOutBranch ||
    (process.env.GITHUB_SHA === commit
      ? process.env.GITHUB_REF_NAME ?? null
      : null);
  const cleanWorkingTree =
    git("status", "--porcelain", "--untracked-files=all").length === 0;
  const contractPath = path.join(ROOT, "performance", "contract.json");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const checks = options.checks.map(checkRecord);
  const artifacts = await Promise.all(options.artifacts.map(artifactRecord));

  const routeBudgetPath = path.join(
    ROOT,
    "performance",
    "artifacts",
    "route-budgets.json",
  );
  try {
    const routeBudget = JSON.parse(await readFile(routeBudgetPath, "utf8"));
    if (!artifacts.some((artifact) => artifact.name === "route-budgets")) {
      artifacts.push(
        await artifactRecord(
          "route-budgets=performance/artifacts/route-budgets.json",
        ),
      );
    }
    const sourceMatches = routeBudget.sourceCommit === commit;
    const artifactStatus =
      sourceMatches && ALLOWED_STATUSES.has(routeBudget.status)
        ? routeBudget.status
        : "fail";
    const routeBudgetCheck = checks.find(
      (check) => check.name === "route-budgets",
    );
    if (routeBudgetCheck) {
      if (routeBudgetCheck.status === "pass" && artifactStatus !== "pass") {
        routeBudgetCheck.status = artifactStatus;
      }
      if (!sourceMatches) {
        routeBudgetCheck.detail =
          "Route budget evidence belongs to another commit.";
      }
    } else {
      checks.push({
        name: "route-budgets",
        status: artifactStatus,
        detail: sourceMatches
          ? null
          : "Route budget evidence belongs to another commit.",
      });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const missingRequiredChecks = options.requirePassing.filter(
    (name) => !checks.some((check) => check.name === name && check.status === "pass"),
  );
  const hasFailedCheck = checks.some((check) => check.status === "fail");
  const hasPassedChecks = checks.some((check) => check.status === "pass");
  const policyFailure =
    hasFailedCheck ||
    missingRequiredChecks.length > 0 ||
    (options.requireClean && !cleanWorkingTree);
  const overallStatus = policyFailure
    ? "fail"
    : hasPassedChecks && checks.every((check) => check.status === "pass")
      ? "pass"
      : "not-run";
  const generatedAt = new Date().toISOString();
  const evidenceId = `${options.environment}-${commit.slice(0, 12)}-${generatedAt.replace(/[-:.TZ]/g, "")}`;
  const defaultOutput = `performance/evidence/${evidenceId}.json`;
  const { absolutePath: outputPath, relativePath: outputRelativePath } =
    relativeFile(options.output ?? defaultOutput);
  const packageLockPath = path.join(ROOT, "package-lock.json");

  const evidence = {
    $schema: "https://p11.pm/schemas/release-evidence.v1.json",
    schemaVersion: "1.0.0",
    evidenceVersion: "1.0.0",
    evidenceId,
    generatedAt,
    environment: options.environment,
    overallStatus,
    contract: {
      path: "performance/contract.json",
      version: contract.contractVersion,
      sha256: await sha256(contractPath),
    },
    source: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      ref,
      commit,
      cleanWorkingTree,
      packageLockSha256: await sha256(packageLockPath),
    },
    deployment: {
      url: safeDeploymentReference(
        options.deploymentUrl ?? process.env.VERCEL_URL,
      ),
      id: options.deploymentId ?? process.env.VERCEL_DEPLOYMENT_ID ?? null,
      region: options.region ?? process.env.VERCEL_REGION ?? null,
      rollbackTarget: safeDeploymentReference(options.rollbackTarget),
    },
    migrations: await migrationRecords(),
    checks: checks.sort((left, right) => left.name.localeCompare(right.name)),
    artifacts: artifacts.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Release evidence (${overallStatus}): ${outputRelativePath}`);

  if (options.requireClean && !cleanWorkingTree) {
    console.error("Release evidence requires a clean working tree.");
  }
  if (missingRequiredChecks.length > 0) {
    console.error(
      `Required checks are not passing: ${missingRequiredChecks.join(", ")}`,
    );
  }
  if (policyFailure) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    `Release evidence generation failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
