import type { AgentDomain } from "./orchestration.js";

export type PlanStatus =
  | "draft"
  | "active"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped";

export interface PlanStep {
  id: string;
  title: string;
  capability: string;
  domain: AgentDomain;
  status: StepStatus;
  dependsOn: string[];
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  artifactRefs?: string[];
  approvalId?: string | null;
  error?: string | null;
}

export interface ExecutionPlan {
  id: string;
  objective: string;
  primaryDomain: AgentDomain;
  secondaryDomains: AgentDomain[];
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}
