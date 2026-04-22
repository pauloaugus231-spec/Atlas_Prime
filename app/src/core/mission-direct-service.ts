import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";

interface MissionServiceLike {
  create(input: { title: string; domain?: "personal" | "business" | "dev" | "content" | "social" | "admin"; priority?: "low" | "medium" | "high" | "critical"; deadline?: string; nextAction?: string; context?: string; risks?: string[]; }): unknown;
  renderStatus(query?: string): string;
  renderNextAction(query: string): string;
  renderRisks(query: string): string;
}

interface MissionReviewLike {
  renderReview(): string;
}

export interface MissionDirectServiceDependencies {
  logger: Logger;
  missions: MissionServiceLike;
  missionReview: MissionReviewLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

export interface MissionDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

function includesAny(value: string, tokens: string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function extractMissionTitle(prompt: string): string | undefined {
  const quoted = prompt.match(/["“](.+?)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }
  const match = prompt.match(/miss[aã]o\s+(?:de\s+|do\s+|da\s+|)?(.+?)(?=(?:\s+com\s+|\s+para\s+|[?.!,;:]|$))/i);
  return match?.[1]?.trim();
}

export class MissionDirectService {
  constructor(private readonly deps: MissionDirectServiceDependencies) {}

  tryRun(input: MissionDirectInput): AgentRunResult | null {
    const normalized = normalizeEmailAnalysisText(input.userPrompt);

    if (includesAny(normalized, ["crie missao", "crie missão", "nova missao", "nova missão"])) {
      const title = extractMissionTitle(input.userPrompt);
      if (!title) {
        return null;
      }
      this.deps.missions.create({ title, nextAction: `definir primeiro passo de ${title}` });
      return {
        requestId: input.requestId,
        reply: `Missão criada: ${title}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["status das missoes", "status das missões", "minhas missoes", "minhas missões", "revisao de missoes", "revisão de missões"])) {
      return {
        requestId: input.requestId,
        reply: this.deps.missionReview.renderReview(),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["status da missao", "status da missão"])) {
      const title = extractMissionTitle(input.userPrompt);
      return {
        requestId: input.requestId,
        reply: this.deps.missions.renderStatus(title),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["proxima acao da missao", "próxima ação da missão", "missao proxima acao", "missão próxima ação"])) {
      const title = extractMissionTitle(input.userPrompt);
      if (!title) return null;
      return {
        requestId: input.requestId,
        reply: this.deps.missions.renderNextAction(title),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    if (includesAny(normalized, ["riscos da missao", "riscos da missão"])) {
      const title = extractMissionTitle(input.userPrompt);
      if (!title) return null;
      return {
        requestId: input.requestId,
        reply: this.deps.missions.renderRisks(title),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    return null;
  }
}
