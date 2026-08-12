import { createPsaRouteHandlers } from "@/lib/psa/server";
import { retainerUpdateRow, retainerWriteRow } from "@/lib/psa/mappers";
import {
  createRetainerSchema,
  retainerQuerySchema,
  updateRetainerSchema,
} from "@/lib/psa/validation";

const handlers = createPsaRouteHandlers({
  table: "retainers",
  responseKey: "retainers",
  querySchema: retainerQuerySchema,
  createSchema: createRetainerSchema,
  updateSchema: updateRetainerSchema,
  searchColumn: "name",
  orderColumn: "created_at",
  filters: {
    id: "id",
    clientId: "client_id",
    status: "status",
  },
  mapCreate: (input) => retainerWriteRow(input),
  mapUpdate: (input) => retainerUpdateRow(input),
  createDefaults: (_input, context) => ({ created_by: context.userId }),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
