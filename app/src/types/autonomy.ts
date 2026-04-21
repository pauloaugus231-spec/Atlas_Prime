export type SourceTrust =
  | "operator"
  | "owned_account"
  | "trusted_contact"
  | "external_contact"
  | "web"
  | "attachment";

export type ObservationKind =
  | "calendar_conflict"
  | "overdue_task"
  | "pending_reply"
  | "stale_lead"
  | "commitment_detected"
  | "approval_waiting"
  | "goal_at_risk"
  | "memory_candidate";

export interface AutonomyObservation {
  id: string;
  fingerprint: string;
  kind: ObservationKind;
  sourceKind: "telegram" | "whatsapp" | "email" | "calendar" | "tasks" | "memory" | "web" | "system";
  sourceId?: string;
  sourceTrust: SourceTrust;
  title: string;
  summary: string;
  evidence: string[];
  observedAt: string;
  expiresAt?: string;
}

export interface AutonomyAssessment {
  id: string;
  observationId: string;
  importance: number;
  urgency: number;
  confidence: number;
  risk: "low" | "medium" | "high" | "critical";
  rationale: string;
}

export interface AutonomySuggestion {
  id: string;
  observationId: string;
  fingerprint: string;
  title: string;
  body: string;
  explanation: string;
  suggestedAction?: {
    capabilityName: string;
    arguments: unknown;
  };
  status: "queued" | "notified" | "approved" | "dismissed" | "snoozed" | "executed" | "failed";
  priority: number;
  requiresApproval: boolean;
  dueAt?: string;
  snoozedUntil?: string;
  lastNotifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomyAuditRecord {
  id: string;
  kind:
    | "autonomy_loop_run"
    | "observation_recorded"
    | "suggestion_upserted"
    | "suggestion_status_changed"
    | "suggestion_action_planned"
    | "suggestion_action_blocked"
    | "suggestion_action_approval_requested"
    | "suggestion_action_executed"
    | "suggestion_action_failed";
  observationId?: string;
  suggestionId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AutonomyFeedbackRecord {
  id: string;
  suggestionId: string;
  feedbackKind: "accepted" | "dismissed" | "snoozed" | "executed" | "ignored";
  note?: string;
  createdAt: string;
}

export interface AutonomyCollectorInput {
  now: string;
  context?: Record<string, unknown>;
}

export interface AutonomyCollector {
  name: string;
  collect(input: AutonomyCollectorInput): Promise<AutonomyObservation[]> | AutonomyObservation[];
}

export interface AutonomyRunInput {
  now?: string;
  context?: Record<string, unknown>;
}

export interface AutonomyRunResult {
  observations: AutonomyObservation[];
  assessments: AutonomyAssessment[];
  suggestions: AutonomySuggestion[];
}
