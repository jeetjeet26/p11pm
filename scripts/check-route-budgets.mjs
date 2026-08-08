#!/usr/bin/env node

import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const ROOT = process.cwd();

function parseArguments(argv) {
  const options = {
    allowMissing: false,
    buildDir: ".next",
    contract: "performance/contract.json",
    output: "performance/artifacts/route-budgets.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-missing") {
      options.allowMissing = true;
      continue;
    }
    const [flag, inlineValue] = argument.split("=", 2);
    if (!["--build-dir", "--contract", "--output"].includes(flag)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? argv[index + 1];
    if (!value || (!inlineValue && value.startsWith("--"))) {
      throw new Error(`${flag} requires a value.`);
    }
    if (!inlineValue) index += 1;
    options[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
      value;
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalText(filePath) {
  try {
    return (await readFile(filePath, "utf8")).trim() || null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sourceCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
      ? process.env.GITHUB_SHA
      : null;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory, predicate) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walk(entryPath, predicate)));
    } else if (predicate(entryPath)) {
      results.push(entryPath);
    }
  }
  return results;
}

function extractBalancedObject(source, startIndex) {
  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 1);
    }
  }

  throw new Error("Unterminated manifest object.");
}

function parseClientReferenceManifest(source, filePath) {
  const assignment =
    /(?:globalThis|self)\.__RSC_MANIFEST\s*\[\s*("(?:\\.|[^"])*")\s*\]\s*=/g;
  const records = [];
  let match;

  while ((match = assignment.exec(source)) !== null) {
    const routeKey = JSON.parse(match[1]);
    let cursor = assignment.lastIndex;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;

    let manifest;
    if (source.startsWith("JSON.parse(", cursor)) {
      cursor += "JSON.parse(".length;
      while (/\s/.test(source[cursor] ?? "")) cursor += 1;
      if (source[cursor] !== '"') {
        throw new Error(`Unsupported JSON.parse manifest in ${filePath}.`);
      }
      let end = cursor + 1;
      let escaped = false;
      for (; end < source.length; end += 1) {
        const character = source[end];
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') break;
      }
      const encoded = source.slice(cursor, end + 1);
      manifest = JSON.parse(JSON.parse(encoded));
    } else {
      const objectStart = source.indexOf("{", cursor);
      if (objectStart < 0) {
        throw new Error(`No manifest object found in ${filePath}.`);
      }
      manifest = JSON.parse(extractBalancedObject(source, objectStart));
    }

    const entryFiles = manifest.entryJSFiles ?? {};
    const chunks = Object.values(entryFiles)
      .flatMap((files) => (Array.isArray(files) ? files : []))
      .filter((file) => typeof file === "string" && file.endsWith(".js"));
    records.push({ format: "client-reference-manifest", routeKey, chunks });
  }

  return records;
}

function publicRoute(routeKey) {
  const withoutGroups = routeKey
    .split("/")
    .filter((segment) => segment && !/^\(.+\)$/.test(segment))
    .join("/");
  return `/${withoutGroups}`
    .replace(/\/(?:page|route)$/, "")
    .replace(/\[\[\.\.\.conversationId\]\]/, "[conversationId]");
}

function normalizeChunkPath(chunk) {
  return chunk
    .replace(/^\/_next\//, "")
    .replace(/^_next\//, "")
    .replace(/^\.next\//, "")
    .replaceAll("\\", "/");
}

async function collectRouteRecords(buildDirectory) {
  const records = [];
  const serverAppDirectory = path.join(buildDirectory, "server", "app");

  if (await pathExists(serverAppDirectory)) {
    const manifests = await walk(
      serverAppDirectory,
      (filePath) =>
        filePath.endsWith("_client-reference-manifest.js") ||
        filePath.endsWith("_client-reference-manifest.json"),
    );
    for (const manifestPath of manifests) {
      const source = await readFile(manifestPath, "utf8");
      if (manifestPath.endsWith(".json")) {
        const manifest = JSON.parse(source);
        const chunks = Object.values(manifest.entryJSFiles ?? {})
          .flatMap((files) => (Array.isArray(files) ? files : []))
          .filter((file) => typeof file === "string" && file.endsWith(".js"));
        const relative = path
          .relative(serverAppDirectory, manifestPath)
          .replaceAll("\\", "/")
          .replace(/\/[^/]+_client-reference-manifest\.json$/, "");
        records.push({
          chunks,
          format: "client-reference-manifest-json",
          routeKey: `/${relative}`,
        });
      } else {
        records.push(...parseClientReferenceManifest(source, manifestPath));
      }
    }
  }

  for (const manifestName of [
    "app-build-manifest.json",
    path.join("server", "app-build-manifest.json"),
  ]) {
    const manifestPath = path.join(buildDirectory, manifestName);
    if (!(await pathExists(manifestPath))) continue;
    const manifest = await readJson(manifestPath);
    for (const [routeKey, chunks] of Object.entries(manifest.pages ?? {})) {
      records.push({
        chunks: Array.isArray(chunks)
          ? chunks.filter(
              (file) => typeof file === "string" && file.endsWith(".js"),
            )
          : [],
        format: "app-build-manifest",
        routeKey,
      });
    }
  }

  return records;
}

function findRouteRecord(records, budget) {
  const exact = records.find((record) => record.routeKey === budget.nextRouteKey);
  if (exact) return exact;
  return records.find((record) => publicRoute(record.routeKey) === budget.route);
}

async function measureChunks(buildDirectory, chunks) {
  const uniqueChunks = [...new Set(chunks.map(normalizeChunkPath))].sort();
  const files = [];
  const missingChunks = [];

  for (const chunk of uniqueChunks) {
    const absolutePath = path.resolve(buildDirectory, chunk);
    const relative = path.relative(buildDirectory, absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Manifest chunk escapes build directory: ${chunk}`);
    }
    if (!(await pathExists(absolutePath))) {
      missingChunks.push(chunk);
      continue;
    }
    const content = await readFile(absolutePath);
    const brotliBytes = brotliCompressSync(content, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength;
    files.push({ brotliBytes, path: chunk, rawBytes: content.byteLength });
  }

  return {
    brotliBytes: files.reduce((sum, file) => sum + file.brotliBytes, 0),
    files,
    missingChunks,
    rawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0),
  };
}

function roundKiB(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const buildDirectory = path.resolve(ROOT, options.buildDir);
  const contractPath = path.resolve(ROOT, options.contract);
  const outputPath = path.resolve(ROOT, options.output);
  const contract = await readJson(contractPath);
  const budgets = contract.budgets?.clientJavascript?.routes;

  if (!Array.isArray(budgets) || budgets.length === 0) {
    throw new Error(`No client JavaScript route budgets found in ${options.contract}.`);
  }

  if (!(await pathExists(buildDirectory))) {
    const message = `Build directory ${options.buildDir} is missing. Run npm run build first.`;
    if (!options.allowMissing) throw new Error(message);
    console.warn(message);
  }

  const records = (await pathExists(buildDirectory))
    ? await collectRouteRecords(buildDirectory)
    : [];
  const routeResults = [];

  for (const budget of budgets) {
    const record = findRouteRecord(records, budget);
    if (!record) {
      routeResults.push({
        budgetKiB: budget.maxKiB,
        measuredKiB: null,
        route: budget.route,
        routeKey: budget.nextRouteKey,
        status: "missing",
      });
      continue;
    }
    const measurement = await measureChunks(buildDirectory, record.chunks);
    const budgetBytes = budget.maxKiB * 1024;
    const incomplete =
      measurement.files.length === 0 || measurement.missingChunks.length > 0;
    routeResults.push({
      brotliBytes: measurement.brotliBytes,
      budgetBytes,
      budgetKiB: budget.maxKiB,
      chunks: measurement.files,
      format: record.format,
      measuredKiB: roundKiB(measurement.brotliBytes),
      missingChunks: measurement.missingChunks,
      rawBytes: measurement.rawBytes,
      route: budget.route,
      routeKey: record.routeKey,
      status: incomplete
        ? "missing"
        : measurement.brotliBytes <= budgetBytes
          ? "pass"
          : "fail",
    });
  }

  const missingRoutes = routeResults.filter((result) => result.status === "missing");
  const failedRoutes = routeResults.filter((result) => result.status === "fail");
  const report = {
    schemaVersion: "1.0.0",
    contractVersion: contract.contractVersion,
    generatedAt: new Date().toISOString(),
    sourceCommit: sourceCommit(),
    buildId: await readOptionalText(path.join(buildDirectory, "BUILD_ID")),
    nextVersion: (await readJson(path.join(ROOT, "node_modules", "next", "package.json")))
      .version,
    buildDirectory: path.relative(ROOT, buildDirectory) || ".",
    compression: "brotli-quality-11",
    status:
      failedRoutes.length > 0 ||
      (missingRoutes.length > 0 && !options.allowMissing)
        ? "fail"
        : missingRoutes.length > 0
          ? "not-run"
          : "pass",
    routes: routeResults,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  for (const result of routeResults) {
    const measured =
      result.measuredKiB === null ? "missing" : `${result.measuredKiB} KiB`;
    console.log(
      `${result.status.toUpperCase().padEnd(7)} ${result.route.padEnd(32)} ${measured.padStart(12)} / ${result.budgetKiB} KiB`,
    );
  }
  console.log(`Route budget evidence: ${path.relative(ROOT, outputPath)}`);

  if (failedRoutes.length > 0) {
    process.exitCode = 1;
  } else if (missingRoutes.length > 0 && !options.allowMissing) {
    console.error(
      `Missing build evidence for: ${missingRoutes.map((route) => route.route).join(", ")}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    `Route budget check failed: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
});
