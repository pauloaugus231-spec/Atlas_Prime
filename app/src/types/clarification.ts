export type ClarificationStatus =
  | "pending_answer"
  | "pending_confirmation"
  | "confirmed"
  | "cancelled"
  | "superseded";

export interface ClarificationInboxItemRecord {
  id: number;
  chatId: number;
  channel: string;
  originalPrompt: string;
  objectiveSummary: string;
  rationale: string;
  questionsJson: string;
  answerText: string | null;
  confirmationText: string | null;
  executionPrompt: string | null;
  status: ClarificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClarificationInboxItemInput {
  chatId: number;
  channel: string;
  originalPrompt: string;
  objectiveSummary: string;
  rationale: string;
  questionsJson: string;
}
