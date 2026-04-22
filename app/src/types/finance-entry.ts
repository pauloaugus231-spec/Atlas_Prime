export type FinanceEntryKind = "income" | "expense" | "bill";
export type FinanceEntryStatus = "planned" | "due" | "paid" | "overdue";
export type FinanceEntrySourceKind = "manual" | "email" | "document" | "message" | "system";

export interface FinanceEntry {
  id: number;
  title: string;
  amount: number;
  kind: FinanceEntryKind;
  status: FinanceEntryStatus;
  category?: string;
  dueAt?: string;
  paidAt?: string;
  sourceKind: FinanceEntrySourceKind;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFinanceEntryInput {
  title: string;
  amount: number;
  kind?: FinanceEntryKind;
  status?: FinanceEntryStatus;
  category?: string;
  dueAt?: string;
  paidAt?: string;
  sourceKind?: FinanceEntrySourceKind;
  notes?: string;
}
