import { createPsaRouteHandlers } from "@/lib/psa/server";
import { clientWriteRow } from "@/lib/psa/mappers";
import {
  clientQuerySchema,
  createClientSchema,
  updateClientSchema,
} from "@/lib/psa/validation";

const handlers = createPsaRouteHandlers({
  table: "clients",
  responseKey: "clients",
  querySchema: clientQuerySchema,
  createSchema: createClientSchema,
  updateSchema: updateClientSchema,
  searchColumn: "name",
  orderColumn: "name",
  filters: {
    id: "id",
    status: "status",
    ownerId: "account_owner_id",
    parentClientId: "parent_client_id",
  },
  mapCreate: (input) => clientWriteRow(input),
  mapUpdate: (input) => clientWriteRow(input),
  createDefaults: (_input, context) => ({ created_by: context.userId }),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
