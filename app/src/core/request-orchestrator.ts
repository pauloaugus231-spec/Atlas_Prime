import type { AgentCoreRequestRuntime, AgentRunOptions, AgentRunResult } from "./agent-core.js";
import type { Logger } from "../types/logger.js";
import type { CommitmentCandidate } from "../types/commitments.js";
import type { MemoryCandidate } from "../types/memory-candidates.js";
import {
  extractPendingActionDraft,
  sanitizeToolPayloadLeak,
  stripPendingDraftMarkers,
  type PendingActionDraft,
} from "./draft-action-service.js";
import { AssistantActionDispatcher } from "./action-dispatcher.js";
import type { CommitmentExtractor } from "./autonomy/commitment-extractor.js";
import type { CommitmentStore } from "./autonomy/commitment-store.js";
import type { MemoryCandidateExtractor } from "./autonomy/memory-candidate-extractor.js";
import type { MemoryCandidateStore } from "./autonomy/memory-candidate-store.js";

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

interface CommitmentCaptureDependencies {
  extractor: Pick<CommitmentExtractor, "extract">;
  store: Pick<CommitmentStore, "upsert">;
}

interface MemoryCandidateCaptureDependencies {
  extractor: Pick<MemoryCandidateExtractor, "extract">;
  store: Pick<MemoryCandidateStore, "upsert">;
}

export class RequestOrchestrator {
  constructor(
    private readonly core: AgentCoreRequestRuntime,
    private readonly dispatcher: AssistantActionDispatcher,
    private readonly logger: Logger,
    private readonly commitmentCapture?: CommitmentCaptureDependencies,
    private readonly memoryCandidateCapture?: MemoryCandidateCaptureDependencies,
  ) {}

  private captureCommitments(input: OrchestratedRequestInput): void {
    if (!this.commitmentCapture) {
      return;
    }

    try {
      const sourceKind: CommitmentCandidate["sourceKind"] = input.channel === "whatsapp"
        ? "whatsapp"
        : "telegram";
      const commitments = this.commitmentCapture.extractor.extract({
        text: input.agentPrompt,
        sourceKind,
        sourceId: input.options?.chatId ? String(input.options.chatId) : undefined,
        sourceTrust: "operator",
      });

      for (const commitment of commitments) {
        this.commitmentCapture.store.upsert(commitment);
      }

      if (commitments.length > 0) {
        this.logger.debug("Commitments captured from orchestrated request", {
          channel: input.channel,
          count: commitments.length,
        });
      }
    } catch (error) {
      this.logger.warn("Commitment capture failed during request orchestration; continuing", {
        channel: input.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private captureMemoryCandidates(input: OrchestratedRequestInput): void {
    if (!this.memoryCandidateCapture) {
      return;
    }

    try {
      const candidates = this.memoryCandidateCapture.extractor.extract({
        text: input.agentPrompt,
        sourceKind: "operator",
        sourceId: input.options?.chatId ? String(input.options.chatId) : undefined,
      });

      for (const candidate of candidates) {
        this.memoryCandidateCapture.store.upsert(candidate);
      }

      if (candidates.length > 0) {
        this.logger.debug("Memory candidates captured from orchestrated request", {
          channel: input.channel,
          count: candidates.length,
        });
      }
    } catch (error) {
      this.logger.warn("Memory candidate capture failed during request orchestration; continuing", {
        channel: input.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async run(input: OrchestratedRequestInput): Promise<OrchestratedRequestOutput> {
    const result = await this.core.runUserPrompt(input.agentPrompt, input.options);
    this.captureCommitments(input);
    this.captureMemoryCandidates(input);
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
