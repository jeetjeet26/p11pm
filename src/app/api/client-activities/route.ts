import { createPsaRouteHandlers } from "@/lib/psa/server";
import { activityWriteRow } from "@/lib/psa/mappers";
import {
  clientActivityQuerySchema,
  createClientActivitySchema,
  updateClientActivitySchema,
} from "@/lib/psa/validation";

const handlers = createPsaRouteHandlers({
  table: "client_activities",
  responseKey: "activities",
  querySchema: clientActivityQuerySchema,
  createSchema: createClientActivitySchema,
  updateSchema: updateClientActivitySchema,
  searchColumn: "subject",
  orderColumn: "occurred_at",
  fromColumn: "occurred_at",
  toColumn: "occurred_at",
  filters: {
    id: "id",
    clientId: "client_id",
    contactId: "contact_id",
    projectId: "project_id",
    activityType: "activity_type",
  },
  createDefaults: (input, context) => ({
    created_by: context.userId,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
  }),
  mapCreate: (input) => activityWriteRow(input),
  mapUpdate: (input) => activityWriteRow(input),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
