"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  FileText,
  Gauge,
  KanbanSquare,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Plus,
  Send,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  IssueWorkspace,
  type IssueFilters,
} from "@/components/issues/issue-workspace";
import { FileBrowser } from "@/components/files/file-browser";
import { ProjectDocumentDialog } from "@/components/projects/project-document-dialog";
import {
  createChatCrossLinks,
  EntityLinkPicker,
  resolvePastedLink,
} from "@/components/cross-links/entity-link-picker";
import { LinkedConversations } from "@/components/cross-links/linked-conversations";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { currentProfile } from "@/lib/demo-data";
import type { CrossLinkSearchResult } from "@/lib/cross-links/types";
import type {
  ProjectMessagesData,
  ProjectOverviewData,
} from "@/lib/project-data/contracts";
import type {
  DocumentItem,
  MessagePost,
  Profile,
  Project,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type WorkspaceTab =
  | "issues"
  | "board"
  | "activity"
  | "messages"
  | "files";

interface ProjectClientData {
  profiles: Profile[];
  demoMode: boolean;
}

export function ProjectWorkspace({
  project,
  data,
  initialIssueId,
  initialTab = "issues",
  issueFilters,
}: {
  project: Project;
  data: ProjectOverviewData;
  initialIssueId?: string;
  initialTab?: WorkspaceTab;
  issueFilters?: Partial<IssueFilters>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [posts, setPosts] = useState<MessagePost[]>([]);
  const [documents, setDocuments] = useState(data.documents);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const clientData: ProjectClientData = {
    profiles: data.members,
    demoMode: data.demoMode,
  };

  useEffect(() => {
    if (activeTab !== "messages" || messagesLoaded) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoadingMessages(true);
      setLoadError(null);
      void fetch(`/api/messages?projectId=${encodeURIComponent(project.id)}`, {
        signal: controller.signal,
      })
      .then(async (response) => {
        const body = (await response.json()) as
          | ProjectMessagesData
          | { error?: string };
        if (!response.ok || !("messages" in body)) {
          throw new Error(
            "error" in body && body.error
              ? body.error
              : "Unable to load project messages.",
          );
        }
        setPosts(body.messages);
        setMessagesLoaded(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load project messages.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingMessages(false);
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, messagesLoaded, project.id]);

  function selectTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    const issueTab = tab === "issues" || tab === "board";
    const params = issueTab
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    params.set("tab", tab);
    const targetPath =
      issueTab && initialIssueId
        ? pathname
        : `/projects/${project.id}`;
    router.push(`${targetPath}?${params}`, { scroll: false });
  }

  return (
    <Tabs
      onValueChange={(value) => selectTab(value as WorkspaceTab)}
      value={activeTab}
    >
      <div className="sticky top-16 z-10 -mx-4 mb-6 overflow-x-auto border-y bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <TabsList className="h-auto min-w-max">
          <TabsTrigger value="issues">
            <ListTodo />
            Issues
          </TabsTrigger>
          <TabsTrigger value="board">
            <KanbanSquare />
            Board
          </TabsTrigger>
          <TabsTrigger value="activity">
            <Activity />
            Activity
          </TabsTrigger>
          <TabsTrigger value="messages">
            <MessageSquareText />
            Messages
          </TabsTrigger>
          <TabsTrigger value="files">
            <Paperclip />
            Files
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="issues">
        <IssueWorkspace
          initialFilters={issueFilters}
          initialIssueId={initialIssueId}
          profiles={data.members}
          project={project}
          view="issues"
        />
      </TabsContent>

      <TabsContent value="board">
        <IssueWorkspace
          initialFilters={issueFilters}
          initialIssueId={initialIssueId}
          profiles={data.members}
          project={project}
          view="board"
        />
      </TabsContent>

      <TabsContent value="activity">
        <ProjectActivitySummary
          data={data}
          focusedId={searchParams.get("milestone") ?? undefined}
          project={project}
        />
      </TabsContent>

      <TabsContent value="messages">
        {loadingMessages ? (
          <TabLoading label="Loading messages" />
        ) : loadError && !messagesLoaded ? (
          <TabLoadError message={loadError} />
        ) : (
          <MessageBoard
            data={clientData}
            initialSelectedId={searchParams.get("message") ?? undefined}
            onPostsChange={setPosts}
            posts={posts}
            project={project}
          />
        )}
      </TabsContent>

      <TabsContent value="files">
        <DocsAndFiles
          data={clientData}
          documents={documents}
          focusedId={
            searchParams.get("doc") ?? searchParams.get("file") ?? undefined
          }
          onDocumentsChange={setDocuments}
          project={project}
        />
      </TabsContent>
    </Tabs>
  );
}

function ProjectActivitySummary({
  data,
  focusedId,
  project,
}: {
  data: ProjectOverviewData;
  focusedId?: string;
  project: Project;
}) {
  const milestones = data.milestones.filter((item) => item.projectId === project.id);
  useEffect(() => {
    if (!focusedId) return;
    document
      .getElementById(`milestone-${focusedId}`)
      ?.scrollIntoView({ block: "center" });
  }, [data.milestones, focusedId]);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4" />
            Delivery activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <ContextMetric label="Open issues" value={data.tabCounts.openTodos} />
            <ContextMetric label="Updates" value={data.tabCounts.messages} />
            <ContextMetric label="Shared files" value={data.tabCounts.documents} />
          </div>
          <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            Status changes are recorded on each issue. Portfolio throughput and
            cycle-time reporting starts from those trustworthy transitions rather
            than inferring history from imported timestamps.
          </p>
          <Button asChild variant="outline">
            <Link href="/activity">
              Open workspace activity
              <ArrowUpRight />
            </Link>
          </Button>
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4" />
            Upcoming milestones
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {milestones.length ? (
            milestones.map((item) => (
              <div
                className="flex items-start justify-between gap-3"
                id={`milestone-${item.id}`}
                key={item.id}
              >
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.dueDate ? formatDate(item.dueDate) : "No due date"}
                  </p>
                  <LinkedConversations
                    compact
                    workId={item.id}
                    workType="milestone"
                  />
                </div>
                <Badge variant="secondary">Milestone</Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No upcoming milestones are recorded.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ContextMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function TabLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function TabLoadError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
      {message}
    </div>
  );
}

function MessageBoard({
  project,
  data,
  posts,
  initialSelectedId,
  onPostsChange,
}: {
  project: Project;
  data: ProjectClientData;
  posts: MessagePost[];
  initialSelectedId?: string;
  onPostsChange: React.Dispatch<React.SetStateAction<MessagePost[]>>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<MessagePost["category"]>("update");
  const [selectedByUser, setSelectedByUser] = useState<MessagePost | null>(null);
  const [comment, setComment] = useState("");
  const [postChatLinks, setPostChatLinks] = useState<CrossLinkSearchResult[]>([]);
  const [commentChatLinks, setCommentChatLinks] = useState<
    CrossLinkSearchResult[]
  >([]);
  const [localComments, setLocalComments] = useState<Record<string, string[]>>({});
  const [historicalComments, setHistoricalComments] = useState<
    Record<
      string,
      Array<{
        id: string;
        authorId?: string;
        body: string;
        createdAt: string;
        editedAt?: string;
      }>
    >
  >({});
  const [saving, setSaving] = useState(false);
  const selected =
    selectedByUser ??
    posts.find((post) => post.id === initialSelectedId) ??
    null;

  useEffect(() => {
    if (!selected || historicalComments[selected.id]) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        projectId: project.id,
        messageId: selected.id,
      });
      void fetch(`/api/messages?${query}`, { signal: controller.signal })
        .then(async (response) => {
          const result = (await response.json()) as {
            comments?: Array<{
              id: string;
              authorId?: string;
              body: string;
              createdAt: string;
              editedAt?: string;
            }>;
          };
          if (response.ok) {
            setHistoricalComments((current) => ({
              ...current,
              [selected.id]: result.comments ?? [],
            }));
          }
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [historicalComments, project.id, selected]);

  async function createPost(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "message",
        projectId: project.id,
        title,
        body,
        category,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as { item?: MessagePost };
    if (response.ok && result.item) {
      const item = result.item;
      if (postChatLinks.length) {
        await createChatCrossLinks(postChatLinks, "message", item.id);
      }
      onPostsChange((current) => [
        normalizePost(item, project.id, title, body, category),
        ...current,
      ]);
      setTitle("");
      setBody("");
      setPostChatLinks([]);
      setDialogOpen(false);
    }
    setSaving(false);
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    const text = comment.trim();
    setComment("");
    setLocalComments((current) => ({
      ...current,
      [selected.id]: [...(current[selected.id] ?? []), text],
    }));
    onPostsChange((current) =>
      current.map((post) =>
        post.id === selected.id
          ? { ...post, commentCount: post.commentCount + 1 }
          : post,
      ),
    );
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "comment",
        projectId: project.id,
        parentType: "message",
        parentId: selected.id,
        body: text,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as {
      item?: { id?: string };
    };
    if (response.ok && result.item?.id && commentChatLinks.length) {
      await createChatCrossLinks(
        commentChatLinks,
        "comment",
        result.item.id,
      );
    }
    setCommentChatLinks([]);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Project updates</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Durable decisions and client context that support issue delivery.
            </p>
          </div>
          <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus />
                New update
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={createPost}>
                <DialogHeader>
                  <DialogTitle>Post an update</DialogTitle>
                  <DialogDescription>
                    Capture a durable project decision or update.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-5">
                  <div className="space-y-2">
                    <Label htmlFor="post-title">Title</Label>
                    <Input
                      id="post-title"
                      onChange={(event) => setTitle(event.target.value)}
                      required
                      value={title}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      onValueChange={(value) =>
                        setCategory(value as MessagePost["category"])
                      }
                      value={category}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["update", "decision", "creative", "client"].map((item) => (
                          <SelectItem key={item} value={item}>
                            {item[0].toUpperCase() + item.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="post-body">Message</Label>
                    <Textarea
                      className="min-h-36"
                      id="post-body"
                      onChange={(event) => setBody(event.target.value)}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text");
                        void resolvePastedLink(pasted, "chat").then((result) => {
                          if (
                            result &&
                            !postChatLinks.some(
                              (link) =>
                                link.type === result.type && link.id === result.id,
                            )
                          ) {
                            setPostChatLinks([...postChatLinks, result]);
                          }
                        });
                      }}
                      required
                      value={body}
                    />
                    <EntityLinkPicker
                      disabled={saving}
                      onChange={setPostChatLinks}
                      scope="chat"
                      value={postChatLinks}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button disabled={saving}>
                    {saving && <LoaderCircle className="animate-spin" />}
                    Publish
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        {posts.map((post) => {
          const author = data.profiles.find(
            (profile) => profile.id === post.authorId,
          );
          return (
            <button
              className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={post.id}
              onClick={() => setSelectedByUser(post)}
              type="button"
            >
              <Card
                className={cn(
                  "transition-colors hover:border-primary/30",
                  selected?.id === post.id && "border-primary/40 bg-primary/5",
                )}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <Badge variant="secondary">{post.category}</Badge>
                      <h3 className="mt-3 text-lg font-semibold">{post.title}</h3>
                    </div>
                    <MessageSquareText className="size-5 text-muted-foreground" />
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {post.body}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {author?.fullName ?? "P11 team"} ·{" "}
                      {formatDateTime(post.createdAt)}
                    </span>
                    <span>{post.commentCount} comments</span>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
        {!posts.length && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No project updates yet.
            </CardContent>
          </Card>
        )}
      </div>
      <Card className="h-fit xl:sticky xl:top-32">
        <CardHeader>
          <CardTitle className="text-base">
            {selected ? "Update thread" : "Open an update"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selected ? (
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold">{selected.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {selected.body}
                </p>
                <LinkedConversations
                  compact
                  workId={selected.id}
                  workType="message"
                />
              </div>
              <div className="border-t pt-4">
                {(historicalComments[selected.id] ?? []).map((item) => {
                  const author = data.profiles.find(
                    (profile) => profile.id === item.authorId,
                  );
                  return (
                    <div className="mb-4 flex gap-2" key={item.id}>
                      <Avatar className="size-7">
                        <AvatarFallback className="text-[9px]">
                          {author?.initials ?? "P11"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 rounded-lg bg-muted px-3 py-2">
                        <p className="text-xs font-medium">
                          {author?.fullName ?? "P11 team"}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {formatDateTime(item.createdAt)}
                            {item.editedAt ? " · edited" : ""}
                          </span>
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm">{item.body}</p>
                        <LinkedConversations
                          compact
                          workId={item.id}
                          workType="comment"
                        />
                      </div>
                    </div>
                  );
                })}
                {(localComments[selected.id] ?? []).map((text, index) => (
                  <div className="mb-4 flex gap-2" key={`${selected.id}-${index}`}>
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[9px]">
                        {currentProfile.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                      {text}
                    </div>
                  </div>
                ))}
                {!historicalComments[selected.id]?.length &&
                  !localComments[selected.id]?.length && (
                  <p className="mb-4 text-xs text-muted-foreground">
                    No comments yet.
                  </p>
                )}
                <form className="space-y-2" onSubmit={addComment}>
                  <div className="flex gap-2">
                    <Input
                      aria-label="Add comment"
                      onChange={(event) => setComment(event.target.value)}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text");
                        void resolvePastedLink(pasted, "chat").then((result) => {
                          if (
                            result &&
                            !commentChatLinks.some(
                              (link) =>
                                link.type === result.type && link.id === result.id,
                            )
                          ) {
                            setCommentChatLinks([...commentChatLinks, result]);
                          }
                        });
                      }}
                      placeholder="Add a comment…"
                      value={comment}
                    />
                    <Button aria-label="Send comment" size="icon">
                      <Send />
                    </Button>
                  </div>
                  <EntityLinkPicker
                    onChange={setCommentChatLinks}
                    scope="chat"
                    value={commentChatLinks}
                  />
                </form>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select an update to read its context.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DocsAndFiles({
  project,
  data,
  documents,
  focusedId,
  onDocumentsChange,
}: {
  project: Project;
  data: ProjectClientData;
  documents: DocumentItem[];
  focusedId?: string;
  onDocumentsChange: React.Dispatch<React.SetStateAction<DocumentItem[]>>;
}) {
  useEffect(() => {
    if (!focusedId) return;
    document
      .getElementById(`project-resource-${focusedId}`)
      ?.scrollIntoView({ block: "center" });
  }, [documents, focusedId]);

  function handleDocumentSaved(saved: DocumentItem) {
    const document = normalizeDocument(saved, project.id, saved.title, "doc");
    onDocumentsChange((current) =>
      current.some((item) => item.id === document.id)
        ? current.map((item) => (item.id === document.id ? document : item))
        : [document, ...current],
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-xl font-semibold">Files and documents</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reference material that supports issue delivery.
          </p>
        </div>
        <div className="flex gap-2">
          <ProjectDocumentDialog
            demoMode={data.demoMode}
            onSaved={handleDocumentSaved}
            projectId={project.id}
            trigger={
              <Button>
                <FileText />
                New doc
              </Button>
            }
          />
        </div>
      </div>
      <FileBrowser compact projectId={project.id} />
      <Card>
        <CardContent className="divide-y p-0">
          {documents.filter((item) => item.kind === "doc").map((item) => {
            const author = data.profiles.find(
              (profile) => profile.id === item.authorId,
            );
            return (
              <div
                className="flex items-center gap-4 px-5 py-4"
                id={`project-resource-${item.id}`}
                key={item.id}
              >
                <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <FileText className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <ProjectDocumentDialog
                    demoMode={data.demoMode}
                    document={item}
                    onSaved={handleDocumentSaved}
                    projectId={project.id}
                    trigger={
                      <button
                        className="block w-full truncate text-left text-sm font-medium text-primary hover:underline"
                        type="button"
                      >
                        {item.title}
                      </button>
                    }
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {author?.fullName ?? "P11 team"} ·{" "}
                    {formatDateTime(item.updatedAt)} {item.size ? `· ${item.size}` : ""}
                  </p>
                  <LinkedConversations
                    compact
                    workId={item.id}
                    workType="doc"
                  />
                </div>
                <Badge variant="secondary">
                  Doc
                </Badge>
              </div>
            );
          })}
          {!documents.some((item) => item.kind === "doc") && (
            <div className="p-10 text-center">
              <FileText className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 text-sm text-muted-foreground">
                No files or documents yet.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function normalizePost(
  item: MessagePost,
  projectId: string,
  title: string,
  body: string,
  category: MessagePost["category"],
): MessagePost {
  const row = item as MessagePost & Record<string, unknown>;
  const metadata =
    typeof row.metadata === "object" && row.metadata
      ? (row.metadata as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? row.project_id ?? projectId),
    title: String(row.title ?? row.subject ?? title),
    body: String(row.body ?? body),
    category:
      (row.category as MessagePost["category"]) ??
      (metadata.category as MessagePost["category"]) ??
      category,
    authorId: String(row.authorId ?? row.sender_id ?? currentProfile.id),
    createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()),
    commentCount: Number(row.commentCount ?? row.comment_count ?? 0),
  };
}

function normalizeDocument(
  item: DocumentItem,
  projectId: string,
  title: string,
  kind: DocumentItem["kind"],
): DocumentItem {
  const row = item as DocumentItem & Record<string, unknown>;
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? row.project_id ?? projectId),
    title: String(row.title ?? row.file_name ?? title),
    kind,
    authorId: String(
      row.authorId ?? row.created_by ?? row.uploaded_by ?? currentProfile.id,
    ),
    size: row.size
      ? String(row.size)
      : typeof row.size_bytes === "number"
        ? `${Math.max(1, Math.round(row.size_bytes / 1024))} KB`
        : undefined,
    updatedAt: String(
      row.updatedAt ?? row.updated_at ?? row.created_at ?? new Date().toISOString(),
    ),
  };
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
