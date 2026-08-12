import { mapTodo } from "@/lib/project-data/mappers";
import { createClient } from "@/lib/supabase/server";
import type { Todo } from "@/lib/types";

export async function getOperationalTodos({
  assignedToViewer = false,
  includeTriage = false,
  limit = 500,
}: {
  assignedToViewer?: boolean;
  includeTriage?: boolean;
  limit?: number;
} = {}): Promise<Todo[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let assignedTodoIds: string[] = [];
  if (assignedToViewer) {
    const assignments = await supabase
      .from("todo_assignees")
      .select("todo_id")
      .eq("profile_id", user.id)
      .limit(2_000);
    if (assignments.error) {
      console.error("Operational assignment lookup failed:", assignments.error);
      return null;
    }
    assignedTodoIds = (assignments.data ?? []).map(
      (assignment) => assignment.todo_id,
    );
  }

  let query = supabase
    .from("todos")
    .select(
      "*,projects!inner(is_read_only),todo_assignees(profile_id),todo_completion_subscribers(profile_id)",
    )
    .eq("projects.is_read_only", false)
    .not("status", "in", "(done,cancelled)")
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 2_000)));
  query = includeTriage
    ? query.in("operational_state", ["active", "triage"])
    : query.eq("operational_state", "active");
  if (assignedToViewer) {
    query = assignedTodoIds.length
      ? query.or(
          `assigned_to.eq.${user.id},id.in.(${assignedTodoIds.join(",")})`,
        )
      : query.eq("assigned_to", user.id);
  }
  const result = await query;
  if (result.error) {
    console.error("Operational todo lookup failed:", result.error);
    return null;
  }
  return (result.data ?? []).map((row) =>
    mapTodo({
      ...row,
      assignee_ids: (row.todo_assignees ?? []).map(
        (assignment: { profile_id: string }) => assignment.profile_id,
      ),
      completion_subscriber_ids: (
        row.todo_completion_subscribers ?? []
      ).map((subscriber: { profile_id: string }) => subscriber.profile_id),
    }),
  );
}
