import { createHash } from "node:crypto";
import type { CapabilityDefinition } from "../../types/capability.js";
import type { PendingActionDraft, PendingAutonomyCapabilityDraft } from "../draft-action-service.js";
import type { AutonomyObservation, AutonomySuggestion } from "../../types/autonomy.js";
import type { Logger } from "../../types/logger.js";
import type { CapabilityRegistry } from "../capability-registry.js";
import type { ObservationStore } from "./observation-store.js";
import type { SuggestionStore } from "./suggestion-store.js";
import type { AutonomyAuditStore } from "./autonomy-audit-store.js";
import type { FeedbackStore } from "./feedback-store.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

function hashArguments(argumentsValue: unknown): string {
  return createHash("sha256").update(stableStringify(argumentsValue)).digest("hex");
}

function requiresApproval(capability: CapabilityDefinition): boolean {
  return capability.requiresApproval
    || capability.risk === "high"
    || capability.risk === "critical"
    || capability.sideEffects.some((effect) => effect !== "read")
    || capability.writesExternalSystem === true
    || capability.sendsToExternalRecipient === true
    || capability.autonomyLevel === "L4"
    || capability.autonomyLevel === "L5"
    || capability.dataSensitivity === "sensitive"
    || capability.dataSensitivity === "credential"
    || capability.dataSensitivity === "financial";
}

function buildAutonomyCapabilityDraftReply(draft: PendingAutonomyCapabilityDraft): string {
  return [
    [
      "Deixei essa ação pronta para aprovação antes de executar.",
      `- Ação: ${draft.title}`,
      `- Capability: ${draft.capabilityName}`,
      draft.summary ? `- Contexto: ${draft.summary}` : undefined,
    ].filter(Boolean).join("\n"),
    "",
    "AUTONOMY_CAPABILITY_DRAFT",
    JSON.stringify(draft, null, 2),
    "END_AUTONOMY_CAPABILITY_DRAFT",
  ].join("\n");
}

function buildExecutionReply(title: string, executionContent: string): string {
  const detail = executionContent.trim();
  if (!detail) {
    return `Executei isso agora: ${title}.`;
  }
  return `Executei isso agora: ${title}.\n${detail}`;
}

function buildBlockedReply(title: string, reason: string): string {
  return [
    `Marquei esta direção como aprovada: ${title}.`,
    `Ainda não consigo executar isso automaticamente daqui: ${reason}`,
  ].join("\n");
}

export type AutonomyActionOutcome =
  | { kind: "approved_only"; reply: string }
  | { kind: "approval_requested"; reply: string; draft: PendingActionDraft }
  | { kind: "executed"; reply: string; rawResult: unknown }
  | { kind: "failed"; reply: string };

export interface AutonomyActionServiceDependencies {
  logger: Logger;
  capabilityRegistry: Pick<CapabilityRegistry, "getCapability">;
  observations: Pick<ObservationStore, "getById">;
  suggestions: Pick<SuggestionStore, "updateStatus">;
  audit: Pick<AutonomyAuditStore, "record">;
  feedback: Pick<FeedbackStore, "record">;
  executeToolDirect: (
    toolName: string,
    rawArguments: unknown,
  ) => Promise<{ requestId: string; content: string; rawResult: unknown }>;
}

export class AutonomyActionService {
  constructor(private readonly deps: AutonomyActionServiceDependencies) {}

  private markApproved(suggestion: AutonomySuggestion, feedbackNote: string): void {
    this.deps.suggestions.updateStatus({
      id: suggestion.id,
      status: "approved",
    });
    this.deps.feedback.record({
      suggestionId: suggestion.id,
      feedbackKind: "accepted",
      note: feedbackNote,
    });
  }

  async approveSuggestion(suggestion: AutonomySuggestion): Promise<AutonomyActionOutcome> {
    const observation = this.deps.observations.getById(suggestion.observationId);

    if (!suggestion.suggestedAction) {
      this.markApproved(suggestion, "approved_without_bound_action");
      this.deps.audit.record({
        kind: "suggestion_status_changed",
        suggestionId: suggestion.id,
        observationId: suggestion.observationId,
        payload: {
          previousStatus: suggestion.status,
          nextStatus: "approved",
          reason: "operator_approved_without_bound_action",
        },
      });
      return {
        kind: "approved_only",
        reply: `Marquei isso como aprovado: ${suggestion.title}. Vou tratar como direção confirmada daqui para frente.`,
      };
    }

    const capability = this.deps.capabilityRegistry.getCapability(suggestion.suggestedAction.capabilityName);
    if (!capability) {
      this.markApproved(suggestion, "approved_missing_capability_binding");
      this.deps.audit.record({
        kind: "suggestion_action_blocked",
        suggestionId: suggestion.id,
        observationId: suggestion.observationId,
        payload: {
          capabilityName: suggestion.suggestedAction.capabilityName,
          reason: "capability_not_found",
        },
      });
      return {
        kind: "approved_only",
        reply: buildBlockedReply(suggestion.title, `a capability ${suggestion.suggestedAction.capabilityName} não está disponível.`),
      };
    }

    if (capability.allowedSourceTrust?.length && observation && !capability.allowedSourceTrust.includes(observation.sourceTrust)) {
      this.markApproved(suggestion, "approved_blocked_by_source_trust");
      this.deps.audit.record({
        kind: "suggestion_action_blocked",
        suggestionId: suggestion.id,
        observationId: suggestion.observationId,
        payload: {
          capabilityName: capability.name,
          sourceTrust: observation.sourceTrust,
          allowedSourceTrust: capability.allowedSourceTrust,
          reason: "source_trust_not_allowed",
        },
      });
      return {
        kind: "approved_only",
        reply: buildBlockedReply(suggestion.title, "a origem dessa observação não tem confiança suficiente para acionar essa capability sozinha."),
      };
    }

    const argumentsHash = hashArguments(suggestion.suggestedAction.arguments);
    this.deps.audit.record({
      kind: "suggestion_action_planned",
      suggestionId: suggestion.id,
      observationId: suggestion.observationId,
      payload: {
        capabilityName: capability.name,
        capabilityRisk: capability.risk,
        sideEffects: capability.sideEffects,
        argumentsHash,
        sourceTrust: observation?.sourceTrust,
        autonomyLevel: capability.autonomyLevel,
      },
    });

    if (requiresApproval(capability)) {
      this.markApproved(suggestion, "approved_and_emitted_draft");
      const draft: PendingAutonomyCapabilityDraft = {
        kind: "autonomy_capability",
        suggestionId: suggestion.id,
        title: suggestion.title,
        capabilityName: capability.name,
        arguments: suggestion.suggestedAction.arguments as Record<string, unknown>,
        summary: suggestion.body,
      };
      this.deps.audit.record({
        kind: "suggestion_action_approval_requested",
        suggestionId: suggestion.id,
        observationId: suggestion.observationId,
        payload: {
          capabilityName: capability.name,
          capabilityRisk: capability.risk,
          sideEffects: capability.sideEffects,
          argumentsHash,
          sourceTrust: observation?.sourceTrust,
        },
      });
      return {
        kind: "approval_requested",
        reply: buildAutonomyCapabilityDraftReply(draft),
        draft,
      };
    }

    try {
      const execution = await this.deps.executeToolDirect(
        capability.name,
        suggestion.suggestedAction.arguments,
      );
      this.deps.suggestions.updateStatus({
        id: suggestion.id,
        status: "executed",
      });
      this.deps.feedback.record({
        suggestionId: suggestion.id,
        feedbackKind: "executed",
        note: "executed_without_additional_approval",
      });
      this.deps.audit.record({
        kind: "suggestion_action_executed",
        suggestionId: suggestion.id,
        observationId: suggestion.observationId,
        payload: {
          capabilityName: capability.name,
          capabilityRisk: capability.risk,
          sideEffects: capability.sideEffects,
          argumentsHash,
          requestId: execution.requestId,
        },
      });

      return {
        kind: "executed",
        reply: buildExecutionReply(suggestion.title, execution.content),
        rawResult: execution.rawResult,
      };
    } catch (error) {
      this.deps.suggestions.updateStatus({
        id: suggestion.id,
        status: "failed",
      });
      this.deps.audit.record({
        kind: "suggestion_action_failed",
        suggestionId: suggestion.id,
        observationId: suggestion.observationId,
        payload: {
          capabilityName: capability.name,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return {
        kind: "failed",
        reply: [
          `A direção ficou aprovada, mas falhou ao executar agora: ${suggestion.title}.`,
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
      };
    }
  }
}
