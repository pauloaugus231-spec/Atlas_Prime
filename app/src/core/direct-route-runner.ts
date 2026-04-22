import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { IntentResolution } from "./intent-router.js";
import type { AgentRunOptions, AgentRunResult } from "./agent-core.js";
import { buildTurnFrame } from "./routing/turn-understanding-service.js";
import type { RouteDecisionAuditStore } from "./routing/route-decision-audit-store.js";
import { RouteShadowEvaluator } from "./routing/route-shadow-evaluator.js";
import { ServiceSelector } from "./routing/service-selector.js";
import type { DirectRouteManifest } from "./routing/service-manifest.js";
import { isPhase4IntentFirstIntent } from "./routing/turn-resolution-policy.js";

export interface DirectRouteExecutionInput {
  userPrompt: string;
  activeUserPrompt: string;
  requestId: string;
  requestLogger: Logger;
  intent: IntentResolution;
  orchestration: OrchestrationContext;
  preferences: UserPreferences;
  options?: AgentRunOptions;
}

export interface DirectRouteDefinition {
  key: string;
  group: string;
  manifest?: DirectRouteManifest;
  run(input: DirectRouteExecutionInput): Promise<AgentRunResult | null>;
}

export type DirectRouteHandler = DirectRouteDefinition["run"];

export function defineDirectRoute(
  key: string,
  group: string,
  run: DirectRouteHandler,
  manifest?: DirectRouteManifest,
): DirectRouteDefinition {
  return { key, group, run, manifest };
}

export class DirectRouteRunner {
  private readonly selector: ServiceSelector;
  private readonly shadowEvaluator: RouteShadowEvaluator;
  private readonly auditStore?: RouteDecisionAuditStore;

  constructor(
    private readonly logger: Logger,
    auditStore?: RouteDecisionAuditStore,
  ) {
    this.selector = new ServiceSelector();
    this.auditStore = auditStore;
    this.shadowEvaluator = new RouteShadowEvaluator(
      this.selector,
      auditStore,
      logger.child({ scope: "route-shadow" }),
    );
  }

  async run(
    input: DirectRouteExecutionInput,
    routes: DirectRouteDefinition[],
    fallback?: (input: DirectRouteExecutionInput) => Promise<AgentRunResult | null>,
  ): Promise<AgentRunResult | null> {
    const turnFrame = input.intent.turnFrame ?? buildTurnFrame({
      text: input.activeUserPrompt,
      source: "unknown",
      recentMessages: input.intent.historyUserTurns,
    });
    const selectedCandidate = isPhase4IntentFirstIntent(turnFrame.primaryIntent)
      ? this.selector.select(turnFrame, routes)
      : null;

    if (selectedCandidate) {
      const selectedResult = await selectedCandidate.route.run(input);
      if (selectedResult) {
        this.logger.info("Direct route resolved request via intent-first selection", {
          requestId: input.requestId,
          route: selectedCandidate.route.key,
          group: selectedCandidate.route.group,
          primaryIntent: turnFrame.primaryIntent,
        });
        this.auditStore?.record({
          requestId: input.requestId,
          prompt: input.activeUserPrompt,
          primaryIntent: turnFrame.primaryIntent,
          mode: "intent_first",
          selectedRoute: selectedCandidate.route.key,
          executedRoute: selectedCandidate.route.key,
          confidence: turnFrame.confidence,
          divergence: false,
          reasons: selectedCandidate.reasons,
        });
        return selectedResult;
      }
    }

    const routesToEvaluate = selectedCandidate
      ? routes.filter((route) => route.key !== selectedCandidate.route.key)
      : routes;
    let matchedRoute: DirectRouteDefinition | undefined;

    for (const route of routesToEvaluate) {
      const result = await route.run(input);
      if (!result) {
        continue;
      }

      matchedRoute = route;
      this.logger.info("Direct route resolved request", {
        requestId: input.requestId,
        route: route.key,
        group: route.group,
      });
      this.shadowEvaluator.evaluate({
        requestId: input.requestId,
        prompt: input.activeUserPrompt,
        turnFrame,
        routes,
        legacyRouteKey: route.key,
        executedRouteKey: route.key,
      });
      return result;
    }

    if (!fallback) {
      this.shadowEvaluator.evaluate({
        requestId: input.requestId,
        prompt: input.activeUserPrompt,
        turnFrame,
        routes,
        ...(matchedRoute ? { legacyRouteKey: matchedRoute.key, executedRouteKey: matchedRoute.key } : {}),
      });
      return null;
    }

    this.logger.info("No direct route matched; invoking fallback", {
      requestId: input.requestId,
      routesEvaluated: routesToEvaluate.length,
    });
    this.shadowEvaluator.evaluate({
      requestId: input.requestId,
      prompt: input.activeUserPrompt,
      turnFrame,
      routes,
      ...(matchedRoute ? { legacyRouteKey: matchedRoute.key } : {}),
    });
    return fallback(input);
  }
}
