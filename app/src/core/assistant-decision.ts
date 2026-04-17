import type {
  AssistantDecision,
  AssistantDecisionExecution,
  AssistantDecisionIntent,
  AssistantDecisionParseResult,
} from "../types/assistant-decision.js";

const ALLOWED_INTENTS = new Set<AssistantDecisionIntent>([
  "calendar_create",
  "calendar_update",
  "calendar_delete",
  "task_create",
  "task_update",
  "task_delete",
  "planning",
  "other",
]);

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateCalendarPayload(payload: Record<string, unknown>): string | undefined {
  const action = payload.action;
  if (action !== "create" && action !== "update" && action !== "delete") {
    return "execute_calendar_operation payload.action must be create, update or delete.";
  }

  if (action === "create") {
    if (!hasNonEmptyString(payload.summary) || !hasNonEmptyString(payload.start) || !hasNonEmptyString(payload.end)) {
      return "Create operations require summary, start and end.";
    }
    return undefined;
  }

  if (!hasNonEmptyString(payload.event_id)) {
    return `${action === "update" ? "Update" : "Delete"} operations require event_id.`;
  }

  return undefined;
}

function validateTaskPayload(payload: Record<string, unknown>): string | undefined {
  const action = payload.action;
  if (action !== "create" && action !== "update" && action !== "delete") {
    return "execute_task_operation payload.action must be create, update or delete.";
  }

  if (action === "create") {
    if (!hasNonEmptyString(payload.title)) {
      return "Task create operations require title.";
    }
    return undefined;
  }

  if (!hasNonEmptyString(payload.task_id) && !hasNonEmptyString(payload.target_title)) {
    return `${action === "update" ? "Task update" : "Task delete"} operations require task_id or target_title.`;
  }

  if (action === "update") {
    const hasUsefulChange = ["title", "notes", "due", "status"].some((field) =>
      Object.prototype.hasOwnProperty.call(payload, field)
    );
    if (!hasUsefulChange) {
      return "Task update operations require at least one field to change.";
    }
  }

  return undefined;
}

function parseExecution(value: unknown): AssistantDecisionExecution | { error: string } {
  if (!isRecord(value)) {
    return { error: "execution must be an object when should_execute=true." };
  }

  if (typeof value.tool !== "string" || !value.tool.trim()) {
    return { error: "execution.tool must be a non-empty string." };
  }

  if (value.tool !== "execute_calendar_operation" && value.tool !== "execute_task_operation") {
    return {
      error: "Only execute_calendar_operation and execute_task_operation are allowed in structured execution for now.",
    };
  }

  if (!isRecord(value.payload)) {
    return { error: "execution.payload must be an object." };
  }

  const validationError = value.tool === "execute_calendar_operation"
    ? validateCalendarPayload(value.payload)
    : validateTaskPayload(value.payload);
  if (validationError) {
    return { error: validationError };
  }

  return {
    tool: value.tool.trim(),
    payload: value.payload,
  };
}

export function parseAssistantDecisionReply(reply: string): AssistantDecisionParseResult {
  const normalized = stripCodeFences(reply);
  const hintsStructuredDecision = /assistant_decision/i.test(normalized);
  if (!normalized.startsWith("{")) {
    return hintsStructuredDecision
      ? { kind: "invalid", error: "Structured decision must be a single JSON object." }
      : { kind: "absent" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return hintsStructuredDecision
      ? { kind: "invalid", error: "Structured decision is not valid JSON." }
      : { kind: "absent" };
  }

  if (!isRecord(parsed)) {
    return hintsStructuredDecision
      ? { kind: "invalid", error: "Structured decision root must be an object." }
      : { kind: "absent" };
  }

  if (parsed.type !== "assistant_decision") {
    return { kind: "absent" };
  }

  if (typeof parsed.assistant_reply !== "string" || !parsed.assistant_reply.trim()) {
    return { kind: "invalid", error: "assistant_reply must be a non-empty string." };
  }

  if (typeof parsed.should_execute !== "boolean") {
    return { kind: "invalid", error: "should_execute must be a boolean." };
  }

  if (typeof parsed.intent !== "string" || !ALLOWED_INTENTS.has(parsed.intent as AssistantDecisionIntent)) {
    return { kind: "invalid", error: "intent must be one of the supported assistant_decision values." };
  }

  if (!parsed.should_execute) {
    return {
      kind: "valid",
      decision: {
        type: "assistant_decision",
        intent: parsed.intent as AssistantDecisionIntent,
        should_execute: false,
        assistant_reply: parsed.assistant_reply.trim(),
      },
    };
  }

  const execution = parseExecution(parsed.execution);
  if ("error" in execution) {
    return { kind: "invalid", error: execution.error };
  }

  const decision: AssistantDecision = {
    type: "assistant_decision",
    intent: parsed.intent as AssistantDecisionIntent,
    should_execute: true,
    assistant_reply: parsed.assistant_reply.trim(),
    execution,
  };

  return {
    kind: "valid",
    decision,
  };
}
