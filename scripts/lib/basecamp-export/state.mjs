import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

export function importerStatePaths(runId) {
  const directory = path.resolve("data", "basecamp-export", runId);
  return {
    directory,
    inventory: path.join(directory, "inventory.json"),
    manifest: path.join(directory, "manifest.json"),
    report: path.join(directory, "report.json"),
  };
}
