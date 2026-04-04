import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../types/config.js";
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
import { ProjectOpsService } from "./project-ops.js";
import { SafeExecService } from "./safe-exec.js";
import { ToolPluginRegistry } from "./plugin-registry.js";
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
import type { EmailWriter } from "../integrations/email/email-writer.js";
import {
  normalizeEmailAnalysisText,
  summarizeEmailForOperations,
  type EmailOperationalGroup,
  type EmailOperationalSummary,
} from "../integrations/email/email-analysis.js";
import { GoogleMapsService, type GooglePlaceLookupResult } from "../integrations/google/google-maps.js";
import type { CalendarListSummary, DailyOperationalBrief, TaskSummary } from "../integrations/google/google-workspace.js";
import { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import { SupabaseMacCommandQueue } from "../integrations/supabase/mac-command-queue.js";
import { EvolutionApiClient, type EvolutionRecentChatRecord } from "../integrations/whatsapp/evolution-api.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type {
  CreateWorkflowPlanInput,
  WorkflowArtifactRecord,
  WorkflowPlanRecord,
  WorkflowStepRecord,
} from "../types/workflow.js";
import { WebResearchService, type WebResearchMode } from "./web-research.js";
import { GoogleTrendsIntakeService, type GoogleTrendItem } from "./trend-intake.js";

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
  const hasTriageIntent = ["triagem", "triage", "classifique", "priorize", "prioridade"].some((token) =>
    normalized.includes(token),
  );
  const hasInboxIntent = ["inbox", "caixa de entrada", "emails recentes", "emails nao lidos", "emails não lidos"].some((token) =>
    normalized.includes(token),
  );
  return hasTriageIntent && hasInboxIntent;
}

function isOperationalBriefPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return [
    "brief diario",
    "brief diário",
    "meu dia",
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
    "bom dia atlas",
    "me de o resumo da manha",
    "me de o resumo da manhã",
  ].some((token) => normalized.includes(token));
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

function isWeatherPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "previsao do tempo",
    "previsão do tempo",
    "clima em",
    "tempo em",
    "temperatura em",
    "vai chover em",
    "chuva em",
  ]);
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
    const value = match?.[1]?.trim().replace(/[.,;:!?]+$/g, "").trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function buildWeatherReply(result: {
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
  const lines = [`Previsão do tempo para ${result.locationLabel}.`];

  if (result.current) {
    lines.push(
      `- Agora: ${result.current.description}, ${result.current.temperatureC ?? "?"}°C` +
        (typeof result.current.apparentTemperatureC === "number"
          ? `, sensação ${result.current.apparentTemperatureC}°C`
          : "") +
        (typeof result.current.humidityPercent === "number"
          ? `, umidade ${result.current.humidityPercent}%`
          : "") +
        (typeof result.current.windSpeedKmh === "number"
          ? `, vento ${result.current.windSpeedKmh} km/h`
          : ""),
    );
  }

  if (result.daily.length > 0) {
    lines.push("", "Próximos dias:");
    for (const day of result.daily.slice(0, 3)) {
      lines.push(
        `- ${day.date}: ${day.description}` +
          (typeof day.minTempC === "number" && typeof day.maxTempC === "number"
            ? ` | min ${day.minTempC}°C / max ${day.maxTempC}°C`
            : "") +
          (typeof day.precipitationProbabilityMax === "number"
            ? ` | chuva ${day.precipitationProbabilityMax}%`
            : "") +
          (typeof day.precipitationSumMm === "number"
            ? ` | volume ${day.precipitationSumMm} mm`
            : ""),
      );
    }
  }

  lines.push("", "Fonte: Open-Meteo");
  return lines.join("\n");
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
  return (
    includesAny(normalized, [
      "liste meus compromissos",
      "liste meus eventos",
      "quais compromissos tenho",
      "quais eventos tenho",
      "mostre minha agenda",
      "mostrar minha agenda",
    ]) &&
    !normalized.includes("calendario editorial") &&
    !normalized.includes("calendário editorial")
  );
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

function extractCalendarMoveParts(prompt: string): { source: string; targetInstruction: string } | undefined {
  const match = prompt.match(
    /\b(?:mova|mover|reagende|reagendar|mude|altere)\s+o?\s*evento\s+(.+?)\s+para\s+([\s\S]+)/i,
  );
  if (!match?.[1] || !match?.[2]) {
    return undefined;
  }
  return {
    source: match[1].trim(),
    targetInstruction: match[2].trim(),
  };
}

function isCalendarDeletePrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "cancele o evento",
    "cancela o evento",
    "exclua o evento",
    "excluir o evento",
    "delete o evento",
    "remova o evento",
  ]);
}

function extractCalendarDeleteTopic(prompt: string): string | undefined {
  const patterns = [
    /\b(?:cancele|cancela|exclua|excluir|delete|remova)\s+o?\s*evento\s+["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\?|$))/i,
    /\b(?:cancele|cancela|exclua|excluir|delete|remova)\s+["“]?(.+?)["”]?(?=(?:\s+amanh[ãa]|\s+hoje|\s+dia\s+\d|\s+em\s+\d{1,2}\/\d{1,2}|\?|$))/i,
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
  const normalized = normalizeEmailAnalysisText(prompt);
  for (const alias of aliases) {
    if (alias === "primary") {
      continue;
    }

    const readable = alias.replace(/_/g, " ");
    if (
      normalized.includes(`conta ${readable}`) ||
      normalized.includes(`account ${readable}`) ||
      normalized.includes(`calendario ${readable}`) ||
      normalized.includes(`calendário ${readable}`) ||
      normalized.includes(`email ${readable}`) ||
      normalized.includes(readable)
    ) {
      return alias;
    }
  }

  return undefined;
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
  const normalized = value?.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim() ?? "";
  if (!normalized) {
    return false;
  }

  return normalized.includes("teste controlado");
}

function buildOperationalBriefReply(input: {
  brief: DailyOperationalBrief;
  focus: Array<{ title: string; whyNow: string; nextAction: string }>;
}): string {
  const lines = [
    `Brief diário gerado para ${input.brief.timezone}.`,
    `- Eventos hoje: ${input.brief.events.length}`,
    `- Tarefas abertas: ${input.brief.tasks.length}`,
    `- Focos operacionais: ${input.focus.length}`,
    "",
    "Agenda de hoje:",
  ];

  if (input.brief.events.length === 0) {
    lines.push("- Nenhum compromisso encontrado para hoje.");
  } else {
    for (const event of input.brief.events.slice(0, 6)) {
      lines.push(
        `- ${formatBriefDateTime(event.start, input.brief.timezone)} | ${event.summary}${event.location ? ` | ${event.location}` : ""}`,
      );
    }
  }

  lines.push("", "Tarefas prioritárias:");
  if (input.brief.tasks.length === 0) {
    lines.push("- Nenhuma tarefa encontrada para a janela do dia.");
  } else {
    for (const task of input.brief.tasks.slice(0, 6)) {
      lines.push(`- ${task.title} (${task.taskListTitle}) | prazo: ${formatTaskDue(task, input.brief.timezone)}`);
    }
  }

  lines.push("", "Foco do agente:");
  if (input.focus.length === 0) {
    lines.push("- Nenhum foco salvo na memória operacional.");
  } else {
    for (const item of input.focus) {
      lines.push(`- ${item.title} | por que agora: ${item.whyNow} | próxima ação: ${item.nextAction}`);
    }
  }

  return lines.join("\n");
}

function buildMorningBriefReply(input: {
  timezone: string;
  events: Array<{ account: string; summary: string; start: string | null; location?: string; matchedTerms?: string[] }>;
  tasks: Array<TaskSummary & { account: string }>;
  emails: Array<{
    account: string;
    uid: string;
    subject: string;
    from: string[];
    priority: string;
    action: string;
    relationship: string;
  }>;
  approvals: Array<{ subject: string; actionKind: string; channel: string }>;
  workflows: Array<{ id: number; title: string; status: string; nextAction: string | null }>;
  focus: Array<{ title: string; nextAction: string }>;
  nextAction?: string;
}): string {
  const attentionNow: string[] = [];
  const highestEmail = input.emails.find((item) => item.priority === "alta") ?? input.emails[0];
  const nextEvent = input.events[0];
  const nextTask = input.tasks[0];
  const topWorkflow = input.workflows[0];

  if (input.approvals.length > 0) {
    attentionNow.push(`${input.approvals.length} aprovação(ões) pendente(s).`);
  }

  if (highestEmail) {
    attentionNow.push(
      `${highestEmail.priority.toUpperCase()} email: ${truncateBriefText(highestEmail.subject || "(sem assunto)")} — ${summarizeEmailSender(highestEmail.from)} — ${highestEmail.account}`,
    );
  }

  if (nextEvent) {
    attentionNow.push(
      `Próximo compromisso: ${formatBriefDateTime(nextEvent.start, input.timezone)} — ${truncateBriefText(nextEvent.summary)}${nextEvent.location ? ` — ${summarizeCalendarLocation(nextEvent.location)}` : ""}`,
    );
  }

  if (nextTask) {
    attentionNow.push(
      `Tarefa mais próxima: ${truncateBriefText(nextTask.title)} — ${formatTaskDue(nextTask, input.timezone)} — ${nextTask.account}`,
    );
  }

  if (!nextEvent && !nextTask && topWorkflow) {
    attentionNow.push(`Workflow #${topWorkflow.id}: ${truncateBriefText(topWorkflow.title)}`);
  }

  const lines = [
    "Briefing da manhã",
    "",
    "Resumo rápido:",
    `- Hoje: ${input.events.length} compromisso(s) | ${input.tasks.length} tarefa(s) | ${input.emails.length} email(s)`,
    `- Pendências: ${input.approvals.length} aprovação(ões) | ${input.workflows.length} workflow(s)`,
  ];

  if (attentionNow.length > 0) {
    lines.push("", "Atenção agora:");
    for (const item of attentionNow.slice(0, 3)) {
      lines.push(`- ${item}`);
    }
  }

  lines.push("", "Agenda de hoje:");
  if (input.events.length > 0) {
    for (const event of input.events.slice(0, 3)) {
      lines.push(
        `- ${formatBriefDateTime(event.start, input.timezone)} — ${truncateBriefText(event.summary)}${event.location ? ` — ${summarizeCalendarLocation(event.location)}` : ""} — ${event.account}${event.matchedTerms?.length ? " — seu" : ""}`,
      );
    }
    if (input.events.length > 3) {
      lines.push(`- ... e mais ${input.events.length - 3} compromisso(s).`);
    }
  } else {
    lines.push("- Nenhum compromisso pessoal hoje.");
  }

  lines.push("", "Tarefas em foco:");
  if (input.tasks.length > 0) {
    for (const task of input.tasks.slice(0, 3)) {
      lines.push(`- ${truncateBriefText(task.title)} — ${formatTaskDue(task, input.timezone)} — ${task.account}`);
    }
    if (input.tasks.length > 3) {
      lines.push(`- ... e mais ${input.tasks.length - 3} tarefa(s).`);
    }
  } else {
    lines.push("- Nenhuma tarefa aberta em foco.");
  }

  lines.push("", "Inbox primeiro:");
  if (input.emails.length > 0) {
    for (const item of input.emails.slice(0, 3)) {
      lines.push(
        `- ${item.priority.toUpperCase()} — ${truncateBriefText(item.subject || "(sem assunto)")} — ${summarizeEmailSender(item.from)} — ${item.account}`,
      );
    }
    if (input.emails.length > 3) {
      lines.push(`- ... e mais ${input.emails.length - 3} email(s) prioritário(s).`);
    }
  } else {
    lines.push("- Nenhum email prioritário agora.");
  }

  if (input.approvals.length > 0) {
    lines.push("", "Aprovações:");
    for (const item of input.approvals.slice(0, 3)) {
      lines.push(`- ${truncateBriefText(item.subject)} — ${item.actionKind} — ${item.channel}`);
    }
    if (input.approvals.length > 3) {
      lines.push(`- ... e mais ${input.approvals.length - 3} aprovação(ões).`);
    }
  }

  if (input.workflows.length > 0) {
    lines.push("", "Radar:");
    for (const workflow of input.workflows.slice(0, 2)) {
      lines.push(`#${workflow.id} ${truncateBriefText(workflow.title)} — ${workflow.status}`);
    }
    if (input.workflows.length > 2) {
      lines.push(`- ... e mais ${input.workflows.length - 2} workflow(s).`);
    }
  } else if (input.focus.length > 0) {
    lines.push("", "Radar:");
    for (const item of input.focus.slice(0, 2)) {
      lines.push(`- ${truncateBriefText(item.title)}${item.nextAction ? ` — ${truncateBriefText(item.nextAction, 56)}` : ""}`);
    }
  }

  if (input.nextAction) {
    lines.push("", `Próxima ação: ${truncateBriefText(input.nextAction, 96)}`);
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

function extractWorkflowStepStatus(prompt: string): "pending" | "in_progress" | "blocked" | "completed" | undefined {
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
  if (includesAny(normalized, ["bloqueada", "bloqueado", "bloqueie", "bloquear"])) {
    return "blocked";
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

  const lines = [`Pesquisa para: ${input.query}`];
  if (input.aliasLabel) {
    lines.push(`Entidade reconhecida: ${input.aliasLabel}`);
  }

  if (input.results.length > 0) {
    lines.push("", "Fontes priorizadas:");
  }
  for (const [index, item] of input.results.entries()) {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   Fonte: ${item.sourceHost || item.url}`);
    lines.push(`   URL: ${item.url}`);
    if (item.publishedAt) {
      lines.push(`   Publicado: ${item.publishedAt}`);
    }
    if (item.snippet) {
      lines.push(`   Resumo: ${item.snippet}`);
    } else if (item.excerpt) {
      lines.push(`   Trecho: ${item.excerpt.slice(0, 240)}`);
    }
  }

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
  mode: string;
  targetDurationSeconds: number;
  headlineOptions: string[];
  script: string;
  description: string;
  scenes: Array<{
    order: number;
    durationSeconds: number;
    voiceover: string;
    overlay: string;
    visualDirection: string;
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
}): string {
  return [
    `Roteiro pronto para o item #${input.item.id}.`,
    `- Título de trabalho: ${input.item.title}`,
    `- Modo: ${input.mode}`,
    `- Duração alvo: ${input.targetDurationSeconds}s`,
    ...(input.item.hook ? [`- Hook final: ${input.item.hook}`] : []),
    ...(input.item.callToAction ? [`- CTA: ${input.item.callToAction}`] : []),
    "",
    "Sugestões de título:",
    ...input.headlineOptions.slice(0, 3).map((title) => `- ${title}`),
    "",
    "Roteiro:",
    input.script,
    "",
    "Plano por cena:",
    ...input.scenes.map((scene) =>
      `- Cena ${scene.order} | ${scene.durationSeconds}s | VO: ${scene.voiceover} | overlay: ${scene.overlay} | visual: ${scene.visualDirection}`,
    ),
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
  voiceover: string;
  overlay: string;
  visualDirection: string;
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

function clampShortDuration(value: number | undefined, fallback = 42): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(28, Math.min(55, Math.round(value)));
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
      && scene.visualDirection.trim().length > 0,
    )
    .slice(0, 5)
    .map((scene, index) => ({
      order: index + 1,
      durationSeconds: clampShortDuration(scene.durationSeconds, 8),
      voiceover: scene.voiceover.trim(),
      overlay: scene.overlay.trim(),
      visualDirection: scene.visualDirection.trim(),
    }));
}

function buildShortFormFallbackPackage(input: {
  item: {
    title: string;
    pillar: string | null;
    hook: string | null;
  };
  platform: string;
}): {
  mode: string;
  targetDurationSeconds: number;
  hook: string;
  script: string;
  cta: string;
  description: string;
  titleOptions: string[];
  scenes: ShortScenePlan[];
  platformVariants: ShortPlatformVariants;
} {
  const hook = input.item.hook?.trim()
    || `Se você errar isso em ${input.item.title.toLowerCase()}, vai perder dinheiro sem perceber.`;
  const cta = "Comente \"parte 2\" se quiser a continuação prática.";
  const titleBase = input.item.title.trim();
  const titleOptions = [
    titleBase,
    `O erro por trás de ${titleBase.toLowerCase()}`,
    `${titleBase}: o que quase ninguém explica`,
  ];
  const scenes: ShortScenePlan[] = [
    {
      order: 1,
      durationSeconds: 7,
      voiceover: hook,
      overlay: "ERRO QUE CUSTA CARO",
      visualDirection: "texto forte em tela + corte rápido + destaque visual no problema",
    },
    {
      order: 2,
      durationSeconds: 8,
      voiceover: `A maioria olha só para ${input.item.pillar ?? "o resultado"} e ignora o mecanismo que gera caixa.`,
      overlay: "OLHAR SÓ O RESULTADO É ARMADILHA",
      visualDirection: "b-roll de dashboard, vendas, computador ou rotina de trabalho",
    },
    {
      order: 3,
      durationSeconds: 10,
      voiceover: `A regra prática aqui é simples: ${titleBase.toLowerCase()} precisa aumentar valor percebido sem travar conversão.`,
      overlay: "REGRA PRÁTICA",
      visualDirection: "close em planilha, pricing page, números ou cards de oferta",
    },
    {
      order: 4,
      durationSeconds: 9,
      voiceover: "Se não melhorar retenção, margem ou conversão, não é estratégia. É só ruído.",
      overlay: "SEM RETENÇÃO, MARGEM OU CONVERSÃO = RUÍDO",
      visualDirection: "comparação antes/depois, gráficos simples, setas e cortes secos",
    },
    {
      order: 5,
      durationSeconds: 6,
      voiceover: cta,
      overlay: "QUER A PARTE 2?",
      visualDirection: "encerramento com texto forte e tela limpa para CTA",
    },
  ];
  const script = scenes.map((scene) => scene.voiceover).join(" ");
  const description = `${titleBase}. Short direto do Riqueza Despertada com uma ideia central, mecanismo claro e aplicação prática.`;
  const platformVariants: ShortPlatformVariants = {
    youtubeShort: {
      title: titleOptions[0],
      coverText: "ERRO QUE CUSTA CARO",
      caption: `${titleBase}. Ideia prática para quem quer riqueza com execução.`,
    },
    tiktok: {
      hook,
      coverText: "PARE DE PERDER DINHEIRO NISSO",
      caption: `${titleBase}. Sem enrolação, sem fórmula mágica, só mecanismo real.`,
    },
  };

  return {
    mode: "viral_short",
    targetDurationSeconds: 40,
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
  }>;
  fallbackMode: boolean;
}): string {
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
  if (input.selectedTrends.length > 0) {
    lines.push("", "Trends considerados:");
    for (const trend of input.selectedTrends.slice(0, 3)) {
      lines.push(
        `- ${trend.title}${trend.approxTraffic ? ` | tráfego: ${trend.approxTraffic}` : ""}${trend.fitScore != null ? ` | fit: ${trend.fitScore}` : ""}${trend.angle ? ` | ângulo: ${truncateBriefText(trend.angle, 60)}` : ""}`,
      );
    }
  }
  lines.push("", "Pautas sugeridas:");
  for (const item of input.items.slice(0, 5)) {
    lines.push(
      `- #${item.id} | ${item.title}${item.ideaScore != null ? ` | score: ${item.ideaScore}` : ""}${item.formatTemplateKey ? ` | formato: ${item.formatTemplateKey}` : ""}${item.seriesKey ? ` | série: ${item.seriesKey}` : ""}`,
    );
  }
  lines.push("", "Próxima ação: revise a fila e aprove o primeiro item forte.");
  return lines.join("\n");
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

export class AgentCore {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fileAccess: FileAccessPolicy,
    private readonly client: LlmClient,
    private readonly pluginRegistry: ToolPluginRegistry,
    private readonly memory: OperationalMemoryStore,
    private readonly preferences: UserPreferencesStore,
    private readonly growthOps: GrowthOpsStore,
    private readonly contentOps: ContentOpsStore,
    private readonly socialAssistant: SocialAssistantStore,
    private readonly contacts: ContactIntelligenceStore,
    private readonly communicationRouter: CommunicationRouter,
    private readonly approvals: ApprovalInboxStore,
    private readonly whatsappMessages: WhatsAppMessageStore,
    private readonly workflows: WorkflowOrchestratorStore,
    private readonly macCommandQueue: SupabaseMacCommandQueue,
    private readonly email: EmailReader,
    private readonly emailWriter: EmailWriter,
    private readonly emailAccounts: EmailAccountsService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly googleWorkspaces: GoogleWorkspaceAccountsService,
    private readonly googleMaps: GoogleMapsService,
    private readonly projectOps: ProjectOpsService,
    private readonly safeExec: SafeExecService,
  ) {}

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
    const ideasLimit = Math.min(Math.max(input?.ideasLimit ?? 5, 1), 8);

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
      title: string;
      hook?: string;
      pillar?: string;
      audience?: string;
      formatTemplateKey?: string;
      seriesKey?: string | null;
      notes?: string;
    };

    let generatedIdeas: GeneratedIdea[] = buildFallbackEditorialIdeas({
      channelName: channel.name,
      seed: fallbackMode ? "formas reais de ganhar dinheiro, SaaS e produtos digitais" : usableTrends[0]?.title,
      formatKeys: formats.map((item) => item.key),
      seriesKeys: series.map((item) => item.key),
      limit: ideasLimit,
    }).map((idea) => ({
      ...idea,
      audience: channel.persona ?? idea.audience,
      notes: `${idea.notes}${fallbackMode ? " | fallback evergreen por baixa aderência do trend." : ""}`,
    }));

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
              "Cada item: title, hook, pillar, audience, formatTemplateKey, seriesKey, notes.",
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
              `Quantidade: ${ideasLimit}`,
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
          .slice(0, ideasLimit)
          .map((item) => ({
            title: item.title.trim(),
            hook: typeof item.hook === "string" ? item.hook.trim() : undefined,
            pillar: typeof item.pillar === "string" ? item.pillar.trim() : undefined,
            audience: item.audience ?? channel.persona ?? "público buscando riqueza e renda",
            formatTemplateKey: item.formatTemplateKey,
            seriesKey: item.seriesKey,
            notes: typeof item.notes === "string" ? item.notes.trim() : undefined,
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

    const reply = buildDailyEditorialResearchReply({
      channelName: channel.name,
      runDate,
      primaryTrend: usableTrends[0]?.title,
      selectedTrends: usableTrends,
      items: savedItems,
      fallbackMode,
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
      }),
    });

    return {
      reply,
      runDate,
      createdItemIds: savedItems.map((item) => item.id),
      skipped: false,
    };
  }

  async runUserPrompt(userPrompt: string): Promise<AgentRunResult> {
    const requestId = randomUUID();
    const requestLogger = this.logger.child({ requestId });
    const activeUserPrompt = extractActiveUserPrompt(userPrompt);
    const orchestration = buildOrchestrationContext(activeUserPrompt);
    const preferences = this.preferences.get();

    requestLogger.info("Resolved orchestration context", {
      primaryDomain: orchestration.route.primaryDomain,
      secondaryDomains: orchestration.route.secondaryDomains,
      actionMode: orchestration.route.actionMode,
      confidence: orchestration.route.confidence,
      riskLevel: orchestration.policy.riskLevel,
      autonomyLevel: orchestration.policy.autonomyLevel,
    });

    const directPingResult = await this.tryRunDirectPing(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directPingResult) {
      return directPingResult;
    }
    const directIdentityResult = await this.tryRunDirectAgentIdentity(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directIdentityResult) {
      return directIdentityResult;
    }
    const directPreferencesResult = await this.tryRunDirectUserPreferences(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directPreferencesResult) {
      return directPreferencesResult;
    }
    const directMorningBriefResult = await this.tryRunDirectMorningBrief(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directMorningBriefResult) {
      return directMorningBriefResult;
    }
    const directMacQueueStatusResult = await this.tryRunDirectMacQueueStatus(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directMacQueueStatusResult) {
      return directMacQueueStatusResult;
    }
    const directMacQueueListResult = await this.tryRunDirectMacQueueList(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directMacQueueListResult) {
      return directMacQueueListResult;
    }
    const directMacQueueEnqueueResult = await this.tryRunDirectMacQueueEnqueue(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directMacQueueEnqueueResult) {
      return directMacQueueEnqueueResult;
    }
    const directContactListResult = await this.tryRunDirectContactList(
      activeUserPrompt,
      requestId,
      orchestration,
      preferences,
    );
    if (directContactListResult) {
      return directContactListResult;
    }
    const directContactUpsertResult = await this.tryRunDirectContactUpsert(
      activeUserPrompt,
      requestId,
      orchestration,
      preferences,
    );
    if (directContactUpsertResult) {
      return directContactUpsertResult;
    }
    const directWorkflowListResult = await this.tryRunDirectWorkflowList(
      activeUserPrompt,
      requestId,
      orchestration,
      preferences,
    );
    if (directWorkflowListResult) {
      return directWorkflowListResult;
    }
    const directWorkflowShowResult = await this.tryRunDirectWorkflowShow(
      activeUserPrompt,
      requestId,
      orchestration,
      preferences,
    );
    if (directWorkflowShowResult) {
      return directWorkflowShowResult;
    }
    const directWorkflowArtifactsResult = await this.tryRunDirectWorkflowArtifacts(
      activeUserPrompt,
      requestId,
      orchestration,
      preferences,
    );
    if (directWorkflowArtifactsResult) {
      return directWorkflowArtifactsResult;
    }
    const directWorkflowExecutionResult = await this.tryRunDirectWorkflowExecution(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    );
    if (directWorkflowExecutionResult) {
      return directWorkflowExecutionResult;
    }
    const directWorkflowStepUpdateResult = await this.tryRunDirectWorkflowStepUpdate(
      activeUserPrompt,
      requestId,
      orchestration,
      preferences,
    );
    if (directWorkflowStepUpdateResult) {
      return directWorkflowStepUpdateResult;
    }
    const directWorkflowPlanningResult = await this.tryRunDirectWorkflowPlanning(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    );
    if (directWorkflowPlanningResult) {
      return directWorkflowPlanningResult;
    }
    const directMemoryUpdateGuardResult = await this.tryRunDirectMemoryUpdateGuard(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directMemoryUpdateGuardResult) {
      return directMemoryUpdateGuardResult;
    }
    const directInboxTriageResult = await this.tryRunDirectInboxTriage(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directInboxTriageResult) {
      return directInboxTriageResult;
    }
    const directOperationalBriefResult = await this.tryRunDirectOperationalBrief(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directOperationalBriefResult) {
      return directOperationalBriefResult;
    }
    const directCalendarLookupResult = await this.tryRunDirectCalendarLookup(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directCalendarLookupResult) {
      return directCalendarLookupResult;
    }
    const directCalendarPeriodListResult = await this.tryRunDirectCalendarPeriodList(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directCalendarPeriodListResult) {
      return directCalendarPeriodListResult;
    }
    const directGoogleTaskDraftResult = await this.tryRunDirectGoogleTaskDraft(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleTaskDraftResult) {
      return directGoogleTaskDraftResult;
    }
    const directGoogleEventDraftResult = await this.tryRunDirectGoogleEventDraft(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleEventDraftResult) {
      return directGoogleEventDraftResult;
    }
    const directGoogleEventMoveResult = await this.tryRunDirectGoogleEventMove(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleEventMoveResult) {
      return directGoogleEventMoveResult;
    }
    const directGoogleEventDeleteResult = await this.tryRunDirectGoogleEventDelete(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleEventDeleteResult) {
      return directGoogleEventDeleteResult;
    }
    const directGoogleTasksResult = await this.tryRunDirectGoogleTasks(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleTasksResult) {
      return directGoogleTasksResult;
    }
    const directGoogleContactsResult = await this.tryRunDirectGoogleContacts(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleContactsResult) {
      return directGoogleContactsResult;
    }
    const directGoogleCalendarsResult = await this.tryRunDirectGoogleCalendarsList(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directGoogleCalendarsResult) {
      return directGoogleCalendarsResult;
    }
    const directPlaceLookupResult = await this.tryRunDirectPlaceLookup(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directPlaceLookupResult) {
      return directPlaceLookupResult;
    }
    const directWhatsAppSendResult = await this.tryRunDirectWhatsAppSend(
      activeUserPrompt,
      userPrompt,
      requestId,
      orchestration,
    );
    if (directWhatsAppSendResult) {
      return directWhatsAppSendResult;
    }
    const directWhatsAppRecentSearchResult = await this.tryRunDirectWhatsAppRecentSearch(
      activeUserPrompt,
      userPrompt,
      requestId,
      orchestration,
    );
    if (directWhatsAppRecentSearchResult) {
      return directWhatsAppRecentSearchResult;
    }
    const directWhatsAppPendingApprovalsResult = await this.tryRunDirectWhatsAppPendingApprovals(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directWhatsAppPendingApprovalsResult) {
      return directWhatsAppPendingApprovalsResult;
    }
    const directWeatherResult = await this.tryRunDirectWeather(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directWeatherResult) {
      return directWeatherResult;
    }
    const directInternalKnowledgeResult = await this.tryRunDirectInternalKnowledgeLookup(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directInternalKnowledgeResult) {
      return directInternalKnowledgeResult;
    }
    const directWebResearchResult = await this.tryRunDirectWebResearch(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directWebResearchResult) {
      return directWebResearchResult;
    }
    const directRevenueScoreboardResult = await this.tryRunDirectRevenueScoreboard(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directRevenueScoreboardResult) {
      return directRevenueScoreboardResult;
    }
    const directAllowedSpacesResult = await this.tryRunDirectAllowedSpaces(
      activeUserPrompt,
      requestId,
      orchestration,
    );
    if (directAllowedSpacesResult) {
      return directAllowedSpacesResult;
    }
    const directProjectScanResult = await this.tryRunDirectProjectScan(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directProjectScanResult) {
      return directProjectScanResult;
    }
    const directProjectMirrorResult = await this.tryRunDirectProjectMirror(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directProjectMirrorResult) {
      return directProjectMirrorResult;
    }
    const directSafeExecResult = await this.tryRunDirectSafeExec(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directSafeExecResult) {
      return directSafeExecResult;
    }
    const directDailyEditorialResearchResult = await this.tryRunDirectDailyEditorialResearch(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directDailyEditorialResearchResult) {
      return directDailyEditorialResearchResult;
    }
    const directContentIdeaGenerationResult = await this.tryRunDirectContentIdeaGeneration(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentIdeaGenerationResult) {
      return directContentIdeaGenerationResult;
    }
    const directContentReviewResult = await this.tryRunDirectContentReview(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentReviewResult) {
      return directContentReviewResult;
    }
    const directContentScriptResult = await this.tryRunDirectContentScriptGeneration(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentScriptResult) {
      return directContentScriptResult;
    }
    const directContentChannelsResult = await this.tryRunDirectContentChannels(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentChannelsResult) {
      return directContentChannelsResult;
    }
    const directContentSeriesResult = await this.tryRunDirectContentSeries(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentSeriesResult) {
      return directContentSeriesResult;
    }
    const directContentFormatLibraryResult = await this.tryRunDirectContentFormatLibrary(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentFormatLibraryResult) {
      return directContentFormatLibraryResult;
    }
    const directContentHookLibraryResult = await this.tryRunDirectContentHookLibrary(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentHookLibraryResult) {
      return directContentHookLibraryResult;
    }
    const directContentOverviewResult = await this.tryRunDirectContentOverview(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directContentOverviewResult) {
      return directContentOverviewResult;
    }
    const directCaseNotesResult = await this.tryRunDirectCaseNotes(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directCaseNotesResult) {
      return directCaseNotesResult;
    }
    const directEmailDraftResult = await this.tryRunDirectEmailDraft(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directEmailDraftResult) {
      return directEmailDraftResult;
    }
    const directEmailSummaryResult = await this.tryRunDirectEmailSummary(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directEmailSummaryResult) {
      return directEmailSummaryResult;
    }
    const directEmailLookupResult = await this.tryRunDirectEmailLookup(
      activeUserPrompt,
      requestId,
      requestLogger,
      orchestration,
    );
    if (directEmailLookupResult) {
      return directEmailLookupResult;
    }
    const memorySummary = this.memory.getContextSummary();

    const messages: ConversationMessage[] = [
      ...buildBaseMessages(userPrompt, orchestration, preferences),
      ...(memorySummary
        ? [
            {
              role: "system" as const,
              content: `Memória operacional atual do usuário:\n${memorySummary}`,
            },
          ]
        : []),
      {
        role: "user",
        content: userPrompt,
      },
    ];
    const toolExecutions: AgentRunResult["toolExecutions"] = [];
    const tools = this.selectToolsForPrompt(activeUserPrompt);
    const seenToolCalls = new Set<string>();

    for (let iteration = 0; iteration < this.config.runtime.maxToolIterations; iteration += 1) {
      requestLogger.info("Running agent iteration", {
        iteration,
        toolsAvailable: tools.length,
      });

      const response = await this.client.chat({
        messages,
        tools,
      });

      const responseToolCalls =
        response.message.tool_calls?.length && response.message.tool_calls.length > 0
          ? response.message.tool_calls
          : extractSyntheticToolCalls(response.message.content ?? "", this.pluginRegistry);

      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content: response.message.content ?? "",
        ...(responseToolCalls.length ? { tool_calls: responseToolCalls } : {}),
      };
      messages.push(assistantMessage);

      if (!responseToolCalls.length) {
        return {
          requestId,
          reply: assistantMessage.content.trim() || "O modelo não retornou conteúdo.",
          messages,
          toolExecutions,
        };
      }

      let repeatedToolCallDetected = false;

      for (const toolCall of responseToolCalls) {
        const toolCallId = randomUUID();
        const toolSignature = JSON.stringify({
          tool: toolCall.function.name,
          arguments: toolCall.function.arguments ?? {},
        });
        if (seenToolCalls.has(toolSignature)) {
          repeatedToolCallDetected = true;
        }
        seenToolCalls.add(toolSignature);

        try {
          const execution = await this.pluginRegistry.execute(toolCall.function.name, toolCall.function.arguments, {
            requestId,
            toolCallId,
            config: this.config,
            logger: requestLogger.child({ tool: toolCall.function.name, toolCallId }),
            fileAccess: this.fileAccess,
            memory: this.memory,
            preferences: this.preferences,
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

          toolExecutions.push({
            toolName: toolCall.function.name,
            resultPreview: execution.content.slice(0, 240),
          });

          messages.push({
            role: "tool",
            tool_name: toolCall.function.name,
            tool_call_id: toolCall.id ?? toolCallId,
            content: execution.content,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          requestLogger.error("Tool execution failed", {
            tool: toolCall.function.name,
            error: errorMessage,
          });

          messages.push({
            role: "tool",
            tool_name: toolCall.function.name,
            tool_call_id: toolCall.id ?? toolCallId,
            content: JSON.stringify(
              {
                ok: false,
                error: errorMessage,
              },
              null,
              2,
            ),
          });
        }
      }

      const reachedToolBudget = iteration >= this.config.runtime.maxToolIterations - 1;
      if (repeatedToolCallDetected || reachedToolBudget) {
        requestLogger.warn("Forcing final synthesis after tool execution", {
          reason: repeatedToolCallDetected ? "repeated-tool-call" : "tool-budget-reached",
          toolExecutions: toolExecutions.length,
        });
        return this.synthesizeFinalReply({
          requestId,
          requestLogger,
          messages,
          toolExecutions,
          orchestration,
        });
      }
    }

    throw new Error(
      `Agent exceeded the maximum number of tool iterations (${this.config.runtime.maxToolIterations})`,
    );
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

    const events: Array<{ account: string; summary: string; start: string | null; location?: string; matchedTerms?: string[] }> = [];
    const tasks: Array<TaskSummary & { account: string }> = [];
    for (const alias of this.googleWorkspaces.getAliases()) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const brief = await workspace.getDailyBrief();
      events.push(
        ...brief.events
          .map((event) => ({
            account: alias,
            summary: event.summary,
            start: event.start,
            location: event.location,
            description: event.description,
            matchedTerms: matchPersonalCalendarTerms({
              account: alias,
              summary: event.summary,
              description: event.description,
              location: event.location,
            }),
          }))
          .filter((event) => isPersonallyRelevantCalendarEvent(event)),
      );
      tasks.push(...brief.tasks.map((task) => ({ ...task, account: alias })));
    }

    events.sort((left, right) => (left.start ?? "").localeCompare(right.start ?? ""));
    tasks.sort((left, right) => (left.due ?? left.updated ?? "").localeCompare(right.due ?? right.updated ?? ""));
    const visibleTasks = tasks.filter((task) => !isOperationalNoise(task.title));

    const prioritizedEmails: Array<{
      account: string;
      uid: string;
      subject: string;
      from: string[];
      priority: string;
      action: string;
      relationship: string;
    }> = [];

    for (const alias of this.emailAccounts.getAliases()) {
      const reader = this.emailAccounts.getReader(alias);
      const status = await reader.getStatus();
      if (!status.ready) {
        continue;
      }

      const messages = await reader.listRecentMessages({
        limit: 8,
        unreadOnly: true,
        sinceHours: 18,
      });

      for (const message of messages) {
        const sender = message.from[0] ?? "";
        const classification = this.communicationRouter.classify({
          channel: "email",
          identifier: extractEmailIdentifier(message.from),
          displayName: sender,
          subject: message.subject,
          text: message.preview,
        });
        const summary = summarizeEmailForOperations({
          subject: message.subject,
          from: message.from,
          text: message.preview,
        });
        if (summary.priority === "baixa") {
          continue;
        }
        prioritizedEmails.push({
          account: alias,
          uid: message.uid,
          subject: message.subject,
          from: message.from,
          priority: summary.priority,
          action: summary.action,
          relationship: classification.relationship,
        });
      }
    }

    const priorityOrder = { alta: 0, media: 1, baixa: 2 } as const;
    prioritizedEmails.sort(
      (left, right) =>
        priorityOrder[left.priority as keyof typeof priorityOrder]
        - priorityOrder[right.priority as keyof typeof priorityOrder],
    );
    const visibleEmails = prioritizedEmails.filter((item) => !isOperationalNoise(item.subject));

    const approvals = this.approvals.listPendingAll(6).map((item) => ({
      subject: item.subject,
      actionKind: item.actionKind,
      channel: item.channel,
    }));
    const workflows = this.workflows
      .listPlans(10)
      .filter((plan) => plan.status === "active" || plan.status === "draft")
      .map((plan) => ({
        id: plan.id,
        title: plan.title,
        status: plan.status,
        nextAction: plan.nextAction,
      }));
    const visibleWorkflows = workflows.filter((plan) => !isOperationalNoise(plan.title));
    const focus = this.memory.getDailyFocus(3).map((item) => ({
      title: item.item.title,
      nextAction: item.nextAction,
    }));
    const visibleFocus = focus.filter((item) => !isOperationalNoise(item.title));

    const nextAction =
      approvals.length > 0
        ? "Revisar as aprovações pendentes no Telegram."
        : visibleEmails.find((item) => item.priority === "alta")
          ? "Responder o email mais urgente da inbox prioritária."
          : events.length > 0
            ? "Preparar o primeiro compromisso do dia."
            : visibleTasks.length > 0
              ? "Atacar a primeira tarefa com prazo do dia."
              : visibleWorkflows[0]?.nextAction ?? visibleFocus[0]?.nextAction;

    return {
      requestId,
      reply: buildMorningBriefReply({
        timezone: this.config.google.defaultTimezone,
        events,
        tasks: visibleTasks,
        emails: visibleEmails,
        approvals,
        workflows: visibleWorkflows,
        focus: visibleFocus,
        nextAction,
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "morning_brief",
          resultPreview: JSON.stringify(
            {
              events: events.length,
              tasks: visibleTasks.length,
              emails: visibleEmails.length,
              approvals: approvals.length,
              workflows: visibleWorkflows.length,
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
    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const candidateAliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();

    requestLogger.info("Using direct Google Tasks route", {
      domain: orchestration.route.primaryDomain,
      account: explicitAccount ?? "all",
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
      reply: buildGoogleTasksReply({
        timezone: this.config.google.defaultTimezone,
        tasks,
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
    });
    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());

    const eventMatches: Array<{
      account: string;
      summary: string;
      start: string | null;
      location?: string;
      htmlLink?: string;
    }> = [];

    const candidateAliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();
    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const explicitCalendarAlias = extractExplicitCalendarAlias(
        userPrompt,
        Object.keys(workspace.getCalendarAliases()),
      );

      const events = await workspace.listEventsInWindow({
        timeMin: lookup.targetDate.startIso,
        timeMax: lookup.targetDate.endIso,
        maxResults: 10,
        ...(explicitCalendarAlias ? { calendarId: explicitCalendarAlias } : {}),
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
      reply: buildCalendarLookupReply({
        request: lookup,
        eventMatches,
        emailMatches,
        timezone: this.config.google.defaultTimezone,
        suggestNextStep: preferences.proactiveNextStep,
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

    const status = this.googleWorkspace.getStatus();
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

    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
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

  private async tryRunDirectGoogleEventDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGoogleEventCreatePrompt(userPrompt)) {
      return null;
    }

    const status = this.googleWorkspace.getStatus();
    if (!status.ready) {
      return {
        requestId,
        reply: `A integração do Google Workspace não está pronta. ${status.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    requestLogger.info("Using direct Google Calendar event draft route", {
      domain: orchestration.route.primaryDomain,
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

    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    if (explicitAccount) {
      draftResult.draft.account = explicitAccount;
    }
    const explicitCalendar = extractExplicitCalendarAlias(
      userPrompt,
      Object.keys(this.googleWorkspace.getCalendarAliases()),
    );
    if (explicitCalendar) {
      draftResult.draft.calendarId = explicitCalendar;
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

    if (shouldAutoCreateGoogleEvent(userPrompt, draftResult.draft, Boolean(status.writeReady))) {
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

    const scopeNotice = status.writeReady
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
    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const aliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();
    const events: Array<{ account: string; event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number] }> = [];
    for (const alias of aliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) continue;
      const items = await workspace.listEventsInWindow({
        timeMin: window.startIso,
        timeMax: window.endIso,
        maxResults: 20,
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
        events.push({ account: alias, event });
      }
    }
    requestLogger.info("Using direct calendar period list route", { period: window.label, account: explicitAccount ?? "all" });
    const reply = events.length === 0
      ? `Nenhum compromisso em ${window.label}.`
      : [
          `${window.label[0]?.toUpperCase() ?? ""}${window.label.slice(1)}: ${events.length} compromisso${events.length > 1 ? "s" : ""}.`,
          ...events.slice(0, 8).map((item) =>
            `- ${item.event.summary} — ${item.event.start ? new Intl.DateTimeFormat("pt-BR", { timeZone: this.config.google.defaultTimezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.event.start)) : "sem horário"}${item.event.end ? `–${new Intl.DateTimeFormat("pt-BR", { timeZone: this.config.google.defaultTimezone, hour: "2-digit", minute: "2-digit" }).format(new Date(item.event.end))}` : ""}${summarizeCalendarLocation(item.event.location) ? ` — local: ${summarizeCalendarLocation(item.event.location)}` : ""} | conta: ${item.account}`
          ),
          ...(events.length > 8 ? [`- ... e mais ${events.length - 8} compromisso(s). Peça detalhes se quiser a lista completa.`] : []),
        ].join("\n");
    return {
      requestId,
      reply,
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
    const aliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();
    const matches: Array<{ account: string; event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number] }> = [];
    const allWindowEvents: Array<{ account: string; event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number] }> = [];
    for (const alias of aliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) continue;
      const items = await workspace.listEventsInWindow({
        timeMin: sourceDate?.startIso ?? new Date().toISOString(),
        timeMax: sourceDate?.endIso ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 20,
      });
      for (const event of items) {
        allWindowEvents.push({ account: alias, event });
      }
      for (const event of items) {
        if (matchesCalendarEventTopic(event.summary, topic)) {
          matches.push({ account: alias, event });
        }
      }
    }
    const resolvedMatches = matches.length === 0 && allWindowEvents.length === 1
      ? allWindowEvents
      : matches;
    if (resolvedMatches.length === 0) {
      return {
        requestId,
        reply: "Não encontrei o evento que você quer mover.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    if (resolvedMatches.length > 1) {
      return {
        requestId,
        reply: "Encontrei mais de um evento compatível para mover. Seja mais específico no título ou data.",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }
    const match = resolvedMatches[0];
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
    const adjusted = adjustEventDraftFromInstruction(baseDraft, parts.targetInstruction);
    const finalDraft = (adjusted ?? baseDraft) as PendingGoogleEventUpdateDraft;
    requestLogger.info("Using direct Google Calendar move draft route", { account: match.account });
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

    const status = this.googleWorkspace.getStatus();
    if (!status.ready) {
      return {
        requestId,
        reply: `A integração do Google Workspace não está pronta. ${status.message}`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const explicitAccount = extractExplicitAccountAlias(userPrompt, this.googleWorkspaces.getAliases());
    const accountAliases = explicitAccount ? [explicitAccount] : this.googleWorkspaces.getAliases();
    const explicitCalendar = extractExplicitCalendarAlias(
      userPrompt,
      Object.keys(this.googleWorkspace.getCalendarAliases()),
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

    const matches: Array<{
      account: string;
      calendarId?: string;
      event: Awaited<ReturnType<GoogleWorkspaceService["listEventsInWindow"]>>[number];
    }> = [];

    for (const alias of accountAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) {
        continue;
      }
      const events = await workspace.listEventsInWindow({
        timeMin: targetDate?.startIso ?? new Date().toISOString(),
        timeMax: targetDate?.endIso ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 10,
        calendarId: explicitCalendar,
        query: topic,
      });
      const resolvedEvents = events.length > 0
        ? events
        : (await workspace.listEventsInWindow({
            timeMin: targetDate?.startIso ?? new Date().toISOString(),
            timeMax: targetDate?.endIso ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            maxResults: 25,
            calendarId: explicitCalendar,
          })).filter((event) => matchesCalendarEventTopic(event.summary, topic));
      for (const event of resolvedEvents) {
        matches.push({
          account: alias,
          calendarId: explicitCalendar,
          event,
        });
      }
    }

    if (matches.length === 0) {
      return {
        requestId,
        reply: `Não encontrei evento correspondente para cancelar${targetDate ? ` em ${targetDate.label}` : ""}.`,
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (matches.length > 1) {
      const preview = matches
        .slice(0, 3)
        .map((item) => `- ${item.event.summary} | ${item.event.start ?? "sem horário"} | conta: ${item.account}`)
        .join("\n");
      return {
        requestId,
        reply: [
          "Encontrei mais de um evento compatível. Me diga qual quer cancelar.",
          preview,
        ].join("\n"),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    const match = matches[0];
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
      reply: isScopedAccountQuery && route.instanceName
        ? buildWhatsAppScopedRecentMessagesReply(route.accountAlias, messages)
        : buildWhatsAppRecentMessagesReply(query, messages),
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

    return {
      requestId,
      reply: buildWhatsAppPendingApprovalsReply(pending),
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

    const researchMode = extractWebResearchMode(userPrompt);
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

    const location = extractWeatherLocation(userPrompt);
    if (!location) {
      return null;
    }

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

    const fallbackPayload = buildShortFormFallbackPackage({
      item,
      platform: item.platform,
    });

    let payload = { ...fallbackPayload };

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é roteirista de short-form content para o canal Riqueza Despertada.",
              "Sua tarefa é gerar um short com retenção forte para YouTube Shorts e TikTok.",
              "Responda somente JSON válido.",
              "Formato: mode, targetDurationSeconds, hook, script, cta, description, titleOptions, scenes, platformVariants.",
              "mode deve ser viral_short.",
              "targetDurationSeconds entre 35 e 50.",
              "titleOptions deve ser array com 3 títulos curtos.",
              "Crie cenas curtas com os campos order, durationSeconds, voiceover, overlay, visualDirection.",
              "Cada vídeo deve ter UMA ideia central. Sem lista longa, sem densidade excessiva, sem jargão demais.",
              "O hook precisa abrir tensão real em até 2 segundos.",
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
        mode: parsed.mode === "viral_short" ? parsed.mode : payload.mode,
        targetDurationSeconds: clampShortDuration(parsed.targetDurationSeconds, payload.targetDurationSeconds),
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

    const scriptPackage = [
      "SHORT_PACKAGE_V2",
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
        `${scene.order}. ${scene.durationSeconds}s | VO=${scene.voiceover} | overlay=${scene.overlay} | visual=${scene.visualDirection}`,
      ),
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
      "END_SHORT_PACKAGE_V2",
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
        mode: payload.mode,
        targetDurationSeconds: payload.targetDurationSeconds,
        headlineOptions: payload.titleOptions,
        script: payload.script,
        description: payload.description,
        scenes: payload.scenes,
        platformVariants: payload.platformVariants,
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

    const plan = await this.createWorkflowPlanFromPrompt(userPrompt, orchestration, requestLogger);
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
    return {
      requestId,
      reply: buildContactSaveReply(contact),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
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
      const { plan, step } = this.workflows.activateStep(planId, stepNumber);
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
      this.workflows.updateStep({
        planId,
        stepNumber,
        status,
      });
      const plan = this.workflows.getPlan(planId);
      if (!plan) {
        throw new Error(`Workflow not found after update: ${planId}`);
      }
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

    return {
      requestId,
      reply: buildInboxTriageReply(items, { unreadOnly, limit }),
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

  private async synthesizeFinalReply(input: {
    requestId: string;
    requestLogger: Logger;
    messages: ConversationMessage[];
    toolExecutions: AgentRunResult["toolExecutions"];
    orchestration: OrchestrationContext;
  }): Promise<AgentRunResult> {
    const synthesisMessages: ConversationMessage[] = [
      ...input.messages,
      {
        role: "system",
        content:
          "Use os resultados de ferramentas já disponíveis para responder ao usuário agora. Não chame novas ferramentas. Se alguma ferramenta falhou, mencione o erro de forma breve e siga com a melhor resposta possível.",
      },
    ];

    const synthesisResponse = await this.client.chat({
      messages: synthesisMessages,
    });
    const reply =
      synthesisResponse.message.content.trim() ||
      this.buildFallbackReply(input.toolExecutions);

    return {
      requestId: input.requestId,
      reply,
      messages: [...synthesisMessages, synthesisResponse.message],
      toolExecutions: input.toolExecutions,
    };
  }

  private buildFallbackReply(
    toolExecutions: AgentRunResult["toolExecutions"],
  ): string {
    if (toolExecutions.length === 0) {
      return "O agente não conseguiu finalizar a resposta nesta tentativa.";
    }

    const lastExecution = toolExecutions[toolExecutions.length - 1];
    return [
      "O agente executou a solicitação, mas o modelo não consolidou a resposta final.",
      `Última ferramenta: ${lastExecution.toolName}`,
      `Prévia do resultado:\n${lastExecution.resultPreview}`,
    ].join("\n\n");
  }
}
