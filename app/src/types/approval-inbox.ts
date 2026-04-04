export type ApprovalItemStatus =
  | "pending"
  | "approved"
  | "discarded"
  | "executed"
  | "failed"
  | "superseded";

export interface ApprovalInboxItemRecord {
  id: number;
  chatId: number;
  channel: string;
  actionKind: string;
  subject: string;
  draftPayload: string;
  status: ApprovalItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApprovalInboxItemInput {
  chatId: number;
  channel: string;
  actionKind: string;
  subject: string;
  draftPayload: string;
}
