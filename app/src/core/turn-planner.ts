import type { StructuredAssistantDecisionResolution } from "./action-dispatcher.js";
import type { ContextBundle } from "./context-assembler.js";
import type { SynthesisResult, ToolExecutionTrace } from "./response-synthesizer.js";
import type { Logger } from "../types/logger.js";
import type {
  PersonalOperationalProfile,
} from "../types/personal-operational-memory.js";

export interface TurnOutcome {
  requestId: string;
  kind: "assistant_reply" | "structured_reply";
  rawReply: string;
  reply: string;
  messages: SynthesisResult["messages"];
  toolExecutions: ToolExecutionTrace[];
  structuredReplyHandled: boolean;
}

export interface TurnPlannerDependencies {
  getProfile(): PersonalOperationalProfile | undefined;
  resolveOperationalMode(
    prompt: string,
    profile?: PersonalOperationalProfile,
  ): "field" | null;
  rewriteReply(
    prompt: string,
    reply: string,
    input: {
      profile?: PersonalOperationalProfile;
      operationalMode: "field" | null;
    },
  ): string;
  resolveStructuredReply?(
    rawReply: string,
    input: {
      recentMessages: string[];
      channelLabel: string;
    },
  ): Promise<StructuredAssistantDecisionResolution>;
  rewriteStructuredReply?: boolean;
}

export class TurnPlanner {
  constructor(
    private readonly logger: Logger,
    private readonly deps: TurnPlannerDependencies,
  ) {}

  async plan(
    context: ContextBundle,
    synthesis: SynthesisResult,
    input: {
      channelLabel?: string;
    } = {},
  ): Promise<TurnOutcome> {
    const profile = this.deps.getProfile();
    const operationalMode = this.deps.resolveOperationalMode(context.activeUserPrompt, profile);
    const channelLabel = input.channelLabel ?? "core";

    if (this.deps.resolveStructuredReply) {
      const structured = await this.deps.resolveStructuredReply(synthesis.rawReply, {
        recentMessages: context.recentMessages,
        channelLabel,
      });
      if (structured.handled) {
        const reply = this.deps.rewriteStructuredReply
          ? this.deps.rewriteReply(context.activeUserPrompt, structured.visibleReply, {
              profile,
              operationalMode,
            })
          : structured.visibleReply;

        this.logger.info("Turn planner resolved structured reply", {
          requestId: context.requestId,
          channel: channelLabel,
          completion: synthesis.completion,
        });

        return {
          requestId: context.requestId,
          kind: "structured_reply",
          rawReply: synthesis.rawReply,
          reply,
          messages: synthesis.messages,
          toolExecutions: synthesis.toolExecutions,
          structuredReplyHandled: true,
        };
      }
    }

    const reply = this.deps.rewriteReply(context.activeUserPrompt, synthesis.rawReply, {
      profile,
      operationalMode,
    });

    this.logger.info("Turn planner produced assistant reply", {
      requestId: context.requestId,
      channel: channelLabel,
      completion: synthesis.completion,
      structuredReplyHandled: false,
    });

    return {
      requestId: context.requestId,
      kind: "assistant_reply",
      rawReply: synthesis.rawReply,
      reply,
      messages: synthesis.messages,
      toolExecutions: synthesis.toolExecutions,
      structuredReplyHandled: false,
    };
  }
}
