import type { Database } from "@/lib/supabase/database.types";

export type PsaRow = Record<string, unknown>;
export type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
export type RetainerRow = Database["public"]["Tables"]["retainers"]["Row"];
export type TimeEntryRow = Database["public"]["Tables"]["time_entries"]["Row"];
export type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

export type PsaStatus = string;
export type CurrencyCode = string;
export type DecimalValue = number | string;

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  status: PsaStatus;
  parentClientId: string | null;
  website: string | null;
  phone: string | null;
  billingEmail: string | null;
  notes: string | null;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: PsaStatus;
}

export interface ClientActivity {
  id: string;
  organizationId: string;
  clientId: string;
  contactId: string | null;
  projectId: string | null;
  activityType: string;
  subject: string;
  body: string | null;
  occurredAt: string;
  createdBy: string;
}

export interface Retainer {
  id: string;
  organizationId: string;
  clientId: string;
  name: string;
  status: PsaStatus;
  billingModel: string;
  cadence: string;
  startDate: string;
  endDate: string | null;
  allowanceMinutes: number | null;
  fixedFee: DecimalValue | null;
  overagePolicy: string | null;
  overageRate: DecimalValue | null;
  currency: CurrencyCode;
}

export interface TimeEntry {
  id: string;
  organizationId: string;
  profileId: string;
  clientId: string;
  projectId: string | null;
  todoId: string | null;
  retainerId: string | null;
  retainerPeriodId: string | null;
  entryDate: string;
  durationMinutes: number;
  description: string | null;
  billable: boolean;
  status: PsaStatus;
  billRate: DecimalValue | null;
  costRate: DecimalValue | null;
  currency: CurrencyCode;
  invoiceLineItemId: string | null;
}

export interface Invoice {
  id: string;
  organizationId: string;
  clientId: string;
  invoiceNumber: string;
  status: PsaStatus;
  issueDate: string;
  dueDate: string;
  currency: CurrencyCode;
  subtotal: DecimalValue;
  taxTotal: DecimalValue;
  total: DecimalValue;
  amountPaid: DecimalValue;
  balanceDue: DecimalValue;
  notes: string | null;
}

export interface Payment {
  id: string;
  organizationId: string;
  clientId: string;
  paymentDate: string;
  amount: DecimalValue;
  currency: CurrencyCode;
  reference: string | null;
  notes: string | null;
}

export interface PsaListQuery {
  limit: number;
  offset: number;
  q?: string;
  id?: string;
  clientId?: string;
  contactId?: string;
  projectId?: string;
  profileId?: string;
  retainerId?: string;
  invoiceId?: string;
  status?: string;
  from?: string;
  to?: string;
}
