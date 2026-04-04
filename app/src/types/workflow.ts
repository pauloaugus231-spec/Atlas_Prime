import type { AgentDomain } from "./orchestration.js";

export type WorkflowStatus = "draft" | "active" | "paused" | "completed";
export type WorkflowStepStatus = "pending" | "in_progress" | "blocked" | "completed";
export type WorkflowArtifactType = "execution_brief" | "status_update" | "deliverable" | "note";

export interface WorkflowStepRecord {
  planId: number;
  stepNumber: number;
  title: string;
  ownerDomain: AgentDomain;
  taskType: string;
  objective: string;
  deliverable: string;
  successCriteria: string;
  dependsOn: number[];
  suggestedTools: string[];
  status: WorkflowStepStatus;
  notes: string | null;
}

export interface WorkflowPlanRecord {
  id: number;
  title: string;
  objective: string;
  executiveSummary: string;
  status: WorkflowStatus;
  primaryDomain: AgentDomain;
  secondaryDomains: AgentDomain[];
  deliverables: string[];
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStepRecord[];
}

export interface WorkflowArtifactRecord {
  id: number;
  planId: number;
  stepNumber: number | null;
  artifactType: WorkflowArtifactType;
  title: string;
  summary: string;
  content: string;
  filePath: string | null;
  createdAt: string;
}

export interface CreateWorkflowPlanStepInput {
  title: string;
  ownerDomain: AgentDomain;
  taskType: string;
  objective: string;
  deliverable: string;
  successCriteria: string;
  dependsOn?: number[];
  suggestedTools?: string[];
  status?: WorkflowStepStatus;
  notes?: string | null;
}

export interface CreateWorkflowPlanInput {
  title: string;
  objective: string;
  executiveSummary: string;
  status?: WorkflowStatus;
  primaryDomain: AgentDomain;
  secondaryDomains?: AgentDomain[];
  deliverables?: string[];
  nextAction?: string | null;
  steps: CreateWorkflowPlanStepInput[];
}

export interface UpdateWorkflowStepInput {
  planId: number;
  stepNumber: number;
  status?: WorkflowStepStatus;
  notes?: string | null;
}

export interface SaveWorkflowArtifactInput {
  planId: number;
  stepNumber?: number | null;
  artifactType: WorkflowArtifactType;
  title: string;
  summary: string;
  content: string;
  filePath?: string | null;
}
