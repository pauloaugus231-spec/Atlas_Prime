import type { AgentRunResult } from "./agent-core.js";
import type { CapabilityAvailabilityRecord } from "../types/capability.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { ProductGapRecord, ProductGapStatus } from "../types/product-gaps.js";
import type { UserPreferences } from "../types/user-preferences.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

interface CapabilityInspectionPlanner {
  isCapabilityInspectionPrompt: (prompt: string) => boolean;
  listCapabilityAvailability: () => CapabilityAvailabilityRecord[];
}

interface ProductGapStore {
  listProductGaps: (input?: {
    status?: ProductGapStatus;
    limit?: number;
  }) => ProductGapRecord[];
}

interface CapabilityInspectionHelpers {
  buildCapabilityAvailabilityReply: (items: CapabilityAvailabilityRecord[]) => string;
  buildProductGapsReply: (items: ProductGapRecord[]) => string;
  buildProductGapDetailReply: (item: ProductGapRecord) => string;
}

export interface CapabilityInspectionServiceDependencies {
  logger: Logger;
  capabilityPlanner: CapabilityInspectionPlanner;
  personalMemory: ProductGapStore;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: CapabilityInspectionHelpers;
}

export interface CapabilityInspectionInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  preferences: UserPreferences;
}

export class CapabilityInspectionService {
  constructor(private readonly deps: CapabilityInspectionServiceDependencies) {}

  tryRunInspection(input: CapabilityInspectionInput): AgentRunResult | null {
    if (!this.deps.capabilityPlanner.isCapabilityInspectionPrompt(input.userPrompt)) {
      return null;
    }

    const normalized = normalizeEmailAnalysisText(input.userPrompt);
    const wantsWhy = includesAny(normalized, [
      "por que voce nao conseguiu resolver isso",
      "por que você não conseguiu resolver isso",
    ]);
    const wantsGaps = includesAny(normalized, [
      "lacunas",
      "gaps",
      "melhorias sugeridas pelo uso",
    ]);
    const logger = this.deps.logger.child({ scope: "capability-inspection-service" });

    if (wantsWhy) {
      const latestGap = this.deps.personalMemory.listProductGaps({ limit: 1 })[0];
      logger.info("Inspecting latest product gap detail", {
        found: Boolean(latestGap),
        gapId: latestGap?.id,
      });
      return {
        requestId: input.requestId,
        reply: latestGap
          ? this.deps.helpers.buildProductGapDetailReply(latestGap)
          : "Ainda não tenho um gap recente registrado para te explicar.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: latestGap
          ? [
              {
                toolName: "product_gap.inspect",
                resultPreview: JSON.stringify({
                  id: latestGap.id,
                  objective: latestGap.inferredObjective,
                  missingCapabilities: latestGap.missingCapabilities,
                }),
              },
            ]
          : [],
      };
    }

    if (wantsGaps) {
      const gaps = this.deps.personalMemory.listProductGaps({ status: "open", limit: 12 });
      logger.info("Listing open product gaps", {
        total: gaps.length,
      });
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildProductGapsReply(gaps),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "product_gap.list",
            resultPreview: JSON.stringify({
              total: gaps.length,
              ids: gaps.slice(0, 10).map((item) => item.id),
            }),
          },
        ],
      };
    }

    const availability = this.deps.capabilityPlanner.listCapabilityAvailability();
    const constrained = availability.filter((item) => item.availability !== "available");
    logger.info("Listing capability availability constraints", {
      total: availability.length,
      constrained: constrained.length,
    });
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildCapabilityAvailabilityReply(availability),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "capability_registry.inspect",
          resultPreview: JSON.stringify({
            total: availability.length,
            constrained: constrained.slice(0, 10).map((item) => ({
              name: item.name,
              availability: item.availability,
            })),
          }),
        },
      ],
    };
  }
}
