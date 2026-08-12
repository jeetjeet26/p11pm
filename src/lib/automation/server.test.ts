import { describe, expect, it, vi } from "vitest";

import { runAutomationCycle } from "@/lib/automation/server";

type QueryResult = { data: unknown; error: null | { message: string } };

function chain(result: QueryResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    lte: () => builder,
    not: () => builder,
    neq: () => builder,
    order: () => builder,
    limit: () => builder,
    update: () => builder,
    insert: () => builder,
    upsert: () => builder,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

describe("runAutomationCycle", () => {
  it("returns zero counts when no enabled rules exist", async () => {
    const client = {
      from: (table: string) => {
        if (table === "automation_rules") {
          return chain({ data: [], error: null });
        }
        if (table === "automation_rule_runs") {
          return chain({ data: [], error: null });
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    await expect(runAutomationCycle(client as never)).resolves.toEqual({
      enqueued: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
    });
  });

  it("enqueues overdue issue candidates without duplicating event keys", async () => {
    const upsert = vi.fn().mockResolvedValue({
      data: [{ id: "run-1" }],
      error: null,
    });
    const overdueDueAt = "2026-01-01T00:00:00.000Z";
    const client = {
      from: (table: string) => {
        if (table === "automation_rules") {
          return chain({
            data: [
              {
                id: "rule-1",
                organization_id: "org-1",
                project_id: "project-1",
                created_by: "user-1",
                trigger_type: "overdue",
                trigger_config: {},
                action_type: "notify",
                action_config: {},
                enabled: true,
              },
            ],
            error: null,
          });
        }
        if (table === "todos") {
          return chain({
            data: [
              {
                id: "issue-1",
                project_id: "project-1",
                title: "Blocked rollout",
                status: "open",
                priority: "high",
                due_at: overdueDueAt,
                updated_at: "2026-01-01T00:00:00.000Z",
                created_at: "2026-01-01T00:00:00.000Z",
                version: 1,
                assigned_to: "user-2",
                todo_assignees: [],
                projects: { organization_id: "org-1", owner_id: "user-3" },
              },
            ],
            error: null,
          });
        }
        if (table === "automation_rule_runs") {
          return {
            ...chain({ data: [], error: null }),
            upsert: (...args: unknown[]) => {
              upsert(...args);
              return {
                select: () =>
                  Promise.resolve({
                    data: [{ id: "run-1" }],
                    error: null,
                  }),
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await runAutomationCycle(client as never, { limit: 10 });
    expect(result.enqueued).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          rule_id: "rule-1",
          event_key: `overdue:issue-1:${overdueDueAt}`,
          trigger_source_type: "issue",
          trigger_source_id: "issue-1",
        }),
      ],
      expect.objectContaining({
        onConflict: "rule_id,event_key",
        ignoreDuplicates: true,
      }),
    );
  });
});
