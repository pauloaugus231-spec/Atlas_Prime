export interface MissionStep {
  title: string;
  status: "pending" | "in_progress" | "blocked" | "done";
}

export interface MissionArtifact {
  label: string;
  type: "document" | "message" | "link" | "note";
  reference: string;
}

export interface Mission {
  id: string;
  title: string;
  domain: "personal" | "business" | "dev" | "content" | "social" | "admin";
  outcome: string;
  status: "active" | "paused" | "blocked" | "done";
  priority: "low" | "medium" | "high" | "critical";
  owner: "operator" | "atlas-assisted";
  deadline?: string;
  context: string;
  successCriteria: string[];
  currentPlan: MissionStep[];
  artifacts: MissionArtifact[];
  openQuestions: string[];
  risks: string[];
  nextAction?: string;
  supportingCommitmentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMissionInput {
  title: string;
  domain?: Mission["domain"];
  outcome?: string;
  priority?: Mission["priority"];
  deadline?: string;
  context?: string;
  successCriteria?: string[];
  openQuestions?: string[];
  risks?: string[];
  nextAction?: string;
}
