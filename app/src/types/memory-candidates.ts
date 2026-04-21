export interface MemoryCandidate {
  id: string;
  kind: "preference" | "routine" | "rule" | "goal" | "commitment" | "contact" | "project" | "style" | "constraint";
  statement: string;
  sourceKind: "operator" | "telegram" | "whatsapp" | "email" | "calendar" | "system";
  sourceId?: string;
  evidence: string[];
  confidence: number;
  sensitivity: "normal" | "personal" | "sensitive";
  status: "candidate" | "active" | "rejected" | "expired" | "superseded";
  reviewStatus: "needs_review" | "confirmed" | "auto_low_risk";
  snoozedUntil?: string;
  createdAt: string;
  lastSeenAt: string;
  confirmedAt?: string;
  expiresAt?: string;
}
