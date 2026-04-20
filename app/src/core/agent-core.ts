import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
import { inferPreferredDomains, resolveKnowledgeAlias } from "./knowledge-aliases.js";
import { LocalKnowledgeService } from "./local-knowledge.js";
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
import {
  WhatsAppMessageStore,
  type WhatsAppMessageRecord,
} from "./whatsapp-message-store.js";
import {
  describeWhatsAppRoute,
  resolveWhatsAppAccountAlias,
} from "./whatsapp-routing.js";
import { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import { buildOrchestrationContext, buildOrchestrationSystemMessage } from "./orchestration.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { WeatherService } from "./weather-service.js";
import { ApprovalInboxStore } from "./approval-inbox.js";
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
import { EvolutionApiClient, type EvolutionRecentChatRecord } from "../integrations/whatsapp/evolution-api.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";
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
import {
  selectRelevantLearnedPreferences,
  summarizeIdentityProfileForReasoning,
  summarizeOperationalStateForReasoning,
} from "./personal-context-summary.js";
import {
  TurnPlanner,
} from "./turn-planner.js";
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
  type ActivePlanningGoal,
} from "./active-goal-state.js";

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function slugifySegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function extractActiveUserPrompt(prompt: string): string {
  const marker = "Mensagem atual do usuário:";
  const index = prompt.lastIndexOf(marker);
  if (index === -1) {
    return prompt.trim();
  }

  const extracted = prompt.slice(index + marker.length).trim();
  return extracted || prompt.trim();
}

function extractTelegramHistoryUserTurns(prompt: string): string[] {
  const historyMarker = "Histórico recente do chat:";
  const currentMarker = "Mensagem atual do usuário:";
  const historyIndex = prompt.indexOf(historyMarker);
  const currentIndex = prompt.indexOf(currentMarker);
  if (historyIndex === -1 || currentIndex === -1 || currentIndex <= historyIndex) {
    return [];
  }

  return prompt
    .slice(historyIndex + historyMarker.length, currentIndex)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Usuário: "))
    .map((line) => line.replace(/^Usuário:\s*/i, "").trim())
    .filter(Boolean);
}

function normalizePhoneDigits(value: string | undefined): string | undefined {
  const digits = value?.replace(/\D+/g, "") ?? "";
  return digits || undefined;
}

function normalizeSyntheticArguments(value: unknown): unknown {
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

function extractSyntheticToolCalls(
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

function isEmailFocusedPrompt(prompt: string): boolean {
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

function extractEmailUidFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/\buid(?:\s*=|\s+)?([a-z0-9_-]+)\b/i);
  if (!match) {
    return undefined;
  }
  return match[1]?.trim() || undefined;
}

function isEmailDraftPrompt(prompt: string): boolean {
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

function extractExactReplyBody(prompt: string): string | undefined {
  const match = prompt.match(
    /(?:use|envie|responda)\s+exatamente(?:\s+este|\s+esse|\s+o)?\s+texto\s*:?\s*([\s\S]+)$/i,
  );
  const body = match?.[1]
    ?.replace(/\bnao envie ainda\.?$/i, "")
    ?.replace(/\bnão envie ainda\.?$/i, "")
    ?.trim();
  return body ? body : undefined;
}

function isEmailSummaryPrompt(prompt: string): boolean {
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

function isInboxTriagePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  const hasTriageIntent = ["triagem", "triage", "classifique", "priorize", "prioridade", "organize", "executivo"].some((token) =>
    normalized.includes(token),
  );
  const hasInboxIntent = ["inbox", "caixa de entrada", "emails recentes", "emails nao lidos", "emails não lidos", "email principal"].some((token) =>
    normalized.includes(token),
  );
  return hasTriageIntent && hasInboxIntent;
}

function isFollowUpReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasFollowUp = includesAny(normalized, ["follow-up", "follow up", "followup", "retorno", "retornos"]);
  const hasAction = includesAny(normalized, ["revise", "revisar", "organize", "organizar", "priorize", "priorizar", "mostre", "liste"]);
  return hasFollowUp && hasAction;
}

function isNextCommitmentPrepPrompt(prompt: string): boolean {
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

function isSupportReviewPrompt(prompt: string): boolean {
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

function isUrgentSupportSignal(value: string): boolean {
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

function extractSupportTheme(value: string): string | null {
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

function isOperationalBriefPrompt(prompt: string): boolean {
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

function isMorningBriefPrompt(prompt: string): boolean {
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

function extractOperationalMode(prompt: string): "field" | null {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("modo_operacional=field")) {
    return "field";
  }
  return null;
}

function resolveEffectiveOperationalMode(
  prompt: string,
  profile?: PersonalOperationalProfile,
): "field" | null {
  const explicit = extractOperationalMode(prompt);
  if (explicit) {
    return explicit;
  }
  return profile?.defaultOperationalMode === "field" ? "field" : null;
}

function isMacQueueStatusPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (normalized.includes("liste")) {
    return false;
  }
  return ["fila do mac", "worker do mac", "status do mac", "mac worker", "comandos do mac"].some((token) =>
    normalized.includes(token),
  );
}

function isMacQueueListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return ["liste os comandos do mac", "liste a fila do mac", "comandos pendentes do mac", "fila pendente do mac"].some((token) =>
    normalized.includes(token),
  );
}

function extractMacOpenApp(prompt: string): string | undefined {
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

function extractMacOpenUrl(prompt: string): string | undefined {
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

function extractMacNotificationText(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const match = prompt.match(/(?:notifique|mostre uma notificacao|mostre uma notificação|exiba uma notificacao|exiba uma notificação).{0,20}?(?:que|com)\s+(.+)$/i);
  return match?.[1]?.trim();
}

function extractMacProjectOpenAlias(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  if (!(normalized.includes("no meu mac") || normalized.includes("no mac") || normalized.includes("no computador"))) {
    return undefined;
  }

  const match = prompt.match(/(?:abra|abrir)\s+(?:o\s+)?(?:projeto|pasta)\s+(.+?)\s+no\s+(?:meu\s+)?mac/i);
  return match?.[1]?.trim();
}

function extractMacProjectCommand(prompt: string): { argv: string[]; projectAlias: string } | undefined {
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

function normalizeAliasToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s._/-]+/g, "");
}

function isGoogleTasksPrompt(prompt: string): boolean {
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

function isGoogleContactsPrompt(prompt: string): boolean {
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

function isGoogleCalendarsListPrompt(prompt: string): boolean {
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

function isPlaceLookupPrompt(prompt: string): boolean {
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

function extractPlaceLookupQuery(prompt: string): string | undefined {
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

function extractGoogleContactsQuery(prompt: string): string | undefined {
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

function isWhatsAppSendPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, ["whatsapp", "zap"]) && includesAny(normalized, [
    "mande mensagem",
    "manda mensagem",
    "enviar mensagem",
    "envie mensagem",
    "responda no whatsapp",
    "responde no whatsapp",
    "manda no whatsapp",
    "envie no whatsapp",
  ]);
}

function isWhatsAppRecentSearchPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  const hasMessageLookupIntent = includesAny(normalized, [
    "mensagem recente",
    "mensagens recentes",
    "ultima mensagem",
    "última mensagem",
    "ultimas mensagens",
    "últimas mensagens",
    "liste mensagens",
    "listar mensagens",
    "mostre mensagens",
    "ver mensagens",
    "procure no whatsapp",
    "busque no whatsapp",
    "veja no whatsapp",
    "conversa recente",
  ]);
  const hasWhatsAppContext = includesAny(normalized, ["whatsapp", "zap", "abordagem"]);
  return hasMessageLookupIntent && hasWhatsAppContext;
}

function isGenericWhatsAppFollowUp(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return normalized === "procure no whatsapp" || normalized === "busque no whatsapp" || normalized === "veja no whatsapp";
}

function isWhatsAppPendingApprovalsPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, ["whatsapp", "zap"]) && includesAny(normalized, [
    "aprovações pendentes",
    "aprovacoes pendentes",
    "pendencias",
    "pendências",
    "rascunhos pendentes",
  ]);
}

function findRecentWhatsAppSendPrompt(fullPrompt: string): string | undefined {
  const historyTurns = extractTelegramHistoryUserTurns(fullPrompt).reverse();
  return historyTurns.find((turn) => isWhatsAppSendPrompt(turn));
}

function isClearlyNonWhatsAppIntent(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);

  if (isGoogleEventCreatePrompt(prompt) || isGoogleTaskCreatePrompt(prompt)) {
    return true;
  }

  return includesAny(normalized, [
    "meu calendario",
    "meu calendário",
    "minha agenda",
    "coloque um evento",
    "coloca um evento",
    "crie um evento",
    "crie uma tarefa",
    "adicione uma tarefa",
    "liste meus compromissos",
    "liste minhas tarefas",
    "procure no whatsapp",
    "busque no whatsapp",
    "veja no whatsapp",
    "pesquise na internet",
    "procure na internet",
    "pesquise sobre",
    "clima em",
    "previsao do tempo",
    "previsão do tempo",
    "morning briefing",
    "procure o contato",
    "liste workflows",
    "mostre o workflow",
  ]);
}

function isLikelyWhatsAppBodyFollowUp(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = normalizeEmailAnalysisText(trimmed);
  if (isClearlyNonWhatsAppIntent(trimmed)) {
    return false;
  }
  if (
    isWhatsAppSendPrompt(trimmed) ||
    isWhatsAppRecentSearchPrompt(trimmed) ||
    isGenericWhatsAppFollowUp(trimmed)
  ) {
    return false;
  }

  return ![
    "sim",
    "ok",
    "agendar",
    "confirmar",
    "enviar",
    "mande",
    "autorizo",
    "autorizo envio",
    "deixe o envio de lado",
    "cancele",
    "cancela",
    "ignorar",
  ].includes(normalized);
}

function extractWhatsAppTargetReference(prompt: string): string | undefined {
  const patterns = [
    /(?:procure|busque|veja)\s+(?:no\s+)?(?:whatsapp|zap)\s+por\s+(.+?)(?=(?:[?.!,;]|$))/i,
    /(?:whatsapp|zap)\s+(?:de|do|da|para|pro|pra)\s+(.+?)(?=(?:\s+(?:mensagem|texto|dizendo|com a mensagem|com o texto)|\s*[:|]|[?.!,;]|$))/i,
    /(?:mande|manda|envie|enviar|responda|responde)\s+(?:mensagem\s+)?(?:para|pro|pra)\s+(.+?)(?=(?:\s+(?:no\s+)?(?:whatsapp|zap)|\s+(?:mensagem|texto|dizendo|com a mensagem|com o texto)|\s*[:|]|[?.!,;]|$))/i,
    /(?:mensagens?(?:\s+recentes?)?|conversas?(?:\s+recentes?)?)\s+(?:de|do|da|com)\s+(.+?)(?=(?:[?.!,;]|$))/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.replace(/^["“'`]+|["”'`]+$/g, "").trim();
    }
  }
  return undefined;
}

function extractWhatsAppMessageBody(prompt: string): string | undefined {
  const quoted = prompt.match(/["“]([^"”]+)["”]/);
  if (quoted?.[1]?.trim()) {
    return quoted[1].trim();
  }

  const pipeMatch = prompt.match(/\|\s*(.+)$/);
  if (pipeMatch?.[1]?.trim()) {
    return pipeMatch[1].trim();
  }

  const patterns = [
    /(?:mensagem|texto)\s*:\s*([\s\S]+)$/i,
    /(?:dizendo|com a mensagem|com o texto)\s+([\s\S]+)$/i,
    /:\s*([\s\S]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.replace(/^["“'`]+|["”'`]+$/g, "").trim();
    }
  }
  return undefined;
}

function extractWhatsAppSearchQuery(currentPrompt: string, fullPrompt: string): string | undefined {
  const current = extractWhatsAppTargetReference(currentPrompt);
  if (current) {
    return current;
  }

  if (!isGenericWhatsAppFollowUp(currentPrompt)) {
    return undefined;
  }

  const historyTurns = extractTelegramHistoryUserTurns(fullPrompt).reverse();
  for (const turn of historyTurns) {
    const candidate = extractWhatsAppTargetReference(turn);
    if (candidate) {
      return candidate;
    }
    const genericRecent = turn.match(/mensagem(?:\s+recente)?\s+de\s+(.+?)(?=(?:[?.!,;]|$))/i);
    if (genericRecent?.[1]?.trim()) {
      return genericRecent[1].trim();
    }
  }

  return undefined;
}

function isWebResearchPrompt(prompt: string): boolean {
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

function isAgentIdentityPrompt(prompt: string): boolean {
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

function buildAgentIdentityReply(preferredAgentName = "Atlas"): string {
  return [
    `Pode me chamar de ${preferredAgentName}.`,
    "Se preferir algo mais direto, pode usar Agente.",
  ].join("\n");
}

function extractFirstName(value: string | undefined): string | undefined {
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

function hasTechnicalSimpleReplyFraming(reply: string): boolean {
  return [
    "Conclusão",
    "Evidência essencial",
    "Lacuna / risco",
    "Próxima ação recomendada",
  ].some((token) => reply.includes(token));
}

function extractConclusionLine(reply: string): string | undefined {
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

export function rewriteConversationalSimpleReply(
  prompt: string,
  reply: string,
  options?: {
    profile?: PersonalOperationalProfile;
    operationalMode?: "field" | null;
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
    return reply;
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

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function isConversationStyleCorrectionPrompt(prompt: string): boolean {
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

function isMemoryUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, ["atualize o item", "atualizar o item", "update memory", "update_memory_item"]) &&
    normalized.includes("memoria")
  );
}

function extractMemoryItemId(prompt: string): number | undefined {
  const match = prompt.match(/\bitem\s+(\d+)\b/i) ?? prompt.match(/\bid\s*[:=]?\s*(\d+)\b/i);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasMemoryUpdateFields(prompt: string): boolean {
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

function isUserPreferencesPrompt(prompt: string): boolean {
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

function isPersonalMemoryListPrompt(prompt: string): boolean {
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

function isOperationalStateShowPrompt(prompt: string): boolean {
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

function isLearnedPreferencesListPrompt(prompt: string): boolean {
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

function resolveLearnedPreferencesListFilter(prompt: string): {
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

function isLearnedPreferencesDeletePrompt(prompt: string): boolean {
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

function extractLearnedPreferenceId(prompt: string): number | undefined {
  const match = prompt.match(/#(\d{1,6})/);
  if (!match?.[1]) {
    return undefined;
  }
  const id = Number.parseInt(match[1], 10);
  return Number.isFinite(id) ? id : undefined;
}

function extractLearnedPreferenceDeleteTarget(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:remova|desative|esqueca|esqueça)\s+(?:essa\s+)?(?:a\s+)?prefer[eê]ncia\s+aprendida\s*/i, "")
    .replace(/^\s*(?:remova|desative|esqueca|esqueça)\s+essa\s+prefer[eê]ncia\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  return cleaned || undefined;
}

function isPersonalMemorySavePrompt(prompt: string): boolean {
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

function isPersonalMemoryUpdatePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "atualize minha memoria pessoal",
    "atualizar minha memoria pessoal",
    "edite minha memoria pessoal",
    "altere minha memoria pessoal",
    "altere a minha memoria pessoal",
  ]);
}

function isPersonalMemoryDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "remova da minha memoria pessoal",
    "remover da minha memoria pessoal",
    "apague da minha memoria pessoal",
    "delete da minha memoria pessoal",
    "exclua da minha memoria pessoal",
  ]);
}

function extractPersonalMemoryStatement(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:salve|guarde|registre|adicione)\s+(?:na\s+)?(?:minha\s+)?mem[oó]ria\s+pessoal\s*(?:que|:)?\s*/i, "")
    .replace(/^\s*(?:salve|guarde)\s+que\s*/i, "")
    .trim();
  return cleaned || undefined;
}

function inferPersonalMemoryKind(statement: string): PersonalOperationalMemoryItemKind {
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

function buildPersonalMemoryTitle(statement: string, kind: PersonalOperationalMemoryItemKind): string {
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

function isPersonalOperationalProfileShowPrompt(prompt: string): boolean {
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

function isPersonalOperationalProfileUpdatePrompt(prompt: string): boolean {
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

function isPersonalOperationalProfileDeletePrompt(prompt: string): boolean {
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

function isDirectLocalContextCommandPrompt(prompt: string): boolean {
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

function extractPersonalOperationalProfileRemoveQuery(prompt: string): string | undefined {
  const cleaned = prompt
    .replace(/^\s*(?:remova|remove|remover|apague|tire|exclua)\s+do\s+meu\s+perfil\s*(?:a|o)?\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  return cleaned || undefined;
}

function extractCarryItemsFromProfilePrompt(text: string): string[] {
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

function uniqueAppend(values: string[], additions: string[]): string[] {
  return [...new Set([...values, ...additions.map((item) => item.trim()).filter(Boolean)])];
}

function removeMatchingEntries(values: string[], query: string): string[] {
  const normalizedQuery = normalizeEmailAnalysisText(query);
  return values.filter((item) => {
    const normalizedItem = normalizeEmailAnalysisText(item);
    return !normalizedItem.includes(normalizedQuery) && !normalizedQuery.includes(normalizedItem);
  });
}

function normalizeTonePreferenceFromText(value: string): PersonalOperationalProfile["tonePreference"] | undefined {
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

function inferProfileResponseLength(
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

function extractPersonalOperationalProfileUpdate(
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

function removeFromPersonalOperationalProfile(
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

function extractPersonalMemoryId(prompt: string): number | undefined {
  const match = prompt.match(/\b(?:item|id)\s*(\d+)\b/i) ?? prompt.match(/#(\d+)\b/);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractPersonalMemoryUpdateTarget(prompt: string): string | undefined {
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

function extractPersonalMemoryUpdateContent(prompt: string): string | undefined {
  const match = prompt.match(/\b(?:para|com|:)\s+(.+)$/i);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].trim();
}

function extractPersonalMemoryDeleteTarget(prompt: string): string | undefined {
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

function isMemoryEntityListPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes("liste as entidades") ||
    normalized.includes("listar entidades") ||
    normalized.includes("mostre as entidades") ||
    normalized.includes("memoria do atlas") ||
    normalized.includes("memória do atlas")
  ) && !normalized.includes("busque");
}

function isMemoryEntitySearchPrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("busque entidades")
    || normalized.includes("buscar entidades")
    || normalized.includes("procure entidades");
}

function isIntentResolvePrompt(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return normalized.includes("analise a intencao")
    || normalized.includes("analise a intenção")
    || normalized.includes("analise este pedido")
    || normalized.includes("inspecione a intencao")
    || normalized.includes("mostre a intencao");
}

function extractIntentResolveSubject(prompt: string): string {
  const cleaned = prompt
    .replace(/^.*?(analise a intencao|analise a intenção|analise este pedido|inspecione a intencao|inspecione a intenção|mostre a intencao|mostre a intenção)\s*(?:de|:)?\s*/i, "")
    .trim();
  return cleaned || prompt.trim();
}

function isOperationalPlanningPrompt(prompt: string): boolean {
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

function extractPreferenceUpdate(prompt: string): import("../types/user-preferences.js").UpdateUserPreferencesInput | null {
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

function isImplicitResearchPrompt(prompt: string): boolean {
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

function isInternalKnowledgePrompt(prompt: string): boolean {
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

function extractWeatherLocation(prompt: string): string | undefined {
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

function buildWeatherTip(result: {
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

function extractWebResearchQuery(prompt: string): string {
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

function extractWebResearchMode(prompt: string): WebResearchMode {
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

function maxResearchResultsForMode(mode: WebResearchMode): number {
  if (mode === "quick") {
    return 4;
  }
  if (mode === "deep") {
    return 8;
  }
  return 6;
}

function excerptBudgetForResearchMode(mode: WebResearchMode): number {
  if (mode === "quick") {
    return 1100;
  }
  if (mode === "deep") {
    return 3200;
  }
  return 2200;
}

function extractInternalKnowledgeQuery(prompt: string): string {
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

function isRevenueScoreboardPrompt(prompt: string): boolean {
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

function isAllowedSpacesPrompt(prompt: string): boolean {
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

function isContentOverviewPrompt(prompt: string): boolean {
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

function isContentChannelsPrompt(prompt: string): boolean {
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

function isContentSeriesPrompt(prompt: string): boolean {
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

function isContentFormatLibraryPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "formatos de conteudo",
    "formatos de conteúdo",
    "biblioteca de formatos",
    "templates de formato",
    "modelos de formato",
  ].some((token) => normalized.includes(token));
}

function isContentHookLibraryPrompt(prompt: string): boolean {
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

function isContentIdeaGenerationPrompt(prompt: string): boolean {
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

function isContentReviewPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return (
    includesAny(normalized, ["aprovar", "aprove", "reprovar", "reprove"]) &&
    includesAny(normalized, ["item", "conteudo", "conteúdo", "pauta", "fila", "#"])
  );
}

function isContentScriptGenerationPrompt(prompt: string): boolean {
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

function isContentBatchPlanningPrompt(prompt: string): boolean {
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

function isContentBatchGenerationPrompt(prompt: string): boolean {
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

function isContentDistributionStrategyPrompt(prompt: string): boolean {
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

function isDailyEditorialResearchPrompt(prompt: string): boolean {
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

function isCaseNotesPrompt(prompt: string): boolean {
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

function isProjectScanPrompt(prompt: string): boolean {
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

function extractSafeExecRequest(prompt: string): { argv: string[]; root: ReadableRootKey; path?: string } | null {
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

function extractContentPlatform(prompt: string): string | undefined {
  const normalized = normalizeEmailAnalysisText(prompt);
  const tokens = ["instagram", "tiktok", "youtube", "shorts", "reels", "linkedin", "blog", "email", "telegram"];
  return tokens.find((token) => normalized.includes(token));
}

function extractContentChannelKey(prompt: string): string | undefined {
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

function inferDefaultContentChannelKey(prompt: string): string {
  return extractContentChannelKey(prompt)
    ?? (normalizeEmailAnalysisText(prompt).includes("tiktok")
      ? "riqueza_despertada_tiktok"
      : "riqueza_despertada_youtube");
}

function extractContentIdeaSeed(prompt: string): string | undefined {
  const topicMatch = prompt.match(
    /(?:sobre|tema|assunto|nicho)\s+["“]?(.+?)["”]?(?=(?:\s+(?:para|pro|no|na)\s+(?:o\s+)?(?:canal|youtube|tiktok)|[?.!,;:]|$))/i,
  );
  return topicMatch?.[1]?.trim();
}

function extractContentItemId(prompt: string): number | undefined {
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

function extractContentQueueOrdinal(prompt: string): number | undefined {
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

function extractContentReviewReason(prompt: string): string | undefined {
  const reasonMatch = prompt.match(/(?:porque|motivo|raz[aã]o)\s+(.+)$/i);
  return reasonMatch?.[1]?.trim();
}

function classifyContentReviewFeedback(reason: string | undefined): string | undefined {
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

function buildFallbackEditorialIdeas(input: {
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

function buildTrendChannelContext(trend: GoogleTrendItem, angle?: string): string {
  return normalizeEmailAnalysisText(
    [
      trend.title,
      angle ?? "",
      ...trend.newsItems.flatMap((item) => [item.title ?? "", item.source ?? "", item.snippet ?? ""]),
    ].join(" | "),
  );
}

function isRiquezaTrendEligible(input: {
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

function isRiquezaContentItemEligible(item: {
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

function filterSelectedTrendsForChannel(input: {
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

function extractProjectRoot(prompt: string): ReadableRootKey {
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

function extractProjectPath(prompt: string): string | undefined {
  const folderMatch = prompt.match(
    /(?:pasta|diretorio|diretório|caminho|path)\s+["“]?(.+?)["”]?(?=(?:\s+(?:dentro\s+de|no\s+root|em\s+authorized_|para\s+o\s+workspace|para\s+workspace|e\s+(?:rode|execute|analise|análise|leia|resuma|espelhe|copie|clone))|[?.!,;:]|$))/i,
  );
  if (folderMatch?.[1]?.trim()) {
    return folderMatch[1].trim();
  }

  const projectMatch = prompt.match(
    /(?:projeto|repositorio|repositório)\s+["“]?(.+?)["”]?(?=(?:\s+(?:dentro\s+de|no\s+root|em\s+authorized_|para\s+o\s+workspace|para\s+workspace|e\s+(?:rode|execute|analise|análise|leia|resuma|espelhe|copie|clone))|[?.!,;:]|$))/i,
  );
  return projectMatch?.[1]?.trim();
}

function isMirrorProjectPrompt(prompt: string): boolean {
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

function extractMirrorTargetPath(prompt: string): string | undefined {
  const match = prompt.match(
    /(?:para|no|na)\s+workspace(?:\/|\\)["“]?([A-Za-z0-9_./ -]+?)["”]?(?=(?:[?.!,;:]|$))/i,
  );
  return match?.[1]?.trim();
}

function extractMirrorSourceRoot(prompt: string): ReadableRootKey {
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

function extractPromptLimit(prompt: string, fallback: number, max: number): number {
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

function extractReferenceMonth(prompt: string): string | undefined {
  const match = prompt.match(/\b(20\d{2}-\d{2})\b/);
  return match?.[1];
}

function isCalendarLookupPrompt(prompt: string): boolean {
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

function getWeekdayTargetDate(normalized: string, timezone: string): { isoDate: string; label: string } | undefined {
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

function parseCalendarLookupDate(prompt: string, timezone: string): CalendarLookupRequest["targetDate"] | undefined {
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

function extractCalendarLookupTopic(prompt: string): string | undefined {
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

function extractCalendarLookupRequest(prompt: string, timezone: string): CalendarLookupRequest | undefined {
  if (!isCalendarLookupPrompt(prompt)) {
    return undefined;
  }

  return {
    topic: extractCalendarLookupTopic(prompt),
    targetDate: parseCalendarLookupDate(prompt, timezone),
  };
}

interface EmailLookupRequest {
  senderQuery?: string;
  category?: EmailOperationalGroup;
  unreadOnly: boolean;
  sinceHours: number;
  existenceOnly: boolean;
}

interface ResolvedEmailReference {
  message?: EmailMessageSummary;
  label: string;
  totalMatches: number;
  request: EmailLookupRequest;
}

interface CalendarLookupRequest {
  topic?: string;
  targetDate?: {
    isoDate: string;
    startIso: string;
    endIso: string;
    label: string;
  };
}

interface CalendarPeriodWindow {
  startIso: string;
  endIso: string;
  label: string;
}

function parseCalendarPeriodWindow(prompt: string, timezone: string): CalendarPeriodWindow | undefined {
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

function isCalendarPeriodListPrompt(prompt: string): boolean {
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

function isCalendarConflictReviewPrompt(prompt: string): boolean {
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

function isCalendarMovePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mova o evento",
    "mover o evento",
    "reagende o evento",
    "reagendar o evento",
    "mude o evento",
    "altere o evento",
    "alterar o evento",
    "atualize o evento",
    "atualizar o evento",
    "ajuste o evento",
    "ajustar o evento",
    "edite o evento",
    "editar o evento",
    "renomeie o evento",
    "renomear o evento",
  ]);
}

function isCalendarPeriodDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "cancele meus compromissos",
    "cancele meus eventos",
    "cancele minha agenda",
    "exclua meus compromissos",
    "exclua meus eventos",
  ]);
}

function extractCalendarMoveParts(prompt: string): { verb: string; source: string; targetInstruction: string } | undefined {
  const match = prompt.match(
    /\b(mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\s+o?\s*evento\s+(.+?)\s+(?:para|com)\s+([\s\S]+)/i,
  );
  if (!match?.[1] || !match?.[2] || !match?.[3]) {
    return undefined;
  }
  return {
    verb: match[1].trim(),
    source: match[2].trim(),
    targetInstruction: match[3].trim(),
  };
}

function normalizeCalendarUpdateInstruction(input: {
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

function isCalendarDeletePrompt(prompt: string): boolean {
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
  return hasDeleteVerb && hasCalendarObject;
}

function extractCalendarDeleteTopic(prompt: string): string | undefined {
  const patterns = [
    /\b(?:cancele|cancela|cancelar|exclua|excluir|delete|apague|apagar|remova|remover)\s+(?:o|a|os|as)?\s*(?:evento|compromisso|reuniao|reunião)?\s+["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\s+na\s+conta\b|\s+no\s+calend[aá]rio\b|\s+na\s+agenda\b|\s+se\s+for\s+recorrent|\s+e\s+se\s+for\s+recorrent|\?|$))/i,
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

function cleanCalendarEventTopicReference(value: string | undefined): string | undefined {
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

  return cleaned || undefined;
}

function matchesCalendarEventTopic(summary: string, topic: string): boolean {
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

function extractExplicitAccountAlias(prompt: string, aliases: string[]): string | undefined {
  return extractExplicitGoogleAccountAlias(prompt, aliases);
}

function resolvePromptAccountAliases(
  prompt: string,
  aliases: string[],
  defaultScope: PersonalOperationalProfile["defaultAgendaScope"] = "both",
): string[] {
  return resolveGoogleAccountAliasesForPrompt(prompt, aliases, defaultScope);
}

function shouldSearchAllCalendars(prompt: string): boolean {
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

function resolveCalendarTargets(
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

function extractExplicitCalendarAlias(prompt: string, aliases: string[]): string | undefined {
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

function extractEmailLookbackHours(prompt: string): number {
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

function extractEmailLookupCategory(prompt: string): EmailOperationalGroup | undefined {
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

function cleanSenderQuery(value: string): string {
  return value
    .trim()
    .replace(/^[\"'`]+|[\"'`]+$/g, "")
    .replace(/\s+(?:de hoje|hoje|de ontem|ontem|dessa semana|esta semana|não lido|nao lido).*$/i, "")
    .replace(/\s+e\s+(?:me|redija|gere|crie|fa[cç]a|resuma|envie|mostre|traga|entregue).*$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/^(o|a)\s+/i, "")
    .trim();
}

function extractSenderQuery(prompt: string): string | undefined {
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

function extractEmailLookupRequest(prompt: string): EmailLookupRequest | undefined {
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

function extractDisplayName(value: string): string | undefined {
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

function inferReplyContext(
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

function hasAffirmativeIntent(userPrompt: string): boolean {
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

function hasRejectionIntent(userPrompt: string): boolean {
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

function extractToneHint(
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

function buildAffirmativeReplyTemplate(input: {
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

function buildRejectionReplyTemplate(input: {
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

interface InboxTriageItem {
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

function extractEmailIdentifier(from: string[]): string | undefined {
  const combined = from.join(" ");
  const match = combined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase();
}

function buildEmailSummaryReply(input: {
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

function formatEmailTimestamp(date: string | null): string {
  return date ?? "(data desconhecida)";
}

function matchesSenderQuery(message: EmailMessageSummary, senderQuery: string): boolean {
  const haystack = normalizeEmailAnalysisText(
    `${message.subject}\n${message.from.join(" ")}\n${message.preview}`,
  );
  const query = normalizeEmailAnalysisText(senderQuery);
  const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
  return tokens.length > 0 ? tokens.every((token) => haystack.includes(token)) : haystack.includes(query);
}

function buildEmailLookupLabel(request: EmailLookupRequest): string {
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

function buildEmailLookupMissReply(request: EmailLookupRequest): string {
  return [
    `Não encontrei emails recentes para ${buildEmailLookupLabel(request)}.`,
    `Janela analisada: ${request.sinceHours} horas.`,
    request.unreadOnly ? "Filtro aplicado: somente não lidos." : "Filtro aplicado: lidos e não lidos.",
  ].join("\n");
}

function buildEmailLookupReply(input: {
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

function buildCalendarLookupReply(input: {
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

function formatBriefDateTime(value: string | null, timezone: string): string {
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

function formatCalendarDayHeader(value: string | null, timezone: string): string {
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

function formatCalendarTimeRange(
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

function formatTaskDue(task: TaskSummary, timezone: string): string {
  return formatBriefDateTime(task.due ?? task.updated, timezone);
}

function truncateBriefText(value: string | null | undefined, maxLength = 72): string {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(sem detalhe)";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function summarizeEmailSender(from: string[]): string {
  const primary = from.find((item) => item.trim())?.trim();
  if (!primary) {
    return "(remetente desconhecido)";
  }

  const match = primary.match(/^(.*?)\s*<[^>]+>$/);
  const label = match?.[1]?.replace(/^"+|"+$/g, "").trim() || primary;
  return truncateBriefText(label, 28);
}

function isOperationalNoise(value: string | null | undefined): boolean {
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

interface MorningBriefEmailItem {
  account: string;
  uid: string;
  subject: string;
  from: string[];
  priority: string;
  action: string;
  relationship: string;
  group: EmailOperationalGroup;
}

interface MorningTaskBuckets {
  today: Array<TaskSummary & { account: string }>;
  overdue: Array<TaskSummary & { account: string }>;
  stale: Array<TaskSummary & { account: string }>;
  actionableCount: number;
}

function getBriefDayKey(date: Date, timezone: string): string {
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

function diffDayKeys(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

function classifyMorningTaskBucket(
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

function buildMorningTaskBuckets(
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

function describeFounderSectionStatus(section: FounderOpsSnapshot["sections"][number]): string {
  const statusLabel = section.status === "connected" ? "conectado" : "aguardando integração";
  return `${section.title}: ${statusLabel} — ${section.summary}`;
}

function summarizeTrackedMetrics(metrics: string[]): string {
  if (metrics.length === 0) {
    return "";
  }

  const visible = metrics.slice(0, 6).join(", ");
  const hidden = metrics.length - 6;
  return hidden > 0 ? `${visible} e mais ${hidden}` : visible;
}

function labelBriefOwner(owner: "paulo" | "equipe" | "delegavel"): string {
  switch (owner) {
    case "paulo":
      return "Paulo";
    case "equipe":
      return "Equipe";
    case "delegavel":
      return "Delegável";
  }
}

function formatBriefTemperature(value?: number): string {
  return typeof value === "number" ? `${Math.round(value)}°C` : "?";
}

function formatBriefTemperatureRange(min?: number, max?: number): string {
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

function emailRelationshipWeight(relationship: string): number {
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

function chooseMorningNextAction(input: {
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

function buildOperationalBriefReply(input: {
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

function classifyBriefPeriod(iso: string | null | undefined, timezone: string): "manha" | "tarde" | "noite" | "sem_horario" {
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
  const compact = options?.compact === true || options?.operationalMode === "field";
  const highestEmail = input.emails.find((item) => item.priority === "alta") ?? input.emails[0];
  const nextEvent = input.events[0];
  const nextTask = input.taskBuckets.overdue[0] ?? input.taskBuckets.today[0];
  const topOperationalSignal = input.operationalSignals?.[0];
  const pauloConflicts = input.events.filter((event) => event.owner === "paulo" && event.hasConflict);
  const focusLabel = truncateBriefText(options?.profile?.savedFocus[0] ?? input.personalFocus[0] ?? "", 110);
  const groupedEvents = {
    manha: input.events.filter((event) => classifyBriefPeriod(event.start, input.timezone) === "manha"),
    tarde: input.events.filter((event) => classifyBriefPeriod(event.start, input.timezone) === "tarde"),
    noite: input.events.filter((event) => classifyBriefPeriod(event.start, input.timezone) === "noite"),
  };
  const periodCounts = [
    { label: "manhã", count: groupedEvents.manha.length },
    { label: "tarde", count: groupedEvents.tarde.length },
    { label: "noite", count: groupedEvents.noite.length },
  ].sort((left, right) => right.count - left.count);
  const busiestPeriod = periodCounts[0]?.count ? periodCounts[0].label : undefined;
  const actionableTasks = input.taskBuckets.actionableCount;
  const keyAttentionCount =
    (pauloConflicts.length > 0 ? 1 : 0)
    + (nextTask ? 1 : 0)
    + (highestEmail ? 1 : 0);

  const summarizeEventLine = (event: ExecutiveMorningBrief["events"][number]): string => {
    const tags = [
      event.hasConflict ? "conflito" : undefined,
      compact ? undefined : event.owner !== "paulo" ? labelBriefOwner(event.owner) : undefined,
    ].filter(Boolean);
    return `${formatBriefDateTime(event.start, input.timezone)} — ${truncateBriefText(event.summary)}${event.location ? ` — ${summarizeCalendarLocation(event.location)}` : ""}${tags.length > 0 ? ` | ${tags.join(" | ")}` : ""}`;
  };

  const visionLine = compact
    ? `Hoje o foco é operar em modo rua, com ${input.events.length} compromisso(s) e ${keyAttentionCount} ponto(s) que merecem atenção imediata.`
    : `Hoje teu dia está ${input.overloadLevel}, com ${input.events.length} compromisso(s) e ${actionableTasks} tarefa(s) que podem virar ação real.`;
  const periodLine = busiestPeriod
    ? `O trecho mais carregado tende a ficar na ${busiestPeriod}${pauloConflicts.length > 0 ? ", então vale resolver conflito antes de abrir coisa nova." : "."}`
    : undefined;
  const mainAttention = pauloConflicts[0]
    ? `O principal agora é tirar o conflito em ${truncateBriefText(pauloConflicts[0].summary, 96)} antes que ele contamine o resto do dia.`
    : topOperationalSignal
      ? `O principal agora é revisar este sinal do institucional: ${truncateBriefText(topOperationalSignal.summary, 96)}.`
    : nextEvent
      ? `O principal agora é ${nextEvent.prepHint} para ${truncateBriefText(nextEvent.summary, 96)}.`
      : nextTask
        ? `O principal agora é destravar ${truncateBriefText(nextTask.title, 96)} para não empurrar isso mais uma vez.`
        : highestEmail
          ? `O principal agora é decidir se ${truncateBriefText(highestEmail.subject || "(sem assunto)", 96)} exige ação hoje.`
          : "O principal agora é manter o dia simples e sem abrir frente desnecessária.";

  const lines = [
    "Briefing da manhã",
    "",
    "Visão do dia:",
    `- ${visionLine}`,
  ];

  if (periodLine) {
    lines.push(`- ${periodLine}`);
  }
  if (focusLabel) {
    lines.push(`- Foco de base: ${focusLabel}`);
  }

  lines.push("", "Atenção principal:");
  lines.push(`- ${mainAttention}`);
  if (nextEvent) {
    lines.push(`- Próximo compromisso: ${summarizeEventLine(nextEvent)}`);
  }
  if (topOperationalSignal) {
    lines.push(`- Sinal operacional ativo: ${truncateBriefText(topOperationalSignal.summary, 104)}${topOperationalSignal.priority !== "low" ? ` | prioridade ${topOperationalSignal.priority}` : ""}`);
  }
  if (pauloConflicts.length > 0) {
    lines.push(`- ${pauloConflicts.length} conflito(s) de agenda ainda exigem decisão antes de aceitar coisa nova.`);
  }
  if (nextTask) {
    lines.push(`- Tarefa que pode te travar: ${truncateBriefText(nextTask.title)} — ${formatTaskDue(nextTask, input.timezone)}`);
  }
  if (highestEmail) {
    lines.push(`- Email que merece triagem: ${truncateBriefText(highestEmail.subject || "(sem assunto)")} — ${summarizeEmailSender(highestEmail.from)}`);
  }
  if (!nextEvent && !nextTask && !highestEmail) {
    lines.push("- Nada crítico pendente agora.");
  }

  lines.push("", "Rua, clima e deslocamento:");
  if (input.mobilityAlerts.length > 0) {
    for (const item of input.mobilityAlerts.slice(0, compact ? 2 : 3)) {
      lines.push(`- ${truncateBriefText(item, 110)}`);
    }
  }
  if (input.weather?.current) {
    lines.push(`- Agora em ${input.weather.locationLabel}: ${input.weather.current.description}, ${formatBriefTemperature(input.weather.current.temperatureC)}.`);
  }
  for (const day of (input.weather?.days ?? []).slice(0, compact ? 1 : 2)) {
    const rain = typeof day.precipitationProbabilityMax === "number"
      ? ` | chuva ${day.precipitationProbabilityMax}%`
      : "";
    lines.push(`- ${day.label}: ${day.description} | ${formatBriefTemperatureRange(day.minTempC, day.maxTempC)}${rain}`);
    lines.push(`  Dica prática: ${day.tip}`);
  }
  if ((input.weather?.days.length ?? 0) === 0 && input.mobilityAlerts.length === 0) {
    lines.push("- Sem alerta extra de clima ou deslocamento agora.");
  }

  lines.push("", "Agenda limpa:");
  if (input.events.length === 0) {
    lines.push("- Nenhum compromisso pessoal hoje.");
  } else {
    if (groupedEvents.manha.length > 0) {
      lines.push("- Manhã:");
      for (const event of groupedEvents.manha) {
        lines.push(`  - ${summarizeEventLine(event)}`);
      }
    }
    if (groupedEvents.tarde.length > 0) {
      lines.push("- Tarde:");
      for (const event of groupedEvents.tarde) {
        lines.push(`  - ${summarizeEventLine(event)}`);
      }
    }
    if (groupedEvents.noite.length > 0) {
      lines.push("- Noite:");
      for (const event of groupedEvents.noite) {
        lines.push(`  - ${summarizeEventLine(event)}`);
      }
    }
  }

  lines.push("", "Prioridade do dia / próxima ação:");
  if (input.dayRecommendation) {
    lines.push(`- Prioridade: ${truncateBriefText(input.dayRecommendation, 120)}`);
  }
  if (input.nextAction) {
    lines.push(`- Próxima ação: ${truncateBriefText(input.nextAction, 110)}`);
  }
  if (compact && options?.profile?.attire.carryItems.length) {
    lines.push(`- Levar: ${options.profile.attire.carryItems.slice(0, 4).join(", ")}`);
  }
  if (!input.dayRecommendation && !input.nextAction) {
    lines.push("- Seguir pelo próximo compromisso do dia.");
  }

  lines.push("", "Mensagem do dia:");
  lines.push(`"${input.motivation.text}"`);
  if (input.motivation.author) {
    lines.push(input.motivation.author);
  }

  return lines.join("\n");
}

function buildMacQueueStatusReply(input: {
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

function buildMacQueueListReply(items: Array<{ id: string; summary: string; status: string; createdAt: string }>): string {
  if (items.length === 0) {
    return "Não encontrei comandos pendentes na fila do Mac.";
  }

  return [
    `Comandos pendentes na fila do Mac: ${items.length}.`,
    ...items.map((item) => `- ${item.summary} | status: ${item.status} | id: ${item.id}`),
  ].join("\n");
}

function buildMacQueueEnqueueReply(input: { id: string; summary: string; targetHost?: string }): string {
  return [
    "Comando enfileirado para o Mac.",
    `- Resumo: ${input.summary}`,
    `- ID: ${input.id}`,
    `- Target host: ${input.targetHost ?? "atlas_mac"}`,
  ].join("\n");
}

function buildGoogleTasksReply(input: {
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

function buildGoogleContactsReply(input: {
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

function buildGoogleCalendarsReply(input: {
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

function labelAgendaScope(scope: PersonalOperationalProfile["defaultAgendaScope"]): string {
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

function buildEmptyCalendarPeriodReply(label: string): string {
  const normalized = normalizeEmailAnalysisText(label);
  if (normalized === "amanha" || normalized === "amanhã") {
    return "Nenhum compromisso para amanhã.";
  }
  if (normalized === "hoje") {
    return "Nenhum compromisso para hoje.";
  }
  return `Nenhum compromisso em ${label}.`;
}

function buildCalendarPeriodReply(input: {
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

function summarizeCalendarLocation(value: string | undefined): string | undefined {
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

function buildPlaceLookupReply(result: GooglePlaceLookupResult): string {
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

function buildPlaceDiscoveryReply(input: {
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

function buildUserPreferencesReply(preferences: UserPreferences): string {
  return [
    "Preferências ativas:",
    `- Estilo: ${preferences.responseStyle}`,
    `- Tamanho: ${preferences.responseLength}`,
    `- Próxima ação sugerida: ${preferences.proactiveNextStep ? "sim" : "não"}`,
    `- Fallback automático de fontes: ${preferences.autoSourceFallback ? "sim" : "não"}`,
    `- Nome do agente: ${preferences.preferredAgentName}`,
  ].join("\n");
}

function buildPersonalOperationalProfileReply(profile: PersonalOperationalProfile): string {
  return [
    "Perfil operacional base:",
    `- Nome: ${profile.displayName}`,
    `- Papel principal: ${profile.primaryRole}`,
    `- Fuso: ${profile.timezone}`,
    `- Canais preferidos: ${profile.preferredChannels.join(" | ")}`,
    `- Canal preferido de alerta: ${profile.preferredAlertChannel ?? "não definido"}`,
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

function buildPersonalOperationalProfileUpdatedReply(
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

function buildPersonalOperationalProfileRemovedReply(
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

function buildOperationalStateReply(state: OperationalState): string {
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

function stateDateTimeLabel(value: string): string | undefined {
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

function formatLearnedPreferenceTypeLabel(type: LearnedPreference["type"]): string {
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

function buildLearnedPreferencesReply(items: LearnedPreference[]): string {
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

function buildLearnedPreferenceDeactivatedReply(item: LearnedPreference): string {
  return [
    "Preferência aprendida desativada.",
    `- #${item.id} | ${formatLearnedPreferenceTypeLabel(item.type)} | ${item.description} => ${item.value}`,
  ].join("\n");
}

function buildCapabilityGapSignature(plan: CapabilityPlan): string {
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

function formatCapabilityObjectiveLabel(objective: CapabilityPlan["objective"]): string {
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

function formatDurationMinutes(seconds: number): string {
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

function formatKilometers(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: km >= 100 ? 0 : 1,
    maximumFractionDigits: km >= 100 ? 0 : 1,
  }).format(km);
}

function formatMoneyAmount(currencyCode: string, amount: number): string {
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

function buildCapabilityAvailabilityReply(items: CapabilityAvailabilityRecord[]): string {
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

function buildProductGapsReply(items: ProductGapRecord[]): string {
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

function buildCapabilityPlanUserDataReply(plan: CapabilityPlan): string {
  const fields = plan.missingUserData.join(" e ");
  switch (plan.objective) {
    case "travel_cost_estimate":
      return `Consigo seguir com essa estimativa. Me passe só ${fields}.`;
    case "route_distance":
    case "route_tolls":
      return `Consigo calcular isso. Só preciso de ${fields}.`;
    case "place_discovery":
      return `Consigo buscar isso no mapa. Me passe só ${fields}.`;
    case "flight_search":
    case "bus_search":
    case "hotel_search":
      return `Consigo pesquisar isso. Me passe só ${fields}.`;
    default:
      return `Consigo seguir com isso. Me passe só ${fields}.`;
  }
}

function buildCapabilityGapReply(plan: CapabilityPlan, gap?: ProductGapRecord): string {
  const missingCapabilities = [...new Set(plan.missingRequirements
    .filter((item) => item.kind !== "user_data")
    .map((item) => item.label))];
  const missingData = [...new Set(plan.missingUserData)];
  const lines = [
    `Entendi que você quer ${formatCapabilityObjectiveLabel(plan.objective)}.`,
  ];

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

function buildProductGapDetailReply(item: ProductGapRecord): string {
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

function buildMapsRouteReply(input: {
  objective: CapabilityPlan["objective"];
  route: GoogleRouteLookupResult;
  roundTrip?: boolean;
  fuelPricePerLiter?: number;
  consumptionKmPerLiter?: number;
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
  lines.push(`Maps: ${input.route.mapsUrl}`);
  return lines.join(" ");
}

function formatPersonalMemoryKindLabel(kind: PersonalOperationalMemoryItemKind): string {
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

function buildPersonalMemoryListReply(input: {
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

function buildPersonalMemorySavedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal salva.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
    `- Conteúdo: ${item.content}`,
  ].join("\n");
}

function buildPersonalMemoryUpdatedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal atualizada.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
    `- Conteúdo: ${item.content}`,
  ].join("\n");
}

function buildPersonalMemoryDeletedReply(item: PersonalOperationalMemoryItem): string {
  return [
    "Memória pessoal removida.",
    `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`,
  ].join("\n");
}

function buildPersonalMemoryAmbiguousReply(query: string, items: PersonalOperationalMemoryItem[]): string {
  return [
    `Encontrei mais de um item para "${query}". Diga o id exato para eu seguir.`,
    ...items.slice(0, 5).map((item) => `- #${item.id} | ${formatPersonalMemoryKindLabel(item.kind)} | ${item.title}`),
  ].join("\n");
}

function isContactListPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "liste meus contatos",
    "listar contatos",
    "contatos inteligentes",
    "base de contatos",
  ]);
}

function isContactUpsertPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "salve contato",
    "cadastre contato",
    "registre contato",
    "adicione contato",
  ]);
}

function defaultPersonaForRelationship(relationship: ContactRelationship): ContactPersona {
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

function parseContactRelationship(prompt: string): ContactRelationship {
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

function extractLabeledValue(prompt: string, labels: string[], stopLabels: string[]): string | undefined {
  const pattern = new RegExp(
    String.raw`(?:^|\s)(?:${labels.join("|")})\s*[:\-]?\s*(.+?)(?=\s+(?:${stopLabels.join("|")})\b|$)`,
    "i",
  );
  return pattern.exec(prompt)?.[1]?.trim();
}

function extractContactProfileInput(prompt: string): UpsertContactProfileInput | undefined {
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

function buildContactSaveReply(contact: ContactProfileRecord): string {
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

function buildContactListReply(contacts: ContactProfileRecord[]): string {
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

function extractMemoryEntityKindFromPrompt(prompt: string): MemoryEntityKind | undefined {
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

function extractMemoryEntitySearchQuery(prompt: string): string | undefined {
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

function buildMemoryEntityListReply(entities: MemoryEntityRecord[], input: {
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

function inferIntentObjective(prompt: string, input: IntentResolution): string {
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

function inferIntentNextStep(input: IntentResolution): string | undefined {
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

function buildOperationalPlanContract(
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

  if (brief.events.length > 0) {
    currentSituation.push(`${brief.events.length} compromisso(s) no dia`);
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

function buildWhatsAppDraftMarker(draft: {
  instanceName?: string;
  account?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText?: string;
  replyText: string;
  relationship?: string;
  persona?: string;
}): string {
  return [
    "WHATSAPP_REPLY_DRAFT",
    JSON.stringify({
      kind: "whatsapp_reply",
      instanceName: draft.instanceName,
      account: draft.account,
      remoteJid: draft.remoteJid,
      number: draft.number,
      pushName: draft.pushName,
      inboundText: draft.inboundText ?? "",
      replyText: draft.replyText,
      relationship: draft.relationship,
      persona: draft.persona,
    }),
    "END_WHATSAPP_REPLY_DRAFT",
  ].join("\n");
}

function buildWhatsAppDirectDraftReply(input: {
  nameOrNumber: string;
  number: string;
  text: string;
  account?: string;
  instanceName?: string;
  marker: string;
}): string {
  return [
    input.marker,
    `Rascunho WhatsApp pronto para ${input.nameOrNumber}.`,
    `Número: ${input.number}`,
    ...(input.account ? [`Conta operacional: ${input.account}`] : []),
    ...(input.instanceName ? [`Instância: ${input.instanceName}`] : []),
    `Mensagem: ${input.text}`,
    "Confirme com `enviar` ou use os botões `Enviar`, `Editar` ou `Ignorar`.",
  ].join("\n");
}

function buildWhatsAppRecentMessagesReply(query: string, messages: WhatsAppMessageRecord[]): string {
  if (messages.length === 0) {
    return [
      `Não encontrei mensagens registradas de ${query} no WhatsApp do Atlas.`,
      "Se a conversa chegou antes da integração, ela ainda não aparece no histórico local.",
    ].join("\n");
  }

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return [
    `Mensagens recentes de ${query}: ${messages.length}.`,
    ...messages.map((item) => {
      const when = formatter.format(new Date(item.createdAt));
      const who = item.pushName ?? item.number ?? item.remoteJid;
      const direction = item.direction === "inbound" ? "recebida" : "enviada";
      return `- ${direction} | ${when} | ${who} | ${item.text}`;
    }),
  ].join("\n");
}

function buildWhatsAppScopedRecentMessagesReply(label: string, messages: WhatsAppMessageRecord[]): string {
  if (messages.length === 0) {
    return [
      `Não encontrei mensagens registradas no WhatsApp da conta ${label}.`,
      "Envie uma mensagem nova para essa instância e tente novamente.",
    ].join("\n");
  }

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return [
    `Mensagens recentes do WhatsApp ${label}: ${messages.length}.`,
    ...messages.map((item) => {
      const when = formatter.format(new Date(item.createdAt));
      const who = item.pushName ?? item.number ?? item.remoteJid;
      const direction = item.direction === "inbound" ? "recebida" : "enviada";
      return `- ${direction} | ${when} | ${who} | ${item.text}`;
    }),
  ].join("\n");
}

function buildWhatsAppScopedRecentChatsReply(label: string, chats: EvolutionRecentChatRecord[]): string {
  const filteredChats = chats.filter((item) => !item.isSystem).slice(0, 8);
  if (filteredChats.length === 0) {
    return [
      `Não encontrei conversas recentes no WhatsApp da conta ${label}.`,
      "Se a instância acabou de conectar, tente de novo em alguns instantes.",
    ].join("\n");
  }

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const summarize = (value: string | undefined): string => {
    const compact = (value ?? "sem texto").replace(/\s+/g, " ").trim();
    return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
  };
  const hasUrgencySignal = (value: string | undefined): boolean => {
    const normalized = normalizeEmailAnalysisText(value ?? "");
    return includesAny(normalized, [
      "urgente",
      "urgencia",
      "urgência",
      "agora",
      "hoje ainda",
      "assim que puder",
      "me liga",
      "me ligue",
      "responde",
      "preciso de ti",
      "preciso de voce",
      "preciso de você",
    ]);
  };

  return [
    `Conversas recentes do WhatsApp ${label}: ${filteredChats.length}.`,
    ...filteredChats.map((item) => {
      const when = item.updatedAt ? formatter.format(new Date(item.updatedAt)) : "sem horário";
      const priority = item.mentionedJids.length > 0 || hasUrgencySignal(item.lastMessageText);
      const groupLabel = item.chatName ?? item.remoteJid;
      const directLabel = item.senderName ?? item.remoteJidAlt ?? item.remoteJid;
      const direction = item.fromMe ? "enviada" : "recebida";
      const text = summarize(item.lastMessageText);
      if (item.isGroup) {
        const sender = item.senderName && item.senderName !== item.chatName
          ? item.senderName
          : "autor não identificado";
        return `- ${priority ? "[PRIORIDADE] " : ""}${when} | grupo: ${groupLabel} | autor: ${sender} | ${direction} | ${text}`;
      }
      return `- ${priority ? "[PRIORIDADE] " : ""}${when} | direto: ${directLabel} | ${direction} | ${text}`;
    }),
  ].join("\n");
}

function buildWhatsAppPendingApprovalsReply(items: ApprovalInboxItemRecord[]): string {
  if (items.length === 0) {
    return "Não há aprovações pendentes de WhatsApp.";
  }

  return [
    `Aprovações pendentes de WhatsApp: ${items.length}.`,
    ...items.map((item) => `- #${item.id} | ${item.subject}`),
  ].join("\n");
}

function shouldAutoCreateGoogleEvent(prompt: string, draft: PendingGoogleEventDraft, writeReady: boolean): boolean {
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

function buildDirectGoogleEventCreateReply(rawResult: unknown, timeZone: string): string {
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

function isWorkflowPlanningPrompt(prompt: string): boolean {
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

function isWorkflowListPrompt(prompt: string): boolean {
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

function isWorkflowShowPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "mostre o workflow",
    "abrir workflow",
    "detalhe do workflow",
    "etapas do workflow",
    "plano do workflow",
  ]) && /\bworkflow\s+\d+\b/i.test(prompt);
}

function isWorkflowExecutionPrompt(prompt: string): boolean {
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

function shouldAutoExecuteWorkflowDeliverable(prompt: string): boolean {
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

function isWorkflowArtifactListPrompt(prompt: string): boolean {
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

function isWorkflowStepUpdatePrompt(prompt: string): boolean {
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

function extractWorkflowPlanId(prompt: string): number | undefined {
  const match = prompt.match(/\bworkflow\s+(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractWorkflowStepNumber(prompt: string): number | undefined {
  const match = prompt.match(/\betapa\s+(\d+)\b/i);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractWorkflowStepStatus(prompt: string): "pending" | "in_progress" | "waiting_approval" | "blocked" | "completed" | "failed" | undefined {
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

function buildWorkflowPlanReply(plan: WorkflowPlanRecord): string {
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

function buildWorkflowListReply(plans: WorkflowPlanRecord[]): string {
  if (plans.length === 0) {
    return "Não encontrei workflows salvos.";
  }

  return [
    `Workflows salvos: ${plans.length}.`,
    ...plans.map((plan) => `- #${plan.id} | ${plan.title} | ${plan.status} | ${plan.primaryDomain}`),
  ].join("\n");
}

function buildWorkflowStepUpdateReply(plan: WorkflowPlanRecord, stepNumber: number): string {
  const step = plan.steps.find((item) => item.stepNumber === stepNumber);
  if (!step) {
    return `Workflow #${plan.id} atualizado, mas não encontrei a etapa ${stepNumber} no retorno final.`;
  }
  return `Workflow #${plan.id} atualizado. Etapa ${step.stepNumber} agora está como ${step.status}: ${step.title}.`;
}

function buildWorkflowExecutionReply(input: {
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

function buildWorkflowArtifactsReply(plan: WorkflowPlanRecord, artifacts: WorkflowArtifactRecord[], stepNumber?: number): string {
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

function buildWebResearchReply(input: {
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

function buildInternalKnowledgeReply(input: {
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

function isAddressLookupPrompt(prompt: string): boolean {
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

function isPhoneLookupPrompt(prompt: string): boolean {
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

function isHoursLookupPrompt(prompt: string): boolean {
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

function isCapacityLookupPrompt(prompt: string): boolean {
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

type ResearchFactType = "address" | "phone" | "hours" | "capacity";

function extractRequestedResearchFactTypes(prompt: string): ResearchFactType[] {
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

function extractAddressFromText(text: string): string | undefined {
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

function extractPhoneFromText(text: string): string | undefined {
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

function extractHoursFromText(text: string): string | undefined {
  const match =
    text.match(/\bhor[aá]rio:\s*((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)/i) ??
    text.match(/\b((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

function extractCapacityFromText(text: string): string | undefined {
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

function buildAddressLookupReply(input: {
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

function buildDeterministicFactLookupReply(input: {
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

function extractResearchFacts(text: string): string[] {
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

function looksLikePostalAddress(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) {
    return false;
  }

  return /\b(?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\b/i.test(text) && /\b\d+\b/.test(text);
}

function buildEventLocationResearchQuery(location: string, prompt: string): string {
  const normalizedPrompt = normalizeEmailAnalysisText(prompt);
  const parts = [`"${location}"`, "endereco"];
  if (normalizedPrompt.includes("porto alegre") || normalizedPrompt.includes("restinga")) {
    parts.push("porto alegre");
  }
  return parts.join(" ");
}

function buildLocationTermHints(location: string): string[] {
  return normalizeEmailAnalysisText(location)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !["quadra", "arena", "campo", "sports", "sport", "clube"].includes(item));
}

function isAmbiguousPublicServiceLocation(location: string): boolean {
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function resolveDuckDuckGoRedirectUrl(rawHref: string): string {
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

async function lookupVenueAddress(
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

async function fetchOfficialAliasSources(
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

function inferOfficialFallbackUrls(query: string, aliasOfficialUrls?: string[]): string[] {
  const urls = new Set(aliasOfficialUrls ?? []);
  const normalized = normalizeEmailAnalysisText(query);

  if (normalized.includes("albergue") && normalized.includes("porto alegre")) {
    urls.add("https://prefeitura.poa.br/fasc/albergue");
    urls.add("https://prefeitura.poa.br/gp/noticias/capital-tera-dois-novos-albergues-para-pessoas-em-situacao-de-rua");
  }

  return [...urls];
}

function stripResearchReplyMarkdown(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildResearchFocusTerms(query: string, alias?: { terms?: string[]; matchedTerms?: string[] }): string[] {
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

type ResearchSynthesisProfile = "general" | "market";

function inferResearchSynthesisProfile(prompt: string, query: string): ResearchSynthesisProfile {
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

function extractFocusedExcerpt(text: string, focusTerms: string[], maxChars: number): string {
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

function scoreFocusedExcerpt(excerpt: string | undefined, focusTerms: string[]): number {
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

async function fetchOfficialHtmlExcerpt(url: string, focusTerms: string[] = [], maxChars = 4000): Promise<string> {
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatFollowUpDueLabel(value: string | null | undefined): string {
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

function classifyFollowUpBucket(lead: LeadRecord): "overdue" | "today" | "upcoming" | "unscheduled" | "later" {
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

function buildRevenueScoreboardReply(input: {
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

function buildAllowedSpacesReply(roots: Record<ReadableRootKey, string>): string {
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

function buildContentOverviewReply(items: Array<{
  id: number;
  title: string;
  platform: string;
  format: string;
  status: string;
  targetDate: string | null;
  pillar: string | null;
  channelKey?: string | null;
  seriesKey?: string | null;
  ideaScore?: number | null;
  queuePriority?: number | null;
  reviewFeedbackCategory?: string | null;
  reviewFeedbackReason?: string | null;
}>): string {
  if (!items.length) {
    return "Nao ha itens de conteudo salvos para os filtros informados.";
  }

  return [
    `Conteudo encontrado: ${items.length} item(ns).`,
    ...items.map((item) =>
      [
        `- #${item.id}`,
        item.channelKey ? `canal: ${item.channelKey}` : item.platform,
        item.format,
        item.status,
        item.title,
        item.seriesKey ? `serie: ${item.seriesKey}` : undefined,
        item.targetDate ? `data: ${item.targetDate}` : undefined,
        item.pillar ? `pilar: ${item.pillar}` : undefined,
        item.ideaScore != null ? `score: ${item.ideaScore}` : undefined,
        item.queuePriority != null ? `prioridade: ${item.queuePriority}` : undefined,
        item.reviewFeedbackCategory ? `feedback: ${item.reviewFeedbackCategory}` : undefined,
        item.reviewFeedbackReason ? `motivo: ${truncateBriefText(item.reviewFeedbackReason, 56)}` : undefined,
      ].filter(Boolean).join(" | "),
    ),
  ].join("\n");
}

function buildContentChannelsReply(channels: Array<{
  key: string;
  name: string;
  platform: string;
  status: string;
  frequencyPerWeek: number | null;
  primaryGoal: string | null;
}>): string {
  if (!channels.length) {
    return "Nao encontrei canais editoriais configurados.";
  }

  return [
    `Canais editoriais: ${channels.length}.`,
    ...channels.map((channel) =>
      `- ${channel.name} | key: ${channel.key} | plataforma: ${channel.platform} | status: ${channel.status}${channel.frequencyPerWeek ? ` | freq: ${channel.frequencyPerWeek}/semana` : ""}${channel.primaryGoal ? ` | objetivo: ${channel.primaryGoal}` : ""}`,
    ),
  ].join("\n");
}

function buildContentSeriesReply(series: Array<{
  key: string;
  channelKey: string;
  title: string;
  cadence: string | null;
  status: string;
  premise: string | null;
}>): string {
  if (!series.length) {
    return "Nao encontrei series editoriais para os filtros atuais.";
  }

  return [
    `Series editoriais: ${series.length}.`,
    ...series.map((item) =>
      `- ${item.title} | key: ${item.key} | canal: ${item.channelKey} | status: ${item.status}${item.cadence ? ` | cadencia: ${item.cadence}` : ""}${item.premise ? ` | premissa: ${truncateBriefText(item.premise, 72)}` : ""}`,
    ),
  ].join("\n");
}

function buildContentFormatsReply(templates: Array<{
  key: string;
  label: string;
  active: boolean;
  structure: string;
  description: string | null;
}>): string {
  if (!templates.length) {
    return "Nao encontrei formatos editoriais configurados.";
  }

  return [
    `Formatos editoriais: ${templates.length}.`,
    ...templates.map((template) =>
      `- ${template.label} | key: ${template.key} | ${template.active ? "ativo" : "inativo"} | estrutura: ${truncateBriefText(template.structure, 72)}${template.description ? ` | uso: ${truncateBriefText(template.description, 56)}` : ""}`,
    ),
  ].join("\n");
}

function buildContentHooksReply(hooks: Array<{
  label: string;
  category: string | null;
  effectivenessScore: number | null;
  template: string;
}>): string {
  if (!hooks.length) {
    return "Nao encontrei hooks salvos na biblioteca editorial.";
  }

  return [
    `Hooks salvos: ${hooks.length}.`,
    ...hooks.map((hook) =>
      `- ${hook.label}${hook.category ? ` | categoria: ${hook.category}` : ""}${hook.effectivenessScore != null ? ` | score: ${hook.effectivenessScore}` : ""} | template: ${truncateBriefText(hook.template, 84)}`,
    ),
  ].join("\n");
}

function buildContentIdeaGenerationReply(items: Array<{
  id: number;
  title: string;
  channelKey: string | null;
  formatTemplateKey: string | null;
  seriesKey: string | null;
  ideaScore: number | null;
  scoreReason: string | null;
}>): string {
  if (!items.length) {
    return "Nao consegui gerar pautas editoriais nesta tentativa.";
  }

  return [
    `Pautas geradas e salvas: ${items.length}.`,
    ...items.map((item) =>
      `- #${item.id} | ${item.title}${item.channelKey ? ` | canal: ${item.channelKey}` : ""}${item.formatTemplateKey ? ` | formato: ${item.formatTemplateKey}` : ""}${item.seriesKey ? ` | serie: ${item.seriesKey}` : ""}${item.ideaScore != null ? ` | score: ${item.ideaScore}` : ""}${item.scoreReason ? ` | motivo: ${truncateBriefText(item.scoreReason, 60)}` : ""}`,
    ),
    "",
    "Próximo passo: revise a fila editorial e aprove ou reprove os itens mais fortes.",
  ].join("\n");
}

function buildContentReviewReply(input: {
  action: "approved" | "rejected";
  item: {
    id: number;
    title: string;
    status: string;
    reviewFeedbackCategory?: string | null;
    reviewFeedbackReason?: string | null;
    lastReviewedAt?: string | null;
  };
}): string {
  if (input.action === "approved") {
    return [
      "Item editorial aprovado.",
      `- #${input.item.id} | ${input.item.title}`,
      `- Novo status: ${input.item.status}`,
      `- Revisado em: ${input.item.lastReviewedAt ?? "agora"}`,
    ].join("\n");
  }

  return [
    "Item editorial reprovado e retirado da fila ativa.",
    `- #${input.item.id} | ${input.item.title}`,
    `- Novo status: ${input.item.status}`,
    `- Categoria: ${input.item.reviewFeedbackCategory ?? "reprovado_manual"}`,
    `- Motivo: ${input.item.reviewFeedbackReason ?? "sem motivo registrado"}`,
    `- Revisado em: ${input.item.lastReviewedAt ?? "agora"}`,
  ].join("\n");
}

function buildContentReviewNotFoundReply(input: {
  requestedId: number;
  channelKey?: string;
  queue: Array<{ id: number; title: string }>;
}): string {
  const lines = [
    `Nao encontrei o item editorial #${input.requestedId}.`,
  ];
  if (input.channelKey) {
    lines.push(`- Canal considerado: ${input.channelKey}`);
  }
  if (input.queue.length > 0) {
    lines.push("- Itens atuais da fila:");
    for (const item of input.queue.slice(0, 5)) {
      lines.push(`  - #${item.id} | ${truncateBriefText(item.title, 64)}`);
    }
    lines.push("- Você também pode usar posição ordinal, por exemplo: `aprove o primeiro item`.");
  }
  return lines.join("\n");
}

function buildContentScriptReply(input: {
  item: {
    id: number;
    title: string;
    hook: string | null;
    callToAction: string | null;
    notes: string | null;
  };
  styleMode: ShortStyleMode;
  mode: string;
  targetDurationSeconds: number;
  headlineOptions: string[];
  script: string;
  description: string;
  scenes: Array<{
    order: number;
    durationSeconds: number;
    narrativeFunction?: string;
    scenePurpose?: string;
    voiceover: string;
    overlay: string;
    visualDirection: string;
    assetProviderHint?: string;
    assetSearchQuery: string;
    assetFallbackQuery?: string;
    retentionDriver?: string;
  }>;
  platformVariants: {
    youtubeShort: {
      title: string;
      caption: string;
      coverText: string;
    };
    tiktok: {
      caption: string;
      coverText: string;
      hook: string;
    };
  };
  sceneAssets: Array<{
    order: number;
    searchQuery: string;
    suggestions: PexelsVideoSuggestion[];
  }>;
  productionPack: ShortProductionPack;
  distributionPlan: DistributionPlan;
  qualityAssessment?: ShortQualityAssessment;
}): string {
  return [
    `Roteiro pronto para o item #${input.item.id}.`,
    `- Título de trabalho: ${input.item.title}`,
    `- Modo: ${input.mode}`,
    `- Tom: ${input.styleMode}`,
    `- Duração alvo: ${input.targetDurationSeconds}s`,
    ...(input.item.hook ? [`- Hook final: ${input.item.hook}`] : []),
    ...(input.item.callToAction ? [`- CTA: ${input.item.callToAction}`] : []),
    ...(input.qualityAssessment ? [`- Quality gate: ${input.qualityAssessment.score}/5 | ${input.qualityAssessment.passed ? "aprovado" : "bloqueado"}`] : []),
    "",
    "Sugestões de título:",
    ...input.headlineOptions.slice(0, 3).map((title) => `- ${title}`),
    "",
    "Roteiro:",
    input.script,
    "",
    "Plano por cena:",
    ...input.scenes.map((scene) =>
      `- Cena ${scene.order} | ${scene.durationSeconds}s | ${scene.narrativeFunction ?? "scene"} | VO: ${scene.voiceover} | overlay: ${scene.overlay} | visual: ${scene.visualDirection}${scene.assetProviderHint ? ` | mídia: ${scene.assetProviderHint}` : ""} | busca: ${scene.assetSearchQuery}${scene.assetFallbackQuery ? ` | fallback: ${scene.assetFallbackQuery}` : ""}${scene.retentionDriver ? ` | retention: ${scene.retentionDriver}` : ""}`,
    ),
    ...(input.qualityAssessment?.reasons?.length
      ? ["", "Quality gate:", ...input.qualityAssessment.reasons.map((reason) => `- ${reason}`)]
      : []),
    "",
    "Assets sugeridos:",
    ...(input.sceneAssets.length > 0
      ? input.sceneAssets.flatMap((scene) => [
          `- Cena ${scene.order} | busca: ${scene.searchQuery}`,
          ...scene.suggestions.slice(0, 2).map((asset) =>
            `  - ${asset.videoUrl ?? asset.pageUrl}${asset.provider ? ` | provider: ${asset.provider}` : ""}${asset.creator ? ` | creator: ${asset.creator}` : ""}${asset.durationSeconds ? ` | ${asset.durationSeconds}s` : ""}`,
          ),
        ])
      : ["- Sem assets resolvidos por API. Use a busca por cena para procurar b-roll manualmente."]),
    "",
    "Production Pack V3:",
    `- Voz: ${input.productionPack.voiceStyle}`,
    `- Ritmo de edição: ${input.productionPack.editRhythm}`,
    `- Legendas: ${input.productionPack.subtitleStyle}`,
    ...input.productionPack.scenes.map((scene) =>
      `- Cena ${scene.order} | legenda: ${scene.subtitleLine}${scene.emphasisWords.length > 0 ? ` | destaques: ${scene.emphasisWords.join(", ")}` : ""} | edição: ${scene.editInstruction}${scene.selectedAsset ? ` | asset principal: ${scene.selectedAsset}` : ""}`,
    ),
    "",
    "Strategy Layer:",
    `- Plataforma principal: ${input.distributionPlan.primaryPlatform}`,
    `- Plataforma secundária: ${input.distributionPlan.secondaryPlatform}`,
    `- Janela sugerida: ${input.distributionPlan.recommendedWindow}`,
    `- Janela secundária: ${input.distributionPlan.secondaryWindow}`,
    `- Hipótese: ${input.distributionPlan.hypothesis}`,
    `- Racional: ${input.distributionPlan.rationale}`,
    "",
    "Variações por plataforma:",
    `- YouTube Shorts | título: ${input.platformVariants.youtubeShort.title} | capa: ${input.platformVariants.youtubeShort.coverText} | caption: ${input.platformVariants.youtubeShort.caption}`,
    `- TikTok | hook: ${input.platformVariants.tiktok.hook} | capa: ${input.platformVariants.tiktok.coverText} | caption: ${input.platformVariants.tiktok.caption}`,
    "",
    "Descrição curta:",
    input.description,
    "",
    "O pacote foi salvo no próprio item editorial.",
  ].join("\n");
}

type ShortScenePlan = {
  order: number;
  durationSeconds: number;
  narrativeFunction?: SceneNarrativeFunction;
  scenePurpose?: string;
  voiceover: string;
  overlay: string;
  overlayHighlightWords?: string[];
  emotionalTrigger?: SceneEmotionalTrigger;
  proofType?: SceneProofType;
  visualDirection: string;
  visualEnvironment?: SceneVisualEnvironment;
  visualAction?: string;
  visualCamera?: SceneVisualCamera;
  visualPacing?: SceneVisualPacing;
  assetProviderHint?: SceneAssetProvider;
  assetSearchQuery: string;
  assetFallbackQuery?: string;
  forbiddenVisuals?: string[];
  retentionDriver?: SceneRetentionDriver;
};

type ShortStyleMode = "operator" | "motivational" | "emotional" | "contrarian";
type SceneAssetProvider = "pexels" | "fal" | "kling";
type SceneNarrativeFunction = "hook" | "pain" | "identification" | "mechanism" | "action" | "payoff";
type SceneEmotionalTrigger = "shock" | "urgency" | "identification" | "curiosity" | "proof" | "relief";
type SceneProofType = "none" | "action" | "interface" | "social_proof" | "money" | "result";
type SceneRetentionDriver =
  | "pattern_interrupt"
  | "pain_identification"
  | "specific_mechanism"
  | "micro_action"
  | "visual_proof"
  | "payoff_contrast";
type SceneVisualEnvironment =
  | "phone_ui"
  | "small_business"
  | "money_desk"
  | "dashboard"
  | "street_business"
  | "abstract_dark"
  | "workspace";
type SceneVisualCamera = "macro" | "screen_capture" | "over_shoulder" | "top_down" | "punch_in";
type SceneVisualPacing = "burst" | "fast" | "steady" | "escalating";

type ShortQualityAssessment = {
  score: number;
  passed: boolean;
  reasons: string[];
};

type ShortProductionPack = {
  voiceStyle: string;
  editRhythm: string;
  subtitleStyle: string;
  scenes: Array<{
    order: number;
    subtitleLine: string;
    emphasisWords: string[];
    editInstruction: string;
    selectedAsset?: string;
  }>;
};

type DistributionPlan = {
  primaryPlatform: string;
  secondaryPlatform: string;
  recommendedWindow: string;
  secondaryWindow: string;
  hypothesis: string;
  rationale: string;
};

type ShortPlatformVariants = {
  youtubeShort: {
    title: string;
    caption: string;
    coverText: string;
  };
  tiktok: {
    caption: string;
    coverText: string;
    hook: string;
  };
};

type ShortFormPackage = {
  styleMode: ShortStyleMode;
  mode: string;
  targetDurationSeconds: number;
  hook: string;
  script: string;
  cta: string;
  description: string;
  titleOptions: string[];
  scenes: ShortScenePlan[];
  platformVariants: ShortPlatformVariants;
  qualityAssessment?: ShortQualityAssessment;
};

function normalizeShortComparableText(value: string): string {
  return normalizeEmailAnalysisText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeShortStyleMode(value: string | undefined, fallback: ShortStyleMode): ShortStyleMode {
  if (value === "operator" || value === "motivational" || value === "emotional" || value === "contrarian") {
    return value;
  }
  return fallback;
}

function inferShortStyleMode(input: {
  title: string;
  pillar?: string | null;
  hook?: string | null;
  formatTemplateKey?: string | null;
  seriesKey?: string | null;
  notes?: string | null;
}): ShortStyleMode {
  const normalized = normalizeEmailAnalysisText([
    input.title,
    input.pillar ?? "",
    input.hook ?? "",
    input.formatTemplateKey ?? "",
    input.seriesKey ?? "",
    input.notes ?? "",
  ].join("\n"));

  if (includesAny(normalized, ["belief_breaker", "mentira", "erro", "mito", "contrarian", "pare de"])) {
    return "contrarian";
  }
  if (includesAny(normalized, ["short_narrative", "historia", "história", "narrativa", "virada", "caso real", "situação", "situacao"])) {
    return "emotional";
  }
  if (includesAny(normalized, ["disciplina", "execucao", "execução", "constancia", "constância", "agir", "rotina", "foco"])) {
    return "motivational";
  }
  return "operator";
}

function buildShortStyleProfile(styleMode: ShortStyleMode): {
  voiceStyle: string;
  editRhythm: string;
  subtitleStyle: string;
  youtubeCoverText: string;
  tiktokCoverText: string;
} {
  switch (styleMode) {
    case "motivational":
      return {
        voiceStyle: "voz firme, energética e disciplinada, com cadência de execução e sem soar coach",
        editRhythm: "hook rápido; cortes secos e crescentes; motion text forte; terminar com energia de ação imediata",
        subtitleStyle: "topo = tese curta; base = ação prática; blocos curtos, verbos fortes e contraste alto",
        youtubeCoverText: "EXECUTE ISSO HOJE",
        tiktokCoverText: "PARE DE ADIAR",
      };
    case "emotional":
      return {
        voiceStyle: "voz próxima, intensa e controlada, com peso emocional sem dramatizar demais",
        editRhythm: "abrir com tensão; segurar a virada por alguns frames; alternar respiro curto com punchline visual",
        subtitleStyle: "topo = dor ou virada; base = frase falada curta; palavras de impacto emocional em destaque",
        youtubeCoverText: "ESSA VIRADA IMPORTA",
        tiktokCoverText: "SE IDENTIFICOU?",
      };
    case "contrarian":
      return {
        voiceStyle: "voz cortante, confiante e direta, com ênfase nas palavras de ruptura e sem hype vazio",
        editRhythm: "primeiros 2 segundos muito fortes; cortes rápidos; texto de confronto; fechamento seco para comentário",
        subtitleStyle: "topo = quebra de crença; base = prova curta; poucas palavras, contraste alto e punchline visível",
        youtubeCoverText: "ERRO QUE CUSTA CARO",
        tiktokCoverText: "PARE DE PERDER DINHEIRO NISSO",
      };
    case "operator":
    default:
      return {
        voiceStyle: "voz segura, objetiva e pragmática, com ritmo de operador de growth e sem hype",
        editRhythm: "hook rápido; cortes secos a cada 2-3s; reforço visual de mecanismo; fechamento limpo para comentário",
        subtitleStyle: "topo = mecanismo; base = fala objetiva; 3-6 palavras por bloco destacando número, ação e métrica",
        youtubeCoverText: "MECANISMO QUE FUNCIONA",
        tiktokCoverText: "ENTENDA O MECANISMO",
      };
  }
}

function buildSceneCtaSubtitle(styleMode: ShortStyleMode): string {
  switch (styleMode) {
    case "motivational":
      return "Conta aqui embaixo.";
    case "emotional":
      return "Me diz isso nos comentários.";
    case "contrarian":
      return "Comenta aqui embaixo.";
    case "operator":
    default:
      return "Deixe isso nos comentários.";
  }
}

function buildSceneSubtitleLine(scene: ShortScenePlan, styleMode: ShortStyleMode): string {
  const overlayComparable = normalizeShortComparableText(scene.overlay);
  const voiceover = scene.voiceover.trim();
  const clauses = voiceover
    .split(/(?<=[.!?])\s+|\s+[–—-]\s+|;\s+|:\s+|,\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const comparable = normalizeShortComparableText(clause);
    if (!comparable) {
      continue;
    }
    if (!overlayComparable || (comparable !== overlayComparable && !comparable.includes(overlayComparable) && !overlayComparable.includes(comparable))) {
      return truncateBriefText(clause.replace(/\s+/g, " "), 72);
    }
  }

  if (normalizeShortComparableText(voiceover).includes("comente")) {
    return buildSceneCtaSubtitle(styleMode);
  }

  return truncateBriefText(voiceover.replace(/\s+/g, " "), 72);
}

function extractEmphasisWords(text: string): string[] {
  return [...new Set(
    text
      .split(/[^a-zA-ZÀ-ÿ0-9]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 4)
      .slice(0, 3),
  )];
}

function buildSceneEditInstruction(scene: ShortScenePlan, styleMode: ShortStyleMode): string {
  const accent = styleMode === "motivational"
    ? "Aumente a energia a cada troca de plano."
    : styleMode === "emotional"
      ? "Segure alguns frames extras no momento de virada."
      : styleMode === "contrarian"
        ? "Bata o contraste visual junto da punchline."
        : "Priorize clareza visual e número na tela.";
  const pacingInstruction = scene.visualPacing === "burst"
    ? "Cortes agressivos em 1-2 segundos."
    : scene.visualPacing === "escalating"
      ? "Aumente a intensidade visual até o payoff."
      : scene.visualPacing === "fast"
        ? "Mantenha troca visual rápida e sem respiro morto."
        : "Mantenha leitura limpa e movimento constante.";
  const narrativeInstruction = scene.narrativeFunction === "hook"
    ? "Abra com pattern interrupt imediato."
    : scene.narrativeFunction === "pain"
      ? "Mostre a dor concreta, não conceito abstrato."
      : scene.narrativeFunction === "identification"
        ? "Faça o espectador se ver na cena."
        : scene.narrativeFunction === "mechanism"
          ? "Explique o mecanismo com UI, números ou prova."
          : scene.narrativeFunction === "action"
            ? "Mostre a execução acontecendo."
            : "Feche com payoff ou prova tangível.";
  if (scene.durationSeconds <= 4) {
    return `1 corte rápido + zoom leve no texto; segure 2 a 3 frames no punchline. ${narrativeInstruction} ${pacingInstruction} ${accent}`;
  }
  if (scene.durationSeconds <= 8) {
    return `2 cortes secos; trocar plano no meio da frase e manter texto na zona segura vertical. ${narrativeInstruction} ${pacingInstruction} ${accent}`;
  }
  return `3 blocos visuais: abertura, reforço e fechamento; manter cortes a cada 2 a 3 segundos. ${narrativeInstruction} ${pacingInstruction} ${accent}`;
}

function inferDistributionHypothesis(item: {
  formatTemplateKey?: string | null;
  pillar?: string | null;
  hook?: string | null;
}): string {
  const normalized = normalizeEmailAnalysisText(`${item.formatTemplateKey ?? ""}\n${item.pillar ?? ""}\n${item.hook ?? ""}`);
  if (normalized.includes("belief_breaker") || normalized.includes("mentira") || normalized.includes("erro")) {
    return "Gancho contrarian deve elevar comentário e retenção nos 3 primeiros segundos.";
  }
  if (normalized.includes("short_narrative") || normalized.includes("historia") || normalized.includes("história")) {
    return "Narrativa curta deve elevar retenção média e replay.";
  }
  return "Mecanismo prático + promessa objetiva deve puxar saves e comentários.";
}

function buildDistributionPlan(input: {
  item: {
    platform: string;
    formatTemplateKey?: string | null;
    pillar?: string | null;
    hook?: string | null;
  };
  channelKey?: string | null;
  orderOffset?: number;
}): DistributionPlan {
  const isTikTokPrimary = input.channelKey?.includes("tiktok") || input.item.platform === "tiktok";
  const primaryWindows = isTikTokPrimary ? ["07:00 BRT", "12:00 BRT", "20:00 BRT"] : ["07:00 BRT", "12:00 BRT", "20:00 BRT"];
  const secondaryWindows = isTikTokPrimary ? ["12:00 BRT", "20:00 BRT", "07:00 BRT"] : ["12:00 BRT", "20:00 BRT", "07:00 BRT"];
  const index = Math.max(0, input.orderOffset ?? 0) % primaryWindows.length;
  return {
    primaryPlatform: isTikTokPrimary ? "TikTok" : "YouTube Shorts",
    secondaryPlatform: isTikTokPrimary ? "YouTube Shorts" : "TikTok",
    recommendedWindow: primaryWindows[index]!,
    secondaryWindow: secondaryWindows[index]!,
    hypothesis: inferDistributionHypothesis(input.item),
    rationale: isTikTokPrimary
      ? "TikTok tende a responder melhor a janela almoço/noite; usar YouTube como segunda distribuição com adaptação leve."
      : "YouTube Shorts tende a performar melhor em rotina manhã/almoço/noite; TikTok entra como redistribuição do mesmo núcleo.",
  };
}

function buildShortProductionPack(
  styleMode: ShortStyleMode,
  scenes: ShortScenePlan[],
  sceneAssets: Array<{
    order: number;
    searchQuery: string;
    suggestions: PexelsVideoSuggestion[];
  }>,
): ShortProductionPack {
  const styleProfile = buildShortStyleProfile(styleMode);
  const usedAssets = new Set<string>();
  return {
    voiceStyle: styleProfile.voiceStyle,
    editRhythm: styleProfile.editRhythm,
    subtitleStyle: styleProfile.subtitleStyle,
    scenes: scenes.map((scene) => {
      const selectedAssetEntry = sceneAssets.find((entry) => entry.order === scene.order);
      const selectedAsset = selectedAssetEntry?.suggestions
        .map((asset) => asset.videoUrl)
        .find((asset): asset is string => typeof asset === "string" && asset.trim().length > 0 && !usedAssets.has(asset))
        ?? selectedAssetEntry?.suggestions[0]?.videoUrl;
      if (selectedAsset) {
        usedAssets.add(selectedAsset);
      }
      return {
        order: scene.order,
        subtitleLine: buildSceneSubtitleLine(scene, styleMode),
        emphasisWords: extractEmphasisWords(`${scene.overlay} ${scene.voiceover}`),
        editInstruction: buildSceneEditInstruction(scene, styleMode),
        selectedAsset,
      };
    }),
  };
}

function hasSavedShortPackage(notes: string | null | undefined): boolean {
  if (!notes) {
    return false;
  }
  return /SHORT_PACKAGE_V[23]/.test(notes);
}

function buildContentBatchReply(input: {
  channelKey: string;
  items: Array<{
    id: number;
    title: string;
    status: string;
    queuePriority: number | null;
    ideaScore: number | null;
    hasScriptPackage: boolean;
    recommendedWindow: string;
    hypothesis: string;
  }>;
}): string {
  if (input.items.length === 0) {
    return `Nao encontrei itens suficientes para montar um lote no canal ${input.channelKey}.`;
  }

  return [
    `Lote inicial montado: ${input.items.length} vídeos.`,
    `- Canal: ${input.channelKey}`,
    "- Estratégia: publicar 1 vídeo por vez, priorizando clareza de hipótese e constância diária.",
    ...input.items.map((item, index) =>
      `- Ordem ${index + 1} | #${item.id} | ${item.title} | status: ${item.status} | score: ${item.ideaScore ?? item.queuePriority ?? "-"} | janela: ${item.recommendedWindow} | pacote: ${item.hasScriptPackage ? "pronto" : "pendente"} | hipótese: ${truncateBriefText(item.hypothesis, 96)}`,
    ),
    "",
    "Próximo passo: gere ou revise o roteiro do primeiro item e publique um por vez.",
  ].join("\n");
}

function buildContentDistributionStrategyReply(input: {
  channelKey: string;
  items: Array<{
    id: number;
    title: string;
    recommendedWindow: string;
    secondaryWindow: string;
    hypothesis: string;
    rationale: string;
  }>;
}): string {
  if (input.items.length === 0) {
    return `Nao encontrei itens para sugerir distribuição no canal ${input.channelKey}.`;
  }

  return [
    `Estratégia de distribuição para ${input.channelKey}.`,
    ...input.items.map((item, index) =>
      `- Ordem ${index + 1} | #${item.id} | ${item.title} | janela principal: ${item.recommendedWindow} | janela secundária: ${item.secondaryWindow} | hipótese: ${truncateBriefText(item.hypothesis, 92)} | racional: ${truncateBriefText(item.rationale, 96)}`,
    ),
  ].join("\n");
}

function buildContentBatchGenerationReply(input: {
  channelKey: string;
  generated: Array<{
    id: number;
    title: string;
    status: string;
    recommendedWindow: string;
    hasAssets: boolean;
  }>;
}): string {
  if (input.generated.length === 0) {
    return `Nao encontrei itens elegíveis para gerar o lote completo no canal ${input.channelKey}.`;
  }

  return [
    `Lote completo gerado: ${input.generated.length} vídeos.`,
    `- Canal: ${input.channelKey}`,
    ...input.generated.map((item, index) =>
      `- Ordem ${index + 1} | #${item.id} | ${item.title} | status: ${item.status} | janela: ${item.recommendedWindow} | assets: ${item.hasAssets ? "ok" : "pendente"}`,
    ),
    "",
    "Próximo passo: revise o item #1 do lote e publique um vídeo por vez.",
  ].join("\n");
}

const FORBIDDEN_SHORT_PROMISES = [
  "link da descricao",
  "link na descrição",
  "link na bio",
  "checklist na descricao",
  "checklist na descrição",
  "baixe o checklist",
  "baixe o material",
  "confira o checklist",
];

const GLOBAL_VISUAL_BLACKLIST = [
  "business meeting",
  "corporate office",
  "whiteboard",
  "presentation",
  "team discussion",
  "generic laptop typing",
  "people pointing screen",
  "stock office smiling",
];

const FORBIDDEN_FACELESS_VISUAL_TERMS = [
  "apresentador",
  "rosto",
  "close-up",
  "selfie",
  "camera talking head",
  "talking head",
  "host speaking",
  "corporate office",
  "business meeting",
  "team discussion",
  "stock office smiling",
  "presentation",
  "whiteboard",
];

const FORBIDDEN_FACELESS_ASSET_TERMS = [
  "presenter",
  "speaker",
  "selfie",
  "face",
  "facial",
  "portrait",
  "host",
  "influencer",
  "webcam",
  "talking head",
  "person talking",
  "close-up",
  "business meeting",
  "corporate office",
  "team discussion",
  "presentation",
  "generic laptop typing",
  "people pointing screen",
  "stock office smiling",
  "whiteboard",
];

function clampShortTargetDuration(value: number | undefined, fallback = 30): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(22, Math.min(32, Math.round(value)));
}

function clampSceneDuration(value: number | undefined, fallback = 8): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(2, Math.min(14, Math.round(value)));
}

function normalizeScenePlan(scenes: ShortScenePlan[] | undefined, fallbackScenes: ShortScenePlan[]): ShortScenePlan[] {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return fallbackScenes;
  }

  return scenes
    .filter((scene) =>
      scene
      && typeof scene.voiceover === "string"
      && scene.voiceover.trim().length > 0
      && typeof scene.overlay === "string"
      && scene.overlay.trim().length > 0
      && typeof scene.visualDirection === "string"
      && scene.visualDirection.trim().length > 0
      && typeof scene.assetSearchQuery === "string"
      && scene.assetSearchQuery.trim().length > 0,
    )
    .slice(0, 8)
    .map((scene, index) => ({
      order: index + 1,
      durationSeconds: clampSceneDuration(scene.durationSeconds, 8),
      narrativeFunction: scene.narrativeFunction,
      scenePurpose: typeof scene.scenePurpose === "string" ? scene.scenePurpose.trim() : undefined,
      voiceover: scene.voiceover.trim(),
      overlay: scene.overlay.trim(),
      overlayHighlightWords: Array.isArray(scene.overlayHighlightWords)
        ? scene.overlayHighlightWords.map((value) => value.trim()).filter(Boolean).slice(0, 3)
        : undefined,
      emotionalTrigger: scene.emotionalTrigger,
      proofType: scene.proofType,
      visualDirection: scene.visualDirection.trim(),
      visualEnvironment: scene.visualEnvironment,
      visualAction: typeof scene.visualAction === "string" ? scene.visualAction.trim() : undefined,
      visualCamera: scene.visualCamera,
      visualPacing: scene.visualPacing,
      assetSearchQuery: scene.assetSearchQuery.trim(),
      assetFallbackQuery: typeof scene.assetFallbackQuery === "string" ? scene.assetFallbackQuery.trim() : undefined,
      forbiddenVisuals: Array.isArray(scene.forbiddenVisuals)
        ? scene.forbiddenVisuals.map((value) => value.trim()).filter(Boolean)
        : undefined,
      retentionDriver: scene.retentionDriver,
    }));
}

function sumSceneDurations(scenes: ShortScenePlan[]): number {
  return scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
}

function rebalanceSceneDurations(scenes: ShortScenePlan[], targetDurationSeconds: number): ShortScenePlan[] {
  if (scenes.length === 0) {
    return scenes;
  }

  const currentTotal = sumSceneDurations(scenes);
  if (currentTotal === targetDurationSeconds) {
    return scenes;
  }

  const ratio = targetDurationSeconds / Math.max(currentTotal, 1);
  const adjusted = scenes.map((scene) => ({
    ...scene,
    durationSeconds: clampSceneDuration(Math.round(scene.durationSeconds * ratio), scene.durationSeconds),
  }));

  let diff = targetDurationSeconds - sumSceneDurations(adjusted);
  let cursor = 0;
  while (diff !== 0 && cursor < 100) {
    const index = cursor % adjusted.length;
    const scene = adjusted[index]!;
    if (diff > 0 && scene.durationSeconds < 14) {
      scene.durationSeconds += 1;
      diff -= 1;
    } else if (diff < 0 && scene.durationSeconds > 4) {
      scene.durationSeconds -= 1;
      diff += 1;
    }
    cursor += 1;
  }

  return adjusted.map((scene, index) => ({
    ...scene,
    order: index + 1,
  }));
}

function stripForbiddenShortPromises(text: string): string {
  let next = text;
  for (const token of FORBIDDEN_SHORT_PROMISES) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(escaped, "gi"), "comentários");
  }
  return next
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function normalizeFacelessVisualDirection(text: string | undefined, fallback: string): string {
  const base = normalizeShortLine(text, fallback);
  const normalized = normalizeEmailAnalysisText(base);
  if (includesAny(normalized, FORBIDDEN_FACELESS_VISUAL_TERMS)) {
    return fallback;
  }
  return base;
}

function normalizeShortLine(text: string | undefined, fallback: string): string {
  if (typeof text !== "string" || text.trim().length === 0) {
    return fallback;
  }
  return stripForbiddenShortPromises(text.trim());
}

function compressOverlayText(text: string | undefined, fallback: string): string {
  const base = normalizeShortLine(text, fallback)
    .replace(/[.!?]+/g, " ")
    .replace(/[–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(/\s+/).filter(Boolean);
  const compact = words.length > 4 ? words.slice(0, 4).join(" ") : base;
  return truncateBriefText(compact.toUpperCase(), 48);
}

function deriveScriptFromScenes(scenes: ShortScenePlan[]): string {
  return scenes.map((scene) => scene.voiceover.trim()).filter(Boolean).join(" ");
}

function normalizeAssetSearchQuery(value: string | undefined, fallback: string): string {
  const normalized = normalizeShortLine(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }

  const containsForbidden = FORBIDDEN_FACELESS_ASSET_TERMS.some((token) => normalized.includes(token));
  if (containsForbidden) {
    return fallback;
  }

  return normalized;
}

type ShortAssetSemanticProfile = "finance" | "saas" | "sales" | "execution" | "business";

function inferAssetSemanticProfile(context: {
  title: string;
  pillar?: string | null;
  hook?: string | null;
  formatTemplateKey?: string | null;
  seriesKey?: string | null;
  notes?: string | null;
  sceneVoiceover?: string;
  sceneOverlay?: string;
  styleMode: ShortStyleMode;
}): ShortAssetSemanticProfile {
  const normalized = normalizeEmailAnalysisText([
    context.title,
    context.pillar ?? "",
    context.hook ?? "",
    context.formatTemplateKey ?? "",
    context.seriesKey ?? "",
    context.notes ?? "",
    context.sceneVoiceover ?? "",
    context.sceneOverlay ?? "",
    context.styleMode,
  ].join("\n"));

  if (includesAny(normalized, [
    "investir",
    "investimento",
    "etf",
    "aporte",
    "dividendo",
    "dividend",
    "juros",
    "patrimonio",
    "patrimônio",
    "poupanca",
    "poupança",
    "rebalance",
    "financial",
    "finance",
    "bank",
    "banking",
  ])) {
    return "finance";
  }
  if (includesAny(normalized, [
    "saas",
    "assinatura",
    "subscription",
    "pricing",
    "churn",
    "ltv",
    "cac",
    "cohort",
    "mrr",
    "arpa",
    "activation",
    "onboarding",
    "usuario ativo",
    "usuário ativo",
  ])) {
    return "saas";
  }
  if (includesAny(normalized, [
    "conversao",
    "conversão",
    "pagina de vendas",
    "página de vendas",
    "sales",
    "lead",
    "cliente",
    "oferta",
    "checkout",
    "funnel",
  ])) {
    return "sales";
  }
  if (includesAny(normalized, ["disciplina", "execucao", "execução", "constancia", "constância", "agir", "automatizar", "rotina"])) {
    return "execution";
  }
  return "business";
}

function refineAssetSearchQuery(
  value: string | undefined,
  fallback: string,
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
    sceneVoiceover?: string;
    sceneOverlay?: string;
    styleMode: ShortStyleMode;
  },
): string {
  let next = normalizeAssetSearchQuery(value, fallback);
  const profile = inferAssetSemanticProfile(context);

  if (/(comment|comments)/.test(next)) {
    return "mobile app comments interface vertical";
  }
  if (/(onboarding)/.test(next)) {
    return profile === "saas" ? "saas onboarding ui vertical" : "product onboarding ui vertical";
  }
  if (/(pricing|subscription|table ui|pricing table|offer comparison)/.test(next)) {
    if (profile === "saas") {
      return "saas pricing page vertical";
    }
    if (profile === "sales") {
      return "offer pricing comparison vertical";
    }
    return "software pricing page vertical";
  }
  if (/(whiteboard)/.test(next)) {
    if (profile === "finance") {
      return "financial planning desk vertical";
    }
    if (profile === "sales") {
      return "sales planning desk vertical";
    }
    return "business planning desk vertical";
  }
  if (/(smartphone|mobile app|app ui|hands smartphone|banking app|investment app)/.test(next)) {
    if (profile === "finance") {
      return "investment app ui vertical";
    }
    if (profile === "saas") {
      return "saas mobile app ui vertical";
    }
    if (profile === "sales") {
      return "crm mobile app ui vertical";
    }
    return "mobile app interface vertical";
  }
  if (/(dashboard|metrics|analytics|laptop)/.test(next)) {
    if (profile === "finance") {
      return next.includes("blurred") ? "finance analytics dashboard blurred vertical" : "finance analytics dashboard vertical";
    }
    if (profile === "saas") {
      return "saas analytics dashboard vertical";
    }
    if (profile === "sales") {
      return "sales analytics dashboard vertical";
    }
    return "startup analytics dashboard vertical";
  }

  if (profile === "finance") {
    return "investment workspace laptop vertical";
  }
  if (profile === "saas") {
    return "saas workspace laptop vertical";
  }
  if (profile === "sales") {
    return "sales dashboard laptop vertical";
  }
  if (profile === "execution") {
    return "hands typing laptop vertical";
  }
  return next;
}

function inferSceneNarrativeFunction(index: number, totalScenes: number, voiceover: string): SceneNarrativeFunction {
  const normalized = normalizeEmailAnalysisText(voiceover);
  if (index === 0) {
    return "hook";
  }
  if (index === totalScenes - 1) {
    return includesAny(normalized, ["comente", "agora", "hoje", "comece", "faca", "faça"]) ? "action" : "payoff";
  }
  if (includesAny(normalized, ["nao precisa", "não precisa", "voce tambem", "você também", "igual", "mesmo sem", "sem investimento"])) {
    return "identification";
  }
  if (includesAny(normalized, ["passo", "escolhe", "oferece", "posta", "responde", "organiza", "automatiza", "teste", "mede"])) {
    return "action";
  }
  if (includesAny(normalized, ["resultado", "vira", "ganha", "pagamento", "notificacao", "notificação", "cheio", "lucro"])) {
    return "payoff";
  }
  if (includesAny(normalized, ["erro", "parado", "caro", "perde", "dor", "problema", "nao sabem", "não sabem"])) {
    return index <= 1 ? "pain" : "identification";
  }
  return index <= Math.floor(totalScenes / 2) ? "mechanism" : "action";
}

function inferSceneEmotionalTrigger(fn: SceneNarrativeFunction): SceneEmotionalTrigger {
  switch (fn) {
    case "hook":
      return "shock";
    case "pain":
      return "urgency";
    case "identification":
      return "identification";
    case "mechanism":
      return "curiosity";
    case "action":
      return "proof";
    case "payoff":
    default:
      return "relief";
  }
}

function inferSceneProofType(fn: SceneNarrativeFunction, profile: ShortAssetSemanticProfile): SceneProofType {
  if (fn === "action") {
    return "action";
  }
  if (fn === "payoff") {
    return profile === "finance" ? "money" : "result";
  }
  if (fn === "mechanism") {
    return "interface";
  }
  if (fn === "identification" || fn === "pain") {
    return "social_proof";
  }
  return "none";
}

function inferSceneRetentionDriver(fn: SceneNarrativeFunction): SceneRetentionDriver {
  switch (fn) {
    case "hook":
      return "pattern_interrupt";
    case "pain":
      return "pain_identification";
    case "identification":
      return "pain_identification";
    case "mechanism":
      return "specific_mechanism";
    case "action":
      return "micro_action";
    case "payoff":
    default:
      return "payoff_contrast";
  }
}

function inferSceneAssetProvider(
  fn: SceneNarrativeFunction,
  proofType: SceneProofType,
): SceneAssetProvider {
  if ((fn === "hook" || fn === "payoff") && proofType !== "interface") {
    return "fal";
  }
  return "pexels";
}

function buildOverlayHighlightWords(overlay: string, voiceover: string): string[] {
  const preferred = extractEmphasisWords(`${overlay} ${voiceover}`);
  return preferred.slice(0, 3);
}

function normalizeForbiddenVisuals(values: string[] | undefined): string[] {
  return [...new Set([...(values ?? []), ...GLOBAL_VISUAL_BLACKLIST])]
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function inferSceneQueryPreset(input: {
  fn: SceneNarrativeFunction;
  profile: ShortAssetSemanticProfile;
}): {
  primaryQuery: string;
  fallbackQuery: string;
  visualEnvironment: SceneVisualEnvironment;
  visualAction: string;
  visualCamera: SceneVisualCamera;
  visualPacing: SceneVisualPacing;
} {
  const finance = {
    hook: { primaryQuery: "bank transfer success screen", fallbackQuery: "payment notification phone", visualEnvironment: "phone_ui", visualAction: "mostrar prova financeira imediata em tela", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "grocery expensive price tag", fallbackQuery: "wallet empty close", visualEnvironment: "money_desk", visualAction: "mostrar custo real e aperto no bolso", visualCamera: "macro", visualPacing: "fast" },
    identification: { primaryQuery: "bills table stressed", fallbackQuery: "cash counting hands", visualEnvironment: "money_desk", visualAction: "mostrar rotina de contas e pressão financeira", visualCamera: "top_down", visualPacing: "steady" },
    mechanism: { primaryQuery: "finance analytics dashboard vertical", fallbackQuery: "investment app ui vertical", visualEnvironment: "dashboard", visualAction: "explicar o mecanismo via interface e números", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "mobile banking app ui", fallbackQuery: "typing message phone close", visualEnvironment: "phone_ui", visualAction: "mostrar execução concreta no celular", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "cash counting hands", fallbackQuery: "bank transfer success screen", visualEnvironment: "money_desk", visualAction: "mostrar resultado tangível e específico", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const saas = {
    hook: { primaryQuery: "saas analytics dashboard vertical", fallbackQuery: "pricing page software vertical", visualEnvironment: "dashboard", visualAction: "abrir com gráfico, alerta ou queda visível", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "pricing page software vertical", fallbackQuery: "customer support inbox vertical", visualEnvironment: "dashboard", visualAction: "mostrar erro caro em tela de produto", visualCamera: "screen_capture", visualPacing: "fast" },
    identification: { primaryQuery: "customer support inbox vertical", fallbackQuery: "saas onboarding ui vertical", visualEnvironment: "workspace", visualAction: "mostrar fricção real de operação ou cliente", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "saas analytics dashboard vertical", fallbackQuery: "saas onboarding ui vertical", visualEnvironment: "dashboard", visualAction: "explicar mecanismo por métrica ou fluxo", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "saas onboarding ui vertical", fallbackQuery: "typing message phone close", visualEnvironment: "phone_ui", visualAction: "mostrar ajuste concreto, setup ou teste", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "multiple notifications phone", fallbackQuery: "calendar full schedule", visualEnvironment: "phone_ui", visualAction: "mostrar tração, conversão ou demanda entrando", visualCamera: "punch_in", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const sales = {
    hook: { primaryQuery: "payment notification phone", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar dinheiro ou lead entrando logo no início", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "grocery expensive price tag", fallbackQuery: "small business storefront vertical", visualEnvironment: "street_business", visualAction: "mostrar o custo de ficar parado ou vendendo mal", visualCamera: "macro", visualPacing: "fast" },
    identification: { primaryQuery: "small business storefront vertical", fallbackQuery: "instagram profile small business", visualEnvironment: "small_business", visualAction: "mostrar a realidade de negócio pequeno e demanda desorganizada", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "instagram profile small business", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar o mecanismo de venda ou aquisição", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "typing message phone close", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar mensagem, oferta ou follow-up sendo feito", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "payment notification phone", fallbackQuery: "client message confirmed", visualEnvironment: "phone_ui", visualAction: "mostrar confirmação de cliente ou pagamento", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const execution = {
    hook: { primaryQuery: "typing message phone close", fallbackQuery: "multiple notifications phone", visualEnvironment: "phone_ui", visualAction: "abrir com ação visível em vez de pose", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "calendar full schedule", fallbackQuery: "small business storefront vertical", visualEnvironment: "workspace", visualAction: "mostrar atraso, bagunça ou oportunidade passando", visualCamera: "top_down", visualPacing: "fast" },
    identification: { primaryQuery: "hands smartphone app", fallbackQuery: "small business storefront vertical", visualEnvironment: "workspace", visualAction: "mostrar alguém comum operando pelo celular", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "instagram business phone vertical", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar o passo a passo em UI", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "typing message phone close", fallbackQuery: "whatsapp chat business", visualEnvironment: "phone_ui", visualAction: "mostrar execução concreta e simples", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "client message confirmed", fallbackQuery: "multiple notifications phone", visualEnvironment: "phone_ui", visualAction: "mostrar sinal concreto de resultado", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const business = {
    hook: { primaryQuery: "startup analytics dashboard vertical", fallbackQuery: "payment notification phone", visualEnvironment: "dashboard", visualAction: "abrir com prova ou contraste imediato", visualCamera: "punch_in", visualPacing: "burst" },
    pain: { primaryQuery: "wallet empty close", fallbackQuery: "small business storefront vertical", visualEnvironment: "workspace", visualAction: "mostrar dor concreta em vez de escritório genérico", visualCamera: "macro", visualPacing: "fast" },
    identification: { primaryQuery: "small business storefront vertical", fallbackQuery: "hands smartphone app", visualEnvironment: "small_business", visualAction: "mostrar contexto de vida real e execução", visualCamera: "over_shoulder", visualPacing: "steady" },
    mechanism: { primaryQuery: "startup analytics dashboard vertical", fallbackQuery: "mobile app interface vertical", visualEnvironment: "dashboard", visualAction: "mostrar mecanismo em interface real", visualCamera: "screen_capture", visualPacing: "steady" },
    action: { primaryQuery: "typing message phone close", fallbackQuery: "instagram business phone vertical", visualEnvironment: "phone_ui", visualAction: "mostrar o passo que gera movimento", visualCamera: "over_shoulder", visualPacing: "fast" },
    payoff: { primaryQuery: "payment notification phone", fallbackQuery: "calendar full schedule", visualEnvironment: "phone_ui", visualAction: "mostrar consequência positiva e específica", visualCamera: "macro", visualPacing: "escalating" },
  } satisfies Record<SceneNarrativeFunction, {
    primaryQuery: string;
    fallbackQuery: string;
    visualEnvironment: SceneVisualEnvironment;
    visualAction: string;
    visualCamera: SceneVisualCamera;
    visualPacing: SceneVisualPacing;
  }>;

  const library = input.profile === "finance"
    ? finance
    : input.profile === "saas"
      ? saas
      : input.profile === "sales"
        ? sales
        : input.profile === "execution"
          ? execution
          : business;

  return library[input.fn];
}

function enrichShortScenePlanV2(
  scene: ShortScenePlan,
  index: number,
  allScenes: ShortScenePlan[],
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
    styleMode: ShortStyleMode;
  },
): ShortScenePlan {
  const fn = scene.narrativeFunction ?? inferSceneNarrativeFunction(index, allScenes.length, scene.voiceover);
  const profile = inferAssetSemanticProfile({
    ...context,
    sceneVoiceover: scene.voiceover,
    sceneOverlay: scene.overlay,
  });
  const preset = inferSceneQueryPreset({ fn, profile });
  const primaryQuery = refineAssetSearchQuery(scene.assetSearchQuery || preset.primaryQuery, preset.primaryQuery, {
    ...context,
    sceneVoiceover: scene.voiceover,
    sceneOverlay: scene.overlay,
  });
  const fallbackQuery = refineAssetSearchQuery(scene.assetFallbackQuery || preset.fallbackQuery, preset.fallbackQuery, {
    ...context,
    sceneVoiceover: scene.voiceover,
    sceneOverlay: scene.overlay,
  });

  return {
    ...scene,
    narrativeFunction: fn,
    scenePurpose: scene.scenePurpose || preset.visualAction,
    emotionalTrigger: scene.emotionalTrigger ?? inferSceneEmotionalTrigger(fn),
    proofType: scene.proofType ?? inferSceneProofType(fn, profile),
    overlay: compressOverlayText(scene.overlay, fn === "hook" ? "COMECE HOJE" : fn === "pain" ? "ERRO CARO" : fn === "action" ? "FAÇA ISSO" : "RESULTADO REAL"),
    overlayHighlightWords: buildOverlayHighlightWords(scene.overlay, scene.voiceover),
    visualEnvironment: scene.visualEnvironment ?? preset.visualEnvironment,
    visualAction: scene.visualAction ?? preset.visualAction,
    visualCamera: scene.visualCamera ?? preset.visualCamera,
    visualPacing: scene.visualPacing ?? preset.visualPacing,
    visualDirection: normalizeFacelessVisualDirection(
      scene.visualDirection,
      `${preset.visualAction}; ambiente ${preset.visualEnvironment}; câmera ${preset.visualCamera}; pacing ${preset.visualPacing}`,
    ),
    assetProviderHint: scene.assetProviderHint ?? inferSceneAssetProvider(
      fn,
      scene.proofType ?? inferSceneProofType(fn, profile),
    ),
    assetSearchQuery: primaryQuery,
    assetFallbackQuery: fallbackQuery,
    forbiddenVisuals: normalizeForbiddenVisuals(scene.forbiddenVisuals),
    retentionDriver: scene.retentionDriver ?? inferSceneRetentionDriver(fn),
  };
}

function assessShortQualityV2(payload: ShortFormPackage): ShortQualityAssessment {
  let score = 0;
  const reasons: string[] = [];
  const scenes = payload.scenes;
  const normalizedHook = normalizeEmailAnalysisText(payload.hook);
  const hasStrongHook = normalizedHook.length >= 16 && includesAny(normalizedHook, [
    "erro",
    "mentira",
    "pare",
    "hoje",
    "agora",
    "ninguem",
    "ninguem",
    "sem",
    "ganhando",
    "dinheiro",
    "comecar",
    "comecar",
    "começar",
  ]);
  if (hasStrongHook) {
    score += 1;
    reasons.push("hook com tensão imediata");
  }

  const nonGenericScenes = scenes.filter((scene) => {
    const query = normalizeEmailAnalysisText(`${scene.assetSearchQuery} ${scene.assetFallbackQuery ?? ""}`);
    return !includesAny(query, FORBIDDEN_FACELESS_ASSET_TERMS) && !includesAny(query, GLOBAL_VISUAL_BLACKLIST);
  });
  if (nonGenericScenes.length >= Math.max(3, Math.ceil(scenes.length * 0.7))) {
    score += 1;
    reasons.push("cenas com busca visual específica");
  }

  const hasProof = scenes.some((scene) => scene.proofType && scene.proofType !== "none");
  if (hasProof) {
    score += 1;
    reasons.push("prova visual presente");
  }

  const hasAction = scenes.some((scene) => scene.narrativeFunction === "action" || includesAny(normalizeEmailAnalysisText(scene.voiceover), ["passo", "faca", "faça", "comece", "manda", "poste", "responde", "oferece", "automatiza"]));
  if (hasAction) {
    score += 1;
    reasons.push("ação clara para o espectador");
  }

  const hasContrast = payload.styleMode === "contrarian" || scenes.some((scene) => scene.narrativeFunction === "pain" || scene.narrativeFunction === "payoff");
  if (hasContrast) {
    score += 1;
    reasons.push("contraste narrativo entre dor e payoff");
  }

  if (score < 4) {
    reasons.push("abaixo do gate mínimo de retenção");
  }

  return {
    score,
    passed: score >= 4,
    reasons,
  };
}

function applyAtlasV2SceneEngine(
  payload: ShortFormPackage,
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  },
): ShortFormPackage {
  const enrichedScenes = payload.scenes.map((scene, index, allScenes) =>
    enrichShortScenePlanV2(scene, index, allScenes, {
      ...context,
      styleMode: payload.styleMode,
    }),
  );
  const qualityAssessment = assessShortQualityV2({
    ...payload,
    scenes: enrichedScenes,
  });

  return {
    ...payload,
    scenes: enrichedScenes,
    qualityAssessment,
  };
}

async function resolveSceneAssets(
  pexelsMedia: PexelsMediaService,
  scenes: ShortScenePlan[],
  maxScenes: number,
): Promise<Array<{
  order: number;
  searchQuery: string;
  suggestions: PexelsVideoSuggestion[];
}>> {
  if (!pexelsMedia.isEnabled()) {
    return [];
  }

  const results: Array<{
    order: number;
    searchQuery: string;
    suggestions: PexelsVideoSuggestion[];
  }> = [];

  const sceneLimit = Math.min(8, Math.max(1, scenes.length > 0 ? scenes.length : maxScenes));
  for (const scene of scenes.slice(0, sceneLimit)) {
    try {
      let suggestions = await pexelsMedia.searchVideos(
        scene.assetSearchQuery,
        3,
        scene.durationSeconds,
      );
      if (suggestions.length === 0 && scene.assetFallbackQuery && scene.assetFallbackQuery !== scene.assetSearchQuery) {
        suggestions = await pexelsMedia.searchVideos(
          scene.assetFallbackQuery,
          3,
          scene.durationSeconds,
        );
      }
      results.push({
        order: scene.order,
        searchQuery: suggestions.length > 0 ? scene.assetSearchQuery : (scene.assetFallbackQuery ?? scene.assetSearchQuery),
        suggestions,
      });
    } catch {
      results.push({
        order: scene.order,
        searchQuery: scene.assetFallbackQuery ?? scene.assetSearchQuery,
        suggestions: [],
      });
    }
  }

  return results;
}

function extractManualShortScriptSource(notes: string | null | undefined): { title?: string; body: string } | null {
  if (!notes?.trim()) {
    return null;
  }

  const match = notes.match(/MANUAL_SHORT_SCRIPT[\s\S]*?\ntitle:\s*(.+?)\nbody:\n([\s\S]*?)\nEND_MANUAL_SHORT_SCRIPT/);
  if (!match?.[2]?.trim()) {
    return null;
  }

  return {
    title: match[1]?.trim() || undefined,
    body: match[2].trim(),
  };
}

function extractManualSectionBullets(body: string, headerPattern: RegExp): string[] {
  const lines = body.split(/\r?\n/);
  const bullets: string[] = [];
  let active = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^#{1,6}\s/.test(line) && !headerPattern.test(line)) {
      if (active) {
        break;
      }
      continue;
    }
    if (!active && headerPattern.test(line)) {
      active = true;
      continue;
    }
    if (!active) {
      continue;
    }
    if (/^[*-]\s+/.test(line)) {
      bullets.push(line.replace(/^[*-]\s+/, "").trim());
    }
  }

  return bullets;
}

function extractManualTheme(body: string): string | undefined {
  const match = body.match(/^\s*Tema:\s*(.+)$/im);
  return match?.[1]?.trim() || undefined;
}

function inferManualShortStyleMode(body: string, fallback: ShortStyleMode): ShortStyleMode {
  const tone = body.match(/^\s*Tom:\s*(.+)$/im)?.[1] ?? "";
  const normalized = normalizeEmailAnalysisText(`${body}\n${tone}`);

  if (includesAny(normalized, ["motivador", "motivacional", "encorajador", "acao", "ação"])) {
    return "motivational";
  }
  if (includesAny(normalized, ["emocional", "emocao", "emoção", "dor", "virada"])) {
    return "emotional";
  }
  if (includesAny(normalized, ["provocativo", "provocadora", "contrarian", "quebra de crenca", "quebra de crença"])) {
    return "contrarian";
  }
  return fallback;
}

function buildManualSceneOverlay(label: string | undefined, voiceover: string): string {
  const normalizedLabel = normalizeEmailAnalysisText(label ?? "");
  const normalizedVoice = normalizeEmailAnalysisText(voiceover);

  if (/passo\s*\d/.test(normalizedVoice)) {
    const match = voiceover.match(/passo\s*\d+/i);
    return compressOverlayText(match?.[0] ?? voiceover, "PASSO");
  }
  if (normalizedLabel.includes("gancho")) {
    return "COMECE HOJE";
  }
  if (normalizedLabel.includes("ideia")) {
    return "IDEIA SIMPLES";
  }
  if (normalizedLabel.includes("quebra")) {
    return "NAO PRECISA SER EXPERT";
  }
  if (normalizedLabel.includes("fechamento")) {
    return "COMECE AGORA";
  }
  if (includesAny(normalizedVoice, ["sem investimento", "so com celular", "só com celular"])) {
    return "SEM INVESTIMENTO";
  }

  return compressOverlayText(voiceover, "COMECE AGORA");
}

function buildManualSceneVisualDirection(
  fallbackDirections: string[],
  index: number,
  voiceover: string,
): string {
  const explicit = fallbackDirections[index]?.trim();
  const normalized = normalizeEmailAnalysisText(voiceover);
  let contextual = "cortes rápidos com celular, interface social, prova em tela e pequenos negócios";
  if (includesAny(normalized, ["sem investimento", "celular"])) {
    contextual = "mãos com celular, interface social, texto grande e fundo escuro";
  } else if (includesAny(normalized, ["instagram", "perfil", "posta"])) {
    contextual = "tela de Instagram business, pequenos comércios e interface de perfil";
  } else if (includesAny(normalized, ["oferece", "mensagem", "digitar"])) {
    contextual = "mãos digitando mensagem comercial no celular, cortes rápidos e foco no chat";
  } else if (includesAny(normalized, ["responde clientes", "notificacoes", "notificações", "organiza o perfil"])) {
    contextual = "notificações, interação social e organização de perfil com motion text";
  } else if (includesAny(normalized, ["continua parado", "comeca antes", "começa antes"])) {
    contextual = "fundo escurecendo, texto forte e fechamento limpo";
  }

  if (explicit) {
    return normalizeFacelessVisualDirection(`${explicit}; ${contextual}`, contextual);
  }

  return contextual;
}

function buildManualSceneAssetQuery(voiceover: string, visualDirection: string): string {
  const normalized = normalizeEmailAnalysisText(`${voiceover}\n${visualDirection}`);

  if (includesAny(normalized, ["instagram", "perfil", "social", "posta"])) {
    return "instagram business phone vertical";
  }
  if (includesAny(normalized, ["celular", "smartphone"])) {
    return "hands smartphone business vertical";
  }
  if (includesAny(normalized, ["negocio", "negócio", "empresa", "comercio", "comércio"])) {
    return "small business storefront vertical";
  }
  if (includesAny(normalized, ["mensagem", "oferece", "digitar", "chat"])) {
    return "typing message smartphone vertical";
  }
  if (includesAny(normalized, ["notificacoes", "notificações", "clientes", "interacao", "interação"])) {
    return "social media notifications vertical";
  }
  if (includesAny(normalized, ["fundo escuro", "escurecendo", "final"])) {
    return "dark abstract background vertical";
  }

  return "small business instagram workspace vertical";
}

function parseManualTimedScenes(body: string): Array<{
  durationSeconds: number;
  label?: string;
  voiceover: string;
}> {
  const lines = body.split(/\r?\n/);
  const scenes: Array<{ durationSeconds: number; label?: string; voiceLines: string[] }> = [];
  let current: { durationSeconds: number; label?: string; voiceLines: string[] } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const headerMatch = line.match(/^#{1,6}\s*.*?(\d+)\s*[–-]\s*(\d+)s(?:\s*\(([^)]+)\))?/i);
    if (headerMatch) {
      if (current && current.voiceLines.length > 0) {
        scenes.push(current);
      }
      const start = Number.parseInt(headerMatch[1] ?? "0", 10);
      const end = Number.parseInt(headerMatch[2] ?? "0", 10);
      current = {
        durationSeconds: Math.max(2, end - start),
        label: headerMatch[3]?.trim(),
        voiceLines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith(">")) {
      current.voiceLines.push(line.replace(/^>\s*/, "").replace(/^["“”'`]+|["“”'`]+$/g, "").trim());
      continue;
    }

    if (/^["“].+["”]$/.test(line)) {
      current.voiceLines.push(line.replace(/^["“”'`]+|["“”'`]+$/g, "").trim());
    }
  }

  if (current && current.voiceLines.length > 0) {
    scenes.push(current);
  }

  return scenes.flatMap((scene) => {
    const voiceLines = scene.voiceLines
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (voiceLines.length === 0) {
      return [];
    }

    if (voiceLines.length === 1) {
      return [{
        durationSeconds: scene.durationSeconds,
        label: scene.label,
        voiceover: voiceLines[0]!,
      }];
    }

    const baseDuration = Math.max(2, Math.floor(scene.durationSeconds / voiceLines.length));
    let remaining = scene.durationSeconds - (baseDuration * voiceLines.length);

    return voiceLines.map((voiceover, index) => {
      const extra = remaining > 0 ? 1 : 0;
      remaining = Math.max(0, remaining - extra);
      return {
        durationSeconds: baseDuration + extra,
        label: scene.label ? `${scene.label} ${index + 1}` : undefined,
        voiceover,
      };
    });
  });
}

function parseManualNarrationScenes(body: string): Array<{
  durationSeconds: number;
  label?: string;
  voiceover: string;
}> {
  const lines = body.split(/\r?\n/);
  const blocks: string[] = [];
  let active = false;
  let currentBlock: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!active && /^#{1,6}\s*.*Narra[cç][aã]o/i.test(line)) {
      active = true;
      continue;
    }
    if (active && /^#{1,6}\s+/.test(line)) {
      break;
    }
    if (!active) {
      continue;
    }
    if (!line) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join(" ").trim());
        currentBlock = [];
      }
      continue;
    }
    if (line.startsWith("\"") || line.startsWith("“")) {
      currentBlock.push(line.replace(/^["“”'`]+|["“”'`]+$/g, "").trim());
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join(" ").trim());
  }

  if (blocks.length === 0) {
    return [];
  }

  const durations = rebalanceSceneDurations(
    blocks.map((voiceover, index) => ({
      order: index + 1,
      durationSeconds: Math.max(4, Math.round(30 / blocks.length)),
      voiceover,
      overlay: "MECANISMO PRÁTICO",
      visualDirection: "motion text forte, celular e interface social",
      assetSearchQuery: "small business instagram workspace vertical",
    })),
    30,
  );

  return durations.map((scene) => ({
    durationSeconds: scene.durationSeconds,
    voiceover: scene.voiceover,
  }));
}

function buildManualShortFormPackage(input: {
  item: {
    title: string;
    pillar: string | null;
    hook: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  };
  platform: string;
}): ShortFormPackage | null {
  const source = extractManualShortScriptSource(input.item.notes);
  if (!source) {
    return null;
  }

  const styleMode = inferManualShortStyleMode(
    source.body,
    inferShortStyleMode(input.item),
  );
  const styleProfile = buildShortStyleProfile(styleMode);
  const directions = extractManualSectionBullets(source.body, /^#{1,6}\s*.*Dire[cç][aã]o de cenas/i);
  const timedScenes = parseManualTimedScenes(source.body);
  const rawScenes = timedScenes.length > 0 ? timedScenes : parseManualNarrationScenes(source.body);
  if (rawScenes.length === 0) {
    return null;
  }

  const scenes: ShortScenePlan[] = rawScenes.map((scene, index) => {
    const visualDirection = buildManualSceneVisualDirection(directions, index, scene.voiceover);
    return {
      order: index + 1,
      durationSeconds: clampSceneDuration(scene.durationSeconds, 5),
      voiceover: scene.voiceover,
      overlay: buildManualSceneOverlay(scene.label, scene.voiceover),
      visualDirection,
      assetSearchQuery: buildManualSceneAssetQuery(scene.voiceover, visualDirection),
    };
  });

  const targetDurationSeconds = sumSceneDurations(scenes);
  const titleBase = source.title?.trim() || input.item.title.trim();
  const theme = extractManualTheme(source.body) ?? titleBase;
  const hook = scenes[0]?.voiceover ?? input.item.hook?.trim() ?? titleBase;
  const cta = scenes[scenes.length - 1]?.voiceover ?? "Comente o que você faria hoje.";
  const titleOptions = [
    titleBase,
    truncateBriefText(`${theme}: como começar hoje`, 72),
    truncateBriefText(`${theme} sem enrolação`, 72),
  ];

  return {
    styleMode,
    mode: "viral_short",
    targetDurationSeconds,
    hook,
    script: deriveScriptFromScenes(scenes),
    cta,
    description: `${theme}. Short construído a partir de roteiro manual, com execução direta e cenas orientadas pelo prompt do usuário.`,
    titleOptions,
    scenes,
    platformVariants: {
      youtubeShort: {
        title: titleBase,
        caption: `${theme}. Execução direta, passos simples e contexto visual alinhado ao roteiro.`,
        coverText: styleProfile.youtubeCoverText,
      },
      tiktok: {
        hook,
        caption: `${theme}. Vídeo curto, direto e com foco em ação imediata.`,
        coverText: styleProfile.tiktokCoverText,
      },
    },
  };
}

function validateShortFormPackage(
  payload: ShortFormPackage,
  fallback: ShortFormPackage,
  context: {
    title: string;
    pillar?: string | null;
    hook?: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  },
): ShortFormPackage {
  const normalizedScenes = normalizeScenePlan(payload.scenes, fallback.scenes);
  const desiredTarget = clampShortTargetDuration(payload.targetDurationSeconds, fallback.targetDurationSeconds);
  const rebalancedScenes = rebalanceSceneDurations(normalizedScenes, desiredTarget);
  const targetDurationSeconds = sumSceneDurations(rebalancedScenes);
  const styleMode = normalizeShortStyleMode(payload.styleMode, fallback.styleMode);
  const requestedCta = normalizeShortLine(payload.cta, fallback.cta);
  const cta = requestedCta.toLowerCase().includes("inscreva")
    ? "Comente qual métrica você usaria."
    : requestedCta;
  const canonicalHook = normalizeShortLine(payload.platformVariants.tiktok.hook || payload.hook, fallback.hook);
  const scenes = rebalancedScenes.map((scene, index, allScenes) => {
    if (index === allScenes.length - 1) {
      return {
        ...scene,
        voiceover: cta,
      };
    }
    return scene;
  });
  const resolvedScenes = scenes.map((scene, index, allScenes) => ({
    ...scene,
    assetSearchQuery: refineAssetSearchQuery(
      scene.assetSearchQuery,
      fallback.scenes[Math.min(index, fallback.scenes.length - 1)]?.assetSearchQuery ?? "startup business office",
      {
        ...context,
        sceneVoiceover: scene.voiceover,
        sceneOverlay: scene.overlay,
        styleMode,
      },
    ),
    overlay: compressOverlayText(
      index === allScenes.length - 1 ? cta : scene.overlay,
      fallback.scenes[Math.min(index, fallback.scenes.length - 1)]?.overlay ?? "MECANISMO PRÁTICO",
    ),
  }));
  const script = deriveScriptFromScenes(resolvedScenes);

  const validated: ShortFormPackage = {
    ...payload,
    styleMode,
    mode: "viral_short",
    targetDurationSeconds,
    hook: canonicalHook,
    cta,
    script,
    description: normalizeShortLine(payload.description, fallback.description),
    titleOptions: payload.titleOptions.length > 0 ? payload.titleOptions.map((item) => normalizeShortLine(item, fallback.titleOptions[0]!)).slice(0, 3) : fallback.titleOptions,
    scenes: resolvedScenes.map((scene, index) => ({
      ...scene,
      visualDirection: normalizeFacelessVisualDirection(
        scene.visualDirection,
        fallback.scenes[Math.min(index, fallback.scenes.length - 1)]?.visualDirection ?? "motion text, dashboard, mãos, tela e b-roll de trabalho",
      ),
    })),
    platformVariants: {
      youtubeShort: {
        title: normalizeShortLine(payload.platformVariants.youtubeShort.title, fallback.platformVariants.youtubeShort.title),
        caption: normalizeShortLine(payload.platformVariants.youtubeShort.caption, fallback.platformVariants.youtubeShort.caption),
        coverText: normalizeShortLine(payload.platformVariants.youtubeShort.coverText, fallback.platformVariants.youtubeShort.coverText),
      },
      tiktok: {
        hook: canonicalHook,
        caption: normalizeShortLine(payload.platformVariants.tiktok.caption, fallback.platformVariants.tiktok.caption),
        coverText: normalizeShortLine(payload.platformVariants.tiktok.coverText, fallback.platformVariants.tiktok.coverText),
      },
    },
  };

  return applyAtlasV2SceneEngine(validated, context);
}

function buildShortFormFallbackPackage(input: {
  item: {
    title: string;
    pillar: string | null;
    hook: string | null;
    formatTemplateKey?: string | null;
    seriesKey?: string | null;
    notes?: string | null;
  };
  platform: string;
}): ShortFormPackage {
  const styleMode = inferShortStyleMode(input.item);
  const styleProfile = buildShortStyleProfile(styleMode);
  const hook = input.item.hook?.trim()
    || `Se você errar isso em ${input.item.title.toLowerCase()}, vai perder dinheiro sem perceber.`;
  const cta = "Comente qual métrica você usaria.";
  const titleBase = input.item.title.trim();
  const titleOptions = [
    titleBase,
    `O erro por trás de ${titleBase.toLowerCase()}`,
    `${titleBase}: o que quase ninguém explica`,
  ];
  const scenes: ShortScenePlan[] = [
    {
      order: 1,
      durationSeconds: 4,
      voiceover: hook,
      overlay: "ERRO QUE CUSTA CARO",
      visualDirection: "motion text forte, contraste imediato e prova em tela sem rosto",
      assetSearchQuery: "startup analytics dashboard vertical",
    },
    {
      order: 2,
      durationSeconds: 5,
      voiceover: `A maioria olha só para ${input.item.pillar ?? "o resultado"} e ignora o problema real que está drenando dinheiro.`,
      overlay: "OLHAR SÓ O RESULTADO É ARMADILHA",
      visualDirection: "dor concreta em tela, preço, conta ou fricção de operação",
      assetSearchQuery: "wallet empty close",
    },
    {
      order: 3,
      durationSeconds: 5,
      voiceover: "Se você já passou por isso, não falta talento. Falta enxergar o mecanismo certo.",
      overlay: "NAO É FALTA DE TALENTO",
      visualDirection: "identificação imediata com operação real e celular em uso",
      assetSearchQuery: "hands smartphone app",
    },
    {
      order: 4,
      durationSeconds: 6,
      voiceover: `A regra prática aqui é simples: ${titleBase.toLowerCase()} precisa mostrar mecanismo, prova e ação clara.`,
      overlay: "REGRA PRATICA",
      visualDirection: "mecanismo em dashboard, interface ou fluxo claro",
      assetSearchQuery: "startup analytics dashboard vertical",
    },
    {
      order: 5,
      durationSeconds: 5,
      voiceover: "Faça o passo mais simples primeiro e corte tudo que parece bonito, mas não gera movimento.",
      overlay: "COMECE PELO PASSO 1",
      visualDirection: "execução concreta no celular, mensagem, clique ou configuração",
      assetSearchQuery: "typing message phone close",
    },
    {
      order: 6,
      durationSeconds: 5,
      voiceover: cta,
      overlay: "COMENTE SUA MÉTRICA",
      visualDirection: "resultado ou comentário na tela com fechamento limpo e contraste alto",
      assetSearchQuery: "mobile app comments interface vertical",
    },
  ];
  const script = scenes.map((scene) => scene.voiceover).join(" ");
  const description = `${titleBase}. Short direto do Riqueza Despertada com uma ideia central, mecanismo claro e aplicação prática.`;
  const platformVariants: ShortPlatformVariants = {
    youtubeShort: {
      title: titleOptions[0],
      coverText: styleProfile.youtubeCoverText,
      caption: `${titleBase}. Ideia prática para quem quer riqueza com execução.`,
    },
    tiktok: {
      hook,
      coverText: styleProfile.tiktokCoverText,
      caption: `${titleBase}. Sem enrolação, sem fórmula mágica, só mecanismo real.`,
    },
  };

  return {
    styleMode,
    mode: "viral_short",
    targetDurationSeconds: 30,
    hook,
    script,
    cta,
    description,
    titleOptions,
    scenes,
    platformVariants,
  };
}

function formatDateForTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildDailyEditorialResearchReply(input: {
  channelName: string;
  runDate: string;
  primaryTrend?: string;
  selectedTrends: Array<{ title: string; fitScore?: number; angle?: string; approxTraffic?: string }>;
  items: Array<{
    id: number;
    title: string;
    ideaScore: number | null;
    formatTemplateKey: string | null;
    seriesKey: string | null;
    slotKey?: string | null;
    hasScriptPackage?: boolean;
    status?: string | null;
  }>;
  fallbackMode: boolean;
  packageReadyCount?: number;
  packageFailedCount?: number;
}): string {
  const slotLabels: Record<string, string> = {
    morning_finance: "07:00 | Notícias financeiras",
    lunch_income: "12:00 | Renda extra",
    night_trends: "20:00 | Trend adaptado",
  };
  const lines = [
    `Research Kernel ${input.channelName} | ${input.runDate}`,
    `- Modo: ${input.fallbackMode ? "evergreen fallback" : "trend-first"}`,
  ];
  if (input.fallbackMode) {
    lines.push("- Motivo: nenhum trend do dia passou no filtro de finanças, negócios e utilidade prática.");
  }
  if (input.primaryTrend) {
    lines.push(`- Trend líder: ${input.primaryTrend}`);
  }
  if (typeof input.packageReadyCount === "number") {
    lines.push(`- Pacotes prontos: ${input.packageReadyCount}${typeof input.packageFailedCount === "number" ? ` | falhas: ${input.packageFailedCount}` : ""}`);
  }
  if (input.selectedTrends.length > 0) {
    lines.push("", "Trends considerados:");
    for (const trend of input.selectedTrends.slice(0, 3)) {
      lines.push(
        `- ${trend.title}${trend.approxTraffic ? ` | tráfego: ${trend.approxTraffic}` : ""}${trend.fitScore != null ? ` | fit: ${trend.fitScore}` : ""}${trend.angle ? ` | ângulo: ${truncateBriefText(trend.angle, 60)}` : ""}`,
      );
    }
  }
  lines.push("", "Grade editorial do dia:");
  const groupedItems = [
    ["morning_finance", input.items.filter((item) => item.slotKey === "morning_finance")],
    ["lunch_income", input.items.filter((item) => item.slotKey === "lunch_income")],
    ["night_trends", input.items.filter((item) => item.slotKey === "night_trends")],
  ] as const;
  for (const [slotKey, items] of groupedItems) {
    if (items.length === 0) {
      continue;
    }
    lines.push(`- ${slotLabels[slotKey]}:`);
    for (const item of items.slice(0, 2)) {
      lines.push(
        `  - #${item.id} | ${item.title}${item.ideaScore != null ? ` | score: ${item.ideaScore}` : ""}${item.formatTemplateKey ? ` | formato: ${item.formatTemplateKey}` : ""}${item.seriesKey ? ` | série: ${item.seriesKey}` : ""}${item.hasScriptPackage ? " | roteiro: pronto" : item.status ? ` | status: ${item.status}` : ""}`,
      );
    }
  }
  lines.push("", "Próxima ação: aprove 1 opção por faixa horária. Se você não confirmar, o Atlas deve priorizar a melhor pontuada.");
  return lines.join("\n");
}

type EditorialSlotKey = "morning_finance" | "lunch_income" | "night_trends";

function getEditorialSlotLabel(slotKey: EditorialSlotKey): string {
  switch (slotKey) {
    case "morning_finance":
      return "07:00 | Notícias financeiras";
    case "lunch_income":
      return "12:00 | Renda extra";
    case "night_trends":
      return "20:00 | Trend adaptado";
  }
}

function normalizeEditorialSlotKey(value: string | undefined, fallback: EditorialSlotKey): EditorialSlotKey {
  if (value === "morning_finance" || value === "lunch_income" || value === "night_trends") {
    return value;
  }
  return fallback;
}

function buildDailyEditorialSlotFallbackIdeas(input: {
  fallbackMode: boolean;
  usableTrendTitle?: string;
}): Array<{
  slotKey: EditorialSlotKey;
  seed: string;
}> {
  return [
    {
      slotKey: "morning_finance",
      seed: input.fallbackMode
        ? "notícias financeiras com impacto prático no bolso, juros, dólar, inflação, Selic, emprego e negócios"
        : `notícia financeira do dia com impacto prático: ${input.usableTrendTitle ?? "mercado e bolso"}`,
    },
    {
      slotKey: "lunch_income",
      seed: "meios reais de renda extra, serviços simples, micro-ofertas, vendas locais, renda com celular e execução prática",
    },
    {
      slotKey: "night_trends",
      seed: input.fallbackMode
        ? "trend adaptado para dinheiro, negócio, execução e oportunidade prática"
        : `trend mais pesquisado adaptado para renda, dinheiro ou execução: ${input.usableTrendTitle ?? "trend do dia"}`,
    },
  ];
}

function extractEditorialSlotKeyFromNotes(notes: string | null | undefined): EditorialSlotKey | undefined {
  const match = notes?.match(/\[slot:(morning_finance|lunch_income|night_trends)\]/i);
  if (!match?.[1]) {
    return undefined;
  }
  return normalizeEditorialSlotKey(match[1], "morning_finance");
}

function buildCaseNotesReply(notes: Array<{
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

function buildProjectScanReply(project: Record<string, unknown>, gitStatus?: Record<string, unknown>): string {
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

function buildSafeExecReply(result: {
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

function buildInboxTriageReply(items: InboxTriageItem[], options: { unreadOnly: boolean; limit: number }): string {
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

function buildBaseMessages(
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

export interface AgentRunResult {
  requestId: string;
  reply: string;
  messages: ConversationMessage[];
  toolExecutions: Array<{
    toolName: string;
    resultPreview: string;
  }>;
}

export interface AgentRunOptions {
  chatId?: string | number;
}

export class AgentCore {
  private readonly capabilityPlanner: CapabilityPlanner;
  private readonly contextAssembler: ContextAssembler;
  private readonly responseSynthesizer: ResponseSynthesizer;
  private readonly turnPlanner: TurnPlanner;
  private readonly activeGoals = new Map<string, ActivePlanningGoal>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fileAccess: FileAccessPolicy,
    private readonly client: LlmClient,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly pluginRegistry: ToolPluginRegistry,
    private readonly memory: OperationalMemoryStore,
    private readonly preferences: UserPreferencesStore,
    private readonly personalMemory: PersonalOperationalMemoryStore,
    private readonly growthOps: GrowthOpsStore,
    private readonly contentOps: ContentOpsStore,
    private readonly socialAssistant: SocialAssistantStore,
    private readonly contacts: ContactIntelligenceStore,
    private readonly communicationRouter: CommunicationRouter,
    private readonly approvals: ApprovalInboxStore,
    private readonly memoryEntities: MemoryEntityStore,
    private readonly whatsappMessages: WhatsAppMessageStore,
    private readonly workflows: WorkflowOrchestratorStore,
    private readonly workflowRuntime: WorkflowExecutionRuntime,
    private readonly entityLinker: EntityLinker,
    private readonly macCommandQueue: SupabaseMacCommandQueue,
    private readonly email: EmailReader,
    private readonly emailWriter: EmailWriter,
    private readonly emailAccounts: EmailAccountsService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly googleWorkspaces: GoogleWorkspaceAccountsService,
    private readonly googleMaps: GoogleMapsService,
    private readonly personalOs: PersonalOSService,
    private readonly intentRouter: IntentRouter,
    private readonly responseOs: ResponseOS,
    private readonly contextPacks: ContextPackService,
    private readonly planBuilder: WorkflowPlanBuilderService,
    private readonly externalReasoning: ExternalReasoningClient,
    private readonly pexelsMedia: PexelsMediaService,
    private readonly projectOps: ProjectOpsService,
    private readonly safeExec: SafeExecService,
  ) {
    this.capabilityPlanner = new CapabilityPlanner(
      this.config,
      this.capabilityRegistry,
      this.googleWorkspaces,
      this.googleMaps,
      this.externalReasoning,
      this.logger.child({ scope: "capability-planner" }),
    );
    this.contextAssembler = new ContextAssembler(
      this.logger.child({ scope: "context-assembler" }),
      {
        buildBaseMessages,
        selectToolsForPrompt: (userPrompt) => this.selectToolsForPrompt(userPrompt),
        getMemorySummary: () => this.memory.getContextSummary() ?? undefined,
        getProfile: () => this.personalMemory.getProfile(),
        getOperationalState: () => this.personalMemory.getOperationalState(),
      },
      {
        maxToolIterations: this.config.runtime.maxToolIterations,
      },
    );
    this.responseSynthesizer = new ResponseSynthesizer(
      this.client,
      this.logger.child({ scope: "response-synthesizer" }),
      {
        executeTool: async (input) => this.executeSynthesizedTool(input),
      },
    );
    const assistantActionDispatcher = new AssistantActionDispatcher(
      this,
      this.logger.child({ scope: "agent-core-action-dispatcher" }),
    );
    this.turnPlanner = new TurnPlanner(
      this.logger.child({ scope: "turn-planner" }),
      {
        getProfile: () => this.personalMemory.getProfile(),
        resolveOperationalMode: resolveEffectiveOperationalMode,
        rewriteReply: (prompt, reply, input) => rewriteConversationalSimpleReply(prompt, reply, input),
        resolveStructuredReply: async (rawReply, input) => assistantActionDispatcher.resolveStructuredReply(rawReply, input),
        rewriteStructuredReply: false,
      },
    );
  }

  resolveIntent(userPrompt: string): IntentResolution {
    return this.intentRouter.resolve(userPrompt);
  }

  shouldBypassClarification(userPrompt: string, options?: AgentRunOptions): boolean {
    if (this.capabilityPlanner.isPlanningCandidate(userPrompt)) {
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
      ? mergeTravelPlanningGoal(activeGoal, userPrompt)
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

  private async tryRunPreLocalExternalReasoning(
    input: {
      activeUserPrompt: string;
      requestId: string;
      requestLogger: Logger;
      intent: IntentResolution;
      preferences: UserPreferences;
      options?: AgentRunOptions;
    },
  ): Promise<AgentRunResult | null> {
    const shouldBypassPreLocalExternalReasoning = shouldBypassPreLocalExternalReasoningForPrompt(
      input.activeUserPrompt,
      input.intent,
    );
    if (shouldBypassPreLocalExternalReasoning) {
      input.requestLogger.info("Skipping external reasoning for direct local context command", {
        mode: this.config.externalReasoning.mode,
      });
      return null;
    }

    return this.tryRunExternalReasoning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.intent,
      input.preferences,
      input.options,
      "pre_local",
    );
  }

  private async tryRunDirectRoutes(input: {
    userPrompt: string;
    activeUserPrompt: string;
    requestId: string;
    requestLogger: Logger;
    intent: IntentResolution;
    orchestration: OrchestrationContext;
    preferences: UserPreferences;
    options?: AgentRunOptions;
  }): Promise<AgentRunResult | null> {
    const directPingResult = await this.tryRunDirectPing(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directPingResult) {
      return directPingResult;
    }
    const directGreetingResult = await this.tryRunDirectGreeting(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directGreetingResult) {
      return directGreetingResult;
    }
    const directConversationStyleResult = await this.tryRunDirectConversationStyleCorrection(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directConversationStyleResult) {
      return directConversationStyleResult;
    }
    const directIdentityResult = await this.tryRunDirectAgentIdentity(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directIdentityResult) {
      return directIdentityResult;
    }
    const directPersonalProfileShowResult = await this.tryRunDirectPersonalOperationalProfileShow(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalProfileShowResult) {
      return directPersonalProfileShowResult;
    }
    const directOperationalStateResult = await this.tryRunDirectOperationalStateShow(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directOperationalStateResult) {
      return directOperationalStateResult;
    }
    const directLearnedPreferencesListResult = await this.tryRunDirectLearnedPreferencesList(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directLearnedPreferencesListResult) {
      return directLearnedPreferencesListResult;
    }
    const directLearnedPreferencesDeleteResult = await this.tryRunDirectLearnedPreferencesDelete(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directLearnedPreferencesDeleteResult) {
      return directLearnedPreferencesDeleteResult;
    }
    const directCapabilityInspectionResult = await this.tryRunDirectCapabilityInspection(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directCapabilityInspectionResult) {
      return directCapabilityInspectionResult;
    }
    const activeGoalResult = await this.tryRunActiveGoalTurn(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
      input.preferences,
      input.options,
    );
    if (activeGoalResult) {
      return activeGoalResult;
    }
    const directCapabilityPlanningResult = await this.tryRunDirectCapabilityAwarePlanning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
      input.preferences,
      input.options,
    );
    if (directCapabilityPlanningResult) {
      return directCapabilityPlanningResult;
    }
    const directPersonalProfileUpdateResult = await this.tryRunDirectPersonalOperationalProfileUpdate(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalProfileUpdateResult) {
      return directPersonalProfileUpdateResult;
    }
    const directPersonalProfileDeleteResult = await this.tryRunDirectPersonalOperationalProfileDelete(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalProfileDeleteResult) {
      return directPersonalProfileDeleteResult;
    }
    const directPreferencesResult = await this.tryRunDirectUserPreferences(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directPreferencesResult) {
      return directPreferencesResult;
    }
    const directPersonalMemoryListResult = await this.tryRunDirectPersonalMemoryList(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalMemoryListResult) {
      return directPersonalMemoryListResult;
    }
    const directPersonalMemorySaveResult = await this.tryRunDirectPersonalMemorySave(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalMemorySaveResult) {
      return directPersonalMemorySaveResult;
    }
    const directPersonalMemoryUpdateResult = await this.tryRunDirectPersonalMemoryUpdate(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalMemoryUpdateResult) {
      return directPersonalMemoryUpdateResult;
    }
    const directPersonalMemoryDeleteResult = await this.tryRunDirectPersonalMemoryDelete(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directPersonalMemoryDeleteResult) {
      return directPersonalMemoryDeleteResult;
    }
    const directMorningBriefResult = await this.tryRunDirectMorningBrief(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directMorningBriefResult) {
      return directMorningBriefResult;
    }
    const directOperationalPlanningResult = await this.tryRunDirectOperationalPlanning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.intent,
      input.preferences,
    );
    if (directOperationalPlanningResult) {
      return directOperationalPlanningResult;
    }
    const directMacQueueStatusResult = await this.tryRunDirectMacQueueStatus(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directMacQueueStatusResult) {
      return directMacQueueStatusResult;
    }
    const directMacQueueListResult = await this.tryRunDirectMacQueueList(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directMacQueueListResult) {
      return directMacQueueListResult;
    }
    const directMacQueueEnqueueResult = await this.tryRunDirectMacQueueEnqueue(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directMacQueueEnqueueResult) {
      return directMacQueueEnqueueResult;
    }
    const directContactListResult = await this.tryRunDirectContactList(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directContactListResult) {
      return directContactListResult;
    }
    const directContactUpsertResult = await this.tryRunDirectContactUpsert(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directContactUpsertResult) {
      return directContactUpsertResult;
    }
    const directMemoryEntityListResult = await this.tryRunDirectMemoryEntityList(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directMemoryEntityListResult) {
      return directMemoryEntityListResult;
    }
    const directMemoryEntitySearchResult = await this.tryRunDirectMemoryEntitySearch(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directMemoryEntitySearchResult) {
      return directMemoryEntitySearchResult;
    }
    const directIntentResolveResult = await this.tryRunDirectIntentResolve(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directIntentResolveResult) {
      return directIntentResolveResult;
    }
    const directWorkflowListResult = await this.tryRunDirectWorkflowList(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directWorkflowListResult) {
      return directWorkflowListResult;
    }
    const directWorkflowShowResult = await this.tryRunDirectWorkflowShow(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directWorkflowShowResult) {
      return directWorkflowShowResult;
    }
    const directWorkflowArtifactsResult = await this.tryRunDirectWorkflowArtifacts(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directWorkflowArtifactsResult) {
      return directWorkflowArtifactsResult;
    }
    const directWorkflowExecutionResult = await this.tryRunDirectWorkflowExecution(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
      input.preferences,
    );
    if (directWorkflowExecutionResult) {
      return directWorkflowExecutionResult;
    }
    const directWorkflowStepUpdateResult = await this.tryRunDirectWorkflowStepUpdate(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
      input.preferences,
    );
    if (directWorkflowStepUpdateResult) {
      return directWorkflowStepUpdateResult;
    }
    const directWorkflowPlanningResult = await this.tryRunDirectWorkflowPlanning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
      input.preferences,
    );
    if (directWorkflowPlanningResult) {
      return directWorkflowPlanningResult;
    }
    const directMemoryUpdateGuardResult = await this.tryRunDirectMemoryUpdateGuard(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directMemoryUpdateGuardResult) {
      return directMemoryUpdateGuardResult;
    }
    const directSupportReviewResult = await this.tryRunDirectSupportReview(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directSupportReviewResult) {
      return directSupportReviewResult;
    }
    const directFollowUpReviewResult = await this.tryRunDirectFollowUpReview(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directFollowUpReviewResult) {
      return directFollowUpReviewResult;
    }
    const directInboxTriageResult = await this.tryRunDirectInboxTriage(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directInboxTriageResult) {
      return directInboxTriageResult;
    }
    const directOperationalBriefResult = await this.tryRunDirectOperationalBrief(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directOperationalBriefResult) {
      return directOperationalBriefResult;
    }
    const directNextCommitmentPrepResult = await this.tryRunDirectNextCommitmentPrep(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directNextCommitmentPrepResult) {
      return directNextCommitmentPrepResult;
    }
    const directCalendarLookupResult = await this.tryRunDirectCalendarLookup(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directCalendarLookupResult) {
      return directCalendarLookupResult;
    }
    const directCalendarConflictReviewResult = await this.tryRunDirectCalendarConflictReview(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directCalendarConflictReviewResult) {
      return directCalendarConflictReviewResult;
    }
    const directCalendarPeriodListResult = await this.tryRunDirectCalendarPeriodList(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directCalendarPeriodListResult) {
      return directCalendarPeriodListResult;
    }
    const directGoogleTaskDraftResult = await this.tryRunDirectGoogleTaskDraft(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleTaskDraftResult) {
      return directGoogleTaskDraftResult;
    }
    const directGoogleEventDraftResult = await this.tryRunDirectGoogleEventDraft(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleEventDraftResult) {
      return directGoogleEventDraftResult;
    }
    const directGoogleEventMoveResult = await this.tryRunDirectGoogleEventMove(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleEventMoveResult) {
      return directGoogleEventMoveResult;
    }
    const directGoogleEventDeleteResult = await this.tryRunDirectGoogleEventDelete(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleEventDeleteResult) {
      return directGoogleEventDeleteResult;
    }
    const directGoogleTasksResult = await this.tryRunDirectGoogleTasks(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleTasksResult) {
      return directGoogleTasksResult;
    }
    const directGoogleContactsResult = await this.tryRunDirectGoogleContacts(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleContactsResult) {
      return directGoogleContactsResult;
    }
    const directGoogleCalendarsResult = await this.tryRunDirectGoogleCalendarsList(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directGoogleCalendarsResult) {
      return directGoogleCalendarsResult;
    }
    const directPlaceLookupResult = await this.tryRunDirectPlaceLookup(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directPlaceLookupResult) {
      return directPlaceLookupResult;
    }
    const directWhatsAppSendResult = await this.tryRunDirectWhatsAppSend(
      input.activeUserPrompt,
      input.userPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directWhatsAppSendResult) {
      return directWhatsAppSendResult;
    }
    const directWhatsAppRecentSearchResult = await this.tryRunDirectWhatsAppRecentSearch(
      input.activeUserPrompt,
      input.userPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directWhatsAppRecentSearchResult) {
      return directWhatsAppRecentSearchResult;
    }
    const directWhatsAppPendingApprovalsResult = await this.tryRunDirectWhatsAppPendingApprovals(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directWhatsAppPendingApprovalsResult) {
      return directWhatsAppPendingApprovalsResult;
    }
    const directWeatherResult = await this.tryRunDirectWeather(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directWeatherResult) {
      return directWeatherResult;
    }
    const directInternalKnowledgeResult = await this.tryRunDirectInternalKnowledgeLookup(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directInternalKnowledgeResult) {
      return directInternalKnowledgeResult;
    }
    const directWebResearchResult = await this.tryRunDirectWebResearch(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directWebResearchResult) {
      return directWebResearchResult;
    }
    const directRevenueScoreboardResult = await this.tryRunDirectRevenueScoreboard(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directRevenueScoreboardResult) {
      return directRevenueScoreboardResult;
    }
    const directAllowedSpacesResult = await this.tryRunDirectAllowedSpaces(
      input.activeUserPrompt,
      input.requestId,
      input.orchestration,
    );
    if (directAllowedSpacesResult) {
      return directAllowedSpacesResult;
    }
    const directProjectScanResult = await this.tryRunDirectProjectScan(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directProjectScanResult) {
      return directProjectScanResult;
    }
    const directProjectMirrorResult = await this.tryRunDirectProjectMirror(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directProjectMirrorResult) {
      return directProjectMirrorResult;
    }
    const directSafeExecResult = await this.tryRunDirectSafeExec(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directSafeExecResult) {
      return directSafeExecResult;
    }
    const directDailyEditorialResearchResult = await this.tryRunDirectDailyEditorialResearch(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directDailyEditorialResearchResult) {
      return directDailyEditorialResearchResult;
    }
    const directContentIdeaGenerationResult = await this.tryRunDirectContentIdeaGeneration(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentIdeaGenerationResult) {
      return directContentIdeaGenerationResult;
    }
    const directContentReviewResult = await this.tryRunDirectContentReview(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentReviewResult) {
      return directContentReviewResult;
    }
    const directContentScriptResult = await this.tryRunDirectContentScriptGeneration(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentScriptResult) {
      return directContentScriptResult;
    }
    const directContentBatchResult = await this.tryRunDirectContentBatchPlanning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentBatchResult) {
      return directContentBatchResult;
    }
    const directContentBatchGenerationResult = await this.tryRunDirectContentBatchGeneration(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentBatchGenerationResult) {
      return directContentBatchGenerationResult;
    }
    const directContentDistributionStrategyResult = await this.tryRunDirectContentDistributionStrategy(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentDistributionStrategyResult) {
      return directContentDistributionStrategyResult;
    }
    const directContentChannelsResult = await this.tryRunDirectContentChannels(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentChannelsResult) {
      return directContentChannelsResult;
    }
    const directContentSeriesResult = await this.tryRunDirectContentSeries(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentSeriesResult) {
      return directContentSeriesResult;
    }
    const directContentFormatLibraryResult = await this.tryRunDirectContentFormatLibrary(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentFormatLibraryResult) {
      return directContentFormatLibraryResult;
    }
    const directContentHookLibraryResult = await this.tryRunDirectContentHookLibrary(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentHookLibraryResult) {
      return directContentHookLibraryResult;
    }
    const directContentOverviewResult = await this.tryRunDirectContentOverview(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directContentOverviewResult) {
      return directContentOverviewResult;
    }
    const directCaseNotesResult = await this.tryRunDirectCaseNotes(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directCaseNotesResult) {
      return directCaseNotesResult;
    }
    const directEmailDraftResult = await this.tryRunDirectEmailDraft(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directEmailDraftResult) {
      return directEmailDraftResult;
    }
    const directEmailSummaryResult = await this.tryRunDirectEmailSummary(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directEmailSummaryResult) {
      return directEmailSummaryResult;
    }
    const directEmailLookupResult = await this.tryRunDirectEmailLookup(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.orchestration,
    );
    if (directEmailLookupResult) {
      return directEmailLookupResult;
    }

    return this.tryRunExternalReasoning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.intent,
      input.preferences,
      input.options,
      "post_direct_routes",
    );
  }

  async runDailyEditorialResearch(input?: {
    channelKey?: string;
    timezone?: string;
    trendsLimit?: number;
    ideasLimit?: number;
    now?: Date;
  }): Promise<{
    reply: string;
    runDate: string;
    createdItemIds: number[];
    skipped: boolean;
  }> {
    const timezone = input?.timezone?.trim() || this.config.google.defaultTimezone;
    const now = input?.now ?? new Date();
    const runDate = formatDateForTimezone(now, timezone);
    const runType = "daily_research_brief";
    const channelKey = input?.channelKey ?? "riqueza_despertada_youtube";
    const existing = this.contentOps.getLatestResearchRun(channelKey, runType, runDate);
    if (existing?.status === "success") {
      return {
        reply: existing.summary ?? `Research Kernel já executado para ${channelKey} em ${runDate}.`,
        runDate,
        createdItemIds: [],
        skipped: true,
      };
    }

    const channel = this.contentOps.listChannels({ limit: 20 }).find((item) => item.key === channelKey);
    if (!channel) {
      const summary = `Nao encontrei o canal editorial ${channelKey} para rodar o Research Kernel.`;
      this.contentOps.createResearchRun({
        channelKey,
        runType,
        runDate,
        status: "failed",
        summary,
      });
      return {
        reply: summary,
        runDate,
        createdItemIds: [],
        skipped: false,
      };
    }

    const trendService = new GoogleTrendsIntakeService(this.logger.child({ scope: "google-trends" }));
    const researchService = new WebResearchService(this.logger.child({ scope: "web-research" }));
    const trends = await trendService.fetchBrazilDailyTrends(input?.trendsLimit ?? 10);
    const formats = this.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const hooks = this.contentOps.listHookTemplates({ limit: 20 });
    const series = this.contentOps.listSeries({ channelKey: channel.key, limit: 20 });
    const ideasLimit = 6;

    const shortlistFallback: Array<{
      title: string;
      approxTraffic?: string;
      fitScore: number;
      angle: string;
      useTrend: boolean;
    }> = trends.slice(0, 3).map((trend, index) => ({
      title: trend.title,
      approxTraffic: trend.approxTraffic,
      fitScore: Math.max(55 - index * 7, 20),
      angle: "Se não houver aderência forte ao canal, usar como contraste e cair para pauta evergreen.",
      useTrend: false,
    }));

    let selectedTrends = shortlistFallback;
    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o editor-chefe do canal Riqueza Despertada.",
              "Analise trends do Brasil e selecione no máximo 3 com melhor aderência ao canal.",
              "O canal fala apenas de finanças, negócios, renda, vendas, SaaS, produtos e execução para ganhar dinheiro.",
              "Rejeite esporte, celebridade, entretenimento e notícia geral sem impacto financeiro prático para o público.",
              "Só marque useTrend=true se o tema puder virar conteúdo útil para ganhar, vender, economizar ou decidir melhor financeiramente.",
              "Se o fitScore for menor que 60, useTrend deve ser false.",
              "Se nenhum trend servir, marque useTrend=false e proponha fallback evergreen.",
              "Responda somente JSON válido no formato {\"selectedTrends\":[...]}",
              "Cada item: title, fitScore, angle, useTrend.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              "",
              "Trends BR do momento:",
              ...trends.slice(0, 8).map((trend) =>
                `- ${trend.title}${trend.approxTraffic ? ` | tráfego: ${trend.approxTraffic}` : ""}${trend.newsItems[0]?.title ? ` | notícia: ${trend.newsItems[0].title}` : ""}`,
              ),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as {
        selectedTrends?: Array<{ title?: string; fitScore?: number; angle?: string; useTrend?: boolean }>;
      };
      if (Array.isArray(parsed.selectedTrends) && parsed.selectedTrends.length > 0) {
        selectedTrends = parsed.selectedTrends
          .filter((item) => item && typeof item.title === "string" && item.title.trim())
          .map((item) => {
            const original = trends.find((trend) => normalizeEmailAnalysisText(trend.title) === normalizeEmailAnalysisText(item.title ?? ""));
            return {
              title: item.title!.trim(),
              fitScore: typeof item.fitScore === "number" ? Math.max(0, Math.min(100, Math.round(item.fitScore))) : 50,
              angle:
                typeof item.angle === "string" && item.angle.trim().length > 0
                  ? item.angle.trim()
                  : "Trend com potencial, mas precisa de recorte editorial mais forte.",
              useTrend: item.useTrend !== false,
              approxTraffic: original?.approxTraffic,
            };
          })
          .slice(0, 3);
      }
    } catch (error) {
      this.logger.warn("Trend shortlist fell back to deterministic ranking", {
        channelKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    selectedTrends = filterSelectedTrendsForChannel({
      channelKey: channel.key,
      selectedTrends,
      rawTrends: trends,
    });

    const usableTrends = selectedTrends.filter((item) => item.useTrend);
    const fallbackMode = usableTrends.length === 0;

    const enrichedTrendContext: Array<{
      trend: GoogleTrendItem;
      angle?: string;
      fitScore?: number;
      research: Array<{ title: string; url: string; snippet: string; sourceHost: string }>;
    }> = [];
    for (const item of usableTrends.slice(0, 3)) {
      const trend = trends.find((entry) => normalizeEmailAnalysisText(entry.title) === normalizeEmailAnalysisText(item.title));
      if (!trend) {
        continue;
      }
      let research = [] as Array<{ title: string; url: string; snippet: string; sourceHost: string }>;
      try {
        research = (await researchService.search({
          query: trend.title,
          maxResults: 3,
          includePageExcerpt: false,
          mode: "executive",
        })).map((entry) => ({
          title: entry.title,
          url: entry.url,
          snippet: entry.snippet,
          sourceHost: entry.sourceHost,
        }));
      } catch (error) {
        this.logger.warn("Trend enrichment failed", {
          trend: trend.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      enrichedTrendContext.push({
        trend,
        angle: item.angle,
        fitScore: item.fitScore,
        research,
      });
    }

    type GeneratedIdea = {
      slotKey?: EditorialSlotKey;
      title: string;
      hook?: string;
      pillar?: string;
      audience?: string;
      formatTemplateKey?: string;
      seriesKey?: string | null;
      notes?: string;
    };

    const slotFallbacks = buildDailyEditorialSlotFallbackIdeas({
      fallbackMode,
      usableTrendTitle: usableTrends[0]?.title,
    });
    let generatedIdeas: GeneratedIdea[] = slotFallbacks.flatMap((slot) =>
      buildFallbackEditorialIdeas({
        channelName: channel.name,
        seed: slot.seed,
        formatKeys: formats.map((item) => item.key),
        seriesKeys: series.map((item) => item.key),
        limit: 2,
      }).map((idea) => ({
        ...idea,
        slotKey: slot.slotKey,
        audience: channel.persona ?? idea.audience,
        notes: [`[slot:${slot.slotKey}]`, idea.notes, fallbackMode ? "fallback evergreen por baixa aderência do trend." : ""]
          .filter(Boolean)
          .join(" | "),
      })),
    ).slice(0, ideasLimit);

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você gera pautas para short-form content do canal Riqueza Despertada.",
              "Cada pauta deve ajudar o espectador a ganhar dinheiro, vender melhor, economizar ou tomar decisão financeira mais inteligente.",
              "Não use futebol, celebridade, entretenimento ou curiosidade sem mecanismo claro de receita, caixa, venda, negócio ou patrimônio.",
              "Responda somente JSON válido.",
              "Formato: {\"ideas\":[...]}",
              "Cada item: slotKey, title, hook, pillar, audience, formatTemplateKey, seriesKey, notes.",
              "Gere exatamente 6 ideias: 2 para morning_finance, 2 para lunch_income, 2 para night_trends.",
              "morning_finance = notícia financeira ou de negócios com impacto prático no bolso ou no mercado.",
              "lunch_income = meios reais de renda extra, serviços, micro-ofertas, execução simples e aplicável.",
              "night_trends = trend do dia adaptado para dinheiro, negócio, renda ou execução. Se não houver trend útil, use evergreen com cara de trend.",
              "Se os trends não servirem, crie pautas evergreen fortes para riqueza, renda, SaaS e execução.",
              "Não gere placeholders nem títulos genéricos.",
              "Use apenas formatTemplateKey e seriesKey que existirem no contexto.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Plataforma: ${channel.platform}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              `Modo: ${fallbackMode ? "evergreen fallback" : "trend-first"}`,
              `Quantidade: 6`,
              "",
              "Slots obrigatórios:",
              "- morning_finance => publicação das 07:00",
              "- lunch_income => publicação das 12:00",
              "- night_trends => publicação das 20:00",
              "",
              "Formatos disponíveis:",
              ...formats.map((item) => `- ${item.key}: ${item.label} | ${item.structure}`),
              "",
              "Séries disponíveis:",
              ...(series.length > 0
                ? series.map((item) => `- ${item.key}: ${item.title} | ${item.premise ?? ""}`)
                : ["- nenhuma série específica"]),
              "",
              "Hooks de referência:",
              ...hooks.slice(0, 8).map((item) => `- ${item.label}: ${item.template}`),
              "",
              "Contexto de trends:",
              ...(enrichedTrendContext.length > 0
                ? enrichedTrendContext.flatMap((item) => [
                    `- Trend: ${item.trend.title}${item.trend.approxTraffic ? ` | tráfego: ${item.trend.approxTraffic}` : ""}${item.angle ? ` | ângulo: ${item.angle}` : ""}`,
                    ...item.research.map((entry) => `  - Fonte: ${entry.title} | ${entry.sourceHost} | ${truncateBriefText(entry.snippet, 96)}`),
                  ])
                : ["- Nenhum trend com aderência suficiente; use temas evergreen do canal."]),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as { ideas?: GeneratedIdea[] } | GeneratedIdea[];
      const rawIdeas = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.ideas)
          ? parsed.ideas
          : [];
      if (rawIdeas.length > 0) {
        generatedIdeas = rawIdeas
          .filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
          .slice(0, 6)
          .map((item) => ({
            slotKey: normalizeEditorialSlotKey(item.slotKey, "morning_finance"),
            title: item.title.trim(),
            hook: typeof item.hook === "string" ? item.hook.trim() : undefined,
            pillar: typeof item.pillar === "string" ? item.pillar.trim() : undefined,
            audience: item.audience ?? channel.persona ?? "público buscando riqueza e renda",
            formatTemplateKey: item.formatTemplateKey,
            seriesKey: item.seriesKey,
            notes: [`[slot:${normalizeEditorialSlotKey(item.slotKey, "morning_finance")}]`, typeof item.notes === "string" ? item.notes.trim() : ""]
              .filter(Boolean)
              .join(" | "),
          }));
      }
    } catch (error) {
      this.logger.warn("Daily editorial research ideas fell back to deterministic ideas", {
        channelKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const savedItems = generatedIdeas.map((idea) =>
      this.contentOps.createItem({
        title: idea.title,
        platform: channel.platform,
        format: "short_video",
        status: "idea",
        pillar: idea.pillar,
        audience: idea.audience,
        hook: idea.hook,
        notes: idea.notes,
        channelKey: channel.key,
        seriesKey: idea.seriesKey ?? undefined,
        formatTemplateKey: idea.formatTemplateKey ?? undefined,
      }),
    );

    const packagedItemIds: number[] = [];
    const packageFailures: Array<{ id: number; error: string }> = [];
    for (const createdItem of savedItems) {
      try {
        await this.runUserPrompt(`gere roteiro para o item #${createdItem.id}`);
        const refreshed = this.contentOps.getItemById(createdItem.id);
        if (refreshed && hasSavedShortPackage(refreshed.notes)) {
          packagedItemIds.push(createdItem.id);
          continue;
        }
        packageFailures.push({
          id: createdItem.id,
          error: "pacote não foi salvo após a geração",
        });
      } catch (error) {
        packageFailures.push({
          id: createdItem.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const refreshedItems = savedItems.map((item) => this.contentOps.getItemById(item.id) ?? item);

    const reply = buildDailyEditorialResearchReply({
      channelName: channel.name,
      runDate,
      primaryTrend: usableTrends[0]?.title,
      selectedTrends: usableTrends,
      items: refreshedItems.map((item) => ({
        ...item,
        slotKey: extractEditorialSlotKeyFromNotes(item.notes),
        hasScriptPackage: hasSavedShortPackage(item.notes),
      })),
      fallbackMode,
      packageReadyCount: packagedItemIds.length,
      packageFailedCount: packageFailures.length,
    });

    this.contentOps.createResearchRun({
      channelKey: channel.key,
      runType,
      runDate,
      status: "success",
      primaryTrend: usableTrends[0]?.title,
      summary: reply,
      payloadJson: JSON.stringify({
        selectedTrends: usableTrends,
        fallbackMode,
        createdItemIds: savedItems.map((item) => item.id),
        packagedItemIds,
        packageFailures,
        slots: savedItems.map((item) => ({
          id: item.id,
          slotKey: extractEditorialSlotKeyFromNotes(item.notes) ?? null,
        })),
      }),
    });

    return {
      reply,
      runDate,
      createdItemIds: savedItems.map((item) => item.id),
      skipped: false,
    };
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

  private buildActiveGoalUserDataReply(goal: ActivePlanningGoal, plan: CapabilityPlan): string {
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

    if (plan.suggestedAction === "respond_direct") {
      if (input.activeGoalChatId !== undefined) {
        this.clearChatState(input.activeGoalChatId);
      }
      return {
        requestId: input.requestId,
        reply: plan.directReply ?? plan.summary,
        messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "capability_planner",
            resultPreview: JSON.stringify({
              objective: plan.objective,
              suggestedAction: plan.suggestedAction,
            }),
          },
        ],
      };
    }

    if (plan.suggestedAction === "run_web_search") {
      return this.executeDirectWebResearch({
        userPrompt: input.userPrompt,
        query: plan.webQuery ?? input.userPrompt,
        requestId: input.requestId,
        requestLogger: input.requestLogger,
        orchestration: input.orchestration,
        researchMode: plan.researchMode ?? "executive",
      });
    }

    if (plan.suggestedAction === "run_maps_route") {
      if (!plan.routeRequest) {
        return null;
      }

      const route = await this.googleMaps.computeRoute({
        origin: plan.routeRequest.origin,
        destination: plan.routeRequest.destination,
        includeTolls: plan.routeRequest.includeTolls,
      });

      if (!route) {
        return {
          requestId: input.requestId,
          reply: "Não consegui fechar essa rota com segurança. Me confirma origem e destino do jeito mais direto possível.",
          messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
          toolExecutions: [
            {
              toolName: "maps.route",
              resultPreview: JSON.stringify({
                origin: plan.routeRequest.origin,
                destination: plan.routeRequest.destination,
                found: false,
              }),
            },
          ],
        };
      }

      if (input.activeGoalChatId !== undefined) {
        this.clearChatState(input.activeGoalChatId);
      }

      return {
        requestId: input.requestId,
        reply: buildMapsRouteReply({
          objective: plan.objective,
          route,
          roundTrip: plan.routeRequest.roundTrip,
          fuelPricePerLiter: plan.routeRequest.fuelPricePerLiter,
          consumptionKmPerLiter: plan.routeRequest.consumptionKmPerLiter,
        }),
        messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "maps.route",
            resultPreview: JSON.stringify({
              origin: route.origin.formattedAddress,
              destination: route.destination.formattedAddress,
              distanceMeters: route.distanceMeters,
              durationSeconds: route.durationSeconds,
              hasTolls: route.hasTolls,
              tolls: route.tolls,
              roundTrip: plan.routeRequest.roundTrip,
            }).slice(0, 240),
          },
        ],
      };
    }

    if (plan.suggestedAction === "run_maps_places_search") {
      if (!plan.placesRequest) {
        return null;
      }

      const placesResult = await this.googleMaps.searchPlaces(plan.placesRequest.query, {
        maxResults: plan.placesRequest.maxResults,
      });

      if (input.activeGoalChatId !== undefined) {
        this.clearChatState(input.activeGoalChatId);
      }

      return {
        requestId: input.requestId,
        reply: buildPlaceDiscoveryReply({
          categoryLabel: plan.placesRequest.categoryLabel,
          locationQuery: plan.placesRequest.locationQuery,
          results: placesResult.results,
        }),
        messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "maps.places_search",
            resultPreview: JSON.stringify({
              query: plan.placesRequest.query,
              total: placesResult.results.length,
              topResult: placesResult.results[0]?.formattedAddress ?? null,
            }).slice(0, 240),
          },
        ],
      };
    }

    if (plan.suggestedAction === "ask_user_data") {
      return {
        requestId: input.requestId,
        reply: input.activeGoal
          ? this.buildActiveGoalUserDataReply(input.activeGoal, plan)
          : buildCapabilityPlanUserDataReply(plan),
        messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
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
      };
    }

    if (plan.suggestedAction !== "handle_gap") {
      return null;
    }

    const missingCapabilities = [...new Set(plan.missingRequirements
      .filter((item) => item.kind !== "user_data")
      .map((item) => item.name))];
    const missingRequirementKinds = [...new Set(plan.missingRequirements
      .filter((item) => item.kind !== "user_data")
      .map((item) => item.kind))];
    const gap = plan.shouldLogGap
      ? this.personalMemory.recordProductGapObservation({
          signature: buildCapabilityGapSignature(plan),
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

    return {
      requestId: input.requestId,
      reply: buildCapabilityGapReply(plan, gap),
      messages: buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
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
    };
  }

  private async tryRunActiveGoalTurn(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult | null> {
    const activeGoal = this.getActiveGoal(options?.chatId);
    if (!activeGoal) {
      return null;
    }

    if (isActiveGoalCancellationPrompt(userPrompt)) {
      this.clearChatState(options?.chatId);
      return {
        requestId,
        reply: activeGoal.kind === "travel_planning"
          ? "Certo, descartei essa estimativa de viagem. Pode mandar o próximo pedido."
          : "Certo, descartei essa busca de lugares. Pode mandar o próximo pedido.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const interpreted = interpretConversationTurn({ text: userPrompt });
    const promptLooksCompatible = activeGoal.kind === "travel_planning"
      ? looksLikeCapabilityAwareTravelPrompt(userPrompt)
      : looksLikeCapabilityAwarePlacePrompt(userPrompt);
    const merged = activeGoal.kind === "travel_planning"
      ? mergeTravelPlanningGoal(activeGoal, userPrompt)
      : mergePlaceDiscoveryGoal(activeGoal, userPrompt);

    if (!merged.hasMeaningfulUpdate && !promptLooksCompatible && interpreted.isTopLevelRequest) {
      requestLogger.info("Clearing active goal due to clear topic shift", {
        chatId: options?.chatId,
        intent: interpreted.intent,
        skill: interpreted.skill,
        kind: activeGoal.kind,
      });
      this.clearChatState(options?.chatId);
      return null;
    }

    if (!merged.hasMeaningfulUpdate && !promptLooksCompatible) {
      if (!interpreted.isShortConfirmation) {
        return null;
      }
    }

    if (options?.chatId !== undefined) {
      this.setActiveGoal(options.chatId, merged.goal);
    }

    const planningPrompt = merged.goal.kind === "travel_planning"
      ? buildTravelPlanningPrompt(merged.goal)
      : buildPlaceDiscoveryPrompt(merged.goal);
    const plan = this.capabilityPlanner.plan(planningPrompt, interpreted);
    if (!plan) {
      return null;
    }

    requestLogger.info("Continuing active travel goal", {
      chatId: options?.chatId,
      objective: merged.goal.objective,
      kind: merged.goal.kind,
      changedKeys: merged.changedKeys,
      suggestedAction: plan.suggestedAction,
      missingUserData: plan.missingUserData,
    });

    return this.executeCapabilityPlan({
      userPrompt: planningPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
      plan,
      relatedSkill: interpreted.skill,
      activeGoal: merged.goal,
      activeGoalChatId: options?.chatId,
    });
  }

  async runUserPrompt(userPrompt: string, options?: AgentRunOptions): Promise<AgentRunResult> {
    const requestId = randomUUID();
    const requestLogger = this.logger.child({ requestId });
    const intent = this.intentRouter.resolve(userPrompt);
    const activeUserPrompt = intent.activeUserPrompt;
    const orchestration = intent.orchestration;
    const preferences = this.preferences.get();

    requestLogger.info("Resolved orchestration context", {
      primaryDomain: orchestration.route.primaryDomain,
      secondaryDomains: orchestration.route.secondaryDomains,
      mentionedDomains: intent.mentionedDomains,
      compoundIntent: intent.compoundIntent,
      historyTurns: intent.historyUserTurns.length,
      actionMode: orchestration.route.actionMode,
      confidence: orchestration.route.confidence,
      riskLevel: orchestration.policy.riskLevel,
      autonomyLevel: orchestration.policy.autonomyLevel,
    });

    const preLocalExternalReasoningResult = await this.tryRunPreLocalExternalReasoning({
      activeUserPrompt,
      requestId,
      requestLogger,
      intent,
      preferences,
      options,
    });
    if (preLocalExternalReasoningResult) {
      return preLocalExternalReasoningResult;
    }

    const directRouteResult = await this.tryRunDirectRoutes({
      userPrompt,
      activeUserPrompt,
      requestId,
      requestLogger,
      intent,
      orchestration,
      preferences,
      options,
    });
    if (directRouteResult) {
      return directRouteResult;
    }

    const context = this.contextAssembler.assemble({
      requestId,
      userPrompt,
      activeUserPrompt,
      orchestration,
      preferences,
      recentMessages: intent.historyUserTurns.slice(-6),
    });
    const synthesis = await this.responseSynthesizer.synthesize(context, { requestLogger });
    const outcome = await this.turnPlanner.plan(context, synthesis, { channelLabel: "core" });

    return {
      requestId,
      reply: outcome.reply,
      messages: outcome.messages,
      toolExecutions: outcome.toolExecutions,
    };
  }

  private async executeSynthesizedTool(input: ExecuteSynthesizedToolInput): Promise<{
    content: string;
    rawResult?: unknown;
  }> {
    return this.pluginRegistry.execute(input.toolName, input.rawArguments, {
      requestId: input.requestId,
      toolCallId: input.toolCallId,
      config: this.config,
      logger: input.requestLogger,
      fileAccess: this.fileAccess,
      memory: this.memory,
      preferences: this.preferences,
      personalMemory: this.personalMemory,
      growthOps: this.growthOps,
      contentOps: this.contentOps,
      socialAssistant: this.socialAssistant,
      workflows: this.workflows,
      email: this.email,
      emailWriter: this.emailWriter,
      emailAccounts: this.emailAccounts,
      googleWorkspace: this.googleWorkspace,
      googleWorkspaces: this.googleWorkspaces,
      projectOps: this.projectOps,
      safeExec: this.safeExec,
      orchestration: input.context.orchestration,
    });
  }

  async executeToolDirect(toolName: string, rawArguments: unknown): Promise<{
    requestId: string;
    content: string;
    rawResult: unknown;
  }> {
    const requestId = randomUUID();
    const toolCallId = randomUUID();
    const orchestration = buildOrchestrationContext(`executar ferramenta ${toolName}`);
    const requestLogger = this.logger.child({ requestId, tool: toolName, toolCallId, direct: true });
    const execution = await this.pluginRegistry.execute(toolName, rawArguments, {
      requestId,
      toolCallId,
      config: this.config,
      logger: requestLogger,
      fileAccess: this.fileAccess,
      memory: this.memory,
      preferences: this.preferences,
      personalMemory: this.personalMemory,
      growthOps: this.growthOps,
      contentOps: this.contentOps,
      socialAssistant: this.socialAssistant,
      workflows: this.workflows,
      email: this.email,
      emailWriter: this.emailWriter,
      emailAccounts: this.emailAccounts,
      googleWorkspace: this.googleWorkspace,
      googleWorkspaces: this.googleWorkspaces,
      projectOps: this.projectOps,
      safeExec: this.safeExec,
      orchestration,
    });

    return {
      requestId,
      content: execution.content,
      rawResult: execution.rawResult,
    };
  }

  async resolveStructuredTaskOperationPayload(
    payload: Record<string, unknown>,
    options?: {
      recentMessages?: string[];
    },
  ) {
    return resolveStructuredTaskOperationPayload({
      payload,
      recentMessages: options?.recentMessages,
      accounts: this.googleWorkspaces,
    });
  }

  private async tryRunExternalReasoning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    intent: IntentResolution,
    preferences: UserPreferences,
    options?: AgentRunOptions,
    stage: ExternalReasoningStage = "post_direct_routes",
  ): Promise<AgentRunResult | null> {
    if (!shouldAttemptExternalReasoning(this.config.externalReasoning, userPrompt, intent, stage)) {
      return null;
    }

    requestLogger.info("Trying external reasoning provider", {
      mode: this.config.externalReasoning.mode,
      stage,
      primaryDomain: intent.orchestration.route.primaryDomain,
      actionMode: intent.orchestration.route.actionMode,
      compoundIntent: intent.compoundIntent,
    });

    try {
      const contextPack = await this.contextPacks.buildForPrompt(userPrompt, intent);
      const request = await this.buildExternalReasoningRequest(
        userPrompt,
        intent,
        preferences,
        contextPack,
        options,
      );
      const response = await this.externalReasoning.reason(request);
      requestLogger.info("External reasoning completed", {
        mode: this.config.externalReasoning.mode,
        stage,
        responseKind: response.kind,
      });
      requestLogger.info(
        response.kind === "assistant_decision"
          ? "External reasoning assistant_decision accepted"
          : "External reasoning text response accepted",
        {
          mode: this.config.externalReasoning.mode,
          stage,
        },
      );
      const personalProfile = this.personalMemory.getProfile();
      const operationalMode = resolveEffectiveOperationalMode(userPrompt, personalProfile);

      return {
        requestId,
        reply: rewriteConversationalSimpleReply(userPrompt, response.content, {
          profile: personalProfile,
          operationalMode,
        }),
        messages: buildBaseMessages(userPrompt, intent.orchestration, preferences),
        toolExecutions: [
          {
            toolName: "external_reasoning",
            resultPreview: JSON.stringify(
              {
                kind: response.kind,
                primaryDomain: intent.orchestration.route.primaryDomain,
                actionMode: intent.orchestration.route.actionMode,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      requestLogger.warn("External reasoning failed; falling back to local flow", {
        mode: this.config.externalReasoning.mode,
        stage,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async buildExternalReasoningRequest(
    userPrompt: string,
    intent: IntentResolution,
    preferences: UserPreferences,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
    options?: AgentRunOptions,
  ): Promise<ExternalReasoningRequest> {
    const personalProfile = this.personalMemory.getProfile();
    const operationalState = this.personalMemory.getOperationalState();
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
      this.personalMemory.listLearnedPreferences({
        activeOnly: true,
        limit: 12,
      }),
      4,
    );
    const tasksContext = await this.buildExternalReasoningTasksContext(userPrompt, intent, contextPack);
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
                timezone: this.config.google.defaultTimezone,
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

  private shouldAttachTasksContextToExternalReasoning(
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

  private async buildExternalReasoningTasksContext(
    userPrompt: string,
    intent: IntentResolution,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
  ): Promise<ExternalReasoningRequest["context"]["tasks"] | undefined> {
    if (!this.shouldAttachTasksContextToExternalReasoning(userPrompt, intent, contextPack)) {
      return undefined;
    }

    const candidateAliases = resolvePromptAccountAliases(userPrompt, this.googleWorkspaces.getAliases());
    const lists: NonNullable<ExternalReasoningRequest["context"]["tasks"]>["lists"] = [];
    const items: NonNullable<ExternalReasoningRequest["context"]["tasks"]>["items"] = [];

    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
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
        this.logger.debug("Skipping Google Tasks context for external reasoning", {
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

  private async resolveEmailReferenceFromPrompt(
    userPrompt: string,
    requestLogger: Logger,
  ): Promise<ResolvedEmailReference | null> {
    const lookupRequest = extractEmailLookupRequest(userPrompt);
    if (!lookupRequest) {
      return null;
    }

    const messages = await this.email.scanRecentMessages({
      scanLimit: 180,
      unreadOnly: lookupRequest.unreadOnly,
      sinceHours: lookupRequest.sinceHours,
    });
    const matches = messages.filter((message) => {
      const summary = summarizeEmailForOperations({
        subject: message.subject,
        from: message.from,
        text: message.preview,
      });

      if (lookupRequest.senderQuery && !matchesSenderQuery(message, lookupRequest.senderQuery)) {
        return false;
      }

      if (lookupRequest.category && summary.group !== lookupRequest.category) {
        return false;
      }

      return true;
    });

    requestLogger.info("Resolved email lookup request", {
      senderQuery: lookupRequest.senderQuery,
      category: lookupRequest.category,
      unreadOnly: lookupRequest.unreadOnly,
      sinceHours: lookupRequest.sinceHours,
      totalScanned: messages.length,
      totalMatches: matches.length,
    });

    if (!matches.length) {
      return {
        label: buildEmailLookupLabel(lookupRequest),
        totalMatches: 0,
        request: lookupRequest,
      };
    }

    return {
      message: matches[0],
      label: buildEmailLookupLabel(lookupRequest),
      totalMatches: matches.length,
      request: lookupRequest,
    };
  }

  private selectToolsForPrompt(userPrompt: string) {
    const tools = this.pluginRegistry.listToolsForModel();
    if (!isEmailFocusedPrompt(userPrompt)) {
      const informationalPrompt =
        isWebResearchPrompt(userPrompt) ||
        isImplicitResearchPrompt(userPrompt) ||
        isInternalKnowledgePrompt(userPrompt) ||
        isWeatherPrompt(userPrompt) ||
        isAgentIdentityPrompt(userPrompt);

      if (!informationalPrompt) {
        return tools;
      }

      const mutatingTools = new Set([
        "write_workspace_file",
        "save_memory_item",
        "update_memory_item",
        "save_content_item",
        "update_content_item",
        "save_case_note",
        "save_lead",
        "update_lead_stage",
        "save_revenue_entry",
        "create_google_task",
        "create_calendar_event",
        "send_email_message",
        "send_email_reply",
        "mirror_project_to_workspace",
        "safe_exec",
        "export_growth_report",
        "export_content_calendar",
      ]);

      return tools.filter((tool) => !mutatingTools.has(tool.function.name));
    }

    const allowedEmailTools = new Set([
      "email_inbox_status",
      "list_recent_emails",
      "read_email_message",
      "triage_inbox",
    ]);

    return tools.filter((tool) => allowedEmailTools.has(tool.function.name));
  }

  private async tryRunDirectAgentIdentity(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isAgentIdentityPrompt(userPrompt)) {
      return null;
    }

    return {
      requestId,
      reply: buildAgentIdentityReply(this.preferences.get().preferredAgentName),
      messages: buildBaseMessages(userPrompt, orchestration, this.preferences.get()),
      toolExecutions: [],
    };
  }

  private async tryRunDirectGreeting(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGreetingPrompt(userPrompt)) {
      return null;
    }

    const profile = this.personalMemory.getProfile();
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, profile);
    return {
      requestId,
      reply: buildGreetingReply(userPrompt, {
        profile,
        operationalMode,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, this.preferences.get()),
      toolExecutions: [],
    };
  }

  private async tryRunDirectConversationStyleCorrection(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    const currentProfile = this.personalMemory.getProfile();
    const correction = extractConversationStyleCorrection(userPrompt, currentProfile);
    if (!correction) {
      return null;
    }

    await this.executeToolDirect("update_personal_operational_profile", {
      ...(correction.profileUpdate.responseStyle ? { responseStyle: correction.profileUpdate.responseStyle } : {}),
      ...(correction.profileUpdate.briefingPreference ? { briefingPreference: correction.profileUpdate.briefingPreference } : {}),
      ...(correction.profileUpdate.detailLevel ? { detailLevel: correction.profileUpdate.detailLevel } : {}),
      ...(correction.profileUpdate.tonePreference ? { tonePreference: correction.profileUpdate.tonePreference } : {}),
      ...(correction.profileUpdate.autonomyPreferences ? { autonomyPreferences: correction.profileUpdate.autonomyPreferences } : {}),
    });
    this.preferences.update(correction.preferenceUpdate);

    try {
      await this.executeToolDirect("save_learned_preference", {
        ...correction.learnedPreference,
        observe: true,
      });
    } catch (error) {
      this.logger.warn("Failed to save learned conversation style preference", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      requestId,
      reply: correction.reply,
      messages: buildBaseMessages(userPrompt, orchestration, {
        ...preferences,
        ...correction.preferenceUpdate,
      }),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: correction.reply,
        },
        {
          toolName: "save_learned_preference",
          resultPreview: correction.learnedPreference.value,
        },
      ],
    };
  }

  private async tryRunDirectMemoryUpdateGuard(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isMemoryUpdatePrompt(userPrompt)) {
      return null;
    }

    const id = extractMemoryItemId(userPrompt);
    if (!id) {
      return {
        requestId,
        reply: "Diga qual item da memória devo atualizar, por exemplo: `Atualize o item 3 para status done.`",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (!hasMemoryUpdateFields(userPrompt)) {
      return {
        requestId,
        reply: [
          `Encontrei a referência ao item ${id}, mas faltou dizer o que devo alterar.`,
          "Exemplos:",
          `- Atualize o item ${id} para status done.`,
          `- Atualize o item ${id} com prioridade high.`,
          `- Atualize o item ${id} com o título X e detalhes Y.`,
        ].join("\n"),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    return null;
  }

  private async tryRunDirectEmailSummary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isEmailSummaryPrompt(userPrompt)) {
      return null;
    }

    const uid = extractEmailUidFromPrompt(userPrompt);
    if (!uid) {
      return null;
    }

    const emailStatus = await this.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct email summary route", {
      uid,
    });

    const emailMessage = await this.email.readMessage(uid);
    const summary = summarizeEmailForOperations({
      subject: emailMessage.subject,
      from: emailMessage.from,
      text: emailMessage.text,
    });
    const routing = this.communicationRouter.classify({
      channel: "email",
      identifier: extractEmailIdentifier(emailMessage.from),
      displayName: emailMessage.from.join(", "),
      subject: emailMessage.subject,
      text: emailMessage.text,
    });

    return {
      requestId,
      reply: buildEmailSummaryReply({
        uid: emailMessage.uid,
        subject: emailMessage.subject,
        from: emailMessage.from,
        summary,
        routing: {
          relationship: routing.relationship,
          persona: routing.persona,
          policy: routing.actionPolicy,
        },
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "read_email_message",
          resultPreview: JSON.stringify(
            {
              uid: emailMessage.uid,
              subject: emailMessage.subject,
              from: emailMessage.from,
            },
            null,
            2,
          ).slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectEmailLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const lookupRequest = extractEmailLookupRequest(userPrompt);
    if (!lookupRequest || isEmailDraftPrompt(userPrompt) || isInboxTriagePrompt(userPrompt)) {
      return null;
    }

    const emailStatus = await this.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct email lookup route", {
      senderQuery: lookupRequest.senderQuery,
      category: lookupRequest.category,
      unreadOnly: lookupRequest.unreadOnly,
      sinceHours: lookupRequest.sinceHours,
    });

    const resolved = await this.resolveEmailReferenceFromPrompt(userPrompt, requestLogger);
    if (!resolved) {
      return null;
    }

    if (!resolved.message) {
      return {
        requestId,
        reply: buildEmailLookupMissReply(resolved.request),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [
          {
            toolName: "list_recent_emails",
            resultPreview: JSON.stringify(
              {
                totalMatches: 0,
                label: resolved.label,
                sinceHours: resolved.request.sinceHours,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    const summary = summarizeEmailForOperations({
      subject: resolved.message.subject,
      from: resolved.message.from,
      text: resolved.message.preview,
    });

    return {
      requestId,
      reply: buildEmailLookupReply({
        resolved: resolved as ResolvedEmailReference & { message: EmailMessageSummary },
        summary,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_recent_emails",
          resultPreview: JSON.stringify(
            {
              totalMatches: resolved.totalMatches,
              label: resolved.label,
              match: {
                uid: resolved.message.uid,
                subject: resolved.message.subject,
                from: resolved.message.from,
              },
            },
            null,
            2,
          ).slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectOperationalBrief(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isOperationalBriefPrompt(userPrompt)) {
      return null;
    }

    const status = this.googleWorkspace.getStatus();
    if (!status.ready) {
      return {
        requestId,
        reply: `A integração Google Workspace não está pronta. ${status.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct operational brief route", {
      domain: orchestration.route.primaryDomain,
    });

    const brief = await this.googleWorkspace.getDailyBrief();
    const focus = this.memory.getDailyFocus(4).map((item) => ({
      title: item.item.title,
      whyNow: item.whyNow,
      nextAction: item.nextAction,
    }));

    return {
      requestId,
      reply: buildOperationalBriefReply({
        brief,
        focus,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "daily_operational_brief",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              tasks: brief.tasks.length,
              focus: focus.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectMorningBrief(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isMorningBriefPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct morning brief route", {
      domain: orchestration.route.primaryDomain,
    });

    const brief = await this.personalOs.getExecutiveMorningBrief();
    const profile = this.personalMemory.getProfile();
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, profile);

    return {
      requestId,
      reply: buildMorningBriefReply(brief, {
        compact: operationalMode === "field",
        operationalMode,
        profile,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "morning_brief",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              tasks: brief.taskBuckets.actionableCount,
              emails: brief.emails.length,
              approvals: brief.approvals.length,
              workflows: brief.workflows.length,
              founderSections: brief.founderSnapshot.sections.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectMacQueueStatus(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isMacQueueStatusPrompt(userPrompt)) {
      return null;
    }

    const status = this.macCommandQueue.getStatus();
    return {
      requestId,
      reply: buildMacQueueStatusReply({ status }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "mac_queue_status",
          resultPreview: JSON.stringify(status, null, 2),
        },
      ],
    };
  }

  private async tryRunDirectMacQueueList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isMacQueueListPrompt(userPrompt)) {
      return null;
    }

    const status = this.macCommandQueue.getStatus();
    if (!status.ready) {
      return {
        requestId,
        reply: buildMacQueueStatusReply({ status }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const items = await this.macCommandQueue.listPending(10);
    return {
      requestId,
      reply: buildMacQueueListReply(items),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "mac_queue_list",
          resultPreview: JSON.stringify({ count: items.length }, null, 2),
        },
      ],
    };
  }

  private resolveHostProjectPath(alias: string): string | undefined {
    const normalizedAlias = normalizeAliasToken(alias);
    const documentsRoot = process.env.HOST_USER_DOCUMENTS_DIR?.trim();
    const authorizedProjectsRoot = this.config.paths.authorizedProjectsDir;
    const roots = [
      documentsRoot,
      this.config.paths.workspaceDir,
      authorizedProjectsRoot,
      path.join(authorizedProjectsRoot, "Dev"),
      path.join(authorizedProjectsRoot, "Social"),
      path.join(authorizedProjectsRoot, "Conteudo"),
      path.join(authorizedProjectsRoot, "Financeiro"),
      path.join(authorizedProjectsRoot, "Admin"),
    ].filter((value): value is string => Boolean(value));

    for (const root of roots) {
      const direct = path.resolve(root, alias);
      if (existsSync(direct)) {
        return direct;
      }
      if (!existsSync(root)) {
        continue;
      }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && normalizeAliasToken(entry.name) === normalizedAlias) {
          return path.join(root, entry.name);
        }
      }
    }

    return undefined;
  }

  private buildMacQueueIntent(userPrompt: string):
    | {
        summary: string;
        argv: string[];
        cwd?: string;
      }
    | undefined {
    const appName = extractMacOpenApp(userPrompt);
    if (appName) {
      return {
        summary: `Abrir app no Mac: ${appName}`,
        argv: ["open", "-a", appName],
      };
    }

    const url = extractMacOpenUrl(userPrompt);
    if (url) {
      return {
        summary: `Abrir URL no Mac: ${url}`,
        argv: ["open", url],
      };
    }

    const notificationText = extractMacNotificationText(userPrompt);
    if (notificationText) {
      return {
        summary: `Notificação local no Mac: ${notificationText.slice(0, 60)}`,
        argv: [
          "osascript",
          "-e",
          `display notification "${notificationText.replace(/"/g, '\\"')}" with title "Atlas Prime"`,
        ],
      };
    }

    const projectAlias = extractMacProjectOpenAlias(userPrompt);
    if (projectAlias) {
      const projectPath = this.resolveHostProjectPath(projectAlias);
      if (projectPath) {
        return {
          summary: `Abrir projeto no VS Code: ${projectAlias}`,
          argv: ["code", "-r", projectPath],
          cwd: projectPath,
        };
      }
    }

    const projectCommand = extractMacProjectCommand(userPrompt);
    if (projectCommand) {
      const projectPath = this.resolveHostProjectPath(projectCommand.projectAlias);
      if (projectPath) {
        return {
          summary: `Executar ${projectCommand.argv.join(" ")} no projeto ${projectCommand.projectAlias}`,
          argv: projectCommand.argv,
          cwd: projectPath,
        };
      }
    }

    return undefined;
  }

  private async tryRunDirectMacQueueEnqueue(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const status = this.macCommandQueue.getStatus();
    const intent = this.buildMacQueueIntent(userPrompt);
    if (!intent) {
      return null;
    }

    if (!status.ready) {
      return {
        requestId,
        reply: buildMacQueueStatusReply({ status }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const command = await this.macCommandQueue.enqueueCommand({
      summary: intent.summary,
      argv: intent.argv,
      cwd: intent.cwd,
      requestedBy: "atlas",
    });

    return {
      requestId,
      reply: buildMacQueueEnqueueReply({
        id: command.id,
        summary: command.summary,
        targetHost: command.targetHost,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "mac_queue_enqueue",
          resultPreview: JSON.stringify(
            {
              id: command.id,
              summary: command.summary,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectGoogleTasks(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGoogleTasksPrompt(userPrompt)) {
      return null;
    }
    const preferences = this.preferences.get();
    const profile = this.personalMemory.getProfile();
    const candidateAliases = resolvePromptAccountAliases(
      userPrompt,
      this.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );
    const explicitAccount = candidateAliases.length === 1 ? candidateAliases[0] : undefined;

    requestLogger.info("Using direct Google Tasks route", {
      domain: orchestration.route.primaryDomain,
      account: explicitAccount ?? (candidateAliases.length > 1 ? candidateAliases.join(",") : "all"),
      autonomy: resolveActionAutonomyRule(userPrompt).key,
    });

    const tasks: Array<TaskSummary & { account: string }> = [];
    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const accountTasks = await workspace.listTasks({
        maxResults: 15,
        showCompleted: false,
      });
      tasks.push(...accountTasks.map((task) => ({ ...task, account: alias })));
    }

    if (tasks.length === 0) {
      return {
        requestId,
        reply: explicitAccount
          ? `Não encontrei tarefas abertas na conta Google ${explicitAccount}.`
          : "Não encontrei tarefas abertas nas contas Google conectadas.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: this.responseOs.buildTaskReviewReply({
        scopeLabel: explicitAccount ? `Google Tasks da conta ${explicitAccount}` : "Google Tasks das contas conectadas",
        items: tasks.map((task) => ({
          title: task.title || "(sem titulo)",
          taskListTitle: task.taskListTitle,
          account: task.account,
          status: task.status,
          dueLabel: formatTaskDue(task, this.config.google.defaultTimezone),
        })),
        recommendedNextStep: tasks[0]
          ? `Revisar a primeira tarefa aberta: ${tasks[0].title || "(sem titulo)"}.`
          : undefined,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "list_google_tasks",
          resultPreview: JSON.stringify(
            {
              total: tasks.length,
              account: explicitAccount ?? "all",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectCalendarLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const lookup = extractCalendarLookupRequest(userPrompt, this.config.google.defaultTimezone);
    if (!lookup?.targetDate) {
      return null;
    }

    const preferences = this.preferences.get();
    requestLogger.info("Using direct calendar multi-source lookup route", {
      targetDate: lookup.targetDate.isoDate,
      topic: lookup.topic,
      autonomy: resolveActionAutonomyRule(userPrompt).key,
    });
    const profile = this.personalMemory.getProfile();
    const candidateAliases = resolvePromptAccountAliases(
      userPrompt,
      this.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );
    const explicitAccount = candidateAliases.length === 1 ? candidateAliases[0] : undefined;

    const eventMatches: Array<{
      account: string;
      summary: string;
      start: string | null;
      location?: string;
      htmlLink?: string;
    }> = [];

    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const calendarTargets = resolveCalendarTargets(workspace, userPrompt);

      for (const calendarId of calendarTargets) {
        const events = await workspace.listEventsInWindow({
          timeMin: lookup.targetDate.startIso,
          timeMax: lookup.targetDate.endIso,
          maxResults: 10,
          calendarId,
          ...(lookup.topic ? { query: lookup.topic } : {}),
        });

        for (const event of events) {
          if (!isPersonallyRelevantCalendarEvent({
            account: alias,
            summary: event.summary,
            description: event.description,
            location: event.location,
          })) {
            continue;
          }
          eventMatches.push({
            account: alias,
            summary: event.summary,
            start: event.start,
            location: event.location,
            htmlLink: event.htmlLink,
          });
        }
      }
    }

    const emailMatches: Array<{
      account: string;
      uid: string;
      subject: string;
      from: string[];
      date: string | null;
    }> = [];

    if (eventMatches.length === 0 && preferences.autoSourceFallback) {
      const topic = lookup.topic?.trim();
      if (topic) {
        for (const alias of this.emailAccounts.getAliases()) {
          const reader = this.emailAccounts.getReader(alias);
          const status = await reader.getStatus();
          if (!status.ready) {
            continue;
          }

          const messages = await reader.scanRecentMessages({
            scanLimit: 120,
            unreadOnly: false,
            sinceHours: 24 * 45,
          });

          const tokens = normalizeEmailAnalysisText(topic)
            .split(/\s+/)
            .filter((token) => token.length >= 3);

          for (const message of messages) {
            const haystack = normalizeEmailAnalysisText(
              `${message.subject}\n${message.from.join(" ")}\n${message.preview}`,
            );
            if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
              emailMatches.push({
                account: alias,
                uid: message.uid,
                subject: message.subject,
                from: message.from,
                date: message.date,
              });
            }
          }
        }

        emailMatches.sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""));
      }
    }

    return {
      requestId,
      reply: this.responseOs.buildScheduleLookupReply({
        targetLabel: lookup.targetDate.label,
        topicLabel: lookup.topic,
        events: eventMatches.map((item) => ({
          account: item.account,
          summary: item.summary,
          start: item.start ? formatBriefDateTime(item.start, this.config.google.defaultTimezone) : null,
          location: item.location ? summarizeCalendarLocation(item.location) : undefined,
        })),
        emailFallbackCount: emailMatches.length,
        recommendedNextStep: preferences.proactiveNextStep
          ? eventMatches.length > 1
            ? "Revisar os demais eventos do mesmo dia para confirmar conflito ou contexto."
            : emailMatches.length > 0
              ? "Abrir o email mais recente para confirmar data, horário ou convite."
              : "Verificar outras contas ou calendários se a busca precisar ser ampliada."
          : undefined,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "calendar_email_lookup",
          resultPreview: JSON.stringify(
            {
              targetDate: lookup.targetDate.isoDate,
              topic: lookup.topic ?? null,
              events: eventMatches.length,
              emails: emailMatches.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectGoogleTaskDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGoogleTaskCreatePrompt(userPrompt)) {
      return null;
    }

    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const workspace = this.googleWorkspaces.getWorkspace(explicitAccount);
    const status = workspace.getStatus();
    if (!status.ready) {
      return {
        requestId,
        reply: `A integração do Google Workspace não está pronta. ${status.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct Google Task draft route", {
      domain: orchestration.route.primaryDomain,
    });

    const draftResult = buildTaskDraftFromPrompt(userPrompt, this.config.google.defaultTimezone);
    if (!draftResult.draft) {
      return {
        requestId,
        reply: draftResult.reason ?? "Não consegui preparar a tarefa com os dados informados.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (explicitAccount) {
      draftResult.draft.account = explicitAccount;
    }

    const scopeNotice = status.writeReady
      ? undefined
      : "Observação: a conta Google atual ainda está somente leitura. Antes de confirmar a criação, reautorize com `npm run google:auth` para liberar escopo de escrita.";
    const reply = [
      buildGoogleTaskDraftReply(draftResult.draft, this.config.google.defaultTimezone),
      scopeNotice,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      requestId,
      reply,
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectCalendarConflictReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isCalendarConflictReviewPrompt(userPrompt)) {
      return null;
    }

    const explicitWindow = parseCalendarPeriodWindow(userPrompt, this.config.google.defaultTimezone);
    const start = explicitWindow
      ? explicitWindow.startIso
      : new Date().toISOString();
    const end = explicitWindow
      ? explicitWindow.endIso
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const scopeLabel = explicitWindow?.label ?? "próximos 7 dias";
    const profile = this.personalMemory.getProfile();
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, profile);
    const aliases = resolvePromptAccountAliases(
      userPrompt,
      this.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );

    const events: Array<{
      account: string;
      summary: string;
      start: string | null;
      end: string | null;
      location?: string;
      owner: "paulo" | "equipe" | "delegavel";
    }> = [];

    for (const alias of aliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) {
        continue;
      }

      const calendarTargets = resolveCalendarTargets(workspace, userPrompt);
      for (const calendarId of calendarTargets) {
        const items = await workspace.listEventsInWindow({
          timeMin: start,
          timeMax: end,
          maxResults: 40,
          calendarId,
        });
        for (const event of items) {
          if (!isPersonallyRelevantCalendarEvent({
            account: alias,
            summary: event.summary,
            description: event.description,
            location: event.location,
          })) {
            continue;
          }
          const matchedTerms = matchPersonalCalendarTerms({
            account: alias,
            summary: event.summary,
            description: event.description,
            location: event.location,
          });
          events.push({
            account: alias,
            summary: event.summary,
            start: event.start,
            end: event.end,
            location: event.location,
            owner: alias === "primary"
              ? "paulo"
              : normalizeEmailAnalysisText([event.summary, event.location].filter(Boolean).join(" ")).includes("paulo")
                ? "paulo"
                : matchedTerms.length > 0
                  ? "equipe"
                  : "delegavel",
          });
        }
      }
    }

    const insights = analyzeCalendarInsights(events, this.config.google.defaultTimezone);
    requestLogger.info("Using direct calendar conflict review route", {
      scopeLabel,
      events: events.length,
      insights: insights.length,
    });

    return {
      requestId,
      reply: this.responseOs.buildCalendarConflictReviewReply({
        scopeLabel,
        totalEvents: events.length,
        overlapCount: insights.filter((item) => item.kind === "overlap").length,
        duplicateCount: insights.filter((item) => item.kind === "duplicate").length,
        namingCount: insights.filter((item) => item.kind === "inconsistent_name").length,
        items: insights.slice(0, operationalMode === "field" ? 3 : 6).map((item) => ({
          kind: item.kind,
          dayLabel: item.dayLabel,
          summary: item.summary,
          recommendation: item.recommendation,
        })),
        recommendedNextStep: insights[0]?.recommendation,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "calendar_conflict_review",
          resultPreview: JSON.stringify(
            {
              scopeLabel,
              events: events.length,
              insights: insights.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectGoogleEventDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGoogleEventCreatePrompt(userPrompt)) {
      return null;
    }

    const availableAliases = this.googleWorkspaces.getAliases();
    const explicitAccount = extractExplicitAccountAlias(userPrompt, availableAliases);
    const readyAliases = availableAliases.filter((alias) => this.googleWorkspaces.getWorkspace(alias).getStatus().ready);
    const selectedAccount = explicitAccount ?? (readyAliases.length === 1 ? readyAliases[0] : undefined);
    const workspace = selectedAccount ? this.googleWorkspaces.getWorkspace(selectedAccount) : undefined;
    const status = workspace?.getStatus();
    if (selectedAccount && !status?.ready) {
      return {
        requestId,
        reply: `A integração do Google Workspace não está pronta. ${status?.message ?? "Conta indisponível no momento."}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    if (!selectedAccount && readyAliases.length === 0) {
      const fallbackStatus = this.googleWorkspaces.getWorkspace(explicitAccount).getStatus();
      return {
        requestId,
        reply: `A integração do Google Workspace não está pronta. ${fallbackStatus.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct Google Calendar event draft route", {
      domain: orchestration.route.primaryDomain,
      account: selectedAccount ?? (readyAliases.length > 1 ? "clarify_account" : "default"),
    });

    const draftResult = buildEventDraftFromPrompt(userPrompt, this.config.google.defaultTimezone);
    if (!draftResult.draft) {
      return {
        requestId,
        reply: draftResult.reason ?? "Não consegui preparar o evento com os dados informados.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (selectedAccount) {
      draftResult.draft.account = selectedAccount;
    }
    const explicitCalendar = extractExplicitCalendarAlias(
      userPrompt,
      Object.keys((workspace ?? this.googleWorkspaces.getWorkspace(explicitAccount)).getCalendarAliases()),
    );
    if (explicitCalendar) {
      draftResult.draft.calendarId = explicitCalendar;
    }

    if (!selectedAccount && readyAliases.length > 1) {
      return {
        requestId,
        reply: [
          "Preciso saber em qual agenda salvar: pessoal ou abordagem?",
          buildGoogleEventDraftReply(draftResult.draft),
        ].join("\n\n"),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (draftResult.draft.location && !looksLikePostalAddress(draftResult.draft.location)) {
      const addressCandidate = await lookupVenueAddress(
        draftResult.draft.location,
        userPrompt,
        requestLogger.child({ scope: "event-location-lookup" }),
        this.googleMaps,
      );
      if (addressCandidate) {
        draftResult.draft.location = `${draftResult.draft.location} - ${addressCandidate}`;
      }
    }

    if (shouldAutoCreateGoogleEvent(userPrompt, draftResult.draft, Boolean(status?.writeReady))) {
      requestLogger.info("Using direct Google Calendar auto-create route", {
        account: draftResult.draft.account ?? "primary",
        calendarId: draftResult.draft.calendarId ?? "default",
      });
      const execution = await this.executeToolDirect("create_calendar_event", {
        summary: draftResult.draft.summary,
        start: draftResult.draft.start,
        end: draftResult.draft.end,
        ...(draftResult.draft.description ? { description: draftResult.draft.description } : {}),
        ...(draftResult.draft.location ? { location: draftResult.draft.location } : {}),
        ...(draftResult.draft.attendees?.length ? { attendees: draftResult.draft.attendees } : {}),
        ...(draftResult.draft.timezone ? { timezone: draftResult.draft.timezone } : {}),
        ...(draftResult.draft.calendarId ? { calendar_id: draftResult.draft.calendarId } : {}),
        ...(draftResult.draft.account ? { account: draftResult.draft.account } : {}),
        ...(typeof draftResult.draft.reminderMinutes === "number"
          ? { reminder_minutes: draftResult.draft.reminderMinutes }
          : {}),
        ...(draftResult.draft.createMeet ? { create_meet: true } : {}),
      });

      return {
        requestId,
        reply: buildDirectGoogleEventCreateReply(execution.rawResult, this.config.google.defaultTimezone),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [
          {
            toolName: "create_calendar_event",
            resultPreview: execution.content.slice(0, 240),
          },
        ],
      };
    }

    const scopeNotice = status?.writeReady
      ? undefined
      : "Observação: a conta Google atual ainda está somente leitura. Antes de confirmar a criação, reautorize com `npm run google:auth` para liberar escopo de escrita.";
    const reply = [
      buildGoogleEventDraftReply(draftResult.draft),
      scopeNotice,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      requestId,
      reply,
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectCalendarPeriodList(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isCalendarPeriodListPrompt(userPrompt)) {
      return null;
    }
    const window = parseCalendarPeriodWindow(userPrompt, this.config.google.defaultTimezone);
    if (!window) {
      return null;
    }
    const profile = this.personalMemory.getProfile();
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, profile);
    const aliases = resolvePromptAccountAliases(
      userPrompt,
      this.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );
    const explicitAccount = aliases.length === 1 ? aliases[0] : undefined;
    const events: Array<{ account: string; event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number] }> = [];
    for (const alias of aliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) continue;
      const calendarTargets = resolveCalendarTargets(workspace, userPrompt);
      for (const calendarId of calendarTargets) {
        const items = await workspace.listEventsInWindow({
          timeMin: window.startIso,
          timeMax: window.endIso,
          maxResults: 20,
          calendarId,
        });
        for (const event of items) {
          events.push({ account: alias, event });
        }
      }
    }
    requestLogger.info("Using direct calendar period list route", { period: window.label, account: explicitAccount ?? "all" });
    return {
      requestId,
      reply: buildCalendarPeriodReply({
        label: window.label,
        timezone: this.config.google.defaultTimezone,
        compact: operationalMode === "field",
        events,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectGoogleEventMove(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isCalendarMovePrompt(userPrompt)) {
      return null;
    }
    const parts = extractCalendarMoveParts(userPrompt);
    if (!parts) {
      return null;
    }
    const sourceDate = parseCalendarLookupDate(parts.source, this.config.google.defaultTimezone);
    const topic =
      cleanCalendarEventTopicReference(extractCalendarDeleteTopic(parts.source)) ??
      cleanCalendarEventTopicReference(extractCalendarLookupTopic(parts.source)) ??
      cleanCalendarEventTopicReference(parts.source) ??
      parts.source;
    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const profile = this.personalMemory.getProfile();
    const aliases = explicitAccount
      ? [explicitAccount]
      : resolvePromptAccountAliases(
          userPrompt,
          this.googleWorkspaces.getAliases(),
          profile.defaultAgendaScope,
        );
    const resolution = await resolveCalendarEventReference({
      accounts: this.googleWorkspaces,
      aliases,
      timezone: this.config.google.defaultTimezone,
      timeMin: sourceDate?.startIso ?? new Date().toISOString(),
      timeMax: sourceDate?.endIso ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      action: "move",
      topic,
      recentMessages: [userPrompt],
    });
    if (resolution.kind === "not_found") {
      return {
        requestId,
        reply: resolution.message,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    if (resolution.kind === "clarify") {
      return {
        requestId,
        reply: resolution.message,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    const match = resolution.match;
    const baseDraft = {
      kind: "google_event_update" as const,
      eventId: match.event.id,
      summary: match.event.summary,
      originalSummary: match.event.summary,
      originalStart: match.event.start ?? "",
      originalEnd: match.event.end ?? "",
      originalLocation: match.event.location,
      start: match.event.start ?? "",
      end: match.event.end ?? "",
      timezone: this.config.google.defaultTimezone,
      account: match.account,
      reminderMinutes: 30,
    };
    const normalizedInstruction = normalizeCalendarUpdateInstruction(parts);
    const adjusted = adjustEventDraftFromInstruction(baseDraft, normalizedInstruction);
    if (!adjusted) {
      return {
        requestId,
        reply: "Entendi o evento, mas faltou um ajuste claro. Diga em uma frase curta o que mudar, por exemplo: `título: Reunião no CAPS`, `local: Sala 5` ou `das 14h às 15h`.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    const finalDraft = adjusted as PendingGoogleEventUpdateDraft;
    requestLogger.info("Using direct Google Calendar update draft route", {
      account: match.account,
      verb: parts.verb,
    });
    return {
      requestId,
      reply: buildGoogleEventUpdateDraftReply(finalDraft),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectGoogleEventDelete(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (isCalendarPeriodDeletePrompt(userPrompt)) {
      const window = parseCalendarPeriodWindow(userPrompt, this.config.google.defaultTimezone);
      if (!window) {
        return null;
      }
      const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
      const aliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();
      const events: PendingGoogleEventDeleteBatchDraft["events"] = [];
      for (const alias of aliases) {
        const workspace = this.googleWorkspaces.getWorkspace(alias);
        if (!workspace.getStatus().ready) continue;
        const items = await workspace.listEventsInWindow({
          timeMin: window.startIso,
          timeMax: window.endIso,
          maxResults: 20,
        });
        for (const event of items) {
          events.push({
            eventId: event.id,
            summary: event.summary,
            start: event.start ?? undefined,
            end: event.end ?? undefined,
            account: alias,
          });
        }
      }
      if (events.length === 0) {
        return {
          requestId,
          reply: `Não encontrei compromissos para cancelar em ${window.label}.`,
          messages: buildBaseMessages(userPrompt, orchestration),
          toolExecutions: [],
        };
      }
      return {
        requestId,
        reply: buildGoogleEventDeleteBatchDraftReply({
          kind: "google_event_delete_batch",
          timezone: this.config.google.defaultTimezone,
          events,
        }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (!isCalendarDeletePrompt(userPrompt)) {
      return null;
    }

    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const profile = this.personalMemory.getProfile();
    const accountAliases = explicitAccount
      ? [explicitAccount]
      : resolvePromptAccountAliases(
          userPrompt,
          this.googleWorkspaces.getAliases(),
          profile.defaultAgendaScope,
        );
    const explicitCalendar = extractExplicitCalendarAlias(
      userPrompt,
      Object.keys(this.googleWorkspaces.getWorkspace(explicitAccount).getCalendarAliases()),
    );
    const targetDate = parseCalendarLookupDate(userPrompt, this.config.google.defaultTimezone);
    const topic = extractCalendarDeleteTopic(userPrompt) ?? extractCalendarLookupTopic(userPrompt);
    if (!topic) {
      return {
        requestId,
        reply: "Consigo cancelar o evento, mas preciso do título ou de uma referência mais específica.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const hasReadyAccount = accountAliases.some((alias) => this.googleWorkspaces.getWorkspace(alias).getStatus().ready);
    if (!hasReadyAccount) {
      const fallbackStatus = this.googleWorkspaces.getWorkspace(explicitAccount).getStatus();
      return {
        requestId,
        reply: `A integração do Google Workspace não está pronta. ${fallbackStatus.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const resolution = await resolveCalendarEventReference({
      accounts: this.googleWorkspaces,
      aliases: accountAliases,
      timezone: this.config.google.defaultTimezone,
      timeMin: targetDate?.startIso ?? new Date().toISOString(),
      timeMax: targetDate?.endIso ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      action: "delete",
      topic,
      calendarId: explicitCalendar,
      recentMessages: [userPrompt],
    });

    if (resolution.kind === "not_found") {
      return {
        requestId,
        reply: targetDate ? `${resolution.message.replace(/\.$/, "")} em ${targetDate.label}.` : resolution.message,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (resolution.kind === "clarify") {
      return {
        requestId,
        reply: resolution.message,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const match = resolution.match;
    requestLogger.info("Using direct Google Calendar event delete draft route", {
      domain: orchestration.route.primaryDomain,
      account: match.account,
    });

    return {
      requestId,
      reply: buildGoogleEventDeleteDraftReply({
        kind: "google_event_delete",
        eventId: match.event.id,
        summary: match.event.summary,
        description: match.event.description,
        location: match.event.location,
        start: match.event.start ?? undefined,
        end: match.event.end ?? undefined,
        timezone: this.config.google.defaultTimezone,
        ...(match.calendarId ? { calendarId: match.calendarId } : {}),
        account: match.account,
        reminderMinutes: 30,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectGoogleContacts(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGoogleContactsPrompt(userPrompt)) {
      return null;
    }

    const query = extractGoogleContactsQuery(userPrompt);
    if (!query) {
      return {
        requestId,
        reply: "Diga qual contato devo procurar no Google Contacts.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    const preferences = this.preferences.get();
    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const candidateAliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();

    requestLogger.info("Using direct Google Contacts route", {
      query,
      account: explicitAccount ?? "all",
    });

    const contacts: Array<{
      account: string;
      displayName: string;
      emailAddresses: string[];
      phoneNumbers: string[];
      organizations: string[];
    }> = [];
    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const accountContacts = await workspace.searchContacts(query, 10);
      contacts.push(...accountContacts.map((contact) => ({ ...contact, account: alias })));
    }

    if (contacts.length === 0) {
      return {
        requestId,
        reply: explicitAccount
          ? `Não encontrei contatos na conta Google ${explicitAccount} para a busca: ${query}.`
          : `Não encontrei contatos nas contas Google conectadas para a busca: ${query}.`,
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: buildGoogleContactsReply({
        query,
        contacts,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "search_google_contacts",
          resultPreview: JSON.stringify(
            {
              query,
              total: contacts.length,
              account: explicitAccount ?? "all",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectGoogleCalendarsList(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGoogleCalendarsListPrompt(userPrompt)) {
      return null;
    }

    const preferences = this.preferences.get();
    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const candidateAliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();

    requestLogger.info("Using direct Google calendars list route", {
      account: explicitAccount ?? "all",
    });

    const calendarsByAccount: Array<{ account: string; calendars: CalendarListSummary[] }> = [];
    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      let calendars: CalendarListSummary[];
      try {
        calendars = await workspace.listCalendars();
      } catch (error) {
        requestLogger.warn("Falling back to configured calendars list", {
          account: alias,
          error: error instanceof Error ? error.message : String(error),
        });
        calendars = workspace.listConfiguredCalendars();
      }
      calendarsByAccount.push({
        account: alias,
        calendars,
      });
    }

    if (calendarsByAccount.length === 0 || calendarsByAccount.every((item) => item.calendars.length === 0)) {
      return {
        requestId,
        reply: explicitAccount
          ? `Não encontrei calendários disponíveis na conta Google ${explicitAccount}.`
          : "Não encontrei calendários disponíveis nas contas Google conectadas.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: buildGoogleCalendarsReply({
        calendars: calendarsByAccount,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "list_google_calendars",
          resultPreview: JSON.stringify(
            calendarsByAccount.map((item) => ({
              account: item.account,
              total: item.calendars.length,
            })),
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectPlaceLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isPlaceLookupPrompt(userPrompt)) {
      return null;
    }

    const query = extractPlaceLookupQuery(userPrompt);
    if (!query) {
      return {
        requestId,
        reply: "Diga qual lugar devo localizar no Google Maps.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const status = this.googleMaps.getStatus();
    if (!status.ready) {
      return null;
    }

    const result = await this.googleMaps.lookupPlace(query);
    if (!result) {
      return null;
    }

    requestLogger.info("Using direct Google Maps place lookup route", {
      query,
      source: result.source,
      placeId: result.placeId,
    });

    return {
      requestId,
      reply: buildPlaceLookupReply(result),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "google_maps_lookup",
          resultPreview: JSON.stringify(result, null, 2).slice(0, 240),
        },
      ],
    };
  }

  private resolveWhatsAppTarget(prompt: string): {
    number?: string;
    displayName?: string;
    remoteJid?: string;
    relationship?: ContactRelationship;
    persona?: ContactPersona;
  } {
    const directNumber = normalizePhoneDigits(extractPhoneFromText(prompt));
    const targetReference = extractWhatsAppTargetReference(prompt);

    if (directNumber) {
      return {
        number: directNumber,
        displayName: targetReference,
        remoteJid: `${directNumber}@s.whatsapp.net`,
      };
    }

    if (!targetReference) {
      return {};
    }

    const candidates = this.contacts.searchContacts(targetReference, 6);
    const exactDisplay = candidates.find((item) =>
      normalizeAliasToken(item.displayName ?? "") === normalizeAliasToken(targetReference),
    );
    const whatsappCandidate = [exactDisplay, ...candidates].find((item) => {
      if (!item) {
        return false;
      }
      if (item.channel === "whatsapp" && normalizePhoneDigits(item.identifier)) {
        return true;
      }
      return Boolean(normalizePhoneDigits(item.identifier));
    });

    const number = normalizePhoneDigits(whatsappCandidate?.identifier);
    if (!number) {
      const recentWhatsAppContacts = this.whatsappMessages.searchContacts(targetReference, 6);
      const exactRecent = recentWhatsAppContacts.find((item) =>
        normalizeAliasToken(item.pushName ?? "") === normalizeAliasToken(targetReference),
      );
      const fallbackRecent = exactRecent ?? recentWhatsAppContacts[0];
      const fallbackNumber = normalizePhoneDigits(fallbackRecent?.number ?? undefined);

      if (!fallbackNumber) {
        return {
          displayName: targetReference,
        };
      }

      return {
        number: fallbackNumber,
        displayName: fallbackRecent?.pushName ?? targetReference,
        remoteJid: fallbackRecent?.remoteJid ?? `${fallbackNumber}@s.whatsapp.net`,
      };
    }

    return {
      number,
      displayName: whatsappCandidate?.displayName ?? targetReference,
      remoteJid: `${number}@s.whatsapp.net`,
      relationship: whatsappCandidate?.relationship,
      persona: whatsappCandidate?.persona,
    };
  }

  private async tryRunDirectWhatsAppSend(
    activeUserPrompt: string,
    fullPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const recentSendPrompt = findRecentWhatsAppSendPrompt(fullPrompt);
    const currentHasPhone = Boolean(normalizePhoneDigits(extractPhoneFromText(activeUserPrompt)));
    const currentHasExplicitBody = Boolean(extractWhatsAppMessageBody(activeUserPrompt));
    const currentLooksLikeBodyFollowUp =
      Boolean(recentSendPrompt) &&
      !currentHasPhone &&
      !currentHasExplicitBody &&
      isLikelyWhatsAppBodyFollowUp(activeUserPrompt);
    const isFollowUpForRecentSend =
      !isWhatsAppSendPrompt(activeUserPrompt) &&
      Boolean(recentSendPrompt) &&
      (currentHasPhone || currentHasExplicitBody || currentLooksLikeBodyFollowUp);

    if (!isWhatsAppSendPrompt(activeUserPrompt) && !isFollowUpForRecentSend) {
      return null;
    }

    const whatsappStatus = this.config.whatsapp.enabled;
    if (!whatsappStatus) {
      return {
        requestId,
        reply: "O WhatsApp do Atlas não está habilitado neste ambiente.",
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const baseTargetPrompt =
      currentHasPhone || extractWhatsAppTargetReference(activeUserPrompt)
        ? activeUserPrompt
        : recentSendPrompt ?? activeUserPrompt;
    const target = this.resolveWhatsAppTarget(baseTargetPrompt);
    const body = extractWhatsAppMessageBody(activeUserPrompt) ?? (currentLooksLikeBodyFollowUp ? activeUserPrompt.trim() : undefined);

    if (!target.number && target.displayName) {
      return {
        requestId,
        reply: [
          `Não encontrei o número de WhatsApp de ${target.displayName}.`,
          "Responda em uma linha neste formato: `+55... | sua mensagem`.",
        ].join("\n"),
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (!target.number) {
      return {
        requestId,
        reply: "Para enviar no WhatsApp, me passe em uma linha: `+55... | sua mensagem`.",
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (!body) {
      return {
        requestId,
        reply: [
          `Tenho o destino: ${target.displayName ?? target.number} (${target.number}).`,
          "Agora me diga o texto em uma linha, por exemplo: `Olá, bom dia.`",
        ].join("\n"),
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const whatsappRoutingContext = [recentSendPrompt, baseTargetPrompt, activeUserPrompt]
      .filter(Boolean)
      .join("\n");
    const accountAlias = resolveWhatsAppAccountAlias(this.config.whatsapp, {
      text: whatsappRoutingContext,
      fallback: "primary",
    });
    const route = describeWhatsAppRoute(this.config.whatsapp, {
      accountAlias,
      text: whatsappRoutingContext,
    });
    if (!route.instanceName) {
      return {
        requestId,
        reply: [
          `Não encontrei uma instância de WhatsApp configurada para a conta ${accountAlias}.`,
          "Defina `WHATSAPP_INSTANCE_ACCOUNTS` para mapear a instância correta antes de enviar.",
        ].join("\n"),
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const marker = buildWhatsAppDraftMarker({
      instanceName: route.instanceName,
      account: route.accountAlias,
      remoteJid: target.remoteJid ?? `${target.number}@s.whatsapp.net`,
      number: target.number,
      pushName: target.displayName,
      inboundText: "",
      replyText: body,
      relationship: target.relationship,
      persona: target.persona,
    });

    return {
      requestId,
      reply: buildWhatsAppDirectDraftReply({
        nameOrNumber: target.displayName ?? target.number,
        number: target.number,
        text: body,
        account: route.accountAlias,
        instanceName: route.instanceName,
        marker,
      }),
      messages: buildBaseMessages(activeUserPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectWhatsAppRecentSearch(
    activeUserPrompt: string,
    fullPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isWhatsAppRecentSearchPrompt(activeUserPrompt)) {
      return null;
    }

    if (!this.config.whatsapp.enabled) {
      return {
        requestId,
        reply: "O WhatsApp do Atlas não está habilitado neste ambiente.",
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const query = extractWhatsAppSearchQuery(activeUserPrompt, fullPrompt);
    if (!query) {
      return {
        requestId,
        reply: "Diga de quem devo procurar as mensagens recentes no WhatsApp.",
        messages: buildBaseMessages(activeUserPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const normalizedQuery = normalizeEmailAnalysisText(query);
    const route = describeWhatsAppRoute(this.config.whatsapp, {
      text: [activeUserPrompt, fullPrompt].join("\n"),
    });
    const isScopedAccountQuery = normalizedQuery === route.accountAlias || normalizedQuery === normalizeEmailAnalysisText(route.instanceName ?? "");
    if (isScopedAccountQuery && route.instanceName && this.config.whatsapp.enabled) {
      try {
        const whatsapp = new EvolutionApiClient(
          this.config.whatsapp,
          this.logger.child({ scope: "whatsapp-evolution" }),
        );
        const chats = await whatsapp.findChats(route.instanceName, 8);
        if (chats.length > 0) {
          return {
            requestId,
            reply: buildWhatsAppScopedRecentChatsReply(route.accountAlias, chats),
            messages: buildBaseMessages(activeUserPrompt, orchestration),
            toolExecutions: [],
          };
        }
      } catch (error) {
        this.logger.warn("WhatsApp recent chat fallback failed", {
          account: route.accountAlias,
          instanceName: route.instanceName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const messages = isScopedAccountQuery && route.instanceName
      ? this.whatsappMessages.listRecentByInstance(route.instanceName, 8)
      : this.whatsappMessages.searchRecent(query, 8);
    return {
      requestId,
      reply: this.responseOs.buildMessageHistoryReply({
        scopeLabel: isScopedAccountQuery && route.instanceName
          ? `WhatsApp ${route.accountAlias}`
          : `WhatsApp para ${query}`,
        items: messages.map((item) => ({
          when: new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(item.createdAt)),
          who: item.pushName ?? item.number ?? item.remoteJid,
          direction: item.direction === "inbound" ? "recebida" : "enviada",
          text: item.text,
        })),
        recommendedNextStep: messages[0]
          ? `Ler a última mensagem e decidir se o próximo passo é responder, acompanhar ou registrar contexto.`
          : undefined,
      }),
      messages: buildBaseMessages(activeUserPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectWhatsAppPendingApprovals(
    activeUserPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isWhatsAppPendingApprovalsPrompt(activeUserPrompt)) {
      return null;
    }

    const pending = this.approvals
      .listPendingAll(12)
      .filter((item) => item.actionKind === "whatsapp_reply");
    const rankedPending = rankApprovals(pending);

    return {
      requestId,
      reply: this.responseOs.buildApprovalReviewReply({
        scopeLabel: "WhatsApp",
        items: rankedPending.map((entry) => ({
          id: entry.item.id,
          subject: entry.item.subject,
          actionKind: entry.item.actionKind,
          createdAt: entry.item.createdAt,
        })),
        recommendedNextStep: rankedPending[0]
          ? `Decidir a resposta pendente de WhatsApp: ${rankedPending[0].item.subject}.`
          : undefined,
      }),
      messages: buildBaseMessages(activeUserPrompt, orchestration),
      toolExecutions: [],
    };
  }

  private async tryRunDirectInternalKnowledgeLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isInternalKnowledgePrompt(userPrompt)) {
      return null;
    }

    const query = extractInternalKnowledgeQuery(userPrompt);
    if (!query) {
      return null;
    }

    const alias = resolveKnowledgeAlias(query);
    requestLogger.info("Using direct internal knowledge route", {
      query,
      alias: alias?.id,
    });

    const localKnowledge = new LocalKnowledgeService(
      this.fileAccess,
      requestLogger.child({ scope: "local-knowledge" }),
    );
    const matches = await localKnowledge.search({
      query,
      alias,
      maxResults: 5,
    });

    return {
      requestId,
      reply: buildInternalKnowledgeReply({
        query,
        aliasLabel: alias?.label,
        matches,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "internal_search",
          resultPreview: JSON.stringify(
            {
              query,
              total: matches.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async executeDirectWebResearch(
    input: {
      userPrompt: string;
      query: string;
      requestId: string;
      requestLogger: Logger;
      orchestration: OrchestrationContext;
      researchMode: WebResearchMode;
    },
  ): Promise<AgentRunResult> {
    const {
      userPrompt,
      query,
      requestId,
      requestLogger,
      orchestration,
      researchMode,
    } = input;
    const alias = resolveKnowledgeAlias(query);
    const preferredDomains = inferPreferredDomains(query, alias);

    requestLogger.info("Using direct web research route", {
      query,
      mode: researchMode,
      alias: alias?.id,
      preferredDomains,
    });

    const service = new WebResearchService(requestLogger.child({ scope: "web-research" }));
    const results = await service.search({
      query,
      maxResults: maxResearchResultsForMode(researchMode),
      includePageExcerpt: isAddressLookupPrompt(userPrompt) || researchMode !== "quick",
      preferredDomains,
      seedQueries: alias?.webQueries,
      mode: researchMode,
    });

    const officialFallbackUrls = inferOfficialFallbackUrls(query, alias?.officialUrls);
    const hasPreferredWebResult = results.some((item) =>
      preferredDomains.some((domain) => item.sourceHost === domain || item.sourceHost.endsWith(`.${domain}`)),
    );
    const focusTerms = buildResearchFocusTerms(query, alias);
    const requestedFactTypes = extractRequestedResearchFactTypes(userPrompt);
    const synthesisProfile = inferResearchSynthesisProfile(userPrompt, query);

    let officialFallbackResults: Array<{
      title: string;
      url: string;
      sourceHost: string;
      excerpt?: string;
    }> = [];
    if (
      (results.length === 0 ||
        requestedFactTypes.length > 0 ||
        (alias && !hasPreferredWebResult)) &&
      officialFallbackUrls.length
    ) {
      officialFallbackResults = await fetchOfficialAliasSources(
        service,
        officialFallbackUrls,
        requestLogger.child({ scope: "official-alias-source" }),
        focusTerms,
        excerptBudgetForResearchMode(researchMode),
      );
    }

    const mergedResults = [...results];
    for (const item of officialFallbackResults) {
      const existingIndex = mergedResults.findIndex((existing) => existing.url === item.url);
      if (existingIndex === -1) {
        mergedResults.push({
          ...item,
          snippet: "",
          publishedAt: undefined,
          score: 220 + scoreFocusedExcerpt(item.excerpt, focusTerms),
        });
        continue;
      }

      const existing = mergedResults[existingIndex];
      mergedResults[existingIndex] = {
        ...existing,
        title: existing.title || item.title,
        sourceHost: existing.sourceHost || item.sourceHost,
        excerpt:
          (item.excerpt && item.excerpt.length > (existing.excerpt?.length ?? 0))
            ? item.excerpt
            : existing.excerpt,
        score: Math.max(existing.score ?? 0, 220 + scoreFocusedExcerpt(item.excerpt, focusTerms)),
      };
    }

    const sortedMergedResults = [...mergedResults].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

    const preferredWebResults = sortedMergedResults.filter((item) =>
      preferredDomains.some((domain) => item.sourceHost === domain || item.sourceHost.endsWith(`.${domain}`)),
    );
    const finalResults =
      preferredWebResults.length > 0
        ? preferredWebResults
        : alias && officialFallbackResults.length > 0
          ? officialFallbackResults.map((item) => ({
              ...item,
              snippet: "",
              publishedAt: undefined,
              score: 220 + scoreFocusedExcerpt(item.excerpt, focusTerms),
            }))
          : sortedMergedResults;

    if (requestedFactTypes.length > 0) {
      const factExtractors: Record<ResearchFactType, (text: string) => string | undefined> = {
        address: extractAddressFromText,
        phone: extractPhoneFromText,
        hours: extractHoursFromText,
        capacity: extractCapacityFromText,
      };

      const sourcePool = finalResults.map((item) => ({
        label: item.title || item.sourceHost,
        url: item.url,
        sourceHost: item.sourceHost,
        score: item.score ?? 0,
        text: `${item.snippet}\n${item.excerpt ?? ""}`,
      }));

      const bestFacts: Partial<Record<ResearchFactType, { value: string; label: string; url?: string; score: number }>> = {};
      for (const source of sourcePool) {
        for (const factType of requestedFactTypes) {
          const value = factExtractors[factType](source.text);
          if (!value) {
            continue;
          }

          const candidateScore = source.score + scoreFocusedExcerpt(source.text, focusTerms);
          const previous = bestFacts[factType];
          if (!previous || candidateScore > previous.score) {
            bestFacts[factType] = {
              value,
              label: source.label,
              url: source.url,
              score: candidateScore,
            };
          }
        }
      }

      if (Object.keys(bestFacts).length > 0) {
        const sources = Array.from(
          new Map(
            Object.values(bestFacts)
              .filter((item): item is { value: string; label: string; url?: string; score: number } => Boolean(item))
              .map((item) => [`${item.label}|${item.url ?? ""}`, { label: item.label, url: item.url }]),
          ).values(),
        );

        return {
          requestId,
          reply: buildDeterministicFactLookupReply({
            query,
            aliasLabel: alias?.label,
            facts: Object.fromEntries(
              Object.entries(bestFacts).map(([key, value]) => [key, value?.value]),
            ) as Partial<Record<ResearchFactType, string>>,
            requestedTypes: requestedFactTypes,
            sources,
          }),
          messages: buildBaseMessages(userPrompt, orchestration),
          toolExecutions: [
            {
              toolName: "web_search",
              resultPreview: JSON.stringify(
                {
                  query,
                  total: finalResults.length,
                  factTypes: requestedFactTypes,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    }

    const synthesizedReply = await this.synthesizeWebResearchReply({
      query,
      mode: researchMode,
      profile: synthesisProfile,
      aliasLabel: alias?.label,
      results: finalResults,
      service,
      logger: requestLogger.child({ scope: "web-research-synthesis" }),
    });

    return {
      requestId,
      reply: synthesizedReply ?? buildWebResearchReply({
        query,
        aliasLabel: alias?.label,
        results: finalResults,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "web_search",
          resultPreview: JSON.stringify(
              {
                query,
                mode: researchMode,
                total: finalResults.length,
              },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectWebResearch(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isWebResearchPrompt(userPrompt) && !isImplicitResearchPrompt(userPrompt)) {
      return null;
    }

    const query = extractWebResearchQuery(userPrompt);
    if (!query) {
      return null;
    }

    return this.executeDirectWebResearch({
      userPrompt,
      query,
      requestId,
      requestLogger,
      orchestration,
      researchMode: extractWebResearchMode(userPrompt),
    });
  }

  private async synthesizeWebResearchReply(input: {
    query: string;
    mode: WebResearchMode;
    profile: ResearchSynthesisProfile;
    aliasLabel?: string;
    results: Array<{
      title: string;
      url: string;
      sourceHost: string;
      snippet: string;
      excerpt?: string;
      publishedAt?: string;
    }>;
    service: WebResearchService;
    logger: Logger;
  }): Promise<string | null> {
    if (input.results.length === 0) {
      return null;
    }

    try {
      const enrichedSources = await Promise.all(
        input.results.slice(0, maxResearchResultsForMode(input.mode)).map(async (result, index) => {
          let excerpt = result.excerpt?.trim() || "";
          if (!excerpt) {
            try {
              excerpt = await input.service.fetchPageExcerpt(
                result.url,
                excerptBudgetForResearchMode(input.mode),
              );
            } catch {
              excerpt = result.snippet?.trim() || "";
            }
          }

          return {
            id: index + 1,
            title: result.title,
            url: result.url,
            sourceHost: result.sourceHost,
            publishedAt: result.publishedAt,
            content: (excerpt || result.snippet || "").slice(0, 2200),
          };
        }),
      );

      const sourceBlocks = enrichedSources
        .filter((item) => item.content.trim())
        .map((item) => {
          const facts = extractResearchFacts(item.content);
          return [
            `[${item.id}] ${item.title}`,
            `Fonte: ${item.sourceHost}`,
            `URL: ${item.url}`,
            ...(item.publishedAt ? [`Publicado: ${item.publishedAt}`] : []),
            ...(facts.length > 0 ? ["Fatos extraídos:", ...facts.map((fact) => `- ${fact}`)] : []),
            "Conteúdo:",
            item.content,
          ].join("\n");
        })
        .join("\n\n");

      const consolidatedFacts = new Map<string, number[]>();
      for (const item of enrichedSources) {
        for (const fact of extractResearchFacts(item.content)) {
          const existing = consolidatedFacts.get(fact) ?? [];
          existing.push(item.id);
          consolidatedFacts.set(fact, existing);
        }
      }

      const consolidatedFactLines = [...consolidatedFacts.entries()]
        .slice(0, 8)
        .map(([fact, sourceIds]) => `- ${fact} [${[...new Set(sourceIds)].join(", ")}]`);

      if (!sourceBlocks.trim()) {
        return null;
      }

      const modeInstructions =
        input.profile === "market"
          ? [
              "Entregue a resposta exatamente com estas seções em markdown: '## Mercado', '## Concorrentes', '## Sinais de demanda', '## Oportunidades', '## Riscos', '## Recomendação prática'.",
              "Em cada seção, use bullets curtos e concretos.",
              "Se uma seção não tiver evidência suficiente, diga isso explicitamente.",
              "Na seção '## Recomendação prática', termine com 3 ações priorizadas.",
            ]
          : input.mode === "quick"
          ? [
              "Entregue uma resposta curta e objetiva.",
              "Comece com a resposta direta em até 3 frases.",
              "Se necessário, use no máximo 3 bullets curtos.",
              "Use no máximo 4 fontes.",
              "Evite seções longas.",
            ]
          : input.mode === "deep"
            ? [
                "Entregue uma resposta mais profunda e analítica.",
                "Comece com a conclusão principal em 1 parágrafo.",
                "Depois organize em seções curtas e úteis, como '## Resumo', '## Evidências', '## Riscos ou oportunidades', '## Pontos em aberto'.",
                "Para pesquisas de mercado, concorrência ou tendências, destaque sinais concretos, oportunidades e limites da evidência.",
                "Use até 8 fontes, priorizando as mais fortes.",
              ]
            : [
                "Entregue uma resposta executiva.",
                "Comece com a resposta direta em 1 parágrafo.",
                "Depois use seções curtas somente se isso melhorar a clareza.",
                "Use até 6 fontes.",
              ];

      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é um sintetizador de pesquisa com fontes.",
              "Use somente as fontes fornecidas.",
              "Não invente fatos, números, horários, endereços ou contexto ausente.",
              "Se houver divergência ou incerteza, diga isso explicitamente.",
              "Se uma fonte trouxer uma seção 'Fatos extraídos', trate esses fatos como sinais prioritários daquela própria fonte.",
              "Se houver uma seção 'Fatos consolidados', priorize esses fatos na resposta inicial.",
              "Responda em pt-BR.",
              "Formato geral:",
              "1. Cite afirmações com referências inline no formato [1], [2].",
              "2. Termine com uma seção 'Fontes' listando [n] título - URL.",
              "3. Não mencione que você recebeu trechos ou contexto interno.",
              ...modeInstructions,
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Consulta: ${input.query}`,
              ...(input.aliasLabel ? [`Entidade reconhecida: ${input.aliasLabel}`] : []),
              ...(consolidatedFactLines.length > 0
                ? ["", "Fatos consolidados:", ...consolidatedFactLines]
                : []),
              "",
              "Fontes disponíveis:",
              sourceBlocks,
            ].join("\n"),
          },
        ],
      });

      const content = stripResearchReplyMarkdown(response.message.content ?? "");
      if (!content) {
        return null;
      }

      return content;
    } catch (error) {
      input.logger.warn("Research synthesis failed, using fallback reply", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async tryRunDirectWeather(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isWeatherPrompt(userPrompt)) {
      return null;
    }

    const location = extractWeatherLocation(userPrompt) ?? this.config.briefing.weatherLocation;

    requestLogger.info("Using direct weather route", {
      location,
    });

    const service = new WeatherService(requestLogger.child({ scope: "weather" }));
    const forecast = await service.getForecast({
      location,
      days: 3,
      timezone: this.config.google.defaultTimezone,
    });

    const reply = forecast
      ? buildWeatherReply(forecast)
      : `Não encontrei previsão do tempo confiável para: ${location}.`;

    return {
      requestId,
      reply,
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "get_weather_forecast",
          resultPreview: JSON.stringify(
            {
              location,
              found: Boolean(forecast),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectRevenueScoreboard(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isRevenueScoreboardPrompt(userPrompt)) {
      return null;
    }

    const referenceMonth = extractReferenceMonth(userPrompt);
    requestLogger.info("Using direct revenue scoreboard route", {
      referenceMonth,
    });
    const scoreboard = this.growthOps.getMonthlyScoreboard(referenceMonth);

    return {
      requestId,
      reply: buildRevenueScoreboardReply({
        referenceMonth: scoreboard.referenceMonth,
        totalProjected: scoreboard.totalProjected,
        totalWon: scoreboard.totalWon,
        totalReceived: scoreboard.totalReceived,
        recurringProjected: scoreboard.recurringProjected,
        recurringReceived: scoreboard.recurringReceived,
        oneOffReceived: scoreboard.oneOffReceived,
        pipelineOpenValue: scoreboard.pipelineOpenValue,
        leadsByStatus: scoreboard.leadsByStatus,
        upcomingFollowUps: scoreboard.upcomingFollowUps.map((lead) => ({
          name: lead.name,
          company: lead.company,
          status: lead.status,
          nextFollowUpAt: lead.nextFollowUpAt,
        })),
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "monthly_revenue_scoreboard",
          resultPreview: JSON.stringify(
            {
              referenceMonth: scoreboard.referenceMonth,
              totalProjected: scoreboard.totalProjected,
              totalReceived: scoreboard.totalReceived,
              pipelineOpenValue: scoreboard.pipelineOpenValue,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectAllowedSpaces(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isAllowedSpacesPrompt(userPrompt)) {
      return null;
    }

    const roots = this.fileAccess.describeReadableRoots();
    return {
      requestId,
      reply: buildAllowedSpacesReply(roots),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_allowed_spaces",
          resultPreview: JSON.stringify(roots, null, 2),
        },
      ],
    };
  }

  private async tryRunDirectProjectScan(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isProjectScanPrompt(userPrompt)) {
      return null;
    }

    if (!orchestration.policy.capabilities.canRunProjectTools) {
      return {
        requestId,
        reply: "A politica atual do dominio nao permite analise de projeto nesta solicitacao.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const root = extractProjectRoot(userPrompt);
    const projectPath = extractProjectPath(userPrompt) ?? ".";
    requestLogger.info("Using direct project scan route", {
      root,
      projectPath,
    });

    const project = await this.projectOps.scanProject({
      root,
      path: projectPath,
    });
    const gitStatus =
      root === "workspace" || root === "authorized_projects" || root === "authorized_dev"
        ? await this.projectOps.getGitStatus(root, projectPath).catch(() => undefined)
        : undefined;

    return {
      requestId,
      reply: buildProjectScanReply(project, gitStatus),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "scan_project",
          resultPreview: JSON.stringify(
            {
              root,
              project_name: project.project_name,
              absolute_path: project.absolute_path,
            },
            null,
            2,
          ),
        },
        ...(gitStatus
          ? [
              {
                toolName: "project_git_status",
                resultPreview: JSON.stringify(
                  {
                    branch: gitStatus.branch,
                    dirty: gitStatus.dirty,
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
      ],
    };
  }

  private async tryRunDirectProjectMirror(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isMirrorProjectPrompt(userPrompt)) {
      return null;
    }

    if (!orchestration.policy.capabilities.canRunProjectTools) {
      return {
        requestId,
        reply: "A politica atual do dominio nao permite preparar espelhos de projeto nesta solicitacao.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const root = extractMirrorSourceRoot(userPrompt);
    const projectPath = extractProjectPath(userPrompt) ?? ".";
    const targetPath = extractMirrorTargetPath(userPrompt);
    requestLogger.info("Using direct project mirror route", {
      root,
      projectPath,
      targetPath,
    });

    let result: Record<string, unknown>;
    try {
      const execution = await this.executeToolDirect("mirror_project_to_workspace", {
        root,
        path: projectPath,
        ...(targetPath ? { target_path: targetPath } : {}),
        clean: true,
      });
      result = execution.rawResult as Record<string, unknown>;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        requestId,
        reply: [
          "Nao consegui criar o espelho do projeto.",
          `- Root: ${root}`,
          `- Caminho: ${projectPath}`,
          `- Motivo: ${errorMessage}`,
        ].join("\n"),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [
          {
            toolName: "mirror_project_to_workspace",
            resultPreview: JSON.stringify(
              {
                root,
                projectPath,
                error: errorMessage,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      requestId,
      reply: [
        "Espelho criado no workspace.",
        `- Origem: ${String(result.source_absolute_path ?? result.source_path ?? "")}`,
        `- Destino: ${String(result.target_absolute_path ?? result.target_path ?? "")}`,
        "- Pastas pesadas ou geradas foram excluidas do espelho: .git, node_modules, dist, build, .next, .turbo, .wrangler, coverage.",
      ].join("\n"),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "mirror_project_to_workspace",
          resultPreview: JSON.stringify(
            {
              root,
              source_path: result.source_path,
              target_path: result.target_path,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentOverview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentOverviewPrompt(userPrompt)) {
      return null;
    }

    const limit = extractPromptLimit(userPrompt, 10, 30);
    const platform = extractContentPlatform(userPrompt) as
      | "instagram"
      | "tiktok"
      | "youtube"
      | "shorts"
      | "reels"
      | "linkedin"
      | "blog"
      | "email"
      | "telegram"
      | undefined;
    const channelKey = extractContentChannelKey(userPrompt);
    requestLogger.info("Using direct content overview route", {
      limit,
      platform,
      channelKey,
    });

    const items = this.contentOps.listItems({
      platform,
      channelKey,
      limit,
    });

    return {
      requestId,
      reply: buildContentOverviewReply(items),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_items",
          resultPreview: JSON.stringify(
            {
              total: items.length,
              platform,
              channelKey,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentChannels(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentChannelsPrompt(userPrompt)) {
      return null;
    }

    const limit = extractPromptLimit(userPrompt, 10, 30);
    const platform = extractContentPlatform(userPrompt);
    requestLogger.info("Using direct content channels route", {
      limit,
      platform,
    });

    const channels = this.contentOps.listChannels({
      platform,
      limit,
    });

    return {
      requestId,
      reply: buildContentChannelsReply(channels),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_channels",
          resultPreview: JSON.stringify(
            {
              total: channels.length,
              platform,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentIdeaGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentIdeaGenerationPrompt(userPrompt)) {
      return null;
    }

    const channelKey = inferDefaultContentChannelKey(userPrompt);
    const requestedPlatform = extractContentPlatform(userPrompt);
    const seed = extractContentIdeaSeed(userPrompt);
    const limit = extractPromptLimit(userPrompt, 8, 20);
    const channels = this.contentOps.listChannels({ limit: 20 });
    const channel = channels.find((item) => item.key === channelKey)
      ?? channels.find((item) => item.platform === requestedPlatform)
      ?? channels[0];

    if (!channel) {
      return {
        requestId,
        reply: "Nao encontrei nenhum canal editorial configurado para gerar pautas.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const formats = this.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const hooks = this.contentOps.listHookTemplates({ limit: 20 });
    const series = this.contentOps.listSeries({ channelKey: channel.key, limit: 20 });

    requestLogger.info("Using direct content idea generation route", {
      channelKey: channel.key,
      platform: channel.platform,
      limit,
      seed,
    });

    const fallbackIdeas = buildFallbackEditorialIdeas({
      channelName: channel.name,
      seed,
      formatKeys: formats.map((item) => item.key),
      seriesKeys: series.map((item) => item.key),
      limit,
    }).map((idea) => ({
      ...idea,
      audience: channel.persona ?? idea.audience,
    }));

    type GeneratedIdea = {
      title: string;
      hook?: string;
      pillar?: string;
      audience?: string;
      formatTemplateKey?: string;
      seriesKey?: string | null;
      notes?: string;
    };

    let generatedIdeas: GeneratedIdea[] = fallbackIdeas;
    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o editor-chefe do Atlas para short-form content.",
              "Responda somente JSON válido.",
              "Formato: um array chamado ideas.",
              "Cada item deve ter: title, hook, pillar, audience, formatTemplateKey, seriesKey, notes.",
              "Não repita ideias.",
              "Faça ideias com potencial de retenção e série.",
              "Se não houver série adequada, use null em seriesKey.",
              "Use somente formatTemplateKey e seriesKey existentes no contexto.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Channel key: ${channel.key}`,
              `Plataforma: ${channel.platform}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              `Estilo: ${channel.styleNotes ?? ""}`,
              `Idioma: ${channel.language ?? "pt-BR"}`,
              `Quantidade: ${limit}`,
              `Seed opcional: ${seed ?? "nenhuma"}`,
              "",
              "Formatos disponíveis:",
              ...formats.map((item) => `- ${item.key}: ${item.label} | ${item.structure}`),
              "",
              "Séries disponíveis:",
              ...(series.length > 0
                ? series.map((item) => `- ${item.key}: ${item.title} | ${item.premise ?? ""}`)
                : ["- nenhuma série específica"]),
              "",
              "Hooks de referência:",
              ...hooks.slice(0, 8).map((item) => `- ${item.label}: ${item.template}`),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as
        | { ideas?: GeneratedIdea[]; items?: GeneratedIdea[] }
        | GeneratedIdea[];
      const rawIdeas = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.ideas)
          ? parsed.ideas
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];
      if (rawIdeas.length > 0) {
        generatedIdeas = rawIdeas
          .filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
          .slice(0, limit);
      }
    } catch (error) {
      requestLogger.warn("Content idea generation fell back to deterministic ideas", {
        channelKey: channel.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const savedItems = generatedIdeas.map((idea) =>
      this.contentOps.createItem({
        title: idea.title,
        platform: channel.platform === "youtube" ? "youtube" : channel.platform,
        format: "short_video",
        status: "idea",
        pillar: idea.pillar,
        audience: idea.audience,
        hook: idea.hook,
        notes: idea.notes,
        channelKey: channel.key,
        seriesKey: idea.seriesKey ?? undefined,
        formatTemplateKey: idea.formatTemplateKey ?? undefined,
      })
    );

    return {
      requestId,
      reply: buildContentIdeaGenerationReply(savedItems),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "save_content_item",
          resultPreview: JSON.stringify(
            {
              total: savedItems.length,
              channelKey: channel.key,
              platform: channel.platform,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectDailyEditorialResearch(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isDailyEditorialResearchPrompt(userPrompt)) {
      return null;
    }

    const channelKey = inferDefaultContentChannelKey(userPrompt);
    requestLogger.info("Using direct daily editorial research route", {
      channelKey,
    });

    const result = await this.runDailyEditorialResearch({
      channelKey,
      timezone: this.config.google.defaultTimezone,
      trendsLimit: 10,
      ideasLimit: 5,
    });

    return {
      requestId,
      reply: result.reply,
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "daily_editorial_research",
          resultPreview: JSON.stringify(
            {
              channelKey,
              runDate: result.runDate,
              createdItemIds: result.createdItemIds,
              skipped: result.skipped,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentReviewPrompt(userPrompt)) {
      return null;
    }

    const requestedItemId = extractContentItemId(userPrompt);
    const requestedOrdinal = extractContentQueueOrdinal(userPrompt);
    if (!requestedItemId && !requestedOrdinal) {
      return {
        requestId,
        reply: "Diga qual item editorial devo revisar, por exemplo: `aprove o item #12` ou `aprove o primeiro item`.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const normalized = normalizeEmailAnalysisText(userPrompt);
    const action: "approved" | "rejected" = includesAny(normalized, ["reprovar", "reprove"]) ? "rejected" : "approved";
    const reason = extractContentReviewReason(userPrompt);
    const now = new Date().toISOString();
    const channelKey = extractContentChannelKey(userPrompt) ?? inferDefaultContentChannelKey(userPrompt);
    const queueItems = this.contentOps.listItems({
      channelKey,
      limit: 20,
    });
    let resolvedItemId = requestedItemId;
    if (requestedOrdinal && requestedOrdinal >= 1 && requestedOrdinal <= queueItems.length) {
      resolvedItemId = queueItems[requestedOrdinal - 1]?.id;
    }
    const directItem = requestedItemId ? this.contentOps.getItemById(requestedItemId) : null;
    if (!directItem && !resolvedItemId) {
      return {
        requestId,
        reply: buildContentReviewNotFoundReply({
          requestedId: requestedItemId ?? requestedOrdinal ?? 0,
          channelKey,
          queue: queueItems.map((item) => ({ id: item.id, title: item.title })),
        }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    if (directItem) {
      resolvedItemId = directItem.id;
    }

    if (!resolvedItemId) {
      return {
        requestId,
        reply: buildContentReviewNotFoundReply({
          requestedId: requestedItemId ?? requestedOrdinal ?? 0,
          channelKey,
          queue: queueItems.map((item) => ({ id: item.id, title: item.title })),
        }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct content review route", {
      requestedItemId,
      resolvedItemId,
      requestedOrdinal,
      action,
    });

    const item = this.contentOps.updateItem({
      id: resolvedItemId,
      status: action === "approved" ? "draft" : "archived",
      reviewFeedbackCategory: action === "rejected" ? classifyContentReviewFeedback(reason) ?? "reprovado_manual" : null,
      reviewFeedbackReason: action === "rejected" ? reason ?? "reprovado sem motivo detalhado" : null,
      lastReviewedAt: now,
    });

    return {
      requestId,
      reply: buildContentReviewReply({
        action,
        item,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "update_content_item",
          resultPreview: JSON.stringify(
            {
              id: item.id,
              status: item.status,
              reviewFeedbackCategory: item.reviewFeedbackCategory,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentScriptGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentScriptGenerationPrompt(userPrompt)) {
      return null;
    }

    const requestedItemId = extractContentItemId(userPrompt);
    const requestedOrdinal = extractContentQueueOrdinal(userPrompt);
    const channelKey = extractContentChannelKey(userPrompt) ?? inferDefaultContentChannelKey(userPrompt);
    const queueItems = this.contentOps.listItems({
      channelKey,
      limit: 20,
    });

    let item = requestedItemId ? this.contentOps.getItemById(requestedItemId) : null;
    if (!item && requestedOrdinal && requestedOrdinal >= 1 && requestedOrdinal <= queueItems.length) {
      item = queueItems[requestedOrdinal - 1] ?? null;
    }

    if (!item) {
      return {
        requestId,
        reply: buildContentReviewNotFoundReply({
          requestedId: requestedItemId ?? requestedOrdinal ?? 0,
          channelKey,
          queue: queueItems.map((entry) => ({ id: entry.id, title: entry.title })),
        }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct content script generation route", {
      itemId: item.id,
      channelKey: item.channelKey,
    });

    const formatTemplates = this.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const formatTemplate = formatTemplates.find((entry) => entry.key === item.formatTemplateKey);
    const series = item.seriesKey
      ? this.contentOps.listSeries({ channelKey: item.channelKey ?? undefined, limit: 20 }).find((entry) => entry.key === item.seriesKey)
      : undefined;

    const manualPayload = buildManualShortFormPackage({
      item,
      platform: item.platform,
    });
    const fallbackPayload = manualPayload ?? buildShortFormFallbackPackage({
      item,
      platform: item.platform,
    });

    let payload = { ...fallbackPayload };

    if (!manualPayload) {
      try {
        const response = await this.client.chat({
          messages: [
            {
              role: "system",
              content: [
                "Você é roteirista de short-form content para o canal Riqueza Despertada.",
                "Sua tarefa é gerar um short com retenção forte para YouTube Shorts e TikTok.",
                "O Atlas não cria vídeos; o Atlas cria retenção.",
                "Responda somente JSON válido.",
                "Formato: styleMode, mode, targetDurationSeconds, hook, script, cta, description, titleOptions, scenes, platformVariants.",
                "styleMode deve ser um destes: operator, motivational, emotional, contrarian.",
                "mode deve ser viral_short.",
                "targetDurationSeconds entre 22 e 32.",
                "titleOptions deve ser array com 3 títulos curtos.",
                "Crie cenas curtas com os campos order, durationSeconds, voiceover, overlay, visualDirection, assetSearchQuery.",
                "assetSearchQuery deve ser uma busca curta em inglês, de 2 a 5 palavras, boa para achar b-roll em banco de vídeo.",
                "O canal é dark/faceless: assetSearchQuery deve priorizar dashboard, laptop, hands, UI, app interface, small business, money desk e phone UI.",
                "Nunca use termos como presenter, speaker, host, selfie, portrait, face, webcam, person talking, business meeting, corporate office, whiteboard, presentation, generic laptop typing ou stock office smiling.",
                "Cada vídeo deve ter UMA ideia central. Sem lista longa, sem densidade excessiva, sem jargão demais.",
                "O hook precisa abrir tensão real em até 2 segundos.",
                "Overlay principal com no máximo 4 palavras. Texto punch, não frase corporativa.",
                "Cenas genéricas ou intercambiáveis com qualquer canal financeiro devem ser rejeitadas.",
                "O CTA deve ser curto. Não invente link, checklist ou oferta que ainda não existem.",
                "Mantenha tom pragmático, sem promessa milagrosa.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Título atual: ${item.title}`,
                `Plataforma: ${item.platform}`,
                `Pilar: ${item.pillar ?? ""}`,
                `Audience: ${item.audience ?? ""}`,
                `Hook atual: ${item.hook ?? ""}`,
                `Notas: ${item.notes ?? ""}`,
                `Formato editorial: ${formatTemplate ? `${formatTemplate.label} | ${formatTemplate.structure}` : item.formatTemplateKey ?? ""}`,
                `Série: ${series ? `${series.title} | ${series.premise ?? ""}` : item.seriesKey ?? ""}`,
                `Plataforma principal: ${item.platform}`,
                "Objetivo: retenção forte, clareza, 1 mecanismo central, alto potencial de replay e comentário.",
              ].join("\n"),
            },
          ],
        });

        const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as {
          styleMode?: ShortStyleMode;
          mode?: string;
          targetDurationSeconds?: number;
          hook?: string;
          script?: string;
          cta?: string;
          description?: string;
          titleOptions?: string[];
          scenes?: ShortScenePlan[];
          platformVariants?: Partial<ShortPlatformVariants>;
        };

        payload = {
          styleMode: normalizeShortStyleMode(parsed.styleMode, payload.styleMode),
          mode: parsed.mode === "viral_short" ? parsed.mode : payload.mode,
          targetDurationSeconds: clampShortTargetDuration(parsed.targetDurationSeconds, payload.targetDurationSeconds),
          hook: typeof parsed.hook === "string" && parsed.hook.trim() ? parsed.hook.trim() : payload.hook,
          script: typeof parsed.script === "string" && parsed.script.trim() ? parsed.script.trim() : payload.script,
          cta: typeof parsed.cta === "string" && parsed.cta.trim() ? parsed.cta.trim() : payload.cta,
          description:
            typeof parsed.description === "string" && parsed.description.trim()
              ? parsed.description.trim()
              : payload.description,
          titleOptions: Array.isArray(parsed.titleOptions) && parsed.titleOptions.length > 0
            ? parsed.titleOptions.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 3)
            : payload.titleOptions,
          scenes: normalizeScenePlan(parsed.scenes, payload.scenes),
          platformVariants: {
            youtubeShort: {
              title:
                typeof parsed.platformVariants?.youtubeShort?.title === "string" && parsed.platformVariants.youtubeShort.title.trim()
                  ? parsed.platformVariants.youtubeShort.title.trim()
                  : payload.platformVariants.youtubeShort.title,
              caption:
                typeof parsed.platformVariants?.youtubeShort?.caption === "string" && parsed.platformVariants.youtubeShort.caption.trim()
                  ? parsed.platformVariants.youtubeShort.caption.trim()
                  : payload.platformVariants.youtubeShort.caption,
              coverText:
                typeof parsed.platformVariants?.youtubeShort?.coverText === "string" && parsed.platformVariants.youtubeShort.coverText.trim()
                  ? parsed.platformVariants.youtubeShort.coverText.trim()
                  : payload.platformVariants.youtubeShort.coverText,
            },
            tiktok: {
              hook:
                typeof parsed.platformVariants?.tiktok?.hook === "string" && parsed.platformVariants.tiktok.hook.trim()
                  ? parsed.platformVariants.tiktok.hook.trim()
                  : payload.platformVariants.tiktok.hook,
              caption:
                typeof parsed.platformVariants?.tiktok?.caption === "string" && parsed.platformVariants.tiktok.caption.trim()
                  ? parsed.platformVariants.tiktok.caption.trim()
                  : payload.platformVariants.tiktok.caption,
              coverText:
                typeof parsed.platformVariants?.tiktok?.coverText === "string" && parsed.platformVariants.tiktok.coverText.trim()
                  ? parsed.platformVariants.tiktok.coverText.trim()
                  : payload.platformVariants.tiktok.coverText,
            },
          },
        };
      } catch (error) {
        requestLogger.warn("Content script generation fell back to deterministic package", {
          itemId: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      requestLogger.info("Using manual short script package", {
        itemId: item.id,
        scenes: manualPayload.scenes.length,
      });
    }

    payload = validateShortFormPackage(payload, fallbackPayload, {
      title: item.title,
      pillar: item.pillar,
      hook: item.hook,
      formatTemplateKey: item.formatTemplateKey,
      seriesKey: item.seriesKey,
      notes: item.notes,
    });

    const sceneAssets = await resolveSceneAssets(
      this.pexelsMedia,
      payload.scenes,
      this.config.media.pexelsMaxScenesPerRequest,
    );
    const productionPack = buildShortProductionPack(payload.styleMode, payload.scenes, sceneAssets);
    const distributionPlan = buildDistributionPlan({
      item,
      channelKey: item.channelKey ?? channelKey,
      orderOffset: 0,
    });

    const scriptPackage = [
      "SHORT_PACKAGE_V3",
      `style_mode: ${payload.styleMode}`,
      `mode: ${payload.mode}`,
      `target_duration_seconds: ${payload.targetDurationSeconds}`,
      `hook: ${payload.hook}`,
      `cta: ${payload.cta}`,
      "",
      "title_options:",
      ...payload.titleOptions.map((title, index) => `${index + 1}. ${title}`),
      "",
      "scene_plan:",
      ...payload.scenes.map((scene) =>
        `${scene.order}. ${scene.durationSeconds}s | VO=${scene.voiceover} | overlay=${scene.overlay} | visual=${scene.visualDirection} | search=${scene.assetSearchQuery}`,
      ),
      "",
      "scene_meta:",
      ...payload.scenes.map((scene) =>
        `scene_${scene.order}.meta: narrative=${scene.narrativeFunction ?? "mechanism"} | purpose=${scene.scenePurpose ?? "mostrar ação ou prova"} | highlights=${(scene.overlayHighlightWords ?? []).join(", ")} | emotional=${scene.emotionalTrigger ?? "curiosity"} | proof=${scene.proofType ?? "none"} | env=${scene.visualEnvironment ?? "workspace"} | action=${scene.visualAction ?? "mostrar contexto real"} | camera=${scene.visualCamera ?? "over_shoulder"} | pacing=${scene.visualPacing ?? "steady"} | provider=${scene.assetProviderHint ?? "pexels"} | fallback_search=${scene.assetFallbackQuery ?? scene.assetSearchQuery} | forbidden=${(scene.forbiddenVisuals ?? []).join(", ")} | retention=${scene.retentionDriver ?? "specific_mechanism"}`,
      ),
      "",
      "scene_assets:",
      ...(sceneAssets.length > 0
        ? sceneAssets.flatMap((scene) => [
            `scene_${scene.order}.query: ${scene.searchQuery}`,
            ...scene.suggestions.slice(0, 2).map((asset, index) => `scene_${scene.order}.asset_${index + 1}: ${asset.videoUrl ?? asset.pageUrl}`),
          ])
        : ["scene_assets: no_api_results"]),
      "",
      "production_pack:",
      `voice_style: ${productionPack.voiceStyle}`,
      `edit_rhythm: ${productionPack.editRhythm}`,
      `subtitle_style: ${productionPack.subtitleStyle}`,
      ...productionPack.scenes.map((scene) =>
        `scene_${scene.order}.edit: subtitle=${scene.subtitleLine} | emphasis=${scene.emphasisWords.join(", ")} | instruction=${scene.editInstruction}${scene.selectedAsset ? ` | selected_asset=${scene.selectedAsset}` : ""}`,
      ),
      "",
      "distribution_plan:",
      `primary_platform: ${distributionPlan.primaryPlatform}`,
      `secondary_platform: ${distributionPlan.secondaryPlatform}`,
      `recommended_window: ${distributionPlan.recommendedWindow}`,
      `secondary_window: ${distributionPlan.secondaryWindow}`,
      `hypothesis: ${distributionPlan.hypothesis}`,
      `rationale: ${distributionPlan.rationale}`,
      "",
      "platform_variants:",
      `youtube_short.title: ${payload.platformVariants.youtubeShort.title}`,
      `youtube_short.cover_text: ${payload.platformVariants.youtubeShort.coverText}`,
      `youtube_short.caption: ${payload.platformVariants.youtubeShort.caption}`,
      `tiktok.hook: ${payload.platformVariants.tiktok.hook}`,
      `tiktok.cover_text: ${payload.platformVariants.tiktok.coverText}`,
      `tiktok.caption: ${payload.platformVariants.tiktok.caption}`,
      "",
      "script:",
      payload.script,
      "",
      "description:",
      payload.description,
      "",
      "quality_gate:",
      `score: ${payload.qualityAssessment?.score ?? 0}`,
      `passed: ${payload.qualityAssessment?.passed === true ? "true" : "false"}`,
      `reasons: ${(payload.qualityAssessment?.reasons ?? []).join(" | ")}`,
      "END_SHORT_PACKAGE_V3",
    ].join("\n");

    const updated = this.contentOps.updateItem({
      id: item.id,
      hook: payload.hook,
      callToAction: payload.cta,
      notes: item.notes ? `${item.notes}\n\n${scriptPackage}` : scriptPackage,
      status: "draft",
    });

    return {
      requestId,
      reply: buildContentScriptReply({
        item: updated,
        styleMode: payload.styleMode,
        mode: payload.mode,
        targetDurationSeconds: payload.targetDurationSeconds,
        headlineOptions: payload.titleOptions,
        script: payload.script,
        description: payload.description,
        scenes: payload.scenes,
        platformVariants: payload.platformVariants,
        sceneAssets,
        productionPack,
        distributionPlan,
        qualityAssessment: payload.qualityAssessment,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "update_content_item",
          resultPreview: JSON.stringify(
            {
              id: updated.id,
              status: updated.status,
              hasScriptPackage: true,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentBatchPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentBatchPlanningPrompt(userPrompt)) {
      return null;
    }

    const channelKey = extractContentChannelKey(userPrompt) ?? inferDefaultContentChannelKey(userPrompt);
    const limit = Math.min(10, extractPromptLimit(userPrompt, 5, 10));
    const items = this.contentOps
      .listItems({ channelKey, limit: 20 })
      .filter((item) => isRiquezaContentItemEligible(item))
      .filter((item) => item.status !== "archived" && item.status !== "published")
      .sort((left, right) => {
        const statusWeight = (value: string) => value === "draft" ? 0 : value === "idea" ? 1 : value === "scheduled" ? 2 : 3;
        return statusWeight(left.status) - statusWeight(right.status)
          || (right.queuePriority ?? right.ideaScore ?? 0) - (left.queuePriority ?? left.ideaScore ?? 0)
          || left.id - right.id;
      })
      .slice(0, limit);

    requestLogger.info("Using direct content batch planning route", {
      channelKey,
      limit,
      selected: items.length,
    });

    const batchItems = items.map((item, index) => {
      const distributionPlan = buildDistributionPlan({
        item,
        channelKey: item.channelKey ?? channelKey,
        orderOffset: index,
      });
      return {
        id: item.id,
        title: item.title,
        status: item.status,
        queuePriority: item.queuePriority,
        ideaScore: item.ideaScore,
        hasScriptPackage: hasSavedShortPackage(item.notes),
        recommendedWindow: distributionPlan.recommendedWindow,
        hypothesis: distributionPlan.hypothesis,
      };
    });

    return {
      requestId,
      reply: buildContentBatchReply({
        channelKey,
        items: batchItems,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_items",
          resultPreview: JSON.stringify(
            {
              channelKey,
              selected: batchItems.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentBatchGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentBatchGenerationPrompt(userPrompt)) {
      return null;
    }

    const channelKey = extractContentChannelKey(userPrompt) ?? inferDefaultContentChannelKey(userPrompt);
    const limit = Math.min(10, extractPromptLimit(userPrompt, 5, 10));
    const items = this.contentOps
      .listItems({ channelKey, limit: 20 })
      .filter((item) => isRiquezaContentItemEligible(item))
      .filter((item) => item.status !== "archived" && item.status !== "published")
      .sort((left, right) => {
        const statusWeight = (value: string) => value === "draft" ? 0 : value === "idea" ? 1 : value === "scheduled" ? 2 : 3;
        return statusWeight(left.status) - statusWeight(right.status)
          || (right.queuePriority ?? right.ideaScore ?? 0) - (left.queuePriority ?? left.ideaScore ?? 0)
          || left.id - right.id;
      })
      .slice(0, limit);

    requestLogger.info("Using direct content batch generation route", {
      channelKey,
      limit,
      selected: items.length,
    });

    if (items.length === 0) {
      return {
        requestId,
        reply: buildContentBatchGenerationReply({ channelKey, generated: [] }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const generated: Array<{
      id: number;
      title: string;
      status: string;
      recommendedWindow: string;
      hasAssets: boolean;
    }> = [];

    for (const [index, sourceItem] of items.entries()) {
      const item = this.contentOps.getItemById(sourceItem.id) ?? sourceItem;
      const formatTemplates = this.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
      const formatTemplate = formatTemplates.find((entry) => entry.key === item.formatTemplateKey);
      const series = item.seriesKey
        ? this.contentOps.listSeries({ channelKey: item.channelKey ?? undefined, limit: 20 }).find((entry) => entry.key === item.seriesKey)
        : undefined;

      const manualPayload = buildManualShortFormPackage({
        item,
        platform: item.platform,
      });
      const fallbackPayload = manualPayload ?? buildShortFormFallbackPackage({
        item,
        platform: item.platform,
      });

      let payload = { ...fallbackPayload };

      if (!manualPayload) {
        try {
        const response = await this.client.chat({
          messages: [
            {
              role: "system",
              content: [
                "Você é roteirista de short-form content para o canal Riqueza Despertada.",
                "Sua tarefa é gerar um short com retenção forte para YouTube Shorts e TikTok.",
                "O Atlas não cria vídeos; o Atlas cria retenção.",
                "Responda somente JSON válido.",
                "Formato: styleMode, mode, targetDurationSeconds, hook, script, cta, description, titleOptions, scenes, platformVariants.",
                "styleMode deve ser um destes: operator, motivational, emotional, contrarian.",
                "mode deve ser viral_short.",
                "targetDurationSeconds entre 22 e 32.",
                "titleOptions deve ser array com 3 títulos curtos.",
                "Crie cenas curtas com os campos order, durationSeconds, voiceover, overlay, visualDirection, assetSearchQuery.",
                "assetSearchQuery deve ser uma busca curta em inglês, de 2 a 5 palavras, boa para achar b-roll em banco de vídeo.",
                "O canal é dark/faceless: assetSearchQuery deve priorizar dashboard, laptop, hands, UI, app interface, small business, money desk e phone UI.",
                "Nunca use termos como presenter, speaker, host, selfie, portrait, face, webcam, person talking, business meeting, corporate office, whiteboard, presentation, generic laptop typing ou stock office smiling.",
                "Cada vídeo deve ter UMA ideia central. Sem lista longa, sem densidade excessiva, sem jargão demais.",
                "O hook precisa abrir tensão real em até 2 segundos.",
                "Overlay principal com no máximo 4 palavras. Texto punch, não frase corporativa.",
                "Cenas genéricas ou intercambiáveis com qualquer canal financeiro devem ser rejeitadas.",
                "O CTA deve ser curto. Não invente link, checklist ou oferta que ainda não existem.",
                "Mantenha tom pragmático, sem promessa milagrosa.",
              ].join(" "),
            },
            {
              role: "user",
              content: [
                `Título atual: ${item.title}`,
                `Plataforma: ${item.platform}`,
                `Pilar: ${item.pillar ?? ""}`,
                `Audience: ${item.audience ?? ""}`,
                `Hook atual: ${item.hook ?? ""}`,
                `Notas: ${item.notes ?? ""}`,
                `Formato editorial: ${formatTemplate ? `${formatTemplate.label} | ${formatTemplate.structure}` : item.formatTemplateKey ?? ""}`,
                `Série: ${series ? `${series.title} | ${series.premise ?? ""}` : item.seriesKey ?? ""}`,
                `Plataforma principal: ${item.platform}`,
                "Objetivo: retenção forte, clareza, 1 mecanismo central, alto potencial de replay e comentário.",
              ].join("\n"),
            },
          ],
        });

        const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as {
          styleMode?: ShortStyleMode;
          mode?: string;
          targetDurationSeconds?: number;
          hook?: string;
          script?: string;
          cta?: string;
          description?: string;
          titleOptions?: string[];
          scenes?: ShortScenePlan[];
          platformVariants?: Partial<ShortPlatformVariants>;
        };

        payload = {
          styleMode: normalizeShortStyleMode(parsed.styleMode, payload.styleMode),
          mode: parsed.mode === "viral_short" ? parsed.mode : payload.mode,
          targetDurationSeconds: clampShortTargetDuration(parsed.targetDurationSeconds, payload.targetDurationSeconds),
          hook: typeof parsed.hook === "string" && parsed.hook.trim() ? parsed.hook.trim() : payload.hook,
          script: typeof parsed.script === "string" && parsed.script.trim() ? parsed.script.trim() : payload.script,
          cta: typeof parsed.cta === "string" && parsed.cta.trim() ? parsed.cta.trim() : payload.cta,
          description:
            typeof parsed.description === "string" && parsed.description.trim()
              ? parsed.description.trim()
              : payload.description,
          titleOptions: Array.isArray(parsed.titleOptions) && parsed.titleOptions.length > 0
            ? parsed.titleOptions.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 3)
            : payload.titleOptions,
          scenes: normalizeScenePlan(parsed.scenes, payload.scenes),
          platformVariants: {
            youtubeShort: {
              title:
                typeof parsed.platformVariants?.youtubeShort?.title === "string" && parsed.platformVariants.youtubeShort.title.trim()
                  ? parsed.platformVariants.youtubeShort.title.trim()
                  : payload.platformVariants.youtubeShort.title,
              caption:
                typeof parsed.platformVariants?.youtubeShort?.caption === "string" && parsed.platformVariants.youtubeShort.caption.trim()
                  ? parsed.platformVariants.youtubeShort.caption.trim()
                  : payload.platformVariants.youtubeShort.caption,
              coverText:
                typeof parsed.platformVariants?.youtubeShort?.coverText === "string" && parsed.platformVariants.youtubeShort.coverText.trim()
                  ? parsed.platformVariants.youtubeShort.coverText.trim()
                  : payload.platformVariants.youtubeShort.coverText,
            },
            tiktok: {
              hook:
                typeof parsed.platformVariants?.tiktok?.hook === "string" && parsed.platformVariants.tiktok.hook.trim()
                  ? parsed.platformVariants.tiktok.hook.trim()
                  : payload.platformVariants.tiktok.hook,
              caption:
                typeof parsed.platformVariants?.tiktok?.caption === "string" && parsed.platformVariants.tiktok.caption.trim()
                  ? parsed.platformVariants.tiktok.caption.trim()
                  : payload.platformVariants.tiktok.caption,
              coverText:
                typeof parsed.platformVariants?.tiktok?.coverText === "string" && parsed.platformVariants.tiktok.coverText.trim()
                  ? parsed.platformVariants.tiktok.coverText.trim()
                  : payload.platformVariants.tiktok.coverText,
            },
          },
        };
        } catch (error) {
          requestLogger.warn("Content batch generation fell back to deterministic package", {
            itemId: item.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        requestLogger.info("Using manual short script package for batch generation", {
          itemId: item.id,
          scenes: manualPayload.scenes.length,
        });
      }

      payload = validateShortFormPackage(payload, fallbackPayload, {
        title: item.title,
        pillar: item.pillar,
        hook: item.hook,
        formatTemplateKey: item.formatTemplateKey,
        seriesKey: item.seriesKey,
        notes: item.notes,
      });
      const sceneAssets = await resolveSceneAssets(
        this.pexelsMedia,
        payload.scenes,
        this.config.media.pexelsMaxScenesPerRequest,
      );
      const productionPack = buildShortProductionPack(payload.styleMode, payload.scenes, sceneAssets);
      const distributionPlan = buildDistributionPlan({
        item,
        channelKey: item.channelKey ?? channelKey,
        orderOffset: index,
      });

      const scriptPackage = [
        "SHORT_PACKAGE_V3",
        `style_mode: ${payload.styleMode}`,
        `mode: ${payload.mode}`,
        `target_duration_seconds: ${payload.targetDurationSeconds}`,
        `hook: ${payload.hook}`,
        `cta: ${payload.cta}`,
        "",
        "title_options:",
        ...payload.titleOptions.map((title, titleIndex) => `${titleIndex + 1}. ${title}`),
        "",
        "scene_plan:",
        ...payload.scenes.map((scene) =>
          `${scene.order}. ${scene.durationSeconds}s | VO=${scene.voiceover} | overlay=${scene.overlay} | visual=${scene.visualDirection} | search=${scene.assetSearchQuery}`,
        ),
        "",
        "scene_meta:",
        ...payload.scenes.map((scene) =>
          `scene_${scene.order}.meta: narrative=${scene.narrativeFunction ?? "mechanism"} | purpose=${scene.scenePurpose ?? "mostrar ação ou prova"} | highlights=${(scene.overlayHighlightWords ?? []).join(", ")} | emotional=${scene.emotionalTrigger ?? "curiosity"} | proof=${scene.proofType ?? "none"} | env=${scene.visualEnvironment ?? "workspace"} | action=${scene.visualAction ?? "mostrar contexto real"} | camera=${scene.visualCamera ?? "over_shoulder"} | pacing=${scene.visualPacing ?? "steady"} | provider=${scene.assetProviderHint ?? "pexels"} | fallback_search=${scene.assetFallbackQuery ?? scene.assetSearchQuery} | forbidden=${(scene.forbiddenVisuals ?? []).join(", ")} | retention=${scene.retentionDriver ?? "specific_mechanism"}`,
        ),
        "",
        "scene_assets:",
        ...(sceneAssets.length > 0
          ? sceneAssets.flatMap((scene) => [
              `scene_${scene.order}.query: ${scene.searchQuery}`,
              ...scene.suggestions.slice(0, 2).map((asset, assetIndex) => `scene_${scene.order}.asset_${assetIndex + 1}: ${asset.videoUrl ?? asset.pageUrl}`),
            ])
          : ["scene_assets: no_api_results"]),
        "",
        "production_pack:",
        `voice_style: ${productionPack.voiceStyle}`,
        `edit_rhythm: ${productionPack.editRhythm}`,
        `subtitle_style: ${productionPack.subtitleStyle}`,
        ...productionPack.scenes.map((scene) =>
          `scene_${scene.order}.edit: subtitle=${scene.subtitleLine} | emphasis=${scene.emphasisWords.join(", ")} | instruction=${scene.editInstruction}${scene.selectedAsset ? ` | selected_asset=${scene.selectedAsset}` : ""}`,
        ),
        "",
        "distribution_plan:",
        `primary_platform: ${distributionPlan.primaryPlatform}`,
        `secondary_platform: ${distributionPlan.secondaryPlatform}`,
        `recommended_window: ${distributionPlan.recommendedWindow}`,
        `secondary_window: ${distributionPlan.secondaryWindow}`,
        `hypothesis: ${distributionPlan.hypothesis}`,
        `rationale: ${distributionPlan.rationale}`,
        "",
        "platform_variants:",
        `youtube_short.title: ${payload.platformVariants.youtubeShort.title}`,
        `youtube_short.cover_text: ${payload.platformVariants.youtubeShort.coverText}`,
        `youtube_short.caption: ${payload.platformVariants.youtubeShort.caption}`,
        `tiktok.hook: ${payload.platformVariants.tiktok.hook}`,
        `tiktok.cover_text: ${payload.platformVariants.tiktok.coverText}`,
        `tiktok.caption: ${payload.platformVariants.tiktok.caption}`,
        "",
        "script:",
        payload.script,
        "",
        "description:",
        payload.description,
        "",
        "quality_gate:",
        `score: ${payload.qualityAssessment?.score ?? 0}`,
        `passed: ${payload.qualityAssessment?.passed === true ? "true" : "false"}`,
        `reasons: ${(payload.qualityAssessment?.reasons ?? []).join(" | ")}`,
        "END_SHORT_PACKAGE_V3",
      ].join("\n");

      const updated = this.contentOps.updateItem({
        id: item.id,
        hook: payload.hook,
        callToAction: payload.cta,
        notes: item.notes ? `${item.notes}\n\n${scriptPackage}` : scriptPackage,
        status: "draft",
      });

      generated.push({
        id: updated.id,
        title: updated.title,
        status: updated.status,
        recommendedWindow: distributionPlan.recommendedWindow,
        hasAssets: sceneAssets.some((scene) => scene.suggestions.length > 0),
      });
    }

    return {
      requestId,
      reply: buildContentBatchGenerationReply({
        channelKey,
        generated,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "update_content_item",
          resultPreview: JSON.stringify(
            {
              channelKey,
              generated: generated.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentDistributionStrategy(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentDistributionStrategyPrompt(userPrompt)) {
      return null;
    }

    const channelKey = extractContentChannelKey(userPrompt) ?? inferDefaultContentChannelKey(userPrompt);
    const limit = Math.min(10, extractPromptLimit(userPrompt, 5, 10));
    const items = this.contentOps
      .listItems({ channelKey, limit: 20 })
      .filter((item) => isRiquezaContentItemEligible(item))
      .filter((item) => item.status !== "archived" && item.status !== "published")
      .sort((left, right) =>
        (right.queuePriority ?? right.ideaScore ?? 0) - (left.queuePriority ?? left.ideaScore ?? 0)
        || left.id - right.id,
      )
      .slice(0, limit);

    requestLogger.info("Using direct content distribution strategy route", {
      channelKey,
      limit,
      selected: items.length,
    });

    return {
      requestId,
      reply: buildContentDistributionStrategyReply({
        channelKey,
        items: items.map((item, index) => {
          const plan = buildDistributionPlan({
            item,
            channelKey: item.channelKey ?? channelKey,
            orderOffset: index,
          });
          return {
            id: item.id,
            title: item.title,
            recommendedWindow: plan.recommendedWindow,
            secondaryWindow: plan.secondaryWindow,
            hypothesis: plan.hypothesis,
            rationale: plan.rationale,
          };
        }),
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_items",
          resultPreview: JSON.stringify(
            {
              channelKey,
              selected: items.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentSeries(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentSeriesPrompt(userPrompt)) {
      return null;
    }

    const limit = extractPromptLimit(userPrompt, 10, 30);
    const channelKey = extractContentChannelKey(userPrompt);
    requestLogger.info("Using direct content series route", {
      limit,
      channelKey,
    });

    const series = this.contentOps.listSeries({
      channelKey,
      limit,
    });

    return {
      requestId,
      reply: buildContentSeriesReply(series),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_series",
          resultPreview: JSON.stringify(
            {
              total: series.length,
              channelKey,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentFormatLibrary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentFormatLibraryPrompt(userPrompt)) {
      return null;
    }

    const limit = extractPromptLimit(userPrompt, 10, 30);
    requestLogger.info("Using direct content format library route", {
      limit,
    });

    const templates = this.contentOps.listFormatTemplates({
      activeOnly: true,
      limit,
    });

    return {
      requestId,
      reply: buildContentFormatsReply(templates),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_format_templates",
          resultPreview: JSON.stringify(
            {
              total: templates.length,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContentHookLibrary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isContentHookLibraryPrompt(userPrompt)) {
      return null;
    }

    const limit = extractPromptLimit(userPrompt, 10, 30);
    requestLogger.info("Using direct content hook library route", {
      limit,
    });

    const hooks = this.contentOps.listHookTemplates({
      limit,
    });

    return {
      requestId,
      reply: buildContentHooksReply(hooks),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_content_hook_templates",
          resultPreview: JSON.stringify(
            {
              total: hooks.length,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectSafeExec(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const request = extractSafeExecRequest(userPrompt);
    if (!request) {
      return null;
    }

    if (!orchestration.policy.capabilities.canRunProjectTools) {
      return {
        requestId,
        reply: "A politica atual do dominio nao permite execucao tecnica nesta solicitacao.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct safe exec route", {
      argv: request.argv,
      root: request.root,
      path: request.path,
    });

    let result;
    try {
      result = await this.safeExec.execute(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        requestId,
        reply: [
          "Execucao bloqueada ou falhou.",
          `- Comando: ${request.argv.join(" ")}`,
          `- Root: ${request.root}`,
          `- Caminho: ${request.path ?? "."}`,
          `- Motivo: ${errorMessage}`,
          "",
          "Se este comando precisa escrever em disco, primeiro espelhe o projeto para o workspace e execute la.",
        ].join("\n"),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [
          {
            toolName: "safe_exec",
            resultPreview: JSON.stringify(
              {
                argv: request.argv,
                root: request.root,
                path: request.path,
                error: errorMessage,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      requestId,
      reply: buildSafeExecReply(result),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "safe_exec",
          resultPreview: JSON.stringify(
            {
              argv: result.argv,
              cwd: result.cwd,
              exitCode: result.exitCode,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectCaseNotes(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isCaseNotesPrompt(userPrompt)) {
      return null;
    }

    const limit = extractPromptLimit(userPrompt, 10, 30);
    const normalized = normalizeEmailAnalysisText(userPrompt);
    const sensitivity =
      normalized.includes("critical")
        ? "critical"
        : normalized.includes("high") || normalized.includes("alta")
          ? "high"
          : normalized.includes("restricted") || normalized.includes("restrita")
            ? "restricted"
            : undefined;
    requestLogger.info("Using direct case notes route", {
      limit,
      sensitivity,
    });

    const notes = this.socialAssistant.listNotes({
      sensitivity,
      limit,
    });

    return {
      requestId,
      reply: buildCaseNotesReply(notes),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_case_notes",
          resultPreview: JSON.stringify(
            {
              total: notes.length,
              sensitivity,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectUserPreferences(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isUserPreferencesPrompt(userPrompt)) {
      return null;
    }

    const update = extractPreferenceUpdate(userPrompt);
    const preferences = update ? this.preferences.update(update) : this.preferences.get();

    const reply = update
      ? [
          "Preferências atualizadas.",
          buildUserPreferencesReply(preferences),
        ].join("\n")
      : buildUserPreferencesReply(preferences);

    return {
      requestId,
      reply,
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectPersonalOperationalProfileShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalOperationalProfileShowPrompt(userPrompt)) {
      return null;
    }

    const execution = await this.executeToolDirect("get_personal_operational_profile", {});
    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId,
      reply: buildPersonalOperationalProfileReply(rawResult.profile ?? this.personalMemory.getProfile()),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "get_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectOperationalStateShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isOperationalStateShowPrompt(userPrompt)) {
      return null;
    }

    const execution = await this.executeToolDirect("get_operational_state", {});
    const rawResult = execution.rawResult as {
      state?: OperationalState;
    };

    return {
      requestId,
      reply: buildOperationalStateReply(rawResult.state ?? this.personalMemory.getOperationalState()),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "get_operational_state",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectLearnedPreferencesList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isLearnedPreferencesListPrompt(userPrompt)) {
      return null;
    }

    const filter = resolveLearnedPreferencesListFilter(userPrompt);
    const execution = await this.executeToolDirect("list_learned_preferences", {
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.search ? { search: filter.search } : {}),
      limit: 12,
    });
    const rawResult = execution.rawResult as { items?: LearnedPreference[] };
    const items = filter.search === "agenda"
      ? (rawResult.items ?? []).filter((item) =>
          ["schedule_import_mode", "agenda_scope", "calendar_interpretation"].includes(item.type),
        )
      : (rawResult.items ?? []);

    return {
      requestId,
      reply: buildLearnedPreferencesReply(items),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "list_learned_preferences",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectLearnedPreferencesDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isLearnedPreferencesDeletePrompt(userPrompt)) {
      return null;
    }

    let targetId = extractLearnedPreferenceId(userPrompt);
    const query = extractLearnedPreferenceDeleteTarget(userPrompt);
    if (!targetId && !query) {
      return {
        requestId,
        reply: "Diga qual preferência aprendida devo desativar, por id ou por referência curta.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    if (!targetId && query) {
      const matches = this.personalMemory.findLearnedPreferences(query, 5);
      if (matches.length === 0) {
        return {
          requestId,
          reply: `Não encontrei preferência aprendida para "${query}".`,
          messages: buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId,
          reply: buildLearnedPreferencesReply(matches),
          messages: buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const execution = await this.executeToolDirect("deactivate_learned_preference", {
      id: targetId,
    });
    const rawResult = execution.rawResult as {
      item?: LearnedPreference;
    };
    const item = rawResult.item;

    return {
      requestId,
      reply: item
        ? buildLearnedPreferenceDeactivatedReply(item)
        : "Não consegui desativar essa preferência aprendida.",
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: item
        ? [
            {
              toolName: "deactivate_learned_preference",
              resultPreview: execution.content.slice(0, 240),
            },
          ]
        : [],
    };
  }

  private async tryRunDirectCapabilityInspection(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!this.capabilityPlanner.isCapabilityInspectionPrompt(userPrompt)) {
      return null;
    }

    const normalized = normalizeEmailAnalysisText(userPrompt);
    const wantsWhy = includesAny(normalized, [
      "por que voce nao conseguiu resolver isso",
      "por que você não conseguiu resolver isso",
    ]);
    const wantsGaps = includesAny(normalized, [
      "lacunas",
      "gaps",
      "melhorias sugeridas pelo uso",
    ]);

    if (wantsWhy) {
      const latestGap = this.personalMemory.listProductGaps({ limit: 1 })[0];
      return {
        requestId,
        reply: latestGap
          ? buildProductGapDetailReply(latestGap)
          : "Ainda não tenho um gap recente registrado para te explicar.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
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
      const gaps = this.personalMemory.listProductGaps({ status: "open", limit: 12 });
      return {
        requestId,
        reply: buildProductGapsReply(gaps),
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
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

    const availability = this.capabilityPlanner.listCapabilityAvailability();
    const constrained = availability.filter((item) => item.availability !== "available");
    return {
      requestId,
      reply: buildCapabilityAvailabilityReply(availability),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
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

  private async tryRunDirectCapabilityAwarePlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
    options?: AgentRunOptions,
  ): Promise<AgentRunResult | null> {
    if (!this.capabilityPlanner.isPlanningCandidate(userPrompt)) {
      return null;
    }

    const interpreted = interpretConversationTurn({
      text: userPrompt,
      operationalMode: this.personalMemory.getOperationalState().mode,
    });
    let effectivePrompt = userPrompt;
    let activeGoal: ActivePlanningGoal | undefined;
    if (options?.chatId !== undefined) {
      const seededGoal = buildTravelPlanningGoalFromPrompt(userPrompt) ?? buildPlaceDiscoveryGoalFromPrompt(userPrompt);
      if (seededGoal) {
        activeGoal = seededGoal;
        this.setActiveGoal(options.chatId, seededGoal);
        effectivePrompt = seededGoal.kind === "travel_planning"
          ? buildTravelPlanningPrompt(seededGoal)
          : buildPlaceDiscoveryPrompt(seededGoal);
      }
    }

    const plan = this.capabilityPlanner.plan(effectivePrompt, interpreted);
    if (!plan) {
      return null;
    }

    requestLogger.info("Using direct capability planning route", {
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
      requestId,
      requestLogger,
      orchestration,
      preferences,
      plan,
      relatedSkill: interpreted.skill,
      activeGoal,
      activeGoalChatId: activeGoal ? options?.chatId : undefined,
    });
  }

  private async tryRunDirectPersonalOperationalProfileUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalOperationalProfileUpdatePrompt(userPrompt)) {
      return null;
    }

    const currentProfile = this.personalMemory.getProfile();
    const extracted = extractPersonalOperationalProfileUpdate(userPrompt, currentProfile);
    if (!extracted) {
      return {
        requestId,
        reply: "Diga o ajuste de perfil que você quer. Exemplo: `defina meu estilo de resposta como direto e objetivo`.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const execution = await this.executeToolDirect("update_personal_operational_profile", {
      ...(extracted.profile.displayName ? { displayName: extracted.profile.displayName } : {}),
      ...(extracted.profile.primaryRole ? { primaryRole: extracted.profile.primaryRole } : {}),
      ...(extracted.profile.routineSummary ? { routineSummary: extracted.profile.routineSummary } : {}),
      ...(extracted.profile.timezone ? { timezone: extracted.profile.timezone } : {}),
      ...(extracted.profile.preferredChannels ? { preferredChannels: extracted.profile.preferredChannels } : {}),
      ...(extracted.profile.preferredAlertChannel ? { preferredAlertChannel: extracted.profile.preferredAlertChannel } : {}),
      ...(extracted.profile.priorityAreas ? { priorityAreas: extracted.profile.priorityAreas } : {}),
      ...(extracted.profile.defaultAgendaScope ? { defaultAgendaScope: extracted.profile.defaultAgendaScope } : {}),
      ...(extracted.profile.responseStyle ? { responseStyle: extracted.profile.responseStyle } : {}),
      ...(extracted.profile.briefingPreference ? { briefingPreference: extracted.profile.briefingPreference } : {}),
      ...(extracted.profile.detailLevel ? { detailLevel: extracted.profile.detailLevel } : {}),
      ...(extracted.profile.tonePreference ? { tonePreference: extracted.profile.tonePreference } : {}),
      ...(extracted.profile.defaultOperationalMode ? { defaultOperationalMode: extracted.profile.defaultOperationalMode } : {}),
      ...(extracted.profile.mobilityPreferences ? { mobilityPreferences: extracted.profile.mobilityPreferences } : {}),
      ...(extracted.profile.autonomyPreferences ? { autonomyPreferences: extracted.profile.autonomyPreferences } : {}),
      ...(extracted.profile.savedFocus ? { savedFocus: extracted.profile.savedFocus } : {}),
      ...(extracted.profile.routineAnchors ? { routineAnchors: extracted.profile.routineAnchors } : {}),
      ...(extracted.profile.operationalRules ? { operationalRules: extracted.profile.operationalRules } : {}),
      ...(extracted.profile.attire?.carryItems ? { carryItems: extracted.profile.attire.carryItems } : {}),
      ...(typeof extracted.profile.fieldModeHours === "number" ? { fieldModeHours: extracted.profile.fieldModeHours } : {}),
    });
    if (extracted.preferenceUpdate) {
      this.preferences.update(extracted.preferenceUpdate);
    }

    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId,
      reply: buildPersonalOperationalProfileUpdatedReply(
        rawResult.profile ?? this.personalMemory.getProfile(),
        extracted.changeLabels,
      ),
      messages: buildBaseMessages(userPrompt, orchestration, this.preferences.get()),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectPersonalOperationalProfileDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalOperationalProfileDeletePrompt(userPrompt)) {
      return null;
    }

    const currentProfile = this.personalMemory.getProfile();
    const query = extractPersonalOperationalProfileRemoveQuery(userPrompt);
    if (!query) {
      return {
        requestId,
        reply: "Diga o que devo remover do seu perfil operacional.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const removal = removeFromPersonalOperationalProfile(currentProfile, query);
    if (!removal) {
      return {
        requestId,
        reply: `Não encontrei ajuste de perfil compatível com "${query}".`,
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const execution = await this.executeToolDirect("update_personal_operational_profile", {
      ...(removal.profileUpdate.responseStyle ? { responseStyle: removal.profileUpdate.responseStyle } : {}),
      ...(removal.profileUpdate.briefingPreference ? { briefingPreference: removal.profileUpdate.briefingPreference } : {}),
      ...(removal.profileUpdate.detailLevel ? { detailLevel: removal.profileUpdate.detailLevel } : {}),
      ...(removal.profileUpdate.tonePreference ? { tonePreference: removal.profileUpdate.tonePreference } : {}),
      ...(removal.profileUpdate.defaultOperationalMode ? { defaultOperationalMode: removal.profileUpdate.defaultOperationalMode } : {}),
      ...(removal.profileUpdate.mobilityPreferences ? { mobilityPreferences: removal.profileUpdate.mobilityPreferences } : {}),
      ...(removal.profileUpdate.autonomyPreferences ? { autonomyPreferences: removal.profileUpdate.autonomyPreferences } : {}),
      ...(removal.profileUpdate.routineAnchors ? { routineAnchors: removal.profileUpdate.routineAnchors } : {}),
      ...(removal.profileUpdate.operationalRules ? { operationalRules: removal.profileUpdate.operationalRules } : {}),
      ...(removal.profileUpdate.attire?.carryItems ? { carryItems: removal.profileUpdate.attire.carryItems } : {}),
    });
    const preferenceReset: import("../types/user-preferences.js").UpdateUserPreferencesInput = {};
    if (removal.profileUpdate.responseStyle || removal.profileUpdate.tonePreference) {
      preferenceReset.responseStyle = "executive";
    }
    if (removal.profileUpdate.briefingPreference || removal.profileUpdate.detailLevel) {
      preferenceReset.responseLength = "short";
    }
    if (Object.keys(preferenceReset).length > 0) {
      this.preferences.update(preferenceReset);
    }

    const rawResult = execution.rawResult as {
      profile?: PersonalOperationalProfile;
    };

    return {
      requestId,
      reply: buildPersonalOperationalProfileRemovedReply(
        rawResult.profile ?? this.personalMemory.getProfile(),
        removal.removedLabels,
      ),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectPersonalMemoryList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalMemoryListPrompt(userPrompt)) {
      return null;
    }

    const execution = await this.executeToolDirect("list_personal_memory_items", {
      limit: 12,
    });
    const rawResult = execution.rawResult as {
      items?: PersonalOperationalMemoryItem[];
      profile?: ReturnType<PersonalOperationalMemoryStore["getProfile"]>;
    };

    return {
      requestId,
      reply: buildPersonalMemoryListReply({
        profile: rawResult.profile ?? this.personalMemory.getProfile(),
        items: rawResult.items ?? [],
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "list_personal_memory_items",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectPersonalMemorySave(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalMemorySavePrompt(userPrompt)) {
      return null;
    }

    const statement = extractPersonalMemoryStatement(userPrompt);
    if (!statement) {
      return {
        requestId,
        reply: "Diga o que devo salvar na memória pessoal. Exemplo: `salve na minha memória pessoal que em dias de plantão quero respostas curtas`.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const kind = inferPersonalMemoryKind(statement);
    const execution = await this.executeToolDirect("save_personal_memory_item", {
      kind,
      title: buildPersonalMemoryTitle(statement, kind),
      content: statement,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId,
        reply: "Não consegui salvar esse item na memória pessoal.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: buildPersonalMemorySavedReply(item),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "save_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectPersonalMemoryUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalMemoryUpdatePrompt(userPrompt)) {
      return null;
    }

    const id = extractPersonalMemoryId(userPrompt);
    const query = extractPersonalMemoryUpdateTarget(userPrompt);
    const content = extractPersonalMemoryUpdateContent(userPrompt);
    if (!id && !query) {
      return {
        requestId,
        reply: "Diga qual item da memória pessoal devo atualizar, por id ou por referência curta. Exemplo: `atualize minha memória pessoal #3 para respostas muito curtas em plantão`.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    if (!content) {
      return {
        requestId,
        reply: "Entendi o item alvo, mas faltou dizer o novo conteúdo. Exemplo: `atualize minha memória pessoal sobre rotina de plantão para respostas curtas e foco em deslocamento`.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    let targetId = id;
    if (!targetId && query) {
      const matches = this.personalMemory.findItems(query, 5);
      if (matches.length === 0) {
        return {
          requestId,
          reply: `Não encontrei item de memória pessoal para "${query}".`,
          messages: buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId,
          reply: buildPersonalMemoryAmbiguousReply(query, matches),
          messages: buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const kind = inferPersonalMemoryKind(content);
    const execution = await this.executeToolDirect("update_personal_memory_item", {
      id: targetId,
      kind,
      title: buildPersonalMemoryTitle(content, kind),
      content,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId,
        reply: "Não consegui atualizar esse item da memória pessoal.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: buildPersonalMemoryUpdatedReply(item),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "update_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectPersonalMemoryDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isPersonalMemoryDeletePrompt(userPrompt)) {
      return null;
    }

    let targetId = extractPersonalMemoryId(userPrompt);
    const query = extractPersonalMemoryDeleteTarget(userPrompt);

    if (!targetId && !query) {
      return {
        requestId,
        reply: "Diga qual item da memória pessoal devo remover, por id ou por referência curta. Exemplo: `remova da minha memória pessoal #4`.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    if (!targetId && query) {
      const matches = this.personalMemory.findItems(query, 5);
      if (matches.length === 0) {
        return {
          requestId,
          reply: `Não encontrei item de memória pessoal para "${query}".`,
          messages: buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [],
        };
      }
      if (matches.length > 1) {
        return {
          requestId,
          reply: buildPersonalMemoryAmbiguousReply(query, matches),
          messages: buildBaseMessages(userPrompt, orchestration, preferences),
          toolExecutions: [],
        };
      }
      targetId = matches[0]?.id;
    }

    if (!targetId) {
      return null;
    }

    const execution = await this.executeToolDirect("delete_personal_memory_item", {
      id: targetId,
    });
    const rawResult = execution.rawResult as { item?: PersonalOperationalMemoryItem };
    const item = rawResult.item;
    if (!item) {
      return {
        requestId,
        reply: "Não consegui remover esse item da memória pessoal.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: buildPersonalMemoryDeletedReply(item),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "delete_personal_memory_item",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectWorkflowPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isWorkflowPlanningPrompt(userPrompt) || isWorkflowShowPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct workflow planning route", {
      domain: orchestration.route.primaryDomain,
      actionMode: orchestration.route.actionMode,
    });

    const plan = await this.planBuilder.createPlanFromPrompt(userPrompt, orchestration, requestLogger);
    this.entityLinker.upsertWorkflowRun(plan, "Workflow planejado.");
    return {
      requestId,
      reply: buildWorkflowPlanReply(plan),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [
        {
          toolName: "workflow_plan",
          resultPreview: JSON.stringify(
            {
              id: plan.id,
              title: plan.title,
              steps: plan.steps.length,
              primaryDomain: plan.primaryDomain,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectContactList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isContactListPrompt(userPrompt)) {
      return null;
    }

    const contacts = this.contacts.listContacts(20);
    return {
      requestId,
      reply: buildContactListReply(contacts),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectContactUpsert(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isContactUpsertPrompt(userPrompt)) {
      return null;
    }

    const input = extractContactProfileInput(userPrompt);
    if (!input) {
      return {
        requestId,
        reply: "Para salvar um contato, eu preciso ao menos de um email, @username do Telegram ou número de telefone.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const contact = this.contacts.upsertContact(input);
    this.entityLinker.upsertContact(contact);
    return {
      requestId,
      reply: buildContactSaveReply(contact),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectMemoryEntityList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isMemoryEntityListPrompt(userPrompt)) {
      return null;
    }

    const kind = extractMemoryEntityKindFromPrompt(userPrompt);
    const entities = this.memoryEntities.list(12, kind);
    return {
      requestId,
      reply: buildMemoryEntityListReply(entities, { kind }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectMemoryEntitySearch(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isMemoryEntitySearchPrompt(userPrompt)) {
      return null;
    }

    const query = extractMemoryEntitySearchQuery(userPrompt);
    if (!query) {
      return {
        requestId,
        reply: "Para buscar entidades, eu preciso de um termo ou frase entre aspas.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const kind = extractMemoryEntityKindFromPrompt(userPrompt);
    const entities = this.memoryEntities.search(query, 12, kind);
    return {
      requestId,
      reply: buildMemoryEntityListReply(entities, { kind, query }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectIntentResolve(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isIntentResolvePrompt(userPrompt)) {
      return null;
    }

    const subject = extractIntentResolveSubject(userPrompt);
    const resolution = this.intentRouter.resolve(subject);
    const contextPack = await this.contextPacks.buildForPrompt(subject, resolution);
    return {
      requestId,
      reply: this.responseOs.buildIntentAnalysisReply({
        objective: inferIntentObjective(subject, resolution),
        primaryDomain: resolution.orchestration.route.primaryDomain,
        mentionedDomains: resolution.mentionedDomains,
        actionMode: resolution.orchestration.route.actionMode,
        confidence: resolution.orchestration.route.confidence,
        compound: resolution.compoundIntent,
        contextSignals: contextPack?.signals ?? [],
        reasons: resolution.orchestration.route.reasons,
        recommendedNextStep: inferIntentNextStep(resolution),
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectOperationalPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    intent: IntentResolution,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isOperationalPlanningPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct operational planning route", {
      primaryDomain: intent.orchestration.route.primaryDomain,
      actionMode: intent.orchestration.route.actionMode,
    });

    const contextPack = await this.contextPacks.buildForPrompt(userPrompt, intent);
    const brief = contextPack?.brief;
    if (!brief) {
      return null;
    }

    return {
      requestId,
      reply: this.responseOs.buildOrganizationReply(
        buildOperationalPlanContract(userPrompt, brief, this.personalMemory.getProfile()),
      ),
      messages: buildBaseMessages(userPrompt, intent.orchestration, preferences),
      toolExecutions: [
        {
          toolName: "context_pack_operational_overview",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              approvals: brief.approvals.length,
              tasks: brief.taskBuckets.actionableCount,
              emails: brief.emails.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectWorkflowList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isWorkflowListPrompt(userPrompt)) {
      return null;
    }

    const plans = this.workflows.listPlans(10);
    return {
      requestId,
      reply: buildWorkflowListReply(plans),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectWorkflowShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isWorkflowShowPrompt(userPrompt)) {
      return null;
    }

    const planId = extractWorkflowPlanId(userPrompt);
    if (!planId) {
      return null;
    }

    const plan = this.workflows.getPlan(planId);
    if (!plan) {
      return {
        requestId,
        reply: `Não encontrei o workflow #${planId}.`,
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId,
      reply: buildWorkflowPlanReply(plan),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectWorkflowArtifacts(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isWorkflowArtifactListPrompt(userPrompt)) {
      return null;
    }

    const planId = extractWorkflowPlanId(userPrompt) ?? this.workflows.latestPlan()?.id;
    if (!planId) {
      return {
        requestId,
        reply: "Não encontrei workflow para listar artefatos.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const plan = this.workflows.getPlan(planId);
    if (!plan) {
      return {
        requestId,
        reply: `Não encontrei o workflow #${planId}.`,
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const stepNumber = extractWorkflowStepNumber(userPrompt);
    const artifacts = this.workflows.listArtifacts(planId, stepNumber);
    return {
      requestId,
      reply: buildWorkflowArtifactsReply(plan, artifacts, stepNumber),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  private async tryRunDirectWorkflowExecution(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isWorkflowExecutionPrompt(userPrompt)) {
      return null;
    }

    const planId = extractWorkflowPlanId(userPrompt) ?? this.workflows.latestPlan()?.id;
    if (!planId) {
      return {
        requestId,
        reply: "Não encontrei workflow para iniciar ou retomar.",
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }

    const stepNumber = extractWorkflowStepNumber(userPrompt);
    try {
      const { plan, step } = this.workflowRuntime.startStep(planId, stepNumber);
      const brief = await this.buildWorkflowExecutionBrief(plan, step, requestLogger);
      const artifact = this.saveWorkflowExecutionArtifact(plan, step, brief);
      const autoExecute = shouldAutoExecuteWorkflowDeliverable(userPrompt);
      const deliverable = autoExecute
        ? await this.generateWorkflowDomainDeliverable(plan, step, brief, requestLogger)
        : null;
      const refreshedPlan = this.workflows.getPlan(plan.id) ?? plan;
      const refreshedStep = refreshedPlan.steps.find((item) => item.stepNumber === step.stepNumber) ?? step;

      return {
        requestId,
        reply: buildWorkflowExecutionReply({
          plan: refreshedPlan,
          step: refreshedStep,
          artifact,
          deliverableArtifact: deliverable?.artifact,
          deliverableSummary: deliverable?.summary,
          brief,
        }),
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [
          {
            toolName: "workflow_execution",
            resultPreview: JSON.stringify(
              {
                planId: refreshedPlan.id,
                stepNumber: refreshedStep.stepNumber,
                artifactId: artifact.id,
                artifactPath: artifact.filePath,
                deliverableArtifactId: deliverable?.artifact.id,
                deliverableArtifactPath: deliverable?.artifact.filePath,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        requestId,
        reply: error instanceof Error ? error.message : String(error),
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }
  }

  private async tryRunDirectWorkflowStepUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isWorkflowStepUpdatePrompt(userPrompt)) {
      return null;
    }

    const planId = extractWorkflowPlanId(userPrompt) ?? this.workflows.latestPlan()?.id;
    const stepNumber = extractWorkflowStepNumber(userPrompt);
    const status = extractWorkflowStepStatus(userPrompt);
    if (!planId || !stepNumber || !status) {
      return null;
    }

    try {
      const transition = status === "completed"
        ? this.workflowRuntime.completeStep(planId, stepNumber)
        : status === "blocked"
          ? this.workflowRuntime.blockStep(planId, stepNumber, `Etapa ${stepNumber} marcada como bloqueada pelo operador.`)
          : status === "failed"
            ? this.workflowRuntime.failStep(planId, stepNumber, `Etapa ${stepNumber} marcada como falha pelo operador.`)
            : status === "waiting_approval"
              ? this.workflowRuntime.markWaitingApproval(planId, stepNumber, `Etapa ${stepNumber} aguardando aprovação.`)
              : status === "pending"
                ? this.workflowRuntime.resetStepToPending(planId, stepNumber, `Etapa ${stepNumber} voltou para pendente.`)
                : this.workflowRuntime.resumeStep(planId, stepNumber, `Etapa ${stepNumber} retomada pelo operador.`);
      const plan = transition.plan;
      const step = plan.steps.find((item) => item.stepNumber === stepNumber);
      if (step) {
        this.workflows.saveArtifact({
          planId,
          stepNumber,
          artifactType: "status_update",
          title: `Atualização da etapa ${stepNumber}`,
          summary: `Etapa ${stepNumber} alterada para ${status}.`,
          content: [
            `Workflow #${planId}`,
            `Etapa ${stepNumber}: ${step.title}`,
            `Novo status: ${status}`,
            `Atualizado em: ${new Date().toISOString()}`,
          ].join("\n"),
        });
      }

      return {
        requestId,
        reply: buildWorkflowStepUpdateReply(plan, stepNumber),
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    } catch (error) {
      return {
        requestId,
        reply: error instanceof Error ? error.message : String(error),
        messages: buildBaseMessages(userPrompt, orchestration, preferences),
        toolExecutions: [],
      };
    }
  }

  private async createWorkflowPlanFromPrompt(
    userPrompt: string,
    orchestration: OrchestrationContext,
    requestLogger: Logger,
  ): Promise<WorkflowPlanRecord> {
    const fallbackInput = this.buildFallbackWorkflowPlanInput(userPrompt, orchestration);

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o orquestrador do Atlas Prime.",
              "Sua função é transformar um objetivo em um workflow executável multi-etapas.",
              "Responda somente JSON válido.",
              "Use estes domínios permitidos: orchestrator, assistente_social, secretario_operacional, social_media, dev_full_stack, analista_negocios_growth.",
              "Crie um plano pragmático com entre 4 e 8 etapas.",
              "Cada etapa deve ter: title, ownerDomain, taskType, objective, deliverable, successCriteria, dependsOn, suggestedTools.",
              "O plano deve ter: title, executiveSummary, primaryDomain, secondaryDomains, deliverables, nextAction, steps.",
              "Não inclua texto fora do JSON.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Objetivo: ${userPrompt}`,
              `Domínio principal atual: ${orchestration.route.primaryDomain}`,
              `Domínios secundários: ${orchestration.route.secondaryDomains.join(", ") || "nenhum"}`,
              `Modo de ação: ${orchestration.route.actionMode}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      const input = this.normalizeWorkflowPlanInput(parsed, userPrompt, orchestration, fallbackInput);
      return this.workflows.createPlan(input);
    } catch (error) {
      requestLogger.warn("Workflow plan generation fell back to deterministic plan", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.workflows.createPlan(fallbackInput);
    }
  }

  private async buildWorkflowExecutionBrief(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    requestLogger: Logger,
  ): Promise<{
    summary: string;
    immediateActions: string[];
    risks: string[];
    outputs: string[];
    suggestedTools: string[];
    followUp: string;
  }> {
    const completedSteps = plan.steps
      .filter((item) => item.status === "completed")
      .map((item) => `${item.stepNumber}. ${item.title}`)
      .slice(0, 8);

    const fallback = {
      summary: `Iniciar a etapa ${step.stepNumber} com foco em ${step.objective}.`,
      immediateActions: [
        `Validar o objetivo da etapa: ${step.objective}`,
        `Produzir o entregável esperado: ${step.deliverable}`,
        "Registrar decisões, lacunas e próximos passos no artefato da etapa.",
      ],
      risks: [
        "Escopo da etapa ficar aberto demais.",
        "Faltar dado ou contexto para concluir a entrega com qualidade.",
      ],
      outputs: [
        step.deliverable,
        "Checklist do que foi validado e do que ainda está pendente.",
      ],
      suggestedTools: step.suggestedTools,
      followUp: `Executar a etapa ${step.stepNumber}, registrar o resultado e marcar como concluída quando o critério de sucesso for atendido.`,
    };

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o coordenador operacional do Atlas Prime.",
              "Gere um brief curto e executável para iniciar ou retomar uma etapa de workflow.",
              "Responda somente JSON válido.",
              "Formato: summary, immediateActions, risks, outputs, suggestedTools, followUp.",
              "Use linguagem pragmática e operacional.",
              "Limite immediateActions a 5 itens, risks a 4, outputs a 5.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow: ${plan.title}`,
              `Resumo do workflow: ${plan.executiveSummary}`,
              `Etapa: ${step.stepNumber}. ${step.title}`,
              `Domínio dono: ${step.ownerDomain}`,
              `Objetivo da etapa: ${step.objective}`,
              `Entregável: ${step.deliverable}`,
              `Critério de sucesso: ${step.successCriteria}`,
              `Dependências: ${step.dependsOn.length ? step.dependsOn.join(", ") : "nenhuma"}`,
              `Etapas concluídas: ${completedSteps.join(" | ") || "nenhuma"}`,
              `Tools sugeridas: ${step.suggestedTools.join(", ") || "nenhuma"}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      return {
        summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallback.summary,
        immediateActions: Array.isArray(parsed.immediateActions)
          ? parsed.immediateActions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : fallback.immediateActions,
        risks: Array.isArray(parsed.risks)
          ? parsed.risks.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4)
          : fallback.risks,
        outputs: Array.isArray(parsed.outputs)
          ? parsed.outputs.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : fallback.outputs,
        suggestedTools: Array.isArray(parsed.suggestedTools)
          ? parsed.suggestedTools.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6)
          : fallback.suggestedTools,
        followUp: typeof parsed.followUp === "string" && parsed.followUp.trim() ? parsed.followUp.trim() : fallback.followUp,
      };
    } catch (error) {
      requestLogger.warn("Workflow execution brief fell back to deterministic brief", {
        planId: plan.id,
        stepNumber: step.stepNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  private saveWorkflowExecutionArtifact(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: {
      summary: string;
      immediateActions: string[];
      risks: string[];
      outputs: string[];
      suggestedTools: string[];
      followUp: string;
    },
  ): WorkflowArtifactRecord {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workflowDir = path.join(
      this.config.paths.workspaceDir,
      "reports",
      "workflows",
      `workflow-${plan.id}`,
    );
    mkdirSync(workflowDir, { recursive: true });

    const filename = `step-${step.stepNumber}-${slugifySegment(step.title)}-${timestamp}.md`;
    const filePath = path.join(workflowDir, filename);
    const content = [
      `# Workflow #${plan.id} - Etapa ${step.stepNumber}`,
      "",
      `## Título`,
      step.title,
      "",
      `## Domínio dono`,
      step.ownerDomain,
      "",
      `## Objetivo`,
      step.objective,
      "",
      `## Entregável esperado`,
      step.deliverable,
      "",
      `## Critério de sucesso`,
      step.successCriteria,
      "",
      `## Resumo operacional`,
      brief.summary,
      "",
      `## Ações imediatas`,
      ...brief.immediateActions.map((item) => `- ${item}`),
      "",
      `## Riscos`,
      ...brief.risks.map((item) => `- ${item}`),
      "",
      `## Saídas esperadas`,
      ...brief.outputs.map((item) => `- ${item}`),
      "",
      `## Tools sugeridas`,
      ...(brief.suggestedTools.length > 0 ? brief.suggestedTools : step.suggestedTools).map((item) => `- ${item}`),
      "",
      `## Próxima ação`,
      brief.followUp,
      "",
      `## Registrado em`,
      new Date().toISOString(),
      "",
    ].join("\n");

    writeFileSync(filePath, content, "utf8");
    return this.workflows.saveArtifact({
      planId: plan.id,
      stepNumber: step.stepNumber,
      artifactType: "execution_brief",
      title: `Brief da etapa ${step.stepNumber}: ${step.title}`,
      summary: brief.summary,
      content,
      filePath,
    });
  }

  private async generateWorkflowDomainDeliverable(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: {
      summary: string;
      immediateActions: string[];
      risks: string[];
      outputs: string[];
      suggestedTools: string[];
      followUp: string;
    },
    requestLogger: Logger,
  ): Promise<{ artifact: WorkflowArtifactRecord; summary: string }> {
    const domainSpecs: Record<WorkflowStepRecord["ownerDomain"], { sections: string[]; guidance: string }> = {
      orchestrator: {
        sections: ["Resumo executivo", "Dependências", "Plano integrado", "Riscos", "Próximos passos"],
        guidance: "Produza um entregável de coordenação cross-functional, com plano integrado, checkpoints e handoffs claros.",
      },
      analista_negocios_growth: {
        sections: ["Mercado", "Hipóteses", "Concorrentes", "Experimentos", "KPIs", "Recomendação prática"],
        guidance: "Produza um artefato analítico de growth com hipóteses, sinais de demanda, concorrentes, experimentos e KPIs acionáveis.",
      },
      social_media: {
        sections: ["Mensagem central", "Pilares de conteúdo", "Campanha", "Peças", "CTAs", "Próximos passos"],
        guidance: "Produza um pacote de conteúdo e campanha pronto para execução, com mensagens, criativos e CTAs.",
      },
      dev_full_stack: {
        sections: ["Escopo técnico", "Arquitetura", "Backlog", "Plano de implementação", "Validação", "Riscos"],
        guidance: "Produza um entregável técnico executável: backlog, arquitetura, milestones e validações objetivas.",
      },
      secretario_operacional: {
        sections: ["Resumo operacional", "Compromissos", "Follow-ups", "Checklist", "Próximos passos"],
        guidance: "Produza um plano operacional de agenda, follow-up e execução administrativa com clareza de dono e prazo.",
      },
      assistente_social: {
        sections: ["Resumo do caso", "Encaminhamentos", "Documentos", "Cuidados", "Próximos passos"],
        guidance: "Produza um material formal e cuidadoso, sem extrapolar fatos, com foco em encaminhamento e registro responsável.",
      },
    };

    const spec = domainSpecs[step.ownerDomain] ?? domainSpecs.orchestrator;
    const fallbackTitle = `Entregável da etapa ${step.stepNumber}: ${step.title}`;
    const fallbackSummary = `Primeira versão do entregável da etapa ${step.stepNumber} pronta para revisão.`;
    const fallbackContent = [
      `# ${fallbackTitle}`,
      "",
      `## Resumo executivo`,
      brief.summary,
      "",
      `## Objetivo da etapa`,
      step.objective,
      "",
      `## Entregável esperado`,
      step.deliverable,
      "",
      `## Ações imediatas`,
      ...brief.immediateActions.map((item) => `- ${item}`),
      "",
      `## Riscos`,
      ...brief.risks.map((item) => `- ${item}`),
      "",
      `## Saídas esperadas`,
      ...brief.outputs.map((item) => `- ${item}`),
      "",
      `## Próximos passos`,
      brief.followUp,
      "",
    ].join("\n");

    let title = fallbackTitle;
    let summary = fallbackSummary;
    let content = fallbackContent;

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é um executor especialista do Atlas Prime.",
              "Gere um entregável real e útil para a etapa do workflow.",
              "Responda somente JSON válido.",
              "Formato: title, summary, content.",
              "O campo content deve ser Markdown pronto para uso.",
              spec.guidance,
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow: ${plan.title}`,
              `Resumo do workflow: ${plan.executiveSummary}`,
              `Etapa: ${step.stepNumber}. ${step.title}`,
              `Domínio dono: ${step.ownerDomain}`,
              `Objetivo: ${step.objective}`,
              `Entregável esperado: ${step.deliverable}`,
              `Critério de sucesso: ${step.successCriteria}`,
              `Resumo operacional: ${brief.summary}`,
              `Ações imediatas: ${brief.immediateActions.join(" | ")}`,
              `Riscos: ${brief.risks.join(" | ")}`,
              `Saídas esperadas: ${brief.outputs.join(" | ")}`,
              `Seções obrigatórias: ${spec.sections.join(" | ")}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
      summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallbackSummary;
      content = typeof parsed.content === "string" && parsed.content.trim() ? parsed.content.trim() : fallbackContent;
    } catch (error) {
      requestLogger.warn("Workflow deliverable generation fell back to deterministic artifact", {
        planId: plan.id,
        stepNumber: step.stepNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workflowDir = path.join(
      this.config.paths.workspaceDir,
      "reports",
      "workflows",
      `workflow-${plan.id}`,
    );
    mkdirSync(workflowDir, { recursive: true });
    const filename = `step-${step.stepNumber}-deliverable-${slugifySegment(step.title)}-${timestamp}.md`;
    const filePath = path.join(workflowDir, filename);
    writeFileSync(filePath, content, "utf8");

    const artifact = this.workflows.saveArtifact({
      planId: plan.id,
      stepNumber: step.stepNumber,
      artifactType: "deliverable",
      title,
      summary,
      content,
      filePath,
    });

    return {
      artifact,
      summary,
    };
  }

  private normalizeWorkflowPlanInput(
    parsed: Record<string, unknown>,
    userPrompt: string,
    orchestration: OrchestrationContext,
    fallback: CreateWorkflowPlanInput,
  ): CreateWorkflowPlanInput {
    const allowedDomains = new Set([
      "orchestrator",
      "assistente_social",
      "secretario_operacional",
      "social_media",
      "dev_full_stack",
      "analista_negocios_growth",
    ]);

    const normalizeDomain = (value: unknown, backup: CreateWorkflowPlanInput["primaryDomain"]) =>
      typeof value === "string" && allowedDomains.has(value) ? (value as CreateWorkflowPlanInput["primaryDomain"]) : backup;

    const secondaryDomains: CreateWorkflowPlanInput["secondaryDomains"] = Array.isArray(parsed.secondaryDomains)
      ? parsed.secondaryDomains
          .filter((item): item is string => typeof item === "string" && allowedDomains.has(item))
          .map((item) => item as CreateWorkflowPlanInput["primaryDomain"])
      : fallback.secondaryDomains ?? [];

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: CreateWorkflowPlanInput["steps"] = [];
    rawSteps.forEach((item, index) => {
        if (!item || typeof item !== "object") {
          return;
        }
        const record = item as Record<string, unknown>;
        steps.push({
          title: typeof record.title === "string" ? record.title.trim() : `Etapa ${index + 1}`,
          ownerDomain: normalizeDomain(record.ownerDomain, fallback.steps[Math.min(index, fallback.steps.length - 1)]?.ownerDomain ?? fallback.primaryDomain),
          taskType: typeof record.taskType === "string" ? record.taskType.trim() : "execution",
          objective: typeof record.objective === "string" ? record.objective.trim() : `Avançar o objetivo: ${userPrompt}`,
          deliverable: typeof record.deliverable === "string" ? record.deliverable.trim() : "Entregável definido",
          successCriteria:
            typeof record.successCriteria === "string" ? record.successCriteria.trim() : "Etapa concluída com saída verificável",
          dependsOn: Array.isArray(record.dependsOn)
            ? record.dependsOn.map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isFinite(value))
            : [],
          suggestedTools: Array.isArray(record.suggestedTools)
            ? record.suggestedTools.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : [],
          status: "pending" as const,
        });
    });
    const normalizedSteps = steps.slice(0, 8);

    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
      objective: userPrompt,
      executiveSummary:
        typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallback.executiveSummary,
      status: "draft",
      primaryDomain: normalizeDomain(parsed.primaryDomain, fallback.primaryDomain),
      secondaryDomains,
      deliverables: Array.isArray(parsed.deliverables)
        ? parsed.deliverables.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 8)
        : fallback.deliverables,
      nextAction:
        typeof parsed.nextAction === "string" && parsed.nextAction.trim()
          ? parsed.nextAction.trim()
          : fallback.nextAction,
      steps: normalizedSteps.length > 0 ? normalizedSteps : fallback.steps,
    };
  }

  private buildFallbackWorkflowPlanInput(
    userPrompt: string,
    orchestration: OrchestrationContext,
  ): CreateWorkflowPlanInput {
    const primary = orchestration.route.primaryDomain === "orchestrator"
      ? "analista_negocios_growth"
      : orchestration.route.primaryDomain;
    const secondary = orchestration.route.secondaryDomains;

    return {
      title: `Workflow Atlas Prime: ${userPrompt.slice(0, 72).trim()}`,
      objective: userPrompt,
      executiveSummary:
        "Plano orquestrado para decompor o objetivo em pesquisa, análise, execução, revisão e entrega com responsáveis claros.",
      status: "draft",
      primaryDomain: primary,
      secondaryDomains: secondary,
      deliverables: [
        "brief executivo",
        "backlog priorizado",
        "artefatos principais do objetivo",
      ],
      nextAction: "Validar o workflow, iniciar a etapa 1 e marcar o que já está pronto.",
      steps: [
        {
          title: "Descoberta e contexto",
          ownerDomain: "analista_negocios_growth",
          taskType: "research",
          objective: "Levantar contexto, restrições, público e sinais de valor.",
          deliverable: "brief de contexto",
          successCriteria: "Contexto e metas organizados com lacunas identificadas.",
          suggestedTools: ["web_search", "list_memory_items", "list_recent_emails"],
        },
        {
          title: "Plano operacional",
          ownerDomain: "orchestrator",
          taskType: "planning",
          objective: "Quebrar o objetivo em frentes, dependências e critérios de conclusão.",
          deliverable: "plano operacional por etapas",
          successCriteria: "Etapas, responsáveis e ordem definidos.",
          dependsOn: [1],
          suggestedTools: ["get_memory_summary"],
        },
        {
          title: "Execução da frente principal",
          ownerDomain: primary,
          taskType: "execution",
          objective: "Executar a frente principal do objetivo com base no plano.",
          deliverable: "entregável principal",
          successCriteria: "Entrega principal pronta para revisão.",
          dependsOn: [2],
          suggestedTools: ["safe_exec", "scan_project", "write_workspace_file"],
        },
        {
          title: "Distribuição e comunicação",
          ownerDomain: "social_media",
          taskType: "communication",
          objective: "Preparar mensagens, conteúdos e materiais de divulgação quando necessário.",
          deliverable: "copys, posts ou comunicações",
          successCriteria: "Materiais de comunicação alinhados ao objetivo.",
          dependsOn: [3],
          suggestedTools: ["export_content_calendar", "write_workspace_file"],
        },
        {
          title: "Fechamento e próximos passos",
          ownerDomain: "secretario_operacional",
          taskType: "coordination",
          objective: "Registrar entregas, pendências, follow-ups e compromissos derivados.",
          deliverable: "resumo final e próximos passos",
          successCriteria: "Nada crítico fica sem dono ou data.",
          dependsOn: [3, 4],
          suggestedTools: ["save_memory_item", "create_google_task", "create_calendar_event"],
        },
      ],
    };
  }

  private async tryRunDirectSupportReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isSupportReviewPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct support review route");

    const emailStatus = await this.email.getStatus();
    const emails = emailStatus.ready
      ? await this.email.listRecentMessages({
        limit: 12,
        unreadOnly: false,
        sinceHours: 168,
      })
      : [];

    const supportEmailItems = emails
      .map((email) => {
        const summary = summarizeEmailForOperations({
          subject: email.subject,
          from: email.from,
          text: email.preview,
        });
        const routing = this.communicationRouter.classify({
          channel: "email",
          identifier: extractEmailIdentifier(email.from),
          displayName: email.from.join(", "),
          subject: email.subject,
          text: email.preview,
        });
        const normalized = normalizeEmailAnalysisText([email.subject, email.preview].join("\n"));
        const supportSignal = includesAny(normalized, [
          "suporte",
          "ticket",
          "erro",
          "problema",
          "duvida",
          "dúvida",
          "ajuda",
          "atendimento",
          "cliente",
        ]);
        return {
          email,
          summary,
          routing,
          urgent: isUrgentSupportSignal([email.subject, email.preview].join("\n")),
          theme: extractSupportTheme([email.subject, email.preview].join("\n")),
          keep: routing.relationship === "client" || routing.relationship === "lead" || supportSignal,
        };
      })
      .filter((item) => item.keep)
      .slice(0, 4);

    const pendingReplyApprovals = this.approvals
      .listPendingAll(12)
      .filter((item) => item.actionKind === "whatsapp_reply")
      .slice(0, 4);

    const recentSupportMessages = this.whatsappMessages
      .listRecent(20)
      .map((message) => {
        const routing = this.communicationRouter.classify({
          channel: "whatsapp",
          identifier: message.number ?? message.remoteJid,
          displayName: message.pushName,
          text: message.text,
        });
        const normalized = normalizeEmailAnalysisText(message.text);
        const supportSignal = includesAny(normalized, [
          "suporte",
          "erro",
          "problema",
          "duvida",
          "dúvida",
          "ajuda",
          "cliente",
          "atendimento",
        ]);
        return {
          message,
          routing,
          urgent: isUrgentSupportSignal(message.text),
          theme: extractSupportTheme(message.text),
          keep: message.direction === "inbound" && (routing.relationship === "client" || routing.relationship === "lead" || supportSignal),
        };
      })
      .filter((item) => item.keep)
      .slice(0, 4);

    const contextPack = await this.contextPacks.buildForPrompt(userPrompt, {
      rawPrompt: userPrompt,
      activeUserPrompt: userPrompt,
      historyUserTurns: [],
      orchestration,
      mentionedDomains: [orchestration.route.primaryDomain],
      compoundIntent: /\s+e\s+|depois|em seguida|ao mesmo tempo|junto com/i.test(userPrompt),
    });

    if (supportEmailItems.length === 0 && pendingReplyApprovals.length === 0 && recentSupportMessages.length === 0) {
      return {
        requestId,
        reply: this.responseOs.buildSupportQueueReply({
          objective: "revisar a fila de suporte e atendimento",
          currentSituation: [
            emailStatus.ready
              ? "não encontrei sinais fortes de fila de suporte nas fontes recentes"
              : "email indisponível; análise feita só com sinais locais disponíveis",
          ],
          channelSummary: ["sem sinais suficientes por email ou WhatsApp para montar uma fila real agora"],
          criticalCases: [],
          pendingReplies: [],
          recurringThemes: contextPack?.signals ?? ["validar se a fila de suporte está chegando por email, WhatsApp ou outro canal"],
          recommendedNextStep: "Se quiser, eu posso revisar primeiro o inbox, o WhatsApp ou só as aprovações pendentes.",
        }),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const currentSituation: string[] = [];
    if (supportEmailItems.length > 0) {
      currentSituation.push(`${supportEmailItems.length} email(s) com sinal de suporte ou cliente`);
    }
    if (pendingReplyApprovals.length > 0) {
      currentSituation.push(`${pendingReplyApprovals.length} resposta(s) de WhatsApp aguardando aprovação`);
    }
    if (recentSupportMessages.length > 0) {
      currentSituation.push(`${recentSupportMessages.length} mensagem(ns) inbound recente(s) com contexto de cliente`);
    }
    if (!emailStatus.ready) {
      currentSituation.push(`email indisponível: ${emailStatus.message}`);
    }

    const channelSummary: string[] = [];
    if (supportEmailItems.length > 0) {
      channelSummary.push(`email: ${supportEmailItems.length} caso(s) com sinal de cliente ou suporte`);
    }
    if (recentSupportMessages.length > 0) {
      channelSummary.push(`whatsapp: ${recentSupportMessages.length} mensagem(ns) inbound de cliente`);
    }
    if (pendingReplyApprovals.length > 0) {
      channelSummary.push(`aprovações: ${pendingReplyApprovals.length} resposta(s) pronta(s) para decidir`);
    }

    const criticalCases = [
      ...pendingReplyApprovals.slice(0, 2).map((item) => ({
        label: item.subject,
        channel: "approval" as const,
        detail: "resposta pronta aguardando decisão",
      })),
      ...supportEmailItems.filter((item) => item.urgent).slice(0, 2).map((item) => ({
        label: item.email.subject || "(sem assunto)",
        channel: "email" as const,
        detail: `${item.theme ?? "atendimento geral"} | ${item.summary.action}`,
      })),
      ...recentSupportMessages.filter((item) => item.urgent).slice(0, 2).map((item) => ({
        label: item.message.pushName ?? item.message.number ?? item.message.remoteJid,
        channel: "whatsapp" as const,
        detail: `${item.theme ?? "atendimento geral"} | ${truncateBriefText(item.message.text, 88)}`,
      })),
    ].slice(0, 4);

    const pendingReplies = [
      ...pendingReplyApprovals.slice(0, 3).map((item) => ({
        label: item.subject,
        channel: "approval" as const,
        detail: "revisar rascunho antes de enviar",
      })),
      ...recentSupportMessages.slice(0, 2).map((item) => ({
        label: item.message.pushName ?? item.message.number ?? item.message.remoteJid,
        channel: "whatsapp" as const,
        detail: truncateBriefText(item.message.text, 88),
      })),
    ].slice(0, 4);

    const themeCounts = new Map<string, number>();
    for (const item of [...supportEmailItems, ...recentSupportMessages]) {
      const theme = item.theme;
      if (!theme) {
        continue;
      }
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
    const recurringThemes = [...themeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([theme, count]) => `${theme}: ${count} ocorrência(s)`);

    let recommendedNextStep = "Escolher o primeiro caso para resposta ou priorização.";
    if (pendingReplyApprovals[0]) {
      recommendedNextStep = `Abrir a aprovação mais urgente: ${truncateBriefText(pendingReplyApprovals[0].subject, 96)}.`;
    } else if (criticalCases[0]) {
      recommendedNextStep = `Atacar primeiro o caso crítico em ${criticalCases[0].channel}: ${truncateBriefText(criticalCases[0].label, 96)}.`;
    } else if (recentSupportMessages[0]) {
      recommendedNextStep = `Ler a última mensagem de ${truncateBriefText(recentSupportMessages[0].message.pushName ?? recentSupportMessages[0].message.number ?? recentSupportMessages[0].message.remoteJid, 48)} e decidir a resposta.`;
    } else if (supportEmailItems[0]) {
      recommendedNextStep = `Revisar o email de cliente mais relevante: ${truncateBriefText(supportEmailItems[0].email.subject || "(sem assunto)", 96)}.`;
    }

    return {
      requestId,
      reply: this.responseOs.buildSupportQueueReply({
        objective: "revisar a fila de suporte e atendimento",
        currentSituation,
        channelSummary,
        criticalCases,
        pendingReplies,
        recurringThemes: recurringThemes.length > 0
          ? recurringThemes
          : (contextPack?.signals ?? []).slice(0, 3),
        recommendedNextStep,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "support_review_context",
          resultPreview: JSON.stringify(
            {
              supportEmails: supportEmailItems.length,
              pendingReplyApprovals: pendingReplyApprovals.length,
              recentSupportMessages: recentSupportMessages.length,
              criticalCases: criticalCases.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectInboxTriage(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isInboxTriagePrompt(userPrompt)) {
      return null;
    }

    const unreadOnly = !/todos|all/i.test(userPrompt);
    const limitMatch = userPrompt.match(/\b(\d{1,2})\b/);
    const limit = limitMatch ? Math.min(Math.max(Number.parseInt(limitMatch[1], 10), 1), 20) : 10;
    const emailStatus = await this.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct inbox triage route", {
      limit,
      unreadOnly,
    });

    const emails = await this.email.listRecentMessages({
      limit,
      unreadOnly,
      sinceHours: 168,
    });
    const priorityWeight = {
      alta: 0,
      media: 1,
      baixa: 2,
    } as const;

    const items: InboxTriageItem[] = emails
      .map((email) => {
        const summary = summarizeEmailForOperations({
          subject: email.subject,
          from: email.from,
          text: email.preview,
        });
        const routing = this.communicationRouter.classify({
          channel: "email",
          identifier: extractEmailIdentifier(email.from),
          displayName: email.from.join(", "),
          subject: email.subject,
          text: email.preview,
        });
        return {
          uid: email.uid,
          date: email.date,
          subject: email.subject,
          from: email.from,
          category: summary.category,
          relationship: routing.relationship,
          persona: routing.persona,
          policy: routing.actionPolicy,
          priority: summary.priority,
          status: summary.status,
          action: summary.action,
        } satisfies InboxTriageItem;
      })
      .sort((left, right) => {
        const priorityDelta = priorityWeight[left.priority] - priorityWeight[right.priority];
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return (right.date ?? "").localeCompare(left.date ?? "");
      });

    const categoryCounts = new Map<string, number>();
    const relationshipCounts = new Map<string, number>();
    for (const item of items) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
      relationshipCounts.set(item.relationship, (relationshipCounts.get(item.relationship) ?? 0) + 1);
    }
    const groupSummary = [
      ...[...categoryCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 2)
        .map(([category, count]) => `categoria ${category}: ${count} email(s)`),
      ...[...relationshipCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 2)
        .map(([relationship, count]) => `relação ${relationship}: ${count} email(s)`),
    ];

    return {
      requestId,
      reply: this.responseOs.buildInboxTriageReply({
        scopeLabel: "email principal",
        unreadOnly,
        limit,
        items: items.map((item) => ({
          uid: item.uid,
          subject: item.subject,
          from: item.from,
          relationship: item.relationship,
          priority: item.priority,
          category: item.category,
          action: item.action,
        })),
        groupSummary,
        recommendedNextStep: items[0]
          ? `Executar a próxima ação do UID ${items[0].uid}: ${items[0].action}.`
          : undefined,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "list_recent_emails",
          resultPreview: JSON.stringify(
            {
              total: emails.length,
              unreadOnly,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectFollowUpReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isFollowUpReviewPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct follow-up review route");
    const leads = this.growthOps.listLeads({ limit: 30 });
    const openLeads = leads.filter((lead) => !["won", "lost"].includes(lead.status));
    const overdueItems = openLeads
      .filter((lead) => classifyFollowUpBucket(lead) === "overdue")
      .slice(0, 4)
      .map((lead) => ({
        label: `${lead.name}${lead.company ? ` | ${lead.company}` : ""}`,
        status: lead.status,
        dueLabel: `vencido desde ${formatFollowUpDueLabel(lead.nextFollowUpAt)}`,
      }));
    const todayItems = openLeads
      .filter((lead) => classifyFollowUpBucket(lead) === "today")
      .slice(0, 4)
      .map((lead) => ({
        label: `${lead.name}${lead.company ? ` | ${lead.company}` : ""}`,
        status: lead.status,
        dueLabel: `hoje às ${formatFollowUpDueLabel(lead.nextFollowUpAt)}`,
      }));
    const unscheduledItems = openLeads
      .filter((lead) => classifyFollowUpBucket(lead) === "unscheduled")
      .slice(0, 3)
      .map((lead) => ({
        label: `${lead.name}${lead.company ? ` | ${lead.company}` : ""}`,
        status: lead.status,
        dueLabel: "sem data",
      }));

    const currentSituation = [
      `${openLeads.length} lead(s) abertos no pipeline`,
      `${overdueItems.length} follow-up(s) vencido(s)`,
      `${todayItems.length} follow-up(s) para hoje ou próximas 24h`,
    ];

    const recommendedNextStep = overdueItems[0]
      ? `Atacar primeiro o follow-up vencido de ${truncateBriefText(overdueItems[0].label, 96)}.`
      : todayItems[0]
        ? `Executar o follow-up de hoje: ${truncateBriefText(todayItems[0].label, 96)}.`
        : unscheduledItems[0]
          ? `Definir data para o lead sem follow-up: ${truncateBriefText(unscheduledItems[0].label, 96)}.`
          : "Se quiser, eu posso abrir o pipeline e listar cada lead por estágio.";

    return {
      requestId,
      reply: this.responseOs.buildFollowUpReviewReply({
        scopeLabel: "pipeline e leads ativos",
        currentSituation,
        overdueItems,
        todayItems,
        unscheduledItems,
        recommendedNextStep,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "follow_up_review_context",
          resultPreview: JSON.stringify(
            {
              openLeads: openLeads.length,
              overdue: overdueItems.length,
              today: todayItems.length,
              unscheduled: unscheduledItems.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectNextCommitmentPrep(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isNextCommitmentPrepPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct next commitment prep route");
    const brief = await this.personalOs.getExecutiveMorningBrief();
    const nextEvent = brief.events.find((event) => event.owner === "paulo") ?? brief.events[0];
    if (!nextEvent?.start) {
      return {
        requestId,
        reply: "Não encontrei um próximo compromisso para preparar agora.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const eventDate = new Date(nextEvent.start);
    const todayKey = eventDate.toDateString();
    const nowKey = new Date().toDateString();
    const weatherTip = todayKey === nowKey
      ? brief.weather?.days[0]?.tip
      : brief.weather?.days[1]?.tip ?? brief.weather?.days[0]?.tip;

    const checklist: string[] = [];
    if (nextEvent.context === "externo") {
      checklist.push("confirmar endereço e rota antes de sair");
    }
    if (nextEvent.owner === "delegavel") {
      checklist.push("validar quem será o responsável por tocar esse compromisso");
    } else {
      checklist.push(nextEvent.prepHint);
    }
    if (nextEvent.location) {
      checklist.push(`levar o local salvo: ${summarizeCalendarLocation(nextEvent.location)}`);
    }
    if (weatherTip) {
      checklist.push(weatherTip);
    }
    for (const mobilityAlert of brief.mobilityAlerts.filter((item) => item.startsWith("itens base:")).slice(0, 1)) {
      checklist.push(mobilityAlert);
    }

    const alerts: string[] = [];
    if (nextEvent.hasConflict) {
      alerts.push("há conflito de agenda nesse horário");
    }
    if (nextEvent.context === "externo" && !nextEvent.location) {
      alerts.push("compromisso externo sem local claro");
    }

    return {
      requestId,
      reply: this.responseOs.buildCommitmentPrepReply({
        title: nextEvent.summary,
        startLabel: formatBriefDateTime(nextEvent.start, brief.timezone),
        account: nextEvent.account,
        owner: nextEvent.owner,
        context: nextEvent.context,
        location: nextEvent.location,
        weatherTip,
        checklist,
        alerts,
        recommendedNextStep: alerts[0]
          ? `Resolver primeiro este alerta: ${alerts[0]}.`
          : `${nextEvent.prepHint[0]?.toUpperCase() ?? ""}${nextEvent.prepHint.slice(1)} para ${nextEvent.summary}.`,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "next_commitment_prep",
          resultPreview: JSON.stringify(
            {
              summary: nextEvent.summary,
              start: nextEvent.start,
              owner: nextEvent.owner,
              context: nextEvent.context,
              hasConflict: nextEvent.hasConflict,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private async tryRunDirectEmailDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isEmailDraftPrompt(userPrompt)) {
      return null;
    }

    const emailStatus = await this.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const explicitUid = extractEmailUidFromPrompt(userPrompt);
    const resolvedReference = explicitUid
      ? null
      : await this.resolveEmailReferenceFromPrompt(userPrompt, requestLogger);
    if (!explicitUid && !resolvedReference) {
      return null;
    }
    if (!explicitUid && resolvedReference && !resolvedReference.message) {
      return {
        requestId,
        reply: buildEmailLookupMissReply(resolvedReference.request),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const targetUid = explicitUid ?? resolvedReference?.message?.uid;
    if (!targetUid) {
      return null;
    }

    requestLogger.info("Using direct email drafting route", {
      uid: targetUid,
      resolvedLabel: resolvedReference?.label,
    });

    const emailMessage = await this.email.readMessage(targetUid);
    const recipientName = extractDisplayName(emailMessage.from[0] ?? "");
    const inferredContext = inferReplyContext(userPrompt, emailMessage.subject, emailMessage.text);
    const tone = extractToneHint(userPrompt);
    const exactReplyBody = extractExactReplyBody(userPrompt);
    const deterministicDraft = exactReplyBody
      ? exactReplyBody
      : hasAffirmativeIntent(userPrompt)
        ? buildAffirmativeReplyTemplate({
            recipientName,
            context: inferredContext,
            tone,
          })
        : hasRejectionIntent(userPrompt)
          ? buildRejectionReplyTemplate({
              recipientName,
              tone,
            })
          : undefined;
    const draftingMessages: ConversationMessage[] = [
      ...buildBaseMessages(userPrompt, orchestration).slice(0, 2),
      {
        role: "system",
        content: [
          "Você está redigindo uma resposta de email e não deve usar ferramentas nesta etapa.",
          "Escreva em português, de forma elegante e prática, considerando o contexto pessoal ou profissional indicado pelo usuário.",
          "Retorne somente o corpo final do email em texto puro.",
          "Não inclua explicações, introduções, markdown, assunto, blocos de código ou placeholders genéricos como [seu nome].",
          "Não invente atrasos, desculpas, contexto extra ou fatos que não estejam no email original ou no pedido do usuário.",
          "Se o usuário estiver aceitando um contato ou oportunidade, responda com clareza, objetividade e próximos passos.",
          "Se você não souber a assinatura nominal do usuário, finalize sem inventar nome próprio.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Pedido do usuário:",
          userPrompt,
          "",
          "Email original:",
          `UID: ${emailMessage.uid}`,
          `Assunto: ${emailMessage.subject}`,
          `De: ${emailMessage.from.join(", ") || "(desconhecido)"}`,
          `Para: ${emailMessage.to.join(", ") || "(desconhecido)"}`,
          `CC: ${emailMessage.cc.join(", ") || "(vazio)"}`,
          "",
          "Corpo do email original:",
          emailMessage.text || "(sem conteúdo textual)",
        ].join("\n"),
      },
    ];

    const response = deterministicDraft
      ? {
          message: {
            role: "assistant" as const,
            content: deterministicDraft,
          },
        }
      : await this.client.chat({
          messages: draftingMessages,
        });
    const draftBody =
      stripCodeFences(response.message.content ?? "").trim() ||
      "Não foi possível redigir a resposta do email nesta tentativa.";
    const targetLabel = explicitUid
      ? `o email UID ${targetUid}`
      : `o email mais recente para ${resolvedReference?.label ?? "o filtro informado"}`;
    const reply = draftBody.startsWith("Não foi possível")
      ? draftBody
      : [
          `Rascunho pronto para ${targetLabel}.`,
          "",
          draftBody,
          "",
          "EMAIL_REPLY_DRAFT",
          `uid=${targetUid}`,
          "body:",
          draftBody,
          "END_EMAIL_REPLY_DRAFT",
        ].join("\n");

    return {
      requestId,
      reply,
      messages: [...draftingMessages, response.message],
      toolExecutions: [
        {
          toolName: "read_email_message",
          resultPreview: JSON.stringify(
            {
              uid: emailMessage.uid,
              subject: emailMessage.subject,
              from: emailMessage.from,
            },
            null,
            2,
          ).slice(0, 240),
        },
      ],
    };
  }

  private async tryRunDirectPing(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const normalizedPrompt = userPrompt.toLowerCase();
    const requestsPingTool =
      normalizedPrompt.includes("ferramenta ping") ||
      normalizedPrompt.includes("use ping") ||
      normalizedPrompt.trim().endsWith("ping");

    if (!requestsPingTool || !this.pluginRegistry.hasTool("ping")) {
      return null;
    }

    requestLogger.info("Using direct tool route", {
      tool: "ping",
    });

    const execution = await this.pluginRegistry.execute("ping", {}, {
      requestId,
      toolCallId: randomUUID(),
      config: this.config,
      logger: requestLogger.child({ tool: "ping", toolCallId: "direct" }),
      fileAccess: this.fileAccess,
      memory: this.memory,
      preferences: this.preferences,
      personalMemory: this.personalMemory,
      growthOps: this.growthOps,
      contentOps: this.contentOps,
      socialAssistant: this.socialAssistant,
      workflows: this.workflows,
      email: this.email,
      emailWriter: this.emailWriter,
      emailAccounts: this.emailAccounts,
      googleWorkspace: this.googleWorkspace,
      googleWorkspaces: this.googleWorkspaces,
      projectOps: this.projectOps,
      safeExec: this.safeExec,
      orchestration,
    });

    const rawResult =
      execution.rawResult && typeof execution.rawResult === "object"
        ? (execution.rawResult as Record<string, unknown>)
        : undefined;
    const pongValue =
      rawResult && typeof rawResult.pong === "string" ? rawResult.pong : "pong";
    const timestampValue =
      rawResult && typeof rawResult.timestamp === "string" ? rawResult.timestamp : undefined;

    return {
      requestId,
      reply: timestampValue
        ? `Resultado do ping: ${pongValue}\nTimestamp: ${timestampValue}`
        : `Resultado do ping: ${pongValue}`,
      messages: [
        ...buildBaseMessages(userPrompt, orchestration),
        {
          role: "tool",
          tool_name: "ping",
          content: execution.content,
        },
      ],
      toolExecutions: [
        {
          toolName: "ping",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }

}

export interface AgentCoreRequestRuntime extends Pick<
  AgentCore,
  "runUserPrompt" | "resolveStructuredTaskOperationPayload" | "executeToolDirect"
> {}
