import { randomUUID } from "node:crypto";
import type { LlmClient, LlmToolCall, ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { ContextBundle } from "./context-assembler.js";

export interface ToolExecutionTrace {
  toolName: string;
  resultPreview: string;
}

export interface SynthesisResult {
  requestId: string;
  completion:
    | "assistant_reply"
    | "forced_final_synthesis";
  forcedReason?: "repeated-tool-call" | "tool-budget-reached";
  rawReply: string;
  messages: ConversationMessage[];
  toolExecutions: ToolExecutionTrace[];
  iterations: number;
}

export interface ExecuteSynthesizedToolInput {
  requestId: string;
  toolCallId: string;
  toolName: string;
  rawArguments: unknown;
  context: ContextBundle;
  requestLogger: Logger;
}

export interface ResponseSynthesizerDependencies {
  executeTool(input: ExecuteSynthesizedToolInput): Promise<{
    content: string;
    rawResult?: unknown;
  }>;
}

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

function normalizeSyntheticArguments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSyntheticArguments(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const metadataKeys = ["type", "description", "title", "default", "enum", "value"];
  const isSchemaWrappedValue =
    "value" in record &&
    keys.length > 1 &&
    keys.every((key) => metadataKeys.includes(key));

  if (isSchemaWrappedValue) {
    return normalizeSyntheticArguments(record.value);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, normalizeSyntheticArguments(item)]),
  );
}

function extractSyntheticToolCalls(
  content: string,
  context: ContextBundle,
): LlmToolCall[] {
  const normalized = stripCodeFences(content);
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const candidates: Array<{ name?: unknown; arguments?: unknown }> = [];

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          candidates.push({
            name: record.name ?? record.tool ?? record.tool_name,
            arguments: record.arguments ?? record.args ?? {},
          });
        }
      }
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const calls = Array.isArray(record.tool_calls)
        ? record.tool_calls
        : Array.isArray(record.calls)
          ? record.calls
          : undefined;
      if (calls) {
        for (const item of calls) {
          if (item && typeof item === "object") {
            const candidate = item as Record<string, unknown>;
            candidates.push({
              name: candidate.name ?? candidate.tool ?? candidate.tool_name,
              arguments: candidate.arguments ?? candidate.args ?? {},
            });
          }
        }
      } else if (record.tool || record.name || record.tool_name) {
        candidates.push({
          name: record.name ?? record.tool ?? record.tool_name,
          arguments: record.arguments ?? record.args ?? {},
        });
      }
    }

    if (!candidates.length) {
      return [];
    }

    const availableTools = new Set(context.tools.map((tool) => tool.function.name));
    return candidates.flatMap((candidate) => {
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!name || !availableTools.has(name)) {
        return [];
      }
      return [{
        type: "function" as const,
        function: {
          name,
          arguments: normalizeSyntheticArguments(candidate.arguments),
        },
      }];
    });
  } catch {
    return [];
  }
}

function buildFallbackReply(toolExecutions: ToolExecutionTrace[]): string {
  if (toolExecutions.length === 0) {
    return "O agente não conseguiu finalizar a resposta nesta tentativa.";
  }

  const lastExecution = toolExecutions[toolExecutions.length - 1];
  return [
    "O agente executou a solicitação, mas o modelo não consolidou a resposta final.",
    `Última ferramenta: ${lastExecution.toolName}`,
    `Prévia do resultado:\n${lastExecution.resultPreview}`,
  ].join("\n\n");
}

export class ResponseSynthesizer {
  constructor(
    private readonly client: LlmClient,
    private readonly logger: Logger,
    private readonly deps: ResponseSynthesizerDependencies,
  ) {}

  async synthesize(
    context: ContextBundle,
    input: {
      requestLogger: Logger;
    },
  ): Promise<SynthesisResult> {
    const messages: ConversationMessage[] = [...context.messages];
    const toolExecutions: ToolExecutionTrace[] = [];
    const seenToolCalls = new Set<string>();

    for (let iteration = 0; iteration < context.maxToolIterations; iteration += 1) {
      input.requestLogger.info("Running response synthesizer iteration", {
        iteration,
        toolsAvailable: context.tools.length,
      });

      const response = await this.client.chat({
        messages,
        tools: context.tools,
      });

      const responseToolCalls =
        response.message.tool_calls?.length && response.message.tool_calls.length > 0
          ? response.message.tool_calls
          : extractSyntheticToolCalls(response.message.content ?? "", context);

      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content: response.message.content ?? "",
        ...(responseToolCalls.length ? { tool_calls: responseToolCalls } : {}),
      };
      messages.push(assistantMessage);

      if (!responseToolCalls.length) {
        return {
          requestId: context.requestId,
          completion: "assistant_reply",
          rawReply: assistantMessage.content.trim() || "O modelo não retornou conteúdo.",
          messages,
          toolExecutions,
          iterations: iteration + 1,
        };
      }

      let repeatedToolCallDetected = false;

      for (const toolCall of responseToolCalls) {
        const toolCallId = randomUUID();
        const toolSignature = JSON.stringify({
          tool: toolCall.function.name,
          arguments: toolCall.function.arguments ?? {},
        });
        if (seenToolCalls.has(toolSignature)) {
          repeatedToolCallDetected = true;
        }
        seenToolCalls.add(toolSignature);

        try {
          const execution = await this.deps.executeTool({
            requestId: context.requestId,
            toolCallId,
            toolName: toolCall.function.name,
            rawArguments: toolCall.function.arguments,
            context,
            requestLogger: input.requestLogger.child({
              tool: toolCall.function.name,
              toolCallId,
              stage: "response-synthesizer",
            }),
          });

          toolExecutions.push({
            toolName: toolCall.function.name,
            resultPreview: execution.content.slice(0, 240),
          });

          messages.push({
            role: "tool",
            tool_name: toolCall.function.name,
            tool_call_id: toolCall.id ?? toolCallId,
            content: execution.content,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error("Tool execution failed during response synthesis", {
            requestId: context.requestId,
            tool: toolCall.function.name,
            error: errorMessage,
          });

          messages.push({
            role: "tool",
            tool_name: toolCall.function.name,
            tool_call_id: toolCall.id ?? toolCallId,
            content: JSON.stringify(
              {
                ok: false,
                error: errorMessage,
              },
              null,
              2,
            ),
          });
        }
      }

      const reachedToolBudget = iteration >= context.maxToolIterations - 1;
      if (repeatedToolCallDetected || reachedToolBudget) {
        const forcedReason = repeatedToolCallDetected ? "repeated-tool-call" : "tool-budget-reached";
        input.requestLogger.warn("Forcing final synthesis after tool execution", {
          reason: forcedReason,
          toolExecutions: toolExecutions.length,
        });

        const synthesisMessages: ConversationMessage[] = [
          ...messages,
          {
            role: "system",
            content:
              "Use os resultados de ferramentas já disponíveis para responder ao usuário agora. Não chame novas ferramentas. Se alguma ferramenta falhou, mencione o erro de forma breve e siga com a melhor resposta possível.",
          },
        ];

        const synthesisResponse = await this.client.chat({
          messages: synthesisMessages,
        });
        return {
          requestId: context.requestId,
          completion: "forced_final_synthesis",
          forcedReason,
          rawReply:
            synthesisResponse.message.content.trim() ||
            buildFallbackReply(toolExecutions),
          messages: [...synthesisMessages, synthesisResponse.message],
          toolExecutions,
          iterations: iteration + 1,
        };
      }
    }

    throw new Error(
      `Agent exceeded the maximum number of tool iterations (${context.maxToolIterations})`,
    );
  }
}
