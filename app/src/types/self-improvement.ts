export interface FailedRequestRecord {
  id: number;
  signature: string;
  channel: string;
  prompt: string;
  errorMessage: string;
  errorKind: string;
  recurrence: number;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
}

export interface ProductFeedbackRecord {
  id: number;
  channel: string;
  feedback: string;
  createdAt: string;
}

export interface ImprovementBacklogItem {
  id: string;
  kind: "product_gap" | "failed_request" | "feedback";
  title: string;
  detail: string;
  priority: "low" | "medium" | "high";
  sourceRef?: string;
  status: "open" | "reviewed" | "implemented" | "dismissed";
  createdAt: string;
  updatedAt: string;
}
