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

export interface ApprovalReviewContractItem {
  id?: number;
  subject: string;
  actionKind: string;
  createdAt?: string | null;
}

export interface ApprovalReviewContract {
  scopeLabel: string;
  items: ApprovalReviewContractItem[];
  recommendedNextStep?: string;
}

export interface InboxTriageContractItem {
  uid: string;
  subject: string;
  from: string[];
  relationship: string;
  priority: "alta" | "media" | "baixa";
  category: string;
  action: string;
}

export interface InboxTriageContract {
  scopeLabel: string;
  unreadOnly: boolean;
  limit: number;
  items: InboxTriageContractItem[];
  recommendedNextStep?: string;
}

export interface ScheduleLookupContractItem {
  account: string;
  summary: string;
  start?: string | null;
  location?: string;
}

export interface ScheduleLookupContract {
  targetLabel: string;
  topicLabel?: string;
  events: ScheduleLookupContractItem[];
  emailFallbackCount?: number;
  recommendedNextStep?: string;
}

export interface TaskReviewContractItem {
  title: string;
  taskListTitle: string;
  account: string;
  status: string;
  dueLabel: string;
}

export interface TaskReviewContract {
  scopeLabel: string;
  items: TaskReviewContractItem[];
  recommendedNextStep?: string;
}

export interface MessageHistoryContractItem {
  when: string;
  who: string;
  direction: string;
  text: string;
}

export interface MessageHistoryContract {
  scopeLabel: string;
  items: MessageHistoryContractItem[];
  recommendedNextStep?: string;
}
