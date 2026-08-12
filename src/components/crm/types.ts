export interface CrmContact {
  id: string;
  affiliationId?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  isPrimary?: boolean;
  receivesInvoices?: boolean;
  role?: string | null;
  position?: string | null;
  status?: string | null;
  affiliations?: Array<{
    id: string;
    clientId: string;
    clientName: string;
    role?: string | null;
    isPrimary?: boolean;
  }>;
}

export interface CrmProject {
  id: string;
  name: string;
  status?: string | null;
  code?: string | null;
}

export interface CrmRetainer {
  id: string;
  clientId: string;
  clientName?: string;
  name: string;
  status?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  allowanceHours: number;
  loggedHours: number;
  billableHours: number;
  projectedHours?: number;
  hourlyRate?: number | null;
  value?: number | null;
  cadence?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  overagePolicy?: string | null;
  rolloverPolicy?: string | null;
  allowanceType?: string | null;
  allowanceValue?: number | null;
  autoRenew?: boolean;
  renewalDays?: number | null;
  invoiceTiming?: string | null;
  currency?: string | null;
}

export interface CrmActivity {
  id: string;
  type?: string | null;
  subject: string;
  body?: string | null;
  occurredAt: string;
  contactName?: string | null;
  createdByName?: string | null;
}

export interface CrmReceivable {
  id: string;
  reference?: string | null;
  status?: string | null;
  amount: number;
  dueDate?: string | null;
}

export interface CrmClient {
  id: string;
  name: string;
  status?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  ownerName?: string | null;
  ownerId?: string | null;
  parentClientId?: string | null;
  parentClientName?: string | null;
  primaryContactName?: string | null;
  activeProjects?: number;
  activeRetainers?: number;
  outstandingAmount?: number;
  updatedAt?: string | null;
  notes?: string | null;
}

export interface ClientsPageData {
  clients: CrmClient[];
  totalCount?: number;
  owners?: Array<{ id: string; name: string }>;
  accountOptions?: Array<{ id: string; name: string }>;
}

export interface ClientDetailData {
  client: CrmClient;
  contacts: CrmContact[];
  projects: CrmProject[];
  retainers: CrmRetainer[];
  activities: CrmActivity[];
  receivables: CrmReceivable[];
}

export interface RetainersPageData {
  retainers: CrmRetainer[];
  clients?: Array<Pick<CrmClient, "id" | "name">>;
  totalCount?: number;
}

export interface RetainerPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  allowanceHours: number;
  rolloverHours: number;
  loggedHours: number;
  billableHours: number;
  projectedHours?: number;
  forecastHours?: number | null;
  value?: number | null;
  status?: string | null;
  lockedAt?: string | null;
  invoicedAt?: string | null;
  externalId?: string | null;
}

export interface RetainerDetailData {
  retainer: CrmRetainer;
  periods: RetainerPeriod[];
}
