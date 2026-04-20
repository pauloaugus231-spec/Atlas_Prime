import type { AgentCoreRequestRuntime, AgentRunOptions, AgentRunResult } from "./agent-core.js";
import type { Logger } from "../types/logger.js";
import {
  extractPendingActionDraft,
  sanitizeToolPayloadLeak,
  stripPendingDraftMarkers,
  type PendingActionDraft,
} from "./draft-action-service.js";
import { AssistantActionDispatcher } from "./action-dispatcher.js";

export interface OrchestratedRequestInput {
  channel: "telegram" | "whatsapp" | "cli" | string;
  agentPrompt: string;
  recentMessages: string[];
  options?: AgentRunOptions;
  draftReplyFormatter?: (draft: PendingActionDraft) => string | undefined;
}

export interface OrchestratedRequestOutput {
  result: AgentRunResult;
  visibleReply: string;
  pendingDraft?: PendingActionDraft;
  structuredReplyHandled: boolean;
}

export class RequestOrchestrator {
  constructor(
    private readonly core: AgentCoreRequestRuntime,
    private readonly dispatcher: AssistantActionDispatcher,
    private readonly logger: Logger,
  ) {}

  async run(input: OrchestratedRequestInput): Promise<OrchestratedRequestOutput> {
    const result = await this.core.runUserPrompt(input.agentPrompt, input.options);
    const structuredReply = await this.dispatcher.resolveStructuredReply(result.reply, {
      recentMessages: input.recentMessages,
      channelLabel: input.channel,
    });
    if (structuredReply.handled) {
      return {
        result,
        visibleReply: structuredReply.visibleReply,
        structuredReplyHandled: true,
      };
    }

    const pendingDraft = extractPendingActionDraft(result.reply);
    const baseVisibleReply = sanitizeToolPayloadLeak(stripPendingDraftMarkers(result.reply) || result.reply);
    const visibleReply = pendingDraft
      ? input.draftReplyFormatter?.(pendingDraft) ?? baseVisibleReply
      : baseVisibleReply;

    this.logger.debug("Orchestrated channel response", {
      channel: input.channel,
      requestId: result.requestId,
      pendingDraftKind: pendingDraft?.kind,
      toolExecutions: result.toolExecutions.length,
    });

    return {
      result,
      visibleReply,
      pendingDraft,
      structuredReplyHandled: false,
    };
  }
}
