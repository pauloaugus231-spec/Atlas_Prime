import { parseAssistantDecisionReply } from "./assistant-decision.js";
import type { AgentCoreRequestRuntime } from "./agent-core.js";
import type { Logger } from "../types/logger.js";

export interface StructuredAssistantDecisionResolution {
  handled: boolean;
  visibleReply: string;
}

export class AssistantActionDispatcher {
  constructor(
    private readonly core: AgentCoreRequestRuntime,
    private readonly logger: Logger,
  ) {}

  async resolveStructuredReply(
    rawReply: string,
    input: {
      recentMessages: string[];
      channelLabel: string;
    },
  ): Promise<StructuredAssistantDecisionResolution> {
    const parsed = parseAssistantDecisionReply(rawReply);
    if (parsed.kind === "absent") {
      return { handled: false, visibleReply: "" };
    }

    if (parsed.kind === "invalid") {
      this.logger.warn("Rejected invalid structured assistant decision", {
        channel: input.channelLabel,
        error: parsed.error,
      });
      return {
        handled: true,
        visibleReply: [
          "Recebi uma decisão estruturada inválida para execução local.",
          "Nada foi executado.",
          `Detalhe: ${parsed.error}`,
        ].join("\n"),
      };
    }

    if (!parsed.decision.should_execute || !parsed.decision.execution) {
      return {
        handled: true,
        visibleReply: parsed.decision.assistant_reply,
      };
    }

    try {
      const resolvedPayload = parsed.decision.execution.tool === "execute_task_operation"
        ? await this.core.resolveStructuredTaskOperationPayload(parsed.decision.execution.payload, {
            recentMessages: input.recentMessages,
          })
        : null;

      if (resolvedPayload?.kind === "clarify") {
        return {
          handled: true,
          visibleReply: resolvedPayload.message,
        };
      }

      if (resolvedPayload?.kind === "invalid") {
        return {
          handled: true,
          visibleReply: [
            "Não consegui executar a decisão estruturada local.",
            `Detalhe: ${resolvedPayload.error}`,
          ].join("\n"),
        };
      }

      const execution = await this.core.executeToolDirect(
        parsed.decision.execution.tool,
        resolvedPayload?.kind === "resolved"
          ? resolvedPayload.payload
          : parsed.decision.execution.payload,
      );
      const rawResult = execution.rawResult && typeof execution.rawResult === "object"
        ? execution.rawResult as Record<string, unknown>
        : undefined;
      if (rawResult?.ok === false) {
        return {
          handled: true,
          visibleReply: [
            "Não consegui executar a decisão estruturada local.",
            `Detalhe: ${typeof rawResult.error === "string" ? rawResult.error : "Falha na execução local."}`,
          ].join("\n"),
        };
      }

      return {
        handled: true,
        visibleReply: parsed.decision.assistant_reply,
      };
    } catch (error) {
      this.logger.error("Structured assistant decision execution failed", {
        channel: input.channelLabel,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        handled: true,
        visibleReply: [
          "Não consegui executar a decisão estruturada local.",
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
      };
    }
  }
}
