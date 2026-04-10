import type { AgentActionMode, AgentDomain } from "./orchestration.js";

export type ResponseContractKind =
  | "analysis"
  | "execution"
  | "organization"
  | "briefing";

export interface ResponseQualityAssessment {
  passed: boolean;
  issues: string[];
}

export interface IntentAnalysisContract {
  objective: string;
  primaryDomain: AgentDomain;
  mentionedDomains: AgentDomain[];
  actionMode: AgentActionMode;
  confidence: number;
  compound: boolean;
  contextSignals: string[];
  reasons: string[];
  recommendedNextStep?: string;
}

export interface OrganizationResponseContract {
  objective: string;
  currentSituation: string[];
  priorities: string[];
  actionPlan: string[];
  recommendedNextStep?: string;
}
