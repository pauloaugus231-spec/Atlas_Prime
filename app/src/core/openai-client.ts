import type { AppConfig } from "../types/config.js";
import type { ConversationMessage, LlmChatResponse, LlmClient, LlmToolCall, LlmToolDefinition } from "../types/llm.js";
import type { Logger } from "../types/logger.js";

interface OpenAIModelListResponse {
  data?: Array<{
    id: string;
  }>;
}

interface OpenAIChatCompletionChoice {
  message?: {
    role?: "assistant";
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      type?: "function";
      function?: {
        name?: string;
        arguments?: string;
      };
    }>;
  };
  finish_reason?: string | null;
}

type OpenAIResponseToolCall = NonNullable<NonNullable<OpenAIChatCompletionChoice["message"]>["tool_calls"]>[number];

interface OpenAIChatCompletionResponse {
  model?: string;
  created?: number;
  choices?: OpenAIChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface OpenAIChatRequestMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatRequestMessage[];
  tools?: LlmToolDefinition[];
}

function stringifyArguments(argumentsValue: unknown): string {
  if (typeof argumentsValue === "string") {
    return argumentsValue;
  }
  return JSON.stringify(argumentsValue ?? {});
}

function normalizeToolCalls(toolCalls: OpenAIResponseToolCall[] | undefined): LlmToolCall[] {
  const normalized: LlmToolCall[] = [];
  for (const toolCall of toolCalls ?? []) {
      const name = toolCall.function?.name?.trim();
      if (!name) {
        continue;
      }

      let parsedArguments: unknown = {};
      const rawArguments = toolCall.function?.arguments ?? "{}";
      try {
        parsedArguments = JSON.parse(rawArguments);
      } catch {
        parsedArguments = rawArguments;
      }

      normalized.push({
        id: toolCall.id,
        type: "function" as const,
        function: {
          name,
          arguments: parsedArguments,
        },
      });
  }

  return normalized;
}

export class OpenAIClient implements LlmClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async listModels(): Promise<string[]> {
    this.requireApiKey();
    const data = await this.request<OpenAIModelListResponse>("/models", {
      method: "GET",
    });

    return (data.data ?? [])
      .map((model) => model.id)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
  }

  async chat(input: {
    messages: ConversationMessage[];
    tools?: LlmToolDefinition[];
  }): Promise<LlmChatResponse> {
    this.requireApiKey();

    const payload: OpenAIChatRequest = {
      model: this.config.llm.model,
      messages: input.messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.tool_calls?.length
          ? {
              tool_calls: message.tool_calls.map((toolCall, index) => ({
                id: toolCall.id?.trim() || `tool_call_${index + 1}`,
                type: "function" as const,
                function: {
                  name: toolCall.function.name,
                  arguments: stringifyArguments(toolCall.function.arguments),
                },
              })),
            }
          : {}),
        ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
      })),
      ...(input.tools?.length ? { tools: input.tools } : {}),
    };

    this.logger.debug("Sending request to OpenAI", {
      model: payload.model,
      messageCount: payload.messages.length,
      toolCount: input.tools?.length ?? 0,
    });

    const response = await this.request<OpenAIChatCompletionResponse>("/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const choice = response.choices?.[0];
    const toolCalls = normalizeToolCalls(choice?.message?.tool_calls);

    return {
      model: response.model ?? this.config.llm.model,
      created_at: response.created ? new Date(response.created * 1000).toISOString() : undefined,
      done: true,
      done_reason: choice?.finish_reason ?? undefined,
      prompt_eval_count: response.usage?.prompt_tokens,
      eval_count: response.usage?.completion_tokens,
      message: {
        role: "assistant",
        content: choice?.message?.content?.trim() ?? "",
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
    };
  }

  private requireApiKey(): string {
    const apiKey = this.config.llm.apiKey?.trim();
    if (!apiKey) {
      throw new Error("OpenAI API key is missing. Set OPENAI_API_KEY in .env.");
    }
    return apiKey;
  }

  private async request<T>(pathname: string, init: RequestInit): Promise<T> {
    const controller = AbortSignal.timeout(this.config.llm.timeoutMs);
    const response = await fetch(`${this.config.llm.baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.requireApiKey()}`,
        ...(init.headers ?? {}),
      },
      signal: controller,
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`OpenAI request failed (${response.status}): ${details || response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
