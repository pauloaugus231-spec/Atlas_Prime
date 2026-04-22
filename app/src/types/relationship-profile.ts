export type RelationshipKind = "lead" | "client" | "partner" | "family" | "institution" | "unknown";
export type RelationshipTrustLevel = "unknown" | "known" | "trusted" | "sensitive";

export interface RelationshipChannel {
  kind: "email" | "whatsapp" | "telegram" | "calendar" | "manual";
  value: string;
  account?: string;
}

export interface RelationshipProfile {
  id: string;
  displayName: string;
  kind: RelationshipKind;
  channels: RelationshipChannel[];
  businessContext?: {
    stage?: string;
    estimatedValue?: number;
    nextCommercialAction?: string;
  };
  lastInteractionAt?: string;
  nextFollowUpAt?: string;
  openCommitments: string[];
  notes: string[];
  trustLevel: RelationshipTrustLevel;
  createdAt: string;
  updatedAt: string;
}
