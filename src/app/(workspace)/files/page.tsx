import { HardDrive } from "lucide-react";

import { FileBrowser } from "@/components/files/file-browser";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Files" };

export default async function FilesPage({
  searchParams,
}: PageProps<"/files">) {
  const params = await searchParams;
  const folderId = typeof params.folderId === "string" ? params.folderId : null;
  const fileId = typeof params.file === "string" ? params.file : undefined;
  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <HardDrive className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-tight">Files</h1>
                <Badge variant="secondary">Workspace</Badge>
              </div>
              <p className="mt-1 max-w-2xl text-muted-foreground">
                Team resources, client deliverables, project files, versions, and
                shared links in one permission-aware workspace.
              </p>
            </div>
          </div>
        </div>
      </header>
      <FileBrowser focusFileId={fileId} initialFolderId={folderId} />
    </div>
  );
}
