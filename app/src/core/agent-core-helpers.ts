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

export function isEmailFocusedPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return [
    "email",
    "e-mail",
    "inbox",
    "caixa de entrada",
    "remetente",
    "assunto",
    "uid ",
    "uid=",
  ].some((token) => normalized.includes(token));
}

export function extractEmailUidFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/\buid(?:\s*=|\s+)?([a-z0-9_-]+)\b/i);
  if (!match) {
    return undefined;
  }
  return match[1]?.trim() || undefined;
}

export function isEmailDraftPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasExactTextIntent = /(?:use|envie|responda)\s+exatamente(?:\s+este|\s+esse|\s+o)?\s+texto/i.test(prompt);
  const hasDraftIntent = [
    "redija",
    "rascunho",
    "resposta",
    "responda",
    "escreva",
    "reply",
    "ajuste o rascunho",
    "ajuste a resposta",
  ].some((token) => normalized.includes(token));
  const hasNoSendIntent = [
    "não envie",
    "nao envie",
    "sem enviar",
    "não mandar",
    "nao mandar",
    "apenas redija",
    "só redija",
    "so redija",
  ].some((token) => normalized.includes(token));

  return (hasDraftIntent || hasExactTextIntent) && hasNoSendIntent && isEmailFocusedPrompt(prompt);
}

export function extractExactReplyBody(prompt: string): string | undefined {
  const match = prompt.match(
    /(?:use|envie|responda)\s+exatamente(?:\s+este|\s+esse|\s+o)?\s+texto\s*:?\s*([\s\S]+)$/i,
  );
  const body = match?.[1]
    ?.replace(/\bnao envie ainda\.?$/i, "")
    ?.replace(/\bnão envie ainda\.?$/i, "")
    ?.trim();
  return body ? body : undefined;
}

export function isEmailSummaryPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasSummaryIntent = [
    "resuma",
    "resumo",
    "resumir",
    "prioridade",
    "triagem",
    "ação",
    "acao",
    "exige ação",
    "exige acao",
    "próxima ação",
    "proxima acao",
    "me diga",
    "me entregue",
  ].some((token) => normalized.includes(token));

  return hasSummaryIntent && extractEmailUidFromPrompt(prompt) !== undefined;
}

export function isInboxTriagePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasTriageIntent = ["triagem", "triage", "classifique", "priorize", "prioridade", "organize", "executivo"].some((token) =>
    normalized.includes(token),
  );
  const hasInboxIntent = ["inbox", "caixa de entrada", "emails recentes", "emails nao lidos", "emails não lidos", "email principal"].some((token) =>
    normalized.includes(token),
  );
  return hasTriageIntent && hasInboxIntent;
}

export function isFollowUpReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasFollowUp = includesAny(normalized, ["follow-up", "follow up", "followup", "retorno", "retornos"]);
  const hasAction = includesAny(normalized, ["revise", "revisar", "organize", "organizar", "priorize", "priorizar", "mostre", "liste"]);
  return hasFollowUp && hasAction;
}

export function isNextCommitmentPrepPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "prepare meu proximo compromisso",
    "prepare meu próximo compromisso",
    "preparar meu proximo compromisso",
    "preparar meu próximo compromisso",
    "como me preparar para meu proximo compromisso",
    "como me preparar para meu próximo compromisso",
    "preparar o proximo compromisso",
    "preparar o próximo compromisso",
  ]);
}

export function isSupportReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasSupportIntent = includesAny(normalized, [
    "suporte",
    "ticket",
    "tickets",
    "fila de suporte",
    "fila de atendimento",
    "atendimento",
    "clientes",
  ]);
  const hasActionIntent = includesAny(normalized, [
    "revise",
    "revisar",
    "organize",
    "organizar",
    "priorize",
    "priorizar",
    "triagem",
    "triage",
    "fila",
    "responda",
    "responder",
    "mostre",
    "liste",
  ]);
  return hasSupportIntent && hasActionIntent;
}

export function isUrgentSupportSignal(value: string): boolean {
  const normalized = normalizeEmailAnalysisText(value);
  return includesAny(normalized, [
    "urgente",
    "hoje",
    "agora",
    "falha",
    "erro",
    "problema",
    "travado",
    "travou",
    "nao consigo",
    "não consigo",
    "bloqueado",
    "bloqueada",
    "sem acesso",
  ]);
}

export function extractSupportTheme(value: string): string | null {
  const normalized = normalizeEmailAnalysisText(value);
  if (!normalized) {
    return null;
  }
  if (includesAny(normalized, ["login", "acesso", "senha", "entrar"])) {
    return "acesso e login";
  }
  if (includesAny(normalized, ["pagamento", "cobranca", "cobrança", "boleto", "pix", "assinatura"])) {
    return "pagamento e cobrança";
  }
  if (includesAny(normalized, ["erro", "falha", "bug", "travado", "travou", "problema"])) {
    return "erro e instabilidade";
  }
  if (includesAny(normalized, ["duvida", "dúvida", "como", "onboarding", "configurar", "usar"])) {
    return "uso e onboarding";
  }
  if (includesAny(normalized, ["cancel", "reembolso", "reembols", "encerrar"])) {
    return "cancelamento e risco";
  }
  return "atendimento geral";
}

export function isOperationalBriefPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "brief diario",
    "brief diário",
    "meu dia",
    "como esta meu dia",
    "como está meu dia",
    "como ta meu dia",
    "como tá meu dia",
    "status do dia",
    "o que apareceu de importante",
    "o que tenho de importante",
    "agenda de hoje",
    "compromissos de hoje",
    "tarefas de hoje",
    "me de minha agenda",
    "me de meu brief",
  ].some((token) => normalized.includes(token));
}

export function isMorningBriefPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "morning briefing",
    "briefing da manha",
    "briefing da manhã",
    "brief matinal",
    "resumo da manha",
    "resumo da manhã",
    "me de o resumo da manha",
    "me de o resumo da manhã",
  ].some((token) => normalized.includes(token));
}

export function extractOperationalMode(prompt: string): "field" | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("modo_operacional=field")) {
    return "field";
  }
  return null;
}

export function resolveEffectiveOperationalMode(
  prompt: string,
  profile?: PersonalOperationalProfile,
): "field" | null {
  const explicit = extractOperationalMode(prompt);
  if (explicit) {
    return explicit;
  }
  return profile?.defaultOperationalMode === "field" ? "field" : null;
}

export function isMacQueueStatusPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("liste")) {
    return false;
  }
  return ["fila do mac", "worker do mac", "status do mac", "mac worker", "comandos do mac"].some((token) =>
    normalized.includes(token),
  );
}

export function isMacQueueListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return ["liste os comandos do mac", "liste a fila do mac", "comandos pendentes do mac", "fila pendente do mac"].some((token) =>
    normalized.includes(token),
  );
}

export function extractMacOpenApp(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const aliases: Array<[string, string]> = [
    ["vscode", "Visual Studio Code"],
    ["visual studio code", "Visual Studio Code"],
    ["chrome", "Google Chrome"],
    ["google chrome", "Google Chrome"],
    ["safari", "Safari"],
    ["telegram", "Telegram"],
    ["terminal", "Terminal"],
    ["finder", "Finder"],
    ["whatsapp", "WhatsApp"],
    ["notes", "Notes"],
    ["notas", "Notes"],
  ];

  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  for (const [alias, appName] of aliases) {
    if (normalized.includes(`abra o ${alias}`) || normalized.includes(`abrir o ${alias}`) || normalized.includes(`abrir ${alias}`) || normalized.includes(`abra ${alias}`)) {
      return appName;
    }
  }

  return undefined;
}

export function extractMacOpenUrl(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }
  const match = prompt.match(/https?:\/\/[^\s)]+/i);
  if (match) {
    return match[0];
  }

  const aliases: Array<[string, string]> = [
    ["gmail", "https://mail.google.com/"],
    ["google calendar", "https://calendar.google.com/"],
    ["agenda google", "https://calendar.google.com/"],
    ["agenda", "https://calendar.google.com/"],
    ["github", "https://github.com/"],
    ["supabase", "https://supabase.com/dashboard"],
    ["chatgpt", "https://chatgpt.com/"],
    ["whatsapp web", "https://web.whatsapp.com/"],
    ["telegram web", "https://web.telegram.org/"],
  ];

  for (const [alias, url] of aliases) {
    if (normalized.includes(`abra ${alias}`) || normalized.includes(`abrir ${alias}`) || normalized.includes(`abra o ${alias}`) || normalized.includes(`abrir o ${alias}`)) {
      return url;
    }
  }

  return undefined;
}

export function extractMacNotificationText(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const match = prompt.match(/(?:notifique|mostre uma notificacao|mostre uma notificação|exiba uma notificacao|exiba uma notificação).{0,20}?(?:que|com)\s+(.+)$/i);
  return match?.[1]?.trim();
}

export function extractMacProjectOpenAlias(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const match = prompt.match(/(?:abra|abrir)\s+(?:o\s+)?(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i);
  return match?.[1]?.trim();
}

export function extractMacProjectCommand(prompt: string): { argv: string[]; projectAlias: string } | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const patterns: Array<{ pattern: RegExp; argv: string[] }> = [
    { pattern: /(?:rode|execute)\s+git status\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["git", "status", "--short"] },
    { pattern: /(?:rode|execute)\s+git branch(?:\s+--show-current)?\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["git", "branch", "--show-current"] },
    { pattern: /(?:rode|execute)\s+npm run build\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["npm", "run", "build"] },
    { pattern: /(?:rode|execute)\s+npm run dev\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["npm", "run", "dev"] },
    { pattern: /(?:rode|execute)\s+npm test\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["npm", "test"] },
    { pattern: /(?:rode|execute)\s+pnpm build\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["pnpm", "build"] },
    { pattern: /(?:rode|execute)\s+pnpm dev\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["pnpm", "dev"] },
    { pattern: /(?:rode|execute)\s+pnpm test\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["pnpm", "test"] },
    { pattern: /(?:rode|execute)\s+yarn build\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["yarn", "build"] },
    { pattern: /(?:rode|execute)\s+yarn dev\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["yarn", "dev"] },
    { pattern: /(?:rode|execute)\s+yarn test\s+(?:no|na)\s+(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i, argv: ["yarn", "test"] },
  ];

  for (const entry of patterns) {
    const match = prompt.match(entry.pattern);
    if (match?.[1]?.trim()) {
      return {
        argv: entry.argv,
        projectAlias: match[1].trim(),
      };
    }
  }

  return undefined;
}

export function isGoogleTasksPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "tarefas do google",
      "tarefas google",
      "google tasks",
      "minhas tarefas",
      "tarefas abertas",
      "minhas tasks",
    ]) && !normalized.includes("brief")
  );
}

export function isGoogleContactsPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "procure o contato",
    "buscar contato",
    "busque o contato",
    "google contacts",
    "contato no google",
    "contatos do google",
  ]);
}

export function isGoogleCalendarsListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste os calendarios disponiveis",
    "liste os calendários disponíveis",
    "quais calendarios estao disponiveis",
    "quais calendários estão disponíveis",
    "liste meus calendarios",
    "liste meus calendários",
    "quais calendarios eu tenho",
    "quais calendários eu tenho",
    "listar calendarios",
    "listar calendários",
  ]);
}

export function isPlaceLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual endereco",
    "qual endereço",
    "endereco do",
    "endereço do",
    "endereco da",
    "endereço da",
    "localizacao de",
    "localização de",
    "onde fica",
    "procure no maps",
    "busque no maps",
    "google maps",
    "no maps",
  ]) && !normalized.includes("email") && !normalized.includes("e-mail");
}

export function extractPlaceLookupQuery(prompt: string): string | undefined {
  const patterns = [
    /(?:qual(?:\s+e| é)?\s+o\s+)?(?:endereco|endereço|localizacao|localização)\s+(?:do|da|de)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /(?:onde\s+fica)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /(?:procure|busque)\s+(?:no\s+)?(?:google\s+maps|maps)\s+(?:por\s+)?["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function extractGoogleContactsQuery(prompt: string): string | undefined {
  const explicitMatch = prompt.match(
    /(?:procure|buscar|busque)\s+(?:o\s+)?contato\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
  );
  if (explicitMatch?.[1]?.trim()) {
    return explicitMatch[1].trim();
  }

  const genericMatch = prompt.match(
    /(?:contato|contacts?)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
  );
  return genericMatch?.[1]?.trim();
}

export function isWebResearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasWebIntent = includesAny(normalized, [
    "pesquise",
    "na internet",
    "com fontes",
    "tendencia",
    "tendência",
    "valide",
    "estude",
    "pesquisa web",
    "pesquisa de mercado",
    "procure por",
    "buscar por",
    "busque por",
    "ache informacoes",
    "ache informações",
    "encontre informacoes",
    "encontre informações",
    "procure na internet",
    "busque na internet",
    "qual endereco",
    "qual endereço",
    "onde fica",
    "endereco do",
    "endereço do",
  ]);

  return (
    hasWebIntent &&
    !normalized.includes("email") &&
    !normalized.includes("e-mail") &&
    !normalized.includes("contato") &&
    !normalized.includes("contatos") &&
    !normalized.includes("previsao do tempo") &&
    !normalized.includes("previsão do tempo") &&
    !normalized.includes("clima ") &&
    !normalized.includes("temperatura ") &&
    !normalized.includes("vai chover") &&
    !normalized.includes("workspace") &&
    !normalized.includes("arquivo") &&
    !normalized.includes("pasta")
  );
}

export function isWeatherPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "previsao do tempo",
    "previsão do tempo",
    "clima em",
    "qual o clima",
    "como esta o clima",
    "como está o clima",
    "clima hoje",
    "clima agora",
    "clima amanha",
    "clima amanhã",
    "tempo em",
    "como esta o tempo",
    "como está o tempo",
    "tempo hoje",
    "tempo agora",
    "tempo amanha",
    "tempo amanhã",
    "temperatura em",
    "temperatura hoje",
    "vai chover em",
    "vai chover hoje",
    "vai chover amanha",
    "vai chover amanhã",
    "vai chover",
    "chuva em",
  ]);
}

export function isGreetingPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!normalized || isMorningBriefPrompt(prompt) || isOperationalBriefPrompt(prompt)) {
    return false;
  }

  return [
    /^oi(?:\s+atlas)?$/,
    /^ola(?:\s+atlas)?$/,
    /^olá(?:\s+atlas)?$/,
    /^bom dia(?:\s+atlas)?$/,
    /^boa tarde(?:\s+atlas)?$/,
    /^boa noite(?:\s+atlas)?$/,
    /^e ai(?:\s+atlas)?$/,
    /^hey(?:\s+atlas)?$/,
    /^tudo certo\??$/,
    /^tudo certo(?:\s+por ai|\s+por aí)?\??$/,
    /^como\s+(?:voce|você)\s+esta\??$/,
    /^como\s+esta\??$/,
    /^oi\s+atlas[, ]+como\s+(?:voce|você)\s+esta\??$/,
    /^oi\s+atlas[, ]+como\s+esta\??$/,
    /^atlas[, ]+como\s+(?:voce|você)\s+esta\??$/,
    /^atlas[, ]+como\s+esta\??$/,
  ].some((pattern) => pattern.test(normalized));
}

export function isAgentIdentityPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "como prefere ser chamado",
    "como voce prefere ser chamado",
    "como você prefere ser chamado",
    "qual seu nome",
    "como devo te chamar",
    "como posso te chamar",
  ]);
}

export function buildAgentIdentityReply(preferredAgentName = "Atlas"): string {
  return [
    `Pode me chamar de ${preferredAgentName}.`,
    "Se preferir algo mais direto, pode usar Agente.",
  ].join("\n");
}

export function extractFirstName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.split(/\s+/)[0];
}

export function buildGreetingReply(
  prompt: string,
  options?: {
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
  },
): string {
  const normalized = normalizeEmailAnalysisText(prompt);
  const firstName = extractFirstName(options?.profile?.displayName);
  const greetingName = firstName ? `, ${firstName}` : "";
  const compact = options?.operationalMode === "field";

  if (normalized.startsWith("bom dia")) {
    return compact
      ? `Bom dia${greetingName}. Diz o que precisa agora.`
      : `Bom dia${greetingName}. Como posso te ajudar hoje?`;
  }
  if (normalized.startsWith("boa tarde")) {
    return compact
      ? `Boa tarde${greetingName}. Diz o que precisa agora.`
      : `Boa tarde${greetingName}. Como posso te ajudar?`;
  }
  if (normalized.startsWith("boa noite")) {
    return compact
      ? `Boa noite${greetingName}. Diz o que precisa agora.`
      : `Boa noite${greetingName}. Como posso te ajudar?`;
  }
  if (normalized.includes("como") && (normalized.includes("esta") || normalized.includes("está"))) {
    return compact
      ? `Tudo certo por aqui${greetingName}. Diz o que tu precisa agora.`
      : `Estou bem${greetingName}. Em que posso te ajudar?`;
  }
  if (normalized.includes("tudo certo")) {
    return compact
      ? `Tudo certo por aqui${greetingName}. Diz o que precisa.`
      : `Tudo certo por aqui${greetingName}. O que tu precisa agora?`;
  }

  return compact
    ? `Estou online${greetingName}. Pode mandar o pedido.`
    : `Estou online${greetingName}. Em que posso te ajudar?`;
}

export function hasTechnicalSimpleReplyFraming(reply: string): boolean {
  return [
    "Conclusão",
    "Evidência essencial",
    "Lacuna / risco",
    "Próxima ação recomendada",
  ].some((token) => reply.includes(token));
}

export function extractConclusionLine(reply: string): string | undefined {
  const lines = reply
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const explicit = lines.find((line) => /^Conclus[aã]o\s+[—-]\s*/i.test(line));
  if (explicit) {
    return explicit.replace(/^Conclus[aã]o\s+[—-]\s*/i, "").trim();
  }

  return lines.find((line) =>
    !/^Evid[êe]ncia essencial/i.test(line)
    && !/^Lacuna \/ risco/i.test(line)
    && !/^Pr[oó]xima a[cç][aã]o recomendada/i.test(line)
  );
}

export function applyReasoningReplyPolicy(reply: string, reasoningTrace?: ReasoningTrace): string {
  if (!reasoningTrace) {
    return reply;
  }

  const lines = reply
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const shouldCompact =
    (reasoningTrace.energyHint === "low" && nonEmptyLines.length > 8)
    || (reasoningTrace.suggestedResponseStyle === "executive" && nonEmptyLines.length > 14);
  if (!shouldCompact) {
    return reply;
  }

  const limit = reasoningTrace.energyHint === "low" ? 8 : 12;
  const compact = nonEmptyLines.slice(0, limit).join("\n");
  return `${compact}\n\nPosso detalhar se quiser.`;
}

export function rewriteConversationalSimpleReply(
  prompt: string,
  reply: string,
  options?: {
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
    reasoningTrace?: ReasoningTrace;
  },
): string {
  const interpreted = interpretConversationTurn({
    text: prompt,
    operationalMode: options?.operationalMode === "field" ? "field" : "normal",
  });
  if (
    !["greeting", "weather", "briefing", "agenda", "tasks", "planning", "memory"].includes(interpreted.skill)
    || interpreted.confidence < 0.78
    || !hasTechnicalSimpleReplyFraming(reply)
  ) {
    return applyReasoningReplyPolicy(reply, options?.reasoningTrace);
  }

  if (interpreted.skill === "greeting") {
    return buildGreetingReply(prompt, options);
  }

  const conclusion = extractConclusionLine(reply);
  if (!conclusion) {
    return reply;
  }

  const normalized = conclusion.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return reply;
  }

  return applyReasoningReplyPolicy(
    /[.!?]$/.test(normalized) ? normalized : `${normalized}.`,
    options?.reasoningTrace,
  );
}

export function isConversationStyleCorrectionPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!normalized) {
    return false;
  }

  return includesAny(normalized, [
    "essa resposta está muito verbosa",
    "essa resposta esta muito verbosa",
    "essa resposta esta muito longa",
    "essa resposta está muito longa",
    "seja mais direto",
    "seja mais objetiva",
    "mais direto",
    "mais objetiva",
    "mais objetivo",
    "responda curto",
    "responde curto",
    "responda mais curto",
    "responda mais direto",
    "resposta mais curta",
    "nao precisa perguntar tanto",
    "não precisa perguntar tanto",
    "nao precisa perguntar muito",
    "não precisa perguntar muito",
    "pergunta menos",
    "menos perguntas",
  ]);
}

export function extractConversationStyleCorrection(
  prompt: string,
  current: PersonalOperationalProfile,
): {
  profileUpdate: UpdatePersonalOperationalProfileInput;
  preferenceUpdate: import("../types/user-preferences.js").UpdateUserPreferencesInput;
  learnedPreference: CreateLearnedPreferenceInput;
  reply: string;
} | null {
  if (!isConversationStyleCorrectionPrompt(prompt)) {
    return null;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const wantsShort = includesAny(normalized, [
    "muito verbosa",
    "muito longa",
    "mais direto",
    "mais objetiva",
    "mais objetivo",
    "responda curto",
    "responde curto",
    "responda mais curto",
    "responda mais direto",
    "resposta mais curta",
  ]);
  const wantsFewerQuestions = includesAny(normalized, [
    "nao precisa perguntar tanto",
    "não precisa perguntar tanto",
    "nao precisa perguntar muito",
    "não precisa perguntar muito",
    "pergunta menos",
    "menos perguntas",
  ]);

  const autonomyPreference = "leituras simples executam direto quando o contexto já basta";
  const profileUpdate: UpdatePersonalOperationalProfileInput = {
    responseStyle: wantsShort ? "direto e objetivo" : current.responseStyle,
    tonePreference: wantsShort ? "objetivo" : current.tonePreference,
    detailLevel: wantsShort ? "resumo" : current.detailLevel,
    briefingPreference: wantsShort ? "curto" : current.briefingPreference,
    autonomyPreferences: wantsFewerQuestions
      ? uniqueAppend(current.autonomyPreferences, [autonomyPreference])
      : current.autonomyPreferences,
  };

  const preferenceUpdate: import("../types/user-preferences.js").UpdateUserPreferencesInput = {
    responseStyle: "executive",
    responseLength: "short",
  };

  const learnedPreference: CreateLearnedPreferenceInput = wantsFewerQuestions
    ? {
        type: "response_style",
        key: "low_friction_simple_reads",
        description: "Preferência por respostas curtas e menos perguntas em pedidos simples",
        value: "responder curto e só perguntar quando faltar dado crítico",
        source: "correction",
        confidence: 0.84,
      }
    : {
        type: "response_style",
        key: "short_direct_replies",
        description: "Preferência por respostas curtas, diretas e mais resolutivas",
        value: "responder curto e direto",
        source: "correction",
        confidence: 0.8,
      };

  const reply = wantsFewerQuestions
    ? "Ajustado. Vou responder mais curto e direto, e só vou perguntar quando faltar algo realmente crítico."
    : "Ajustado. Vou responder mais curto e direto.";

  return {
    profileUpdate,
    preferenceUpdate,
    learnedPreference,
    reply,
  };
}

export function isMemoryUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, ["atualize o item", "atualizar o item", "update memory", "update_memory_item"]) &&
    normalized.includes("memoria")
  );
}

export function extractMemoryItemId(prompt: string): number | undefined {
  const match = prompt.match(/\bitem\s+(\d+)\b/i) ?? prompt.match(/\bid\s*[:=]?\s*(\d+)\b/i);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function hasMemoryUpdateFields(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "status",
    "prioridade",
    "priority",
    "titulo",
    "título",
    "title",
    "detalhes",
    "details",
    "projeto",
    "project",
    "tags",
    "horizon",
    "stage",
    "feito",
    "done",
    "open",
    "closed",
    "em andamento",
    "high",
    "medium",
    "low",
  ]);
}

export function isUserPreferencesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "modo executivo",
    "mais executivo",
    "mais detalhado",
    "mais detalhada",
    "mais investigativo",
    "modo investigativo",
    "modo secretario",
    "modo secretário",
    "me chame de",
    "prefiro que voce se chame",
    "quais sao minhas preferencias",
    "quais são minhas preferências",
    "minhas preferencias",
    "minhas preferências",
  ]);
}

export function isPersonalMemoryListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste minha memoria pessoal",
    "listar minha memoria pessoal",
    "mostre minha memoria pessoal",
    "mostrar minha memoria pessoal",
    "quais sao minhas memorias pessoais",
    "quais sao minhas regras pessoais",
    "quais sao minhas rotinas",
  ]);
}

export function isOperationalStateShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre meu estado operacional",
    "mostrar meu estado operacional",
    "meu estado operacional",
    "estado operacional atual",
    "como esta meu estado operacional",
    "como está meu estado operacional",
  ]);
}

export function isLearnedPreferencesListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "o que voce aprendeu sobre mim",
    "o que você aprendeu sobre mim",
    "o que voce aprendeu sobre minha agenda",
    "o que você aprendeu sobre minha agenda",
    "o que voce aprendeu com minhas correcoes",
    "o que você aprendeu com minhas correções",
    "liste aprendizados",
    "liste minhas preferencias aprendidas",
    "liste minhas preferências aprendidas",
    "liste preferencias aprendidas de agenda",
    "liste preferências aprendidas de agenda",
    "mostre minhas preferencias aprendidas",
    "mostre minhas preferências aprendidas",
    "aprendizados sobre mim",
  ]);
}

export function resolveLearnedPreferencesListFilter(prompt: string): {
  search?: string;
  type?: LearnedPreference["type"];
} {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, ["agenda", "calendario", "calendário", "importacao", "importação", "titulo", "título", "local"])) {
    return {
      search: "agenda",
    };
  }
  if (includesAny(normalized, ["alerta", "institucional", "whatsapp monitorado"])) {
    return {
      type: "alert_action",
    };
  }
  return {};
}

export function isLearnedPreferencesDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova essa preferencia",
    "remova essa preferência",
    "remova a preferencia aprendida",
    "remova a preferência aprendida",
    "desative a preferencia aprendida",
    "desative a preferência aprendida",
    "esqueca essa preferencia",
    "esqueca essa preferência",
  ]);
}

export function extractLearnedPreferenceId(prompt: string): number | undefined {
  const match = prompt.match(/#(\d{1,6})/);
  if (!match?.[1]) {
    return undefined;
  }
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : undefined;
}

export function extractLearnedPreferenceDeleteTarget(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:remova|desative|esqueca|esqueça)\s+(?:essa\s+)?(?:a\s+)?prefer[eê]ncia\s+aprendida\s*/i, "")
    .replace(/^\s*(?:remova|desative|esqueca|esqueça)\s+essa\s+prefer[eê]ncia\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  return cleaned || undefined;
}

export function isPersonalMemorySavePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const explicitMemoryIntent = includesAny(normalized, [
    "salve na minha memoria pessoal",
    "salve na memoria pessoal",
    "guarde na minha memoria pessoal",
    "guarde na memoria pessoal",
    "registre na minha memoria pessoal",
    "adicione na minha memoria pessoal",
  ]);
  const implicitOperationalMemoryIntent =
    (normalized.startsWith("salve que ") || normalized.startsWith("guarde que "))
    && includesAny(normalized, [
      "plantao",
      "plantão",
      "rotina",
      "resposta",
      "respostas curtas",
      "casaco",
      "carregador",
      "dois dias fora",
      "na rua",
      "deslocamento",
    ]);
  return explicitMemoryIntent || implicitOperationalMemoryIntent;
}

export function isPersonalMemoryUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "atualize minha memoria pessoal",
    "atualizar minha memoria pessoal",
    "edite minha memoria pessoal",
    "altere minha memoria pessoal",
    "altere a minha memoria pessoal",
  ]);
}

export function isPersonalMemoryDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova da minha memoria pessoal",
    "remover da minha memoria pessoal",
    "apague da minha memoria pessoal",
    "delete da minha memoria pessoal",
    "exclua da minha memoria pessoal",
  ]);
}

export function extractPersonalMemoryStatement(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:salve|guarde|registre|adicione)\s+(?:na\s+)?(?:minha\s+)?mem[oó]ria\s+pessoal\s*(?:que|:)?\s*/i, "")
    .replace(/^\s*(?:salve|guarde)\s+que\s*/i, "")
    .trim();
  return cleaned || undefined;
}

export function inferPersonalMemoryKind(statement: string): PersonalOperationalMemoryItemKind {
  const normalized = normalizeEmailAnalysisText(statement);
  if (includesAny(normalized, ["foco", "prioridade do dia"])) {
    return "focus";
  }
  if (includesAny(normalized, ["casaco", "carregador", "roupa", "guarda chuva", "guarda-chuva", "levar", "leve"])) {
    return "packing";
  }
  if (includesAny(normalized, ["plantao", "plantão", "rotina", "quando eu for", "quando eu estiver", "vou sair", "dois dias fora"])) {
    return "routine";
  }
  if (includesAny(normalized, ["respostas curtas", "resposta curta", "prefiro", "me responda", "tom", "estilo"])) {
    return "preference";
  }
  if (includesAny(normalized, ["regra", "sempre", "nunca", "devo"])) {
    return "rule";
  }
  if (includesAny(normalized, ["deslocamento", "na rua", "seas", "albergue", "trajeto"])) {
    return "mobility";
  }
  if (includesAny(normalized, ["agenda", "calendario", "calendário", "abordagem", "primary", "trabalho"])) {
    return "context";
  }
  return "note";
}

export function buildPersonalMemoryTitle(statement: string, kind: PersonalOperationalMemoryItemKind): string {
  const cleaned = statement
    .replace(/^que\s+/i, "")
    .replace(/^quando\s+/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  const compact = cleaned.length > 72 ? `${cleaned.slice(0, 69).trim()}...` : cleaned;
  if (compact) {
    return compact[0]?.toUpperCase() + compact.slice(1);
  }

  switch (kind) {
    case "focus":
      return "Foco operacional";
    case "packing":
      return "Itens e roupa";
    case "routine":
      return "Rotina operacional";
    case "preference":
      return "Preferência operacional";
    case "rule":
      return "Regra operacional";
    case "mobility":
      return "Deslocamento";
    case "context":
      return "Contexto pessoal";
    case "note":
    default:
      return "Nota operacional";
  }
}

export function isPersonalOperationalProfileShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre meu perfil operacional",
    "mostrar meu perfil operacional",
    "mostre meu perfil base",
    "mostrar meu perfil base",
    "mostre meu perfil pessoal operacional",
    "mostrar meu perfil pessoal operacional",
    "mostre meu perfil",
    "mostrar meu perfil",
    "liste meu perfil operacional",
  ]);
}

export function isPersonalOperationalProfileUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "defina meu estilo de resposta",
    "quero briefing mais",
    "salve que em plantao",
    "salve que em plantão",
    "salve que quando eu",
    "guarde que em plantao",
    "guarde que em plantão",
    "minha prioridade padrao",
    "minha prioridade padrão",
    "atualize meu perfil",
    "atualizar meu perfil",
    "ajuste meu perfil",
    "ajustar meu perfil",
    "onboarding",
    "configuracao inicial",
    "configuração inicial",
    "meu endereco",
    "meu endereço",
    "moro em",
    "minha casa fica",
    "meu carro",
    "meu veiculo",
    "meu veículo",
    "modo mais executivo",
    "modo mais humano",
    "modo mais firme",
    "modo mais acolhedor",
    "quero respostas muito curtas",
    "quero respostas curtas",
    "quero respostas mais curtas",
    "devo lembrar",
  ]);
}

export function isPersonalOperationalProfileDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova do meu perfil",
    "remove do meu perfil",
    "remover do meu perfil",
    "apague do meu perfil",
    "tire do meu perfil",
    "exclua do meu perfil",
  ]);
}

export function isDirectLocalContextCommandPrompt(prompt: string): boolean {
  return (
    isGreetingPrompt(prompt) ||
    isConversationStyleCorrectionPrompt(prompt) ||
    isWeatherPrompt(prompt) ||
    isMorningBriefPrompt(prompt) ||
    isOperationalBriefPrompt(prompt) ||
    isPersonalOperationalProfileShowPrompt(prompt) ||
    isPersonalOperationalProfileUpdatePrompt(prompt) ||
    isPersonalOperationalProfileDeletePrompt(prompt) ||
    isOperationalStateShowPrompt(prompt) ||
    isLearnedPreferencesListPrompt(prompt) ||
    isLearnedPreferencesDeletePrompt(prompt) ||
    isPersonalMemoryListPrompt(prompt) ||
    isPersonalMemorySavePrompt(prompt) ||
    isPersonalMemoryUpdatePrompt(prompt) ||
    isPersonalMemoryDeletePrompt(prompt) ||
    isUserPreferencesPrompt(prompt) ||
    isAgentIdentityPrompt(prompt) ||
    looksLikeCapabilityInspectionPrompt(prompt)
  );
}

export function shouldBypassPreLocalExternalReasoningForPrompt(
  prompt: string,
  intent?: IntentResolution,
): boolean {
  if (
    isGoogleEventCreatePrompt(prompt)
    || isGoogleTaskCreatePrompt(prompt)
    || isDirectLocalContextCommandPrompt(prompt)
    || looksLikeLowFrictionReadPrompt(prompt, intent)
    || looksLikeCapabilityAwareTravelPrompt(prompt)
    || looksLikeCapabilityAwareWebPrompt(prompt)
  ) {
    return true;
  }

  const interpreted = interpretConversationTurn({ text: prompt });
  if (interpreted.suggestedAction === "handoff") {
    return false;
  }

  if ([
    "greeting",
    "weather",
    "briefing",
    "agenda",
    "tasks",
    "memory",
    "planning",
    "visual_task",
  ].includes(interpreted.skill) && interpreted.confidence >= 0.78) {
    return true;
  }

  return interpreted.suggestedAction === "draft_then_confirm" && interpreted.confidence >= 0.8;
}

export function extractPersonalOperationalProfileRemoveQuery(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:remova|remove|remover|apague|tire|exclua)\s+do\s+meu\s+perfil\s*(?:a|o)?\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  return cleaned || undefined;
}

export function extractCarryItemsFromProfilePrompt(text: string): string[] {
  if (!/\b(?:levar|leve|levo|devo lembrar)\b/i.test(text)) {
    return [];
  }
  const normalized = text
    .replace(/^.*?\b(?:levar|leve|levo|devo lembrar)\b\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  if (!normalized) {
    return [];
  }

  return [...new Set(normalized
    .split(/,|\se\s|\s\+\s/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2))];
}

export function uniqueAppend(values: string[], additions: string[]): string[] {
  return [...new Set([...values, ...additions.map((item) => item.trim()).filter(Boolean)])];
}

export function removeMatchingEntries(values: string[], query: string): string[] {
  const normalizedQuery = normalizeEmailAnalysisText(query);
  return values.filter((item) => {
    const normalizedItem = normalizeEmailAnalysisText(item);
    return !normalizedItem.includes(normalizedQuery) && !normalizedQuery.includes(normalizedItem);
  });
}

export function normalizeTonePreferenceFromText(value: string): PersonalOperationalProfile["tonePreference"] | undefined {
  const normalized = normalizeEmailAnalysisText(value);
  if (includesAny(normalized, ["objetivo", "direto"])) {
    return "objetivo";
  }
  if (normalized.includes("humano")) {
    return "humano";
  }
  if (normalized.includes("firme")) {
    return "firme";
  }
  if (normalized.includes("acolhedor")) {
    return "acolhedor";
  }
  if (normalized.includes("executivo")) {
    return "executivo";
  }
  return undefined;
}

export function inferProfileResponseLength(
  briefingPreference: PersonalOperationalProfile["briefingPreference"] | undefined,
  detailLevel: PersonalOperationalProfile["detailLevel"] | undefined,
): import("../types/user-preferences.js").UpdateUserPreferencesInput["responseLength"] | undefined {
  if (briefingPreference === "detalhado" || detailLevel === "detalhado") {
    return "medium";
  }
  if (briefingPreference === "curto" || detailLevel === "resumo") {
    return "short";
  }
  return undefined;
}

export function extractPersonalOperationalProfileUpdate(
  prompt: string,
  current: PersonalOperationalProfile,
): {
  profile: UpdatePersonalOperationalProfileInput;
  preferenceUpdate?: import("../types/user-preferences.js").UpdateUserPreferencesInput;
  changeLabels: string[];
} | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  const profile: UpdatePersonalOperationalProfileInput = {};
  const preferenceUpdate: import("../types/user-preferences.js").UpdateUserPreferencesInput = {};
  const changeLabels: string[] = [];

  const styleMatch = prompt.match(/(?:estilo de resposta|meu estilo(?: de resposta)?)\s+(?:como\s+)?["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (styleMatch?.[1]?.trim()) {
    profile.responseStyle = styleMatch[1].trim();
    changeLabels.push(`estilo de resposta: ${profile.responseStyle}`);
  } else if (includesAny(normalized, ["direto e objetivo", "direto", "objetivo"])) {
    profile.responseStyle = "direto e objetivo";
    changeLabels.push(`estilo de resposta: ${profile.responseStyle}`);
  }

  const nameMatch = prompt.match(/(?:meu nome(?: no atlas)?(?: e| é)?|chame-me de)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (nameMatch?.[1]?.trim()) {
    profile.displayName = nameMatch[1].trim();
    changeLabels.push(`nome: ${profile.displayName}`);
  }

  const roleMatch = prompt.match(/(?:meu papel principal(?: e| é)?|minha ocupacao(?: principal)?(?: e| é)?|minha ocupação(?: principal)?(?: e| é)?)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (roleMatch?.[1]?.trim()) {
    profile.primaryRole = roleMatch[1].trim();
    changeLabels.push(`papel principal: ${profile.primaryRole}`);
  }

  const timezoneMatch = prompt.match(/(?:meu fuso(?: horario| horário)?(?: e| é)?|timezone(?: e| é)?)\s+([A-Za-z_\/+-]{3,64})/i);
  if (timezoneMatch?.[1]?.trim()) {
    profile.timezone = timezoneMatch[1].trim();
    changeLabels.push(`fuso: ${profile.timezone}`);
  }

  const homeAddressMatch = prompt.match(/(?:meu\s+endere[cç]o(?:\s+de\s+casa)?|moro\s+em|minha\s+casa\s+fica\s+em|saio\s+de\s+casa\s+(?:em|de))\s*(?:[ée]|:)?\s+(.+?)(?=(?:[.!?;]|$))/i);
  if (homeAddressMatch?.[1]?.trim()) {
    profile.homeAddress = homeAddressMatch[1].trim();
    profile.homeLocationLabel = "casa";
    changeLabels.push("endereço base: casa");
  }

  const vehicleMatch = prompt.match(/(?:meu\s+(?:carro|ve[ií]culo)|minha\s+moto)\s*(?:[ée]|:)?\s+(.+?)(?=(?:,|;|\.|$|\s+e\s+(?:faz|consome)|\s+com\s+consumo))/i);
  if (vehicleMatch?.[1]?.trim()) {
    profile.defaultVehicle = {
      ...(profile.defaultVehicle ?? {}),
      name: vehicleMatch[1].trim(),
    };
    changeLabels.push(`veículo padrão: ${profile.defaultVehicle.name}`);
  }

  const consumptionMatch = prompt.match(/\b(?:faz|consome|consumo(?: medio| médio)?(?: é| e)?|m[eé]dia(?: de)?)\s*(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i)
    ?? prompt.match(/\b(\d+(?:[.,]\d+)?)\s*(?:km\/l|km por litro)\b/i);
  if (consumptionMatch?.[1]) {
    const consumption = Number(consumptionMatch[1].replace(",", "."));
    if (Number.isFinite(consumption) && consumption > 0) {
      profile.defaultVehicle = {
        ...(profile.defaultVehicle ?? {}),
        consumptionKmPerLiter: consumption,
      };
      changeLabels.push(`consumo padrão: ${consumption.toFixed(1).replace(".", ",")} km/l`);
    }
  }

  const fuelType = normalized.includes("gasolina")
    ? "gasolina" as const
    : normalized.includes("etanol")
      ? "etanol" as const
      : normalized.includes("diesel")
        ? "diesel" as const
        : normalized.includes("flex")
          ? "flex" as const
          : undefined;
  if (fuelType) {
    profile.defaultVehicle = {
      ...(profile.defaultVehicle ?? {}),
      fuelType,
    };
    changeLabels.push(`combustível padrão: ${fuelType}`);
  }

  const fuelPriceMatch = prompt.match(/\b(?:gasolina|etanol|diesel|combust[ií]vel)\b.*?(?:r\$?\s*)?(\d+(?:[.,]\d+)?)/i);
  if (fuelPriceMatch?.[1]) {
    const price = Number(fuelPriceMatch[1].replace(",", "."));
    if (Number.isFinite(price) && price > 0) {
      profile.defaultFuelPricePerLiter = price;
      changeLabels.push(`preço de combustível padrão: R$ ${price.toFixed(2).replace(".", ",")}/l`);
    }
  }

  if (normalized.includes("telegram")) {
    profile.preferredChannels = uniqueAppend(current.preferredChannels, ["telegram"]);
  }
  if (normalized.includes("whatsapp")) {
    profile.preferredChannels = uniqueAppend(profile.preferredChannels ?? current.preferredChannels, ["whatsapp"]);
  }
  if (profile.preferredChannels?.length) {
    changeLabels.push(`canais preferidos: ${profile.preferredChannels.join(", ")}`);
  }

  const priorityAreasMatch = prompt.match(/(?:areas prioritarias|áreas prioritárias|prioridades principais)\s*(?::|sao|são|sao)\s+(.+?)(?=(?:[?.!,;:]|$))/i);
  if (priorityAreasMatch?.[1]?.trim()) {
    const areas = priorityAreasMatch[1].split(/,|\se\s/).map((item) => item.trim()).filter(Boolean);
    if (areas.length > 0) {
      profile.priorityAreas = uniqueAppend(current.priorityAreas, areas);
      changeLabels.push(`áreas prioritárias: ${areas.join(", ")}`);
    }
  }

  if (normalized.includes("briefing mais curto") || normalized.includes("briefing curto")) {
    profile.briefingPreference = "curto";
    profile.detailLevel = "resumo";
    changeLabels.push("briefing da manhã: curto");
  } else if (normalized.includes("briefing mais detalhado") || normalized.includes("briefing detalhado")) {
    profile.briefingPreference = "detalhado";
    profile.detailLevel = "detalhado";
    changeLabels.push("briefing da manhã: detalhado");
  } else if (normalized.includes("modo mais executivo") || normalized.includes("perfil mais executivo")) {
    profile.briefingPreference = "executivo";
    profile.tonePreference = "executivo";
    if (!profile.responseStyle) {
      profile.responseStyle = "executivo e direto";
    }
    changeLabels.push("perfil: executivo");
  }

  if (normalized.includes("mais detalhado") || normalized.includes("detalhado")) {
    profile.detailLevel = profile.detailLevel ?? "detalhado";
  }
  if (normalized.includes("modo resumo") || normalized.includes("nivel de detalhe resumo") || normalized.includes("nível de detalhe resumo")) {
    profile.detailLevel = "resumo";
    changeLabels.push("nível de detalhe: resumo");
  } else if (normalized.includes("nivel de detalhe equilibrado") || normalized.includes("nível de detalhe equilibrado")) {
    profile.detailLevel = "equilibrado";
    changeLabels.push("nível de detalhe: equilibrado");
  } else if (normalized.includes("nivel de detalhe detalhado") || normalized.includes("nível de detalhe detalhado")) {
    profile.detailLevel = "detalhado";
    changeLabels.push("nível de detalhe: detalhado");
  }

  const tonePreference = normalizeTonePreferenceFromText(prompt);
  if (tonePreference) {
    profile.tonePreference = tonePreference;
    changeLabels.push(`tom: ${tonePreference}`);
  }

  if (includesAny(normalized, [
    "plantao",
    "plantão",
    "na rua",
    "vou sair e so volto amanha",
    "vou sair e só volto amanhã",
  ])) {
    if (includesAny(normalized, ["respostas muito curtas", "respostas curtas", "resposta curta"])) {
      profile.defaultOperationalMode = "field";
      profile.briefingPreference = profile.briefingPreference ?? "curto";
      profile.detailLevel = "resumo";
      changeLabels.push("modo plantão padrão: compacto");
    }

    if (normalized.includes("quando eu") || normalized.includes("vou sair") || normalized.includes("na rua")) {
      profile.mobilityPreferences = uniqueAppend(current.mobilityPreferences, [extractPersonalMemoryStatement(prompt) ?? prompt.trim()]);
      changeLabels.push("preferência de deslocamento atualizada");
    }
  }

  const carryItems = extractCarryItemsFromProfilePrompt(prompt);
  if (carryItems.length > 0) {
    profile.attire = {
      carryItems: uniqueAppend(current.attire.carryItems, carryItems),
    };
    changeLabels.push(`itens importantes: ${carryItems.join(", ")}`);
  }

  const priorityMatch = prompt.match(/minha prioridade padr[aã]o\s+[ée]\s+(.+?)(?=(?:[?.!,;:]|$))/i);
  if (priorityMatch?.[1]?.trim()) {
    profile.operationalRules = uniqueAppend(current.operationalRules, [priorityMatch[1].trim()]);
    changeLabels.push(`regra fixa: ${priorityMatch[1].trim()}`);
  }

  if (normalized.includes("autonomia")) {
    const statement = extractPersonalMemoryStatement(prompt) ?? prompt.trim();
    profile.autonomyPreferences = uniqueAppend(current.autonomyPreferences, [statement]);
    changeLabels.push("preferência de autonomia atualizada");
  }

  if (includesAny(normalized, ["agenda principal", "calendario principal", "calendário principal", "agenda pessoal"])) {
    profile.defaultAgendaScope = "primary";
    changeLabels.push("escopo padrão de agenda: principal");
  } else if (includesAny(normalized, ["agenda trabalho", "agenda de trabalho", "calendario trabalho", "calendário trabalho"])) {
    profile.defaultAgendaScope = "work";
    changeLabels.push("escopo padrão de agenda: trabalho");
  } else if (includesAny(normalized, ["agenda pessoal e trabalho", "ambos", "ambas"])) {
    profile.defaultAgendaScope = "both";
    changeLabels.push("escopo padrão de agenda: ambos");
  }

  if (profile.briefingPreference || profile.detailLevel) {
    const responseLength = inferProfileResponseLength(profile.briefingPreference, profile.detailLevel);
    if (responseLength) {
      preferenceUpdate.responseLength = responseLength;
    }
  }

  if (profile.tonePreference === "executivo" || profile.responseStyle?.includes("executivo")) {
    preferenceUpdate.responseStyle = "executive";
  } else if (profile.tonePreference === "objetivo" || profile.responseStyle?.includes("direto")) {
    preferenceUpdate.responseStyle = "executive";
  } else if (profile.tonePreference === "acolhedor") {
    preferenceUpdate.responseStyle = "secretary";
  } else if (profile.detailLevel === "detalhado") {
    preferenceUpdate.responseStyle = "detailed";
  }

  if (Object.keys(profile).length === 0) {
    return null;
  }

  return {
    profile,
    preferenceUpdate: Object.keys(preferenceUpdate).length > 0 ? preferenceUpdate : undefined,
    changeLabels,
  };
}

export function removeFromPersonalOperationalProfile(
  profile: PersonalOperationalProfile,
  query: string,
): {
  profileUpdate: UpdatePersonalOperationalProfileInput;
  removedLabels: string[];
} | null {
  const normalizedQuery = normalizeEmailAnalysisText(query);
  const removedLabels: string[] = [];
  const profileUpdate: UpdatePersonalOperationalProfileInput = {};

  const resetStyle = normalizedQuery.includes("estilo")
    || normalizeEmailAnalysisText(profile.responseStyle).includes(normalizedQuery);
  if (resetStyle) {
    profileUpdate.responseStyle = "direto e objetivo";
    removedLabels.push("estilo de resposta personalizado");
  }

  const resetTone = normalizedQuery.includes("tom")
    || normalizeEmailAnalysisText(profile.tonePreference).includes(normalizedQuery);
  if (resetTone) {
    profileUpdate.tonePreference = "executivo";
    removedLabels.push("tom personalizado");
  }

  if (normalizedQuery.includes("briefing")) {
    profileUpdate.briefingPreference = "executivo";
    removedLabels.push("preferência de briefing");
  }

  if (normalizedQuery.includes("detalhe")) {
    profileUpdate.detailLevel = "resumo";
    removedLabels.push("nível de detalhe personalizado");
  }

  if (includesAny(normalizedQuery, ["plantao", "plantão", "modo rua"])) {
    profileUpdate.defaultOperationalMode = "normal";
    removedLabels.push("modo plantão padrão");
  }

  const nextMobility = removeMatchingEntries(profile.mobilityPreferences, query);
  if (nextMobility.length !== profile.mobilityPreferences.length) {
    profileUpdate.mobilityPreferences = nextMobility;
    removedLabels.push("preferência(s) de deslocamento");
  }

  const nextAutonomy = removeMatchingEntries(profile.autonomyPreferences, query);
  if (nextAutonomy.length !== profile.autonomyPreferences.length) {
    profileUpdate.autonomyPreferences = nextAutonomy;
    removedLabels.push("preferência(s) de autonomia");
  }

  const nextRules = removeMatchingEntries(profile.operationalRules, query);
  if (nextRules.length !== profile.operationalRules.length) {
    profileUpdate.operationalRules = nextRules;
    removedLabels.push("regra(s) operacionais");
  }

  const nextRoutineAnchors = removeMatchingEntries(profile.routineAnchors, query);
  if (nextRoutineAnchors.length !== profile.routineAnchors.length) {
    profileUpdate.routineAnchors = nextRoutineAnchors;
    removedLabels.push("âncora(s) de rotina");
  }

  const nextCarryItems = removeMatchingEntries(profile.attire.carryItems, query);
  if (nextCarryItems.length !== profile.attire.carryItems.length) {
    profileUpdate.attire = {
      ...(profileUpdate.attire ?? {}),
      carryItems: nextCarryItems,
    };
    removedLabels.push("item(ns) físicos");
  }

  return removedLabels.length > 0
    ? {
        profileUpdate,
        removedLabels,
      }
    : null;
}

export function extractPersonalMemoryId(prompt: string): number | undefined {
  const match = prompt.match(/\b(?:item|id)\s*(\d+)\b/i) ?? prompt.match(/#(\d+)\b/);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractPersonalMemoryUpdateTarget(prompt: string): string | undefined {
  const byId = extractPersonalMemoryId(prompt);
  if (byId) {
    return undefined;
  }

  const match = prompt.match(/mem[oó]ria\s+pessoal\s+(?:sobre|da|do|a regra|o item)?\s*(.+?)\s+(?:para|com|:)/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return undefined;
}

export function extractPersonalMemoryUpdateContent(prompt: string): string | undefined {
  const match = prompt.match(/\b(?:para|com|:)\s+(.+)$/i);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim();
}

export function extractPersonalMemoryDeleteTarget(prompt: string): string | undefined {
  const byId = extractPersonalMemoryId(prompt);
  if (byId) {
    return undefined;
  }

  const cleaned = prompt
    .replace(/^\s*(?:remova|remover|apague|delete|exclua)\s+(?:da\s+)?minha\s+mem[oó]ria\s+pessoal\s*/i, "")
    .replace(/^a\s+regra\s+/i, "")
    .replace(/^o\s+item\s+/i, "")
    .trim();
  return cleaned || undefined;
}

export function isMemoryEntityListPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes("liste as entidades") ||
    normalized.includes("listar entidades") ||
    normalized.includes("mostre as entidades") ||
    normalized.includes("memoria do atlas") ||
    normalized.includes("memória do atlas")
  ) && !normalized.includes("busque");
}

export function isMemoryEntitySearchPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("busque entidades")
    || normalized.includes("buscar entidades")
    || normalized.includes("procure entidades");
}

export function isIntentResolvePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("analise a intencao")
    || normalized.includes("analise a intenção")
    || normalized.includes("analise este pedido")
    || normalized.includes("inspecione a intencao")
    || normalized.includes("mostre a intencao");
}

export function extractIntentResolveSubject(prompt: string): string {
  const cleaned = prompt
    .replace(/^.*?(analise a intencao|analise a intenção|analise este pedido|inspecione a intencao|inspecione a intenção|mostre a intencao|mostre a intenção)\s*(?:de|:)?\s*/i, "")
    .trim();
  return cleaned || prompt.trim();
}

export function isOperationalPlanningPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasPlanningVerb = includesAny(normalized, [
    "organize",
    "organizar",
    "priorize",
    "priorizar",
    "alinhe",
    "alinha",
    "arrume",
    "arrumar",
    "planeje",
    "planejar",
    "revisar",
  ]);
  const hasOperationalScope = includesAny(normalized, [
    "meu dia",
    "minha agenda",
    "agenda",
    "compromissos",
    "aprovacoes",
    "aprovações",
    "approval",
    "foco hoje",
  ]);
  return hasPlanningVerb && hasOperationalScope;
}

export function extractPreferenceUpdate(prompt: string): import("../types/user-preferences.js").UpdateUserPreferencesInput | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  const update: import("../types/user-preferences.js").UpdateUserPreferencesInput = {};

  if (normalized.includes("modo executivo") || normalized.includes("mais executivo")) {
    update.responseStyle = "executive";
    update.responseLength = "short";
  }
  if (normalized.includes("mais detalhado") || normalized.includes("mais detalhada")) {
    update.responseStyle = "detailed";
    update.responseLength = "medium";
  }
  if (normalized.includes("mais investigativo") || normalized.includes("modo investigativo")) {
    update.responseStyle = "investigative";
    update.responseLength = "medium";
  }
  if (normalized.includes("modo secretario") || normalized.includes("modo secretário")) {
    update.responseStyle = "secretary";
    update.responseLength = "short";
  }

  const nameMatch = prompt.match(/(?:me\s+chame\s+de|prefiro\s+que\s+voce\s+se\s+chame\s+de)\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i);
  if (nameMatch?.[1]?.trim()) {
    update.preferredAgentName = nameMatch[1].trim();
  }

  return Object.keys(update).length > 0 ? update : null;
}

export function isImplicitResearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "albergue em ",
      "abrigo em ",
      "dias da cruz",
      "felipe diehl",
      "porto alegre",
    ]) &&
    !includesAny(normalized, [
      "email",
      "e-mail",
      "contato",
      "google",
      "tarefa",
      "workspace",
      "arquivo",
      "pasta",
      "projeto",
    ])
  );
}

export function isInternalKnowledgePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "pesquise internamente",
    "procure internamente",
    "busque internamente",
    "contexto interno",
    "busca interna",
    "pesquisa interna",
    "na pasta",
    "no projeto",
    "neste projeto",
    "nesse projeto",
    "dentro do projeto",
    "dentro da pasta",
  ]);
}

export function extractWeatherLocation(prompt: string): string | undefined {
  const patterns = [
    /previs[aã]o do tempo para\s+(.+?)(?=$|[?.!,;:])/i,
    /clima em\s+(.+?)(?=$|[?.!,;:])/i,
    /tempo em\s+(.+?)(?=$|[?.!,;:])/i,
    /temperatura em\s+(.+?)(?=$|[?.!,;:])/i,
    /vai chover em\s+(.+?)(?=$|[?.!,;:])/i,
    /chuva em\s+(.+?)(?=$|[?.!,;:])/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]
      ?.trim()
      .replace(/[.,;:!?]+$/g, "")
      .replace(/\b(?:hoje|agora|amanha|amanhã)\b$/i, "")
      .trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function buildWeatherTip(result: {
  current?: {
    temperatureC?: number;
  };
  daily: Array<{
    minTempC?: number;
    maxTempC?: number;
    precipitationProbabilityMax?: number;
  }>;
}): string | undefined {
  const today = result.daily[0];
  const rain = today?.precipitationProbabilityMax ?? 0;
  const maxTemp = today?.maxTempC ?? result.current?.temperatureC;
  const minTemp = today?.minTempC;

  if (rain >= 60) {
    return "Vale sair com guarda-chuva.";
  }
  if (typeof minTemp === "number" && minTemp <= 14) {
    return "Vale levar um casaco leve.";
  }
  if (typeof maxTemp === "number" && maxTemp >= 28) {
    return "Pode ir com roupa leve.";
  }
  if (rain <= 20) {
    return "Não parece precisar de guarda-chuva.";
  }
  return undefined;
}

export function buildWeatherReply(result: {
  locationLabel: string;
  timezone: string;
  current?: {
    time?: string;
    temperatureC?: number;
    apparentTemperatureC?: number;
    humidityPercent?: number;
    precipitationMm?: number;
    description: string;
    windSpeedKmh?: number;
  };
  daily: Array<{
    date: string;
    description: string;
    minTempC?: number;
    maxTempC?: number;
    precipitationProbabilityMax?: number;
    precipitationSumMm?: number;
  }>;
}): string {
  const today = result.daily[0];
  const tomorrow = result.daily[1];
  const parts: string[] = [];

  if (today) {
    const tempRange = typeof today.minTempC === "number" && typeof today.maxTempC === "number"
      ? `, entre ${today.minTempC}° e ${today.maxTempC}°`
      : "";
    const rain = typeof today.precipitationProbabilityMax === "number"
      ? ` e chuva em torno de ${today.precipitationProbabilityMax}%`
      : "";
    const currentTemp = typeof result.current?.temperatureC === "number"
      ? `, ${result.current.temperatureC}°C agora`
      : "";
    parts.push(`Hoje em ${result.locationLabel} o tempo está ${today.description.toLowerCase()}${currentTemp}${tempRange}${rain}.`);
  } else if (result.current) {
    parts.push(`Agora em ${result.locationLabel} está ${result.current.description.toLowerCase()}, com ${result.current.temperatureC ?? "?"}°C.`);
  }

  const tip = buildWeatherTip(result);
  if (tip) {
    parts.push(tip);
  }

  if (tomorrow) {
    const tempRange = typeof tomorrow.minTempC === "number" && typeof tomorrow.maxTempC === "number"
      ? `, entre ${tomorrow.minTempC}° e ${tomorrow.maxTempC}°`
      : "";
    const rain = typeof tomorrow.precipitationProbabilityMax === "number"
      ? ` e chuva em torno de ${tomorrow.precipitationProbabilityMax}%`
      : "";
    parts.push(`Amanhã a tendência é ${tomorrow.description.toLowerCase()}${tempRange}${rain}.`);
  }

  if (parts.length === 0) {
    return `Não encontrei uma previsão confiável agora para ${result.locationLabel}.`;
  }

  return parts.join(" ");
}

export function extractWebResearchQuery(prompt: string): string {
  return prompt
    .replace(/^\s*pesquisa\s+(?:rapida|rápida|executiva|executivo|profunda|profundo)\s+/i, "")
    .replace(/\b(pesquise|pesquisa|estude|valide)\b/gi, "")
    .replace(/^\s*qual\s+(?:o\s+)?endere[cç]o\s+(?:do|da|de)\s+/i, "")
    .replace(/^\s*onde\s+fica\s+(?:o|a)\s+/i, "")
    .replace(/^\s*endere[cç]o\s+(?:do|da|de)\s+/i, "")
    .replace(/^\s*(procure|busque|buscar|encontre)\s+na internet\s+por\s+/i, "")
    .replace(/^\s*(procure|busque|buscar|encontre)\s+por\s+/i, "")
    .replace(/^\s*(procure|busque|buscar|encontre)\s+na internet\s+/i, "")
    .replace(/^\s*ache\s+informacoes?\s+sobre\s+/i, "")
    .replace(/^\s*ache\s+informações?\s+sobre\s+/i, "")
    .replace(/\bna internet\b/gi, "")
    .replace(/\bcom fontes\b/gi, "")
    .replace(/\bpor favor\b/gi, "")
    .replace(/^\s*(?:rapida|rápida|executiva|executivo|profunda|profundo)\s+/i, "")
    .replace(/^\s*por\s+/i, "")
    .replace(/^\s*sobre\s+(?:o|a|os|as)\s+/i, "")
    .replace(/^\s*sobre\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?-]+$/g, "")
    .trim();
}

export function extractWebResearchMode(prompt: string): WebResearchMode {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (
    includesAny(normalized, [
      "pesquisa profunda",
      "modo profundo",
      "profundo",
      "profunda",
      "aprofunde",
      "detalhado",
      "detalhada",
      "completo",
      "completa",
    ])
  ) {
    return "deep";
  }

  if (
    includesAny(normalized, [
      "pesquisa rapida",
      "pesquisa rápida",
      "modo rapido",
      "modo rápido",
      "rapido",
      "rápido",
      "breve",
      "curto",
      "curta",
      "resumo rapido",
      "resumo rápido",
    ])
  ) {
    return "quick";
  }

  if (
    includesAny(normalized, [
      "mercado",
      "concorr",
      "benchmark",
      "tendencia",
      "tendência",
      "viabilidade",
      "demanda",
      "oportunidade",
    ])
  ) {
    return "deep";
  }

  return "executive";
}

export function maxResearchResultsForMode(mode: WebResearchMode): number {
  if (mode === "quick") {
    return 4;
  }
  if (mode === "deep") {
    return 8;
  }
  return 6;
}

export function excerptBudgetForResearchMode(mode: WebResearchMode): number {
  if (mode === "quick") {
    return 1100;
  }
  if (mode === "deep") {
    return 3200;
  }
  return 2200;
}

export function extractInternalKnowledgeQuery(prompt: string): string {
  return prompt
    .replace(/^\s*(pesquise|procure|busque|encontre)\s+internamente\s+/i, "")
    .replace(/^\s*(pesquise|procure|busque|encontre)\s+(?:na|no)\s+(?:pasta|projeto)\s+/i, "")
    .replace(/\bcom contexto interno\b/gi, "")
    .replace(/\bbusca interna\b/gi, "")
    .replace(/\bpesquisa interna\b/gi, "")
    .replace(/\binternamente\b/gi, "")
    .replace(/^\s*por\s+/i, "")
    .replace(/\bna pasta\b/gi, "")
    .replace(/\bno projeto\b/gi, "")
    .replace(/\bdentro do projeto\b/gi, "")
    .replace(/\bdentro da pasta\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?-]+$/g, "")
    .trim();
}

export function isRevenueScoreboardPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "placar mensal",
    "scoreboard mensal",
    "receita do mes",
    "receita do mês",
    "placar de receita",
    "pipeline do mes",
    "pipeline do mês",
  ].some((token) => normalized.includes(token));
}

export function isAllowedSpacesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "quais espacos",
      "quais espaços",
      "quais pastas",
      "quais diretorios",
      "quais diretórios",
      "o que voce pode ver",
      "o que voce pode acessar",
      "espacos autorizados",
      "pastas autorizadas",
    ]) &&
    includesAny(normalized, ["mac", "pastas", "espacos", "espaços", "diretorios", "diretórios", "acessar", "ver"])
  );
}

export function isContentOverviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "calendario editorial",
    "calendário editorial",
    "fila editorial",
    "queue editorial",
    "fila de conteudo",
    "fila de conteúdo",
    "plano de conteudo",
    "plano de conteúdo",
    "conteudo da semana",
    "conteúdo da semana",
    "meus conteudos",
    "meus conteúdos",
    "itens de conteudo",
    "itens de conteúdo",
  ].some((token) => normalized.includes(token));
}

export function isContentChannelsPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "canais editoriais",
    "canais de conteudo",
    "canais de conteúdo",
    "meus canais de conteudo",
    "meus canais de conteúdo",
    "canais do riqueza despertada",
    "canal riqueza despertada",
  ].some((token) => normalized.includes(token));
}

export function isContentSeriesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "series editoriais",
    "séries editoriais",
    "series de conteudo",
    "séries de conteúdo",
    "series do canal",
    "séries do canal",
    "series do riqueza despertada",
    "séries do riqueza despertada",
  ].some((token) => normalized.includes(token));
}

export function isContentFormatLibraryPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "formatos de conteudo",
    "formatos de conteúdo",
    "biblioteca de formatos",
    "templates de formato",
    "modelos de formato",
  ].some((token) => normalized.includes(token));
}

export function isContentHookLibraryPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "biblioteca de hooks",
    "templates de hooks",
    "hooks de conteudo",
    "hooks de conteúdo",
    "ganchos de conteudo",
    "ganchos de conteúdo",
  ].some((token) => normalized.includes(token));
}

export function isContentIdeaGenerationPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "gere pautas",
      "gerar pautas",
      "gere ideias",
      "gerar ideias",
      "crie pautas",
      "criar pautas",
      "crie ideias",
      "ideias para o canal",
      "pautas para o canal",
    ]) &&
    includesAny(normalized, ["canal", "conteudo", "conteúdo", "riqueza despertada", "youtube", "tiktok"])
  );
}

export function isContentReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, ["aprovar", "aprove", "reprovar", "reprove"]) &&
    includesAny(normalized, ["item", "conteudo", "conteúdo", "pauta", "fila", "#"])
  );
}

export function isContentScriptGenerationPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "gere roteiro",
      "gerar roteiro",
      "roteirize",
      "roteirizar",
      "escreva o roteiro",
      "script do item",
      "roteiro do item",
    ]) &&
    includesAny(normalized, ["item", "conteudo", "conteúdo", "pauta", "#", "primeiro", "segundo", "terceiro"])
  );
}

export function isContentBatchPlanningPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "lote inicial",
      "batch inicial",
      "monte o lote",
      "monte um lote",
      "gere lote",
      "planeje lote",
      "lote de videos",
      "lote de vídeos",
      "batch de videos",
      "batch de vídeos",
    ]) &&
    includesAny(normalized, ["conteudo", "conteúdo", "videos", "vídeos", "canal", "riqueza despertada"])
  );
}

export function isContentBatchGenerationPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "gere o lote",
      "gerar o lote",
      "gere os 5 pacotes",
      "gerar os 5 pacotes",
      "gere o pacote do lote",
      "gere os pacotes do lote",
      "lote completo",
      "batch completo",
    ]) &&
    includesAny(normalized, ["conteudo", "conteúdo", "videos", "vídeos", "canal", "riqueza despertada", "lote"])
  );
}

export function isContentDistributionStrategyPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "estrategia de distribuicao",
    "estratégia de distribuição",
    "estrategia de postagem",
    "estratégia de postagem",
    "ordem de publicacao",
    "ordem de publicação",
    "horario de postagem",
    "horário de postagem",
    "slot de postagem",
    "janela de postagem",
  ]);
}

export function isDailyEditorialResearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "research kernel",
      "briefing editorial",
      "rodar pauta do dia",
      "rode a pauta do dia",
      "rode o research",
      "gere a pauta do dia",
      "pesquise trends do dia",
    ]) &&
    includesAny(normalized, ["canal", "riqueza despertada", "youtube", "tiktok", "editorial", "trend", "pauta"])
  );
}

export function isCaseNotesPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "notas sociais",
    "anotacoes sociais",
    "anotações sociais",
    "casos sociais",
    "atendimentos sociais",
    "notas da area social",
  ].some((token) => normalized.includes(token));
}

export function isProjectScanPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "analise o projeto",
      "análise o projeto",
      "analisar o projeto",
      "mapeie o projeto",
      "escaneie o projeto",
      "scan do projeto",
      "resuma o projeto",
      "status do projeto",
      "git status do projeto",
      "repositorio",
      "repositório",
    ]) &&
    includesAny(normalized, ["projeto", "repositorio", "repositório", "git", "codigo", "código"])
  );
}

export function extractSafeExecRequest(prompt: string): { argv: string[]; root: ReadableRootKey; path?: string } | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  const root = extractProjectRoot(prompt);
  const path = extractProjectPath(prompt) ?? ".";

  if (normalized.includes("npm run build") || normalized.includes("rode o build") || normalized.includes("executar build")) {
    return {
      argv: ["npm", "run", "build"],
      root,
      path,
    };
  }

  if (normalized.includes("npm test") || normalized.includes("rode os testes") || normalized.includes("rodar testes")) {
    return {
      argv: ["npm", "test"],
      root,
      path,
    };
  }

  if (normalized.includes("npm ci")) {
    return {
      argv: ["npm", "ci"],
      root,
      path,
    };
  }

  if (normalized.includes("npm install")) {
    return {
      argv: ["npm", "install"],
      root,
      path,
    };
  }

  if (normalized.includes("pnpm build")) {
    return {
      argv: ["pnpm", "build"],
      root,
      path,
    };
  }

  if (normalized.includes("pnpm test")) {
    return {
      argv: ["pnpm", "test"],
      root,
      path,
    };
  }

  if (normalized.includes("pnpm install")) {
    return {
      argv: ["pnpm", "install"],
      root,
      path,
    };
  }

  if (normalized.includes("yarn build")) {
    return {
      argv: ["yarn", "build"],
      root,
      path,
    };
  }

  if (normalized.includes("yarn test")) {
    return {
      argv: ["yarn", "test"],
      root,
      path,
    };
  }

  if (normalized.includes("yarn install")) {
    return {
      argv: ["yarn", "install"],
      root,
      path,
    };
  }

  if (normalized.includes("git status")) {
    return {
      argv: ["git", "status", "--short"],
      root,
      path,
    };
  }

  if (normalized.includes("git diff --stat") || normalized.includes("diff stat")) {
    return {
      argv: ["git", "diff", "--stat"],
      root,
      path,
    };
  }

  if (normalized.includes("git branch")) {
    return {
      argv: ["git", "branch", "--show-current"],
      root,
      path,
    };
  }

  return null;
}

export function extractContentPlatform(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const tokens = ["instagram", "tiktok", "youtube", "shorts", "reels", "linkedin", "blog", "email", "telegram"];
  return tokens.find((token) => normalized.includes(token));
}

export function extractContentChannelKey(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("riqueza_despertada_youtube")) {
    return "riqueza_despertada_youtube";
  }
  if (normalized.includes("riqueza_despertada_tiktok")) {
    return "riqueza_despertada_tiktok";
  }
  if (normalized.includes("riqueza despertada")) {
    if (normalized.includes("tiktok")) {
      return "riqueza_despertada_tiktok";
    }
    if (normalized.includes("youtube") || normalized.includes("shorts")) {
      return "riqueza_despertada_youtube";
    }
  }
  return undefined;
}

export function inferDefaultContentChannelKey(prompt: string): string {
  return extractContentChannelKey(prompt)
    ?? (normalizeEmailAnalysisText(prompt).includes("tiktok")
      ? "riqueza_despertada_tiktok"
      : "riqueza_despertada_youtube");
}

export function extractContentIdeaSeed(prompt: string): string | undefined {
  const topicMatch = prompt.match(
    /(?:sobre|tema|assunto|nicho)\s+["“]?(.+?)["”]?(?=(?:\s+(?:para|pro|no|na)\s+(?:o\s+)?(?:canal|youtube|tiktok)|[?.!,;:]|$))/i,
  );
  return topicMatch?.[1]?.trim();
}

export function extractContentItemId(prompt: string): number | undefined {
  const hashMatch = prompt.match(/#(\d{1,6})\b/);
  if (hashMatch) {
    return Number.parseInt(hashMatch[1], 10);
  }
  const itemMatch = prompt.match(/(?:item|conteudo|conteúdo|pauta)\s+(\d{1,6})\b/i);
  if (itemMatch) {
    return Number.parseInt(itemMatch[1], 10);
  }
  return undefined;
}

export function extractContentQueueOrdinal(prompt: string): number | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("primeiro item") || normalized.includes("primeira pauta")) {
    return 1;
  }
  if (normalized.includes("segundo item") || normalized.includes("segunda pauta")) {
    return 2;
  }
  if (normalized.includes("terceiro item") || normalized.includes("terceira pauta")) {
    return 3;
  }
  if (normalized.includes("quarto item") || normalized.includes("quarta pauta")) {
    return 4;
  }
  if (normalized.includes("quinto item") || normalized.includes("quinta pauta")) {
    return 5;
  }
  return undefined;
}

export function extractContentReviewReason(prompt: string): string | undefined {
  const reasonMatch = prompt.match(/(?:porque|motivo|raz[aã]o)\s+(.+)$/i);
  return reasonMatch?.[1]?.trim();
}

export function classifyContentReviewFeedback(reason: string | undefined): string | undefined {
  if (!reason) {
    return undefined;
  }
  const normalized = normalizeEmailAnalysisText(reason);
  if (normalized.includes("hook")) {
    return "hook_fraco";
  }
  if (normalized.includes("confus")) {
    return "confuso";
  }
  if (normalized.includes("genéric") || normalized.includes("generic")) {
    return "generico";
  }
  if (normalized.includes("tens")) {
    return "sem_tensao";
  }
  if (normalized.includes("longo")) {
    return "longo_demais";
  }
  return "reprovado_manual";
}

export function buildFallbackEditorialIdeas(input: {
  channelName: string;
  seed?: string;
  formatKeys: string[];
  seriesKeys: string[];
  limit: number;
}): Array<{
  title: string;
  hook: string;
  pillar: string;
  audience: string;
  formatTemplateKey?: string;
  seriesKey?: string | null;
  notes: string;
}> {
  const topic = input.seed?.trim() || "dinheiro e renda";
  const ideas = [
    {
      title: `3 formas reais de aumentar renda com ${topic} sem prometer milagre`,
      hook: "A maioria fala em enriquecer rápido, mas estas 3 vias geram caixa no mundo real.",
      pillar: "formas de fazer dinheiro",
      notes: "Fallback editorial focado em utilidade e retenção.",
    },
    {
      title: `O erro que te impede de transformar habilidade em dinheiro com ${topic}`,
      hook: "Quase todo mundo trava no mesmo ponto quando tenta ganhar dinheiro com o que sabe fazer.",
      pillar: "erros sobre riqueza",
      notes: "Fallback editorial focado em dor + mecanismo.",
    },
    {
      title: `${topic}: serviço, produto ou SaaS? O que gera caixa primeiro`,
      hook: "Antes de pensar em escalar, você precisa escolher o mecanismo certo para gerar caixa.",
      pillar: "modelos de negocio",
      notes: "Fallback editorial comparativo com clareza de mecanismo.",
    },
    {
      title: `Por que disciplina operacional vale mais que motivação para crescer com ${topic}`,
      hook: "Se você depende de motivação, vai quebrar o ritmo antes de ver resultado.",
      pillar: "execucao e disciplina",
      notes: "Fallback editorial com tom contrarian e aplicável.",
    },
    {
      title: `A mentira sobre ${topic} que deixa muita gente presa no zero`,
      hook: "Existe uma crença repetida o tempo todo sobre dinheiro que atrasa qualquer resultado sério.",
      pillar: "erros sobre riqueza",
      notes: "Fallback editorial para série de crenças e mitos.",
    },
  ];

  return ideas.slice(0, Math.max(1, Math.min(input.limit, ideas.length))).map((idea, index) => ({
    ...idea,
    audience: "pessoas buscando riqueza por execução, internet ou negócios",
    formatTemplateKey: input.formatKeys[index % Math.max(input.formatKeys.length, 1)],
    seriesKey: input.seriesKeys.length > 0 ? input.seriesKeys[index % input.seriesKeys.length] : null,
  }));
}

const RIQUEZA_ALLOWED_TREND_KEYWORDS = [
  "dinheiro",
  "renda",
  "financa",
  "finanças",
  "economia",
  "negocio",
  "negócio",
  "negocios",
  "negócios",
  "empreendedor",
  "empreendedorismo",
  "empresa",
  "empresas",
  "vendas",
  "vender",
  "cliente",
  "lucro",
  "caixa",
  "salario",
  "salário",
  "trabalho",
  "emprego",
  "imposto",
  "taxa",
  "juros",
  "selic",
  "credito",
  "crédito",
  "divida",
  "dívida",
  "cartao",
  "cartão",
  "pix",
  "banco",
  "nubank",
  "inter",
  "mercado livre",
  "shopee",
  "amazon",
  "saas",
  "startup",
  "produto digital",
  "infoproduto",
  "afiliado",
  "marketing",
  "trafego",
  "tráfego",
  "anuncio",
  "anúncio",
  "investimento",
  "investir",
  "acoes",
  "ações",
  "ibovespa",
  "dolar",
  "dólar",
  "bitcoin",
  "btc",
  "ethereum",
  "cripto",
  "fgts",
  "inss",
  "mei",
];

const RIQUEZA_BLOCKED_TREND_KEYWORDS = [
  "futebol",
  "jogo",
  "partida",
  "campeonato",
  "gol",
  "rodada",
  "cartola",
  "ufc",
  "luta",
  "atleta",
  "jogador",
  "treinador",
  "bbb",
  "novela",
  "cantor",
  "atriz",
  "celebridade",
  "fofoca",
  "reality",
  "show",
  "morreu",
  "morte",
  "acidente",
];

export function buildTrendChannelContext(trend: GoogleTrendItem, angle?: string): string {
  return normalizeEmailAnalysisText(
    [
      trend.title,
      angle ?? "",
      ...trend.newsItems.flatMap((item) => [item.title ?? "", item.source ?? "", item.snippet ?? ""]),
    ].join(" | "),
  );
}

export function isRiquezaTrendEligible(input: {
  trend: GoogleTrendItem;
  fitScore: number;
  angle?: string;
}): { allowed: boolean; reason: string } {
  const title = normalizeEmailAnalysisText(input.trend.title);
  const context = buildTrendChannelContext(input.trend, input.angle);
  const hasFinanceSignal = includesAny(context, RIQUEZA_ALLOWED_TREND_KEYWORDS);
  const hasBlockedSignal = includesAny(context, RIQUEZA_BLOCKED_TREND_KEYWORDS) || /\b.+\s+x\s+.+\b/i.test(title);

  if (!hasFinanceSignal) {
    return {
      allowed: false,
      reason: "trend sem sinal forte de finanças, renda, negócios ou monetização prática",
    };
  }

  if (hasBlockedSignal && !hasFinanceSignal) {
    return {
      allowed: false,
      reason: "trend dominado por esporte, celebridade ou notícia geral fora do canal",
    };
  }

  if (input.fitScore < 60) {
    return {
      allowed: false,
      reason: "fit editorial abaixo do mínimo para virar pauta do canal",
    };
  }

  return {
    allowed: true,
    reason: "trend com aderência financeira suficiente para virar pauta acionável",
  };
}

export function isRiquezaContentItemEligible(item: {
  title: string;
  hook?: string | null;
  pillar?: string | null;
  notes?: string | null;
  channelKey?: string | null;
}): boolean {
  if (!item.channelKey?.startsWith("riqueza_despertada")) {
    return true;
  }

  const context = normalizeEmailAnalysisText(
    [
      item.title,
      item.hook ?? "",
      item.pillar ?? "",
      item.notes ?? "",
    ].join(" | "),
  );

  const hasAllowedSignal = includesAny(context, RIQUEZA_ALLOWED_TREND_KEYWORDS)
    || includesAny(context, [
      "riqueza",
      "patrimonio",
      "patrimônio",
      "precificar",
      "assinatura",
      "conversao",
      "conversão",
      "pagina de vendas",
      "pagina",
      "freelancer",
      "produto",
      "produtos",
      "execucao",
      "execução",
      "canal escalavel",
      "canal escalável",
      "poupanca",
      "poupança",
    ]);
  const hasBlockedSignal = includesAny(context, [
    ...RIQUEZA_BLOCKED_TREND_KEYWORDS,
    "aposta",
    "apostas",
    "bet",
    "cassino",
    "cassino online",
    "pre luta",
    "pré luta",
  ]);

  return hasAllowedSignal && !hasBlockedSignal;
}

export function filterSelectedTrendsForChannel(input: {
  channelKey: string;
  selectedTrends: Array<{
    title: string;
    approxTraffic?: string;
    fitScore: number;
    angle: string;
    useTrend: boolean;
  }>;
  rawTrends: GoogleTrendItem[];
}): Array<{
  title: string;
  approxTraffic?: string;
  fitScore: number;
  angle: string;
  useTrend: boolean;
}> {
  if (!input.channelKey.startsWith("riqueza_despertada")) {
    return input.selectedTrends;
  }

  return input.selectedTrends.map((item) => {
    const trend = input.rawTrends.find((entry) => normalizeEmailAnalysisText(entry.title) === normalizeEmailAnalysisText(item.title));
    if (!trend) {
      return {
        ...item,
        useTrend: false,
      };
    }

    const eligibility = isRiquezaTrendEligible({
      trend,
      fitScore: item.fitScore,
      angle: item.angle,
    });

    return {
      ...item,
      useTrend: item.useTrend && eligibility.allowed,
      angle: eligibility.allowed ? item.angle : `${item.angle} | descartado: ${eligibility.reason}`,
    };
  });
}

export function extractProjectRoot(prompt: string): ReadableRootKey {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("workspace")) {
    return "workspace";
  }
  if (normalized.includes("conteudo") || normalized.includes("conteúdo")) {
    return "authorized_content";
  }
  if (normalized.includes("financeiro")) {
    return "authorized_finance";
  }
  if (normalized.includes("social")) {
    return "authorized_social";
  }
  if (normalized.includes("admin")) {
    return "authorized_admin";
  }
  if (normalized.includes("projetos autorizados")) {
    return "authorized_projects";
  }
  return "authorized_dev";
}

export function extractProjectPath(prompt: string): string | undefined {
  const clean = (value: string | undefined): string | undefined => {
    const cleaned = value
      ?.trim()
      .replace(/^["“”']+/, "")
      .replace(/["“”']+$/g, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return cleaned || undefined;
  };

  const quotedMatch = prompt.match(
    /(?:pasta|diretorio|diretório|caminho|path|projeto|repositorio|repositório)\s+["“]([^"”]+?)["”]/i,
  );
  const quoted = clean(quotedMatch?.[1]);
  if (quoted) {
    return quoted;
  }

  const unquotedMatch = prompt.match(
    /(?:pasta|diretorio|diretório|caminho|path|projeto|repositorio|repositório)\s+(.+?)(?=(?:\s+(?:dentro\s+de|no\s+root|em\s+(?:authorized_|projetos\s+autorizados|workspace(?:\s+origem)?|conteudo|conteúdo|financeiro|social|admin)|para\s+(?:o\s+)?workspace|no\s+(?:meu\s+)?mac|no\s+computador|e\s+(?:rode|execute|analise|análise|leia|resuma|espelhe|copie|clone))|[?.!,;:]|$))/i,
  );
  return clean(unquotedMatch?.[1]);
}

export function isMirrorProjectPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "espelhe",
      "espelhar",
      "crie um espelho",
      "copie o projeto",
      "copiar projeto",
      "clone local",
      "traga para o workspace",
    ]) && includesAny(normalized, ["projeto", "workspace", "pasta", "repositorio", "repositório"])
  );
}

export function extractMirrorTargetPath(prompt: string): string | undefined {
  const clean = (value: string | undefined): string | undefined => {
    const cleaned = value
      ?.trim()
      .replace(/^["“”']+/, "")
      .replace(/["“”']+$/g, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
    return cleaned || undefined;
  };
  const match = prompt.match(
    /(?:para|no|na)\s+(?:o\s+)?workspace(?:\/|\\)?["“]?(.+?)["”]?(?=(?:\s+e\s+(?:rode|execute|analise|análise|leia|resuma|espelhe|copie|clone)|[?.!,;:]|$))/i,
  );
  return clean(match?.[1]);
}

export function extractMirrorSourceRoot(prompt: string): ReadableRootKey {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("conteudo") || normalized.includes("conteúdo")) {
    return "authorized_content";
  }
  if (normalized.includes("financeiro")) {
    return "authorized_finance";
  }
  if (normalized.includes("social")) {
    return "authorized_social";
  }
  if (normalized.includes("admin")) {
    return "authorized_admin";
  }
  if (normalized.includes("projetos autorizados")) {
    return "authorized_projects";
  }
  if (normalized.includes("workspace origem")) {
    return "workspace";
  }
  return "authorized_dev";
}

export function extractPromptLimit(prompt: string, fallback: number, max: number): number {
  const match = prompt.match(/\b(\d{1,3})\b/);
  if (!match) {
    return fallback;
  }
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.min(value, max);
}

export function extractReferenceMonth(prompt: string): string | undefined {
  const match = prompt.match(/\b(20\d{2}-\d{2})\b/);
  return match?.[1];
}

export function isCalendarLookupPrompt(prompt: string): boolean {
  if (isGoogleEventCreatePrompt(prompt) || isGoogleTaskCreatePrompt(prompt)) {
    return false;
  }
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, [
      "tenho algo agendado",
      "tenho compromisso",
      "tenho evento",
      "ha algo agendado",
      "há algo agendado",
      "verifique meu calendario",
      "verifique meu calendário",
      "olhe meu calendario",
      "olhe meu calendário",
      "veja meu calendario",
      "veja meu calendário",
      "analise meu calendario",
      "analise meu calendário",
      "no calendario",
      "no calendário",
      "na agenda",
      "evento no dia",
      "compromisso no dia",
    ]) &&
    !normalized.includes("calendario editorial") &&
    !normalized.includes("calendário editorial")
  );
}

export function getWeekdayTargetDate(normalized: string, timezone: string): { isoDate: string; label: string } | undefined {
  const weekdayMap: Array<{ tokens: string[]; day: number; label: string }> = [
    { tokens: ["domingo"], day: 0, label: "domingo" },
    { tokens: ["segunda", "segunda feira"], day: 1, label: "segunda" },
    { tokens: ["terca", "terça", "terca feira", "terça feira"], day: 2, label: "terça" },
    { tokens: ["quarta", "quarta feira"], day: 3, label: "quarta" },
    { tokens: ["quinta", "quinta feira"], day: 4, label: "quinta" },
    { tokens: ["sexta", "sexta feira"], day: 5, label: "sexta" },
    { tokens: ["sabado", "sábado", "sabado feira", "sábado feira"], day: 6, label: "sábado" },
  ];

  const match = weekdayMap.find((item) => item.tokens.some((token) => normalized.includes(token)));
  if (!match) {
    return undefined;
  }

  const now = new Date();
  const localized = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  localized.setHours(0, 0, 0, 0);
  const currentDay = localized.getDay();
  let diff = match.day - currentDay;
  if (diff <= 0) {
    diff += 7;
  }
  localized.setDate(localized.getDate() + diff);
  const isoDate = [
    String(localized.getFullYear()).padStart(4, "0"),
    String(localized.getMonth() + 1).padStart(2, "0"),
    String(localized.getDate()).padStart(2, "0"),
  ].join("-");
  return {
    isoDate,
    label: match.label,
  };
}

export function parseCalendarLookupDate(prompt: string, timezone: string): CalendarLookupRequest["targetDate"] | undefined {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [yearNow, monthNow, dayNow] = formatter.format(now).split("-").map((item) => Number.parseInt(item, 10));

  const explicit = prompt.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  let year = yearNow;
  let month = monthNow;
  let day = dayNow;

  if (explicit?.[1] && explicit?.[2]) {
    day = Number.parseInt(explicit[1], 10);
    month = Number.parseInt(explicit[2], 10);
    if (explicit[3]) {
      year = Number.parseInt(explicit[3].length === 2 ? `20${explicit[3]}` : explicit[3], 10);
    }
  } else {
    const normalized = normalizeEmailAnalysisText(prompt);
    if (normalized.includes("amanha")) {
      const shifted = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const [shiftYear, shiftMonth, shiftDay] = formatter.format(shifted).split("-").map((item) => Number.parseInt(item, 10));
      year = shiftYear;
      month = shiftMonth;
      day = shiftDay;
    } else if (!normalized.includes("hoje")) {
      const weekdayTarget = getWeekdayTargetDate(normalized, timezone);
      if (weekdayTarget) {
        return {
          isoDate: weekdayTarget.isoDate,
          startIso: `${weekdayTarget.isoDate}T00:00:00-03:00`,
          endIso: `${weekdayTarget.isoDate}T23:59:59-03:00`,
          label: weekdayTarget.label,
        };
      }
      return undefined;
    }
  }

  const isoDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    isoDate,
    startIso: `${isoDate}T00:00:00-03:00`,
    endIso: `${isoDate}T23:59:59-03:00`,
    label: explicit ? `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}` : normalizeEmailAnalysisText(prompt).includes("amanha") ? "amanhã" : "hoje",
  };
}

export function extractCalendarLookupTopic(prompt: string): string | undefined {
  const patterns = [
    /\bsobre\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /\bcom\s+["“]?(.+?)["”]?(?=(?:[?.!,;:]|$))/i,
    /(?:evento|compromisso|agenda)\s+(?:de|do|da)\s+["“]?(.+?)["”]?(?=(?:\s+no dia|\s+dia\s+\d|\?|$))/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]
      ?.trim()
      .replace(/^dia\s+\d{1,2}\/\d{1,2}\s+/i, "")
      .replace(/^sobre\s+/i, "")
      .replace(/[?.!,;:]+$/g, "")
      .trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function extractCalendarLookupRequest(prompt: string, timezone: string): CalendarLookupRequest | undefined {
  if (!isCalendarLookupPrompt(prompt)) {
    return undefined;
  }

  return {
    topic: extractCalendarLookupTopic(prompt),
    targetDate: parseCalendarLookupDate(prompt, timezone),
  };
}

export interface EmailLookupRequest {
  senderQuery?: string;
  category?: EmailOperationalGroup;
  unreadOnly: boolean;
  sinceHours: number;
  existenceOnly: boolean;
}

export interface ResolvedEmailReference {
  message?: EmailMessageSummary;
  label: string;
  totalMatches: number;
  request: EmailLookupRequest;
}

export interface CalendarLookupRequest {
  topic?: string;
  targetDate?: {
    isoDate: string;
    startIso: string;
    endIso: string;
    label: string;
  };
}

export interface CalendarPeriodWindow {
  startIso: string;
  endIso: string;
  label: string;
}

export function parseCalendarPeriodWindow(prompt: string, timezone: string): CalendarPeriodWindow | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const specificDate = parseCalendarLookupDate(prompt, timezone);
  if (specificDate) {
    return {
      startIso: specificDate.startIso,
      endIso: specificDate.endIso,
      label: specificDate.label,
    };
  }

  const now = new Date();
  const today = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const startOfToday = new Date(today);
  startOfToday.setHours(0, 0, 0, 0);

  if (normalized.includes("amanha")) {
    const start = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000);
    return {
      startIso: start.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "amanhã",
    };
  }
  if (normalized.includes("hoje")) {
    const end = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1000);
    return {
      startIso: startOfToday.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "hoje",
    };
  }
  if (normalized.includes("esta semana") || normalized.includes("essa semana")) {
    const start = new Date(startOfToday);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: start.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "esta semana",
    };
  }
  if (normalized.includes("proxima semana") || normalized.includes("próxima semana") || normalized.includes("semana que vem")) {
    const start = new Date(startOfToday);
    const day = start.getDay();
    const diffToNextMonday = day === 0 ? 1 : 8 - day;
    start.setDate(start.getDate() + diffToNextMonday);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: start.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "próxima semana",
    };
  }
  if (normalized.includes("proximos 7 dias") || normalized.includes("próximos 7 dias")) {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: startOfToday.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "próximos 7 dias",
    };
  }
  if (isCalendarPeriodListPrompt(prompt)) {
    const end = new Date(startOfToday);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    return {
      startIso: startOfToday.toISOString().replace("Z", "-03:00"),
      endIso: end.toISOString().replace("Z", "-03:00"),
      label: "próximos 7 dias",
    };
  }
  return undefined;
}

export function isCalendarPeriodListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasWeekday = includesAny(normalized, [
    "segunda",
    "terça",
    "terca",
    "quarta",
    "quinta",
    "sexta",
    "sábado",
    "sabado",
    "domingo",
  ]);
  return (
    includesAny(normalized, [
      "liste meus compromissos",
      "liste meus eventos",
      "quais compromissos tenho",
      "quais eventos tenho",
      "qual minha agenda",
      "qual a minha agenda",
      "como esta minha agenda",
      "como está minha agenda",
      "como esta a minha agenda",
      "como está a minha agenda",
      "o que tenho na agenda",
      "o que tenho de agenda",
      "o que tenho essa semana",
      "o que tenho esta semana",
      "o que tenho na proxima semana",
      "o que tenho na próxima semana",
      "minha agenda para",
      "minha agenda da",
      "minha agenda do",
      "mostre minha agenda",
      "mostrar minha agenda",
      "veja minha agenda",
      "veja o calendario",
      "veja o calendário",
      "analise o calendario",
      "analise o calendário",
      "agenda da",
      "agenda do",
    ]) &&
    !normalized.includes("calendario editorial") &&
    !normalized.includes("calendário editorial")
  ) || (
    hasWeekday
    && includesAny(normalized, ["agenda", "calendario", "calendário", "compromisso", "evento"])
    && !normalized.includes("calendario editorial")
    && !normalized.includes("calendário editorial")
  );
}

export function isCalendarConflictReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "conflitos da agenda",
    "conflict",
    "duplicidades da agenda",
    "duplicidade da agenda",
    "eventos duplicados",
    "agenda duplicada",
    "sobreposicao de agenda",
    "sobreposição de agenda",
    "limpeza da agenda",
  ]);
}

export function isCalendarMovePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return /\b(?:mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\b/i.test(normalized)
    && /\b(?:evento|compromisso|reuniao|reunião)\b/i.test(normalized);
}

export function isCalendarPeriodDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "cancele meus compromissos",
    "cancele meus eventos",
    "cancele minha agenda",
    "exclua meus compromissos",
    "exclua meus eventos",
    "apague meus compromissos",
    "apague meus eventos",
    "remova meus compromissos",
    "remova meus eventos",
    "tire meus compromissos",
    "tire meus eventos",
    "limpe minha agenda",
  ]);
}

export function extractCalendarMoveParts(prompt: string): { verb: string; source: string; targetInstruction: string } | undefined {
  const patterns = [
    /\b(mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\s+(?:(?:o|a|um|uma|meu|minha)\s+)?(?:evento|compromisso|reuniao|reunião)\s+(.+?)\s+(?:para|com)\s+([\s\S]+)/i,
    /\b(mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\s+(?:(?:o|a|um|uma|meu|minha)\s+)?(?:evento|compromisso|reuniao|reunião)\s+(.+?)$/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    return {
      verb: match[1].trim(),
      source: match[2].trim(),
      targetInstruction: match[3]?.trim() ?? "",
    };
  }

  return undefined;
}

export function normalizeCalendarUpdateInstruction(input: {
  verb: string;
  targetInstruction: string;
}): string {
  const normalizedVerb = normalizeEmailAnalysisText(input.verb);
  const normalizedTarget = normalizeEmailAnalysisText(input.targetInstruction);

  if (includesAny(normalizedVerb, ["renomeie", "renomear"])) {
    return `titulo: ${input.targetInstruction.trim()}`;
  }

  const looksStructured = includesAny(normalizedTarget, [
    "titulo",
    "título",
    "nome",
    "local",
    "meet",
    "lembrete",
    "convid",
    "particip",
    "duracao",
    "duração",
    "sem local",
    "sem meet",
    "amanha",
    "amanhã",
    "hoje",
    "segunda",
    "terca",
    "terça",
    "quarta",
    "quinta",
    "sexta",
    "sabado",
    "sábado",
    "domingo",
  ]) || /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalizedTarget)
    || /\b\d{1,2}h\b/.test(normalizedTarget)
    || /\bdas\s+\d{1,2}/.test(normalizedTarget)
    || /@/.test(input.targetInstruction);

  if (!looksStructured) {
    return `titulo: ${input.targetInstruction.trim()}`;
  }

  return input.targetInstruction.trim();
}

export function isCalendarDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasDeleteVerb = includesAny(normalized, [
    "cancele",
    "cancela",
    "cancelar",
    "exclua",
    "excluir",
    "delete",
    "apague",
    "apagar",
    "remova",
    "remover",
    "tire",
    "tirar",
  ]);
  const hasCalendarObject = includesAny(normalized, [
    "evento",
    "compromisso",
    "agenda",
    "calendario",
    "calendário",
    "reuniao",
    "reunião",
  ]);
  return (hasDeleteVerb && hasCalendarObject)
    || (includesAny(normalized, ["nao vou mais", "não vou mais"]) && hasCalendarObject);
}

export function extractCalendarDeleteTopic(prompt: string): string | undefined {
  const patterns = [
    /\b(?:cancele|cancela|cancelar|exclua|excluir|delete|apague|apagar|remova|remover|tire|tirar)\s+(?:da\s+(?:minha\s+)?agenda\s+)?(?:o|a|os|as|meu|minha)?\s*(?:evento|compromisso|reuniao|reunião)?\s+["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\s+na\s+conta\b|\s+no\s+calend[aá]rio\b|\s+na\s+agenda\b|\s+se\s+for\s+recorrent|\s+e\s+se\s+for\s+recorrent|\?|$))/i,
    /\b(?:nao vou mais|não vou mais)\s+(?:nesse|nessa|no|na|ao|a[oà])?\s*(?:evento|compromisso|reuniao|reunião)?\s*["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\?|$))/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const topic = cleanCalendarEventTopicReference(match?.[1]);
    if (topic) {
      return topic;
    }
  }
  return undefined;
}

export function cleanCalendarEventTopicReference(value: string | undefined): string | undefined {
  const cleaned = value
    ?.trim()
    .replace(/\s+\bde\s+(?:amanh[ãa]|hoje)\b/gi, "")
    .replace(/\s+em\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, "")
    .replace(/\s+\b(?:amanh[ãa]|hoje)\b/gi, "")
    .replace(/\s+na\s+conta\s+\b(?:primary|principal|abordagem)\b.*$/gi, "")
    .replace(/\s+na\s+\b(?:agenda|abordagem)\b.*$/gi, "")
    .replace(/\s+no\s+calend[aá]rio\b.*$/gi, "")
    .replace(/\s+se\s+for\s+recorrent[ea].*$/gi, "")
    .replace(/\s+e\s+se\s+for\s+recorrent[ea].*$/gi, "")
    .replace(/\s+e\s+apague.*$/gi, "")
    .replace(/\bde$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  const normalized = normalizeEmailAnalysisText(cleaned);
  if ([
    "evento",
    "compromisso",
    "reuniao",
    "reunião",
    "agenda",
    "calendario",
    "calendário",
  ].includes(normalized)) {
    return undefined;
  }

  return cleaned;
}

export function matchesCalendarEventTopic(summary: string, topic: string): boolean {
  const normalizedSummary = normalizeEmailAnalysisText(summary);
  const normalizedTopic = normalizeEmailAnalysisText(topic);
  if (!normalizedSummary || !normalizedTopic) {
    return false;
  }
  if (normalizedSummary.includes(normalizedTopic)) {
    return true;
  }
  const topicTokens = normalizedTopic.split(/\s+/).filter((token) => token.length >= 3);
  return topicTokens.every((token) => normalizedSummary.includes(token));
}

export function extractExplicitAccountAlias(prompt: string, aliases: string[]): string | undefined {
  return extractExplicitGoogleAccountAlias(prompt, aliases);
}

export function resolvePromptAccountAliases(
  prompt: string,
  aliases: string[],
  defaultScope: PersonalOperationalProfile["defaultAgendaScope"] = "both",
): string[] {
  return resolveGoogleAccountAliasesForPrompt(prompt, aliases, defaultScope);
}

export function shouldSearchAllCalendars(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, [
    "todos os calendarios",
    "todos os calendários",
    "todas as agendas",
    "todos os eventos",
    "todas as agendas conectadas",
  ])) {
    return true;
  }

  return normalized.includes("todas")
    && includesAny(normalized, ["agenda", "calendario", "calendário", "eventos", "compromissos"]);
}

export function resolveCalendarTargets(
  workspace: GoogleWorkspaceService,
  prompt: string,
): string[] {
  const explicitCalendarAlias = extractExplicitCalendarAlias(
    prompt,
    Object.keys(workspace.getCalendarAliases()),
  );
  if (explicitCalendarAlias) {
    return [explicitCalendarAlias];
  }

  if (!shouldSearchAllCalendars(prompt)) {
    return [workspace.resolveCalendarId()];
  }

  const calendars = workspace.listConfiguredCalendars()
    .filter((calendar) => calendar.selected !== false)
    .map((calendar) => calendar.id)
    .filter(Boolean);

  return calendars.length > 0 ? [...new Set(calendars)] : [workspace.resolveCalendarId()];
}

export function extractExplicitCalendarAlias(prompt: string, aliases: string[]): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  for (const alias of aliases) {
    const readable = alias.replace(/_/g, " ");
    if (
      normalized.includes(`calendario ${readable}`) ||
      normalized.includes(`calendário ${readable}`) ||
      normalized.includes(`agenda ${readable}`) ||
      normalized.includes(`calendar ${readable}`) ||
      normalized === readable
    ) {
      return alias;
    }
  }

  return undefined;
}

export function extractEmailLookbackHours(prompt: string): number {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (normalized.includes("hoje")) {
    return 24;
  }

  if (normalized.includes("ontem")) {
    return 48;
  }

  if (normalized.includes("esta semana") || normalized.includes("nessa semana")) {
    return 168;
  }

  if (normalized.includes("este mes") || normalized.includes("esse mes")) {
    return 720;
  }

  return 720;
}

export function extractEmailLookupCategory(prompt: string): EmailOperationalGroup | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (normalized.includes("promocional") || normalized.includes("promocao") || normalized.includes("promo")) {
    return "promocional";
  }

  if (normalized.includes("financeiro") || normalized.includes("financeira")) {
    return "financeiro";
  }

  if (normalized.includes("seguranca")) {
    return "seguranca";
  }

  if (
    normalized.includes("email social") ||
    normalized.includes("categoria social") ||
    normalized.includes("social hoje")
  ) {
    return "social";
  }

  if (
    normalized.includes("email profissional") ||
    normalized.includes("categoria profissional") ||
    normalized.includes("email de trabalho") ||
    normalized.includes("trabalho")
  ) {
    return "profissional";
  }

  return undefined;
}

export function cleanSenderQuery(value: string): string {
  return value
    .trim()
    .replace(/^[\"'`]+|[\"'`]+$/g, "")
    .replace(/\s+(?:de hoje|hoje|de ontem|ontem|dessa semana|esta semana|não lido|nao lido).*$/i, "")
    .replace(/\s+e\s+(?:me|redija|gere|crie|fa[cç]a|resuma|envie|mostre|traga|entregue).*$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(o|a)\s+/i, "")
    .trim();
}

export function extractSenderQuery(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const patterns = [
    /(?:email|e-mail)(?:\s+mais\s+recente|\s+mais\s+novo|\s+ultimo|\s+último)?\s+(?:do|da|de)\s+(.+)/i,
    /(?:ultimo|último|mais recente)\s+email\s+(?:do|da|de)\s+(.+)/i,
    /(?:tem|tenho|ha|há|existe)\s+email\s+(?:do|da|de)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const cleaned = cleanSenderQuery(match?.[1] ?? "");
    const normalizedCandidate = normalizeEmailAnalysisText(cleaned);
    if (
      cleaned &&
      !["social", "profissional", "promocional", "promocao", "financeiro", "seguranca"].includes(
        normalizedCandidate,
      )
    ) {
      return cleaned;
    }
  }

  for (const token of ["linkedin", "renner", "supabase", "google", "github", "vercel", "cloudflare"]) {
    if (normalized.includes(token)) {
      return token;
    }
  }

  return undefined;
}

export function extractEmailLookupRequest(prompt: string): EmailLookupRequest | undefined {
  if (extractEmailUidFromPrompt(prompt) !== undefined || !isEmailFocusedPrompt(prompt)) {
    return undefined;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const senderQuery = extractSenderQuery(prompt);
  const category = extractEmailLookupCategory(prompt);
  const existenceOnly =
    normalized.includes("tem email") ||
    normalized.includes("tenho email") ||
    normalized.includes("ha email") ||
    normalized.includes("existe email");
  const latestIntent =
    existenceOnly ||
    [
      "ultimo email",
      "último email",
      "mais recente",
      "me traga",
      "me entregue",
      "mostre",
      "leia",
      "resuma",
    ].some((token) => normalized.includes(token));

  if (!latestIntent && !senderQuery && !category) {
    return undefined;
  }

  return {
    senderQuery,
    category,
    unreadOnly: normalized.includes("nao lido") || normalized.includes("não lido"),
    sinceHours: extractEmailLookbackHours(prompt),
    existenceOnly,
  };
}

export function extractDisplayName(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const bracketIndex = trimmed.indexOf("<");
  const base = bracketIndex >= 0 ? trimmed.slice(0, bracketIndex).trim() : trimmed;
  if (!base || base.includes("@")) {
    return undefined;
  }
  return base;
}

export function inferReplyContext(
  userPrompt: string,
  emailSubject: string,
  emailText: string,
): "pessoal" | "profissional_dev" | "profissional_social" | "autonomo" | "geral" {
  const normalized = `${userPrompt}\n${emailSubject}\n${emailText}`.toLowerCase();

  if (normalized.includes("pessoal")) {
    return "pessoal";
  }

  if (
    ["social", "serviço social", "servico social", "educador", "projeto social", "comunidade"].some((token) =>
      normalized.includes(token),
    )
  ) {
    return "profissional_social";
  }

  if (
    ["autonomo", "autônomo", "cliente", "orçamento", "orcamento", "proposta comercial", "freela"].some((token) =>
      normalized.includes(token),
    )
  ) {
    return "autonomo";
  }

  if (
    ["dev", "saas", "micro-saas", "automação", "automacao", "mvp", "api", "software", "produto digital"].some((token) =>
      normalized.includes(token),
    )
  ) {
    return "profissional_dev";
  }

  return "geral";
}

export function hasAffirmativeIntent(userPrompt: string): boolean {
  const normalized = userPrompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return [
    "sim, quero",
    "sim quero",
    "quero sim",
    "resposta afirmativa",
    "afirmativa",
    "aceitar",
    "aceite",
    "positivo",
    "tenho interesse",
    "aceito",
    "quero conversar",
  ].some((token) => normalized.includes(token));
}

export function hasRejectionIntent(userPrompt: string): boolean {
  const normalized = userPrompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  return [
    "rejeite",
    "rejeitando",
    "recuse",
    "recusando",
    "decline",
    "declinar",
    "nao tenho interesse",
    "não tenho interesse",
    "nao quero",
    "não quero",
  ].some((token) => normalized.includes(token));
}

export function extractToneHint(
  userPrompt: string,
): "formal" | "informal" | "polida" | "rude" | "neutra" {
  const normalized = userPrompt
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (normalized.includes("rude") || normalized.includes("grosseira") || normalized.includes("grosso")) {
    return "rude";
  }
  if (normalized.includes("informal")) {
    return "informal";
  }
  if (normalized.includes("formal")) {
    return "formal";
  }
  if (normalized.includes("polida") || normalized.includes("educada")) {
    return "polida";
  }
  return "neutra";
}

export function buildAffirmativeReplyTemplate(input: {
  recipientName?: string;
  context: "pessoal" | "profissional_dev" | "profissional_social" | "autonomo" | "geral";
  tone: "formal" | "informal" | "polida" | "rude" | "neutra";
}): string {
  const greeting = input.tone === "informal"
    ? input.recipientName
      ? `Oi, ${input.recipientName},`
      : "Oi,"
    : input.recipientName
      ? `Olá, ${input.recipientName},`
      : "Olá,";
  const closing = input.tone === "informal" ? "Abraço." : "Fico à disposição.";

  if (input.tone === "rude") {
    return [
      greeting,
      "",
      "Sim, tenho interesse, mas preciso objetividade.",
      "",
      "Se quiser seguir, envie sua disponibilidade e os pontos centrais sem rodeios. A conversa só faz sentido se vier com clareza e direção prática.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "profissional_dev") {
    return [
      greeting,
      "",
      "Sim, tenho interesse em conversar sobre essa oportunidade.",
      "",
      "O tema faz sentido e vejo espaço para avançarmos com uma proposta objetiva, definindo escopo inicial, prioridades e um caminho enxuto para validação do micro-SaaS.",
      "",
      "Se estiver de acordo, me envie sua disponibilidade e os principais objetivos que você quer acelerar. Assim eu consigo chegar na conversa com uma direção clara e próximos passos práticos.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "profissional_social") {
    return [
      greeting,
      "",
      "Sim, tenho interesse em conversar sobre essa proposta.",
      "",
      "Acredito que vale avançarmos com uma conversa objetiva para entender melhor a demanda, alinhar expectativas e definir os próximos passos de forma responsável.",
      "",
      "Se estiver de acordo, me envie sua disponibilidade e os pontos que considera prioritários. Assim eu consigo me preparar melhor para a conversa.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "autonomo") {
    return [
      greeting,
      "",
      "Sim, tenho interesse em seguir com essa conversa.",
      "",
      "Consigo avançar com uma proposta objetiva, alinhando escopo inicial, forma de entrega e próximos passos para validação.",
      "",
      "Se estiver de acordo, me envie sua disponibilidade e o principal resultado que você espera alcançar. Assim eu consigo estruturar a conversa com mais precisão.",
      "",
      closing,
    ].join("\n");
  }

  if (input.context === "pessoal") {
    return [
      greeting,
      "",
      "Sim, quero conversar sobre isso.",
      "",
      "Acho que vale avançarmos com calma e alinhar melhor os detalhes para entender o melhor caminho.",
      "",
      "Se puder, me envie sua disponibilidade para continuarmos a conversa.",
      "",
      closing,
    ].join("\n");
  }

  return [
    greeting,
    "",
    "Sim, tenho interesse em conversar sobre isso.",
    "",
    "Se estiver de acordo, me envie sua disponibilidade e os principais pontos que você considera importantes para seguirmos com os próximos passos.",
    "",
    closing,
  ].join("\n");
}

export function buildRejectionReplyTemplate(input: {
  recipientName?: string;
  tone: "formal" | "informal" | "polida" | "rude" | "neutra";
}): string {
  const greeting = input.tone === "informal"
    ? input.recipientName
      ? `Oi, ${input.recipientName},`
      : "Oi,"
    : input.recipientName
      ? `Olá, ${input.recipientName},`
      : "Olá,";

  if (input.tone === "rude") {
    return [
      greeting,
      "",
      "Não tenho interesse em seguir com isso.",
      "",
      "Peço que não insista nesse tema.",
    ].join("\n");
  }

  if (input.tone === "informal") {
    return [
      greeting,
      "",
      "Obrigado pelo contato, mas não vou seguir com isso agora.",
      "",
      "De todo modo, agradeço a mensagem.",
    ].join("\n");
  }

  return [
    greeting,
    "",
    "Agradeço o contato e a proposta, mas neste momento não tenho interesse em avançar.",
    "",
    "Obrigado pela compreensão.",
  ].join("\n");
}

export interface InboxTriageItem {
  uid: string;
  date: string | null;
  subject: string;
  from: string[];
  category: string;
  relationship: string;
  persona: string;
  policy: string;
  priority: "alta" | "media" | "baixa";
  status: string;
  action: string;
}

export function extractEmailIdentifier(from: string[]): string | undefined {
  const combined = from.join(" ");
  const match = combined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase();
}

export function buildEmailSummaryReply(input: {
  uid: string;
  subject: string;
  from: string[];
  summary: EmailOperationalSummary;
  routing?: {
    relationship: string;
    persona: string;
    policy: string;
  };
}): string {
  return [
    `Resumo do email UID ${input.uid}`,
    `- Tipo: ${input.summary.category}`,
    ...(input.routing
      ? [
          `- Relação: ${input.routing.relationship}`,
          `- Persona: ${input.routing.persona}`,
          `- Política: ${input.routing.policy}`,
        ]
      : []),
    `- Prioridade: ${input.summary.priority}`,
    `- Status: ${input.summary.status}`,
    `- Remetente: ${input.from.join(", ") || "(desconhecido)"}`,
    `- Assunto: ${input.subject || "(sem assunto)"}`,
    `- Resumo: ${input.summary.summary}`,
    `- Próxima ação: ${input.summary.action}`,
  ].join("\n");
}

export function formatEmailTimestamp(date: string | null): string {
  return date ?? "(data desconhecida)";
}

export function matchesSenderQuery(message: EmailMessageSummary, senderQuery: string): boolean {
  const haystack = normalizeEmailAnalysisText(
    `${message.subject}\n${message.from.join(" ")}\n${message.preview}`,
  );
  const query = normalizeEmailAnalysisText(senderQuery);
  const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
  return tokens.length > 0 ? tokens.every((token) => haystack.includes(token)) : haystack.includes(query);
}

export function buildEmailLookupLabel(request: EmailLookupRequest): string {
  if (request.senderQuery && request.category) {
    return `"${request.senderQuery}" na categoria ${request.category}`;
  }

  if (request.senderQuery) {
    return `"${request.senderQuery}"`;
  }

  if (request.category) {
    return `categoria ${request.category}`;
  }

  return "filtro informado";
}

export function buildEmailLookupMissReply(request: EmailLookupRequest): string {
  return [
    `Não encontrei emails recentes para ${buildEmailLookupLabel(request)}.`,
    `Janela analisada: ${request.sinceHours} horas.`,
    request.unreadOnly ? "Filtro aplicado: somente não lidos." : "Filtro aplicado: lidos e não lidos.",
  ].join("\n");
}

export function buildEmailLookupReply(input: {
  resolved: ResolvedEmailReference & { message: EmailMessageSummary };
  summary: EmailOperationalSummary;
}): string {
  const intro = input.resolved.request.existenceOnly
    ? `Sim. Encontrei ${input.resolved.totalMatches} email(s) recente(s) para ${input.resolved.label}.`
    : `Encontrei ${input.resolved.totalMatches} email(s) recente(s) para ${input.resolved.label}.`;

  return [
    intro,
    "",
    "Mais recente:",
    `- Remetente: ${input.resolved.message.from.join(", ") || "(desconhecido)"}`,
    `- Assunto: ${input.resolved.message.subject || "(sem assunto)"}`,
    `- Recebido em: ${formatEmailTimestamp(input.resolved.message.date)}`,
    `- Tipo: ${input.summary.category}`,
    `- Prioridade: ${input.summary.priority}`,
    `- Status: ${input.summary.status}`,
    `- Próxima ação: ${input.summary.action}`,
    `- Prévia: ${input.resolved.message.preview || "(sem prévia textual)"}`,
  ].join("\n");
}

export function buildCalendarLookupReply(input: {
  request: CalendarLookupRequest;
  eventMatches: Array<{
    account: string;
    summary: string;
    start: string | null;
    location?: string;
    htmlLink?: string;
  }>;
  emailMatches: Array<{
    account: string;
    uid: string;
    subject: string;
    from: string[];
    date: string | null;
  }>;
  timezone: string;
  suggestNextStep: boolean;
}): string {
  const targetLabel = input.request.targetDate?.label ?? "janela informada";
  const topicLabel = input.request.topic ? ` sobre ${input.request.topic}` : "";

  if (input.eventMatches.length > 0) {
    const first = input.eventMatches[0];
    const lines = [
      `Encontrei ${input.eventMatches.length} evento(s)${topicLabel} em ${targetLabel}.`,
      `Mais relevante: ${formatBriefDateTime(first.start, input.timezone)} | ${first.summary}${summarizeCalendarLocation(first.location) ? ` | ${summarizeCalendarLocation(first.location)}` : ""} | conta: ${first.account}`,
    ];
    if (input.suggestNextStep && input.eventMatches.length > 1) {
      lines.push("Próxima ação recomendada: revisar os demais eventos do mesmo dia para confirmar conflito ou contexto.");
    }
    return lines.join("\n");
  }

  const lines = [
    `Não encontrei evento${topicLabel} em ${targetLabel} nas contas Google conectadas.`,
  ];

  if (input.emailMatches.length > 0) {
    const latestEmail = input.emailMatches[0];
    lines.push(
      `Encontrei ${input.emailMatches.length} email(s) relacionado(s)${topicLabel}. Mais recente: ${latestEmail.subject || "(sem assunto)"} | ${latestEmail.from.join(", ") || "(remetente desconhecido)"} | conta: ${latestEmail.account}.`,
    );
    if (input.suggestNextStep) {
      lines.push("Próxima ação recomendada: abrir o email mais recente para confirmar data, horário ou convite.");
    }
    return lines.join("\n");
  }

  if (input.suggestNextStep) {
    lines.push("Próxima ação recomendada: verificar outras contas/calendários ou buscar convites por palavra-chave no email.");
  }
  return lines.join("\n");
}

export function formatBriefDateTime(value: string | null, timezone: string): string {
  if (!value) {
    return "(sem horario)";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatCalendarDayHeader(value: string | null, timezone: string): string {
  if (!value) {
    return "(sem dia)";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const weekday = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
  }).format(date);
  const dayMonth = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);

  return `${weekday[0]?.toUpperCase() ?? ""}${weekday.slice(1)}, ${dayMonth}`;
}

export function formatCalendarTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
  timezone: string,
): string {
  if (!start) {
    return "sem horário";
  }

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    return start;
  }

  const startLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(startDate);

  if (!end) {
    return startLabel;
  }

  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) {
    return startLabel;
  }

  const endLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(endDate);

  return `${startLabel}–${endLabel}`;
}

export function formatTaskDue(task: TaskSummary, timezone: string): string {
  return formatBriefDateTime(task.due ?? task.updated, timezone);
}

export function truncateBriefText(value: string | null | undefined, maxLength = 72): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(sem detalhe)";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

export function summarizeEmailSender(from: string[]): string {
  const primary = from.find((item) => item.trim())?.trim();
  if (!primary) {
    return "(remetente desconhecido)";
  }

  const match = primary.match(/^(.*?)\s*<[^>]+>$/);
  const label = match?.[1]?.replace(/^"+|"+$/g, "").trim() || primary;
  return truncateBriefText(label, 28);
}

export function isOperationalNoise(value: string | null | undefined): boolean {
  const normalized = normalizeEmailAnalysisText(value ?? "");
  if (!normalized) {
    return false;
  }

  return includesAny(normalized, [
    "teste controlado",
    "shopee",
    "lojas oficiais",
    "newsletter",
    "digest",
    "read online",
    "renegocia aqui",
    "oferta do dia",
    "cupom",
    "liquidacao",
    "sale",
  ]);
}

export interface MorningBriefEmailItem {
  account: string;
  uid: string;
  subject: string;
  from: string[];
  priority: string;
  action: string;
  relationship: string;
  group: EmailOperationalGroup;
}

export interface MorningTaskBuckets {
  today: Array<TaskSummary & { account: string }>;
  overdue: Array<TaskSummary & { account: string }>;
  stale: Array<TaskSummary & { account: string }>;
  actionableCount: number;
}

export function getBriefDayKey(date: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

export function diffDayKeys(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

export function classifyMorningTaskBucket(
  task: TaskSummary & { account: string },
  timezone: string,
): "today" | "overdue" | "stale" {
  const nowKey = getBriefDayKey(new Date(), timezone);
  const dueDate = task.due ? new Date(task.due) : null;

  if (dueDate) {
    const dueKey = getBriefDayKey(dueDate, timezone);
    if (dueKey === nowKey) {
      return "today";
    }
    if (dueKey < nowKey) {
      return diffDayKeys(nowKey, dueKey) > 7 ? "stale" : "overdue";
    }
    return "today";
  }

  const updatedDate = task.updated ? new Date(task.updated) : null;
  if (!updatedDate) {
    return "today";
  }

  const updatedKey = getBriefDayKey(updatedDate, timezone);
  return diffDayKeys(nowKey, updatedKey) > 14 ? "stale" : "today";
}

export function buildMorningTaskBuckets(
  tasks: Array<TaskSummary & { account: string }>,
  timezone: string,
): MorningTaskBuckets {
  const sorted = [...tasks].sort((left, right) =>
    (left.due ?? left.updated ?? "").localeCompare(right.due ?? right.updated ?? ""),
  );
  const buckets: MorningTaskBuckets = {
    today: [],
    overdue: [],
    stale: [],
    actionableCount: 0,
  };

  for (const task of sorted) {
    const bucket = classifyMorningTaskBucket(task, timezone);
    buckets[bucket].push(task);
  }

  buckets.actionableCount = buckets.today.length + buckets.overdue.length;
  return buckets;
}

export function describeFounderSectionStatus(section: FounderOpsSnapshot["sections"][number]): string {
  const statusLabel = section.status === "connected" ? "conectado" : "aguardando integração";
  return `${section.title}: ${statusLabel} — ${section.summary}`;
}

export function summarizeTrackedMetrics(metrics: string[]): string {
  if (metrics.length === 0) {
    return "";
  }

  const visible = metrics.slice(0, 6).join(", ");
  const hidden = metrics.length - 6;
  return hidden > 0 ? `${visible} e mais ${hidden}` : visible;
}

export function labelBriefOwner(owner: "paulo" | "equipe" | "delegavel"): string {
  switch (owner) {
    case "paulo":
      return "Paulo";
    case "equipe":
      return "Equipe";
    case "delegavel":
      return "Delegável";
  }
}

export function formatBriefTemperature(value?: number): string {
  return typeof value === "number" ? `${Math.round(value)}°C` : "?";
}

export function formatBriefTemperatureRange(min?: number, max?: number): string {
  if (typeof min === "number" && typeof max === "number") {
    return `${Math.round(min)}° a ${Math.round(max)}°C`;
  }
  if (typeof max === "number") {
    return `máx ${Math.round(max)}°C`;
  }
  if (typeof min === "number") {
    return `mín ${Math.round(min)}°C`;
  }
  return "?";
}

export function emailRelationshipWeight(relationship: string): number {
  switch (relationship) {
    case "family":
    case "partner":
    case "client":
    case "lead":
    case "social_case":
      return 18;
    case "colleague":
    case "vendor":
      return 10;
    case "friend":
      return 8;
    case "unknown":
      return 2;
    case "spam":
      return -50;
    default:
      return 0;
  }
}

export function chooseMorningNextAction(input: {
  timezone: string;
  events: Array<{ summary: string; start: string | null }>;
  taskBuckets: MorningTaskBuckets;
  emails: MorningBriefEmailItem[];
  approvals: Array<{ subject: string; actionKind: string; channel: string }>;
  workflows: Array<{ id: number; title: string; status: string; nextAction: string | null }>;
  focus: Array<{ title: string; nextAction: string }>;
}): string | undefined {
  const candidates: Array<{ score: number; text: string }> = [];
  const nextEvent = input.events[0];
  if (nextEvent?.start) {
    const minutesUntil = Math.round((new Date(nextEvent.start).getTime() - Date.now()) / (60 * 1000));
    const eventScore = minutesUntil <= 45
      ? 100
      : minutesUntil <= 120
        ? 94
        : minutesUntil <= 240
          ? 84
          : 70;
    candidates.push({
      score: eventScore,
      text: `Preparar o compromisso das ${formatBriefDateTime(nextEvent.start, input.timezone)}: ${truncateBriefText(nextEvent.summary, 52)}.`,
    });
  }

  const topEmail = input.emails[0];
  if (topEmail) {
    const baseScore = topEmail.priority === "alta" ? 88 : 66;
    const groupBoost = topEmail.group === "seguranca" ? 12 : topEmail.group === "financeiro" ? 8 : 0;
    candidates.push({
      score: baseScore + groupBoost + emailRelationshipWeight(topEmail.relationship),
      text: `Responder ou validar o email prioritário: ${truncateBriefText(topEmail.subject || "(sem assunto)", 56)}.`,
    });
  }

  const overdueTask = input.taskBuckets.overdue[0];
  if (overdueTask) {
    candidates.push({
      score: 86,
      text: `Destravar a tarefa atrasada: ${truncateBriefText(overdueTask.title, 56)}.`,
    });
  }

  const todayTask = input.taskBuckets.today[0];
  if (todayTask) {
    candidates.push({
      score: 72,
      text: `Atacar a tarefa de hoje: ${truncateBriefText(todayTask.title, 56)}.`,
    });
  }

  if (input.approvals.length > 0) {
    candidates.push({
      score: 55 + Math.min(12, input.approvals.length * 2),
      text: `Revisar a aprovação mais urgente no Telegram: ${truncateBriefText(input.approvals[0].subject, 56)}.`,
    });
  }

  if (input.workflows[0]?.nextAction) {
    candidates.push({
      score: 36,
      text: truncateBriefText(input.workflows[0].nextAction, 96),
    });
  }

  if (input.focus[0]?.nextAction) {
    candidates.push({
      score: 28,
      text: truncateBriefText(input.focus[0].nextAction, 96),
    });
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.text;
}

export function buildOperationalBriefReply(input: {
  brief: DailyOperationalBrief;
  focus: Array<{ title: string; whyNow: string; nextAction: string }>;
}): string {
  const nextEvent = input.brief.events[0];
  const nextTask = input.brief.tasks[0];
  const lines = [
    `Hoje teu dia tem ${input.brief.events.length} ${input.brief.events.length === 1 ? "compromisso" : "compromissos"}, ${input.brief.tasks.length} ${input.brief.tasks.length === 1 ? "tarefa" : "tarefas"} e ${input.focus.length} ${input.focus.length === 1 ? "frente em foco" : "frentes em foco"}.`,
  ];

  if (nextEvent) {
    lines.push(`O próximo compromisso é ${formatBriefDateTime(nextEvent.start, input.brief.timezone)} — ${nextEvent.summary}${nextEvent.location ? ` — ${nextEvent.location}` : ""}.`);
  }
  if (nextTask) {
    lines.push(`A tarefa que mais pede atenção agora é ${nextTask.title} — ${formatTaskDue(nextTask, input.brief.timezone)}.`);
  }
  if (input.focus[0]) {
    lines.push(`Teu foco agora é ${input.focus[0].title} — ${input.focus[0].nextAction}.`);
  }

  if (!nextEvent && !nextTask && input.focus.length === 0) {
    lines.push("Hoje está mais leve até aqui.");
  }

  if (input.brief.events.length > 0) {
    lines.push("", "Agenda mais próxima:");
    for (const event of input.brief.events.slice(0, 4)) {
      lines.push(
        `- ${formatBriefDateTime(event.start, input.brief.timezone)} — ${event.summary}${event.location ? ` — ${event.location}` : ""}`,
      );
    }
  }

  if (input.brief.tasks.length > 0) {
    lines.push("", "Tarefas que valem olhar:");
    for (const task of input.brief.tasks.slice(0, 4)) {
      lines.push(`- ${task.title} — ${task.taskListTitle} — ${formatTaskDue(task, input.brief.timezone)}`);
    }
  }

  if (input.focus.length > 1) {
    lines.push("", "Outras frentes:");
    for (const item of input.focus.slice(0, 3)) {
      lines.push(`- ${item.title} — ${item.nextAction}`);
    }
  }

  return lines.join("\n");
}

export function classifyBriefPeriod(iso: string | null | undefined, timezone: string): "manha" | "tarde" | "noite" | "sem_horario" {
  if (!iso) {
    return "sem_horario";
  }
  const local = new Date(new Date(iso).toLocaleString("en-US", { timeZone: timezone }));
  const hour = local.getHours();
  if (hour < 12) {
    return "manha";
  }
  if (hour < 18) {
    return "tarde";
  }
  return "noite";
}

export function buildMorningBriefReply(
  input: ExecutiveMorningBrief,
  options?: {
    compact?: boolean;
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
  },
): string {
  const renderer = new BriefRenderer();
  if (options?.compact === true || options?.operationalMode === "field") {
    return renderer.renderCompact(input);
  }
  return renderer.render(input);
}

export function buildMacQueueStatusReply(input: {
  status: {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    targetHost: string;
    commandsTable: string;
    workersTable: string;
    message: string;
  };
}): string {
  return [
    "Status da fila remota do Mac:",
    `- Enabled: ${input.status.enabled ? "sim" : "não"}`,
    `- Configurada: ${input.status.configured ? "sim" : "não"}`,
    `- Pronta: ${input.status.ready ? "sim" : "não"}`,
    `- Target host: ${input.status.targetHost}`,
    `- Tabela de comandos: ${input.status.commandsTable}`,
    `- Tabela de workers: ${input.status.workersTable}`,
    `- Mensagem: ${input.status.message}`,
  ].join("\n");
}

export function buildMacQueueListReply(items: Array<{ id: string; summary: string; status: string; createdAt: string }>): string {
  if (items.length === 0) {
    return "Não encontrei comandos pendentes na fila do Mac.";
  }

  return [
    `Comandos pendentes na fila do Mac: ${items.length}.`,
    ...items.map((item) => `- ${item.summary} | status: ${item.status} | id: ${item.id}`),
  ].join("\n");
}

export function buildMacQueueEnqueueReply(input: { id: string; summary: string; targetHost?: string }): string {
  return [
    "Comando enfileirado para o Mac.",
    `- Resumo: ${input.summary}`,
    `- ID: ${input.id}`,
    `- Target host: ${input.targetHost ?? "atlas_mac"}`,
  ].join("\n");
}

export function buildGoogleTasksReply(input: {
  timezone: string;
  tasks: Array<TaskSummary & { account: string }>;
}): string {
  if (input.tasks.length === 0) {
    return "Nao encontrei tarefas abertas no Google Tasks para os filtros atuais.";
  }

  return [
    `Tarefas do Google encontradas: ${input.tasks.length}.`,
    ...input.tasks.slice(0, 12).map((task) =>
      `- ${task.title || "(sem titulo)"} (${task.taskListTitle}) | conta: ${task.account} | status: ${task.status} | prazo: ${formatTaskDue(task, input.timezone)}`,
    ),
  ].join("\n");
}

export function buildGoogleContactsReply(input: {
  query: string;
  contacts: Array<{
    account: string;
    displayName: string;
    emailAddresses: string[];
    phoneNumbers: string[];
    organizations: string[];
  }>;
}): string {
  if (input.contacts.length === 0) {
    return `Nao encontrei contatos no Google para a busca: ${input.query}.`;
  }

  return [
    `Contatos encontrados para "${input.query}": ${input.contacts.length}.`,
    ...input.contacts.slice(0, 10).map((contact) =>
      `- ${contact.displayName} | conta: ${contact.account}${contact.phoneNumbers.length ? ` | telefones: ${contact.phoneNumbers.join(", ")}` : ""}${contact.emailAddresses.length ? ` | emails: ${contact.emailAddresses.join(", ")}` : ""}${contact.organizations.length ? ` | orgs: ${contact.organizations.join(", ")}` : ""}`,
    ),
  ].join("\n");
}

export function buildGoogleCalendarsReply(input: {
  calendars: Array<{ account: string; calendars: CalendarListSummary[] }>;
}): string {
  const total = input.calendars.reduce((acc, item) => acc + item.calendars.length, 0);
  if (total === 0) {
    return "Não encontrei calendários disponíveis nas contas Google conectadas.";
  }

  const lines = [`Calendários disponíveis: ${total}.`];
  for (const group of input.calendars) {
    lines.push(`Conta ${group.account}: ${group.calendars.length}.`);
    for (const calendar of group.calendars.slice(0, 12)) {
      const tags = [
        calendar.primary ? "principal" : undefined,
        calendar.selected ? "visível" : undefined,
        calendar.accessRole ? `acesso: ${calendar.accessRole}` : undefined,
      ].filter(Boolean);
      lines.push(`- ${calendar.summary} | id: ${calendar.id}${tags.length ? ` | ${tags.join(" | ")}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function labelAgendaScope(scope: PersonalOperationalProfile["defaultAgendaScope"]): string {
  switch (scope) {
    case "primary":
      return "principal";
    case "work":
      return "trabalho";
    case "both":
    default:
      return "ambos";
  }
}

export function buildEmptyCalendarPeriodReply(label: string): string {
  const normalized = normalizeEmailAnalysisText(label);
  if (normalized === "amanha" || normalized === "amanhã") {
    return "Nenhum compromisso para amanhã.";
  }
  if (normalized === "hoje") {
    return "Nenhum compromisso para hoje.";
  }
  return `Nenhum compromisso em ${label}.`;
}

export function buildCalendarPeriodReply(input: {
  label: string;
  timezone: string;
  compact?: boolean;
  events: Array<{
    account: string;
    event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number];
  }>;
}): string {
  if (input.events.length === 0) {
    return buildEmptyCalendarPeriodReply(input.label);
  }

  const sortedEvents = [...input.events].sort((left, right) => {
    const leftStart = left.event.start ? Date.parse(left.event.start) : Number.MAX_SAFE_INTEGER;
    const rightStart = right.event.start ? Date.parse(right.event.start) : Number.MAX_SAFE_INTEGER;
    if (leftStart !== rightStart) {
      return leftStart - rightStart;
    }
    return left.event.summary.localeCompare(right.event.summary);
  });

  const lines = [
    `${input.label[0]?.toUpperCase() ?? ""}${input.label.slice(1)}: ${sortedEvents.length} compromisso${sortedEvents.length > 1 ? "s" : ""}.`,
  ];
  let currentDayHeader: string | null = null;

  for (const item of sortedEvents) {
    const dayHeader = formatCalendarDayHeader(item.event.start, input.timezone);
    if (dayHeader !== currentDayHeader) {
      lines.push("", `${dayHeader}:`);
      currentDayHeader = dayHeader;
    }

    const location = summarizeCalendarLocation(item.event.location);
    const tags = input.compact
      ? []
      : [`conta: ${item.account}`];

    lines.push(
      `- ${formatCalendarTimeRange(item.event.start, item.event.end, input.timezone)} — ${item.event.summary}${location ? ` — ${location}` : ""}${tags.length > 0 ? ` | ${tags.join(" | ")}` : ""}`,
    );
  }

  return lines.join("\n");
}

export function summarizeCalendarLocation(value: string | undefined): string | undefined {
  const normalized = value
    ?.replace(/\s*\n+\s*/g, " | ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return undefined;
  }
  const compact = normalized.split(" | ")[0]?.trim() || normalized;
  return compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
}

export function buildPlaceLookupReply(result: GooglePlaceLookupResult): string {
  const lines = [
    `Local encontrado: ${result.name ?? result.formattedAddress}.`,
    `Endereço: ${result.formattedAddress}.`,
  ];
  if (result.mapsUrl) {
    lines.push(`Maps: ${result.mapsUrl}`);
  }
  lines.push("Se quiser, eu adiciono isso ao seu calendário ou salvo como referência.");
  return lines.join("\n");
}

export function buildPlaceDiscoveryReply(input: {
  categoryLabel: string;
  locationQuery: string;
  results: GooglePlaceLookupResult[];
}): string {
  if (input.results.length === 0) {
    return `Não encontrei ${input.categoryLabel} com segurança perto de ${input.locationQuery}. Se quiser, me diga outro ponto de referência ou bairro.`;
  }

  return [
    `Encontrei ${input.results.length} opção(ões) de ${input.categoryLabel} perto de ${input.locationQuery}.`,
    ...input.results.slice(0, 4).map((item, index) => {
      const label = item.name ?? item.shortFormattedAddress ?? item.formattedAddress;
      const address = item.shortFormattedAddress ?? item.formattedAddress;
      return `${index + 1}. ${label} — ${address}${item.mapsUrl ? ` | Maps: ${item.mapsUrl}` : ""}`;
    }),
    "Se quiser, eu comparo melhor essas opções ou uso uma delas no teu calendário/roteiro.",
  ].join("\n");
}

export function buildUserPreferencesReply(preferences: UserPreferences): string {
  return [
    "Preferências ativas:",
    `- Estilo: ${preferences.responseStyle}`,
    `- Tamanho: ${preferences.responseLength}`,
    `- Próxima ação sugerida: ${preferences.proactiveNextStep ? "sim" : "não"}`,
    `- Fallback automático de fontes: ${preferences.autoSourceFallback ? "sim" : "não"}`,
    `- Nome do agente: ${preferences.preferredAgentName}`,
  ].join("\n");
}

export function buildPersonalOperationalProfileReply(profile: PersonalOperationalProfile): string {
  return [
    "Perfil operacional base:",
    `- Nome: ${profile.displayName}`,
    `- Papel principal: ${profile.primaryRole}`,
    `- Fuso: ${profile.timezone}`,
    `- Canais preferidos: ${profile.preferredChannels.join(" | ")}`,
    `- Canal preferido de alerta: ${profile.preferredAlertChannel ?? "não definido"}`,
    `- Endereço base: ${profile.homeAddress ? `${profile.homeLocationLabel ?? "casa"} salvo` : "não definido"}`,
    `- Veículo padrão: ${profile.defaultVehicle?.name ?? "não definido"}${profile.defaultVehicle?.consumptionKmPerLiter ? ` | ${profile.defaultVehicle.consumptionKmPerLiter.toFixed(1).replace(".", ",")} km/l` : ""}${profile.defaultVehicle?.fuelType ? ` | ${profile.defaultVehicle.fuelType}` : ""}`,
    `- Preço combustível padrão: ${profile.defaultFuelPricePerLiter ? `R$ ${profile.defaultFuelPricePerLiter.toFixed(2).replace(".", ",")}/l` : "não definido"}`,
    `- Estilo de resposta: ${profile.responseStyle}`,
    `- Briefing da manhã: ${profile.briefingPreference}`,
    `- Nível de detalhe: ${profile.detailLevel}`,
    `- Tom: ${profile.tonePreference}`,
    `- Modo padrão: ${profile.defaultOperationalMode === "field" ? "plantão/rua" : "normal"}`,
    `- Escopo padrão de agenda: ${labelAgendaScope(profile.defaultAgendaScope)}`,
    `- Áreas prioritárias: ${profile.priorityAreas.length > 0 ? profile.priorityAreas.slice(0, 3).join(" | ") : "não definidas"}`,
    `- Rotina principal: ${profile.routineSummary.length > 0 ? profile.routineSummary.slice(0, 3).join(" | ") : "não definida"}`,
    `- Deslocamento: ${profile.mobilityPreferences.length > 0 ? profile.mobilityPreferences.slice(0, 3).join(" | ") : "nenhuma preferência extra"}`,
    `- Itens físicos: ${profile.attire.carryItems.join(" | ")}`,
    `- Regras fixas: ${profile.operationalRules.slice(0, 3).join(" | ")}`,
    `- Autonomia: ${profile.autonomyPreferences.slice(0, 3).join(" | ")}`,
  ].join("\n");
}

export function buildPersonalOperationalProfileUpdatedReply(
  profile: PersonalOperationalProfile,
  changeLabels: string[],
): string {
  return [
    "Perfil operacional atualizado.",
    ...changeLabels.slice(0, 6).map((item) => `- ${item}`),
    "",
    buildPersonalOperationalProfileReply(profile),
  ].join("\n");
}

export function buildPersonalOperationalProfileRemovedReply(
  profile: PersonalOperationalProfile,
  removedLabels: string[],
): string {
  return [
    "Perfil operacional ajustado.",
    ...removedLabels.map((item) => `- Removido: ${item}`),
    "",
    buildPersonalOperationalProfileReply(profile),
  ].join("\n");
}

export function buildOperationalStateReply(state: OperationalState): string {
  const formatStateCommitment = (item: OperationalState["upcomingCommitments"][number]) =>
    item.start
      ? `${truncateBriefText(item.summary, 70)} (${stateDateTimeLabel(item.start) ?? item.start})`
      : truncateBriefText(item.summary, 70);
  const activeSignals = state.signals.filter((item) => item.active);

  return [
    "Estado operacional atual:",
    `- Modo: ${state.mode === "field" ? "plantão/rua" : "normal"}${state.modeReason ? ` | motivo: ${state.modeReason}` : ""}`,
    `- Foco atual: ${state.focus.length > 0 ? state.focus.slice(0, 3).join(" | ") : "nenhum foco explícito"}`,
    `- Prioridades da semana: ${state.weeklyPriorities.length > 0 ? state.weeklyPriorities.slice(0, 3).join(" | ") : "não definidas"}`,
    `- Alertas pendentes: ${state.pendingAlerts.length > 0 ? state.pendingAlerts.slice(0, 3).join(" | ") : "nenhum alerta pendente"}`,
    `- Tarefas críticas: ${state.criticalTasks.length > 0 ? state.criticalTasks.slice(0, 3).join(" | ") : "nenhuma tarefa crítica"}`,
    `- Próximos compromissos: ${state.upcomingCommitments.length > 0 ? state.upcomingCommitments.slice(0, 3).map((item) => formatStateCommitment(item)).join(" | ") : "nenhum compromisso marcado"}`,
    `- Risco principal: ${state.primaryRisk ?? "nenhum risco destacado"}`,
    `- Sinais operacionais: ${activeSignals.length > 0 ? activeSignals.slice(0, 3).map((item) => `${item.summary} (${item.priority})`).join(" | ") : "nenhum sinal ativo"}`,
    `- Briefing: ${state.briefing.nextAction ?? "sem próxima ação"}${state.briefing.overloadLevel ? ` | carga ${state.briefing.overloadLevel}` : ""}`,
    `- Canal atual: ${state.activeChannel ?? "não registrado"}`,
    `- Canal preferido de alerta: ${state.preferredAlertChannel ?? "não registrado"}`,
    `- Aprovações pendentes: ${state.pendingApprovals}`,
    `- Atualizado em: ${state.updatedAt}`,
  ].join("\n");
}

export function stateDateTimeLabel(value: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatLearnedPreferenceTypeLabel(type: LearnedPreference["type"]): string {
  switch (type) {
    case "schedule_import_mode":
      return "Importação de agenda";
    case "agenda_scope":
      return "Escopo de agenda";
    case "response_style":
      return "Estilo de resposta";
    case "channel_preference":
      return "Canal";
    case "calendar_interpretation":
      return "Interpretação de agenda";
    case "visual_task":
      return "Tarefa visual";
    case "alert_action":
      return "Ação de alerta";
    case "other":
    default:
      return "Aprendizado";
  }
}

export function buildLearnedPreferencesReply(items: LearnedPreference[]): string {
  if (items.length === 0) {
    return "Ainda não encontrei aprendizados operacionais ativos sobre você.";
  }

  return [
    `Aprendizados operacionais ativos: ${items.length}.`,
    ...items.slice(0, 10).map((item) =>
      `- #${item.id} | ${formatLearnedPreferenceTypeLabel(item.type)} | ${item.description} => ${item.value} | confiança ${Math.round(item.confidence * 100)}% | confirmações ${item.confirmations}`,
    ),
  ].join("\n");
}

export function buildLearnedPreferenceDeactivatedReply(item: LearnedPreference): string {
  return [
    "Preferência aprendida desativada.",
    `- #${item.id} | ${formatLearnedPreferenceTypeLabel(item.type)} | ${item.description} => ${item.value}`,
  ].join("\n");
}

export function buildCapabilityGapSignature(plan: CapabilityPlan): string {
  const missingCapabilities = [...new Set(plan.missingRequirements
    .filter((item) => item.kind !== "user_data")
    .map((item) => item.name))]
    .sort();
  const missingUserData = [...new Set(plan.missingUserData)].sort();

  return [
    plan.objective,
    missingCapabilities.join("|") || "no_capability_gap",
    missingUserData.join("|") || "no_user_data_gap",
  ].join("::");
}

export function formatCapabilityObjectiveLabel(objective: CapabilityPlan["objective"]): string {
  switch (objective) {
    case "travel_cost_estimate":
      return "estimar o custo da viagem";
    case "route_distance":
      return "calcular a distância da rota";
    case "route_tolls":
      return "estimar pedágios da rota";
    case "place_discovery":
      return "buscar lugares próximos";
    case "flight_search":
      return "pesquisar passagens aéreas";
    case "bus_search":
      return "pesquisar passagens de ônibus";
    case "hotel_search":
      return "pesquisar hospedagem";
    case "recent_information_lookup":
      return "buscar informação recente na web";
    case "web_comparison":
      return "comparar isso com fontes na web";
    case "source_validation":
      return "validar isso em fontes externas";
    default:
      return objective.replace(/_/g, " ");
  }
}

export function formatDurationMinutes(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${minutes} min`;
}

export function formatKilometers(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: km >= 100 ? 0 : 1,
    maximumFractionDigits: km >= 100 ? 0 : 1,
  }).format(km);
}

export function formatMoneyAmount(currencyCode: string, amount: number): string {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

export function buildCapabilityAvailabilityReply(items: CapabilityAvailabilityRecord[]): string {
  const relevant = items
    .filter((item) => item.availability !== "available")
    .slice(0, 12);

  if (relevant.length === 0) {
    return "Hoje eu não tenho lacunas abertas de capability que valham destaque. O que já está ligado no Atlas está disponível.";
  }

  return [
    "Hoje estas capabilities ainda estão faltando ou parciais no Atlas:",
    ...relevant.map((item) =>
      `- ${item.name} | ${item.availability} | ${item.reason}`,
    ),
  ].join("\n");
}

export function buildProductGapsReply(items: ProductGapRecord[]): string {
  if (items.length === 0) {
    return "Não encontrei gaps de capability recentes registrados pelo uso.";
  }

  return [
    `Gaps recentes identificados pelo uso: ${items.length}.`,
    ...items.slice(0, 10).map((item) => {
      const missing = item.missingCapabilities.length > 0
        ? item.missingCapabilities.join(" | ")
        : "sem capability nomeada";
      return `- #${item.id} | ${item.inferredObjective} | faltou: ${missing} | recorrência ${item.recurrence} | status ${item.status}`;
    }),
  ].join("\n");
}

export function buildCapabilityPlanUserDataReply(plan: CapabilityPlan): string {
  const fields = plan.missingUserData.join(" e ");
  const goalLine = plan.alignedGoals?.[0]
    ? ` Isso conversa com teu objetivo ativo: ${plan.alignedGoals[0]}.`
    : "";
  switch (plan.objective) {
    case "travel_cost_estimate":
      return `Consigo seguir com essa estimativa. Me passe só ${fields}.${goalLine}`;
    case "route_distance":
    case "route_tolls":
      return `Consigo calcular isso. Só preciso de ${fields}.${goalLine}`;
    case "place_discovery":
      return `Consigo buscar isso no mapa. Me passe só ${fields}.${goalLine}`;
    case "flight_search":
    case "bus_search":
    case "hotel_search":
      return `Consigo pesquisar isso. Me passe só ${fields}.${goalLine}`;
    default:
      return `Consigo seguir com isso. Me passe só ${fields}.${goalLine}`;
  }
}

export function buildCapabilityGapReply(plan: CapabilityPlan, gap?: ProductGapRecord): string {
  const missingCapabilities = [...new Set(plan.missingRequirements
    .filter((item) => item.kind !== "user_data")
    .map((item) => item.label))];
  const missingData = [...new Set(plan.missingUserData)];
  const lines = [
    `Entendi que você quer ${formatCapabilityObjectiveLabel(plan.objective)}.`,
  ];

  if (plan.alignedGoals?.[0]) {
    lines.push(`Isso impacta diretamente o objetivo ativo: ${plan.alignedGoals[0]}.`);
  }

  if (missingCapabilities.length > 0) {
    lines.push(
      `Hoje eu ainda não consigo fechar isso sozinho no Atlas porque me faltam ${missingCapabilities.join(", ")}.`,
    );
  }

  if (missingData.length > 0) {
    lines.push(
      `Se você quiser seguir agora mesmo, me passe só: ${missingData.join(" e ")}.`,
    );
  } else {
    lines.push("Se quiser, eu sigo com o melhor caminho alternativo com os dados que você tiver.");
  }

  if (gap) {
    lines.push(`Deixei isso registrado como lacuna real do Atlas (#${gap.id}) para priorizar depois.`);
  }

  return lines.join(" ");
}

export function buildProductGapDetailReply(item: ProductGapRecord): string {
  const missing = item.missingCapabilities.length > 0
    ? item.missingCapabilities.join(", ")
    : "uma capability ainda não implementada";
  const lines = [
    `No caso mais recente, eu não consegui fechar isso sozinho porque me faltaram ${missing}.`,
    `Objetivo que eu inferi: ${item.inferredObjective}.`,
  ];

  if (item.contextSummary) {
    lines.push(item.contextSummary);
  }

  if (item.recurrence > 1) {
    lines.push(`Isso já apareceu ${item.recurrence} vezes no uso real.`);
  }

  return lines.join(" ");
}

export function buildMapsRouteReply(input: {
  objective: CapabilityPlan["objective"];
  route: GoogleRouteLookupResult;
  roundTrip?: boolean;
  fuelPricePerLiter?: number;
  consumptionKmPerLiter?: number;
  alignedGoal?: string;
}): string {
  const lines: string[] = [];
  const multiplier = input.roundTrip ? 2 : 1;
  const baseDistanceKm = input.route.distanceMeters / 1000;
  const effectiveDistanceMeters = input.route.distanceMeters * multiplier;
  const effectiveDurationSeconds = input.route.durationSeconds * multiplier;
  const distanceLabel = input.roundTrip
    ? `${formatKilometers(effectiveDistanceMeters)} km ida e volta`
    : input.route.localizedDistanceText?.trim() || `${formatKilometers(input.route.distanceMeters)} km`;
  const durationLabel = input.roundTrip
    ? `${formatDurationMinutes(effectiveDurationSeconds)} no total`
    : input.route.localizedDurationText?.trim() || formatDurationMinutes(input.route.durationSeconds);
  const routeLabel = input.roundTrip ? "ida" : "rota";

  if (input.objective === "route_distance") {
    lines.push(
      `A ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress} fica em ${distanceLabel} e leva perto de ${durationLabel}.`,
    );
  } else if (input.objective === "route_tolls") {
    if (!input.route.hasTolls) {
      lines.push(
        `Na ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress}, não encontrei pedágios esperados.`,
      );
    } else if (input.route.tollPriceKnown && input.route.tolls && input.route.tolls.length > 0) {
      const tollSummary = input.route.tolls
        .map((item) => formatMoneyAmount(item.currencyCode, item.amount * multiplier))
        .join(" | ");
      lines.push(
        `Na ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress}, o pedágio estimado fica em ${tollSummary}.`,
      );
    } else {
      lines.push(
        `A ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress} parece ter pedágio, mas o valor estimado não veio dessa consulta.`,
      );
    }
    lines.push(`Distância: ${distanceLabel}. Tempo estimado: ${durationLabel}.`);
  } else {
    lines.push(
      `A ${routeLabel} entre ${input.route.origin.formattedAddress} e ${input.route.destination.formattedAddress} fica em ${distanceLabel} e leva perto de ${durationLabel}.`,
    );

    if (
      typeof input.fuelPricePerLiter === "number"
      && typeof input.consumptionKmPerLiter === "number"
      && input.consumptionKmPerLiter > 0
    ) {
      const distanceKm = baseDistanceKm * multiplier;
      const litersNeeded = distanceKm / input.consumptionKmPerLiter;
      const fuelCost = litersNeeded * input.fuelPricePerLiter;
      lines.push(
        `Com consumo médio de ${input.consumptionKmPerLiter.toFixed(1).replace(".", ",")} km/l e combustível a ${formatMoneyAmount("BRL", input.fuelPricePerLiter)}, o gasto estimado com combustível fica em ${formatMoneyAmount("BRL", fuelCost)}.`,
      );

      if (input.route.hasTolls) {
        if (input.route.tollPriceKnown && input.route.tolls && input.route.tolls.length > 0) {
          const brlToll = input.route.tolls.find((item) => item.currencyCode === "BRL") ?? input.route.tolls[0];
          if (brlToll.currencyCode === "BRL") {
            const totalCost = fuelCost + (brlToll.amount * multiplier);
            lines.push(
              `Com pedágio, o total estimado fica em ${formatMoneyAmount(brlToll.currencyCode, totalCost)}.`,
            );
          } else {
            lines.push(
              `Pedágio estimado: ${formatMoneyAmount(brlToll.currencyCode, brlToll.amount * multiplier)}.`,
            );
          }
        } else {
          lines.push("A rota parece ter pedágio, mas o valor não veio estimado nesta resposta.");
        }
      }
    }
  }

  if (input.route.warnings.length > 0) {
    lines.push(`Atenção: ${input.route.warnings[0]}.`);
  }
  if (input.alignedGoal) {
    lines.push(`Isso ajuda diretamente no objetivo ativo: ${input.alignedGoal}.`);
  }
  lines.push(`Maps: ${input.route.mapsUrl}`);
  return lines.join(" ");
}

export function formatPersonalMemoryKindLabel(kind: PersonalOperationalMemoryItemKind): string {
  switch (kind) {
    case "preference":
      return "Preferência";
    case "routine":
      return "Rotina";
    case "rule":
      return "Regra";
    case "packing":
      return "Itens";
    case "mobility":
      return "Deslocamento";
    case "context":
      return "Contexto";
    case "focus":
      return "Foco";
    case "note":
    default:
      return "Nota";
  }
}

export function buildPersonalMemoryListReply(input: {
  profile: ReturnType<PersonalOperationalMemoryStore["getProfile"]>;
  items: PersonalOperationalMemoryItem[];
}): string {
  const lines = [
    "Memória pessoal operacional:",
    `- Estilo de resposta: ${input.profile.responseStyle}`,
    `- Briefing da manhã: ${input.profile.briefingPreference} | detalhe: ${input.profile.detailLevel} | tom: ${input.profile.tonePreference}`,
    `- Modo padrão: ${input.profile.defaultOperationalMode === "field" ? "plantão/rua" : "normal"}`,
    `- Escopo padrão de agenda: ${labelAgendaScope(input.profile.defaultAgendaScope)}`,
    `- Foco salvo: ${input.profile.savedFocus.length > 0 ? input.profile.savedFocus.join(" | ") : "nenhum"}`,
    `- Regras práticas: ${input.profile.operationalRules.slice(0, 3).join(" | ")}`,
    `- Deslocamento: ${input.profile.mobilityPreferences.slice(0, 2).join(" | ") || "sem preferência extra"}`,
    `- Itens de apoio: ${input.profile.attire.carryItems.join(" | ")}`,
  ];

  if (input.items.length === 0) {
    lines.push("", "Nenhum item adicional salvo na memória pessoal.");
    return lines.join("\n");
  }

  lines.push("", "Itens salvos:");
  for (const item of input.items) {
    lines.push(`- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`);
    lines.push(`  ${item.content}`);
  }

  return lines.join("\n");
}

export function buildPersonalMemorySavedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal salva.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
    `- Conteúdo: ${item.content}`,
  ].join("\n");
}

export function buildPersonalMemoryUpdatedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal atualizada.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
    `- Conteúdo: ${item.content}`,
  ].join("\n");
}

export function buildPersonalMemoryDeletedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal removida.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
  ].join("\n");
}

export function buildPersonalMemoryAmbiguousReply(query: string, items: PersonalOperationalMemoryItem[]): string {
  return [
    `Encontrei mais de um item para "${query}". Diga o id exato para eu seguir.`,
    ...items.slice(0, 5).map((item) => `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`),
  ].join("\n");
}

export function isContactListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste meus contatos",
    "listar contatos",
    "contatos inteligentes",
    "base de contatos",
  ]);
}

export function isContactUpsertPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "salve contato",
    "cadastre contato",
    "registre contato",
    "adicione contato",
  ]);
}

export function defaultPersonaForRelationship(relationship: ContactRelationship): ContactPersona {
  switch (relationship) {
    case "partner":
    case "family":
    case "friend":
      return "pessoal_afetivo";
    case "client":
    case "lead":
      return "profissional_comercial";
    case "colleague":
    case "vendor":
      return "profissional_tecnico";
    case "social_case":
      return "social_humanizado";
    case "spam":
    case "unknown":
    default:
      return "operacional_neutro";
  }
}

export function parseContactRelationship(prompt: string): ContactRelationship {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, ["parceira", "parceiro", "esposa", "esposo", "namorada", "namorado"])) {
    return "partner";
  }
  if (includesAny(normalized, ["familia", "familiar", "irma", "irmao", "mae", "pai", "filho", "filha"])) {
    return "family";
  }
  if (includesAny(normalized, ["amigo", "amiga"])) {
    return "friend";
  }
  if (includesAny(normalized, ["cliente"])) {
    return "client";
  }
  if (includesAny(normalized, ["lead", "potencial cliente"])) {
    return "lead";
  }
  if (includesAny(normalized, ["colega", "parceiro tecnico", "parceiro tecnico", "dev"])) {
    return "colleague";
  }
  if (includesAny(normalized, ["caso social", "usuario social", "trabalho social"])) {
    return "social_case";
  }
  if (includesAny(normalized, ["fornecedor", "vendor"])) {
    return "vendor";
  }
  if (includesAny(normalized, ["spam"])) {
    return "spam";
  }
  return "unknown";
}

export function extractLabeledValue(prompt: string, labels: string[], stopLabels: string[]): string | undefined {
  const pattern = new RegExp(
    String.raw`(?:^|\s)(?:${labels.join("|")})\s*[:\-]?\s*(.+?)(?=\s+(?:${stopLabels.join("|")})\b|$)`,
    "i",
  );
  return pattern.exec(prompt)?.[1]?.trim();
}

export function extractContactProfileInput(prompt: string): UpsertContactProfileInput | undefined {
  const relationship = parseContactRelationship(prompt);
  const emailMatch = prompt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = prompt.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9?\d{4})-?\d{4}/);
  const telegramMatch = prompt.match(/@\w{3,}/);
  const identifier = emailMatch?.[0] ?? phoneMatch?.[0] ?? telegramMatch?.[0];
  if (!identifier) {
    return undefined;
  }

  const normalized = normalizeEmailAnalysisText(prompt);
  const channel = emailMatch ? "email" : telegramMatch ? "telegram" : normalized.includes("whatsapp") ? "whatsapp" : "generic";
  const stopLabels = [
    "email",
    "telefone",
    "whatsapp",
    "telegram",
    "empresa",
    "negocio",
    "negócio",
    "tom",
    "tone",
    "prioridade",
    "relacao",
    "relação",
  ];
  const displayName =
    extractLabeledValue(prompt, ["nome", "chama(?:-se)?"], stopLabels) ??
    extractLabeledValue(prompt, ["contato"], stopLabels);
  const company = extractLabeledValue(prompt, ["empresa", "negocio", "negócio"], stopLabels);
  const toneMatch = prompt.match(/(?:tom|tone)\s*[:\-]?\s*([A-Za-zÀ-ÿ0-9 _-]{2,40})/i);

  return {
    channel,
    identifier,
    displayName,
    relationship,
    persona: defaultPersonaForRelationship(relationship),
    priority: relationship === "partner" || relationship === "family" || relationship === "client" ? "alta" : "media",
    company,
    preferredTone: toneMatch?.[1]?.trim(),
    source: "manual",
  };
}

export function buildContactSaveReply(contact: ContactProfileRecord): string {
  return [
    "Contato salvo.",
    `- Canal: ${contact.channel}`,
    `- Identificador: ${contact.identifier}`,
    `- Nome: ${contact.displayName ?? "(sem nome)"}`,
    `- Relação: ${contact.relationship}`,
    `- Persona: ${contact.persona}`,
    `- Prioridade: ${contact.priority}`,
    ...(contact.company ? [`- Empresa: ${contact.company}`] : []),
  ].join("\n");
}

export function buildContactListReply(contacts: ContactProfileRecord[]): string {
  if (contacts.length === 0) {
    return "Não encontrei contatos salvos na inteligência de contatos.";
  }

  return [
    `Contatos inteligentes: ${contacts.length}.`,
    ...contacts.map((contact) =>
      `- ${contact.displayName ?? contact.identifier} | ${contact.relationship} | ${contact.persona} | ${contact.channel}`,
    ),
  ].join("\n");
}

export function extractMemoryEntityKindFromPrompt(prompt: string): MemoryEntityKind | undefined {
  const normalized = prompt.toLowerCase();
  if (includesAny(normalized, ["aprova", "approval"])) {
    return "approval";
  }
  if (includesAny(normalized, ["workflow", "fluxo"])) {
    return "workflow_run";
  }
  if (includesAny(normalized, ["contato", "contact"])) {
    return "contact";
  }
  if (includesAny(normalized, ["projeto", "project"])) {
    return "project";
  }
  if (includesAny(normalized, ["lead"])) {
    return "lead";
  }
  if (includesAny(normalized, ["conteudo", "conteúdo", "content"])) {
    return "content_item";
  }
  if (includesAny(normalized, ["pesquisa", "research"])) {
    return "research_session";
  }
  if (includesAny(normalized, ["tarefa", "task"])) {
    return "task";
  }
  return undefined;
}

export function extractMemoryEntitySearchQuery(prompt: string): string | undefined {
  const quoted = prompt.match(/["“](.+?)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const normalized = prompt
    .replace(/^.*?(busque entidades|buscar entidades|procure entidades)\s*/i, "")
    .replace(/\b(do tipo|tipo)\b.*$/i, "")
    .trim();

  return normalized || undefined;
}

export function buildMemoryEntityListReply(entities: MemoryEntityRecord[], input: {
  kind?: MemoryEntityKind;
  query?: string;
}): string {
  if (entities.length === 0) {
    if (input.query) {
      return `Não encontrei entidades para a busca "${input.query}".`;
    }
    if (input.kind) {
      return `Não encontrei entidades do tipo ${input.kind}.`;
    }
    return "Não encontrei entidades salvas na memória estruturada do Atlas.";
  }

  const header = input.query
    ? `Entidades encontradas para "${input.query}": ${entities.length}.`
    : input.kind
      ? `Entidades do tipo ${input.kind}: ${entities.length}.`
      : `Entidades recentes da memória do Atlas: ${entities.length}.`;

  return [
    header,
    ...entities.slice(0, 10).map((entity) =>
      `- ${entity.kind} | ${entity.title}${entity.tags.length ? ` | tags: ${entity.tags.slice(0, 4).join(", ")}` : ""}`,
    ),
  ].join("\n");
}

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

export function isWorkflowPlanningPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (
    isWorkflowListPrompt(prompt) ||
    isWorkflowShowPrompt(prompt) ||
    isWorkflowArtifactListPrompt(prompt) ||
    isWorkflowExecutionPrompt(prompt) ||
    isWorkflowStepUpdatePrompt(prompt)
  ) {
    return false;
  }
  return includesAny(normalized, [
    "plano orquestrado",
    "workflow",
    "orquestre",
    "orquestrar",
    "quebre em etapas",
    "de ponta a ponta",
    "plano de execucao",
    "plano de execução",
    "como sistema",
  ]);
}

export function isWorkflowListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste workflows",
    "listar workflows",
    "meus workflows",
    "planos orquestrados",
    "liste meus planos",
    "mostre meus planos",
  ]);
}

export function isWorkflowShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre o workflow",
    "abrir workflow",
    "detalhe do workflow",
    "etapas do workflow",
    "plano do workflow",
  ]) && /\bworkflow\s+\d+\b/i.test(prompt);
}

export function isWorkflowExecutionPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "inicie o workflow",
    "iniciar workflow",
    "retome o workflow",
    "retomar workflow",
    "execute o workflow",
    "executar workflow",
    "avance o workflow",
    "avancar workflow",
    "avançar workflow",
    "proxima etapa do workflow",
    "próxima etapa do workflow",
    "inicie a etapa",
    "retome a etapa",
    "execute a etapa",
    "executar a etapa",
  ]) && includesAny(normalized, ["workflow"]);
}

export function shouldAutoExecuteWorkflowDeliverable(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "execute o workflow",
    "executar workflow",
    "execute a etapa",
    "executar a etapa",
    "gere o entregavel",
    "gere o entregável",
    "produza o entregavel",
    "produza o entregável",
  ]);
}

export function isWorkflowArtifactListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "artefatos do workflow",
    "artefatos da etapa",
    "liste os artefatos",
    "listar artefatos",
    "mostre os artefatos",
    "mostrar artefatos",
    "brief do workflow",
    "brief da etapa",
  ]) && includesAny(normalized, ["workflow"]);
}

export function isWorkflowStepUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "conclua a etapa",
    "concluir etapa",
    "marque a etapa",
    "bloqueie a etapa",
    "bloquear etapa",
    "etapa",
  ]) && includesAny(normalized, ["workflow"]) && includesAny(normalized, [
    "conclu",
    "finaliz",
    "done",
    "em andamento",
    "in progress",
    "in_progress",
    "bloquead",
    "bloqueie",
    "pendente",
  ]);
}

export function extractWorkflowPlanId(prompt: string): number | undefined {
  const match = prompt.match(/\bworkflow\s+(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractWorkflowStepNumber(prompt: string): number | undefined {
  const match = prompt.match(/\betapa\s+(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function extractWorkflowStepStatus(prompt: string): "pending" | "in_progress" | "waiting_approval" | "blocked" | "completed" | "failed" | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (includesAny(normalized, [
    "conclua",
    "concluir",
    "concluida",
    "concluída",
    "done",
    "finalize",
    "finalizar",
    "finalizada",
    "finalizado",
  ])) {
    return "completed";
  }
  if (includesAny(normalized, [
    "em andamento",
    "in progress",
    "in_progress",
    "inicie",
    "iniciar",
    "retome",
    "retomar",
  ])) {
    return "in_progress";
  }
  if (includesAny(normalized, [
    "aguardando aprovacao",
    "aguardando aprovação",
    "esperando aprovacao",
    "esperando aprovação",
    "waiting approval",
  ])) {
    return "waiting_approval";
  }
  if (includesAny(normalized, ["bloqueada", "bloqueado", "bloqueie", "bloquear"])) {
    return "blocked";
  }
  if (includesAny(normalized, ["falhou", "falhada", "falhado", "failed", "marque como falha"])) {
    return "failed";
  }
  if (includesAny(normalized, ["pendente", "volte para pendente"])) {
    return "pending";
  }
  return undefined;
}

export function buildWorkflowPlanReply(plan: WorkflowPlanRecord): string {
  const lines = [
    `Plano orquestrado #${plan.id}: ${plan.title}`,
    `- Domínio principal: ${plan.primaryDomain}`,
    `- Domínios secundários: ${plan.secondaryDomains.length ? plan.secondaryDomains.join(", ") : "nenhum"}`,
    `- Status: ${plan.status}`,
    `- Resumo: ${plan.executiveSummary}`,
  ];

  if (plan.deliverables.length > 0) {
    lines.push("- Entregáveis:", ...plan.deliverables.map((item) => `  - ${item}`));
  }

  lines.push("", "Etapas:");
  for (const step of plan.steps) {
    lines.push(
      `${step.stepNumber}. [${step.status}] ${step.title} | dono: ${step.ownerDomain} | entrega: ${step.deliverable}`,
    );
    if (step.dependsOn.length > 0) {
      lines.push(`   depende de: ${step.dependsOn.join(", ")}`);
    }
  }

  if (plan.nextAction) {
    lines.push("", `Próxima ação recomendada: ${plan.nextAction}`);
  }

  return lines.join("\n");
}

export function buildWorkflowListReply(plans: WorkflowPlanRecord[]): string {
  if (plans.length === 0) {
    return "Não encontrei workflows salvos.";
  }

  return [
    `Workflows salvos: ${plans.length}.`,
    ...plans.map((plan) => `- #${plan.id} | ${plan.title} | ${plan.status} | ${plan.primaryDomain}`),
  ].join("\n");
}

export function buildWorkflowStepUpdateReply(plan: WorkflowPlanRecord, stepNumber: number): string {
  const step = plan.steps.find((item) => item.stepNumber === stepNumber);
  if (!step) {
    return `Workflow #${plan.id} atualizado, mas não encontrei a etapa ${stepNumber} no retorno final.`;
  }
  return `Workflow #${plan.id} atualizado. Etapa ${step.stepNumber} agora está como ${step.status}: ${step.title}.`;
}

export function buildWorkflowExecutionReply(input: {
  plan: WorkflowPlanRecord;
  step: WorkflowStepRecord;
  artifact: WorkflowArtifactRecord;
  deliverableArtifact?: WorkflowArtifactRecord;
  deliverableSummary?: string;
  brief: {
    summary: string;
    immediateActions: string[];
    risks: string[];
    outputs: string[];
    suggestedTools: string[];
    followUp: string;
  };
}): string {
  const lines = [
    `Workflow #${input.plan.id} ativo.`,
    `Etapa em foco: ${input.step.stepNumber}. ${input.step.title}`,
    `- Dono: ${input.step.ownerDomain}`,
    `- Status: ${input.step.status}`,
    `- Objetivo: ${input.step.objective}`,
    `- Entregável: ${input.step.deliverable}`,
    `- Resumo operacional: ${input.brief.summary}`,
  ];

  if (input.brief.immediateActions.length > 0) {
    lines.push("- Ações imediatas:", ...input.brief.immediateActions.slice(0, 5).map((item) => `  - ${item}`));
  }
  if (input.brief.outputs.length > 0) {
    lines.push("- Saídas esperadas:", ...input.brief.outputs.slice(0, 5).map((item) => `  - ${item}`));
  }
  if (input.brief.risks.length > 0) {
    lines.push("- Riscos:", ...input.brief.risks.slice(0, 4).map((item) => `  - ${item}`));
  }
  if (input.brief.suggestedTools.length > 0) {
    lines.push(`- Tools sugeridas: ${input.brief.suggestedTools.join(", ")}`);
  }
  lines.push(`- Artefato salvo: ${input.artifact.filePath ?? `registro #${input.artifact.id}`}`);
  if (input.deliverableArtifact) {
    lines.push(`- Entregável gerado: ${input.deliverableArtifact.filePath ?? `registro #${input.deliverableArtifact.id}`}`);
    if (input.deliverableSummary) {
      lines.push(`- Resumo do entregável: ${input.deliverableSummary}`);
    }
  }
  lines.push(`- Próxima ação recomendada: ${input.brief.followUp}`);
  return lines.join("\n");
}

export function buildWorkflowArtifactsReply(plan: WorkflowPlanRecord, artifacts: WorkflowArtifactRecord[], stepNumber?: number): string {
  if (artifacts.length === 0) {
    return stepNumber
      ? `Não encontrei artefatos para a etapa ${stepNumber} do workflow #${plan.id}.`
      : `Não encontrei artefatos para o workflow #${plan.id}.`;
  }

  return [
    stepNumber
      ? `Artefatos da etapa ${stepNumber} do workflow #${plan.id}: ${artifacts.length}.`
      : `Artefatos do workflow #${plan.id}: ${artifacts.length}.`,
    ...artifacts.slice(0, 10).map((artifact) =>
      `- #${artifact.id} | ${artifact.artifactType} | ${artifact.title}${artifact.stepNumber ? ` | etapa ${artifact.stepNumber}` : ""}${artifact.filePath ? ` | ${artifact.filePath}` : ""}`,
    ),
  ].join("\n");
}

export function buildWebResearchReply(input: {
  query: string;
  aliasLabel?: string;
  results: Array<{
    title: string;
    url: string;
    sourceHost: string;
    snippet: string;
    excerpt?: string;
    publishedAt?: string;
  }>;
}): string {
  if (input.results.length === 0) {
    return `Não encontrei resultados web úteis para: ${input.query}.`;
  }

  const lines = [`Encontrei ${input.results.length} fonte${input.results.length > 1 ? "s" : ""} útil${input.results.length > 1 ? "eis" : ""} sobre ${input.query}.`];
  if (input.aliasLabel) {
    lines.push(`Contexto reconhecido: ${input.aliasLabel}.`);
  }

  lines.push("", "Fontes:");
  for (const [index, item] of input.results.entries()) {
    const summary = item.snippet || item.excerpt?.slice(0, 180) || "";
    const published = item.publishedAt ? ` | ${item.publishedAt}` : "";
    lines.push(`${index + 1}. ${item.title} — ${item.sourceHost || item.url}${published}`);
    lines.push(`   ${item.url}`);
    if (item.publishedAt) {
      // already included inline for a tighter reply
    }
    if (summary) {
      lines.push(`   ${summary}`);
    }
  }

  lines.push("", "Se quiser, eu aprofundo isso ou filtro só por fontes oficiais.");
  return lines.join("\n");
}

export function buildInternalKnowledgeReply(input: {
  query: string;
  aliasLabel?: string;
  matches: Array<{
    rootLabel: string;
    relativePath: string;
    snippet: string;
    absolutePath: string;
  }>;
}): string {
  if (input.matches.length === 0) {
    return `Não encontrei evidência interna útil para: ${input.query}.`;
  }

  const lines = [`Busca interna para: ${input.query}`];
  if (input.aliasLabel) {
    lines.push(`Entidade reconhecida: ${input.aliasLabel}`);
  }

  lines.push("", "Evidência interna encontrada:");
  for (const [index, item] of input.matches.entries()) {
    lines.push(`${index + 1}. ${item.rootLabel}/${item.relativePath}`);
    lines.push(`   Arquivo: ${item.absolutePath}`);
    lines.push(`   Trecho: ${item.snippet}`);
  }

  return lines.join("\n");
}

export function isAddressLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual endereco",
    "qual endereço",
    "endereco de",
    "endereço de",
    "onde fica",
    "qual o endereco",
    "qual o endereço",
    ", endereco",
    ", endereço",
    " endereco",
    " endereço",
  ]);
}

export function isPhoneLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual telefone",
    "telefone",
    "fone",
    "contato",
    "whatsapp",
    "numero",
    "número",
  ]);
}

export function isHoursLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual horario",
    "qual horário",
    "horario",
    "horário",
    "funcionamento",
    "abre",
    "fecha",
    "atendimento",
  ]);
}

export function isCapacityLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "capacidade",
    "quantas vagas",
    "quantos acolhe",
    "quantas pessoas",
    "numero de vagas",
    "número de vagas",
    "vagas",
  ]);
}

export type ResearchFactType = "address" | "phone" | "hours" | "capacity";

export function extractRequestedResearchFactTypes(prompt: string): ResearchFactType[] {
  const types: ResearchFactType[] = [];
  if (isAddressLookupPrompt(prompt)) {
    types.push("address");
  }
  if (isPhoneLookupPrompt(prompt)) {
    types.push("phone");
  }
  if (isHoursLookupPrompt(prompt)) {
    types.push("hours");
  }
  if (isCapacityLookupPrompt(prompt)) {
    types.push("capacity");
  }
  return types;
}

export function extractAddressFromText(text: string): string | undefined {
  const finalizeAddress = (value: string | undefined): string | undefined => {
    const normalized = value
      ?.replace(/\blogradouro\s*:\s*/gi, "")
      .replace(/\bendere[cç]o\s*:\s*/gi, "")
      .replace(/\b(?:n[uú]mero|numero)\s*:\s*(\d{1,6})/gi, ", $1")
      .replace(/\bbairro\s*:\s*/gi, " - ")
      .replace(/\bmunic[ií]pio\s*:\s*/gi, " - ")
      .replace(/\bcidade\s*:\s*/gi, " - ")
      .replace(/\bestado\s*:\s*[A-Z]{2}\b/gi, "")
      .replace(/\bcep\s*:\s*\d{5}-?\d{3}\b/gi, "")
      .replace(/\s+,/g, ",")
      .replace(/\s+-\s+/g, " - ")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+-$/g, "")
      .trim();

    return normalized?.replace(/\s+/g, " ").trim() || undefined;
  };

  const explicitMatch = text.match(
    /endere[cç]o:\s*((?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\s+[^.;\n]+?porto alegre(?:\/rs|, rs)?)/i,
  );
  if (explicitMatch?.[1]) {
    return finalizeAddress(explicitMatch[1]);
  }

  const structuredMatch = text.match(
    /\b(?:logradouro|endere[cç]o)\s*:?\s*((?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\s+[^\n.;]+?)\s+(?:n[uú]mero|numero)\s*:?\s*(\d{1,6})(?:[^\n.;]*?\bbairro\b\s*:?\s*([^\n.;]+))?/i,
  );
  if (structuredMatch?.[1] && structuredMatch?.[2]) {
    const street = structuredMatch[1].replace(/\s+/g, " ").trim();
    const number = structuredMatch[2].trim();
    const neighborhood = structuredMatch[3]?.replace(/\s+/g, " ").trim();
    return finalizeAddress([street, number, neighborhood].filter(Boolean).join(" - "));
  }

  const match = text.match(
    /\b(?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\s+[^,\n.;]+(?:,\s*|\s+)\d+[^\n.;]*/i,
  );
  const raw = match?.[0]?.replace(/\s+/g, " ").trim();
  if (!raw) {
    return undefined;
  }

  const portoAlegreIndex = raw.toLowerCase().indexOf("porto alegre");
  if (portoAlegreIndex !== -1) {
    return finalizeAddress(raw.slice(0, portoAlegreIndex + "porto alegre".length).trim());
  }

  return finalizeAddress(raw);
}

export function extractPhoneFromText(text: string): string | undefined {
  const explicitMatch = text.match(
    /\b(?:telefone|fone|whatsapp|contato)\s*:?\s*((?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4}))/i,
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].replace(/\s+/g, " ").trim();
  }

  const genericMatch = text.match(
    /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4})\b/,
  );
  return genericMatch?.[0]?.replace(/\s+/g, " ").trim();
}

export function extractHoursFromText(text: string): string | undefined {
  const match =
    text.match(/\bhor[aá]rio:\s*((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)/i) ??
    text.match(/\b((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

export function extractCapacityFromText(text: string): string | undefined {
  const explicitMatch =
    text.match(/\bcapacidade(?:\s+total)?(?:\s+citada)?\s*(?:de|para)?\s*(\d{1,4})\s*(?:vagas|pessoas)\b/i) ??
    text.match(/\b(\d{1,4})\s*(?:vagas|pessoas)\b/i);
  if (!explicitMatch?.[1]) {
    return undefined;
  }

  const total = explicitMatch[1];
  const male =
    text.match(/\b(\d{1,4})\s*(?:na\s+)?ala\s+masculina\b/i) ??
    text.match(/\b(\d{1,4})\s+na\s+masculina\b/i) ??
    text.match(/\bmasculin[ao]\s*[:|-]?\s*(\d{1,4})\b/i);
  const female =
    text.match(/\b(\d{1,4})\s*(?:na\s+)?ala\s+feminina\b/i) ??
    text.match(/\b(\d{1,4})\s+na\s+feminina\b/i) ??
    text.match(/\bfeminin[ao]\s*[:|-]?\s*(\d{1,4})\b/i);

  const details = [];
  if (male?.[1]) {
    details.push(`${male[1]} masculina`);
  }
  if (female?.[1]) {
    details.push(`${female[1]} feminina`);
  }

  return details.length > 0 ? `${total} vagas (${details.join(", ")})` : `${total} vagas`;
}

export function buildAddressLookupReply(input: {
  query: string;
  address: string;
  aliasLabel?: string;
  sources: Array<{ label: string; url?: string; filePath?: string }>;
}): string {
  const lines = [];
  if (input.aliasLabel) {
    lines.push(`Endereço identificado para ${input.aliasLabel}:`);
  } else {
    lines.push(`Endereço identificado para a consulta: ${input.query}`);
  }
  lines.push(input.address, "", "Fontes:");
  for (const source of input.sources) {
    if (source.url) {
      lines.push(`- ${source.label}: ${source.url}`);
    } else if (source.filePath) {
      lines.push(`- ${source.label}: ${source.filePath}`);
    }
  }
  return lines.join("\n");
}

export function buildDeterministicFactLookupReply(input: {
  query: string;
  aliasLabel?: string;
  facts: Partial<Record<ResearchFactType, string>>;
  requestedTypes: ResearchFactType[];
  sources: Array<{ label: string; url?: string; filePath?: string }>;
}): string {
  const label = input.aliasLabel ?? input.query;
  const allTypes: ResearchFactType[] =
    input.requestedTypes.length > 0 ? input.requestedTypes : (["address", "phone", "hours", "capacity"] as ResearchFactType[]);
  const factLabels: Record<ResearchFactType, string> = {
    address: "Endereço",
    phone: "Telefone",
    hours: "Horário",
    capacity: "Capacidade",
  };

  const resolvedTypes = allTypes.filter((type) => Boolean(input.facts[type]));
  const unresolved = allTypes.filter((type) => !input.facts[type]);

  if (allTypes.length === 1 && resolvedTypes.length === 1) {
    const type = resolvedTypes[0];
    const value = input.facts[type]!;
    const primarySource = input.sources[0];
    const lines = [`${factLabels[type]} do ${label}: ${value}.`];
    if (primarySource?.url) {
      lines.push(`Fonte: ${primarySource.label} - ${primarySource.url}`);
    } else if (primarySource?.filePath) {
      lines.push(`Fonte: ${primarySource.label} - ${primarySource.filePath}`);
    }
    lines.push("Se quiser, eu também posso trazer telefone, horário ou capacidade.");
    return lines.join("\n");
  }

  const lines = [`Informações identificadas para ${label}:`];

  for (const type of allTypes) {
    const value = input.facts[type];
    if (value) {
      lines.push(`- ${factLabels[type]}: ${value}`);
    }
  }

  if (unresolved.length > 0) {
    lines.push(
      "",
      `Sem evidência suficiente nas fontes atuais para: ${unresolved.map((type) => factLabels[type].toLowerCase()).join(", ")}.`,
    );
  }

  if (input.sources.length > 0) {
    lines.push("", "Fontes:");
    for (const source of input.sources) {
      if (source.url) {
        lines.push(`- ${source.label}: ${source.url}`);
      } else if (source.filePath) {
        lines.push(`- ${source.label}: ${source.filePath}`);
      }
    }
  }

  return lines.join("\n");
}

export function extractResearchFacts(text: string): string[] {
  const facts: string[] = [];
  const address = extractAddressFromText(text);
  if (address) {
    facts.push(`Endereço: ${address}`);
  }

  const phone = extractPhoneFromText(text);
  if (phone) {
    facts.push(`Telefone: ${phone}`);
  }

  const hours = extractHoursFromText(text);
  if (hours) {
    facts.push(`Horário: ${hours}`);
  }

  const capacity = extractCapacityFromText(text);
  if (capacity) {
    facts.push(`Capacidade: ${capacity}`);
  }

  if (/\balbergue noturno\b/i.test(text)) {
    facts.push("Serviço mencionado: albergue noturno");
  }

  if (/\bcasa do pequenino\b/i.test(text)) {
    facts.push("Nome relacionado: Casa do Pequenino");
  }

  return [...new Set(facts)];
}

export function looksLikePostalAddress(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) {
    return false;
  }

  return /\b(?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\b/i.test(text) && /\b\d+\b/.test(text);
}

export function buildEventLocationResearchQuery(location: string, prompt: string): string {
  const normalizedPrompt = normalizeEmailAnalysisText(prompt);
  const parts = [`"${location}"`, "endereco"];
  if (normalizedPrompt.includes("porto alegre") || normalizedPrompt.includes("restinga")) {
    parts.push("porto alegre");
  }
  return parts.join(" ");
}

export function buildLocationTermHints(location: string): string[] {
  return normalizeEmailAnalysisText(location)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !["quadra", "arena", "campo", "sports", "sport", "clube"].includes(item));
}

export function isAmbiguousPublicServiceLocation(location: string): boolean {
  const normalized = normalizeEmailAnalysisText(location).replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(caps|creas|cras|ubs|upa)\b(?:\s+(.+))?$/i);
  if (!match) {
    return false;
  }

  const qualifier = (match[2] ?? "")
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !["de", "da", "do", "dos", "das"].includes(item));

  if (qualifier.length === 0) {
    return true;
  }

  return qualifier.every((item) => /^(adulto|infantil|ad|ii|iii|iv|v|vi)$/i.test(item) || item.length <= 2);
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function resolveDuckDuckGoRedirectUrl(rawHref: string): string {
  if (!rawHref) {
    return "";
  }

  try {
    const parsed = new URL(rawHref, "https://html.duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return rawHref;
  }
}

export async function lookupVenueAddress(
  location: string,
  prompt: string,
  logger: Logger,
  maps: GoogleMapsService,
): Promise<string | undefined> {
  const normalizedPrompt = normalizeEmailAnalysisText(prompt);
  const normalizedLocation = normalizeEmailAnalysisText(location);
  const locationHints = buildLocationTermHints(location);
  const cityHints = new Set<string>();

  if (normalizedPrompt.includes("porto alegre") || normalizedLocation.includes("porto alegre")) {
    cityHints.add("porto alegre");
  }
  if (normalizedPrompt.includes("restinga") || normalizedLocation.includes("restinga")) {
    cityHints.add("restinga");
    cityHints.add("porto alegre");
  }

  const looksLikeGenericPublicService = isAmbiguousPublicServiceLocation(location) && cityHints.size === 0;
  if (looksLikeGenericPublicService) {
    logger.info("Skipping venue address enrichment due to ambiguous public-service location", {
      location,
      prompt,
    });
    return undefined;
  }

  const compactLocation = location.replace(/\bna\b/gi, " ").replace(/\s+/g, " ").trim();
  const queries = [
    `${compactLocation} ${[...cityHints].join(" ")} endereco`,
    `"${compactLocation}" ${[...cityHints].join(" ")} endereco`,
    `${compactLocation} ${[...cityHints].join(" ")} cnpj`,
  ]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const mapsStatus = maps.getStatus();
  if (mapsStatus.ready) {
    for (const query of [...new Set(queries)]) {
      try {
        const result = await maps.lookupPlace(query);
        if (result?.formattedAddress) {
          logger.info("Resolved venue address from Google Maps", {
            location,
            query,
            address: result.formattedAddress,
            mapsUrl: result.mapsUrl,
          });
          return result.formattedAddress;
        }
      } catch (error) {
        logger.warn("Venue address lookup failed on Google Maps", {
          location,
          query,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  for (const query of [...new Set(queries)]) {
    try {
      const url = new URL("https://html.duckduckgo.com/html/");
      url.searchParams.set("q", query);
      url.searchParams.set("kl", "br-pt");

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const entries = [...html.matchAll(
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/gi,
      )]
        .map((match) => ({
          href: match[1] ?? "",
          title: match[2] ?? "",
          snippet: match[3] ?? match[4] ?? "",
        }))
        .slice(0, 8);

      for (const entry of entries) {
        const title = stripHtmlTags(entry.title);
        const snippet = stripHtmlTags(entry.snippet);
        const resultUrl = resolveDuckDuckGoRedirectUrl(entry.href);
        const combined = `${title} ${snippet} ${resultUrl}`.trim();
        const normalizedCombined = normalizeEmailAnalysisText(combined);

        if (
          locationHints.length > 0 &&
          !locationHints.every((term) => normalizedCombined.includes(normalizeEmailAnalysisText(term)))
        ) {
          continue;
        }

        const address = extractAddressFromText(combined);
        if (address) {
          logger.info("Resolved venue address from DuckDuckGo snippets", {
            location,
            query,
            resultUrl,
            address,
          });
          return address;
        }
      }
    } catch (error) {
      logger.warn("Venue address lookup failed", {
        location,
        query,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return undefined;
}

export async function fetchOfficialAliasSources(
  service: WebResearchService,
  urls: string[],
  logger: Logger,
  focusTerms: string[] = [],
  maxChars = 2200,
): Promise<Array<{ title: string; url: string; sourceHost: string; excerpt?: string }>> {
  const results: Array<{ title: string; url: string; sourceHost: string; excerpt?: string }> = [];

  for (const url of urls) {
    try {
      const sourceHost = new URL(url).hostname.replace(/^www\./, "");
      const excerpt = await (async () => {
        try {
          return url.toLowerCase().endsWith(".pdf")
            ? await service.fetchPageExcerpt(url, Math.min(maxChars, 2200))
            : await fetchOfficialHtmlExcerpt(url, focusTerms, maxChars);
        } catch {
          return await service.fetchPageExcerpt(url, maxChars);
        }
      })();
      results.push({
        title: sourceHost,
        url,
        sourceHost,
        excerpt,
      });
    } catch (error) {
      logger.warn("Failed to fetch official alias source", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function inferOfficialFallbackUrls(query: string, aliasOfficialUrls?: string[]): string[] {
  const urls = new Set(aliasOfficialUrls ?? []);
  const normalized = normalizeEmailAnalysisText(query);

  if (normalized.includes("albergue") && normalized.includes("porto alegre")) {
    urls.add("https://prefeitura.poa.br/fasc/albergue");
    urls.add("https://prefeitura.poa.br/gp/noticias/capital-tera-dois-novos-albergues-para-pessoas-em-situacao-de-rua");
  }

  return [...urls];
}

export function stripResearchReplyMarkdown(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildResearchFocusTerms(query: string, alias?: { terms?: string[]; matchedTerms?: string[] }): string[] {
  const terms = new Set<string>();
  for (const term of alias?.matchedTerms ?? []) {
    if (term.trim()) {
      terms.add(term.trim());
    }
  }
  for (const term of alias?.terms ?? []) {
    if (term.trim()) {
      terms.add(term.trim());
    }
  }

  const normalized = normalizeEmailAnalysisText(query)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(" ")
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length >= 4 &&
        !["sobre", "pesquise", "internet", "fontes", "rapida", "rápida", "executiva", "profunda"].includes(item),
    );

  for (const item of normalized) {
    terms.add(item);
  }

  if (normalizeEmailAnalysisText(query).includes("albergue")) {
    terms.add("azenha");
    terms.add("19h");
    terms.add("7h");
  }

  return [...terms];
}

export type ResearchSynthesisProfile = "general" | "market";

export function inferResearchSynthesisProfile(prompt: string, query: string): ResearchSynthesisProfile {
  const normalized = normalizeEmailAnalysisText(`${prompt} ${query}`);
  if (
    includesAny(normalized, [
      "mercado",
      "concorr",
      "benchmark",
      "demanda",
      "oportunidade",
      "riscos",
      "viabilidade",
      "tendencia",
      "tendência",
      "sinais de demanda",
    ])
  ) {
    return "market";
  }

  return "general";
}

export function extractFocusedExcerpt(text: string, focusTerms: string[], maxChars: number): string {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) {
    return "";
  }

  const lower = cleanText.toLowerCase();
  const candidates = focusTerms
    .map((term) => {
      const normalizedTerm = term.toLowerCase();
      return {
        term,
        position: lower.indexOf(normalizedTerm),
        weight: normalizedTerm.length,
      };
    })
    .filter((candidate) => candidate.position >= 0)
    .sort((left, right) => right.weight - left.weight || left.position - right.position);

  if (candidates.length === 0) {
    return cleanText.slice(0, maxChars).trim();
  }

  const best = candidates[0];
  const start = Math.max(0, best.position - Math.floor(maxChars * 0.18));
  return cleanText.slice(start, start + maxChars).trim();
}

export function scoreFocusedExcerpt(excerpt: string | undefined, focusTerms: string[]): number {
  if (!excerpt) {
    return 0;
  }

  const normalizedExcerpt = normalizeEmailAnalysisText(excerpt);
  let score = 0;
  for (const term of focusTerms) {
    const normalizedTerm = normalizeEmailAnalysisText(term);
    if (!normalizedTerm || normalizedTerm.length < 3) {
      continue;
    }
    if (normalizedExcerpt.includes(normalizedTerm)) {
      score += 20;
    }
  }
  return score;
}

export async function fetchOfficialHtmlExcerpt(url: string, focusTerms: string[] = [], maxChars = 4000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Official source fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return extractFocusedExcerpt(plainText, focusTerms, maxChars);
}

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

export function buildAllowedSpacesReply(roots: Record<ReadableRootKey, string>): string {
  return [
    "Espaços autorizados atuais do agente:",
    `- workspace: ${roots.workspace} | escrita liberada para artefatos, logs locais e arquivos do agente`,
    `- authorized_projects: ${roots.authorized_projects} | leitura geral do conjunto autorizado`,
    `- authorized_dev: ${roots.authorized_dev} | projetos, código, SaaS e automações`,
    `- authorized_social: ${roots.authorized_social} | materiais da área social e contexto sensível`,
    `- authorized_content: ${roots.authorized_content} | roteiros, posts, ativos e calendário editorial`,
    `- authorized_finance: ${roots.authorized_finance} | controles de receita e relatórios financeiros`,
    `- authorized_admin: ${roots.authorized_admin} | documentos operacionais e administrativos`,
    "",
    "Regra atual:",
    "- somente o workspace aceita escrita",
    "- os roots autorizados ficam em leitura até você pedir uma política mais ampla",
  ].join("\n");
}

export * from "./content-shortform-helpers.js";

export function buildCaseNotesReply(notes: Array<{
  id: number;
  title: string;
  noteType: string;
  sensitivity: string;
  summary: string;
  nextAction: string | null;
  followUpDate: string | null;
}>): string {
  if (!notes.length) {
    return "Nao ha notas sociais salvas para os filtros informados.";
  }

  return [
    `Notas sociais encontradas: ${notes.length}.`,
    ...notes.map((note) =>
      `- #${note.id} | ${note.sensitivity} | ${note.noteType} | ${note.title} | resumo: ${note.summary}${note.nextAction ? ` | proxima acao: ${note.nextAction}` : ""}${note.followUpDate ? ` | follow-up: ${note.followUpDate}` : ""}`,
    ),
    "",
    "Observacao: manter revisao humana para qualquer uso externo desse conteudo.",
  ].join("\n");
}

export function buildProjectScanReply(project: Record<string, unknown>, gitStatus?: Record<string, unknown>): string {
  const projectTypes = Array.isArray(project.project_types) ? project.project_types.join(", ") : "";
  const scripts = Array.isArray(project.scripts) ? project.scripts.slice(0, 8).join(", ") : "";
  const dependencies = Array.isArray(project.dependencies) ? project.dependencies.slice(0, 8).join(", ") : "";
  const rootDirectories = Array.isArray(project.root_directories)
    ? project.root_directories.slice(0, 8).join(", ")
    : "";
  const rootFiles = Array.isArray(project.root_files) ? project.root_files.slice(0, 8).join(", ") : "";
  const lines = [
    `Resumo do projeto: ${String(project.project_name ?? "(sem nome)")}`,
    `- Root: ${String(project.root ?? "")}`,
    `- Caminho: ${String(project.absolute_path ?? "")}`,
    `- Tipos detectados: ${projectTypes || "nenhum sinal forte detectado"}`,
    `- Diretorios de topo: ${rootDirectories || "nenhum"}`,
    `- Arquivos de topo: ${rootFiles || "nenhum"}`,
    `- Scripts detectados: ${scripts || "nenhum"}`,
    `- Dependencias de destaque: ${dependencies || "nenhuma"}`,
  ];

  if (gitStatus) {
    const branch = typeof gitStatus.branch === "string" ? gitStatus.branch : "";
    const statusLines = Array.isArray(gitStatus.status_lines) ? gitStatus.status_lines : [];
    lines.push(`- Git branch: ${branch || "indisponivel"}`);
    lines.push(`- Git dirty: ${gitStatus.dirty ? "sim" : "nao"}`);
    lines.push(`- Mudancas detectadas: ${statusLines.length ? statusLines.slice(0, 5).join(" | ") : "nenhuma"}`);
  }

  return lines.join("\n");
}

export function buildSafeExecReply(result: {
  argv: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  const lines = [
    `Comando executado: ${result.argv.join(" ")}`,
    `- Diretório: ${result.cwd}`,
    `- Exit code: ${result.exitCode}`,
  ];

  if (result.stdout.trim()) {
    lines.push("", "STDOUT:", result.stdout.trim());
  }
  if (result.stderr.trim()) {
    lines.push("", "STDERR:", result.stderr.trim());
  }

  if (!result.stdout.trim() && !result.stderr.trim()) {
    lines.push("", "Sem saída textual.");
  }

  return lines.join("\n");
}

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

export function buildBaseMessages(
  userPrompt: string,
  orchestration: OrchestrationContext,
  preferences?: UserPreferences,
): ConversationMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt(),
    },
    {
      role: "system",
      content: buildOrchestrationSystemMessage(orchestration),
    },
    ...(preferences
      ? [
          {
            role: "system" as const,
            content: [
              `Preferências atuais do usuário:`,
              `- estilo de resposta: ${preferences.responseStyle}`,
              `- tamanho preferido: ${preferences.responseLength}`,
              `- sugerir próxima ação: ${preferences.proactiveNextStep ? "sim" : "não"}`,
              `- nome preferido do agente: ${preferences.preferredAgentName}`,
            ].join("\n"),
          },
        ]
      : []),
    {
      role: "user",
      content: userPrompt,
    },
  ];
}
