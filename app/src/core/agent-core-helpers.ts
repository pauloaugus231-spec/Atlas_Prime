import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../types/config.js";
import type { LeadRecord } from "../types/growth-ops.js";
import type { ConversationMessage, LlmClient, LlmToolCall } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type {
  ContactPersona,
  ContactProfileRecord,
  ContactRelationship,
  UpsertContactProfileInput,
} from "../types/contact-intelligence.js";
import { FileAccessPolicy, type ReadableRootKey } from "./file-access-policy.js";
import { ContentOpsStore } from "./content-ops.js";
import { GrowthOpsStore } from "./growth-ops.js";
import type { FounderOpsSnapshot } from "./founder-ops.js";
import {
  adjustEventDraftFromInstruction,
  buildGoogleEventDeleteDraftReply,
  buildGoogleEventDeleteBatchDraftReply,
  buildEventDraftFromPrompt,
  buildGoogleEventDraftReply,
  buildGoogleEventUpdateDraftReply,
  buildGoogleTaskDraftReply,
  buildTaskDraftFromPrompt,
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
} from "./google-draft-utils.js";
import type {
  PendingGoogleEventDraft,
  PendingGoogleEventDeleteBatchDraft,
  PendingGoogleEventUpdateDraft,
} from "./google-draft-utils.js";
import { OperationalMemoryStore } from "./operational-memory.js";
import { PersonalOSService, type ExecutiveMorningBrief } from "./personal-os.js";
import { rankApprovals } from "./approval-priority.js";
import { ProjectOpsService } from "./project-ops.js";
import { ResponseOS } from "./response-os.js";
import { SafeExecService } from "./safe-exec.js";
import { WorkflowExecutionRuntime } from "./execution-runtime.js";
import { EntityLinker } from "./entity-linker.js";
import { IntentRouter, type IntentResolution } from "./intent-router.js";
import { AssistantActionDispatcher } from "./action-dispatcher.js";
import {
  ContextAssembler,
  type ContextBundle,
} from "./context-assembler.js";
import { ContextPackService } from "./context-pack.js";
import { MemoryEntityStore } from "./memory-entity-store.js";
import { WorkflowPlanBuilderService } from "./plan-builder.js";
import { ToolPluginRegistry } from "./plugin-registry.js";
import {
  ResponseSynthesizer,
  type ExecuteSynthesizedToolInput,
} from "./response-synthesizer.js";
import { SocialAssistantStore } from "./social-assistant.js";
import { UserPreferencesStore } from "./user-preferences.js";
import { WhatsAppMessageStore } from "./whatsapp-message-store.js";
import { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import { buildOrchestrationContext, buildOrchestrationSystemMessage } from "./orchestration.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { WeatherService } from "./weather-service.js";
import { ApprovalInboxStore } from "./approval-inbox.js";
import { BriefRenderer } from "./brief-renderer.js";
import { CommunicationRouter, ContactIntelligenceStore } from "./contact-intelligence.js";
import { isPersonallyRelevantCalendarEvent, matchPersonalCalendarTerms } from "./calendar-relevance.js";
import type { EmailMessageSummary, EmailReader } from "../integrations/email/email-reader.js";
import { EmailAccountsService } from "../integrations/email/email-accounts.js";
import { ExternalReasoningClient } from "../integrations/external-reasoning/external-reasoning-client.js";
import type { EmailWriter } from "../integrations/email/email-writer.js";
import {
  normalizeEmailAnalysisText,
  summarizeEmailForOperations,
  type EmailOperationalGroup,
  type EmailOperationalSummary,
} from "../integrations/email/email-analysis.js";
import {
  GoogleMapsService,
  type GooglePlaceLookupResult,
  type GoogleRouteLookupResult,
} from "../integrations/google/google-maps.js";
import type { CalendarListSummary, DailyOperationalBrief, TaskSummary } from "../integrations/google/google-workspace.js";
import { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import { PexelsMediaService, type PexelsVideoSuggestion } from "../integrations/media/pexels.js";
import { SupabaseMacCommandQueue } from "../integrations/supabase/mac-command-queue.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { MemoryEntityKind, MemoryEntityRecord } from "../types/memory-entities.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type {
  CreateWorkflowPlanInput,
  WorkflowArtifactRecord,
  WorkflowPlanRecord,
  WorkflowStepRecord,
} from "../types/workflow.js";
import { WebResearchService, type WebResearchMode } from "./web-research.js";
import { GoogleTrendsIntakeService, type GoogleTrendItem } from "./trend-intake.js";
import type { ExternalReasoningRequest } from "../types/external-reasoning.js";
import { analyzeCalendarInsights } from "./calendar-insights.js";
import { resolveCalendarEventReference } from "./calendar-event-resolution.js";
import {
  extractExplicitGoogleAccountAlias,
  resolveGoogleAccountAliasesForPrompt,
} from "./google-account-resolution.js";
import { resolveActionAutonomyRule } from "./action-autonomy-policy.js";
import { looksLikeLowFrictionReadPrompt } from "./clarification-rules.js";
import { interpretConversationTurn } from "./conversation-interpreter.js";
import { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";
import { GoalStore } from "./goal-store.js";
import {
  selectRelevantLearnedPreferences,
  summarizeIdentityProfileForReasoning,
  summarizeOperationalStateForReasoning,
} from "./personal-context-summary.js";
import {
  TurnPlanner,
} from "./turn-planner.js";
import {
  ReasoningEngine,
  type ReasoningTrace,
} from "./reasoning-engine.js";
import { UserModelTracker } from "./user-model-tracker.js";
import {
  DirectRouteRunner,
} from "./direct-route-runner.js";
import type {
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
  UpdatePersonalOperationalProfileInput,
} from "../types/personal-operational-memory.js";
import type { CreateLearnedPreferenceInput, LearnedPreference } from "../types/learned-preferences.js";
import type { OperationalState } from "../types/operational-state.js";
import type { ProductGapRecord } from "../types/product-gaps.js";
import { resolveStructuredTaskOperationPayload } from "./task-operation-resolution.js";
import { shouldAttemptExternalReasoning, type ExternalReasoningStage } from "./external-reasoning-policy.js";
import { CapabilityRegistry } from "./capability-registry.js";
import {
  CapabilityPlanner,
  looksLikeCapabilityAwarePlacePrompt,
  looksLikeCapabilityAwareTravelPrompt,
  looksLikeCapabilityAwareWebPrompt,
  looksLikeCapabilityInspectionPrompt,
  type CapabilityPlan,
} from "./capability-planner.js";
import type { CapabilityAvailabilityRecord } from "../types/capability.js";
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
  type TravelPlanningGoal,
  type ActivePlanningGoal,
} from "./active-goal-state.js";
import { MessagingDirectService } from "./messaging-direct-service.js";
import { GoogleWorkspaceDirectService } from "./google-workspace-direct-service.js";
import { ExternalIntelligenceDirectService } from "./external-intelligence-direct-service.js";
import { CapabilityActionService } from "./capability-action-service.js";
import { CapabilityInspectionService } from "./capability-inspection-service.js";
import { KnowledgeProjectDirectService } from "./knowledge-project-direct-service.js";
import { MemoryContactDirectService } from "./memory-contact-direct-service.js";
import { OperationalReviewDirectService } from "./operational-review-direct-service.js";
import { OperationalContextDirectService } from "./operational-context-direct-service.js";
import { WorkspaceMacDirectService } from "./workspace-mac-direct-service.js";
import { WorkflowDirectService } from "./workflow-direct-service.js";
import { ContentDirectService } from "./content-direct-service.js";
import { ContentGenerationDirectService } from "./content-generation-direct-service.js";
import { EmailDirectService } from "./email-direct-service.js";
import {
  AgentDirectRouteService,
  type AgentDirectRouteServiceDependencies,
} from "./agent-direct-route-service.js";
import { AgentDirectServiceRegistry } from "./agent-direct-service-registry.js";

import { labelAgendaScope, truncateBriefText, type InboxTriageItem } from "./calendar-email-brief-helpers.js";
import { resolveEffectiveOperationalMode } from "./generic-prompt-helpers.js";

// Legacy helpers extracted from agent-core.ts. Keep behavior unchanged while AgentCore is slimmed down.
export function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function slugifySegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function extractActiveUserPrompt(prompt: string): string {
  const marker = "Mensagem atual do usuário:";
  const index = prompt.lastIndexOf(marker);
  if (index === -1) {
    return prompt.trim();
  }

  const extracted = prompt.slice(index + marker.length).trim();
  return extracted || prompt.trim();
}

export function normalizeSyntheticArguments(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSyntheticArguments(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const metadataKeys = ["type", "description", "title", "default", "enum", "value"];
  const isSchemaWrappedValue =
    "value" in record &&
    keys.length > 1 &&
    keys.every((key) => metadataKeys.includes(key));

  if (isSchemaWrappedValue) {
    return normalizeSyntheticArguments(record.value);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, normalizeSyntheticArguments(item)]),
  );
}

export function extractSyntheticToolCalls(
  content: string,
  pluginRegistry: ToolPluginRegistry,
): LlmToolCall[] {
  const normalized = stripCodeFences(content);
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    const candidates: Array<{ name?: unknown; arguments?: unknown }> = [];

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          candidates.push({
            name: record.name ?? record.tool ?? record.tool_name,
            arguments: record.arguments ?? record.args ?? {},
          });
        }
      }
    } else if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.tool_calls)) {
        for (const item of record.tool_calls) {
          if (item && typeof item === "object") {
            const toolCallRecord = item as Record<string, unknown>;
            const fn =
              toolCallRecord.function && typeof toolCallRecord.function === "object"
                ? (toolCallRecord.function as Record<string, unknown>)
                : toolCallRecord;
            candidates.push({
              name: fn.name ?? toolCallRecord.name,
              arguments: fn.arguments ?? toolCallRecord.arguments ?? toolCallRecord.args ?? {},
            });
          }
        }
      } else {
        candidates.push({
          name: record.name ?? record.tool ?? record.tool_name,
          arguments: record.arguments ?? record.args ?? {},
        });
      }
    }

    return candidates
      .filter((candidate): candidate is { name: string; arguments: unknown } => {
        return typeof candidate.name === "string" && pluginRegistry.hasTool(candidate.name);
      })
      .map((candidate) => ({
        function: {
          name: candidate.name,
          arguments: normalizeSyntheticArguments(candidate.arguments),
        },
      }));
  } catch {
    return [];
  }
}

export * from "./generic-prompt-helpers.js";

export * from "./content-routing-helpers.js";

export * from "./workspace-project-helpers.js";

export * from "./calendar-email-brief-helpers.js";

export * from "./personal-context-reply-helpers.js";

export function inferIntentObjective(prompt: string, input: IntentResolution): string {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, ["aprovacoes", "aprovações", "approval"]) && includesAny(normalized, ["agenda", "compromissos", "meu dia"])) {
    return "revisar aprovações e reorganizar a agenda operacional";
  }
  if (includesAny(normalized, ["agenda", "compromissos", "calendario", "calendário"])) {
    return "organizar agenda e compromissos";
  }
  if (includesAny(normalized, ["aprovacoes", "aprovações", "approval"])) {
    return "revisar pendências que exigem aprovação";
  }
  if (input.orchestration.route.actionMode === "schedule") {
    return "agendar ou ajustar um compromisso";
  }
  if (input.orchestration.route.actionMode === "plan") {
    return "montar um plano operacional enxuto";
  }
  if (input.orchestration.route.actionMode === "analyze") {
    return "analisar o pedido e definir o melhor caminho";
  }
  return "executar o pedido com o domínio correto";
}

export function inferIntentNextStep(input: IntentResolution): string | undefined {
  switch (input.orchestration.route.actionMode) {
    case "plan":
      return "Posso transformar isso em um plano curto e priorizado agora.";
    case "schedule":
      return "Posso montar um rascunho de agenda e pedir sua confirmação.";
    case "communicate":
      return "Posso preparar um rascunho de resposta antes de enviar.";
    case "execute":
      return "Posso seguir para a execução assim que o contexto crítico estiver fechado.";
    case "monitor":
      return "Posso consolidar os sinais mais relevantes e devolver um resumo acionável.";
    default:
      return undefined;
  }
}

export function buildOperationalPlanContract(
  prompt: string,
  brief: ExecutiveMorningBrief,
  profile?: PersonalOperationalProfile,
): import("../types/response-contracts.js").OrganizationResponseContract {
  const normalized = normalizeEmailAnalysisText(prompt);
  const operationalMode = resolveEffectiveOperationalMode(prompt, profile);
  const currentSituation: string[] = [];
  const priorities: string[] = [];
  const actionPlan: string[] = [];
  const rankedApprovals = rankApprovals(brief.approvals);
  const pauloEvents = brief.events.filter((event) => event.owner === "paulo");
  const delegableEvents = brief.events.filter((event) => event.owner === "delegavel");
  const conflictEvents = pauloEvents.filter((event) => event.hasConflict);
  const nextPauloEvent = pauloEvents[0];
  const weatherToday = brief.weather?.days[0];
  const topApproval = rankedApprovals[0];
  const topEmail = brief.emails[0];
  const topOverdueTask = brief.taskBuckets.overdue[0];
  const topGoal = brief.activeGoals?.[0];

  if (brief.events.length > 0) {
    currentSituation.push(`${brief.events.length} compromisso(s) no dia`);
  }
  if (brief.goalSummary) {
    currentSituation.push(`objetivos ativos: ${brief.goalSummary.replace(/^Objetivos:\s*/i, "")}`);
  }
  if (nextPauloEvent) {
    currentSituation.push(`seu próximo compromisso: ${nextPauloEvent.summary}`);
  }
  if (delegableEvents.length > 0) {
    currentSituation.push(`${delegableEvents.length} compromisso(s) delegável(is)`);
  }
  if (conflictEvents.length > 0) {
    currentSituation.push(`${conflictEvents.length} conflito(s) de agenda para Paulo`);
  }
  if (topApproval) {
    currentSituation.push(`${brief.approvals.length} aprovação(ões) pendente(s)`);
  }
  if (brief.taskBuckets.overdue.length > 0) {
    currentSituation.push(`${brief.taskBuckets.overdue.length} tarefa(s) atrasada(s)`);
  }
  if (topEmail) {
    currentSituation.push(`email prioritário: ${topEmail.subject}`);
  }
  if (weatherToday) {
    currentSituation.push(`clima hoje: ${weatherToday.description.toLowerCase()} | ${weatherToday.tip}`);
  }
  if (brief.mobilityAlerts[0]) {
    currentSituation.push(`deslocamento: ${brief.mobilityAlerts[0]}`);
  }
  if (brief.conflictSummary.duplicates > 0) {
    currentSituation.push(`${brief.conflictSummary.duplicates} duplicidade(s) provável(is) na agenda`);
  }
  if (operationalMode === "field") {
    currentSituation.push("modo rua ativo neste chat");
  }

  if (conflictEvents[0]) {
    priorities.push(`resolver o conflito de agenda em ${conflictEvents[0].summary}`);
  }
  if (topGoal) {
    priorities.push(`proteger avanço do objetivo ativo: ${topGoal.title}`);
  }
  if (nextPauloEvent) {
    priorities.push(`${nextPauloEvent.prepHint} para ${nextPauloEvent.summary}`);
  }
  if (topApproval) {
    priorities.push(`revisar a aprovação mais urgente: ${topApproval.item.subject} (${topApproval.reason})`);
  }
  if (topOverdueTask) {
    priorities.push(`decidir a tarefa atrasada: ${topOverdueTask.title}`);
  }
  if (topEmail) {
    priorities.push(`validar se o email ${topEmail.subject} exige ação agora`);
  }
  if (brief.mobilityAlerts[0]) {
    priorities.push(`preparar operação externa com base em: ${brief.mobilityAlerts[0]}`);
  }
  if (operationalMode === "field") {
    priorities.push("responder curto e preservar deslocamento");
  }

  if (conflictEvents.length > 0) {
    actionPlan.push("resolver primeiro os conflitos da sua agenda para não travar o restante do dia");
  }
  if (topGoal) {
    actionPlan.push(`alinhar a execução de hoje ao objetivo ativo ${topGoal.title}`);
  }
  if (includesAny(normalized, ["aprovacoes", "aprovações", "approval"]) && topApproval) {
    actionPlan.push("revisar primeiro as aprovações que destravam hoje");
  }
  if (nextPauloEvent) {
    actionPlan.push(`${nextPauloEvent.prepHint} para ${nextPauloEvent.summary}`);
  }
  if (delegableEvents[0]) {
    actionPlan.push(`definir dono para ${delegableEvents[0].summary} e tirar isso do seu foco direto`);
  }
  if (topOverdueTask) {
    actionPlan.push("decidir as tarefas atrasadas antes de abrir novas frentes");
  }
  if (topEmail) {
    actionPlan.push(`validar se o email ${topEmail.subject} exige ação real ou pode esperar`);
  }
  if (brief.dayRecommendation) {
    actionPlan.push(brief.dayRecommendation);
  }
  if (operationalMode === "field") {
    actionPlan.push("evitar novas frentes e operar com checklist curto");
  }

  return {
    objective: inferIntentObjective(prompt, {
      rawPrompt: prompt,
      activeUserPrompt: prompt,
      historyUserTurns: [],
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          confidence: 1,
          actionMode: "plan",
          reasons: [],
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "observe_only",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: false,
            canDraftExternalReplies: false,
            canSendExternalReplies: false,
            canWriteWorkspace: false,
            canPersistMemory: false,
            canRunProjectTools: false,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
      mentionedDomains: [],
      compoundIntent: includesAny(normalized, [" e ", " junto "]),
    }),
    currentSituation,
    priorities,
    actionPlan,
    recommendedNextStep: conflictEvents[0]
      ? `Resolver o conflito envolvendo ${conflictEvents[0].summary}.`
      : nextPauloEvent
        ? `${nextPauloEvent.prepHint[0]?.toUpperCase() ?? ""}${nextPauloEvent.prepHint.slice(1)} para ${nextPauloEvent.summary}.`
        : topApproval
          ? `Decidir a aprovação ${topApproval.item.subject}.`
          : brief.dayRecommendation ?? brief.nextAction ?? actionPlan[0],
  };
}

export function shouldAutoCreateGoogleEvent(prompt: string, draft: PendingGoogleEventDraft, writeReady: boolean): boolean {
  if (!writeReady) {
    return false;
  }
  if ((draft.attendees?.length ?? 0) > 0 || draft.createMeet) {
    return false;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const explicitSelfCalendarRequest = includesAny(normalized, [
    "coloque no meu calendario",
    "coloca no meu calendario",
    "coloque na minha agenda",
    "coloca na minha agenda",
    "adicione no meu calendario",
    "adicione na minha agenda",
    "coloque um evento no meu calendario",
    "coloque um evento na minha agenda",
    "crie um evento no meu calendario",
    "crie um evento na minha agenda",
  ]);
  if (!explicitSelfCalendarRequest) {
    return false;
  }

  const hedged = includesAny(normalized, [
    "rascunho",
    "proponha",
    "sugira",
    "sugerir",
    "pode criar",
    "se der",
    "talvez",
  ]);
  return !hedged;
}

export function buildDirectGoogleEventCreateReply(rawResult: unknown, timeZone: string): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const event = record?.event && typeof record.event === "object"
    ? (record.event as Record<string, unknown>)
    : undefined;
  const account = typeof record?.account === "string" ? record.account : "primary";
  const lines = ["Evento criado no seu calendário."];
  if (typeof event?.summary === "string") {
    lines.push(`- Título: ${event.summary}`);
  }
  if (typeof event?.start === "string") {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(event.start));
    lines.push(`- Início: ${formatted}`);
  }
  if (typeof event?.end === "string") {
    const formatted = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(event.end));
    lines.push(`- Fim: ${formatted}`);
  }
  if (typeof event?.location === "string" && event.location.trim()) {
    lines.push(`- Local: ${event.location}`);
  }
  if (typeof event?.reminderMinutes === "number") {
    lines.push(`- Lembrete: ${event.reminderMinutes} min antes`);
  }
  lines.push(`- Conta: ${account}`);
  if (typeof event?.htmlLink === "string" && event.htmlLink.trim()) {
    lines.push(`- Link: ${event.htmlLink}`);
  }
  lines.push("Se quiser, eu também posso adicionar convidados ou Meet.");
  return lines.join("\n");
}

export * from "./workflow-reply-helpers.js";

export * from "./web-research-reply-helpers.js";

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatFollowUpDueLabel(value: string | null | undefined): string {
  if (!value) {
    return "sem data";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function classifyFollowUpBucket(lead: LeadRecord): "overdue" | "today" | "upcoming" | "unscheduled" | "later" {
  if (!lead.nextFollowUpAt) {
    return "unscheduled";
  }
  const followUpAt = new Date(lead.nextFollowUpAt);
  if (Number.isNaN(followUpAt.getTime())) {
    return "unscheduled";
  }
  const now = new Date();
  const sameDay = now.toDateString() === followUpAt.toDateString();
  const diffHours = (followUpAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (followUpAt.getTime() < now.getTime()) {
    return "overdue";
  }
  if (sameDay || diffHours <= 24) {
    return "today";
  }
  if (diffHours <= 24 * 7) {
    return "upcoming";
  }
  return "later";
}

export function buildRevenueScoreboardReply(input: {
  referenceMonth: string;
  totalProjected: number;
  totalWon: number;
  totalReceived: number;
  recurringProjected: number;
  recurringReceived: number;
  oneOffReceived: number;
  pipelineOpenValue: number;
  leadsByStatus: Array<{ status: string; total: number }>;
  upcomingFollowUps: Array<{ name: string; company: string | null; status: string; nextFollowUpAt: string | null }>;
}): string {
  const lines = [
    `Placar mensal de receita para ${input.referenceMonth}.`,
    `- Projetado: ${formatCurrency(input.totalProjected)}`,
    `- Ganhou/fechou: ${formatCurrency(input.totalWon)}`,
    `- Recebido: ${formatCurrency(input.totalReceived)}`,
    `- Recorrente projetado: ${formatCurrency(input.recurringProjected)}`,
    `- Recorrente recebido: ${formatCurrency(input.recurringReceived)}`,
    `- One-off recebido: ${formatCurrency(input.oneOffReceived)}`,
    `- Pipeline aberto estimado: ${formatCurrency(input.pipelineOpenValue)}`,
    "",
    "Leads por estágio:",
  ];

  if (input.leadsByStatus.length === 0) {
    lines.push("- Nenhum lead cadastrado.");
  } else {
    for (const item of input.leadsByStatus) {
      lines.push(`- ${item.status}: ${item.total}`);
    }
  }

  lines.push("", "Próximos follow-ups:");
  if (input.upcomingFollowUps.length === 0) {
    lines.push("- Nenhum follow-up agendado.");
  } else {
    for (const lead of input.upcomingFollowUps.slice(0, 6)) {
      lines.push(
        `- ${lead.name}${lead.company ? ` | ${lead.company}` : ""} | ${lead.status} | follow-up: ${lead.nextFollowUpAt ?? "(sem data)"}`,
      );
    }
  }

  return lines.join("\n");
}

export * from "./content-shortform-helpers.js";

export function buildInboxTriageReply(items: InboxTriageItem[], options: { unreadOnly: boolean; limit: number }): string {
  if (items.length === 0) {
    return options.unreadOnly
      ? "Triagem do inbox concluída. Não encontrei emails não lidos dentro da janela analisada."
      : "Triagem do inbox concluída. Não encontrei emails na janela analisada.";
  }

  const counts = {
    alta: items.filter((item) => item.priority === "alta").length,
    media: items.filter((item) => item.priority === "media").length,
    baixa: items.filter((item) => item.priority === "baixa").length,
  };

  const lines = [
    `Triagem do inbox concluída (${items.length} itens analisados, limite=${options.limit}).`,
    `- Alta: ${counts.alta}`,
    `- Média: ${counts.media}`,
    `- Baixa: ${counts.baixa}`,
    "",
    "Itens priorizados:",
  ];

  for (const item of items) {
    lines.push(`UID ${item.uid} | ${item.priority.toUpperCase()} | ${item.category}`);
    lines.push(`Assunto: ${item.subject}`);
    lines.push(`Remetente: ${item.from.join(", ") || "(desconhecido)"}`);
    lines.push(`Relação: ${item.relationship} | Persona: ${item.persona} | Política: ${item.policy}`);
    lines.push(`Status: ${item.status}`);
    lines.push(`Próxima ação: ${item.action}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

export * from "./base-message-helpers.js";
