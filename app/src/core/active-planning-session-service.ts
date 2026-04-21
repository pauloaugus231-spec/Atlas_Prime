import type { Logger } from "../types/logger.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";
import type { AgentRunOptions, AgentRunResult } from "./agent-core.js";
import {
  buildPlaceDiscoveryGoalFromPrompt,
  buildPlaceDiscoveryPrompt,
  buildTravelPlanningGoalFromPrompt,
  buildTravelPlanningPrompt,
  describePlaceDiscoveryGoal,
  describeTravelPlanningGoal,
  isActiveGoalCancellationPrompt,
  mergePlaceDiscoveryGoal,
  mergeTravelPlanningGoal,
  type ActivePlanningGoal,
  type TravelPlanningGoal,
} from "./active-goal-state.js";
import {
  buildBaseMessages,
  buildCapabilityPlanUserDataReply,
} from "./agent-core-helpers.js";
import { interpretConversationTurn } from "./conversation-interpreter.js";
import {
  looksLikeCapabilityAwarePlacePrompt,
  looksLikeCapabilityAwareTravelPrompt,
  type CapabilityPlan,
  type CapabilityPlanner,
} from "./capability-planner.js";
import type { ExternalIntelligenceDirectService } from "./external-intelligence-direct-service.js";
import type { CapabilityActionService } from "./capability-action-service.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";

export interface ActivePlanningSessionServiceDependencies {
  capabilityPlanner: CapabilityPlanner;
  personalMemory: PersonalOperationalMemoryStore;
  getExternalIntelligenceDirectService: () => Pick<
    ExternalIntelligenceDirectService,
    "executeWebResearch" | "executeMapsRoutePlan" | "executeMapsPlacesSearchPlan"
  >;
  getCapabilityActionService: () => Pick<CapabilityActionService, "executePlanAction">;
}

export class ActivePlanningSessionService {
  private readonly activeGoals = new Map<string, ActivePlanningGoal>();

  constructor(private readonly deps: ActivePlanningSessionServiceDependencies) {}

  shouldBypassClarification(userPrompt: string, options?: AgentRunOptions): boolean {
    if (this.deps.capabilityPlanner.isPlanningCandidate(userPrompt)) {
      return true;
    }

    const activeGoal = this.getActiveGoal(options?.chatId);
    if (!activeGoal) {
      return false;
    }

    if (isActiveGoalCancellationPrompt(userPrompt)) {
      return true;
    }

    const merged = activeGoal.kind === "travel_planning"
      ? (() => {
          const result = mergeTravelPlanningGoal(activeGoal, userPrompt);
          return {
            ...result,
            goal: this.applyProfileTravelDefaults(result.goal),
          };
        })()
      : mergePlaceDiscoveryGoal(activeGoal, userPrompt);
    if (merged.hasMeaningfulUpdate) {
      return true;
    }
    const interpreted = interpretConversationTurn({ text: userPrompt });
    return !interpreted.isTopLevelRequest;
  }

  clearChatState(chatId?: string | number): void {
    if (chatId === undefined || chatId === null) {
      return;
    }
    this.activeGoals.delete(String(chatId));
  }

  buildActiveGoalUserDataReply(goal: ActivePlanningGoal, plan: CapabilityPlan): string {
    if (goal.kind === "place_discovery") {
      const known = describePlaceDiscoveryGoal(goal);
      const missing = plan.missingUserData.join(" e ");
      if (known.length === 0) {
        return buildCapabilityPlanUserDataReply(plan);
      }
      return `Já peguei ${known.join(", ")}. Agora só falta ${missing}.`;
    }

    const known = describeTravelPlanningGoal(goal);
    const missing = plan.missingUserData.join(" e ");
    if (known.length === 0) {
      return buildCapabilityPlanUserDataReply(plan);
    }
    return `Já peguei ${known.join(", ")}. Agora só falta ${missing}.`;
  }

  async tryRunActiveGoalTurn(input: {
    userPrompt: string;
    requestId: string;
    requestLogger: Logger;
    orchestration: OrchestrationContext;
    preferences: UserPreferences;
    options?: AgentRunOptions;
  }): Promise<AgentRunResult | null> {
    const activeGoal = this.getActiveGoal(input.options?.chatId);
    if (!activeGoal) {
      return null;
    }

    if (isActiveGoalCancellationPrompt(input.userPrompt)) {
      this.clearChatState(input.options?.chatId);
      return {
        requestId: input.requestId,
        reply: activeGoal.kind === "travel_planning"
          ? "Certo, descartei essa estimativa de viagem. Pode mandar o próximo pedido."
          : "Certo, descartei essa busca de lugares. Pode mandar o próximo pedido.",
        messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const interpreted = interpretConversationTurn({ text: input.userPrompt });
    const promptLooksCompatible = activeGoal.kind === "travel_planning"
      ? looksLikeCapabilityAwareTravelPrompt(input.userPrompt)
      : looksLikeCapabilityAwarePlacePrompt(input.userPrompt);
    const merged = activeGoal.kind === "travel_planning"
      ? (() => {
          const result = mergeTravelPlanningGoal(activeGoal, input.userPrompt);
          return {
            ...result,
            goal: this.applyProfileTravelDefaults(result.goal),
          };
        })()
      : mergePlaceDiscoveryGoal(activeGoal, input.userPrompt);

    if (!merged.hasMeaningfulUpdate && !promptLooksCompatible && interpreted.isTopLevelRequest) {
      input.requestLogger.info("Clearing active goal due to clear topic shift", {
        chatId: input.options?.chatId,
        intent: interpreted.intent,
        skill: interpreted.skill,
        kind: activeGoal.kind,
      });
      this.clearChatState(input.options?.chatId);
      return null;
    }

    if (!merged.hasMeaningfulUpdate && !promptLooksCompatible && !interpreted.isShortConfirmation) {
      return null;
    }

    if (input.options?.chatId !== undefined) {
      this.setActiveGoal(input.options.chatId, merged.goal);
    }

    const planningPrompt = merged.goal.kind === "travel_planning"
      ? buildTravelPlanningPrompt(merged.goal)
      : buildPlaceDiscoveryPrompt(merged.goal);
    const plan = this.deps.capabilityPlanner.plan(planningPrompt, interpreted);
    if (!plan) {
      return null;
    }

    input.requestLogger.info("Continuing active planning goal", {
      chatId: input.options?.chatId,
      objective: merged.goal.objective,
      kind: merged.goal.kind,
      changedKeys: merged.changedKeys,
      suggestedAction: plan.suggestedAction,
      missingUserData: plan.missingUserData,
    });

    return this.executeCapabilityPlan({
      userPrompt: planningPrompt,
      requestId: input.requestId,
      requestLogger: input.requestLogger,
      orchestration: input.orchestration,
      preferences: input.preferences,
      plan,
      relatedSkill: interpreted.skill,
      activeGoal: merged.goal,
      activeGoalChatId: input.options?.chatId,
    });
  }

  async tryRunCapabilityAwarePlanning(input: {
    userPrompt: string;
    requestId: string;
    requestLogger: Logger;
    orchestration: OrchestrationContext;
    preferences: UserPreferences;
    options?: AgentRunOptions;
  }): Promise<AgentRunResult | null> {
    if (!this.deps.capabilityPlanner.isPlanningCandidate(input.userPrompt)) {
      return null;
    }

    const interpreted = interpretConversationTurn({
      text: input.userPrompt,
      operationalMode: this.deps.personalMemory.getOperationalState().mode,
    });
    let effectivePrompt = input.userPrompt;
    let activeGoal: ActivePlanningGoal | undefined;
    const rawSeededGoal = buildTravelPlanningGoalFromPrompt(input.userPrompt) ?? buildPlaceDiscoveryGoalFromPrompt(input.userPrompt);
    const seededGoal = rawSeededGoal?.kind === "travel_planning"
      ? this.applyProfileTravelDefaults(rawSeededGoal)
      : rawSeededGoal;
    if (seededGoal) {
      activeGoal = seededGoal;
      if (input.options?.chatId !== undefined) {
        this.setActiveGoal(input.options.chatId, seededGoal);
      }
      effectivePrompt = seededGoal.kind === "travel_planning"
        ? buildTravelPlanningPrompt(seededGoal)
        : buildPlaceDiscoveryPrompt(seededGoal);
    }

    const plan = this.deps.capabilityPlanner.plan(effectivePrompt, interpreted);
    if (!plan) {
      return null;
    }

    input.requestLogger.info("Using direct capability planning route", {
      objective: plan.objective,
      suggestedAction: plan.suggestedAction,
      prompt: effectivePrompt,
      missingRequirements: plan.missingRequirements.map((item) => ({
        name: item.name,
        kind: item.kind,
      })),
      missingUserData: plan.missingUserData,
    });

    return this.executeCapabilityPlan({
      userPrompt: effectivePrompt,
      requestId: input.requestId,
      requestLogger: input.requestLogger,
      orchestration: input.orchestration,
      preferences: input.preferences,
      plan,
      relatedSkill: interpreted.skill,
      activeGoal,
      activeGoalChatId: activeGoal ? input.options?.chatId : undefined,
    });
  }

  private getActiveGoal(chatId?: string | number): ActivePlanningGoal | undefined {
    if (chatId === undefined || chatId === null) {
      return undefined;
    }
    return this.activeGoals.get(String(chatId));
  }

  private setActiveGoal(chatId: string | number, goal: ActivePlanningGoal): void {
    this.activeGoals.set(String(chatId), goal);
  }

  private applyProfileTravelDefaults(goal: TravelPlanningGoal): TravelPlanningGoal {
    const profile = this.deps.personalMemory.getProfile();
    const homeAddress = profile.homeAddress?.trim();
    const normalizePlace = (value: string | undefined): string =>
      normalizeEmailAnalysisText(value ?? "").replace(/\s+/g, " ").trim();
    const isHomeAlias = (value: string | undefined): boolean => {
      const normalized = normalizePlace(value);
      return [
        "casa",
        "minha casa",
        "de casa",
        "meu endereco",
        "meu endereço",
        normalizePlace(profile.homeLocationLabel),
      ].filter(Boolean).includes(normalized);
    };
    const promptMentionsHomeOrigin = /\b(?:sair|saindo|sairei|partir|partindo|vou sair)\s+(?:de|da)\s+casa\b/i.test(goal.lastPrompt)
      || /\bde\s+casa\b/i.test(goal.lastPrompt);

    const origin = homeAddress && (isHomeAlias(goal.origin) || (!goal.origin && promptMentionsHomeOrigin))
      ? homeAddress
      : goal.origin;
    const destination = homeAddress && isHomeAlias(goal.destination)
      ? homeAddress
      : goal.destination;
    const vehicle = goal.vehicle ?? profile.defaultVehicle?.name;
    const consumptionKmPerLiter = goal.consumptionKmPerLiter ?? profile.defaultVehicle?.consumptionKmPerLiter;
    const fuelPricePerLiter = goal.fuelPricePerLiter ?? profile.defaultFuelPricePerLiter;

    return {
      ...goal,
      origin,
      destination,
      vehicle,
      consumptionKmPerLiter,
      fuelPricePerLiter,
    };
  }

  private async executeCapabilityPlan(input: {
    userPrompt: string;
    requestId: string;
    requestLogger: Logger;
    orchestration: OrchestrationContext;
    preferences: UserPreferences;
    plan: CapabilityPlan;
    relatedSkill?: string;
    activeGoal?: ActivePlanningGoal;
    activeGoalChatId?: string | number;
  }): Promise<AgentRunResult | null> {
    const { plan } = input;

    if (plan.suggestedAction === "run_web_search") {
      return this.deps.getExternalIntelligenceDirectService().executeWebResearch({
        userPrompt: input.userPrompt,
        query: plan.webQuery ?? input.userPrompt,
        requestId: input.requestId,
        requestLogger: input.requestLogger,
        orchestration: input.orchestration,
        researchMode: plan.researchMode ?? "executive",
        preferences: input.preferences,
      });
    }

    if (plan.suggestedAction === "run_maps_route") {
      const result = await this.deps.getExternalIntelligenceDirectService().executeMapsRoutePlan({
        userPrompt: input.userPrompt,
        requestId: input.requestId,
        requestLogger: input.requestLogger,
        orchestration: input.orchestration,
        preferences: input.preferences,
        plan,
      });
      if (result && input.activeGoalChatId !== undefined) {
        this.clearChatState(input.activeGoalChatId);
      }
      return result;
    }

    if (plan.suggestedAction === "run_maps_places_search") {
      const result = await this.deps.getExternalIntelligenceDirectService().executeMapsPlacesSearchPlan({
        userPrompt: input.userPrompt,
        requestId: input.requestId,
        requestLogger: input.requestLogger,
        orchestration: input.orchestration,
        preferences: input.preferences,
        plan,
      });
      if (result && input.activeGoalChatId !== undefined) {
        this.clearChatState(input.activeGoalChatId);
      }
      return result;
    }

    const actionResult = this.deps.getCapabilityActionService().executePlanAction({
      userPrompt: input.userPrompt,
      requestId: input.requestId,
      requestLogger: input.requestLogger,
      orchestration: input.orchestration,
      preferences: input.preferences,
      plan,
      relatedSkill: input.relatedSkill,
      activeGoal: input.activeGoal,
    });
    if (!actionResult) {
      return null;
    }
    if (actionResult.shouldClearChatState && input.activeGoalChatId !== undefined) {
      this.clearChatState(input.activeGoalChatId);
    }
    return actionResult.runResult;
  }
}
