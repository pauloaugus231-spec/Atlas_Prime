import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { IntentResolution } from "./intent-router.js";
import type { AgentRunOptions, AgentRunResult } from "./agent-core.js";

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
  run(input: DirectRouteExecutionInput): Promise<AgentRunResult | null>;
}

export type DirectRouteHandler = DirectRouteDefinition["run"];

export function defineDirectRoute(
  key: string,
  group: string,
  run: DirectRouteHandler,
): DirectRouteDefinition {
  return { key, group, run };
}

export class DirectRouteRunner {
  constructor(private readonly logger: Logger) {}

  async run(
    input: DirectRouteExecutionInput,
    routes: DirectRouteDefinition[],
    fallback?: (input: DirectRouteExecutionInput) => Promise<AgentRunResult | null>,
  ): Promise<AgentRunResult | null> {
    for (const route of routes) {
      const result = await route.run(input);
      if (!result) {
        continue;
      }

      this.logger.info("Direct route resolved request", {
        requestId: input.requestId,
        route: route.key,
        group: route.group,
      });
      return result;
    }

    if (!fallback) {
      return null;
    }

    this.logger.info("No direct route matched; invoking fallback", {
      requestId: input.requestId,
      routesEvaluated: routes.length,
    });
    return fallback(input);
  }
}
