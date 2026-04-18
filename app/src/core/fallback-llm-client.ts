import type { ConversationMessage, LlmChatResponse, LlmClient, LlmToolDefinition } from "../types/llm.js";
import type { Logger } from "../types/logger.js";

interface FallbackLlmClientOptions {
  primaryLabel: string;
  secondaryLabel: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasUsableAssistantResponse(response: LlmChatResponse): boolean {
  return Boolean(response.message.content.trim() || response.message.tool_calls?.length);
}

export class FallbackLlmClient implements LlmClient {
  constructor(
    private readonly primary: LlmClient,
    private readonly secondary: LlmClient,
    private readonly logger: Logger,
    private readonly options: FallbackLlmClientOptions,
  ) {}

  async listModels(): Promise<string[]> {
    const primaryResult = await this.primary.listModels().catch((error: unknown) => {
      this.logger.warn("Primary LLM model listing failed", {
        provider: this.options.primaryLabel,
        error: errorMessage(error),
      });
      return [];
    });
    const secondaryResult = await this.secondary.listModels().catch((error: unknown) => {
      this.logger.warn("Fallback LLM model listing failed", {
        provider: this.options.secondaryLabel,
        error: errorMessage(error),
      });
      return [];
    });

    return [...new Set([...primaryResult, ...secondaryResult])].sort((left, right) => left.localeCompare(right));
  }

  async chat(input: {
    messages: ConversationMessage[];
    tools?: LlmToolDefinition[];
  }): Promise<LlmChatResponse> {
    try {
      const response = await this.primary.chat(input);
      if (!hasUsableAssistantResponse(response)) {
        throw new Error("Primary LLM returned an empty assistant response.");
      }
      return response;
    } catch (error) {
      this.logger.warn("Primary LLM failed; falling back to secondary provider", {
        primary: this.options.primaryLabel,
        secondary: this.options.secondaryLabel,
        error: errorMessage(error),
      });
      return this.secondary.chat(input);
    }
  }
}
