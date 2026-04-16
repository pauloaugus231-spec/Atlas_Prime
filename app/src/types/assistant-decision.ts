export type AssistantDecisionIntent =
  | "calendar_create"
  | "calendar_update"
  | "calendar_delete"
  | "planning"
  | "other";

export interface AssistantDecisionExecution {
  tool: string;
  payload: Record<string, unknown>;
}

export interface AssistantDecision {
  type: "assistant_decision";
  intent: AssistantDecisionIntent;
  should_execute: boolean;
  assistant_reply: string;
  execution?: AssistantDecisionExecution;
}

export type AssistantDecisionParseResult =
  | { kind: "absent" }
  | { kind: "invalid"; error: string }
  | { kind: "valid"; decision: AssistantDecision };
