import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { ExternalReasoningConfig } from "../types/config.js";
import type { IntentResolution } from "./intent-router.js";
import { looksLikeLowFrictionReadPrompt } from "./clarification-rules.js";

export type ExternalReasoningStage = "pre_local" | "post_direct_routes";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function isExternalReasoningAvailable(config: ExternalReasoningConfig): boolean {
  return config.enabled && config.mode !== "off" && Boolean(config.baseUrl);
}

export function shouldAttemptExternalReasoning(
  config: ExternalReasoningConfig,
  prompt: string,
  intent: IntentResolution,
  stage: ExternalReasoningStage,
): boolean {
  if (!isExternalReasoningAvailable(config)) {
    return false;
  }

  if (config.mode === "always") {
    return stage === "pre_local";
  }

  if (config.mode === "off" || stage !== "post_direct_routes") {
    return false;
  }

  const isLowFrictionRead = looksLikeLowFrictionReadPrompt(prompt, intent);
  if (isLowFrictionRead && !config.routeSimpleReads) {
    return false;
  }

  if (intent.compoundIntent) {
    return true;
  }

  if (intent.orchestration.route.confidence < 0.7) {
    return true;
  }

  if (includesAny(normalizeEmailAnalysisText(prompt), ["estrateg", "estratég", "planej", "prioriz", "analise", "análise"])) {
    return true;
  }

  return ["plan", "analyze", "communicate"].includes(intent.orchestration.route.actionMode);
}
