import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import CRC32 from "crc-32";
import { describe, expect, it } from "vitest";

import {
  classifyArchivePath,
  isUnsafeArchivePath,
  StoredZipArchive,
} from "./archive.mjs";
import {
  contentObjectPath,
  manifestSha256,
  sourceUuid,
  stableUuid,
} from "./identity.mjs";
import { scanBasecampMetadata } from "./metadata.mjs";
import {
  parseExportIndex,
  parseOfficialPage,
  parsePeoplePage,
  resolveArchiveLink,
  sanitizeFormattedContent,
} from "./parser.mjs";
import {
  directStorageTusEndpoint,
  uploadStoredEntry,
} from "./tus-upload.mjs";

function storedZip(fileName, content) {
  const name = Buffer.from(fileName);
  const body = Buffer.from(content);
  const crc = CRC32.buf(body) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);

  const centralOffset = local.length + name.length + body.length;
  const centralSize = central.length + name.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, name, body, central, name, end]);
}

describe("Basecamp archive reader", () => {
  it("classifies official pages before considering their extension", () => {
    expect(
      classifyArchivePath(
        "client-project-12345678/all-files-images-pdfs-spreadsheets-etc/123456789-upload.html",
      ),
    ).toMatchObject({
      entryKind: "attachment",
      projectId: "12345678",
      sourceId: "123456789",
      originalName: "upload.html",
    });
    expect(
      classifyArchivePath(
        "client-project-12345678/schedules/events/review-123456789020260801.html",
      ),
    ).toMatchObject({
      entryKind: "schedule_entry",
      sourceId: "1234567890",
      occurrenceDate: "2026-08-01",
    });
  });

  it("rejects paths and links that can escape the archive", () => {
    expect(isUnsafeArchivePath("../secret")).toBe(true);
    expect(isUnsafeArchivePath("/absolute")).toBe(true);
    expect(() =>
      resolveArchiveLink("project-12345678/todos/item.html", "../../../secret"),
    ).toThrow(/escapes/);
  });

  it("reads and verifies a stored ZIP member by byte range", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "basecamp-zip-"));
    const archivePath = path.join(directory, "fixture.zip");
    await writeFile(
      archivePath,
      storedZip(
        "sample-project-12345678/messages/post-1234567890.html",
        "Basecamp range fixture",
      ),
    );

    const archive = await StoredZipArchive.open(archivePath);
    try {
      expect(archive.entries).toHaveLength(1);
      expect((await archive.readBuffer(archive.entries[0])).toString()).toBe(
        "Basecamp range fixture",
      );
      await expect(archive.verifyAndHash(archive.entries[0])).resolves.toMatchObject({
        bytesRead: 22,
        sha256: "6fbb3153a6481263b7bf275368d0714fea40d53263eb5dd12075223be40f6461",
      });
    } finally {
      await archive.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Basecamp source identity", () => {
  it("is deterministic and scoped by organization and account", () => {
    const one = sourceUuid({
      organizationId: "org-a",
      accountId: "5548255",
      entityType: "todo",
      sourceId: "123",
    });
    expect(one).toBe(
      sourceUuid({
        organizationId: "org-a",
        accountId: "5548255",
        entityType: "todo",
        sourceId: "123",
      }),
    );
    expect(one).not.toBe(
      sourceUuid({
        organizationId: "org-b",
        accountId: "5548255",
        entityType: "todo",
        sourceId: "123",
      }),
    );
    expect(stableUuid("a", "b")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("builds stable manifest and content-addressed object names", () => {
    const entries = [
      { fileName: "b", sizeBytes: 2, crc32: "00000002" },
      { fileName: "a", sizeBytes: 1, crc32: "00000001" },
    ];
    expect(manifestSha256(entries)).toBe(manifestSha256(entries.reverse()));
    expect(contentObjectPath("org", "a".repeat(64))).toBe(
      `basecamp-blobs/org/aa/${"a".repeat(64)}`,
    );
  });
});

describe("Basecamp resumable uploader", () => {
  it("uploads a ZIP byte range through the TUS protocol", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "basecamp-tus-"));
    const sourcePath = path.join(directory, "source.bin");
    const expected = Buffer.from("prefix:upload this range:suffix");
    await writeFile(sourcePath, expected);
    let uploaded = Buffer.alloc(0);
    let authorization = null;

    const server = createServer(async (request, response) => {
      authorization = request.headers.authorization ?? authorization;
      if (
        request.method === "POST" &&
        request.url === "/storage/v1/upload/resumable"
      ) {
        const address = server.address();
        response.writeHead(201, {
          Location: `http://127.0.0.1:${address.port}/files/1`,
          "Tus-Resumable": "1.0.0",
        });
        response.end();
        return;
      }
      if (request.method === "HEAD" && request.url === "/files/1") {
        response.writeHead(200, {
          "Upload-Offset": String(uploaded.length),
          "Upload-Length": "17",
          "Tus-Resumable": "1.0.0",
        });
        response.end();
        return;
      }
      if (request.method === "PATCH" && request.url === "/files/1") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        uploaded = Buffer.concat([uploaded, ...chunks]);
        response.writeHead(204, {
          "Upload-Offset": String(uploaded.length),
          "Tus-Resumable": "1.0.0",
        });
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    try {
      const entry = { fileName: "range.bin", sizeBytes: 17 };
      const archive = {
        async createReadStream() {
          return createReadStream(sourcePath, { start: 7, end: 23 });
        },
      };
      const uploadUrls = [];
      await uploadStoredEntry({
        archive,
        entry,
        supabaseUrl: `http://127.0.0.1:${address.port}`,
        serviceRoleKey: "test-service-role",
        bucketName: "project-files",
        objectName: "blob/test",
        onUploadUrl: (url) => uploadUrls.push(url),
      });

      expect(uploaded.toString()).toBe("upload this range");
      expect(authorization).toBe("Bearer test-service-role");
      expect(uploadUrls.at(-1)).toContain("/files/1");
      expect(
        directStorageTusEndpoint(`http://127.0.0.1:${address.port}`),
      ).toContain("/storage/v1/upload/resumable");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("Basecamp HTML parser", () => {
  it("separates active and archived projects from the root index", () => {
    const parsed = parseExportIndex(`
      <main>
        <time datetime="2026-08-07T20:20:44Z"></time>
        <a href="https://app.basecamp.com/5548255">Account</a>
        <ul class="list--unbulleted">
          <li><a class="list__action" href="./active-12345678/messages/message-board-1234567890message_board.html">Active</a></li>
        </ul>
        <h2>Archived</h2>
        <ul class="list--unbulleted">
          <li><a class="list__action" href="./old-87654321/messages/message-board-1098765432message_board.html">Old</a></li>
        </ul>
      </main>
    `);
    expect(parsed).toMatchObject({
      accountId: "5548255",
      exportedAt: "2026-08-07T20:20:44Z",
    });
    expect(parsed.projects.map(({ projectId, status }) => ({ projectId, status }))).toEqual([
      { projectId: "12345678", status: "active" },
      { projectId: "87654321", status: "archived" },
    ]);
  });

  it("extracts people from local avatar identities", () => {
    expect(
      parsePeoplePage(`
        <div class="flag">
          <img class="avatar" src="../../zz_assets/images/avatars/12345678.png">
          <h3 class="margin-0">Example Person</h3>
          <div class="metadata"><a href="mailto:person@example.com">Email</a></div>
        </div>
      `),
    ).toEqual([
      {
        id: "12345678",
        name: "Example Person",
        email: "person@example.com",
        metadata: "Email",
      },
    ]);
  });

  it("extracts a todo, comments, relationships, and local attachments", () => {
    const entry = {
      entryKind: "todo",
      fileName:
        "sample-project-12345678/to-do-lists/todos/example-1234567890.html",
      sourceId: "1234567890",
      originalName: "example-1234567890.html",
      occurrenceDate: null,
    };
    const parsed = parseOfficialPage(
      entry,
      `
        <article class="recordable message">
          <h2>Example todo</h2>
          <small class="metadata">Created <time datetime="2026-07-01T10:00:00Z"></time> Completed <time datetime="2026-07-02T11:00:00Z"></time></small>
          <div class="formatted_content"><p>Hello <script>alert(1)</script><a href="../../../sample-project-12345678/all-files-images-pdfs-spreadsheets-etc/123456789-file.pdf">file</a></p></div>
          <dl>
            <dt>Assigned to</dt><dd><img class="avatar" src="../../../zz_assets/images/avatars/12345678.png"></dd>
            <dt>Due on</dt><dd><time datetime="2026-07-03"></time></dd>
          </dl>
          <section id="comments" class="thread--comments">
            <article class="thread-entry recording" data-recording-id="9999999999" data-parent-id="1234567890" data-creator-id="87654321">
              <div class="formatted_content">Comment</div>
              <time datetime="2026-07-04T12:00:00Z"></time>
            </article>
          </section>
        </article>
      `,
      { entryIdForPath: () => "11111111-1111-5111-8111-111111111111" },
    );

    expect(parsed.record).toMatchObject({
      recordType: "todo",
      recordingId: "1234567890",
      title: "Example todo",
      bodyText: "Hello alert(1)file",
      dueOn: "2026-07-03",
      completedAt: "2026-07-02T11:00:00Z",
      assigneeIds: ["12345678"],
    });
    expect(parsed.record.bodyHtml).not.toContain("script");
    expect(parsed.record.bodyHtml).toContain("/api/archive/files/");
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]).toMatchObject({
      recordingId: "9999999999",
      parentRecordingId: "1234567890",
      creatorId: "87654321",
      bodyText: "Comment",
    });
  });

  it("strips active content and remote images from rich text", () => {
    const sanitized = sanitizeFormattedContent(`
      <img src="https://tracker.example/pixel.png" onerror="alert(1)">
      <iframe src="https://evil.example"></iframe>
      <a href="javascript:alert(1)">bad</a>
      <a href="https://example.com">safe</a>
    `);
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("iframe");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("tracker.example");
    expect(sanitized).toContain('rel="noopener noreferrer"');
  });
});

describe("Basecamp metadata scanner", () => {
  it("stages active records while leaving archived children in the archive", async () => {
    const activeFolder = "active-project-12345678";
    const archivedFolder = "archived-project-87654321";
    const entries = [
      {
        fileName: "zz_assets/images/avatars/11111111.png",
        entryKind: "avatar",
        sourceId: "11111111",
        projectId: null,
      },
      {
        fileName: `${activeFolder}/people/index.html`,
        entryKind: "people",
        projectId: "12345678",
      },
      {
        fileName: `${activeFolder}/to-do-lists/list-2222222222.html`,
        entryKind: "todo_list",
        sourceId: "2222222222",
        originalName: "list-2222222222.html",
        projectId: "12345678",
        occurrenceDate: null,
      },
      {
        fileName: `${activeFolder}/to-do-lists/todos/item-3333333333.html`,
        entryKind: "todo",
        sourceId: "3333333333",
        originalName: "item-3333333333.html",
        projectId: "12345678",
        occurrenceDate: null,
      },
      {
        fileName: `${activeFolder}/all-files-images-pdfs-spreadsheets-etc/444444444-file.pdf`,
        entryKind: "attachment",
        sourceId: "444444444",
        originalName: "file.pdf",
        projectId: "12345678",
        sizeBytes: 12,
        crc32: "00000000",
      },
      {
        fileName: `${archivedFolder}/messages/post-5555555555.html`,
        entryKind: "message",
        sourceId: "5555555555",
        originalName: "post-5555555555.html",
        projectId: "87654321",
        occurrenceDate: null,
      },
    ].map((entry) => ({
      compressedSize: entry.sizeBytes ?? 100,
      crc32: entry.crc32 ?? "00000000",
      generalPurposeBitFlag: 0,
      originalName: entry.originalName ?? path.posix.basename(entry.fileName),
      relativeOffsetOfLocalHeader: 0,
      sizeBytes: entry.sizeBytes ?? 100,
      ...entry,
    }));
    const pages = new Map([
      [
        `${activeFolder}/people/index.html`,
        `<div class="flag"><img class="avatar" src="../../zz_assets/images/avatars/11111111.png"><h3>Active Person</h3></div>`,
      ],
      [
        `${activeFolder}/to-do-lists/list-2222222222.html`,
        `<article class="recordable todolist"><h2>List</h2></article>`,
      ],
      [
        `${activeFolder}/to-do-lists/todos/item-3333333333.html`,
        `<a class="global-back decorated--matched" href="../../to-do-lists/list-2222222222.html">Back</a>
         <article class="recordable message"><h2>Todo</h2><div class="formatted_content">
           <a class="attachment__link" href="../../../${activeFolder}/all-files-images-pdfs-spreadsheets-etc/444444444-file.pdf">file</a>
         </div></article>`,
      ],
      [
        `${archivedFolder}/messages/post-5555555555.html`,
        `<article class="recordable message"><h2>Archived message</h2></article>`,
      ],
    ]);
    const archive = {
      entries,
      async readBuffer(entry) {
        return Buffer.from(pages.get(entry.fileName) ?? "");
      },
    };
    const rows = {};
    const result = await scanBasecampMetadata({
      archive,
      exportIndex: {
        accountId: "5548255",
        exportedAt: "2026-08-07T20:20:44Z",
        projects: [
          {
            projectId: "12345678",
            slug: "active-project",
            name: "Active project",
            status: "active",
          },
          {
            projectId: "87654321",
            slug: "archived-project",
            name: "Archived project",
            status: "archived",
          },
        ],
      },
      runId: "11111111-1111-5111-8111-111111111111",
      organizationId: "22222222-2222-5222-8222-222222222222",
      onBatch(kind, batch) {
        rows[kind] = [...(rows[kind] ?? []), ...batch];
      },
    });

    expect(result.people).toBe(1);
    expect(result.unresolvedReferences).toEqual([]);
    expect(rows.archive_record).toHaveLength(3);
    expect(
      rows.stage.filter((row) => row.entity_type === "projects"),
    ).toHaveLength(2);
    expect(rows.stage.some((row) => row.entity_type === "todos")).toBe(true);
    expect(rows.stage.some((row) => row.entity_type === "files")).toBe(true);
    expect(
      rows.stage.some(
        (row) =>
          row.entity_type === "messages" &&
          row.project_id !==
            rows.stage.find(
              (candidate) =>
                candidate.entity_type === "projects" &&
                candidate.source_key === "12345678",
            )?.project_id,
      ),
    ).toBe(false);
  });
});
