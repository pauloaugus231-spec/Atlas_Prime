export type BrowserTaskMode = "read" | "draft" | "write";
export type BrowserTaskStatus = "queued" | "approved" | "dismissed" | "done";

export interface BrowserTaskRecord {
  id: string;
  url: string;
  intent: string;
  mode: BrowserTaskMode;
  status: BrowserTaskStatus;
  requiresApproval: boolean;
  sourceChannel: string;
  createdAt: string;
  updatedAt: string;
}
