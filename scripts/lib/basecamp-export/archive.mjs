import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open as openFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import CRC32 from "crc-32";
import yauzl from "yauzl";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_FILE_HEADER_LENGTH = 30;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_SYMLINK_TYPE = 0o120000;

function openZip(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error) reject(error);
        else resolve(zipFile);
      },
    );
  });
}

function unsignedCrc32(value) {
  return Number(value) >>> 0;
}

function crc32Hex(value) {
  return unsignedCrc32(value).toString(16).padStart(8, "0");
}

export function isUnsafeArchivePath(value) {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/.test(value)
  ) {
    return true;
  }
  const normalized = path.posix.normalize(value);
  return (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== value.replace(/^\.\//, "")
  );
}

function isDirectory(entry) {
  return entry.fileName.endsWith("/");
}

function isSymlink(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (unixMode & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK_TYPE;
}

export function parseProjectFolder(folder) {
  const match = /^(?<slug>.+)-(?<projectId>\d{8})$/.exec(folder);
  if (!match?.groups) return null;
  return {
    projectId: match.groups.projectId,
    slug: match.groups.slug,
  };
}

function pageIdentity(fileName) {
  const recurring = /-(?<sourceId>\d{10,11})(?<date>\d{8})\.html$/i.exec(fileName);
  if (recurring?.groups) {
    const rawDate = recurring.groups.date;
    const occurrenceDate = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}`;
    if (!Number.isNaN(Date.parse(`${occurrenceDate}T00:00:00Z`))) {
      return {
        sourceId: recurring.groups.sourceId,
        occurrenceDate,
      };
    }
  }

  const match =
    /-(?<sourceId>\d+)(?:todoset|message_board|questionnaire|schedule)?\.html$/i.exec(
      fileName,
    );
  return match?.groups
    ? { sourceId: match.groups.sourceId, occurrenceDate: null }
    : { sourceId: null, occurrenceDate: null };
}

function projectPageKind(parts, fileName) {
  const section = parts[1];
  if (section === "people") return "people";
  if (section === "to-do-lists") {
    if (parts[2] === "todos") return "todo";
    return fileName.endsWith("todoset.html") ? "todo_set" : "todo_list";
  }
  if (section === "messages") {
    return fileName.endsWith("message_board.html")
      ? "message_board"
      : "message";
  }
  if (section === "chats") return "campfire";
  if (section === "calendars") return "schedule";
  if (section === "schedules") return "schedule_entry";
  if (section === "docs-and-files") return "vault_record";
  if (section === "card-tables") return "card_table";
  if (section === "card-table-columns" && parts[2] === "cards") return "card";
  if (section === "card-table-columns") return "card_column";
  if (section === "check-ins") return "questionnaire";
  if (section === "email-forwards") return "forward_inbox";
  if (section === "forwarded-emails") return "forwarded_email";
  if (section === "dropbox-files") return "dropbox_file";
  if (section === "external-service-files") return "external_service_file";
  return "project_page";
}

export function classifyArchivePath(fileName) {
  if (isUnsafeArchivePath(fileName)) {
    throw new Error(`Unsafe ZIP member path: ${JSON.stringify(fileName)}`);
  }

  const parts = fileName.split("/");
  const basename = parts.at(-1) ?? "";
  if (parts.length === 1) {
    return {
      entryKind:
        fileName === "-DOUBLE_CLICK_TO_VIEW.html"
          ? "export_index"
          : "root_asset",
      projectId: null,
      projectSlug: null,
      sourceId: null,
      occurrenceDate: null,
      originalName: basename,
    };
  }

  if (parts[0] === "zz_assets") {
    const assetKind =
      parts[1] === "images" && parts[2] === "avatars"
        ? "avatar"
        : parts[1] === "images" && parts[2] === "previews"
          ? "preview"
          : "shared_asset";
    const avatarMatch =
      assetKind === "avatar" ? /^(?<id>\d{8})\.[^.]+$/i.exec(basename) : null;
    return {
      entryKind: assetKind,
      projectId: null,
      projectSlug: null,
      sourceId: avatarMatch?.groups?.id ?? null,
      occurrenceDate: null,
      originalName: basename,
    };
  }

  const project = parseProjectFolder(parts[0]);
  if (!project) {
    return {
      entryKind: "unclassified",
      projectId: null,
      projectSlug: null,
      sourceId: null,
      occurrenceDate: null,
      originalName: basename,
    };
  }

  if (parts[1] === "all-files-images-pdfs-spreadsheets-etc") {
    const attachment = /^(?<id>\d+)-(?<name>.+)$/.exec(basename);
    return {
      entryKind: "attachment",
      projectId: project.projectId,
      projectSlug: project.slug,
      sourceId: attachment?.groups?.id ?? null,
      occurrenceDate: null,
      originalName: attachment?.groups?.name ?? basename,
    };
  }

  if (!basename.toLowerCase().endsWith(".html")) {
    return {
      entryKind: "project_asset",
      projectId: project.projectId,
      projectSlug: project.slug,
      sourceId: null,
      occurrenceDate: null,
      originalName: basename,
    };
  }

  const identity = pageIdentity(basename);
  return {
    entryKind: projectPageKind(parts, basename),
    projectId: project.projectId,
    projectSlug: project.slug,
    sourceId: identity.sourceId,
    occurrenceDate: identity.occurrenceDate,
    originalName: basename,
  };
}

async function readCentralDirectory(archivePath) {
  const zipFile = await openZip(archivePath);
  const entries = [];

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      zipFile.close();
      reject(error);
    };

    zipFile.on("error", fail);
    zipFile.on("entry", (entry) => {
      try {
        if (isUnsafeArchivePath(entry.fileName)) {
          throw new Error(
            `Unsafe ZIP member path: ${JSON.stringify(entry.fileName)}`,
          );
        }
        if (isSymlink(entry)) {
          throw new Error(
            `Symbolic links are not accepted: ${JSON.stringify(entry.fileName)}`,
          );
        }
        if (!isDirectory(entry)) {
          if (entry.compressionMethod !== 0) {
            throw new Error(
              `Compressed ZIP member is unsupported: ${entry.fileName}`,
            );
          }
          if ((entry.generalPurposeBitFlag & 1) !== 0) {
            throw new Error(`Encrypted ZIP member is unsupported: ${entry.fileName}`);
          }

          entries.push({
            ...classifyArchivePath(entry.fileName),
            compressedSize: entry.compressedSize,
            crc32: crc32Hex(entry.crc32),
            externalFileAttributes: entry.externalFileAttributes,
            fileName: entry.fileName,
            generalPurposeBitFlag: entry.generalPurposeBitFlag,
            relativeOffsetOfLocalHeader: entry.relativeOffsetOfLocalHeader,
            sizeBytes: entry.uncompressedSize,
          });
        }
        zipFile.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zipFile.on("end", () => {
      zipFile.close();
      resolve(entries);
    });
    zipFile.readEntry();
  });
}

export class StoredZipArchive {
  constructor(archivePath, entries, fileHandle) {
    this.archivePath = archivePath;
    this.entries = entries;
    this.fileHandle = fileHandle;
    this.rangeCache = new Map();
  }

  static async open(archivePath) {
    const entries = await readCentralDirectory(archivePath);
    const fileHandle = await openFile(archivePath, "r");
    return new StoredZipArchive(archivePath, entries, fileHandle);
  }

  async close() {
    await this.fileHandle.close();
  }

  async dataRange(entry) {
    const cached = this.rangeCache.get(entry.fileName);
    if (cached) return cached;

    const header = Buffer.alloc(LOCAL_FILE_HEADER_LENGTH);
    const { bytesRead } = await this.fileHandle.read(
      header,
      0,
      header.length,
      entry.relativeOffsetOfLocalHeader,
    );
    if (
      bytesRead !== header.length ||
      header.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE
    ) {
      throw new Error(`Invalid local ZIP header for ${entry.fileName}`);
    }

    const fileNameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const start =
      entry.relativeOffsetOfLocalHeader +
      LOCAL_FILE_HEADER_LENGTH +
      fileNameLength +
      extraLength;
    const range = {
      start,
      end: start + entry.sizeBytes - 1,
    };
    this.rangeCache.set(entry.fileName, range);
    return range;
  }

  async createReadStream(entry, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.sizeBytes) {
      throw new Error(`Invalid ZIP stream offset ${offset} for ${entry.fileName}`);
    }
    if (entry.sizeBytes === 0 || offset === entry.sizeBytes) {
      return Readable.from([]);
    }
    const range = await this.dataRange(entry);
    return createReadStream(this.archivePath, {
      start: range.start + offset,
      end: range.end,
    });
  }

  async readBuffer(entry, maximumBytes = 16 * 1024 * 1024) {
    if (entry.sizeBytes > maximumBytes) {
      throw new Error(
        `ZIP member exceeds the ${maximumBytes}-byte parser limit: ${entry.fileName}`,
      );
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of await this.createReadStream(entry)) {
      length += chunk.length;
      if (length > maximumBytes) {
        throw new Error(`ZIP member exceeded its parser limit: ${entry.fileName}`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  }

  async verifyAndHash(entry) {
    const hash = createHash("sha256");
    let crc = 0;
    let bytesRead = 0;
    for await (const chunk of await this.createReadStream(entry)) {
      hash.update(chunk);
      crc = CRC32.buf(chunk, crc);
      bytesRead += chunk.length;
    }

    if (bytesRead !== entry.sizeBytes) {
      throw new Error(
        `ZIP member size mismatch for ${entry.fileName}: expected ${entry.sizeBytes}, read ${bytesRead}`,
      );
    }
    const actualCrc = crc32Hex(crc);
    if (actualCrc !== entry.crc32) {
      throw new Error(
        `ZIP member CRC mismatch for ${entry.fileName}: expected ${entry.crc32}, read ${actualCrc}`,
      );
    }

    return {
      bytesRead,
      crc32: actualCrc,
      sha256: hash.digest("hex"),
    };
  }
}
