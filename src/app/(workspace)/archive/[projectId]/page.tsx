import {
  ArrowLeft,
  Database,
  FileStack,
  History,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArchiveFilters } from "@/components/archive/archive-filters";
import {
  ArchiveFileList,
  ArchiveRecordList,
} from "@/components/archive/archive-results";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getArchiveProjectData } from "@/lib/archive-data";

function value(input: string | string[] | undefined) {
  return typeof input === "string" ? input : "";
}

export default async function ArchiveProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const search = value(query.q).trim();
  const recordType = value(query.type);
  const dateFrom = value(query.from);
  const dateTo = value(query.to);
  const data = await getArchiveProjectData(projectId, {
    query: search,
    recordType: recordType && recordType !== "all" ? recordType : undefined,
  });
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <Button asChild className="-ml-2" size="sm" variant="ghost">
        <Link href="/archive">
          <ArrowLeft />
          All archive projects
        </Link>
      </Button>

      <header className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Basecamp history</Badge>
              {data.project.isReadOnly ? (
                <Badge variant="outline">
                  <LockKeyhole className="mr-1 size-3" />
                  Read only
                </Badge>
              ) : (
                <Badge asChild variant="outline">
                  <Link href={`/projects/${projectId}`}>Open workspace</Link>
                </Badge>
              )}
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {data.project.name}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Source-authentic records, threads, and imported files from the
              official Basecamp export.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-5 text-center">
            <HeaderMetric
              icon={Database}
              label="Records"
              value={data.counts.recordCount}
            />
            <HeaderMetric
              icon={History}
              label="Entries"
              value={data.counts.entryCount}
            />
            <HeaderMetric
              icon={FileStack}
              label="Files"
              value={data.counts.importedFileCount}
            />
          </div>
        </div>
      </header>

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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 space-y-4">
          <div>
            <h2 className="text-xl font-semibold">
              {search ? `Results for “${search}”` : "Project history"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Showing {data.records.length} bounded records
              {recordType && recordType !== "all"
                ? ` · ${recordType.replaceAll("_", " ")}`
                : ""}
            </p>
          </div>
          <ArchiveRecordList records={data.records} />
        </section>

        <aside>
          <Card className="xl:sticky xl:top-24">
            <CardHeader>
              <CardTitle className="text-base">Imported files</CardTitle>
            </CardHeader>
            <CardContent>
              <ArchiveFileList files={data.files} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function HeaderMetric({
  icon: Icon,
  label,
  value: metricValue,
}: {
  icon: typeof Database;
  label: string;
  value: number;
}) {
  return (
    <div>
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <p className="mt-1 text-lg font-semibold">{metricValue.toLocaleString()}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
