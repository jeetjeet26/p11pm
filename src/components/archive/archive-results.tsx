import {
  CalendarDays,
  Download,
  FileText,
  MessageCircle,
  Paperclip,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ArchiveFile,
  ArchiveRecord,
} from "@/lib/archive-data/contracts";
import { cn } from "@/lib/utils";

function formatTimestamp(value?: string) {
  if (!value) return "Source date unavailable";
  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function ArchiveRecordList({
  records,
  showProjectLinks = false,
}: {
  records: ArchiveRecord[];
  showProjectLinks?: boolean;
}) {
  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No matching history</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a broader search or another record type.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((record) => (
        <Card
          className={cn(record.parentId && "ml-5 border-l-4 sm:ml-10")}
          key={record.id}
        >
          <CardHeader className="gap-3 pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {record.type.replaceAll("_", " ")}
                  </Badge>
                  {record.parentId && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MessageCircle className="size-3" />
                      Thread reply
                    </span>
                  )}
                </div>
                <CardTitle className="mt-2 text-base">{record.title}</CardTitle>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <CalendarDays className="size-3.5" />
                {formatTimestamp(record.sourceUpdatedAt ?? record.sourceCreatedAt)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {record.sanitizedHtml ? (
              <div
                className="max-w-none overflow-hidden text-sm leading-6 text-foreground/90 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_img]:max-h-96 [&_img]:rounded-lg [&_li]:ml-5 [&_ol]:list-decimal [&_p+p]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: record.sanitizedHtml }}
              />
            ) : (
              <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {record.plainText || "No text content was included in this record."}
              </p>
            )}
            {showProjectLinks && record.projectId && (
              <Button asChild className="mt-4" size="sm" variant="outline">
                <Link href={`/archive/${record.projectId}`}>Open project history</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ArchiveFileList({ files }: { files: ArchiveFile[] }) {
  if (files.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Imported file metadata will appear here as projects are promoted.
      </p>
    );
  }
  return (
    <div className="divide-y">
      {files.map((file) => (
        <div className="flex items-center gap-3 py-3" key={file.id}>
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <Paperclip className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatBytes(file.sizeBytes)} · {file.referenceCount} references ·{" "}
              {file.availability}
            </p>
          </div>
          {file.availability === "available" ? (
            <Button
              aria-label={`Download ${file.name}`}
              asChild
              size="icon"
              variant="ghost"
            >
              <a href={`/api/files/${file.id}`}>
                <Download />
              </a>
            </Button>
          ) : (
            <Button
              aria-label={`${file.name} is not available yet`}
              disabled
              size="icon"
              variant="ghost"
            >
              <Download />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
