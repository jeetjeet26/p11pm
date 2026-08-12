import type { Todo, WorkloadLevel } from "@/lib/types";

export function getWorkload(
  todos: Todo[],
  now = new Date(),
  capacity?: {
    profileId?: string;
    weeklyCapacityHours?: number;
    allocationPercent?: number;
  },
): WorkloadLevel {
  const estimates = todos
    .map((todo) => allocatedEstimatedMinutes(todo, capacity?.profileId))
    .filter((minutes): minutes is number => minutes !== undefined);
  if (estimates.length) {
    const estimatedHours =
      estimates.reduce((total, minutes) => total + minutes, 0) / 60;
    const urgentHours = todos.reduce((total, todo) => {
      if (!isOverdue(todo, now) && !isDueSoon(todo, now)) return total;
      return total + (allocatedEstimatedMinutes(todo, capacity?.profileId) ?? 0) / 60;
    }, 0);
    const weightedHours = estimatedHours + urgentHours * 0.5;
    if (capacity) {
      const availableHours =
        Math.max(1, capacity.weeklyCapacityHours ?? 40) *
        Math.max(0.05, Math.min(1, (capacity.allocationPercent ?? 100) / 100));
      const utilization = weightedHours / availableHours;
      if (utilization < 0.3) return "light";
      if (utilization >= 0.75) return "heavy";
      return "normal";
    }
    if (weightedHours < 12) return "light";
    if (weightedHours >= 30) return "heavy";
    return "normal";
  }
  const urgent = todos.filter(
    (todo) => isOverdue(todo, now) || isDueSoon(todo, now),
  ).length;
  const score = todos.length + urgent * 1.5;
  if (score <= 2) return "light";
  if (score >= 6) return "heavy";
  return "normal";
}

function allocatedEstimatedMinutes(todo: Todo, profileId?: string) {
  const estimate = estimatedMinutes(todo);
  if (estimate === undefined || !profileId) return estimate;
  const assignees = todo.assigneeIds?.length
    ? todo.assigneeIds
    : todo.assigneeId
      ? [todo.assigneeId]
      : [];
  if (!assignees.includes(profileId) || assignees.length <= 1) return estimate;
  return estimate / assignees.length;
}

export function estimatedMinutes(todo: Todo): number | undefined {
  const value =
    "estimatedMinutes" in todo
      ? (todo as Todo & { estimatedMinutes?: unknown }).estimatedMinutes
      : undefined;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
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
