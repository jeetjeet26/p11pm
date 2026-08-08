import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  WorkspaceChatEvent,
  WorkspaceChatEventPage,
  WorkspaceChatEventType,
} from "@/lib/chat/types";

const workspaceChatEventTypes = new Set<WorkspaceChatEventType>([
  "message.created",
  "conversation.upsert",
  "conversation.revoked",
  "conversation.read",
  "thread.read",
  "workspace.reset",
  "workspace.revoked",
]);

export interface WorkspaceChatSyncState {
  cursor: string;
  buffered: WorkspaceChatEvent[];
}

export type WorkspaceChatSyncAction =
  | { type: "broadcast"; event: WorkspaceChatEvent }
  | {
      type: "catch-up";
      events: WorkspaceChatEvent[];
      hasMore: boolean;
      resetRequired: boolean;
    }
  | { type: "reconnect" };

export interface WorkspaceChatSyncReduction {
  state: WorkspaceChatSyncState;
  applied: WorkspaceChatEvent[];
  needsCatchUp: boolean;
  resetRequired: boolean;
}

function sequence(value: string) {
  return BigInt(value);
}

function compareEvents(first: WorkspaceChatEvent, second: WorkspaceChatEvent) {
  const firstSequence = sequence(first.sequence);
  const secondSequence = sequence(second.sequence);
  if (firstSequence === secondSequence) return 0;
  return firstSequence < secondSequence ? -1 : 1;
}

function mergeBufferedEvents(
  current: WorkspaceChatEvent[],
  incoming: WorkspaceChatEvent[],
) {
  const bySequence = new Map<string, WorkspaceChatEvent>();
  for (const event of [...current, ...incoming]) {
    bySequence.set(event.sequence, event);
  }
  return [...bySequence.values()].sort(compareEvents);
}

function consumeContiguousEvents(
  cursor: string,
  events: WorkspaceChatEvent[],
) {
  let nextCursor = sequence(cursor);
  const applied: WorkspaceChatEvent[] = [];
  const buffered: WorkspaceChatEvent[] = [];

  for (const event of events) {
    const eventSequence = sequence(event.sequence);
    if (eventSequence <= nextCursor) continue;
    if (
      eventSequence === nextCursor + BigInt(1) &&
      buffered.length === 0
    ) {
      applied.push(event);
      nextCursor = eventSequence;
      continue;
    }
    buffered.push(event);
  }

  return {
    cursor: nextCursor.toString(),
    applied,
    buffered,
  };
}

export function workspaceChatSyncReducer(
  state: WorkspaceChatSyncState,
  action: WorkspaceChatSyncAction,
): WorkspaceChatSyncReduction {
  if (action.type === "reconnect") {
    return {
      state,
      applied: [],
      needsCatchUp: true,
      resetRequired: false,
    };
  }

  const incoming =
    action.type === "broadcast" ? [action.event] : action.events;
  const merged = mergeBufferedEvents(state.buffered, incoming);
  const consumed = consumeContiguousEvents(state.cursor, merged);
  const resetRequired =
    action.type === "catch-up" && action.resetRequired;

  return {
    state: {
      cursor: consumed.cursor,
      buffered: consumed.buffered,
    },
    applied: resetRequired ? [] : consumed.applied,
    needsCatchUp:
      !resetRequired &&
      (action.type === "broadcast"
        ? consumed.buffered.length > 0
        : action.hasMore || consumed.buffered.length > 0),
    resetRequired,
  };
}

export async function authenticateWorkspaceRealtime(
  client: SupabaseClient,
) {
  const {
    data: { session },
    error,
  } = await client.auth.getSession();
  if (error) throw error;
  if (!session?.access_token) {
    throw new Error("No authenticated browser session is available.");
  }
  await client.realtime.setAuth(session.access_token);
}

export function keepWorkspaceRealtimeAuthenticated(
  client: SupabaseClient,
  onError: (error: unknown) => void,
) {
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((_event, session) => {
    if (!session?.access_token) return;
    queueMicrotask(() => {
      void client.realtime.setAuth(session.access_token).catch(onError);
    });
  });
  return () => subscription.unsubscribe();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

export function parseWorkspaceChatBroadcast(
  value: unknown,
): WorkspaceChatEvent | undefined {
  if (!isRecord(value)) return undefined;
  const payload = isRecord(value.payload) ? value.payload : value;
  const eventType = optionalString(payload.type) as
    | WorkspaceChatEventType
    | undefined;
  const eventSequence = optionalString(payload.sequence);
  const eventAt = optionalString(payload.event_at);
  if (
    !eventType ||
    !workspaceChatEventTypes.has(eventType) ||
    !eventSequence ||
    !/^\d+$/.test(eventSequence) ||
    !eventAt
  ) {
    return undefined;
  }
  return {
    sequence: eventSequence,
    type: eventType,
    conversationId: optionalString(payload.conversation_id),
    messageId: optionalString(payload.message_id),
    parentMessageId: optionalString(payload.parent_message_id),
    senderId: optionalString(payload.sender_id),
    eventAt,
  };
}

export class WorkspaceChatSyncController {
  private state: WorkspaceChatSyncState;
  private catchUpPromise?: Promise<void>;
  private catchUpAbortController?: AbortController;
  private disposed = false;

  constructor(
    cursor: string,
    private readonly fetchPage: (
      cursor: string,
      signal: AbortSignal,
    ) => Promise<WorkspaceChatEventPage>,
    private readonly onEvents: (events: WorkspaceChatEvent[]) => void,
    private readonly onReset: () => void,
    private readonly onError: (error: unknown) => void,
  ) {
    this.state = { cursor, buffered: [] };
  }

  get cursor() {
    return this.state.cursor;
  }

  acceptBroadcast(event: WorkspaceChatEvent) {
    if (this.disposed) return;
    const reduction = workspaceChatSyncReducer(this.state, {
      type: "broadcast",
      event,
    });
    this.commit(reduction);
  }

  reconnect() {
    if (this.disposed) return;
    const reduction = workspaceChatSyncReducer(this.state, {
      type: "reconnect",
    });
    if (reduction.needsCatchUp) void this.catchUp();
  }

  dispose() {
    this.disposed = true;
    this.catchUpAbortController?.abort();
  }

  private commit(reduction: WorkspaceChatSyncReduction) {
    if (reduction.resetRequired) {
      this.onReset();
      return;
    }
    this.state = reduction.state;
    if (reduction.applied.length) this.onEvents(reduction.applied);
    if (reduction.needsCatchUp) void this.catchUp();
  }

  private catchUp() {
    if (this.catchUpPromise) return this.catchUpPromise;
    this.catchUpPromise = this.runCatchUp()
      .catch((error: unknown) => {
        if (!this.disposed) this.onError(error);
      })
      .finally(() => {
        this.catchUpPromise = undefined;
      });
    return this.catchUpPromise;
  }

  private async runCatchUp() {
    const abortController = new AbortController();
    this.catchUpAbortController = abortController;
    let emptyGapPages = 0;
    try {
      for (
        let pageNumber = 0;
        pageNumber < 100 && !this.disposed;
        pageNumber += 1
      ) {
        const page = await this.fetchPage(
          this.state.cursor,
          abortController.signal,
        );
        if (this.disposed) return;
        const reduction = workspaceChatSyncReducer(this.state, {
          type: "catch-up",
          events: page.events,
          hasMore: page.hasMore,
          resetRequired: page.resetRequired,
        });
        if (reduction.resetRequired) {
          this.onReset();
          return;
        }
        this.state = reduction.state;
        if (reduction.applied.length) this.onEvents(reduction.applied);

        if (page.hasMore) {
          emptyGapPages = 0;
          continue;
        }
        if (!this.state.buffered.length) return;
        if (page.events.length) {
          emptyGapPages = 0;
          continue;
        }
        emptyGapPages += 1;
        if (emptyGapPages >= 3) {
          this.onReset();
          return;
        }
      }

      if (!this.disposed) {
        throw new Error("Workspace chat catch-up exceeded its safety limit.");
      }
    } finally {
      if (this.catchUpAbortController === abortController) {
        this.catchUpAbortController = undefined;
      }
    }
  }
}
