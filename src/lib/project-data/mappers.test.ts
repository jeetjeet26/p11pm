import { describe, expect, it } from "vitest";

import {
  mapActivity,
  mapDueCursor,
  mapPositionCursor,
  mapProject,
  mapTimestampCursor,
  mapTodo,
} from "@/lib/project-data/mappers";

describe("bounded project data mappers", () => {
  it("maps explicit todo RPC fields and optimistic versions", () => {
    expect(
      mapTodo({
        id: "todo-1",
        project_id: "project-1",
        todo_list_id: "list-1",
        title: "Ship it",
        assigned_to: "profile-1",
        assignee_ids: ["profile-1", "profile-2"],
        completion_subscriber_ids: ["profile-3"],
        due_at: "2026-08-12T17:00:00.000Z",
        status: "done",
        priority: "urgent",
        updated_at: "2026-08-08T20:00:00.000Z",
        version: "7",
      }),
    ).toMatchObject({
      id: "todo-1",
      status: "completed",
      priority: "high",
      dueDate: "2026-08-12",
      assigneeIds: ["profile-1", "profile-2"],
      completionSubscriberIds: ["profile-3"],
      version: 7,
    });
  });

  it("normalizes database-only project statuses for the UI", () => {
    expect(mapProject({ id: "p1", status: "planning", metadata: {} }).status).toBe(
      "on_hold",
    );
    expect(mapProject({ id: "p2", status: "cancelled", metadata: {} }).status).toBe(
      "completed",
    );
  });

  it("maps route-specific keyset cursors", () => {
    expect(
      mapTimestampCursor(
        { created_at: "2026-08-08T20:00:00Z", id: "event-1" },
        "created_at",
      ),
    ).toEqual({ timestamp: "2026-08-08T20:00:00Z", id: "event-1" });
    expect(
      mapPositionCursor({
        list_position: 2,
        todo_position: 5,
        id: "todo-5",
      }),
    ).toEqual({ listPosition: 2, todoPosition: 5, id: "todo-5" });
    expect(mapDueCursor({ due_at: "infinity", id: "todo-last" })).toEqual({
      dueAt: "infinity",
      id: "todo-last",
    });
  });

  it("enriches activity without separate client-side workspace arrays", () => {
    expect(
      mapActivity({
        id: "event-1",
        project_id: "project-1",
        actor_id: "profile-1",
        action: "updated",
        summary: "Homepage proof",
        created_at: "2026-08-08T20:00:00Z",
        actor_name: "Maya Chen",
        project_name: "Aster House",
      }),
    ).toMatchObject({
      actorName: "Maya Chen",
      actorInitials: "MC",
      projectName: "Aster House",
    });
  });
});
