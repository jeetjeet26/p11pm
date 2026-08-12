import { describe, expect, it, vi } from "vitest";

import { materializeViewerAttention } from "@/lib/inbox/server";
import type { ViewerContext } from "@/lib/auth/viewer";

const viewer = {
  organization: { id: "org-1" },
  user: { id: "user-1" },
  role: "manager",
  capabilities: {
    timeApprove: true,
    pipelineWrite: true,
    commercialRead: true,
    commercialWrite: true,
  },
} as ViewerContext;

describe("materializeViewerAttention", () => {
  it("upserts permission-aware attention items for assigned work", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: (table: string) => {
        if (table === "support_tickets") {
          return {
            select: () => ({
              eq: () => ({
                not: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [
                        {
                          todo_id: "ticket-1",
                          first_response_due_at: "2026-08-12T00:00:00.000Z",
                          resolution_due_at: null,
                          todos: {
                            title: "Login issue",
                            priority: "high",
                            status: "open",
                            assigned_to: "user-1",
                            project_id: "project-1",
                          },
                          clients: { name: "Acme" },
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          };
        }
        if (table === "time_entries") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: [
                          {
                            id: "time-1",
                            project_id: "project-1",
                            entry_date: "2026-08-11",
                            minutes: 90,
                            description: "Design review",
                            projects: { name: "Website" },
                          },
                        ],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "issue_blockers") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: () => ({
                    limit: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "prospects") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => ({
                    not: () => ({
                      lte: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "retainers") {
          return {
            select: () => ({
              eq: () => ({
                not: () => ({
                  not: () => ({
                    lte: () => ({
                      limit: () => Promise.resolve({ data: [], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "invoices") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => ({
                    lte: () => ({
                      in: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            select: () => ({
              eq: () => ({
                limit: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        }
        if (table === "workspace_inbox_items") {
          return { upsert };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      rpc: () => Promise.resolve({ data: [], error: null }),
    };

    const count = await materializeViewerAttention(client as never, viewer);
    expect(count).toBe(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "support_ticket",
          source_type: "support_ticket",
          source_id: "ticket-1",
        }),
        expect.objectContaining({
          kind: "time_approval",
          source_type: "time_entry",
          source_id: "time-1",
        }),
      ]),
      expect.objectContaining({
        onConflict: "recipient_id,kind,source_type,source_id",
      }),
    );
  });
});
