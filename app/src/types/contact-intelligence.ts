export type ContactRelationship =
  | "partner"
  | "family"
  | "friend"
  | "client"
  | "lead"
  | "colleague"
  | "social_case"
  | "vendor"
  | "spam"
  | "unknown";

export type ContactPersona =
  | "pessoal_afetivo"
  | "profissional_comercial"
  | "profissional_tecnico"
  | "social_humanizado"
  | "operacional_neutro";

export type ContactPriority = "alta" | "media" | "baixa";

export interface ContactProfileRecord {
  id: number;
  channel: string;
  identifier: string;
  displayName: string | null;
  relationship: ContactRelationship;
  persona: ContactPersona;
  priority: ContactPriority;
  company: string | null;
  preferredTone: string | null;
  notes: string | null;
  tags: string[];
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertContactProfileInput {
  channel: string;
  identifier: string;
  displayName?: string | null;
  relationship: ContactRelationship;
  persona: ContactPersona;
  priority?: ContactPriority;
  company?: string | null;
  preferredTone?: string | null;
  notes?: string | null;
  tags?: string[];
  source?: string | null;
}

export interface CommunicationClassification {
  channel: string;
  identifier: string | null;
  displayName: string | null;
  relationship: ContactRelationship;
  persona: ContactPersona;
  priority: ContactPriority;
  actionPolicy: "read_only" | "draft_first" | "manual_review" | "ignore";
  confidence: number;
  reason: string;
  matchedProfileId?: number;
}
