import type { CapabilityPlan } from "./capability-planner.js";
import type { AgentRunResult } from "./agent-core.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { ProductGapRecord, CreateProductGapObservationInput } from "../types/product-gaps.js";
import type { ActivePlanningGoal } from "./active-goal-state.js";

interface ProductGapRecorder {
  recordProductGapObservation: (input: CreateProductGapObservationInput) => ProductGapRecord;
}

interface CapabilityActionServiceHelpers {
  buildActiveGoalUserDataReply: (goal: ActivePlanningGoal, plan: CapabilityPlan) => string;
  buildCapabilityPlanUserDataReply: (plan: CapabilityPlan) => string;
  buildCapabilityGapReply: (plan: CapabilityPlan, gap?: ProductGapRecord) => string;
  buildCapabilityGapSignature: (plan: CapabilityPlan) => string;
}

export interface CapabilityActionServiceDependencies {
  logger: Logger;
  personalMemory: ProductGapRecorder;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: CapabilityActionServiceHelpers;
}

export interface CapabilityActionInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
  preferences: UserPreferences;
  plan: CapabilityPlan;
  relatedSkill?: string;
  activeGoal?: ActivePlanningGoal;
}

export interface CapabilityActionExecutionResult {
  runResult: AgentRunResult;
  shouldClearChatState?: boolean;
}

export class CapabilityActionService {
  constructor(private readonly deps: CapabilityActionServiceDependencies) {}

  executePlanAction(input: CapabilityActionInput): CapabilityActionExecutionResult | null {
    const logger = input.requestLogger.child({ scope: "capability-action-service" });
    const { plan } = input;

    if (plan.suggestedAction === "respond_direct") {
      logger.info("Handling capability plan as direct response", {
        objective: plan.objective,
      });
      return {
        shouldClearChatState: true,
        runResult: {
          requestId: input.requestId,
          reply: plan.directReply ?? plan.summary,
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [
            {
              toolName: "capability_planner",
              resultPreview: JSON.stringify({
                objective: plan.objective,
                suggestedAction: plan.suggestedAction,
              }),
            },
          ],
        },
      };
    }

    if (plan.suggestedAction === "ask_user_data") {
      logger.info("Handling capability plan as user-data request", {
        objective: plan.objective,
        missingUserData: plan.missingUserData,
      });
      return {
        runResult: {
          requestId: input.requestId,
          reply: input.activeGoal
            ? this.deps.helpers.buildActiveGoalUserDataReply(input.activeGoal, plan)
            : this.deps.helpers.buildCapabilityPlanUserDataReply(plan),
          messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [
            {
              toolName: "capability_planner",
              resultPreview: JSON.stringify({
                objective: plan.objective,
                suggestedAction: plan.suggestedAction,
                missingUserData: plan.missingUserData,
              }),
            },
          ],
        },
      };
    }

    if (plan.suggestedAction !== "handle_gap") {
      return null;
    }

    const missingCapabilities = [...new Set(
      plan.missingRequirements
        .filter((item) => item.kind !== "user_data")
        .map((item) => item.name),
    )];
    const missingRequirementKinds = [...new Set(
      plan.missingRequirements
        .filter((item) => item.kind !== "user_data")
        .map((item) => item.kind),
    )];
    const gap = plan.shouldLogGap
      ? this.deps.personalMemory.recordProductGapObservation({
          signature: this.deps.helpers.buildCapabilityGapSignature(plan),
          type: plan.gapType ?? "capability_gap",
          description: input.userPrompt,
          inferredObjective: plan.objective,
          missingCapabilities,
          missingRequirementKinds,
          contextSummary: plan.summary,
          relatedSkill: input.relatedSkill,
          impact: plan.objective === "travel_cost_estimate" ? "high" : "medium",
        })
      : undefined;

    logger.info("Handling capability plan as product gap", {
      objective: plan.objective,
      shouldLogGap: Boolean(plan.shouldLogGap),
      gapId: gap?.id,
      missingCapabilities,
      missingUserData: plan.missingUserData,
    });

    return {
      runResult: {
        requestId: input.requestId,
        reply: this.deps.helpers.buildCapabilityGapReply(plan, gap),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "capability_planner",
            resultPreview: JSON.stringify({
              objective: plan.objective,
              suggestedAction: plan.suggestedAction,
              gapId: gap?.id ?? null,
              missingCapabilities,
              missingUserData: plan.missingUserData,
            }),
          },
        ],
      },
    };
  }
}
