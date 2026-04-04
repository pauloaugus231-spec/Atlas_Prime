export type AgentDomain =
  | "orchestrator"
  | "assistente_social"
  | "secretario_operacional"
  | "social_media"
  | "dev_full_stack"
  | "analista_negocios_growth";

export type AgentActionMode =
  | "analyze"
  | "plan"
  | "execute"
  | "communicate"
  | "schedule"
  | "monitor";

export type AgentRiskLevel = "low" | "medium" | "high" | "critical";

export type AgentAutonomyLevel =
  | "observe_only"
  | "draft_with_confirmation"
  | "execute_with_confirmation"
  | "autonomous_low_risk";

export interface DomainRoute {
  primaryDomain: AgentDomain;
  secondaryDomains: AgentDomain[];
  confidence: number;
  actionMode: AgentActionMode;
  reasons: string[];
}

export interface DomainPolicyCapabilities {
  canReadSensitiveChannels: boolean;
  canDraftExternalReplies: boolean;
  canSendExternalReplies: boolean;
  canWriteWorkspace: boolean;
  canPersistMemory: boolean;
  canRunProjectTools: boolean;
  canModifyCalendar: boolean;
  canPublishContent: boolean;
}

export interface DomainPolicy {
  riskLevel: AgentRiskLevel;
  autonomyLevel: AgentAutonomyLevel;
  guardrails: string[];
  requiresApprovalFor: string[];
  capabilities: DomainPolicyCapabilities;
}

export interface OrchestrationContext {
  route: DomainRoute;
  policy: DomainPolicy;
}
