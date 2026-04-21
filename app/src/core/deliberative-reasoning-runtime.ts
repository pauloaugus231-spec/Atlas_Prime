import type { Logger } from "../types/logger.js";
import type { IntentResolution } from "./intent-router.js";
import type { ContextBundle } from "./context-assembler.js";
import { ReasoningEngine, type ReasoningTrace } from "./reasoning-engine.js";
import { UserModelTracker } from "./user-model-tracker.js";

interface DeliberativeReasoningRuntimeDependencies {
  reasoningEngine?: ReasoningEngine;
  userModelTracker?: UserModelTracker;
}

export class DeliberativeReasoningRuntime {
  constructor(private readonly deps: DeliberativeReasoningRuntimeDependencies) {}

  enrichContext(input: {
    context: ContextBundle;
    intent: IntentResolution;
    requestLogger: Logger;
  }): ContextBundle {
    const { context, intent, requestLogger } = input;
    const reasoningEngine = this.deps.reasoningEngine;
    if (!reasoningEngine || !context.operationalState || !context.profile) {
      return context;
    }

    try {
      const trace = reasoningEngine.analyze({
        userPrompt: context.activeUserPrompt,
        operationalState: context.operationalState,
        profile: context.profile,
        recentMessages: context.recentMessages,
        currentHour: new Date().getHours(),
      });
      const surfacedInsights = trace.proactiveInsights
        .filter((insight) => reasoningEngine.shouldSurfaceInsight(insight))
        .slice(0, 2);
      const reasoningTrace: ReasoningTrace = {
        ...trace,
        proactiveInsights: surfacedInsights,
      };
      const insightMessage = surfacedInsights.length > 0
        ? [{
            role: "system" as const,
            content: [
              "Percepção proativa do Atlas antes de responder:",
              ...surfacedInsights.map((insight) => `[${insight.urgency}] ${insight.message}`),
            ].join("\n"),
          }]
        : [];

      this.recordUserModelInteraction({
        context,
        intent,
        hadProactiveInsight: surfacedInsights.length > 0,
        requestLogger,
      });
      requestLogger.info("Deliberative reasoning applied", {
        insightCount: surfacedInsights.length,
        responseStyle: reasoningTrace.suggestedResponseStyle,
        energyHint: reasoningTrace.energyHint,
      });

      return {
        ...context,
        reasoningTrace,
        messages: [
          ...context.messages,
          ...insightMessage,
        ],
      };
    } catch (error) {
      requestLogger.warn("Deliberative reasoning failed; continuing without trace", {
        error: error instanceof Error ? error.message : String(error),
      });
      return context;
    }
  }

  private recordUserModelInteraction(input: {
    context: ContextBundle;
    intent: IntentResolution;
    hadProactiveInsight: boolean;
    requestLogger: Logger;
  }): void {
    const userModelTracker = this.deps.userModelTracker;
    if (!userModelTracker) {
      return;
    }

    try {
      const promptLength = input.context.activeUserPrompt.length;
      const promptComplexity =
        input.intent.compoundIntent || /estrat[eé]gia|decis[aã]o|compar|diagn[oó]stico|plano/i.test(input.context.activeUserPrompt)
          ? "strategic"
          : promptLength > 180 || input.context.activeUserPrompt.split(/[.!?]/).filter(Boolean).length > 2
            ? "complex"
            : "simple";
      userModelTracker.updateFromInteraction({
        hour: new Date().getHours(),
        domain: input.context.orchestration.route.primaryDomain,
        promptComplexity,
        hadProactiveInsight: input.hadProactiveInsight,
        userReacted: false,
      });
    } catch (error) {
      input.requestLogger.debug("User behavior model update skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
