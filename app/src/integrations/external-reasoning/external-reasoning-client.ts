import { parseAssistantDecisionReply } from "../../core/assistant-decision.js";
import type { ExternalReasoningConfig } from "../../types/config.js";
import type {
  ExternalReasoningRequest,
  ExternalReasoningResponse,
} from "../../types/external-reasoning.js";
import type { Logger } from "../../types/logger.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class ExternalReasoningClient {
  constructor(
    private readonly config: ExternalReasoningConfig,
    private readonly logger: Logger,
  ) {}

  isEnabled(): boolean {
    return this.config.enabled && Boolean(this.config.baseUrl);
  }

  async reason(input: ExternalReasoningRequest): Promise<ExternalReasoningResponse> {
    if (!this.isEnabled() || !this.config.baseUrl) {
      throw new Error("External reasoning provider is disabled.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      const rawBody = await response.text();
      if (!response.ok) {
        throw new Error(`External reasoning request failed (${response.status}).`);
      }

      const parsed = this.normalizeResponse(rawBody);
      this.logger.info("External reasoning response accepted", {
        responseKind: parsed.kind,
      });
      return parsed;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("External reasoning request timed out.");
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeResponse(rawBody: string): ExternalReasoningResponse {
    const trimmed = rawBody.trim();
    if (!trimmed) {
      throw new Error("External reasoning returned an empty response.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        throw new Error("External reasoning returned invalid JSON.");
      }
      const parsedDecision = parseAssistantDecisionReply(trimmed);
      if (parsedDecision.kind === "invalid") {
        throw new Error(`External reasoning returned an invalid assistant_decision: ${parsedDecision.error}`);
      }
      return {
        kind: "text",
        content: trimmed,
      };
    }

    if (typeof parsedJson === "string") {
      const content = parsedJson.trim();
      if (!content) {
        throw new Error("External reasoning returned an empty string response.");
      }
      return {
        kind: "text",
        content,
      };
    }

    if (!isRecord(parsedJson)) {
      throw new Error("External reasoning response must be a string or assistant_decision object.");
    }

    const decisionPayload = JSON.stringify(parsedJson, null, 2);
    const parsedDecision = parseAssistantDecisionReply(decisionPayload);
    if (parsedDecision.kind === "valid") {
      return {
        kind: "assistant_decision",
        content: decisionPayload,
        decision: parsedDecision.decision,
      };
    }

    if (parsedDecision.kind === "invalid") {
      throw new Error(`External reasoning returned an invalid assistant_decision: ${parsedDecision.error}`);
    }

    throw new Error("External reasoning response must be a plain string or assistant_decision object.");
  }
}
