"use client";

import Image from "next/image";
import {
  ArchiveRestore,
  Bookmark,
  ChevronRight,
  Clock3,
  Download,
  File,
  FileImage,
  Files,
  Folder,
  FolderOpen,
  Grid2X2,
  Link2,
  List,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { LinkedConversations } from "@/components/cross-links/linked-conversations";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  FileComment,
  FileFolder,
  FileVersion,
  FileWorkspacePayload,
  FileWorkspaceView,
  WorkspaceFile,
} from "@/lib/files/types";
import { formatFileSize, previewKind } from "@/lib/files/types";
import { uploadWorkspaceFile } from "@/lib/uploads/workspace-files";
import { cn } from "@/lib/utils";

type SelectedItem =
  | { kind: "file"; item: WorkspaceFile }
  | { kind: "folder"; item: FileFolder };

const views: Array<{
  id: FileWorkspaceView;
  label: string;
  icon: typeof Files;
}> = [
  { id: "all", label: "All files", icon: Files },
  { id: "recent", label: "Recent", icon: Clock3 },
  { id: "shared", label: "Shared", icon: Users },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "trash", label: "Trash", icon: Trash2 },
];

const emptyPayload: FileWorkspacePayload = {
  folders: [],
  files: [],
  breadcrumbs: [],
  currentFolder: null,
  view: "all",
  nextCursor: null,
};

export function FileBrowser({
  projectId,
  clientId,
  compact = false,
  initialFolderId = null,
  focusFileId,
}: {
  projectId?: string;
  clientId?: string;
  compact?: boolean;
  initialFolderId?: string | null;
  focusFileId?: string;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [payload, setPayload] = useState(emptyPayload);
  const [view, setView] = useState<FileWorkspaceView>("all");
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [renameTarget, setRenameTarget] = useState<SelectedItem | null>(null);
  const [renameName, setRenameName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<WorkspaceFile | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ view });
    if (folderId) params.set("folderId", folderId);
    if (projectId) params.set("projectId", projectId);
    if (clientId) params.set("clientId", clientId);
    if (debouncedQuery) params.set("q", debouncedQuery);
    try {
      const response = await fetch(`/api/files/workspace?${params}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as FileWorkspacePayload & {
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load files.");
      setPayload(body);
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load files.");
    } finally {
      setLoading(false);
    }
  }, [clientId, debouncedQuery, folderId, projectId, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!focusFileId || details) return;
    const focused = payload.files.find((file) => file.id === focusFileId);
    if (!focused) return;
    const timer = window.setTimeout(() => setDetails(focused), 0);
    return () => window.clearTimeout(timer);
  }, [details, focusFileId, payload.files]);

  async function createFolder() {
    if (!createName.trim()) return;
    const response = await fetch("/api/files/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: createName,
        parentId: folderId,
        projectId: projectId ?? null,
        clientId: clientId ?? null,
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      setError(body?.error ?? "Could not create the folder.");
      return;
    }
    setCreateName("");
    setCreateOpen(false);
    await load();
  }

  async function uploadFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (!files.length) return;
    if (!folderId) {
      setError("Open or create a folder before uploading.");
      event.target.value = "";
      return;
    }
    setError(null);
    let uploadError: string | null = null;
    for (const [index, file] of files.entries()) {
      try {
        await uploadWorkspaceFile(folderId, file, {
          onProgress(progress) {
            setUploadProgress(
              Math.round(
                ((index + progress.percentage / 100) / files.length) * 100,
              ),
            );
          },
        });
      } catch (caught) {
        uploadError =
          caught instanceof Error ? caught.message : "Upload failed.";
        break;
      }
    }
    setUploadProgress(null);
    event.target.value = "";
    await load();
    if (uploadError) setError(uploadError);
  }

  async function mutate(item: SelectedItem, body: Record<string, unknown>) {
    const endpoint =
      item.kind === "file"
        ? `/api/files/${item.item.id}`
        : `/api/files/folders/${item.item.id}`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      setError(result?.error ?? "The action could not be completed.");
      return false;
    }
    await load();
    return true;
  }

  async function rename() {
    if (!renameTarget || !renameName.trim()) return;
    if (await mutate(renameTarget, { action: "rename", name: renameName })) {
      setRenameTarget(null);
      setRenameName("");
    }
  }

  async function bulk(action: "trash" | "restore") {
    const fileIds = [...selected]
      .filter((id) => id.startsWith("file:"))
      .map((id) => id.slice(5));
    const folderIds = [...selected]
      .filter((id) => id.startsWith("folder:"))
      .map((id) => id.slice(7));
    const response = await fetch("/api/files/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, fileIds, folderIds }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      setError(body?.error ?? "Bulk action failed.");
      return;
    }
    await load();
  }

  function openFolder(folder: FileFolder) {
    setFolderId(folder.id);
    setView("all");
    setQuery("");
  }

  function chooseView(next: FileWorkspaceView) {
    setView(next);
    setFolderId(null);
  }

  const items = useMemo(
    () => [
      ...payload.folders.map((item) => ({ kind: "folder" as const, item })),
      ...payload.files.map((item) => ({ kind: "file" as const, item })),
    ],
    [payload.files, payload.folders],
  );

  return (
    <div className={cn("grid gap-5", !compact && "lg:grid-cols-[220px_minmax(0,1fr)]")}>
      {!compact && (
        <aside className="space-y-1">
          {views.map((item) => (
            <Button
              className="w-full justify-start"
              key={item.id}
              onClick={() => chooseView(item.id)}
              variant={view === item.id && !folderId ? "secondary" : "ghost"}
            >
              <item.icon />
              {item.label}
            </Button>
          ))}
          <div className="pt-4">
            <p className="px-3 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Context
            </p>
            <Button className="w-full justify-start" variant="ghost">
              <FolderOpen />
              {projectId ? "Project files" : clientId ? "Client files" : "Team spaces"}
            </Button>
          </div>
        </aside>
      )}

      <section className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <Button
              onClick={() => {
                setFolderId(null);
                setView("all");
              }}
              size="sm"
              variant="ghost"
            >
              {projectId ? "Project files" : clientId ? "Client files" : "All files"}
            </Button>
            {payload.breadcrumbs.map((crumb) => (
              <div className="flex items-center gap-1" key={crumb.id}>
                <ChevronRight className="size-4 text-muted-foreground" />
                <Button
                  onClick={() => setFolderId(crumb.id)}
                  size="sm"
                  variant="ghost"
                >
                  {crumb.name}
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Search files"
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search this workspace"
                value={query}
              />
            </div>
            <Button onClick={() => setCreateOpen(true)} variant="outline">
              <Plus />
              Folder
            </Button>
            <input
              className="hidden"
              multiple
              onChange={uploadFiles}
              ref={uploadRef}
              type="file"
            />
            <Button
              disabled={uploadProgress !== null}
              onClick={() => uploadRef.current?.click()}
            >
              {uploadProgress === null ? (
                <Upload />
              ) : (
                <LoaderCircle className="animate-spin" />
              )}
              Upload
            </Button>
            <div className="flex rounded-lg border p-0.5">
              <Button
                aria-label="List view"
                onClick={() => setLayout("list")}
                size="icon-sm"
                variant={layout === "list" ? "secondary" : "ghost"}
              >
                <List />
              </Button>
              <Button
                aria-label="Grid view"
                onClick={() => setLayout("grid")}
                size="icon-sm"
                variant={layout === "grid" ? "secondary" : "ghost"}
              >
                <Grid2X2 />
              </Button>
            </div>
          </div>
        </div>

        {uploadProgress !== null && (
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Uploading files</span>
              <span>{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} />
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-muted p-2">
            <Badge variant="secondary">{selected.size} selected</Badge>
            <Button
              onClick={() => void bulk(view === "trash" ? "restore" : "trash")}
              size="sm"
              variant="outline"
            >
              {view === "trash" ? <ArchiveRestore /> : <Trash2 />}
              {view === "trash" ? "Restore" : "Move to trash"}
            </Button>
            <Button onClick={() => setSelected(new Set())} size="sm" variant="ghost">
              Clear
            </Button>
          </div>
        )}

        {error && (
          <div
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="p-0">
            {loading ? (
              <div className="grid min-h-64 place-items-center">
                <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                onCreate={() => setCreateOpen(true)}
                onUpload={() => uploadRef.current?.click()}
                view={view}
              />
            ) : layout === "grid" ? (
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((item) => (
                  <GridItem
                    item={item}
                    key={`${item.kind}:${item.item.id}`}
                    onDetails={setDetails}
                    onOpen={openFolder}
                    onRename={() => {
                      setRenameTarget(item);
                      setRenameName(
                        item.kind === "file" ? item.item.name : item.item.name,
                      );
                    }}
                    onMutate={mutate}
                    trash={view === "trash"}
                  />
                ))}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all"
                        checked={selected.size === items.length}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked
                              ? new Set(
                                  items.map(
                                    (item) => `${item.kind}:${item.item.id}`,
                                  ),
                                )
                              : new Set(),
                          )
                        }
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Context</TableHead>
                    <TableHead className="hidden sm:table-cell">Modified</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const key = `${item.kind}:${item.item.id}`;
                    return (
                      <FileRow
                        checked={selected.has(key)}
                        item={item}
                        key={key}
                        onChecked={(checked) => {
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                        onDetails={setDetails}
                        onOpen={openFolder}
                        onRename={() => {
                          setRenameTarget(item);
                          setRenameName(item.item.name);
                        }}
                        onMutate={mutate}
                        trash={view === "trash"}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription>
              Add a folder in the current location. It inherits this workspace
              context and access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-name">Folder name</Label>
            <Input
              autoFocus
              id="folder-name"
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createFolder();
              }}
              value={createName}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => setCreateOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={!createName.trim()} onClick={() => void createFolder()}>
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        open={Boolean(renameTarget)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename item</DialogTitle>
            <DialogDescription>
              Storage remains in place; only the workspace display name changes.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            onChange={(event) => setRenameName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void rename();
            }}
            value={renameName}
          />
          <DialogFooter>
            <Button onClick={() => setRenameTarget(null)} variant="outline">
              Cancel
            </Button>
            <Button disabled={!renameName.trim()} onClick={() => void rename()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FileDetails
        file={details}
        onChanged={load}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
      />
    </div>
  );
}

function FileRow({
  item,
  checked,
  trash,
  onChecked,
  onOpen,
  onDetails,
  onRename,
  onMutate,
}: {
  item: SelectedItem;
  checked: boolean;
  trash: boolean;
  onChecked: (checked: boolean) => void;
  onOpen: (folder: FileFolder) => void;
  onDetails: (file: WorkspaceFile) => void;
  onRename: () => void;
  onMutate: (item: SelectedItem, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const file = item.kind === "file" ? item.item : null;
  return (
    <TableRow data-state={checked ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          aria-label={`Select ${item.item.name}`}
          checked={checked}
          onCheckedChange={(value) => onChecked(Boolean(value))}
        />
      </TableCell>
      <TableCell>
        <button
          className="flex max-w-md items-center gap-3 text-left"
          onClick={() =>
            item.kind === "folder" ? onOpen(item.item) : onDetails(item.item)
          }
          type="button"
        >
          <ItemIcon item={item} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{item.item.name}</span>
            {file && (
              <span className="text-xs text-muted-foreground">
                {formatFileSize(file.sizeBytes)}
                {file.versionCount > 1 ? ` · ${file.versionCount} versions` : ""}
              </span>
            )}
          </span>
        </button>
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell">
        {item.item.projectId ? "Project" : item.item.clientId ? "Client" : "Workspace"}
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell">
        {new Date(item.item.updatedAt).toLocaleDateString()}
      </TableCell>
      <TableCell>
        <ItemMenu
          item={item}
          onDetails={onDetails}
          onMutate={onMutate}
          onRename={onRename}
          trash={trash}
        />
      </TableCell>
    </TableRow>
  );
}

function GridItem({
  item,
  trash,
  onOpen,
  onDetails,
  onRename,
  onMutate,
}: {
  item: SelectedItem;
  trash: boolean;
  onOpen: (folder: FileFolder) => void;
  onDetails: (file: WorkspaceFile) => void;
  onRename: () => void;
  onMutate: (item: SelectedItem, body: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <div className="group rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between">
        <button
          className="grid size-12 place-items-center rounded-xl bg-muted"
          onClick={() =>
            item.kind === "folder" ? onOpen(item.item) : onDetails(item.item)
          }
          type="button"
        >
          <ItemIcon item={item} />
        </button>
        <ItemMenu
          item={item}
          onDetails={onDetails}
          onMutate={onMutate}
          onRename={onRename}
          trash={trash}
        />
      </div>
      <button
        className="mt-4 block w-full truncate text-left text-sm font-medium"
        onClick={() =>
          item.kind === "folder" ? onOpen(item.item) : onDetails(item.item)
        }
        type="button"
      >
        {item.item.name}
      </button>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.kind === "file"
          ? formatFileSize(item.item.sizeBytes)
          : "Folder"}{" "}
        · {new Date(item.item.updatedAt).toLocaleDateString()}
      </p>
    </div>
  );
}

function ItemIcon({ item }: { item: SelectedItem }) {
  if (item.kind === "folder") {
    return <Folder className="size-5 fill-primary/15 text-primary" />;
  }
  const kind = previewKind(item.item.mimeType);
  return kind === "image" || kind === "svg" ? (
    <FileImage className="size-5 text-primary" />
  ) : (
    <File className="size-5 text-muted-foreground" />
  );
}

function ItemMenu({
  item,
  trash,
  onDetails,
  onRename,
  onMutate,
}: {
  item: SelectedItem;
  trash: boolean;
  onDetails: (file: WorkspaceFile) => void;
  onRename: () => void;
  onMutate: (item: SelectedItem, body: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Actions for ${item.item.name}`} size="icon-sm" variant="ghost">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {item.kind === "file" && (
          <>
            <DropdownMenuItem onClick={() => onDetails(item.item)}>
              <MessageSquare />
              Details, versions and comments
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={`/api/files/${item.item.id}`}>
                <Download />
                Download
              </a>
            </DropdownMenuItem>
          </>
        )}
        {!trash && (
          <>
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void onMutate(item, {
                  action: "favorite",
                  favorite: !item.item.favorite,
                })
              }
            >
              <Bookmark />
              {item.item.favorite ? "Remove favorite" : "Add favorite"}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            void onMutate(item, { action: trash ? "restore" : "trash" })
          }
          variant={trash ? "default" : "destructive"}
        >
          {trash ? <RotateCcw /> : <Trash2 />}
          {trash ? "Restore" : "Move to trash"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState({
  view,
  onCreate,
  onUpload,
}: {
  view: FileWorkspaceView;
  onCreate: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="grid min-h-72 place-items-center p-8 text-center">
      <div>
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-muted">
          {view === "trash" ? <Trash2 /> : <FolderOpen />}
        </div>
        <h3 className="mt-4 font-medium">
          {view === "trash" ? "Trash is empty" : "Nothing here yet"}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {view === "trash"
            ? "Deleted files and folders remain recoverable here."
            : "Create a folder to establish the hierarchy, then upload files into it."}
        </p>
        {view === "all" && (
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={onCreate} variant="outline">
              <Plus />
              New folder
            </Button>
            <Button onClick={onUpload}>
              <Upload />
              Upload
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FileDetails({
  file,
  onOpenChange,
  onChanged,
}: {
  file: WorkspaceFile | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const versionRef = useRef<HTMLInputElement>(null);
  const [comments, setComments] = useState<FileComment[]>([]);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [comment, setComment] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadDetails = useCallback(async () => {
    if (!file) return;
    const [commentsResponse, versionsResponse] = await Promise.all([
      fetch(`/api/files/${file.id}/comments`),
      fetch(`/api/files/${file.id}/versions`),
    ]);
    if (commentsResponse.ok) {
      const body = (await commentsResponse.json()) as { comments: FileComment[] };
      setComments(body.comments);
    }
    if (versionsResponse.ok) {
      const body = (await versionsResponse.json()) as { versions: FileVersion[] };
      setVersions(body.versions);
    }
  }, [file]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDetails(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDetails]);

  async function addComment() {
    if (!file || !comment.trim()) return;
    setBusy(true);
    await fetch(`/api/files/${file.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: comment }),
    });
    setComment("");
    await loadDetails();
    setBusy(false);
  }

  async function share() {
    if (!file || !guestEmail.trim()) return;
    setBusy(true);
    const response = await fetch(`/api/files/${file.id}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestEmail, permission: "view" }),
    });
    const body = (await response.json().catch(() => null)) as {
      shareUrl?: string;
    } | null;
    setShareUrl(body?.shareUrl ?? null);
    setBusy(false);
  }

  async function addVersion(event: React.ChangeEvent<HTMLInputElement>) {
    const upload = event.target.files?.[0];
    if (!file || !upload) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", upload);
    await fetch(`/api/files/${file.id}/versions`, {
      method: "POST",
      body: form,
    });
    event.target.value = "";
    await Promise.all([loadDetails(), onChanged()]);
    setBusy(false);
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(file)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl lg:max-w-5xl">
        {file && (
          <div className="space-y-6 p-1">
            <SheetHeader>
              <SheetTitle className="pr-8">{file.name}</SheetTitle>
              <SheetDescription>
                {formatFileSize(file.sizeBytes)} · Updated{" "}
                {new Date(file.updatedAt).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <FilePreview file={file} />

            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm">
                <a href={`/api/files/${file.id}`}>
                  <Download />
                  Download
                </a>
              </Button>
              {!["download", "svg"].includes(previewKind(file.mimeType)) && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`/api/files/${file.id}?preview=1`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Preview
                  </a>
                </Button>
              )}
            </div>
            <LinkedConversations workId={file.id} workType="file" />

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Version history</h3>
                  <p className="text-xs text-muted-foreground">
                    Restore or add a new immutable version.
                  </p>
                </div>
                <input
                  className="hidden"
                  onChange={addVersion}
                  ref={versionRef}
                  type="file"
                />
                <Button
                  disabled={busy}
                  onClick={() => versionRef.current?.click()}
                  size="sm"
                  variant="outline"
                >
                  <Upload />
                  New version
                </Button>
              </div>
              <div className="space-y-2">
                {versions.map((version) => (
                  <div
                    className="flex items-center justify-between rounded-lg border p-3"
                    key={version.id}
                  >
                    <div>
                      <p className="text-sm font-medium">
                        Version {version.versionNumber}
                        {version.current && (
                          <Badge className="ml-2" variant="secondary">
                            Current
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(version.sizeBytes)} ·{" "}
                        {new Date(version.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!version.current && (
                      <Button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          await fetch(`/api/files/${file.id}/versions`, {
                            method: "PATCH",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ versionId: version.id }),
                          });
                          await Promise.all([loadDetails(), onChanged()]);
                          setBusy(false);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        <RotateCcw />
                        Restore
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3 border-t pt-5">
              <div>
                <h3 className="flex items-center gap-2 font-medium">
                  <Share2 className="size-4" />
                  Share externally
                </h3>
                <p className="text-xs text-muted-foreground">
                  Create a revocable link for a guest email.
                </p>
              </div>
              <div className="flex gap-2">
                <Input
                  onChange={(event) => setGuestEmail(event.target.value)}
                  placeholder="client@example.com"
                  type="email"
                  value={guestEmail}
                />
                <Button disabled={busy || !guestEmail.trim()} onClick={() => void share()}>
                  Share
                </Button>
              </div>
              {shareUrl && (
                <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                  <Link2 className="size-4 shrink-0" />
                  <code className="min-w-0 flex-1 truncate">{shareUrl}</code>
                  <Button
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        new URL(shareUrl, window.location.origin).toString(),
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    Copy
                  </Button>
                </div>
              )}
            </section>

            <section className="space-y-3 border-t pt-5">
              <h3 className="flex items-center gap-2 font-medium">
                <MessageSquare className="size-4" />
                Comments
              </h3>
              <div className="space-y-2">
                {comments.map((item) => (
                  <div className="rounded-lg bg-muted p-3" key={item.id}>
                    <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                      <span>{item.authorName}</span>
                      <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
                  </div>
                ))}
                {!comments.length && (
                  <p className="text-sm text-muted-foreground">No comments yet.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Add a comment"
                  value={comment}
                />
                <Button disabled={busy || !comment.trim()} onClick={() => void addComment()}>
                  Send
                </Button>
              </div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FilePreview({ file }: { file: WorkspaceFile }) {
  const kind = previewKind(file.mimeType);
  const source = `/api/files/${file.id}?preview=1`;

  if (kind === "download") {
    return (
      <div className="grid min-h-52 place-items-center rounded-xl border bg-muted/30 p-8 text-center">
        <div>
          <File className="mx-auto size-10 text-muted-foreground" />
          <p className="mt-3 font-medium">Preview unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Download this file to open it in its native application.
          </p>
        </div>
      </div>
    );
  }

  if (kind === "image" || kind === "svg") {
    return (
      <div className="relative min-h-80 overflow-hidden rounded-xl border bg-muted/30">
        <Image
          alt={`Preview of ${file.name}`}
          className="object-contain p-4"
          fill
          sizes="(max-width: 640px) 100vw, 70vw"
          src={source}
          unoptimized
        />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <video
        className="max-h-[65vh] w-full rounded-xl border bg-black"
        controls
        preload="metadata"
        src={source}
      />
    );
  }

  if (kind === "audio") {
    return (
      <div className="rounded-xl border bg-muted/30 p-6">
        <audio className="w-full" controls preload="metadata" src={source} />
      </div>
    );
  }

  return (
    <iframe
      className="h-[65vh] min-h-96 w-full rounded-xl border bg-white"
      loading="lazy"
      src={source}
      title={`Preview of ${file.name}`}
    />
  );
}
