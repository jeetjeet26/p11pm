import {
  Archive,
  Database,
  FileStack,
  FolderArchive,
  HardDriveUpload,
} from "lucide-react";
import Link from "next/link";

import { ArchiveFilters } from "@/components/archive/archive-filters";
import { ArchiveRecordList } from "@/components/archive/archive-results";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getArchiveIndexData } from "@/lib/archive-data";

export const metadata = { title: "Basecamp archive" };

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : "";
}

function percentage(current: number, expected: number) {
  return expected === 0 ? 0 : Math.min(100, (current / expected) * 100);
}

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const search = value(query.q).trim();
  const recordType = value(query.type);
  const dateFrom = value(query.from);
  const dateTo = value(query.to);
  const data = await getArchiveIndexData({
    query: search,
    recordType: recordType && recordType !== "all" ? recordType : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const progress = data.progress;

  return (
    <div className="space-y-7">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Basecamp archive
          </h1>
          <Badge variant="secondary">{data.projects.length} projects</Badge>
        </div>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Search the complete official export while operational work stays
          organized in the editable project workspace.
        </p>
      </header>

      {progress && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDriveUpload className="size-4" />
                Import progress
              </CardTitle>
              <Badge variant={progress.status === "completed" ? "default" : "secondary"}>
                {progress.phase} · {progress.status}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-3">
            <ProgressMetric
              current={progress.entriesProcessed}
              expected={progress.entriesExpected}
              label="Archive entries"
            />
            <ProgressMetric
              current={progress.recordsProcessed}
              expected={progress.recordsExpected}
              label="Search records"
            />
            <ProgressMetric
              current={progress.blobsReady}
              expected={progress.blobsExpected}
              label="Unique file blobs"
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <ArchiveFilters
            dateFrom={dateFrom}
            dateTo={dateTo}
            query={search}
            recordType={recordType || "all"}
          />
        </CardContent>
      </Card>

      {search ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Search results</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.results.length} bounded matches for “{search}”
            </p>
          </div>
          <ArchiveRecordList records={data.results} showProjectLinks />
        </section>
      ) : (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Project history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Active projects remain editable; archived project headers open
              this read-only history view.
            </p>
          </div>
          {data.projects.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.projects.map((project) => (
                <Link href={`/archive/${project.id}`} key={project.id}>
                  <Card className="h-full transition-colors hover:border-foreground/20">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="grid size-10 place-items-center rounded-xl bg-muted">
                          <FolderArchive className="size-5 text-muted-foreground" />
                        </div>
                        <Badge variant={project.isReadOnly ? "secondary" : "outline"}>
                          {project.isReadOnly ? "Read only" : "Active"}
                        </Badge>
                      </div>
                      <CardTitle className="line-clamp-2 pt-2 text-base">
                        {project.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                      <Metric
                        icon={Database}
                        label="records"
                        value={project.recordCount}
                      />
                      <Metric
                        icon={Archive}
                        label="entries"
                        value={project.entryCount}
                      />
                      <Metric
                        icon={FileStack}
                        label="files"
                        value={project.fileCount}
                      />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                The archive manifest has not been imported yet.
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function ProgressMetric({
  label,
  current,
  expected,
}: {
  label: string;
  current: number;
  expected: number;
}) {
  const percent = percentage(current, expected);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {current.toLocaleString()} / {expected.toLocaleString()}
        </span>
      </div>
      <Progress aria-label={`${label} ${Math.round(percent)}% complete`} value={percent} />
    </div>
  );
}

function Metric({
  icon: Icon,
  value: metricValue,
  label,
}: {
  icon: typeof Archive;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <Icon className="size-3.5" />
      {metricValue.toLocaleString()} {label}
    </span>
  );
}
