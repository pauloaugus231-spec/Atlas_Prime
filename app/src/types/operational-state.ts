export interface OperationalStateUpcomingCommitment {
  summary: string;
  start?: string;
  account?: string;
  location?: string;
}

export type OperationalStateSignalSource =
  | "calendar"
  | "tasks"
  | "mode"
  | "focus"
  | "pending_alert"
  | "monitored_whatsapp"
  | "context";

export type OperationalStateSignalKind =
  | "possible_event"
  | "possible_task"
  | "reply_needed"
  | "deadline"
  | "attention"
  | "focus_hint"
  | "other";

export interface OperationalStateSignal {
  key: string;
  source: OperationalStateSignalSource;
  kind: OperationalStateSignalKind;
  summary: string;
  priority: "low" | "medium" | "high";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OperationalStateBriefing {
  lastGeneratedAt?: string;
  nextAction?: string;
  overloadLevel?: "leve" | "moderado" | "pesado";
}

export interface OperationalState {
  mode: "normal" | "field";
  modeReason?: string;
  focus: string[];
  weeklyPriorities: string[];
  pendingAlerts: string[];
  criticalTasks: string[];
  upcomingCommitments: OperationalStateUpcomingCommitment[];
  primaryRisk?: string;
  briefing: OperationalStateBriefing;
  recentContext: string[];
  signals: OperationalStateSignal[];
  activeChannel?: string;
  preferredAlertChannel?: string;
  pendingApprovals: number;
  updatedAt: string;
}

export interface UpdateOperationalStateInput {
  mode?: OperationalState["mode"];
  modeReason?: string;
  focus?: string[];
  weeklyPriorities?: string[];
  pendingAlerts?: string[];
  criticalTasks?: string[];
  upcomingCommitments?: OperationalStateUpcomingCommitment[];
  primaryRisk?: string;
  briefing?: OperationalStateBriefing;
  recentContext?: string[];
  signals?: OperationalStateSignal[];
  activeChannel?: string;
  preferredAlertChannel?: string;
  pendingApprovals?: number;
}
