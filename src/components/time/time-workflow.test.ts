import { describe, expect, it } from "vitest";

import {
  bulkTimeEntryStatusSchema,
  createTimeEntrySchema,
} from "@/lib/psa/validation";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];

describe("time workflow validation", () => {
  it("accepts a retainer selection for server-side period resolution", () => {
    expect(
      createTimeEntrySchema.safeParse({
        clientId: ids[0],
        projectId: ids[1],
        retainerId: "00000000-0000-4000-8000-000000000003",
        entryDate: "2026-08-11",
        durationMinutes: 90,
        description: "Retainer delivery",
        billable: true,
      }).success,
    ).toBe(true);
  });

  it("accepts unique manager bulk decisions and rejects duplicate IDs", () => {
    expect(
      bulkTimeEntryStatusSchema.safeParse({
        ids,
        status: "approved",
      }).success,
    ).toBe(true);
    expect(
      bulkTimeEntryStatusSchema.safeParse({
        ids: [ids[0], ids[0]],
        status: "rejected",
      }).success,
    ).toBe(false);
  });
});
