export type WorkflowRuntimeEventType =
  | "workflow_started"
  | "step_started"
  | "step_waiting_approval"
  | "step_completed"
  | "step_failed"
  | "step_blocked"
  | "step_resumed"
  | "workflow_completed"
  | "workflow_failed";

export interface WorkflowRuntimeEventRecord {
  id: number;
  planId: number;
  stepNumber: number | null;
  eventType: WorkflowRuntimeEventType;
  message: string;
  createdAt: string;
}
