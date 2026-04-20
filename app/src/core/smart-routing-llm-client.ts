import type { LlmSmartRoutingConfig } from "../types/config.js";
import type { ConversationMessage, LlmChatResponse, LlmClient, LlmToolDefinition } from "../types/llm.js";
import type { Logger } from "../types/logger.js";

interface SmartRoutingTier {
  label: string;
  client: LlmClient;
}

interface SmartRoutingLlmClientOptions {
  tiers: SmartRoutingTier[];
  advancedIndex: number;
  routing: LlmSmartRoutingConfig;
}

const COMPLEXITY_HINTS = [
  "sim ou nao",
  "sim ou não",
  "consegue me responder",
  "me responde direto",
  "me responda direto",
  "vale a pena",
  "como podemos",
  "o que voce acha",
  "o que você acha",
  "compare",
  "comparar",
  "diagnost",
  "estrateg",
  "estratég",
  "planej",
  "roteiro",
  "workflow",
  "pesquise",
  "pesquisa",
  "recente",
  "atual",
  "rota",
  "distanc",
  "pedag",
  "combust",
  "gasto",
  "gastar",
  "custo",
  "quanto custa",
  "quanto vou gastar",
  "quanto sai",
  "viagem",
  "transporte",
  "maps",
  "print",
  "pdf",
  "anexo",
  "corrig",
  "conflito",
  "ambig",
  "prioridade",
  "alerta",
  "monitoramento",
  "capability",
  "gap",
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasUsableAssistantResponse(response: LlmChatResponse): boolean {
  return Boolean(response.message.content.trim() || response.message.tool_calls?.length);
}

function latestUserMessage(messages: ConversationMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && typeof message.content === "string") {
      return message.content.trim();
    }
  }
  return "";
}

function countNonEmptyLines(value: string): number {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).length;
}

function shouldUseAdvancedTier(
  input: {
    messages: ConversationMessage[];
    tools?: LlmToolDefinition[];
  },
  routing: LlmSmartRoutingConfig,
): boolean {
  const userText = latestUserMessage(input.messages);
  const normalized = normalize(userText);
  if (!normalized) {
    return false;
  }

  const promptChars = userText.length;
  const lineCount = countNonEmptyLines(userText);
  const toolCount = input.tools?.length ?? 0;
  const messageCount = input.messages.length;
  const hasComplexCue = COMPLEXITY_HINTS.some((token) => normalized.includes(token));

  if (promptChars >= routing.complexityPromptChars || lineCount >= 3) {
    return true;
  }

  if (messageCount >= 10 && hasComplexCue) {
    return true;
  }

  if (routing.useAdvancedForTools && toolCount > 0) {
    return (
      promptChars >= routing.toolComplexityPromptChars
      || hasComplexCue
      || lineCount >= 2
    );
  }

  return hasComplexCue;
}

export class SmartRoutingLlmClient implements LlmClient {
  constructor(
    private readonly logger: Logger,
    private readonly options: SmartRoutingLlmClientOptions,
  ) {}

  async listModels(): Promise<string[]> {
    const collected = await Promise.all(this.options.tiers.map(async (tier) => {
      try {
        return await tier.client.listModels();
      } catch (error) {
        this.logger.warn("LLM tier model listing failed", {
          provider: tier.label,
          error: errorMessage(error),
        });
        return [];
      }
    }));

    return [...new Set(collected.flat())].sort((left, right) => left.localeCompare(right));
  }

  async chat(input: {
    messages: ConversationMessage[];
    tools?: LlmToolDefinition[];
  }): Promise<LlmChatResponse> {
    const wantsAdvanced = shouldUseAdvancedTier(input, this.options.routing);
    const startIndex = wantsAdvanced ? this.options.advancedIndex : 0;
    const tried: string[] = [];

    for (let index = startIndex; index < this.options.tiers.length; index += 1) {
      const tier = this.options.tiers[index];
      tried.push(tier.label);
      try {
        this.logger.info("Using routed LLM tier", {
          tier: tier.label,
          requestedAdvanced: wantsAdvanced,
          startIndex,
          toolCount: input.tools?.length ?? 0,
        });
        const response = await tier.client.chat(input);
        if (!hasUsableAssistantResponse(response)) {
          throw new Error("LLM tier returned an empty assistant response.");
        }
        return response;
      } catch (error) {
        this.logger.warn("LLM tier failed; trying next tier", {
          tier: tier.label,
          error: errorMessage(error),
        });
      }
    }

    throw new Error(`All routed LLM tiers failed: ${tried.join(" -> ")}`);
  }
}
