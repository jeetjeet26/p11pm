import { describe, expect, it } from "vitest";

import type { Todo } from "@/lib/types";
import { getWorkload, isDueSoon, isOverdue } from "@/lib/workload";

const now = new Date("2026-08-07T12:00:00");

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: crypto.randomUUID(),
    projectId: "project",
    listId: "list",
    title: "Test assignment",
    status: "open",
    priority: "normal",
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

describe("executive workload scoring", () => {
  it("classifies a small queue as light", () => {
    expect(getWorkload([todo()], now)).toBe("light");
  });

  it("weights near-term deadlines and overdue work", () => {
    const work = [
      todo({ dueDate: "2026-08-06" }),
      todo({ dueDate: "2026-08-08" }),
      todo({ dueDate: "2026-08-09" }),
    ];
    expect(getWorkload(work, now)).toBe("heavy");
  });

  it("uses estimates instead of raw counts once estimates are adopted", () => {
    const estimated = Array.from({ length: 8 }, () =>
      todo({
        estimatedMinutes: 60,
      } as Partial<Todo> & { estimatedMinutes: number }),
    );
    expect(getWorkload(estimated, now)).toBe("light");
    expect(
      getWorkload(
        [
          todo({
            estimatedMinutes: 1_800,
          } as Partial<Todo> & { estimatedMinutes: number }),
        ],
        now,
      ),
    ).toBe("heavy");
  });

  it("does not treat completed work as overdue", () => {
    expect(isOverdue(todo({ dueDate: "2026-08-01", status: "completed" }), now)).toBe(false);
  });

  it("recognizes dates due within seven days", () => {
    expect(isDueSoon(todo({ dueDate: "2026-08-14" }), now)).toBe(true);
    expect(isDueSoon(todo({ dueDate: "2026-08-20" }), now)).toBe(false);
  });
});
