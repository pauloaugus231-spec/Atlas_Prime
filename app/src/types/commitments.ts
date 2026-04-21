import type { SourceTrust } from "./autonomy.js";

export interface CommitmentCandidate {
  id: string;
  sourceKind: "telegram" | "whatsapp" | "email" | "calendar";
  sourceId?: string;
  sourceTrust: SourceTrust;
  counterparty?: string;
  statement: string;
  normalizedAction: string;
  dueAt?: string;
  confidence: number;
  evidence: string[];
  status: "candidate" | "confirmed" | "dismissed" | "snoozed" | "converted_to_task" | "done";
  snoozedUntil?: string;
  createdAt: string;
  updatedAt: string;
}
