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

export interface SupportQueueContractItem {
  label: string;
  channel: "email" | "whatsapp" | "approval";
  detail: string;
}

export interface SupportQueueContract {
  objective: string;
  currentSituation: string[];
  channelSummary: string[];
  criticalCases: SupportQueueContractItem[];
  pendingReplies: SupportQueueContractItem[];
  recurringThemes: string[];
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
  groupSummary?: string[];
  recommendedNextStep?: string;
}

export interface FollowUpReviewContractItem {
  label: string;
  status: string;
  dueLabel: string;
}

export interface FollowUpReviewContract {
  scopeLabel: string;
  currentSituation: string[];
  overdueItems: FollowUpReviewContractItem[];
  todayItems: FollowUpReviewContractItem[];
  unscheduledItems: FollowUpReviewContractItem[];
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

export interface CalendarConflictReviewContractItem {
  kind: "overlap" | "duplicate" | "inconsistent_name";
  dayLabel: string;
  summary: string;
  recommendation: string;
}

export interface CalendarConflictReviewContract {
  scopeLabel: string;
  totalEvents: number;
  overlapCount: number;
  duplicateCount: number;
  namingCount: number;
  items: CalendarConflictReviewContractItem[];
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

export interface CommitmentPrepContract {
  title: string;
  startLabel: string;
  account: string;
  owner: string;
  context: string;
  location?: string;
  weatherTip?: string;
  checklist: string[];
  alerts: string[];
  recommendedNextStep?: string;
}
