import type { AppConfig } from "../types/config.js";
import type { Logger } from "../types/logger.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { ExternalReasoningRequest } from "../types/external-reasoning.js";
import type { AgentRunOptions, AgentRunResult } from "./agent-core.js";
import type { IntentResolution } from "./intent-router.js";
import type { ContextPackService } from "./context-pack.js";
import type { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import type { ExternalReasoningClient } from "../integrations/external-reasoning/external-reasoning-client.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import {
  buildBaseMessages,
  includesAny,
  resolveEffectiveOperationalMode,
  rewriteConversationalSimpleReply,
  shouldBypassPreLocalExternalReasoningForPrompt,
  resolvePromptAccountAliases,
} from "./agent-core-helpers.js";
import {
  selectRelevantLearnedPreferences,
  summarizeIdentityProfileForReasoning,
  summarizeOperationalStateForReasoning,
} from "./personal-context-summary.js";
import { shouldAttemptExternalReasoning, type ExternalReasoningStage } from "./external-reasoning-policy.js";

export interface ExternalReasoningRunnerDependencies {
  config: AppConfig;
  contextPacks: ContextPackService;
  externalReasoning: ExternalReasoningClient;
  personalMemory: PersonalOperationalMemoryStore;
  googleWorkspaces: GoogleWorkspaceAccountsService;
  logger: Logger;
}

export class ExternalReasoningRunner {
  constructor(private readonly deps: ExternalReasoningRunnerDependencies) {}

  async tryRunPreLocal(input: {
    activeUserPrompt: string;
    requestId: string;
    requestLogger: Logger;
    intent: IntentResolution;
    preferences: UserPreferences;
    options?: AgentRunOptions;
  }): Promise<AgentRunResult | null> {
    const shouldBypassPreLocalExternalReasoning = shouldBypassPreLocalExternalReasoningForPrompt(
      input.activeUserPrompt,
      input.intent,
    );
    if (shouldBypassPreLocalExternalReasoning) {
      input.requestLogger.info("Skipping external reasoning for direct local context command", {
        mode: this.deps.config.externalReasoning.mode,
      });
      return null;
    }

    return this.tryRun({
      userPrompt: input.activeUserPrompt,
      requestId: input.requestId,
      requestLogger: input.requestLogger,
      intent: input.intent,
      preferences: input.preferences,
      options: input.options,
      stage: "pre_local",
    });
  }

  async tryRun(input: {
    userPrompt: string;
    requestId: string;
    requestLogger: Logger;
    intent: IntentResolution;
    preferences: UserPreferences;
    options?: AgentRunOptions;
    stage?: ExternalReasoningStage;
  }): Promise<AgentRunResult | null> {
    const stage = input.stage ?? "post_direct_routes";
    if (!shouldAttemptExternalReasoning(this.deps.config.externalReasoning, input.userPrompt, input.intent, stage)) {
      return null;
    }

    input.requestLogger.info("Trying external reasoning provider", {
      mode: this.deps.config.externalReasoning.mode,
      stage,
      primaryDomain: input.intent.orchestration.route.primaryDomain,
      actionMode: input.intent.orchestration.route.actionMode,
      compoundIntent: input.intent.compoundIntent,
    });

    try {
      const contextPack = await this.deps.contextPacks.buildForPrompt(input.userPrompt, input.intent);
      const request = await this.buildRequest(
        input.userPrompt,
        input.intent,
        input.preferences,
        contextPack,
        input.options,
      );
      const response = await this.deps.externalReasoning.reason(request);
      input.requestLogger.info("External reasoning completed", {
        mode: this.deps.config.externalReasoning.mode,
        stage,
        responseKind: response.kind,
      });
      input.requestLogger.info(
        response.kind === "assistant_decision"
          ? "External reasoning assistant_decision accepted"
          : "External reasoning text response accepted",
        {
          mode: this.deps.config.externalReasoning.mode,
          stage,
        },
      );
      const personalProfile = this.deps.personalMemory.getProfile();
      const operationalMode = resolveEffectiveOperationalMode(input.userPrompt, personalProfile);

      return {
        requestId: input.requestId,
        reply: rewriteConversationalSimpleReply(input.userPrompt, response.content, {
          profile: personalProfile,
          operationalMode,
        }),
        messages: buildBaseMessages(input.userPrompt, input.intent.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "external_reasoning",
            resultPreview: JSON.stringify(
              {
                kind: response.kind,
                primaryDomain: input.intent.orchestration.route.primaryDomain,
                actionMode: input.intent.orchestration.route.actionMode,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      input.requestLogger.warn("External reasoning failed; falling back to local flow", {
        mode: this.deps.config.externalReasoning.mode,
        stage,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async buildRequest(
    userPrompt: string,
    intent: IntentResolution,
    preferences: UserPreferences,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
    options?: AgentRunOptions,
  ): Promise<ExternalReasoningRequest> {
    const personalProfile = this.deps.personalMemory.getProfile();
    const operationalState = this.deps.personalMemory.getOperationalState();
    const briefEvents = (contextPack?.brief?.events ?? [])
      .slice(0, 6)
      .flatMap((event) => {
        if (!event.start) {
          return [];
        }
        return [{
          summary: event.summary,
          start: event.start,
          ...(event.location ? { location: event.location } : {}),
          ...(event.account ? { account: event.account } : {}),
        }];
      });

    const memorySignals = contextPack?.signals.filter((signal) =>
      includesAny(signal.toLowerCase(), ["approval", "workflow", "memoria", "memória", "email", "tarefa", "clima"])
    ) ?? [];
    const personalSignals = [
      ...personalProfile.savedFocus.map((item) => `foco salvo: ${item}`),
      ...personalProfile.routineAnchors.map((item) => `rotina: ${item}`),
      ...personalProfile.operationalRules.map((item) => `regra operacional: ${item}`),
    ].slice(0, 8);
    const relevantLearnedPreferences = selectRelevantLearnedPreferences(
      userPrompt,
      this.deps.personalMemory.listLearnedPreferences({
        activeOnly: true,
        limit: 12,
      }),
      4,
    );
    const tasksContext = await this.buildTasksContext(userPrompt, intent, contextPack);
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, personalProfile);

    return {
      user_message: userPrompt,
      ...(options?.chatId !== undefined ? { chat_id: String(options.chatId) } : {}),
      intent: {
        primary_domain: intent.orchestration.route.primaryDomain,
        secondary_domains: intent.orchestration.route.secondaryDomains,
        mentioned_domains: intent.mentionedDomains,
        action_mode: intent.orchestration.route.actionMode,
        confidence: intent.orchestration.route.confidence,
        compound: intent.compoundIntent,
      },
      context: {
        signals: contextPack?.signals ?? [],
        ...(briefEvents.length > 0
          ? {
              calendar: {
                timezone: this.deps.config.google.defaultTimezone,
                events: briefEvents,
              },
            }
          : {}),
        ...(memorySignals.length > 0 ? { memory: memorySignals } : {}),
        ...(personalSignals.length > 0 ? { personal: personalSignals } : {}),
        personal_profile: summarizeIdentityProfileForReasoning(personalProfile),
        operational_state: summarizeOperationalStateForReasoning(operationalState),
        ...(relevantLearnedPreferences.length > 0
          ? {
              learned_preferences: relevantLearnedPreferences.map((item) => ({
                type: item.type,
                description: item.description,
                value: item.value,
                confidence: item.confidence,
                confirmations: item.confirmations,
              })),
            }
          : {}),
        ...(operationalMode ? { operational_mode: operationalMode } : {}),
        ...(tasksContext ? { tasks: tasksContext } : {}),
        preferences: {
          response_style: preferences.responseStyle,
          response_length: preferences.responseLength,
          proactive_next_step: preferences.proactiveNextStep,
        },
        recent_messages: intent.historyUserTurns.slice(-6),
      },
    };
  }

  private shouldAttachTasksContext(
    userPrompt: string,
    intent: IntentResolution,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
  ): boolean {
    const normalizedPrompt = normalizeEmailAnalysisText(userPrompt);
    if (includesAny(normalizedPrompt, [
      "taref",
      "google tasks",
      "task",
      "penden",
      "lembrete",
      "concluir",
      "finalizar",
      "follow up",
    ])) {
      return true;
    }

    if ((contextPack?.signals ?? []).some((signal) =>
      includesAny(normalizeEmailAnalysisText(signal), ["taref", "google tasks", "task", "penden"])
    )) {
      return true;
    }

    return intent.orchestration.route.primaryDomain === "secretario_operacional"
      && ["plan", "analyze", "execute"].includes(intent.orchestration.route.actionMode);
  }

  private async buildTasksContext(
    userPrompt: string,
    intent: IntentResolution,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
  ): Promise<ExternalReasoningRequest["context"]["tasks"] | undefined> {
    if (!this.shouldAttachTasksContext(userPrompt, intent, contextPack)) {
      return undefined;
    }

    const candidateAliases = resolvePromptAccountAliases(userPrompt, this.deps.googleWorkspaces.getAliases());
    const lists: NonNullable<ExternalReasoningRequest["context"]["tasks"]>["lists"] = [];
    const items: NonNullable<ExternalReasoningRequest["context"]["tasks"]>["items"] = [];

    for (const alias of candidateAliases) {
      const workspace = this.deps.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) {
        continue;
      }

      try {
        const taskLists = await workspace.listTaskLists();
        lists.push(
          ...taskLists.slice(0, 3).map((taskList) => ({
            account: alias,
            id: taskList.id,
            title: taskList.title,
          })),
        );

        const tasks = await workspace.listTasks({
          maxResults: 4,
          showCompleted: false,
        });
        items.push(
          ...tasks.slice(0, 4).map((task) => ({
            account: alias,
            task_id: task.id,
            task_list_id: task.taskListId,
            task_list_title: task.taskListTitle,
            title: task.title,
            status: task.status,
            ...(task.due ? { due: task.due } : {}),
          })),
        );
      } catch (error) {
        this.deps.logger.debug("Skipping Google Tasks context for external reasoning", {
          account: alias,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (lists.length >= 6 && items.length >= 8) {
        break;
      }
    }

    if (lists.length === 0 && items.length === 0) {
      return undefined;
    }

    const recentFocus = intent.historyUserTurns
      .map((turn) => turn.trim())
      .filter((turn) => includesAny(normalizeEmailAnalysisText(turn), ["taref", "task", "penden", "concluir", "finalizar"]))
      .slice(-2);

    return {
      lists: lists.slice(0, 6),
      items: items.slice(0, 8),
      ...(recentFocus.length > 0 ? { recent_focus: recentFocus } : {}),
      guidance: [
        "For task create, include title.",
        "For task update/delete, include task_id and task_list_id when known.",
        "If only the task list title is known, you may include task_list_title.",
        "If only the current task title is known, you may include target_title.",
        "Never invent task_id or task_list_id. If uncertain, return text or should_execute=false.",
      ],
    };
  }
}
