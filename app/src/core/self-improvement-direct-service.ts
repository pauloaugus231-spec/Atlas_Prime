import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";

interface SelfImprovementLike {
  renderBacklog(): string;
  renderRecentFailures(): string;
  recordFeedback(input: { channel: string; feedback: string }): { id: number; feedback: string };
}

export interface SelfImprovementDirectServiceDependencies {
  logger: Logger;
  selfImprovement: SelfImprovementLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

export interface SelfImprovementDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractFeedback(prompt: string): string | undefined {
  const match = prompt.match(/(?:feedback|registre feedback|anote feedback)\s*[:\-]?\s+([\s\S]+)/i);
  return match?.[1]?.trim();
}

export class SelfImprovementDirectService {
  constructor(private readonly deps: SelfImprovementDirectServiceDependencies) {}

  tryRun(input: SelfImprovementDirectInput): AgentRunResult | null {
    const normalized = normalize(input.userPrompt);
    if (normalized.includes("melhorias") || normalized.includes("backlog do atlas")) {
      return {
        requestId: input.requestId,
        reply: this.deps.selfImprovement.renderBacklog(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (normalized.includes("falhas recentes")) {
      return {
        requestId: input.requestId,
        reply: this.deps.selfImprovement.renderRecentFailures(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    if (normalized.includes("feedback")) {
      const feedback = extractFeedback(input.userPrompt);
      if (!feedback) {
        return null;
      }
      const saved = this.deps.selfImprovement.recordFeedback({
        channel: input.orchestration.route.primaryDomain,
        feedback,
      });
      return {
        requestId: input.requestId,
        reply: `Feedback registrado para o Atlas: ${saved.feedback}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    return null;
  }
}
