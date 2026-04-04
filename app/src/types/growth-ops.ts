export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
  "dormant",
] as const;

export const REVENUE_ENTRY_KINDS = [
  "recurring",
  "one_off",
] as const;

export const REVENUE_ENTRY_STATUSES = [
  "projected",
  "won",
  "received",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type RevenueEntryKind = (typeof REVENUE_ENTRY_KINDS)[number];
export type RevenueEntryStatus = (typeof REVENUE_ENTRY_STATUSES)[number];

export interface LeadRecord {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: LeadStatus;
  domain: string | null;
  estimatedMonthlyValue: number | null;
  estimatedOneOffValue: number | null;
  notes: string | null;
  nextFollowUpAt: string | null;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLeadInput {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: LeadStatus;
  domain?: string | null;
  estimatedMonthlyValue?: number | null;
  estimatedOneOffValue?: number | null;
  notes?: string | null;
  nextFollowUpAt?: string | null;
  lastContactAt?: string | null;
}

export interface UpdateLeadInput {
  id: number;
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: LeadStatus;
  domain?: string | null;
  estimatedMonthlyValue?: number | null;
  estimatedOneOffValue?: number | null;
  notes?: string | null;
  nextFollowUpAt?: string | null;
  lastContactAt?: string | null;
}

export interface ListLeadsFilters {
  status?: LeadStatus;
  domain?: string;
  search?: string;
  limit?: number;
}

export interface RevenueEntryRecord {
  id: number;
  title: string;
  amount: number;
  kind: RevenueEntryKind;
  status: RevenueEntryStatus;
  channel: string | null;
  referenceMonth: string;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRevenueEntryInput {
  title: string;
  amount: number;
  kind?: RevenueEntryKind;
  status?: RevenueEntryStatus;
  channel?: string | null;
  referenceMonth: string;
  receivedAt?: string | null;
  notes?: string | null;
}

export interface MonthlyRevenueScoreboard {
  referenceMonth: string;
  totalProjected: number;
  totalWon: number;
  totalReceived: number;
  recurringProjected: number;
  recurringReceived: number;
  oneOffReceived: number;
  pipelineOpenValue: number;
  leadsByStatus: Array<{ status: LeadStatus; total: number }>;
  upcomingFollowUps: LeadRecord[];
}
