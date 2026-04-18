export interface OperationalStateUpcomingCommitment {
  summary: string;
  start?: string;
  account?: string;
  location?: string;
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
  activeChannel?: string;
  preferredAlertChannel?: string;
  pendingApprovals?: number;
}
