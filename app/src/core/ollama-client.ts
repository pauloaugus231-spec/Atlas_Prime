import type { AppConfig } from "../types/config.js";
import type { ConversationMessage, LlmChatResponse, LlmClient, LlmToolDefinition } from "../types/llm.js";
import type { Logger } from "../types/logger.js";

interface OllamaTagResponse {
  models?: Array<{
    name: string;
  }>;
}

interface ChatRequest {
  model: string;
  stream: false;
  messages: ConversationMessage[];
  tools?: LlmToolDefinition[];
}

export class OllamaClient implements LlmClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async listModels(): Promise<string[]> {
    const data = await this.request<OllamaTagResponse>("/api/tags", {
      method: "GET",
    });

    return (data.models ?? []).map((model) => model.name).sort((left, right) => left.localeCompare(right));
  }

  async chat(input: {
    messages: ConversationMessage[];
    tools?: LlmToolDefinition[];
  }): Promise<LlmChatResponse> {
    const payload: ChatRequest = {
      model: this.config.llm.model,
      stream: false,
      messages: input.messages,
      ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
    };

    this.logger.debug("Sending request to Ollama", {
      model: payload.model,
      messageCount: payload.messages.length,
      toolCount: input.tools?.length ?? 0,
    });

    return this.request<LlmChatResponse>("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  private async request<T>(pathname: string, init: RequestInit): Promise<T> {
    const controller = AbortSignal.timeout(this.config.llm.timeoutMs);
    const response = await fetch(`${this.config.llm.baseUrl}${pathname}`, {
      ...init,
      signal: controller,
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status}): ${details || response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
