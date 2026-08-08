import type { Todo, WorkloadLevel } from "@/lib/types";

export function getWorkload(
  todos: Todo[],
  now = new Date(),
): WorkloadLevel {
  const urgent = todos.filter(
    (todo) => isOverdue(todo, now) || isDueSoon(todo, now),
  ).length;
  const score = todos.length + urgent * 1.5;
  if (score <= 2) return "light";
  if (score >= 6) return "heavy";
  return "normal";
}

export function isOverdue(todo: Todo, now = new Date()) {
  return Boolean(
    todo.dueDate &&
      new Date(`${todo.dueDate}T23:59:59`) < now &&
      todo.status !== "completed",
  );
}

export function isDueSoon(todo: Todo, now = new Date()) {
  if (!todo.dueDate) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${todo.dueDate}T00:00:00`);
  const days =
    (dueDate.getTime() - today.getTime()) / 86_400_000;
  return days >= 0 && days <= 7;
}
