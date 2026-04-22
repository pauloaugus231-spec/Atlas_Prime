import type { TurnFrame } from "../../types/turn-frame.js";
import type { Logger } from "../../types/logger.js";
import type { DirectRouteDefinition } from "../direct-route-runner.js";
import { RouteDecisionAuditStore } from "./route-decision-audit-store.js";
import { ServiceSelector } from "./service-selector.js";

export interface RouteShadowEvaluationInput {
  requestId: string;
  prompt: string;
  turnFrame: TurnFrame;
  routes: DirectRouteDefinition[];
  legacyRouteKey?: string;
  executedRouteKey?: string;
}

export class RouteShadowEvaluator {
  constructor(
    private readonly selector: ServiceSelector,
    private readonly auditStore: RouteDecisionAuditStore | undefined,
    private readonly logger: Logger,
  ) {}

  evaluate(input: RouteShadowEvaluationInput): { selectedRouteKey?: string; reasons: string[] } {
    const selected = this.selector.select(input.turnFrame, input.routes);
    const selectedRouteKey = selected?.route.key;
    const divergence = Boolean(selectedRouteKey && selectedRouteKey !== input.legacyRouteKey);

    if (this.auditStore) {
      this.auditStore.record({
        requestId: input.requestId,
        prompt: input.prompt,
        primaryIntent: input.turnFrame.primaryIntent,
        mode: "shadow",
        ...(selectedRouteKey ? { selectedRoute: selectedRouteKey } : {}),
        ...(input.legacyRouteKey ? { legacyRoute: input.legacyRouteKey } : {}),
        ...(input.executedRouteKey ? { executedRoute: input.executedRouteKey } : {}),
        confidence: input.turnFrame.confidence,
        divergence,
        reasons: selected?.reasons ?? [],
      });
    }

    if (selectedRouteKey) {
      this.logger.debug("Shadow route evaluation completed", {
        requestId: input.requestId,
        selectedRoute: selectedRouteKey,
        legacyRoute: input.legacyRouteKey,
        executedRoute: input.executedRouteKey,
        divergence,
      });
    }

    return {
      ...(selectedRouteKey ? { selectedRouteKey } : {}),
      reasons: selected?.reasons ?? [],
    };
  }
}
