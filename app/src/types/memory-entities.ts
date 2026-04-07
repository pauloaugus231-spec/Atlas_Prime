export type MemoryEntityKind =
  | "contact"
  | "task"
  | "approval"
  | "workflow_run"
  | "project"
  | "lead"
  | "content_item"
  | "research_session";

export interface MemoryEntityRecord {
  id: string;
  kind: MemoryEntityKind;
  title: string;
  tags: string[];
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
