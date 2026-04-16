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

function parseExecution(value: unknown): AssistantDecisionExecution | { error: string } {
  if (!isRecord(value)) {
    return { error: "execution must be an object when should_execute=true." };
  }

  if (typeof value.tool !== "string" || !value.tool.trim()) {
    return { error: "execution.tool must be a non-empty string." };
  }

  if (value.tool !== "execute_calendar_operation") {
    return { error: "Only execute_calendar_operation is allowed in structured execution for now." };
  }

  if (!isRecord(value.payload)) {
    return { error: "execution.payload must be an object." };
  }

  const action = value.payload.action;
  if (action !== "create" && action !== "update" && action !== "delete") {
    return { error: "execute_calendar_operation payload.action must be create, update or delete." };
  }

  if (action === "create") {
    const summary = value.payload.summary;
    const start = value.payload.start;
    const end = value.payload.end;
    if (typeof summary !== "string" || !summary.trim() || typeof start !== "string" || !start.trim() || typeof end !== "string" || !end.trim()) {
      return { error: "Create operations require summary, start and end." };
    }
  }

  if ((action === "update" || action === "delete")) {
    const eventId = value.payload.event_id;
    if (typeof eventId !== "string" || !eventId.trim()) {
      return { error: `${action === "update" ? "Update" : "Delete"} operations require event_id.` };
    }
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
