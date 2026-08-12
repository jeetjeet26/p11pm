import { describe, expect, it } from "vitest";

import {
  fieldsForAcceloResource,
  normalizeAcceloRecord,
} from "@/lib/accelo/transform";
import {
  ACCELO_BUSINESS_RESOURCES,
  type AcceloBusinessResource,
} from "@/lib/accelo/types";

describe("Accelo transforms", () => {
  it("preserves fixed-value contract semantics independently of hours", () => {
    expect(
      normalizeAcceloRecord("contracts", {
        id: "contract-1",
        title: "Annual hosting",
        standing: "active",
        company: { id: "company-1" },
        contract_type: { title: "Annual Fixed Fee" },
        date_started: "1767225600",
        period_template: {
          id: "template-1",
          duration_unit: "year",
          allowance_type: "fixed_value",
          allowance_amount: "1200.00",
          amount: "1200.00",
        },
      }),
    ).toMatchObject({
      source_id: "contract-1",
      company_source_id: "company-1",
      cadence: "annual",
      allowance_type: "fixed_value",
      allowance_value_cents: 120000,
      included_minutes: 0,
      fee_cents: 120000,
    });
  });

  it("normalizes Accelo activity seconds and medium", () => {
    expect(
      normalizeAcceloRecord("activities", {
        id: "activity-1",
        against_type: "job",
        against_id: "job-1",
        medium: "email",
        subject: "Client reply",
        date_logged: "1786480000",
        billable: "3600",
        nonbillable: "900",
      }),
    ).toMatchObject({
      source_id: "activity-1",
      against_source_id: "job-1",
      activity_type: "email",
      duration_minutes: 75,
      billable_seconds: 3600,
      nonbillable_seconds: 900,
    });
  });

  it("extracts source ids from Accelo activity relationship paths", () => {
    expect(
      normalizeAcceloRecord("activities", {
        id: "activity-2",
        against_type: "affiliation",
        against: "affiliations/1279",
        against_id: "ignored-path-fallback",
      }),
    ).toMatchObject({
      source_id: "activity-2",
      against_source_id: "1279",
    });
  });

  it("requests linked objects required for deterministic promotion", () => {
    expect(fieldsForAcceloResource("contracts")).toContain("period_template()");
    expect(fieldsForAcceloResource("contract_periods")).toBe("_ALL");
    expect(fieldsForAcceloResource("invoices")).toContain("affiliation(company())");
  });

  it("preserves source contract-period allowance and consumption", () => {
    expect(
      normalizeAcceloRecord("contract_periods", {
        id: "period-1",
        contract: { id: "contract-1" },
        date_started: "1782864000",
        date_ended: "1785542399",
        standing: "closed",
        currency: "AUD",
        allowance_type: "fixed_value",
        allowance_amount: "5000",
        consumed_amount: "4200",
        rollover_amount: "300",
        overage_amount: "125",
        consumed_time: "7200",
        rollover_time: "1800",
        overage_time: "900",
      }),
    ).toMatchObject({
      contract_source_id: "contract-1",
      status: "closed",
      currency: "AUD",
      included_value_cents: 500000,
      consumed_value_cents: 420000,
      consumed_minutes: 120,
      rollover_value_cents: 30000,
      rollover_minutes: 30,
      overage_value_cents: 12500,
      overage_minutes: 15,
    });
  });

  it("preserves codes, currencies, ownership, participants, and issue state", () => {
    expect(
      normalizeAcceloRecord("jobs", {
        id: "job-1",
        title: "Source job",
        custom_id: "P11-CUSTOM",
        currency: { code: "CAD" },
        company: { id: "company-1" },
        manager: { id: "staff-1" },
        contacts: [{ id: "contact-1" }],
      }),
    ).toMatchObject({
      code: "P11-CUSTOM",
      currency: "CAD",
      manager_source_id: "staff-1",
      contact_source_ids: ["contact-1"],
    });
    expect(
      normalizeAcceloRecord("activities", {
        id: "activity-3",
        against_type: "job",
        against_id: "job-1",
        direction: "inbound",
        participants: [{ id: "contact-1" }],
        contract_period: { id: "period-1" },
      }),
    ).toMatchObject({
      direction: "inbound",
      participant_contact_source_ids: ["contact-1"],
      contract_period_source_id: "period-1",
    });
    expect(
      normalizeAcceloRecord("issues", {
        id: "issue-open",
        company: { id: "company-1" },
        contact: { id: "contact-1" },
        owner: { id: "staff-1" },
        issue_status: { title: "Waiting on Client" },
        standing: "waiting",
        date_raised: 1_754_438_400,
        date_first_response_due: 1_754_445_600,
        date_resolution_due: 1_754_524_800,
      }),
    ).toMatchObject({
      status: "review",
      source_state: "waiting",
      source_status: "Waiting on Client",
      contact_source_id: "contact-1",
      owner_source_id: "staff-1",
      opened_at: "2025-08-06T00:00:00.000Z",
      first_response_due_at: "2025-08-06T02:00:00.000Z",
      resolution_due_at: "2025-08-07T00:00:00.000Z",
    });
    expect(
      normalizeAcceloRecord("issues", {
        id: "issue-closed",
        company: { id: "company-1" },
        standing: "resolved",
        date_closed: 1_754_524_800,
      }),
    ).toMatchObject({
      status: "done",
      source_state: "resolved",
      closed_at: "2025-08-07T00:00:00.000Z",
      completed_at: "2025-08-07T00:00:00.000Z",
    });
  });

  it("normalizes every allowlisted source domain deterministically", () => {
    const fixtures: Record<
      AcceloBusinessResource,
      Record<string, unknown>
    > = {
      companies: { id: "1", name: "Company" },
      contacts: { id: "1", firstname: "Contact" },
      affiliations: {
        id: "1",
        company: { id: "1" },
        contact: { id: "1" },
      },
      staff: { id: "1", firstname: "Staff" },
      jobs: { id: "1", title: "Job", company: { id: "1" } },
      milestones: { id: "1", title: "Milestone", job: { id: "1" } },
      tasks: { id: "1", title: "Task", job: { id: "1" } },
      contracts: {
        id: "1",
        title: "Contract",
        company: { id: "1" },
        period_template: {},
      },
      contract_periods: {
        id: "1",
        contract: { id: "1" },
        period_start: "2026-08-01",
        period_end: "2026-08-31",
      },
      activities: {
        id: "1",
        against_type: "company",
        against_id: "1",
      },
      invoices: {
        id: "1",
        against_type: "company",
        against_id: "1",
      },
      payments: { id: "1", against_id: "1" },
      prospects: { id: "1", title: "Prospect", contact: { id: "1" } },
      issues: { id: "1", title: "Issue", company: { id: "1" } },
    };

    for (const resource of ACCELO_BUSINESS_RESOURCES) {
      expect(normalizeAcceloRecord(resource, fixtures[resource])).toMatchObject({
        source_id: "1",
      });
      expect(fieldsForAcceloResource(resource)).toBeTruthy();
    }
  });
});
