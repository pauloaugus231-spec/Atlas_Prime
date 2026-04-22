import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";

interface ResearchDeskLike {
  researchAndSave(input: { topic: string; question?: string }): Promise<unknown>;
  renderSaved(topic?: string): string;
}

interface GraphQueryLike {
  explain(query: string): string;
}

export interface ResearchKnowledgeDirectServiceDependencies {
  logger: Logger;
  researchDesk: ResearchDeskLike;
  graphQuery: GraphQueryLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

export interface ResearchKnowledgeDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

function includesAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function extractTopic(prompt: string): string | undefined {
  const quoted = prompt.match(/["“](.+?)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }
  const match = prompt.match(/(?:sobre|pesquisa(?:r)?|dossie|dossi[eê])\s+(.+?)(?=(?:[?.!,;:]|$))/i);
  return match?.[1]?.trim();
}

export class ResearchKnowledgeDirectService {
  constructor(private readonly deps: ResearchKnowledgeDirectServiceDependencies) {}

  async tryRunResearch(input: ResearchKnowledgeDirectInput): Promise<AgentRunResult | null> {
    const normalized = normalizeEmailAnalysisText(input.userPrompt);
    if (!includesAny(normalized, ["pesquise e salve", "salve uma pesquisa", "dossie", "dossiê", "o que voce pesquisou", "o que você pesquisou"])) {
      return null;
    }
    const topic = extractTopic(input.userPrompt);
    if (!topic) {
      return null;
    }
    if (includesAny(normalized, ["o que voce pesquisou", "o que você pesquisou"])) {
      return {
        requestId: input.requestId,
        reply: this.deps.researchDesk.renderSaved(topic),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }
    await this.deps.researchDesk.researchAndSave({ topic, question: topic });
    return {
      requestId: input.requestId,
      reply: this.deps.researchDesk.renderSaved(topic),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }

  tryRunKnowledge(input: ResearchKnowledgeDirectInput): AgentRunResult | null {
    const normalized = normalizeEmailAnalysisText(input.userPrompt);
    if (!includesAny(normalized, ["o que voce sabe sobre", "o que você sabe sobre", "conhecimento sobre", "grafo sobre"])) {
      return null;
    }
    const topic = extractTopic(input.userPrompt);
    if (!topic) {
      return null;
    }
    return {
      requestId: input.requestId,
      reply: this.deps.graphQuery.explain(topic),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [],
    };
  }
}
