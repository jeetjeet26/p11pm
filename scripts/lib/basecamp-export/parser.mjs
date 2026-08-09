import path from "node:path";

import * as cheerio from "cheerio";
import sanitizeHtml from "sanitize-html";

import {
  classifyArchivePath,
  isUnsafeArchivePath,
  parseProjectFolder,
} from "./archive.mjs";

const SAFE_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "a",
  "img",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const SAFE_ATTRIBUTES = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
};

function normalizedText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText($, selector, root) {
  const match = root ? root.find(selector).first() : $(selector).first();
  return normalizedText(match.text());
}

function normalizeArchivePath(value) {
  return value.replace(/^\.\//, "");
}

export function resolveArchiveLink(sourcePath, href) {
  const raw = String(href ?? "").trim();
  if (
    !raw ||
    raw.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(raw)
  ) {
    return null;
  }

  const withoutQuery = raw.split(/[?#]/, 1)[0];
  let decoded = withoutQuery;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    // Preserve malformed percent escapes as literal path characters.
  }
  const resolved = normalizeArchivePath(
    path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), decoded)),
  );
  if (isUnsafeArchivePath(resolved)) {
    throw new Error(
      `Archive link escapes the export root: ${JSON.stringify(href)} in ${sourcePath}`,
    );
  }
  return resolved;
}

function safeInternalUrl(sourcePath, value, entryIdForPath) {
  const target = resolveArchiveLink(sourcePath, value);
  if (!target || target.includes("/images/file-types/")) return null;
  const entryId = entryIdForPath?.(target);
  return entryId ? `/api/archive/files/${encodeURIComponent(entryId)}` : null;
}

export function sanitizeFormattedContent(
  html,
  { sourcePath, entryIdForPath } = {},
) {
  return sanitizeHtml(String(html ?? ""), {
    allowedTags: SAFE_TAGS,
    allowedAttributes: SAFE_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    exclusiveFilter(frame) {
      return frame.tag === "img" && !frame.attribs.src;
    },
    transformTags: {
      a(tagName, attributes) {
        const rawHref = attributes.href ?? "";
        const internal =
          sourcePath && entryIdForPath
            ? safeInternalUrl(sourcePath, rawHref, entryIdForPath)
            : null;
        if (internal) {
          return {
            tagName,
            attribs: {
              href: internal,
              ...(attributes.title ? { title: attributes.title } : {}),
            },
          };
        }
        if (/^https?:/i.test(rawHref)) {
          return {
            tagName,
            attribs: {
              href: rawHref,
              rel: "noopener noreferrer",
              target: "_blank",
              ...(attributes.title ? { title: attributes.title } : {}),
            },
          };
        }
        if (/^mailto:/i.test(rawHref)) {
          return { tagName, attribs: { href: rawHref } };
        }
        return { tagName: "span", attribs: {} };
      },
      img(tagName, attributes) {
        const rawSource = attributes.src ?? "";
        const internal =
          sourcePath && entryIdForPath
            ? safeInternalUrl(sourcePath, rawSource, entryIdForPath)
            : null;
        return {
          tagName,
          attribs: {
            ...(internal ? { src: internal } : {}),
            alt: normalizedText(attributes.alt),
            loading: "lazy",
          },
        };
      },
    },
  });
}

function projectFolderFromHref(href) {
  const clean = normalizeArchivePath(String(href ?? "")).split("/")[0];
  return parseProjectFolder(clean);
}

export function parseExportIndex(html, sourcePath = "-DOUBLE_CLICK_TO_VIEW.html") {
  const $ = cheerio.load(html);
  const projects = [];
  const seen = new Set();
  const lists = $("ul.list--unbulleted, ul.list--ruled-actions");

  lists.each((listIndex, list) => {
    const archived =
      listIndex > 0 ||
      normalizedText($(list).prevAll("h1,h2,h3,h4").first().text()).toLowerCase() ===
        "archived";
    $(list)
      .find("a.list__action")
      .each((_, link) => {
        const href = $(link).attr("href");
        const project = projectFolderFromHref(href);
        if (!project || seen.has(project.projectId)) return;
        seen.add(project.projectId);
        projects.push({
          ...project,
          name: normalizedText($(link).text()),
          status: archived ? "archived" : "active",
          targetPath: resolveArchiveLink(sourcePath, href),
        });
      });
  });

  if (projects.length === 0) {
    $("a.list__action").each((_, link) => {
      const href = $(link).attr("href");
      const project = projectFolderFromHref(href);
      if (!project || seen.has(project.projectId)) return;
      seen.add(project.projectId);
      const archived =
        $(link).closest("ul").prevAll("h1,h2,h3,h4").first().text().trim() ===
        "Archived";
      projects.push({
        ...project,
        name: normalizedText($(link).text()),
        status: archived ? "archived" : "active",
        targetPath: resolveArchiveLink(sourcePath, href),
      });
    });
  }

  const exportedAt = $("time[datetime]").first().attr("datetime") ?? null;
  const accountUrl = $('a[href*="app.basecamp.com"]').first().attr("href") ?? "";
  const accountId = /app\.basecamp\.com\/(?<id>\d+)/.exec(accountUrl)?.groups?.id;
  return {
    accountId: accountId ?? null,
    exportedAt,
    projects,
  };
}

function personIdFromAvatar(value) {
  return /\/avatars\/(?<id>\d+)\.[^/?#]+/i.exec(value ?? "")?.groups?.id ?? null;
}

export function parsePeoplePage(html) {
  const $ = cheerio.load(html);
  const people = [];
  const seen = new Set();
  $("div.flag").each((_, element) => {
    const root = $(element);
    const personId = personIdFromAvatar(root.find("img.avatar").attr("src"));
    const name = firstText($, "h3", root);
    if (!personId || !name || seen.has(personId)) return;
    seen.add(personId);
    const emailHref = root.find('a[href^="mailto:"]').attr("href");
    const metadata = normalizedText(root.find(".metadata").text());
    people.push({
      id: personId,
      name,
      email: emailHref ? emailHref.replace(/^mailto:/i, "").trim() : null,
      metadata,
    });
  });
  return people;
}

export function parseReferencedPeople(html) {
  const $ = cheerio.load(html);
  const people = new Map();
  $("img.avatar").each((_, element) => {
    const root = $(element);
    const id =
      root.attr("data-avatar-for-person-id") ??
      personIdFromAvatar(root.attr("src"));
    if (!id) return;
    const name =
      normalizedText(root.attr("title")) ||
      normalizedText(root.attr("alt")) ||
      `Basecamp person ${id}`;
    const current = people.get(id);
    if (!current || current.name.startsWith("Basecamp person ")) {
      people.set(id, { id, name, email: null, metadata: "" });
    }
  });
  $("bc-attachment[content]").each((_, element) => {
    const content = $(element).attr("content") ?? "";
    const id =
      /Person\/(?<id>\d+)/.exec(content)?.groups?.id ??
      /data-avatar-for-person-id=["'](?<id>\d+)/.exec(content)?.groups?.id ??
      null;
    if (!id) return;
    const title =
      /title=["'](?<title>[^"']+)/.exec(content)?.groups?.title ?? "";
    const name = normalizedText(title.split(",")[0]) || `Basecamp person ${id}`;
    const current = people.get(id);
    if (!current || current.name.startsWith("Basecamp person ")) {
      people.set(id, { id, name, email: null, metadata: "" });
    }
  });
  return [...people.values()];
}

function entityTitle($, main, fallback) {
  const headings = main.find("h1,h2,h3,h4").toArray();
  const candidates = headings
    .map((heading) => normalizedText($(heading).text()))
    .filter((value) => value && value !== "Comments & Events" && value !== "✔");
  return candidates.at(-1) ?? fallback;
}

function formattedContent($, root) {
  const element = root.find(".formatted_content").first();
  const expanded = element.clone();
  expanded.find("bc-attachment").each((_, attachment) => {
    const node = $(attachment);
    const embedded = node.attr("content");
    if (embedded) {
      node.replaceWith(embedded);
      return;
    }
    const name = normalizedText(node.attr("filename"));
    node.replaceWith(name ? `<span>[Attachment: ${name}]</span>` : "");
  });
  return {
    html: expanded.html() ?? "",
    text: normalizedText(expanded.text()),
  };
}

function richTextMetadata($, root) {
  const mentionIds = new Set();
  const embeddedAttachments = [];
  root.find("bc-attachment").each((ordinal, element) => {
    const node = $(element);
    const contentType = node.attr("content-type") ?? null;
    const embedded = node.attr("content") ?? "";
    const mentionId =
      /Person\/(?<id>\d+)/.exec(embedded)?.groups?.id ??
      /data-avatar-for-person-id=["'](?<id>\d+)/.exec(embedded)?.groups?.id ??
      null;
    if (mentionId) mentionIds.add(mentionId);
    if (contentType !== "application/vnd.basecamp.mention") {
      embeddedAttachments.push({
        ordinal,
        signedGlobalId: node.attr("sgid") ?? null,
        fileName: node.attr("filename") ?? null,
        contentType,
        sizeBytes: Number(node.attr("filesize")) || null,
        caption: normalizedText(node.attr("caption")) || null,
        alt: normalizedText(node.attr("alt")) || null,
      });
    }
  });
  return {
    mentionIds: [...mentionIds],
    embeddedAttachments,
  };
}

function directTimes(root) {
  return root
    .find("time[datetime]")
    .toArray()
    .map((element) => element.attribs.datetime)
    .filter(Boolean);
}

function definitionValue($, main, label) {
  const target = main
    .find("dt")
    .filter((_, element) => normalizedText($(element).text()) === label)
    .first();
  return target.length ? target.next("dd") : null;
}

function localReferences($, root, sourcePath) {
  const references = [];
  const pushReference = (kind, value, element) => {
    const archivePath = resolveArchiveLink(sourcePath, value);
    if (!archivePath) return;
    references.push({
      archivePath,
      kind,
      title:
        normalizedText($(element).attr("filename")) ||
        normalizedText($(element).attr("alt")) ||
        normalizedText($(element).text()) ||
        path.posix.basename(archivePath),
      ordinal: references.length,
    });
  };

  root
    .find(
      "a.attachment__link, a[href*='/all-files-images-pdfs-spreadsheets-etc/']",
    )
    .each((_, element) =>
      pushReference("attachment", $(element).attr("href"), element),
    );
  root.find("img[src]").each((_, element) => {
    const source = $(element).attr("src");
    if (
      source &&
      !$(element).hasClass("avatar") &&
      !source.includes("/images/file-types/") &&
      !/^(?:https?:|data:|blob:)/i.test(source)
    ) {
      pushReference("inline", source, element);
    }
  });
  return references;
}

function parseComments($, sourcePath, entryIdForPath) {
  return $("#comments.thread--comments article.thread-entry.recording")
    .toArray()
    .map((element, ordinal) => {
      const root = $(element);
      const content = formattedContent($, root);
      const richText = richTextMetadata($, root);
      const recordingId = root.attr("data-recording-id") ?? null;
      return {
        recordType: "comment",
        recordingId,
        parentRecordingId: root.attr("data-parent-id") ?? null,
        creatorId: root.attr("data-creator-id") ?? null,
        sourcePath,
        ordinal,
        title: null,
        bodyHtml: sanitizeFormattedContent(content.html, {
          sourcePath,
          entryIdForPath,
        }),
        bodyText: content.text,
        sourceCreatedAt: root.find("time[datetime]").first().attr("datetime") ?? null,
        sourceUpdatedAt: null,
        references: localReferences($, root, sourcePath),
        metadata: {
          readable_identifier: root.attr("data-readable-identifier") ?? null,
          source_url: root.attr("data-url") ?? null,
          mention_ids: richText.mentionIds,
          embedded_attachments: richText.embeddedAttachments,
        },
      };
    });
}

function parseCampfireLines($, sourcePath, entryIdForPath, chatId) {
  return $("tr.chat-line")
    .toArray()
    .map((element, ordinal) => {
      const root = $(element);
      const content = formattedContent($, root);
      const richText = richTextMetadata($, root);
      const timestamp =
        root.attr("data-datetime") ??
        root.find("time[datetime]").first().attr("datetime") ??
        null;
      return {
        recordType: "campfire_line",
        recordingId: null,
        syntheticKey: `${chatId ?? "chat"}:${timestamp ?? "unknown"}:${ordinal}`,
        parentRecordingId: chatId,
        creatorId: personIdFromAvatar(root.find("img.avatar").attr("src")),
        sourcePath,
        ordinal,
        title:
          normalizedText(root.find(".chat-line__author").attr("title")) || null,
        bodyHtml: sanitizeFormattedContent(content.html, {
          sourcePath,
          entryIdForPath,
        }),
        bodyText: content.text,
        sourceCreatedAt: timestamp,
        sourceUpdatedAt: null,
        references: localReferences($, root, sourcePath),
        metadata: {
          mention_ids: richText.mentionIds,
          embedded_attachments: richText.embeddedAttachments,
        },
      };
    });
}

function linkedChildren($, root, sourcePath) {
  const children = [];
  root.find("a[href]").each((_, element) => {
    const archivePath = resolveArchiveLink(sourcePath, $(element).attr("href"));
    if (
      !archivePath ||
      archivePath === sourcePath ||
      children.some((child) => child.archivePath === archivePath)
    ) {
      return;
    }
    const target = classifyArchivePath(archivePath);
    if (
      !target.projectId ||
      !target.sourceId ||
      ["attachment", "avatar", "preview", "project_asset"].includes(
        target.entryKind,
      )
    ) {
      return;
    }
    children.push({
      archivePath,
      entryKind: target.entryKind,
      sourceId: target.sourceId,
      title: normalizedText($(element).text()) || path.posix.basename(archivePath),
      ordinal: children.length,
    });
  });
  return children;
}

function parentLink($, root, entry) {
  const expected = {
    card: new Set(["card_column"]),
    card_column: new Set(["card_table"]),
    forwarded_email: new Set(["forward_inbox"]),
    message: new Set(["message_board"]),
    schedule_entry: new Set(["schedule"]),
    todo: new Set(["todo_list", "todo_set"]),
    todo_list: new Set(["todo_set"]),
  }[entry.entryKind];
  if (!expected) return null;

  let result = null;
  root
    .find("a.decorated--matched[href], a[data-parent][href]")
    .add($("a.global-back.decorated--matched[href]"))
    .each((_, element) => {
    if (result) return;
    const archivePath = resolveArchiveLink(entry.fileName, $(element).attr("href"));
    if (!archivePath) return;
    const target = classifyArchivePath(archivePath);
    if (expected.has(target.entryKind)) {
      result = {
        archivePath,
        entryKind: target.entryKind,
        sourceId: target.sourceId,
      };
    }
    });
  return result;
}

export function parseOfficialPage(
  entry,
  html,
  { entryIdForPath } = {},
) {
  const $ = cheerio.load(html);
  const main = $("article.recordable").first();
  const mainMetadata = main.clone();
  mainMetadata.find("#comments").remove();
  const content = formattedContent($, main);
  const times = directTimes(mainMetadata);
  const assignment = definitionValue($, mainMetadata, "Assigned to");
  const due = definitionValue($, mainMetadata, "Due on");
  const primaryMetadata = mainMetadata.find("small.metadata").first();
  const metadataTimes = directTimes(primaryMetadata);
  const completedText = normalizedText(primaryMetadata.text());
  const articleClasses = new Set((main.attr("class") ?? "").split(/\s+/));
  const recordType = ["vault", "upload", "document"].find((value) =>
    articleClasses.has(value),
  );
  const assigneeIds = assignment
    ? assignment
        .find("img.avatar")
        .toArray()
        .map((element) => personIdFromAvatar($(element).attr("src")))
        .filter(Boolean)
    : [];
  const dueValue = due?.find("time[datetime]").first().attr("datetime") ?? null;
  const completedAt =
    completedText.includes("Completed") && metadataTimes.length > 1
      ? metadataTimes.at(-1)
      : null;
  const parent = parentLink($, mainMetadata, entry);
  const richText = richTextMetadata($, mainMetadata);

  const rootRecord = {
    recordType: recordType ?? entry.entryKind,
    recordingId: entry.sourceId,
    parentRecordingId: parent?.sourceId ?? null,
    parentArchivePath: parent?.archivePath ?? null,
    creatorId:
      main.attr("data-creator-id") ??
      personIdFromAvatar(mainMetadata.find("img.avatar").first().attr("src")),
    sourcePath: entry.fileName,
    ordinal: 0,
    title: entityTitle($, mainMetadata, entry.originalName),
    bodyHtml: sanitizeFormattedContent(content.html, {
      sourcePath: entry.fileName,
      entryIdForPath,
    }),
    bodyText: content.text,
    sourceCreatedAt: metadataTimes[0] ?? times[0] ?? null,
    sourceUpdatedAt: metadataTimes.at(-1) ?? times.at(-1) ?? null,
    dueOn: dueValue?.slice(0, 10) ?? null,
    completedAt,
    status: completedAt ? "completed" : null,
    assigneeIds: [...new Set(assigneeIds)],
    references: localReferences($, mainMetadata, entry.fileName),
    children: linkedChildren($, mainMetadata, entry.fileName),
    metadata: {
      occurrence_date: entry.occurrenceDate,
      article_classes: [...articleClasses].filter(Boolean),
      parent_entry_kind: parent?.entryKind ?? null,
      mention_ids: richText.mentionIds,
      embedded_attachments: richText.embeddedAttachments,
    },
  };

  return {
    record: rootRecord,
    comments: parseComments($, entry.fileName, entryIdForPath),
    campfireLines:
      entry.entryKind === "campfire"
        ? parseCampfireLines($, entry.fileName, entryIdForPath, entry.sourceId)
        : [],
    exportRenderedAt:
      $("body > header time[datetime], body > main time[datetime]")
        .first()
        .attr("datetime") ?? null,
  };
}
