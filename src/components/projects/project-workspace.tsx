"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  File,
  FileText,
  ListChecks,
  LoaderCircle,
  Link as LinkIcon,
  MessageSquareText,
  MessagesSquare,
  Milestone,
  Paperclip,
  Plus,
  Send,
  Upload,
  UserRoundCheck,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { currentProfile } from "@/lib/demo-data";
import type {
  ProjectMessagesData,
  ProjectOverviewData,
  ProjectTodosData,
} from "@/lib/project-data/contracts";
import type {
  ChatMessage,
  DocumentItem,
  MessagePost,
  Profile,
  Project,
  Todo,
  TodoComment,
  TodoList,
  TodoSubtask,
} from "@/lib/types";
import { uploadProjectFile } from "@/lib/uploads/project-files";
import { cn } from "@/lib/utils";

type WorkspaceTab = "overview" | "todos" | "messages" | "campfire" | "files";

interface ProjectClientData {
  profiles: Profile[];
  todoLists: TodoList[];
  todoSubtasks: TodoSubtask[];
  todoComments: TodoComment[];
  milestones: ProjectOverviewData["milestones"];
  demoMode: boolean;
}

export function ProjectWorkspace({
  project,
  data,
}: {
  project: Project;
  data: ProjectOverviewData;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [projectTodos, setProjectTodos] = useState<Todo[]>([]);
  const [todoLists, setTodoLists] = useState<TodoList[]>([]);
  const [todoSubtasks, setTodoSubtasks] = useState<TodoSubtask[]>([]);
  const [todoComments, setTodoComments] = useState<TodoComment[]>([]);
  const [posts, setPosts] = useState<MessagePost[]>([]);
  const [chats, setChats] = useState(data.chats);
  const [documents, setDocuments] = useState(data.documents);
  const [loadedTabs, setLoadedTabs] = useState<Set<WorkspaceTab>>(
    () => new Set(["overview", "campfire", "files"]),
  );
  const [loadingTab, setLoadingTab] = useState<WorkspaceTab | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const clientData: ProjectClientData = {
    profiles: data.members,
    todoLists,
    todoSubtasks,
    todoComments,
    milestones: data.milestones,
    demoMode: data.demoMode,
  };

  function selectTab(tab: WorkspaceTab) {
    setActiveTab(tab);
    setLoadError(null);
    setLoadingTab(
      (tab === "todos" || tab === "messages") && !loadedTabs.has(tab)
        ? tab
        : null,
    );
  }

  useEffect(() => {
    if (
      (activeTab !== "todos" && activeTab !== "messages") ||
      loadedTabs.has(activeTab)
    ) {
      return;
    }

    const controller = new AbortController();
    const tab = activeTab;
    const endpoint =
      tab === "todos"
        ? `/api/todos?projectId=${encodeURIComponent(project.id)}`
        : `/api/messages?projectId=${encodeURIComponent(project.id)}`;

    void fetch(endpoint, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as
          | ProjectTodosData
          | ProjectMessagesData
          | { error?: string };
        if (!response.ok) {
          throw new Error("error" in body ? body.error : "Unable to load project data.");
        }
        if (tab === "todos") {
          const todoData = body as ProjectTodosData;
          setTodoLists(todoData.todoLists);
          setProjectTodos(todoData.todos);
          setTodoSubtasks(todoData.todoSubtasks);
          setTodoComments(todoData.todoComments);
        } else {
          setPosts((body as ProjectMessagesData).messages);
        }
        setLoadedTabs((current) => new Set(current).add(tab));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load project data.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingTab((current) => (current === tab ? null : current));
        }
      });

    return () => controller.abort();
  }, [activeTab, loadedTabs, project.id]);

  useEffect(() => {
    if (data.demoMode) return;
    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`project-chat:${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          const row = payload.new as Record<string, string>;
          setChats((current) => {
            if (current.some((message) => message.id === row.id)) return current;
            return [
              ...current,
              {
                id: row.id,
                projectId: row.project_id,
                authorId: row.profile_id,
                body: row.content,
                createdAt: row.created_at,
              },
            ];
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.demoMode, project.id]);

  const toolCards = [
    {
      id: "todos" as const,
      label: "To-dos",
      description: `${loadedTabs.has("todos") ? projectTodos.filter((todo) => todo.status !== "completed").length : data.tabCounts.openTodos} open assignments`,
      icon: ListChecks,
    },
    {
      id: "messages" as const,
      label: "Message board",
      description: `${loadedTabs.has("messages") ? posts.length : data.tabCounts.messages} project updates`,
      icon: MessageSquareText,
    },
    {
      id: "campfire" as const,
      label: "Campfire",
      description: "Quick team conversation",
      icon: MessagesSquare,
    },
    {
      id: "files" as const,
      label: "Docs & files",
      description: `${data.tabCounts.documents} shared items`,
      icon: Paperclip,
    },
  ];

  return (
    <Tabs
      onValueChange={(value) => selectTab(value as WorkspaceTab)}
      value={activeTab}
    >
      <div className="mb-6 overflow-x-auto">
        <TabsList className="h-auto min-w-max">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="todos">To-dos</TabsTrigger>
          <TabsTrigger value="messages">Message board</TabsTrigger>
          <TabsTrigger value="campfire">Campfire</TabsTrigger>
          <TabsTrigger value="files">Docs & files</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-4 sm:grid-cols-2">
            {toolCards.map((tool) => (
              <button
                className="group rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                key={tool.id}
                onClick={() => selectTab(tool.id)}
                type="button"
              >
                <Card className="h-full transition-colors group-hover:border-primary/35">
                  <CardContent className="flex items-start gap-4 p-5">
                    <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                      <tool.icon className="size-5" />
                    </div>
                    <div>
                      <p className="font-semibold">{tool.label}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{tool.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </button>
            ))}
          </div>
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Upcoming milestones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.milestones.filter((item) => item.projectId === project.id).length ? (
                data.milestones
                  .filter((item) => item.projectId === project.id)
                  .map((item) => (
                    <div className="flex items-start gap-3" key={item.id}>
                      <div className="grid size-8 place-items-center rounded-lg bg-muted">
                        <Milestone className="size-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{item.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(item.dueDate)}
                        </p>
                      </div>
                    </div>
                  ))
              ) : (
                <p className="text-sm text-muted-foreground">No upcoming milestones.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="todos">
        {loadingTab === "todos" ? (
          <TabLoading label="Loading to-dos" />
        ) : loadError && !loadedTabs.has("todos") ? (
          <TabLoadError message={loadError} />
        ) : (
          <TodoTool
            data={clientData}
            onCommentsChange={setTodoComments}
            onSubtasksChange={setTodoSubtasks}
            onTodosChange={setProjectTodos}
            project={project}
            todos={projectTodos}
          />
        )}
      </TabsContent>

      <TabsContent value="messages">
        {loadingTab === "messages" ? (
          <TabLoading label="Loading messages" />
        ) : loadError && !loadedTabs.has("messages") ? (
          <TabLoadError message={loadError} />
        ) : (
          <MessageBoard
            data={clientData}
            onPostsChange={setPosts}
            posts={posts}
            project={project}
          />
        )}
      </TabsContent>

      <TabsContent value="campfire">
        <Campfire chats={chats} data={clientData} onChatsChange={setChats} project={project} />
      </TabsContent>

      <TabsContent value="files">
        <DocsAndFiles
          data={clientData}
          documents={documents}
          onDocumentsChange={setDocuments}
          project={project}
        />
      </TabsContent>
    </Tabs>
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

function TodoTool({
  project,
  data,
  todos,
  onTodosChange,
  onSubtasksChange,
  onCommentsChange,
}: {
  project: Project;
  data: ProjectClientData;
  todos: Todo[];
  onTodosChange: React.Dispatch<React.SetStateAction<Todo[]>>;
  onSubtasksChange: React.Dispatch<React.SetStateAction<TodoSubtask[]>>;
  onCommentsChange: React.Dispatch<React.SetStateAction<TodoComment[]>>;
}) {
  const lists = data.todoLists.filter((list) => list.projectId === project.id);
  const memberProfiles = data.profiles.filter((profile) =>
    project.memberIds.includes(profile.id),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState(lists[0]?.id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [completionSubscriberIds, setCompletionSubscriberIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [selectedId, setSelectedId] = useState(todos[0]?.id ?? "");
  const subtasks = data.todoSubtasks;
  const comments = data.todoComments;
  const selectedTodo = todos.find((todo) => todo.id === selectedId) ?? todos[0];

  function togglePerson(
    id: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) {
    setter((current) =>
      current.includes(id)
        ? current.filter((profileId) => profileId !== id)
        : [...current, id],
    );
  }

  async function toggleTodo(todo: Todo, complete: boolean) {
    const status = complete ? "completed" : "open";
    onTodosChange((current) =>
      current.map((item) => (item.id === todo.id ? { ...item, status } : item)),
    );
    const response = await fetch("/api/todos", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: todo.id,
        status,
        expectedVersion: todo.version ?? 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) {
      onTodosChange((current) =>
        current.map((item) =>
          item.id === todo.id ? { ...item, status: todo.status } : item,
        ),
      );
    } else {
      const body = (await response.json()) as { todo?: Todo };
      if (body.todo) {
        const updated = normalizeTodo(body.todo, todo.projectId, todo.listId);
        onTodosChange((current) =>
          current.map((item) =>
            item.id === todo.id
              ? {
                  ...updated,
                  assigneeIds: updated.assigneeIds ?? item.assigneeIds,
                  completionSubscriberIds:
                    updated.completionSubscriberIds ??
                    item.completionSubscriberIds,
                }
              : item,
          ),
        );
      }
    }
  }

  async function createTodo(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        listId,
        title,
        assigneeIds,
        completionSubscriberIds,
        dueDate: dueDate || undefined,
        priority: "normal",
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const body = (await response.json()) as { todo?: Todo; error?: string };
    if (response.ok && body.todo) {
      const createdTodo = {
        ...normalizeTodo(body.todo, project.id, listId),
        assigneeIds,
        completionSubscriberIds,
      };
      onTodosChange((current) => [...current, createdTodo]);
      setSelectedId(createdTodo.id);
      setTitle("");
      setDueDate("");
      setAssigneeIds([]);
      setCompletionSubscriberIds([]);
      setDialogOpen(false);
    }
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">To-dos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan, assign, and complete project work in one place.
          </p>
        </div>
        <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus /> Add to-do</Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={createTodo}>
              <DialogHeader>
                <DialogTitle>Add a to-do</DialogTitle>
                <DialogDescription>Create clear, assigned work for this project.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-5">
                <div className="space-y-2">
                  <Label htmlFor="todo-title">What needs to be done?</Label>
                  <Input id="todo-title" onChange={(event) => setTitle(event.target.value)} required value={title} />
                </div>
                <div className="space-y-2">
                  <Label>Assigned to</Label>
                  <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
                    {memberProfiles.map((profile) => (
                      <label className="flex cursor-pointer items-center gap-2 text-sm" key={profile.id}>
                        <Checkbox
                          checked={assigneeIds.includes(profile.id)}
                          onCheckedChange={() => togglePerson(profile.id, setAssigneeIds)}
                        />
                        <Avatar className="size-6"><AvatarFallback className="text-[9px]">{profile.initials}</AvatarFallback></Avatar>
                        {profile.fullName}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>List</Label>
                    <Select onValueChange={setListId} value={listId}>
                      <SelectTrigger><SelectValue placeholder="Choose list" /></SelectTrigger>
                      <SelectContent>
                        {lists.map((list) => <SelectItem key={list.id} value={list.id}>{list.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="todo-date">Due date</Label>
                    <Input id="todo-date" onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notify when done</Label>
                  <div className="flex flex-wrap gap-2 rounded-lg border p-3">
                    {memberProfiles.map((profile) => (
                      <button
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                          completionSubscriberIds.includes(profile.id) && "border-primary bg-primary/10 text-primary",
                        )}
                        key={profile.id}
                        onClick={() => togglePerson(profile.id, setCompletionSubscriberIds)}
                        type="button"
                      >
                        <Bell className="size-3" />
                        {profile.fullName}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button disabled={saving || !listId} type="submit">
                  {saving && <LoaderCircle className="animate-spin" />} Create to-do
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          {lists.map((list) => {
            const listTodos = todos.filter((todo) => todo.listId === list.id);
            return (
              <Card key={list.id}>
                <CardHeader className="border-b py-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{list.name}</CardTitle>
                    <Badge variant="secondary">{listTodos.filter((todo) => todo.status !== "completed").length} open</Badge>
                  </div>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {listTodos.map((todo) => {
                    const people = (todo.assigneeIds?.length ? todo.assigneeIds : todo.assigneeId ? [todo.assigneeId] : [])
                      .map((id) => data.profiles.find((profile) => profile.id === id))
                      .filter(Boolean);
                    const overdue = todo.dueDate && new Date(`${todo.dueDate}T23:59:59`) < new Date() && todo.status !== "completed";
                    return (
                      <div className={cn("flex items-start gap-3 px-5 py-4 transition-colors", selectedTodo?.id === todo.id && "bg-primary/5")} key={todo.id}>
                        <Checkbox
                          aria-label={`Complete ${todo.title}`}
                          checked={todo.status === "completed"}
                          className="mt-0.5"
                          onCheckedChange={(checked) => void toggleTodo(todo, checked === true)}
                        />
                        <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(todo.id)} type="button">
                          <p className={cn("text-sm font-medium", todo.status === "completed" && "text-muted-foreground line-through")}>{todo.title}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {people.length > 0 && (
                              <span className="flex -space-x-1">
                                {people.map((person) => person && (
                                  <Avatar className="size-5 border border-card" key={person.id}><AvatarFallback className="text-[8px]">{person.initials}</AvatarFallback></Avatar>
                                ))}
                              </span>
                            )}
                            {todo.dueDate && (
                              <Badge variant={overdue ? "destructive" : "secondary"}>
                                <CalendarDays className="mr-1 size-3" /> {overdue ? "Overdue · " : ""}{formatDate(todo.dueDate)}
                              </Badge>
                            )}
                            {todo.status === "blocked" && <Badge variant="destructive">Blocked</Badge>}
                            <span>{subtasks.filter((item) => item.todoId === todo.id && item.completedAt).length}/{subtasks.filter((item) => item.todoId === todo.id).length} subtasks</span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                  {!listTodos.length && <p className="p-5 text-sm text-muted-foreground">No to-dos in this list yet.</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
        {selectedTodo && (
          <TodoThread
            comments={comments.filter((comment) => comment.todoId === selectedTodo.id)}
            data={data}
            onCommentsChange={onCommentsChange}
            onSubtasksChange={onSubtasksChange}
            onToggleTodo={toggleTodo}
            project={project}
            subtasks={subtasks.filter((subtask) => subtask.todoId === selectedTodo.id)}
            todo={selectedTodo}
          />
        )}
      </div>
    </div>
  );
}

function TodoThread({
  todo,
  project,
  data,
  subtasks,
  comments,
  onSubtasksChange,
  onCommentsChange,
  onToggleTodo,
}: {
  todo: Todo;
  project: Project;
  data: ProjectClientData;
  subtasks: TodoSubtask[];
  comments: TodoComment[];
  onSubtasksChange: React.Dispatch<React.SetStateAction<TodoSubtask[]>>;
  onCommentsChange: React.Dispatch<React.SetStateAction<TodoComment[]>>;
  onToggleTodo: (todo: Todo, complete: boolean) => Promise<void>;
}) {
  const [newSubtask, setNewSubtask] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentFile, setCommentFile] = useState<DocumentItem | null>(null);
  const [working, setWorking] = useState(false);
  const commentFileRef = useRef<HTMLInputElement>(null);
  const assigneeIds = todo.assigneeIds?.length
    ? todo.assigneeIds
    : todo.assigneeId
      ? [todo.assigneeId]
      : [];
  const assignees = data.profiles.filter((profile) => assigneeIds.includes(profile.id));
  const subscribers = data.profiles.filter((profile) =>
    (todo.completionSubscriberIds ?? []).includes(profile.id),
  );

  async function addSubtask(event: React.FormEvent) {
    event.preventDefault();
    if (!newSubtask.trim()) return;
    const title = newSubtask.trim();
    setNewSubtask("");
    const response = await fetch("/api/subtasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        todoId: todo.id,
        title,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as { subtask?: TodoSubtask & Record<string, unknown> };
    if (response.ok && result.subtask) {
      const row = result.subtask;
      onSubtasksChange((current) => [
        ...current,
        {
          id: String(row.id),
          todoId: String(row.todoId ?? row.todo_id ?? todo.id),
          title: String(row.title ?? title),
          position: Number(row.position ?? subtasks.length),
          version: Number(row.version ?? 1),
        },
      ]);
    }
  }

  async function toggleSubtask(subtask: TodoSubtask, completed: boolean) {
    const completedAt = completed ? new Date().toISOString() : undefined;
    onSubtasksChange((current) =>
      current.map((item) =>
        item.id === subtask.id ? { ...item, completedAt } : item,
      ),
    );
    const response = await fetch("/api/subtasks", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: subtask.id,
        completed,
        expectedVersion: subtask.version ?? 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) {
      onSubtasksChange((current) =>
        current.map((item) => (item.id === subtask.id ? subtask : item)),
      );
    } else {
      const result = (await response.json()) as {
        subtask?: TodoSubtask & Record<string, unknown>;
      };
      if (result.subtask) {
        const row = result.subtask;
        onSubtasksChange((current) =>
          current.map((item) =>
            item.id === subtask.id
              ? {
                  ...item,
                  completedAt:
                    String(row.completedAt ?? row.completed_at ?? "") || undefined,
                  completedBy:
                    String(row.completedBy ?? row.completed_by ?? "") || undefined,
                  version: Number(row.version ?? item.version ?? 1),
                }
              : item,
          ),
        );
      }
    }
  }

  async function uploadCommentFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setWorking(true);
    try {
      const uploaded = await uploadProjectFile(project.id, file);
      setCommentFile({
        id: uploaded.id,
        projectId: uploaded.projectId,
        title: uploaded.title,
        kind: "file",
        authorId: uploaded.authorId ?? currentProfile.id,
        size: uploaded.size,
        updatedAt: uploaded.updatedAt,
      });
    } catch (error) {
      console.error("Project comment file upload failed:", error);
    } finally {
      setWorking(false);
      event.target.value = "";
    }
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setWorking(true);
    const text = commentBody.trim();
    const mentionedProfileIds = data.profiles
      .filter((profile) =>
        new RegExp(`@(?:${escapeRegExp(profile.fullName)}|${escapeRegExp(profile.fullName.split(" ")[0])})\\b`, "i").test(text),
      )
      .map((profile) => profile.id);
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "comment",
        projectId: project.id,
        parentType: "todo",
        parentId: todo.id,
        body: text,
        mentionProfileIds: mentionedProfileIds,
        attachmentFileIds: commentFile ? [commentFile.id] : [],
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = (await response.json()) as { item?: Record<string, unknown> };
    if (response.ok && result.item) {
      const createdComment = result.item;
      onCommentsChange((current) => [
        ...current,
        {
          id: String(createdComment.id),
          todoId: todo.id,
          authorId: String(createdComment.author_id ?? currentProfile.id),
          body: text,
          createdAt: String(createdComment.created_at ?? new Date().toISOString()),
          mentionedProfileIds,
          attachments: commentFile
            ? [{ id: `attachment-${createdComment.id}`, title: commentFile.title, fileId: commentFile.id }]
            : [],
        },
      ]);
      setCommentBody("");
      setCommentFile(null);
    }
    setWorking(false);
  }

  return (
    <Card className="h-fit xl:sticky xl:top-24">
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant={todo.status === "completed" ? "secondary" : "default"}>
              {todo.status.replace("_", " ")}
            </Badge>
            <CardTitle className="mt-3 text-lg">{todo.title}</CardTitle>
          </div>
          <Button
            onClick={() => void onToggleTodo(todo, todo.status !== "completed")}
            size="sm"
            variant={todo.status === "completed" ? "outline" : "default"}
          >
            <CheckCircle2 />
            {todo.status === "completed" ? "Reopen" : "Mark complete"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <PeopleField icon={UserRoundCheck} label="Assigned to" people={assignees} />
          <PeopleField icon={Bell} label="When done" people={subscribers} />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Due on</p>
            <p className="mt-2 flex items-center gap-2 font-medium">
              <CalendarDays className="size-4 text-muted-foreground" />
              {todo.dueDate ? formatDate(todo.dueDate) : "No due date"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Source</p>
            <p className="mt-2">{todo.acceloTaskId ? "Imported record" : "P11 PM"}</p>
          </div>
        </div>

        <section>
          <p className="text-xs font-medium text-muted-foreground">Notes</p>
          <div className="mt-2 text-sm leading-6">
            {todo.description ? <LinkedText text={todo.description} /> : <span className="text-muted-foreground">No additional notes.</span>}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Subtasks</p>
            <span className="text-xs text-muted-foreground">{subtasks.filter((item) => item.completedAt).length}/{subtasks.length}</span>
          </div>
          <div className="mt-3 space-y-2">
            {subtasks.map((subtask) => (
              <label className="flex items-start gap-2 text-sm" key={subtask.id}>
                <Checkbox checked={Boolean(subtask.completedAt)} className="mt-0.5" onCheckedChange={(checked) => void toggleSubtask(subtask, checked === true)} />
                <span className={cn(subtask.completedAt && "text-muted-foreground line-through")}>{subtask.title}</span>
              </label>
            ))}
            <form className="flex gap-2 pt-1" onSubmit={addSubtask}>
              <Input aria-label="New subtask" onChange={(event) => setNewSubtask(event.target.value)} placeholder="Add a subtask…" value={newSubtask} />
              <Button aria-label="Add subtask" size="icon" variant="outline"><Plus /></Button>
            </form>
          </div>
        </section>

        <section className="border-t pt-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Discussion</p>
            <span className="text-xs text-muted-foreground">{comments.length} comments</span>
          </div>
          <div className="mt-4 space-y-5">
            {comments.map((comment) => {
              const author = data.profiles.find((profile) => profile.id === comment.authorId);
              return (
                <div className="flex gap-3" key={comment.id}>
                  <Avatar className="size-8"><AvatarFallback className="text-[10px]">{author?.initials ?? "P11"}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs"><span className="font-semibold">{author?.fullName ?? "P11 team"}</span> <span className="text-muted-foreground">{formatDateTime(comment.createdAt)}{comment.editedAt ? " · edited" : ""}</span></p>
                    <div className="mt-1 text-sm leading-6"><LinkedText text={comment.body} /></div>
                    {comment.attachments.map((attachment) => (
                      <a className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-primary hover:bg-muted" href={attachment.externalUrl ?? (attachment.fileId ? `/api/files/${attachment.fileId}` : "#")} key={attachment.id} rel="noreferrer" target={attachment.externalUrl || attachment.fileId ? "_blank" : undefined}>
                        <Paperclip className="size-3.5" /> {attachment.title}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <form className="mt-5 space-y-2" onSubmit={addComment}>
            <Textarea className="min-h-24" onChange={(event) => setCommentBody(event.target.value)} placeholder="Add a comment… Use @Name to mention someone." value={commentBody} />
            {commentFile && <Badge variant="secondary"><Paperclip className="mr-1 size-3" />{commentFile.title}</Badge>}
            <div className="flex items-center justify-between">
              <div>
                <input className="hidden" onChange={uploadCommentFile} ref={commentFileRef} type="file" />
                <Button disabled={working} onClick={() => commentFileRef.current?.click()} size="sm" type="button" variant="ghost"><Paperclip /> Attach</Button>
              </div>
              <Button disabled={working || !commentBody.trim()} size="sm">{working ? <LoaderCircle className="animate-spin" /> : <Send />} Comment</Button>
            </div>
          </form>
        </section>

        {subscribers.length > 0 && (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            <Bell className="size-3.5" />
            {subscribers.length} {subscribers.length === 1 ? "person" : "people"} will be notified when this is completed or commented on.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PeopleField({
  icon: Icon,
  label,
  people,
}: {
  icon: typeof Bell;
  label: string;
  people: ProjectClientData["profiles"];
}) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {people.length ? people.map((person) => (
          <Badge key={person.id} variant="secondary">
            <Icon className="mr-1 size-3" /> {person.fullName}
          </Badge>
        )) : <span className="text-sm text-muted-foreground">Nobody</span>}
      </div>
    </div>
  );
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[A-Za-z]+(?:\s[A-Za-z]+)?)/g);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return <a className="inline-flex items-center gap-1 break-all text-primary underline-offset-4 hover:underline" href={part} key={`${part}-${index}`} rel="noreferrer" target="_blank"><LinkIcon className="size-3" />{part}</a>;
    }
    if (part.startsWith("@")) {
      return <span className="font-medium text-primary" key={`${part}-${index}`}>{part}</span>;
    }
    return <span key={index}>{part}</span>;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function MessageBoard({
  project,
  data,
  posts,
  onPostsChange,
}: {
  project: Project;
  data: ProjectClientData;
  posts: MessagePost[];
  onPostsChange: React.Dispatch<React.SetStateAction<MessagePost[]>>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<MessagePost["category"]>("update");
  const [selected, setSelected] = useState<MessagePost | null>(null);
  const [comment, setComment] = useState("");
  const [localComments, setLocalComments] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);

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
      const createdPost = normalizePost(
        result.item,
        project.id,
        title,
        body,
        category,
      );
      onPostsChange((current) => [
        createdPost,
        ...current,
      ]);
      setTitle("");
      setBody("");
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
      current.map((post) => post.id === selected.id ? { ...post, commentCount: post.commentCount + 1 } : post),
    );
    await fetch("/api/messages", {
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
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Message board</h2>
            <p className="mt-1 text-sm text-muted-foreground">Durable updates, decisions, and creative feedback.</p>
          </div>
          <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
            <DialogTrigger asChild><Button><Plus /> New post</Button></DialogTrigger>
            <DialogContent>
              <form onSubmit={createPost}>
                <DialogHeader><DialogTitle>Post an update</DialogTitle><DialogDescription>Keep project context out of scattered threads.</DialogDescription></DialogHeader>
                <div className="grid gap-4 py-5">
                  <div className="space-y-2"><Label htmlFor="post-title">Title</Label><Input id="post-title" onChange={(event) => setTitle(event.target.value)} required value={title} /></div>
                  <div className="space-y-2"><Label>Category</Label><Select onValueChange={(value) => setCategory(value as MessagePost["category"])} value={category}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["update", "decision", "creative", "client"].map((item) => <SelectItem key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-2"><Label htmlFor="post-body">Message</Label><Textarea className="min-h-36" id="post-body" onChange={(event) => setBody(event.target.value)} required value={body} /></div>
                </div>
                <DialogFooter><Button disabled={saving}>{saving && <LoaderCircle className="animate-spin" />} Publish</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        {posts.map((post) => {
          const author = data.profiles.find((profile) => profile.id === post.authorId);
          return (
            <Card className={cn("cursor-pointer transition-colors hover:border-primary/30", selected?.id === post.id && "border-primary/40")} key={post.id} onClick={() => setSelected(post)}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Badge variant="secondary">{post.category}</Badge>
                    <h3 className="mt-3 text-lg font-semibold">{post.title}</h3>
                  </div>
                  <MessageSquareText className="size-5 text-muted-foreground" />
                </div>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{post.body}</p>
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{author?.fullName ?? "P11 team"} · {formatDateTime(post.createdAt)}</span>
                  <span>{post.commentCount} comments</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card className="h-fit xl:sticky xl:top-24">
        <CardHeader><CardTitle className="text-base">{selected ? "Post thread" : "Open a post"}</CardTitle></CardHeader>
        <CardContent>
          {selected ? (
            <div className="space-y-5">
              <div><h3 className="font-semibold">{selected.title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{selected.body}</p></div>
              <div className="border-t pt-4">
                {(localComments[selected.id] ?? []).map((text, index) => (
                  <div className="mb-4 flex gap-2" key={`${selected.id}-${index}`}>
                    <Avatar className="size-7"><AvatarFallback className="text-[9px]">{currentProfile.initials}</AvatarFallback></Avatar>
                    <div className="rounded-lg bg-muted px-3 py-2 text-sm">{text}</div>
                  </div>
                ))}
                {!localComments[selected.id]?.length && <p className="mb-4 text-xs text-muted-foreground">{selected.commentCount} existing comments will load from Supabase when configured.</p>}
                <form className="flex gap-2" onSubmit={addComment}>
                  <Input aria-label="Add comment" onChange={(event) => setComment(event.target.value)} placeholder="Add a comment…" value={comment} />
                  <Button aria-label="Send comment" size="icon"><Send /></Button>
                </form>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Select a message to read and join its thread.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Campfire({
  project,
  data,
  chats,
  onChatsChange,
}: {
  project: Project;
  data: ProjectClientData;
  chats: ChatMessage[];
  onChatsChange: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chats]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    const text = body.trim();
    setBody("");
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, body: text }),
    });
    const result = (await response.json()) as { message?: ChatMessage };
    if (response.ok && result.message) {
      const message = normalizeChat(result.message, project.id, text);
      onChatsChange((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    }
    setSending(false);
  }

  return (
    <Card className="mx-auto max-w-4xl overflow-hidden py-0">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div><h2 className="font-semibold">Campfire</h2><p className="text-xs text-muted-foreground">Live project chat · {project.slackChannel ?? "Slack channel not mapped"}</p></div>
        <Badge variant="secondary"><span className="mr-1.5 size-1.5 rounded-full bg-emerald-500" /> Realtime</Badge>
      </div>
      <ScrollArea className="h-[480px]">
        <div className="space-y-5 p-5">
          {chats.map((message) => {
            const author = data.profiles.find((profile) => profile.id === message.authorId) ?? currentProfile;
            return (
              <div className="flex gap-3" key={message.id}>
                <Avatar className="size-8"><AvatarFallback className="text-[10px]">{author.initials}</AvatarFallback></Avatar>
                <div><div className="flex items-baseline gap-2"><span className="text-sm font-medium">{author.fullName}</span><span className="text-[11px] text-muted-foreground">{formatDateTime(message.createdAt)}</span></div><p className="mt-1 text-sm leading-6">{message.body}</p></div>
              </div>
            );
          })}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      <form className="flex gap-2 border-t bg-muted/30 p-4" onSubmit={sendMessage}>
        <Input onChange={(event) => setBody(event.target.value)} placeholder="Message the project team…" value={body} />
        <Button disabled={sending || !body.trim()}><Send /> Send</Button>
      </form>
    </Card>
  );
}

function DocsAndFiles({
  project,
  data,
  documents,
  onDocumentsChange,
}: {
  project: Project;
  data: ProjectClientData;
  documents: DocumentItem[];
  onDocumentsChange: React.Dispatch<React.SetStateAction<DocumentItem[]>>;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");

  async function uploadFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadProjectFile(project.id, file);
      const createdFile: DocumentItem = {
        id: uploaded.id,
        projectId: uploaded.projectId,
        title: uploaded.title,
        kind: "file",
        authorId: uploaded.authorId ?? currentProfile.id,
        size: uploaded.size,
        updatedAt: uploaded.updatedAt,
      };
      onDocumentsChange((current) => [createdFile, ...current]);
    } catch (error) {
      console.error("Project file upload failed:", error);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function createDoc(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, title: docTitle, body: docBody }),
    });
    const result = (await response.json()) as { doc?: DocumentItem };
    if (response.ok && result.doc) {
      const createdDoc = normalizeDocument(
        result.doc,
        project.id,
        docTitle,
        "doc",
      );
      onDocumentsChange((current) => [createdDoc, ...current]);
      setDocOpen(false);
      setDocTitle("");
      setDocBody("");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><h2 className="text-xl font-semibold">Docs & files</h2><p className="mt-1 text-sm text-muted-foreground">Briefs, working documents, and production assets.</p></div>
        <div className="flex gap-2">
          <input className="hidden" onChange={uploadFile} ref={uploadRef} type="file" />
          <Button disabled={uploading} onClick={() => uploadRef.current?.click()} variant="outline">{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />} Upload</Button>
          <Dialog onOpenChange={setDocOpen} open={docOpen}>
            <DialogTrigger asChild><Button><FileText /> New doc</Button></DialogTrigger>
            <DialogContent>
              <form onSubmit={createDoc}>
                <DialogHeader><DialogTitle>Create a project doc</DialogTitle><DialogDescription>Capture a brief, decision, or working note.</DialogDescription></DialogHeader>
                <div className="grid gap-4 py-5"><div className="space-y-2"><Label htmlFor="doc-title">Title</Label><Input id="doc-title" onChange={(event) => setDocTitle(event.target.value)} required value={docTitle} /></div><div className="space-y-2"><Label htmlFor="doc-body">Content</Label><Textarea className="min-h-48" id="doc-body" onChange={(event) => setDocBody(event.target.value)} value={docBody} /></div></div>
                <DialogFooter><Button>Create doc</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {documents.map((item) => {
            const author = data.profiles.find((profile) => profile.id === item.authorId);
            return (
              <div className="flex items-center gap-4 px-5 py-4" key={item.id}>
                <div className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">{item.kind === "doc" ? <FileText className="size-5" /> : <File className="size-5" />}</div>
                <div className="min-w-0 flex-1">{item.kind === "file" ? <a className="block truncate text-sm font-medium text-primary hover:underline" href={`/api/files/${item.id}`}>{item.title}</a> : <p className="truncate text-sm font-medium">{item.title}</p>}<p className="mt-1 text-xs text-muted-foreground">{author?.fullName ?? "P11 team"} · {formatDateTime(item.updatedAt)} {item.size ? `· ${item.size}` : ""}</p></div>
                <Badge variant="secondary">{item.kind === "doc" ? "Doc" : "File"}</Badge>
              </div>
            );
          })}
          {!documents.length && <div className="p-10 text-center"><FileText className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 text-sm text-muted-foreground">No files or docs yet.</p></div>}
        </CardContent>
      </Card>
    </div>
  );
}

function normalizeTodo(todo: Todo, projectId: string, listId: string): Todo {
  const row = todo as Todo & Record<string, unknown>;
  const sourceStatus = String(row.status ?? "todo");
  const statusMap: Record<string, Todo["status"]> = {
    todo: "open",
    in_progress: "in_progress",
    blocked: "blocked",
    review: "in_progress",
    done: "completed",
    cancelled: "completed",
  };
  const sourcePriority = String(row.priority ?? "medium");
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? row.project_id ?? projectId),
    listId: String(row.listId ?? row.todo_list_id ?? listId),
    title: String(row.title),
    description: row.description ? String(row.description) : undefined,
    assigneeId: row.assigneeId ? String(row.assigneeId) : row.assigned_to ? String(row.assigned_to) : undefined,
    assigneeIds: Array.isArray(row.assigneeIds)
      ? row.assigneeIds.map(String)
      : Array.isArray(row.assignee_ids)
        ? row.assignee_ids.map(String)
        : undefined,
    completionSubscriberIds: Array.isArray(row.completionSubscriberIds)
      ? row.completionSubscriberIds.map(String)
      : Array.isArray(row.completion_subscriber_ids)
        ? row.completion_subscriber_ids.map(String)
        : undefined,
    dueDate: row.dueDate ? String(row.dueDate) : row.due_at ? String(row.due_at).slice(0, 10) : undefined,
    status: statusMap[sourceStatus] ?? (sourceStatus as Todo["status"]),
    priority: sourcePriority === "medium" ? "normal" : sourcePriority === "urgent" ? "high" : sourcePriority as Todo["priority"],
    acceloTaskId: row.acceloTaskId ? String(row.acceloTaskId) : row.accelo_task_id ? String(row.accelo_task_id) : undefined,
    updatedAt: String(row.updatedAt ?? row.updated_at ?? new Date().toISOString()),
    version: Number(row.version ?? 1),
  };
}

function normalizePost(item: MessagePost, projectId: string, title: string, body: string, category: MessagePost["category"]): MessagePost {
  const row = item as MessagePost & Record<string, unknown>;
  const metadata = typeof row.metadata === "object" && row.metadata ? row.metadata as Record<string, unknown> : {};
  return { id: String(row.id), projectId: String(row.projectId ?? row.project_id ?? projectId), title: String(row.title ?? row.subject ?? title), body: String(row.body ?? body), category: (row.category as MessagePost["category"]) ?? (metadata.category as MessagePost["category"]) ?? category, authorId: String(row.authorId ?? row.sender_id ?? currentProfile.id), createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()), commentCount: Number(row.commentCount ?? row.comment_count ?? 0) };
}

function normalizeChat(item: ChatMessage, projectId: string, body: string): ChatMessage {
  const row = item as ChatMessage & Record<string, unknown>;
  return { id: String(row.id), projectId: String(row.projectId ?? row.project_id ?? projectId), authorId: String(row.authorId ?? row.profile_id ?? currentProfile.id), body: String(row.body ?? row.content ?? body), createdAt: String(row.createdAt ?? row.created_at ?? new Date().toISOString()) };
}

function normalizeDocument(item: DocumentItem, projectId: string, title: string, kind: DocumentItem["kind"]): DocumentItem {
  const row = item as DocumentItem & Record<string, unknown>;
  return { id: String(row.id), projectId: String(row.projectId ?? row.project_id ?? projectId), title: String(row.title ?? row.file_name ?? title), kind, authorId: String(row.authorId ?? row.created_by ?? row.uploaded_by ?? currentProfile.id), size: row.size ? String(row.size) : typeof row.size_bytes === "number" ? `${Math.max(1, Math.round(row.size_bytes / 1024))} KB` : undefined, updatedAt: String(row.updatedAt ?? row.updated_at ?? row.created_at ?? new Date().toISOString()) };
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}
