import type { AgentRunResult } from "../agent-core.js";
import type { ConversationMessage } from "../../types/llm.js";
import type { Logger } from "../../types/logger.js";
import type { OrchestrationContext } from "../../types/orchestration.js";
import type { UserPreferences } from "../../types/user-preferences.js";
import type { AutonomySuggestion } from "../../types/autonomy.js";
import { AutonomyActionService } from "./autonomy-action-service.js";
import { AutonomyAuditStore } from "./autonomy-audit-store.js";
import { AutonomyLoop } from "./autonomy-loop.js";
import { FeedbackStore } from "./feedback-store.js";
import { ObservationStore } from "./observation-store.js";
import { SuggestionRenderer, type RenderableSuggestion } from "./suggestion-renderer.js";
import { SuggestionStore } from "./suggestion-store.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function isReviewListPrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  if (normalized === "/revisar" || normalized === "/review") {
    return true;
  }

  return includesAny(normalized, [
    "o que eu preciso revisar",
    "o que voce separou para revisao",
    "o que você separou para revisão",
    "me mostra a fila de revisao",
    "me mostra a fila de revisão",
    "tem algo importante para mim",
    "tem algo relevante",
    "o que apareceu de relevante",
    "o que merece atencao",
    "o que merece atenção",
    "tem algo pendente que mereca atencao",
    "tem algo pendente que mereça atenção",
    "tem algo para eu revisar",
    "revisa isso agora",
    "revisar agora",
  ]);
}

function isExplainPrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return includesAny(normalized, [
    "por que a ",
    "por que o ponto ",
    "por que voce separou",
    "por que você separou",
    "me explica a ",
    "explica a ",
    "/por_que ",
  ]);
}

function isApprovePrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return (
    (includesAny(normalized, ["aprova ", "aprove ", "segue com ", "pode seguir com ", "/aprovar "]) && typeof extractTargetIndex(normalized) === "number")
    || /^(aprova|aprove)\s+(a\s+)?(primeira|segunda|terceira|quarta|quinta|ultima|última|\d+)/u.test(normalized)
  );
}

function isDismissPrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return includesAny(normalized, [
    "ignora a ",
    "ignore a ",
    "descarta a ",
    "descartar a ",
    "/ignorar ",
  ]);
}

function isSnoozePrompt(prompt: string): boolean {
  const normalized = normalize(prompt);
  return includesAny(normalized, [
    "adia a ",
    "adiar a ",
    "adiar isso",
    "/adiar ",
  ]);
}

function extractTargetIndex(prompt: string): number | undefined {
  const normalized = normalize(prompt);
  const numericMatch = normalized.match(/\b(?:item|ponto|sugestao|sugestão|a|o)?\s*(\d{1,2})\b/u);
  if (numericMatch?.[1]) {
    return Math.max(0, Number.parseInt(numericMatch[1], 10) - 1);
  }

  if (normalized.includes("primeira")) {
    return 0;
  }
  if (normalized.includes("segunda")) {
    return 1;
  }
  if (normalized.includes("terceira")) {
    return 2;
  }
  if (normalized.includes("quarta")) {
    return 3;
  }
  if (normalized.includes("quinta")) {
    return 4;
  }
  if (normalized.includes("ultima") || normalized.includes("última")) {
    return -1;
  }

  return undefined;
}

function parseSnoozeUntil(prompt: string, now = new Date()): string | undefined {
  const normalized = normalize(prompt);
  const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*h?\b/u);
  const hour = timeMatch?.[1] ? Math.max(0, Math.min(23, Number.parseInt(timeMatch[1], 10))) : 9;
  const minute = timeMatch?.[2] ? Math.max(0, Math.min(59, Number.parseInt(timeMatch[2], 10))) : 0;

  const target = new Date(now);
  if (normalized.includes("amanha")) {
    target.setDate(target.getDate() + 1);
  } else if (normalized.includes("hoje")) {
    // keep current date
  } else if (normalized.includes("mais tarde")) {
    target.setHours(target.getHours() + 4, 0, 0, 0);
    return target.toISOString();
  } else {
    return undefined;
  }

  target.setHours(hour, minute, 0, 0);
  return target.toISOString();
}

function isVisibleSuggestion(suggestion: AutonomySuggestion, nowIso: string): boolean {
  if (suggestion.status === "dismissed" || suggestion.status === "executed" || suggestion.status === "failed") {
    return false;
  }
  if (suggestion.status === "snoozed" && suggestion.snoozedUntil && suggestion.snoozedUntil > nowIso) {
    return false;
  }
  return true;
}

function resolveTarget(
  prompt: string,
  items: RenderableSuggestion[],
): { item?: RenderableSuggestion; index?: number } {
  if (items.length === 0) {
    return {};
  }

  const index = extractTargetIndex(prompt);
  if (typeof index === "number") {
    if (index === -1) {
      return {
        item: items[items.length - 1],
        index: items.length - 1,
      };
    }
    return {
      item: items[index],
      index,
    };
  }

  if (items.length === 1) {
    return {
      item: items[0],
      index: 0,
    };
  }

  return {};
}

export interface AutonomyDirectServiceDependencies {
  logger: Logger;
  loop: Pick<AutonomyLoop, "runOnce">;
  actionService: Pick<AutonomyActionService, "approveSuggestion">;
  suggestions: Pick<SuggestionStore, "getById" | "listByStatus" | "updateStatus">;
  observations: Pick<ObservationStore, "getById">;
  audit: Pick<AutonomyAuditStore, "record">;
  feedback: Pick<FeedbackStore, "record">;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
}

interface AutonomyDirectInput {
  userPrompt: string;
  requestId: string;
  requestLogger?: Logger;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

export class AutonomyDirectService {
  private readonly renderer = new SuggestionRenderer();

  constructor(private readonly deps: AutonomyDirectServiceDependencies) {}

  private buildRenderableSuggestions(nowIso: string): RenderableSuggestion[] {
    const suggestions = this.deps.suggestions
      .listByStatus(["queued", "notified", "snoozed"], 8)
      .filter((item) => isVisibleSuggestion(item, nowIso));

    return suggestions.map((suggestion) => ({
      suggestion,
      observation: this.deps.observations.getById(suggestion.observationId),
    }));
  }

  private buildResult(input: AutonomyDirectInput, reply: string, toolName: string, preview: Record<string, unknown>): AgentRunResult {
    return {
      requestId: input.requestId,
      reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName,
          resultPreview: JSON.stringify(preview, null, 2),
        },
      ],
    };
  }

  async tryRunAutonomyReview(input: AutonomyDirectInput): Promise<AgentRunResult | null> {
    const normalized = normalize(input.userPrompt);
    const nowIso = new Date().toISOString();
    const requestLogger = input.requestLogger ?? this.deps.logger;

    if (isReviewListPrompt(normalized)) {
      requestLogger.info("Using direct autonomy review route");
      await this.deps.loop.runOnce();
      const items = this.buildRenderableSuggestions(nowIso).slice(0, 4);
      for (const item of items) {
        if (item.suggestion.status === "queued") {
          this.deps.suggestions.updateStatus({
            id: item.suggestion.id,
            status: "notified",
            lastNotifiedAt: nowIso,
          });
          this.deps.audit.record({
            kind: "suggestion_status_changed",
            suggestionId: item.suggestion.id,
            observationId: item.suggestion.observationId,
            payload: {
              previousStatus: "queued",
              nextStatus: "notified",
              reason: "review_list_rendered",
            },
          });
        }
      }

      return this.buildResult(
        input,
        this.renderer.renderQueue(items),
        "autonomy_review",
        {
          count: items.length,
          ids: items.map((item) => item.suggestion.id),
        },
      );
    }

    if (isExplainPrompt(normalized)) {
      const items = this.buildRenderableSuggestions(nowIso);
      const target = resolveTarget(normalized, items);
      if (!target.item) {
        return this.buildResult(
          input,
          items.length === 0
            ? "Não tenho ponto ativo dessa fila para explicar agora."
            : "Diz qual ponto você quer entender melhor. Exemplo: `por que a 1?`",
          "autonomy_review_explain",
          { found: false, count: items.length },
        );
      }

      return this.buildResult(
        input,
        this.renderer.renderExplanation(target.item, target.index),
        "autonomy_review_explain",
        {
          suggestionId: target.item.suggestion.id,
          observationId: target.item.suggestion.observationId,
        },
      );
    }

    if (isApprovePrompt(normalized)) {
      const items = this.buildRenderableSuggestions(nowIso);
      const target = resolveTarget(normalized, items);
      if (!target.item) {
        return this.buildResult(
          input,
          items.length === 0
            ? "Não tenho sugestão ativa para aprovar agora."
            : "Diz qual ponto você quer aprovar. Exemplo: `aprova a 1`.",
          "autonomy_review_approve",
          { updated: false, count: items.length },
        );
      }

      const outcome = await this.deps.actionService.approveSuggestion(target.item.suggestion);

      return this.buildResult(
        input,
        outcome.kind === "approved_only"
          ? this.renderer.renderApproved(target.item, target.index)
          : outcome.reply,
        "autonomy_review_approve",
        {
          updated: true,
          suggestionId: target.item.suggestion.id,
          nextStatus: outcome.kind === "executed" ? "executed" : "approved",
          outcome: outcome.kind,
        },
      );
    }

    if (isDismissPrompt(normalized)) {
      const items = this.buildRenderableSuggestions(nowIso);
      const target = resolveTarget(normalized, items);
      if (!target.item) {
        return this.buildResult(
          input,
          items.length === 0
            ? "Não tenho sugestão ativa para ignorar agora."
            : "Diz qual ponto você quer ignorar. Exemplo: `ignora a 2`.",
          "autonomy_review_dismiss",
          { updated: false, count: items.length },
        );
      }

      this.deps.suggestions.updateStatus({
        id: target.item.suggestion.id,
        status: "dismissed",
      });
      this.deps.feedback.record({
        suggestionId: target.item.suggestion.id,
        feedbackKind: "dismissed",
        note: "dismissed_via_natural_language",
      });
      this.deps.audit.record({
        kind: "suggestion_status_changed",
        suggestionId: target.item.suggestion.id,
        observationId: target.item.suggestion.observationId,
        payload: {
          previousStatus: target.item.suggestion.status,
          nextStatus: "dismissed",
          reason: "operator_dismissed",
        },
      });

      return this.buildResult(
        input,
        this.renderer.renderDismissed(target.item, target.index),
        "autonomy_review_dismiss",
        {
          updated: true,
          suggestionId: target.item.suggestion.id,
          nextStatus: "dismissed",
        },
      );
    }

    if (isSnoozePrompt(normalized)) {
      const items = this.buildRenderableSuggestions(nowIso);
      const target = resolveTarget(normalized, items);
      const snoozedUntil = parseSnoozeUntil(normalized);
      if (!target.item || !snoozedUntil) {
        return this.buildResult(
          input,
          items.length === 0
            ? "Não tenho sugestão ativa para adiar agora."
            : "Diz qual ponto devo adiar e até quando. Exemplo: `adia a 1 para amanhã às 9h`.",
          "autonomy_review_snooze",
          {
            updated: false,
            count: items.length,
            parsedSnooze: Boolean(snoozedUntil),
          },
        );
      }

      this.deps.suggestions.updateStatus({
        id: target.item.suggestion.id,
        status: "snoozed",
        snoozedUntil,
      });
      this.deps.feedback.record({
        suggestionId: target.item.suggestion.id,
        feedbackKind: "snoozed",
        note: `snoozed_until:${snoozedUntil}`,
      });
      this.deps.audit.record({
        kind: "suggestion_status_changed",
        suggestionId: target.item.suggestion.id,
        observationId: target.item.suggestion.observationId,
        payload: {
          previousStatus: target.item.suggestion.status,
          nextStatus: "snoozed",
          reason: "operator_snoozed",
          snoozedUntil,
        },
      });

      return this.buildResult(
        input,
        this.renderer.renderSnoozed(target.item, snoozedUntil, target.index),
        "autonomy_review_snooze",
        {
          updated: true,
          suggestionId: target.item.suggestion.id,
          nextStatus: "snoozed",
          snoozedUntil,
        },
      );
    }

    return null;
  }
}
