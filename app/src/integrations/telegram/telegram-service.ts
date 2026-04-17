import { setTimeout as delay } from "node:timers/promises";
import type { AgentCore } from "../../core/agent-core.js";
import type { ContentOpsStore } from "../../core/content-ops.js";
import type {
  PendingGoogleEventDeleteBatchDraft,
  PendingGoogleEventDeleteDraft,
  PendingGoogleEventDraft,
  PendingGoogleEventImportBatchDraft,
  PendingGoogleEventUpdateDraft,
  PendingGoogleTaskDraft,
} from "../../core/google-draft-utils.js";
import {
  adjustEventDraftFromInstruction,
  buildEventDraftFromPrompt,
  buildGoogleTaskDraftReply,
  buildGoogleEventImportBatchDraftReply,
  buildGoogleEventDraftReply,
  buildGoogleEventUpdateDraftReply,
  buildTaskDraftFromPrompt,
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
} from "../../core/google-draft-utils.js";
import {
  buildMonitoredChannelAlertReply,
  resolveMonitoredAlertReplyAction,
  type MonitoredWhatsAppReplyDraft,
  type PendingMonitoredChannelAlertDraft,
} from "../../core/monitored-channel-alerts.js";
import { extractLatestShortPackage, type ParsedShortPackage } from "../../core/short-video-package.js";
import { parseAssistantDecisionReply } from "../../core/assistant-decision.js";
import type { AppConfig } from "../../types/config.js";
import type { ApprovalInboxItemRecord } from "../../types/approval-inbox.js";
import type { ContentItemRecord } from "../../types/content-ops.js";
import type { Logger } from "../../types/logger.js";
import type { GoogleWorkspaceAuthService } from "../google/google-auth.js";
import { ShortVideoRenderService } from "../media/short-video-renderer.js";
import { OpenAiScheduleImportService } from "../openai/schedule-import.js";
import { YouTubePublisherService } from "../youtube/youtube-publisher.js";
import {
  buildPendingChoiceContinuationPrompt,
  extractPendingChoiceState,
  resolvePendingChoiceReply,
  type PendingChoiceState,
} from "./pending-choice.js";
import type { ApprovalEngine } from "../../core/approval-engine.js";
import type { ClarificationEngine } from "../../core/clarification-engine.js";
import type { WhatsAppMessageStore } from "../../core/whatsapp-message-store.js";
import { rankApprovals } from "../../core/approval-priority.js";
import { matchPersonalCalendarTerms } from "../../core/calendar-relevance.js";
import {
  extractExplicitGoogleAccountAlias,
  refersToBothGoogleAccounts,
  resolveShortGoogleAccountReply,
} from "../../core/google-account-resolution.js";
import { EvolutionApiClient } from "../whatsapp/evolution-api.js";
import {
  buildVoiceUserErrorMessage,
  createVoiceMessageHandler,
  type VoiceMessageHandler,
} from "../voice/voice-message-handler.js";
import { extractTelegramVoiceAttachment } from "../voice/telegram-voice.js";
import { TelegramApi } from "./telegram-api.js";
import type {
  TelegramCallbackQuery,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./types.js";

const MAX_CHAT_HISTORY_TURNS = 6;
const RECENT_PENDING_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;
const PENDING_CHOICE_WINDOW_MS = 30 * 60 * 1000;

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

interface PendingEmailDraft {
  kind: "email_reply";
  uid: string;
  body: string;
  subjectOverride?: string;
}

interface PendingWhatsAppReplyDraft {
  kind: "whatsapp_reply";
  instanceName?: string;
  account?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText: string;
  replyText: string;
  relationship?: string;
  persona?: string;
}

interface PendingYouTubePublishDraft {
  kind: "youtube_publish";
  contentItemId: number;
  filePath: string;
  title: string;
  description: string;
  privacyStatus: "private" | "public" | "unlisted";
  tags: string[];
}

type PendingActionDraft =
  | PendingEmailDraft
  | PendingWhatsAppReplyDraft
  | PendingMonitoredChannelAlertDraft
  | PendingYouTubePublishDraft
  | PendingGoogleTaskDraft
  | PendingGoogleEventDraft
  | PendingGoogleEventUpdateDraft
  | PendingGoogleEventDeleteDraft
  | PendingGoogleEventDeleteBatchDraft
  | PendingGoogleEventImportBatchDraft;

interface OperationalModeState {
  kind: "field";
  reason: string;
  activatedAt: number;
  expiresAt: number;
}

type ScheduledEditorialSlotKey = "morning_finance" | "lunch_income" | "night_trends";

interface DailyEditorialResearchPayload {
  createdItemIds?: number[];
  packagedItemIds?: number[];
  slots?: Array<{
    id?: number;
    slotKey?: string | null;
  }>;
}

type CalendarUndoAction =
  | {
      kind: "create";
      eventId: string;
      account?: string;
      calendarId?: string;
      summary?: string;
    }
  | {
      kind: "update";
      eventId: string;
      account?: string;
      calendarId?: string;
      previous: {
        summary: string;
        description?: string;
        location?: string;
        start?: string;
        end?: string;
        timezone: string;
        reminderMinutes?: number;
      };
    }
  | {
      kind: "delete";
      restoreDraft: PendingGoogleEventDraft;
    }
  | {
      kind: "delete_batch";
      restoreDrafts: PendingGoogleEventDraft[];
    }
  | {
      kind: "create_batch";
      events: Array<{
        eventId: string;
        account?: string;
        calendarId?: string;
        summary?: string;
      }>;
    }
  | {
      kind: "task_create";
      taskId: string;
      taskListId: string;
      account?: string;
      title?: string;
    };

interface TelegramImportAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  kind: "pdf" | "image";
}

function splitTelegramText(text: string, maxLength = 4000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const lastNewline = slice.lastIndexOf("\n");
    const splitIndex = lastNewline > maxLength * 0.5 ? lastNewline : maxLength;
    parts.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  if (remaining.length > 0) {
    parts.push(remaining);
  }

  return parts;
}

function normalizeTelegramText(text: string, botUsername?: string): string {
  if (!botUsername) {
    return text.trim();
  }
  const mentionPattern = new RegExp(`@${botUsername}\\b`, "gi");
  return text.replace(mentionPattern, "").trim();
}

function extractMessageText(message: TelegramMessage): string | undefined {
  return message.text?.trim() || message.caption?.trim() || undefined;
}

function extractImportAttachment(message: TelegramMessage): TelegramImportAttachment | undefined {
  const document = message.document;
  if (document?.file_id) {
    const normalizedName = document.file_name?.trim().toLowerCase() ?? "";
    const mimeType = document.mime_type?.trim().toLowerCase() ?? "";
    if (mimeType === "application/pdf" || normalizedName.endsWith(".pdf")) {
      return {
        fileId: document.file_id,
        fileName: document.file_name?.trim() || `document_${message.message_id}.pdf`,
        mimeType: "application/pdf",
        kind: "pdf",
      };
    }
    if (mimeType.startsWith("image/")) {
      return {
        fileId: document.file_id,
        fileName: document.file_name?.trim() || `image_${message.message_id}.${mimeType.split("/")[1] || "png"}`,
        mimeType,
        kind: "image",
      };
    }
  }

  const bestPhoto = message.photo?.at(-1);
  if (bestPhoto?.file_id) {
    return {
      fileId: bestPhoto.file_id,
      fileName: `photo_${message.message_id}.jpg`,
      mimeType: "image/jpeg",
      kind: "image",
    };
  }

  return undefined;
}

function containsBotMention(message: TelegramMessage, botUsername?: string): boolean {
  if (!botUsername) {
    return false;
  }

  const allEntities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
  const sourceText = message.text ?? message.caption ?? "";

  for (const entity of allEntities) {
    if (entity.type !== "mention") {
      continue;
    }
    const value = sourceText.slice(entity.offset, entity.offset + entity.length);
    if (value.toLowerCase() === `@${botUsername.toLowerCase()}`) {
      return true;
    }
  }

  return false;
}

function isReplyToBot(message: TelegramMessage, botUserId: number): boolean {
  return message.reply_to_message?.from?.id === botUserId;
}

function shouldHandleMessage(message: TelegramMessage, bot: TelegramUser): boolean {
  if (message.chat.type === "private") {
    return true;
  }

  return containsBotMention(message, bot.username) || isReplyToBot(message, bot.id);
}

function buildUnauthorizedMessage(userId: number, hasAllowlist: boolean): string {
  if (!hasAllowlist) {
    return [
      "Bot iniciado em modo seguro.",
      `Seu user id do Telegram é: ${userId}`,
      "Adicione esse valor em TELEGRAM_ALLOWED_USER_IDS no arquivo .env.",
      "Depois recrie o container com: docker compose up -d --force-recreate agent",
    ].join("\n");
  }

  return [
    "Acesso negado para este usuário.",
    `Seu user id do Telegram é: ${userId}`,
    "Se esse acesso for esperado, adicione o id em TELEGRAM_ALLOWED_USER_IDS e recrie o container.",
  ].join("\n");
}

function buildWelcomeMessage(bot: TelegramUser, userId: number, allowlisted: boolean): string {
  const lines = [
    `Bot @${bot.username ?? "sem-username"} ativo.`,
    `Seu user id: ${userId}`,
  ];

  if (!allowlisted) {
    lines.push("Este usuário ainda não está liberado para conversar com o agente.");
    lines.push("Configure TELEGRAM_ALLOWED_USER_IDS no .env e recrie o container.");
    return lines.join("\n");
  }

  lines.push("Acesso liberado. Pode enviar mensagens em texto, links e áudio.");
  lines.push("Outros arquivos seguem em ativação gradual.");
  return lines.join("\n");
}

function buildAgentFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("maximum number of tool iterations")) {
    return [
      "A solicitação entrou em loop de ferramentas e foi interrompida.",
      "Tente reformular de forma mais específica.",
      "Exemplo: `Use somente a ferramenta ping e me devolva o resultado em uma linha.`",
    ].join("\n");
  }

  if (message.includes("Ollama request failed")) {
    return [
      "O modelo local não respondeu corretamente nesta tentativa.",
      "Verifique se o Ollama está rodando e tente novamente.",
    ].join("\n");
  }

  if (message.includes("OpenAI request failed")) {
    return [
      "O provider OpenAI não respondeu corretamente nesta tentativa.",
      "Verifique a chave OPENAI_API_KEY, o modelo configurado e tente novamente.",
    ].join("\n");
  }

  return [
    "O agente falhou ao processar esta mensagem.",
    `Detalhe: ${message}`,
  ].join("\n");
}

function normalizeIntentText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function includesAny(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractContentItemIdFromText(text: string): number | undefined {
  const match = text.match(/item\s*#?\s*(\d+)/i) ?? text.match(/#(\d+)/);
  if (!match) {
    return undefined;
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function extractContentItemIdsFromText(text: string): number[] {
  const unique = new Set<number>();

  for (const match of text.matchAll(/#\s*(\d+)/g)) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed)) {
      unique.add(parsed);
    }
  }

  if (unique.size > 0) {
    return [...unique];
  }

  const normalized = normalizeIntentText(text);
  if (/(item|itens|video|videos|vídeo|vídeos)/.test(normalized)) {
    for (const match of normalized.matchAll(/\b(\d{1,6})\b/g)) {
      const parsed = Number.parseInt(match[1] ?? "", 10);
      if (Number.isFinite(parsed)) {
        unique.add(parsed);
      }
    }
  }

  return [...unique];
}

function extractEditorialSlotKeyFromNotes(notes: string | null | undefined): ScheduledEditorialSlotKey | null {
  const match = notes?.match(/\[slot:(morning_finance|lunch_income|night_trends)\]/i);
  if (!match?.[1]) {
    return null;
  }
  const normalized = match[1].trim().toLowerCase();
  if (normalized === "morning_finance" || normalized === "lunch_income" || normalized === "night_trends") {
    return normalized;
  }
  return null;
}

function getEditorialSlotSchedule(slotKey: ScheduledEditorialSlotKey): { label: string; time: string } {
  switch (slotKey) {
    case "morning_finance":
      return { label: "07:00 | Notícias financeiras", time: "07:00" };
    case "lunch_income":
      return { label: "12:00 | Renda extra", time: "12:00" };
    case "night_trends":
      return { label: "20:00 | Trend adaptado", time: "20:00" };
  }
}

function buildEditorialTargetDate(runDate: string, slotKey: ScheduledEditorialSlotKey): string {
  return `${runDate}T${getEditorialSlotSchedule(slotKey).time}:00-03:00`;
}

function parseDailyEditorialResearchPayload(payloadJson: string | null | undefined): DailyEditorialResearchPayload | null {
  if (!payloadJson?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(payloadJson) as DailyEditorialResearchPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function scoreEditorialSelection(item: ContentItemRecord): number {
  return item.queuePriority ?? item.ideaScore ?? 0;
}

function isVideoDraftRenderRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  return (
    /(gere|gerar|renderize|renderizar|monte|montar|crie|criar).*(video|vídeo).*(rascunho|draft|item)/.test(normalized)
    || /(video|vídeo).*(item).*(#\d+)/.test(normalized)
  );
}

function isBatchScriptGenerationRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  const ids = extractContentItemIdsFromText(text);
  if (ids.length < 2) {
    return false;
  }

  return (
    includesAny(normalized, ["gere roteiro", "gerar roteiro", "gere os roteiros", "roteiro dos itens", "roteiro dos videos", "roteiro dos vídeos", "gere script", "gerar script"]) &&
    !includesAny(normalized, ["video rascunho", "vídeo rascunho", "draft", "render"])
  );
}

function isBatchVideoDraftRenderRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  const ids = extractContentItemIdsFromText(text);
  if (ids.length < 2) {
    return false;
  }

  return isVideoDraftRenderRequest(text);
}

function isVideoPipelineStatusRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  return includesAny(normalized, [
    "pipeline de video",
    "pipeline de vídeo",
    "status do video",
    "status do vídeo",
    "diagnostique o video",
    "diagnostique o vídeo",
    "doctor de video",
    "doctor de vídeo",
    "o que falta para renderizar",
    "o que falta para publicar video",
    "o que falta para publicar vídeo",
  ]);
}

function extractManualShortScriptPayload(text: string): { title?: string; body: string } | null {
  const raw = text.trim();
  if (!raw) {
    return null;
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd());
  let explicitTitle: string | undefined;
  let markerIndex = -1;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (!explicitTitle) {
      const titleMatch = trimmed.match(/^(titulo|título|title)\s*:\s*(.+)$/i);
      if (titleMatch?.[2]?.trim()) {
        explicitTitle = titleMatch[2].trim();
        continue;
      }
    }
    if (/^(roteiro|script|texto base|texto)\s*:\s*$/i.test(trimmed)) {
      markerIndex = index;
      break;
    }
    if (/^(roteiro|script)\s*:/i.test(trimmed)) {
      markerIndex = index;
      break;
    }
  }

  let body = "";
  if (markerIndex >= 0) {
    const markerLine = lines[markerIndex]!.trim();
    const inlineMatch = markerLine.match(/^(roteiro|script)\s*:\s*(.+)$/i);
    if (inlineMatch?.[2]?.trim()) {
      body = [inlineMatch[2].trim(), ...lines.slice(markerIndex + 1)].join("\n").trim();
    } else {
      body = lines.slice(markerIndex + 1).join("\n").trim();
    }
  } else if (lines.length >= 4 || raw.length >= 220) {
    body = raw;
  }

  body = body.trim();
  if (body.length < 120) {
    return null;
  }

  return {
    title: explicitTitle,
    body,
  };
}

function inferManualShortTitle(explicitTitle: string | undefined, body: string): string {
  if (explicitTitle?.trim()) {
    return explicitTitle.trim();
  }

  const cleaned = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
  const withoutQuotes = firstSentence.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  const words = withoutQuotes.split(/\s+/).filter(Boolean);
  const compact = words.slice(0, 10).join(" ");
  return compact.length >= 16 ? compact : truncateText(cleaned, 72);
}

function isManualVideoScriptRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized || extractContentItemIdFromText(normalized)) {
    return false;
  }

  const hasIntent = includesAny(normalized, [
    "roteiro",
    "script",
    "video",
    "vídeo",
    "rascunho",
    "render",
    "montar",
    "monte",
    "crie um video",
    "crie um vídeo",
    "use este roteiro",
    "usar este roteiro",
  ]);

  if (!hasIntent) {
    return false;
  }

  return extractManualShortScriptPayload(text) !== null;
}

function buildManualShortScriptNotes(input: {
  body: string;
  title: string;
}): string {
  return [
    "MANUAL_SHORT_SCRIPT",
    `captured_at: ${new Date().toISOString()}`,
    `title: ${input.title}`,
    "body:",
    input.body.trim(),
    "END_MANUAL_SHORT_SCRIPT",
  ].join("\n");
}

function buildVideoPipelineReadinessReply(input: {
  acceptedInput: string;
  ttsProvider: string;
  ttsReady: boolean;
  assetsProvider: string;
  assetsReady: boolean;
  canRender: boolean;
  youtubeUploadReady: boolean;
}): string {
  const nextAction = !input.ttsReady
    ? "Configurar TTS OpenAI para o render nativo."
    : !input.youtubeUploadReady
      ? "Reautorizar o Google com escopo youtube.upload para publicar."
      : "Gerar um vídeo rascunho do item desejado e revisar.";

  return [
    "Pipeline de vídeo do Atlas:",
    `- Entrada aceita: ${input.acceptedInput}`,
    `- TTS nativo: ${input.ttsReady ? `${input.ttsProvider} ativo` : "indisponível"}`,
    `- Assets: ${input.assetsReady ? `${input.assetsProvider} ativo` : "manual/fallback"}`,
    `- Render draft: ${input.canRender ? "pronto" : "bloqueado"}`,
    `- Upload YouTube: ${input.youtubeUploadReady ? "pronto" : "bloqueado por autenticação/escopo"}`,
    "",
    "Regras do runtime:",
    "- o pipeline nativo hoje usa OpenAI TTS e pode combinar Pexels com providers premium de vídeo quando configurados",
    "- o pipeline nativo hoje não usa ElevenLabs nem CapCut .capproj",
    "- o render nativo parte de um item editorial com SHORT_PACKAGE_V3 salvo",
    "- se faltar uma credencial, o Atlas deve dizer isso explicitamente e não inventar outro fornecedor",
    "",
    `Próxima ação: ${nextAction}`,
  ].join("\n");
}

function isExplicitSendConfirmation(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  if (/(^|\s)nao(\s|$)/.test(normalized) || /cancel/.test(normalized)) {
    return false;
  }

  return [
    /^sim\b/,
    /^sim[, ]+quero\b/,
    /^agendar\b/,
    /^agende\b/,
    /^confirmar\b/,
    /^confirmado\b/,
    /^ok\b/,
    /^pode criar\b/,
    /^crie\b/,
    /^quero enviar\b/,
    /^pode enviar\b/,
    /^envie\b/,
    /^mande\b/,
    /^pode mandar\b/,
    /^sem meet\b/,
    /^sem google meet\b/,
  ].some((pattern) => pattern.test(normalized));
}

function isExplicitDeleteConfirmation(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  if (/(^|\s)nao(\s|$)/.test(normalized) || /^cancelar\b/.test(normalized)) {
    return false;
  }

  return [
    /^confirmar excluir\b/,
    /^excluir serie\b/,
    /^excluir série\b/,
    /^confirmar apagar\b/,
    /^confirmar remover\b/,
  ].some((pattern) => pattern.test(normalized));
}

function extractDeleteDraftFromAssistantText(text: string, defaultTimezone: string): PendingGoogleEventDeleteDraft | undefined {
  const eventId = text.match(/(?:^|\n)-?\s*ID(?: do evento)?\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const summary = text.match(/(?:^|\n)-?\s*T[íi]tulo\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const account = text.match(/(?:^|\n)-?\s*Conta(?:\/Calend[áa]rio)?\s*:\s*([^\n]+)/i)?.[1]?.trim();
  if (!eventId || !summary) {
    return undefined;
  }

  const startLine = text.match(/(?:^|\n)-?\s*(?:Data\s*\/\s*hor[áa]rio|In[íi]cio)\s*:\s*([^\n]+)/i)?.[1]?.trim();
  const endLine = text.match(/(?:^|\n)-?\s*Fim\s*:\s*([^\n]+)/i)?.[1]?.trim();

  return {
    kind: "google_event_delete",
    eventId,
    summary,
    account: account || undefined,
    start: startLine || undefined,
    end: endLine || undefined,
    timezone: defaultTimezone,
  };
}

function isDraftDiscardRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return [
    "cancelar rascunho",
    "descartar rascunho",
    "nao envie",
    "não envie",
    "cancele",
    "cancela",
  ].some((token) => normalized.includes(token));
}

function isClarificationCancelRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return [
    "cancelar",
    "cancelar pergunta",
    "cancelar clarificacao",
    "cancelar clarificação",
    "deixa",
    "deixa pra la",
    "deixa pra lá",
    "esquece",
  ].some((token) => normalized === token || normalized.includes(token));
}

function isShortCalendarContextReply(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }
  if (normalized.length > 80 || normalized.split(/\s+/).length > 8) {
    return false;
  }

  return (
    /\b(?:as|a|das?|de)\s+\d{1,2}(?::\d{2})?\s*h?\b/.test(normalized) ||
    /\b\d{1,2}h(?:\d{2})?\b/.test(normalized) ||
    /\b(?:amanha|hoje|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(normalized) ||
    /\b(?:manha|tarde|noite)\b/.test(normalized) ||
    /\b(?:abordagem|principal|primary|pessoal|ambos|ambas)\b/.test(normalized) ||
    /^(?:esse|essa|esse mesmo|essa mesmo|o primeiro|a primeira|o segundo|a segunda|o da manha|o da tarde|o de \d{1,2}(?::\d{2})?h?)$/.test(normalized)
  );
}

function isApprovalListRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (
    normalized.includes("analise a intencao")
    || normalized.includes("analise a intenção")
    || normalized.includes("inspecione a intencao")
    || normalized.includes("inspecione a intenção")
    || normalized.includes("mostre a intencao")
    || normalized.includes("mostre a intenção")
  ) {
    return false;
  }

  return [
    "liste aprovacoes",
    "liste aprovações",
    "aprovacoes pendentes",
    "aprovações pendentes",
    "liste aprovacoes pendentes",
    "liste aprovações pendentes",
    "mostrar aprovacoes",
    "mostrar aprovações",
  ].some((token) => normalized.includes(token));
}

function isClearlyNewTopLevelIntent(text: string): boolean {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return false;
  }

  if (isGoogleEventCreatePrompt(text) || isGoogleTaskCreatePrompt(text)) {
    return true;
  }

  return [
    "meu calendario",
    "meu calendário",
    "minha agenda",
    "coloque um evento",
    "coloca um evento",
    "crie um evento",
    "agende",
    "agendar",
    "crie uma tarefa",
    "adicione uma tarefa",
    "procure no whatsapp",
    "busque no whatsapp",
    "veja no whatsapp",
    "pesquise na internet",
    "pesquise sobre",
    "procure na internet",
    "clima em",
    "previsao do tempo",
    "previsão do tempo",
    "liste meus compromissos",
    "morning briefing",
    "liste minhas tarefas",
    "procure o contato",
  ].some((token) => normalized.includes(token));
}

function isUndoLastCalendarChangeRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return [
    "desfaca a ultima alteracao",
    "desfaça a ultima alteracao",
    "desfazer ultima alteracao",
    "desfazer a ultima alteracao",
    "desfaca a ultima mudanca",
    "desfaça a ultima mudança",
    "desfazer ultimo agendamento",
    "desfazer ultima alteracao de agenda",
  ].some((token) => normalized.includes(token));
}

function extractPendingEmailDraft(text: string): PendingEmailDraft | undefined {
  const match = text.match(
    /EMAIL_REPLY_DRAFT\s+uid=([^\s]+)\s*(?:subject=(.+?)\s*)?body:\s*([\s\S]*?)\s*END_EMAIL_REPLY_DRAFT/i,
  );

  if (!match) {
    return undefined;
  }

  const uid = match[1]?.trim() ?? "";
  const subjectOverride = match[2]?.trim() || undefined;
  const body = match[3]?.trim() || "";
  if (!uid || !body) {
    return undefined;
  }

  return {
    kind: "email_reply",
    uid,
    body,
    subjectOverride,
  };
}

function extractPendingGoogleTaskDraft(text: string): PendingGoogleTaskDraft | undefined {
  const match = text.match(/GOOGLE_TASK_DRAFT\s*([\s\S]*?)\s*END_GOOGLE_TASK_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingGoogleTaskDraft;
    if (parsed?.kind !== "google_task" || !parsed.title?.trim()) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingGoogleEventDraft(text: string): PendingGoogleEventDraft | undefined {
  const match = text.match(/GOOGLE_EVENT_DRAFT\s*([\s\S]*?)\s*END_GOOGLE_EVENT_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingGoogleEventDraft;
    if (parsed?.kind !== "google_event" || !parsed.summary?.trim() || !parsed.start || !parsed.end) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingGoogleEventDeleteDraft(text: string): PendingGoogleEventDeleteDraft | undefined {
  const match = text.match(/GOOGLE_EVENT_DELETE_DRAFT\s*([\s\S]*?)\s*END_GOOGLE_EVENT_DELETE_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingGoogleEventDeleteDraft;
    if (parsed?.kind !== "google_event_delete" || !parsed.summary?.trim() || !parsed.eventId?.trim()) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingGoogleEventUpdateDraft(text: string): PendingGoogleEventUpdateDraft | undefined {
  const match = text.match(/GOOGLE_EVENT_UPDATE_DRAFT\s*([\s\S]*?)\s*END_GOOGLE_EVENT_UPDATE_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingGoogleEventUpdateDraft;
    if (
      parsed?.kind !== "google_event_update" ||
      !parsed.summary?.trim() ||
      !parsed.start ||
      !parsed.end ||
      !parsed.eventId?.trim()
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingGoogleEventDeleteBatchDraft(text: string): PendingGoogleEventDeleteBatchDraft | undefined {
  const match = text.match(/GOOGLE_EVENT_DELETE_BATCH_DRAFT\s*([\s\S]*?)\s*END_GOOGLE_EVENT_DELETE_BATCH_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingGoogleEventDeleteBatchDraft;
    if (
      parsed?.kind !== "google_event_delete_batch" ||
      !Array.isArray(parsed.events) ||
      parsed.events.length === 0
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingGoogleEventImportBatchDraft(text: string): PendingGoogleEventImportBatchDraft | undefined {
  const match = text.match(/GOOGLE_EVENT_IMPORT_BATCH_DRAFT\s*([\s\S]*?)\s*END_GOOGLE_EVENT_IMPORT_BATCH_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingGoogleEventImportBatchDraft;
    if (
      parsed?.kind !== "google_event_import_batch" ||
      !Array.isArray(parsed.events) ||
      parsed.events.length === 0
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingWhatsAppReplyDraft(text: string): PendingWhatsAppReplyDraft | undefined {
  const match = text.match(/WHATSAPP_REPLY_DRAFT\s*([\s\S]*?)\s*END_WHATSAPP_REPLY_DRAFT/i);
  if (!match?.[1]?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as PendingWhatsAppReplyDraft;
    if (
      parsed?.kind !== "whatsapp_reply" ||
      !parsed.remoteJid?.trim() ||
      !parsed.number?.trim() ||
      typeof parsed.replyText !== "string"
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function extractPendingActionDraft(text: string): PendingActionDraft | undefined {
  return (
    extractPendingEmailDraft(text) ??
    extractPendingWhatsAppReplyDraft(text) ??
    extractPendingGoogleTaskDraft(text) ??
    extractPendingGoogleEventDraft(text) ??
    extractPendingGoogleEventUpdateDraft(text) ??
    extractPendingGoogleEventImportBatchDraft(text) ??
    extractPendingGoogleEventDeleteBatchDraft(text) ??
    extractPendingGoogleEventDeleteDraft(text)
  );
}

function parsePendingActionDraftPayload(payload: string): PendingActionDraft | undefined {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    if (!parsed || typeof parsed.kind !== "string") {
      return undefined;
    }

    if (parsed.kind === "email_reply" && typeof parsed.uid === "string" && typeof parsed.body === "string") {
      return {
        kind: "email_reply",
        uid: parsed.uid,
        body: parsed.body,
        subjectOverride: typeof parsed.subjectOverride === "string" ? parsed.subjectOverride : undefined,
      };
    }

    if (
      parsed.kind === "whatsapp_reply" &&
      typeof parsed.remoteJid === "string" &&
      typeof parsed.number === "string" &&
      typeof parsed.inboundText === "string" &&
      typeof parsed.replyText === "string"
    ) {
      return {
        kind: "whatsapp_reply",
        instanceName: typeof parsed.instanceName === "string" ? parsed.instanceName : undefined,
        account: typeof parsed.account === "string" ? parsed.account : undefined,
        remoteJid: parsed.remoteJid,
        number: parsed.number,
        pushName: typeof parsed.pushName === "string" ? parsed.pushName : undefined,
        inboundText: parsed.inboundText,
        replyText: parsed.replyText,
        relationship: typeof parsed.relationship === "string" ? parsed.relationship : undefined,
        persona: typeof parsed.persona === "string" ? parsed.persona : undefined,
      };
    }

    if (
      parsed.kind === "monitored_channel_alert" &&
      parsed.sourceProvider === "whatsapp" &&
      typeof parsed.sourceChannelId === "string" &&
      typeof parsed.sourceDisplayName === "string" &&
      typeof parsed.sourceRemoteJid === "string" &&
      typeof parsed.sourceNumber === "string" &&
      typeof parsed.sourceText === "string" &&
      typeof parsed.classification === "string" &&
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.reasons) &&
      typeof parsed.suggestedAction === "string"
    ) {
      return parsed as unknown as PendingMonitoredChannelAlertDraft;
    }

    if (
      parsed.kind === "youtube_publish" &&
      typeof parsed.contentItemId === "number" &&
      typeof parsed.filePath === "string" &&
      typeof parsed.title === "string" &&
      typeof parsed.description === "string"
    ) {
      return {
        kind: "youtube_publish",
        contentItemId: parsed.contentItemId,
        filePath: parsed.filePath,
        title: parsed.title,
        description: parsed.description,
        privacyStatus:
          parsed.privacyStatus === "private" || parsed.privacyStatus === "unlisted" || parsed.privacyStatus === "public"
            ? parsed.privacyStatus
            : "public",
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((value) => String(value).trim()).filter(Boolean).slice(0, 10)
          : [],
      };
    }

    if (parsed.kind === "google_task" && typeof parsed.title === "string") {
      return parsed as unknown as PendingGoogleTaskDraft;
    }

    if (parsed.kind === "google_event" && typeof parsed.summary === "string" && typeof parsed.start === "string" && typeof parsed.end === "string") {
      return parsed as unknown as PendingGoogleEventDraft;
    }

    if (
      parsed.kind === "google_event_update" &&
      typeof parsed.eventId === "string" &&
      typeof parsed.summary === "string" &&
      typeof parsed.start === "string" &&
      typeof parsed.end === "string"
    ) {
      return parsed as unknown as PendingGoogleEventUpdateDraft;
    }

    if (parsed.kind === "google_event_delete" && typeof parsed.eventId === "string" && typeof parsed.summary === "string") {
      return parsed as unknown as PendingGoogleEventDeleteDraft;
    }

    if (parsed.kind === "google_event_delete_batch" && Array.isArray(parsed.events) && parsed.events.length > 0) {
      return parsed as unknown as PendingGoogleEventDeleteBatchDraft;
    }

    if (parsed.kind === "google_event_import_batch" && Array.isArray(parsed.events) && parsed.events.length > 0) {
      return parsed as unknown as PendingGoogleEventImportBatchDraft;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function stripPendingDraftMarkers(text: string): string {
  return text
    .replace(/EMAIL_REPLY_DRAFT[\s\S]*?END_EMAIL_REPLY_DRAFT/gi, "")
    .replace(/WHATSAPP_REPLY_DRAFT[\s\S]*?END_WHATSAPP_REPLY_DRAFT/gi, "")
    .replace(/GOOGLE_TASK_DRAFT[\s\S]*?END_GOOGLE_TASK_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DRAFT[\s\S]*?END_GOOGLE_EVENT_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_UPDATE_DRAFT[\s\S]*?END_GOOGLE_EVENT_UPDATE_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DELETE_DRAFT[\s\S]*?END_GOOGLE_EVENT_DELETE_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_IMPORT_BATCH_DRAFT[\s\S]*?END_GOOGLE_EVENT_IMPORT_BATCH_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DELETE_BATCH_DRAFT[\s\S]*?END_GOOGLE_EVENT_DELETE_BATCH_DRAFT/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildApprovalCallbackData(action: "send" | "edit" | "discard", id: number): string {
  return `approval:${action}:${id}`;
}

function parseApprovalCallbackData(data: string | undefined): { action: "send" | "edit" | "discard"; id: number } | null {
  if (!data) {
    return null;
  }
  const match = data.match(/^approval:(send|edit|discard):(\d+)$/);
  if (!match) {
    return null;
  }
  const id = Number.parseInt(match[2], 10);
  if (!Number.isFinite(id)) {
    return null;
  }
  return {
    action: match[1] as "send" | "edit" | "discard",
    id,
  };
}

function buildApprovalInlineKeyboard(id: number): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Enviar", callback_data: buildApprovalCallbackData("send", id) },
      { text: "Editar", callback_data: buildApprovalCallbackData("edit", id) },
      { text: "Ignorar", callback_data: buildApprovalCallbackData("discard", id) },
    ]],
  };
}

function sanitizeToolPayloadLeak(text: string): string {
  const trimmed = text.trim();
  const normalized = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!(normalized.startsWith("{") && normalized.endsWith("}"))) {
    return text;
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const functionName =
      (typeof parsed.function_name === "string" && parsed.function_name) ||
      (typeof parsed.name === "string" && parsed.name) ||
      undefined;
    const hasArguments = parsed.arguments && typeof parsed.arguments === "object";

    if (!functionName || !hasArguments) {
      return text;
    }

    return [
      "O agente tentou executar uma ferramenta, mas não consolidou a resposta final.",
      `Ferramenta detectada: ${functionName}`,
      "Reformule de forma mais específica ou tente novamente.",
    ].join("\n");
  } catch {
    return text;
  }
}

function buildEmailSendSuccessMessage(rawResult: unknown, fallbackUid: string): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const sent = record?.sent && typeof record.sent === "object"
    ? (record.sent as Record<string, unknown>)
    : undefined;
  const original = record?.original && typeof record.original === "object"
    ? (record.original as Record<string, unknown>)
    : undefined;

  const subject = typeof sent?.subject === "string" ? sent.subject : undefined;
  const messageId = typeof sent?.messageId === "string" ? sent.messageId : undefined;
  const recipients = Array.isArray(sent?.to)
    ? sent.to.map((value) => String(value)).filter(Boolean)
    : [];
  const originalUid =
    typeof original?.uid === "string" && original.uid.trim()
      ? original.uid
      : fallbackUid;

  const lines = [
    "Email enviado com sucesso.",
    `UID original: ${originalUid}`,
  ];

  if (subject) {
    lines.push(`Assunto: ${subject}`);
  }

  if (recipients.length > 0) {
    lines.push(`Destinatário: ${recipients.join(", ")}`);
  }

  if (messageId) {
    lines.push(`Message-ID: ${messageId}`);
  }

  return lines.join("\n");
}

function buildEmailSendFailureMessage(rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const delivery = record?.delivery && typeof record.delivery === "object"
    ? (record.delivery as Record<string, unknown>)
    : undefined;
  const message = typeof delivery?.message === "string"
    ? delivery.message
    : "O envio de email não está pronto. Verifique a configuração SMTP.";

  return [
    "Não foi possível enviar o email nesta tentativa.",
    `Detalhe: ${message}`,
  ].join("\n");
}

function formatLocalDateTime(value: string | undefined, timeZone = "America/Sao_Paulo"): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildGoogleTaskCreateSuccessMessage(rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const task = record?.task && typeof record.task === "object"
    ? (record.task as Record<string, unknown>)
    : undefined;
  const lines = ["Tarefa do Google criada com sucesso."];
  if (typeof task?.title === "string") {
    lines.push(`Título: ${task.title}`);
  }
  if (typeof task?.taskListTitle === "string") {
    lines.push(`Lista: ${task.taskListTitle}`);
  }
  if (typeof task?.due === "string") {
    lines.push(`Prazo: ${formatLocalDateTime(task.due) ?? task.due}`);
  }
  if (typeof task?.id === "string") {
    lines.push(`ID: ${task.id}`);
  }
  return lines.join("\n");
}

function buildCompactPendingActionReply(draft: PendingActionDraft): string | undefined {
  if (draft.kind === "whatsapp_reply") {
    return [
      `Rascunho WhatsApp pronto para ${draft.pushName ?? draft.number}.`,
      ...(draft.account ? [`Conta: ${draft.account}.`] : []),
      ...(draft.instanceName ? [`Instância: ${draft.instanceName}.`] : []),
      `Resposta: ${draft.replyText}`,
      "Use os botões `Enviar`, `Editar` ou `Ignorar`.",
    ].join("\n");
  }

  if (draft.kind === "monitored_channel_alert") {
    return buildMonitoredChannelAlertReply(draft);
  }

  if (draft.kind === "google_event") {
    return [
      `Evento pronto: ${draft.summary}.`,
      `Proposta: ${formatLocalDateTime(draft.start, draft.timezone) ?? draft.start}–${formatLocalDateTime(draft.end, draft.timezone)?.split(" ").pop() ?? draft.end}${draft.location ? `, local ${draft.location}` : ""}.`,
      "Confirme com `agendar`.",
    ].join("\n");
  }

  if (draft.kind === "google_event_update") {
    return [
      `Evento identificado: ${draft.originalSummary ?? draft.summary}.`,
      `Proposta: ${formatLocalDateTime(draft.start, draft.timezone) ?? draft.start}–${formatLocalDateTime(draft.end, draft.timezone)?.split(" ").pop() ?? draft.end}${draft.location ? `, local ${draft.location}` : ""}.`,
      "Confirme com `agendar`.",
    ].join("\n");
  }

  if (draft.kind === "google_event_delete") {
    return [
      `Cancelar: ${draft.summary}.`,
      `${draft.start ? `Horário: ${formatLocalDateTime(draft.start, draft.timezone)}` : ""}`,
      "Confirme com `agendar`.",
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_task") {
    return [
      `Tarefa pronta: ${draft.title}.`,
      draft.due ? `Prazo: ${formatLocalDateTime(draft.due) ?? draft.due}.` : undefined,
      "Confirme com `agendar`.",
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event_import_batch") {
    return [
      `Importação pronta: ${draft.events.length} evento(s) para ${draft.account ?? "default"}.`,
      typeof draft.relevantCount === "number" ? `Relevantes para você: ${draft.relevantCount}.` : undefined,
      ...draft.events.map((event) => `- ${event.summary} | ${formatLocalDateTime(event.start, draft.timezone) ?? event.start}`),
      "Confirme com `agendar`.",
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "youtube_publish") {
    return [
      `Upload do YouTube pronto para o item #${draft.contentItemId}.`,
      `Título: ${draft.title}`,
      `Privacidade: ${draft.privacyStatus}`,
      "Use `Enviar` para publicar no YouTube.",
    ].join("\n");
  }

  return undefined;
}

function buildPendingActionSubject(draft: PendingActionDraft): string {
  if (draft.kind === "email_reply") {
    return `Email UID ${draft.uid}`;
  }
  if (draft.kind === "whatsapp_reply") {
    return `WhatsApp${draft.account ? ` ${draft.account}` : ""}: ${draft.pushName ?? draft.number}`;
  }
  if (draft.kind === "monitored_channel_alert") {
    return `Alerta monitorado${draft.sourceAccount ? ` ${draft.sourceAccount}` : ""}: ${draft.sourcePushName ?? draft.sourceNumber}`;
  }
  if (draft.kind === "google_task") {
    return `Tarefa Google: ${draft.title}`;
  }
  if (draft.kind === "google_event") {
    return `Evento Google: ${draft.summary}`;
  }
  if (draft.kind === "google_event_update") {
    return `Atualização de evento: ${draft.summary}`;
  }
  if (draft.kind === "google_event_delete") {
    return `Cancelar evento: ${draft.summary}`;
  }
  if (draft.kind === "google_event_import_batch") {
    return `Importação de agenda: ${draft.events.length} evento(s)`;
  }
  if (draft.kind === "youtube_publish") {
    return `YouTube: item #${draft.contentItemId}`;
  }
  return `Cancelamento em lote (${draft.events.length} eventos)`;
}

function buildWhatsAppSendSuccessMessage(rawResult: unknown, draft: PendingWhatsAppReplyDraft): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  return [
    "Resposta de WhatsApp enviada com sucesso.",
    `Contato: ${draft.pushName ?? draft.number}`,
    ...(draft.account ? [`Conta: ${draft.account}`] : []),
    ...(draft.instanceName ? [`Instância: ${draft.instanceName}`] : []),
    record ? `Retorno: ${JSON.stringify(record).slice(0, 300)}` : undefined,
  ].filter(Boolean).join("\n");
}

function buildApprovalListReply(items: ApprovalInboxItemRecord[]): string {
  if (items.length === 0) {
    return "Não há aprovações pendentes neste chat.";
  }

  const ranked = rankApprovals(items);
  const byAction = new Map<string, number>();
  for (const entry of ranked) {
    byAction.set(entry.item.actionKind, (byAction.get(entry.item.actionKind) ?? 0) + 1);
  }

  return [
    "Leitura operacional:",
    `- Objetivo: revisar aprovações pendentes neste chat`,
    "",
    "Situação agora:",
    `- ${ranked.length} aprovação(ões) pendente(s)`,
    `- Tipos: ${[...byAction.entries()].map(([kind, count]) => `${kind}=${count}`).join(" | ")}`,
    "",
    "Prioridades:",
    ...ranked.map((entry) => `- #${entry.item.id} | ${entry.urgency.toUpperCase()} | ${entry.item.actionKind} | ${entry.item.subject} | ${entry.reason}`),
    "",
    `Próxima ação: decidir primeiro ${ranked[0].item.subject}.`,
  ].join("\n");
}

function buildGoogleEventCreateSuccessMessage(rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const event = record?.event && typeof record.event === "object"
    ? (record.event as Record<string, unknown>)
    : undefined;
  const lines = ["Evento do Google criado com sucesso."];
  if (typeof event?.summary === "string") {
    lines.push(`Título: ${event.summary}`);
  }
  if (typeof event?.start === "string") {
    lines.push(`Início: ${formatLocalDateTime(event.start) ?? event.start}`);
  }
  if (typeof event?.end === "string") {
    lines.push(`Fim: ${formatLocalDateTime(event.end) ?? event.end}`);
  }
  if (typeof event?.reminderMinutes === "number") {
    lines.push(`Lembrete: ${event.reminderMinutes} minutos antes`);
  }
  if (typeof event?.meetLink === "string") {
    lines.push(`Meet: ${event.meetLink}`);
  }
  if (Array.isArray(event?.attendees) && event.attendees.length > 0) {
    lines.push(`Convidados: ${event.attendees.join(", ")}`);
  }
  if (typeof event?.htmlLink === "string") {
    lines.push(`Link: ${event.htmlLink}`);
  }
  if (typeof event?.id === "string") {
    lines.push(`ID: ${event.id}`);
  }
  return lines.join("\n");
}

function buildGoogleEventDeleteSuccessMessage(rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const event = record?.event && typeof record.event === "object"
    ? (record.event as Record<string, unknown>)
    : undefined;
  const lines = ["Evento do Google cancelado com sucesso."];
  if (typeof event?.id === "string") {
    lines.push(`ID: ${event.id}`);
  }
  if (typeof event?.calendarId === "string") {
    lines.push(`Calendário: ${event.calendarId}`);
  }
  return lines.join("\n");
}

function buildGoogleEventUpdateSuccessMessage(rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const event = record?.event && typeof record.event === "object"
    ? (record.event as Record<string, unknown>)
    : undefined;
  const lines = ["Evento do Google atualizado com sucesso."];
  if (typeof event?.summary === "string") {
    lines.push(`Título: ${event.summary}`);
  }
  if (typeof event?.start === "string") {
    lines.push(`Início: ${formatLocalDateTime(event.start) ?? event.start}`);
  }
  if (typeof event?.end === "string") {
    lines.push(`Fim: ${formatLocalDateTime(event.end) ?? event.end}`);
  }
  if (typeof event?.location === "string") {
    lines.push(`Local: ${event.location}`);
  }
  if (Array.isArray(event?.attendees) && event.attendees.length > 0) {
    lines.push(`Convidados: ${event.attendees.join(", ")}`);
  }
  if (typeof event?.reminderMinutes === "number") {
    lines.push(`Lembrete: ${event.reminderMinutes} minutos antes`);
  }
  if (typeof event?.meetLink === "string") {
    lines.push(`Meet: ${event.meetLink}`);
  }
  if (typeof event?.htmlLink === "string") {
    lines.push(`Link: ${event.htmlLink}`);
  }
  return lines.join("\n");
}

function buildGoogleEventImportBatchSuccessMessage(
  pendingDraft: PendingGoogleEventImportBatchDraft,
  rawResult: unknown,
): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const created = Array.isArray(record?.created)
    ? record.created as Array<Record<string, unknown>>
    : [];
  const failed = Array.isArray(record?.failed)
    ? record.failed as Array<Record<string, unknown>>
    : [];

  const lines = [
    failed.length > 0 ? "Importação da agenda concluída parcialmente." : "Importação da agenda concluída.",
    `Conta: ${pendingDraft.account ?? "default"}`,
    `Eventos criados: ${created.length}`,
    ...(typeof pendingDraft.relevantCount === "number" ? [`Relevantes para você: ${pendingDraft.relevantCount}`] : []),
  ];

  for (const event of created) {
    const summary = typeof event.summary === "string" ? event.summary : "Evento";
    const start = typeof event.start === "string" ? formatLocalDateTime(event.start, pendingDraft.timezone) ?? event.start : undefined;
    lines.push(`- ${summary}${start ? ` | ${start}` : ""}`);
  }

  if (failed.length > 0) {
    lines.push(`Falhas: ${failed.length}`);
    for (const event of failed) {
      const summary = typeof event.summary === "string" ? event.summary : "Evento";
      lines.push(`- falhou: ${summary}`);
    }
  }

  return lines.join("\n");
}

function buildGenericControlledActionFailureMessage(label: string, rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  const status = record?.status && typeof record.status === "object"
    ? (record.status as Record<string, unknown>)
    : undefined;
  const message = typeof status?.message === "string"
    ? status.message
    : `Falha ao executar ${label}.`;
  return [`Não foi possível concluir ${label} nesta tentativa.`, `Detalhe: ${message}`].join("\n");
}

function buildAgentPrompt(
  message: TelegramMessage,
  text: string,
  history: ChatTurn[],
  mode?: OperationalModeState | null,
): string {
  const promptLines = [
    "Contexto do Telegram:",
    `chat_type=${message.chat.type}`,
    `chat_id=${message.chat.id}`,
    `user_id=${message.from?.id ?? "unknown"}`,
    "",
  ];

  if (history.length > 0) {
    promptLines.push("Histórico recente do chat:");
    for (const turn of history) {
      promptLines.push(`${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.text}`);
    }
    promptLines.push("");
  }

  if (mode) {
    promptLines.push("Modo operacional ativo:");
    promptLines.push(`modo_operacional=${mode.kind}`);
    promptLines.push(`motivo=${mode.reason}`);
    promptLines.push("");
  }

  promptLines.push("Mensagem atual do usuário:");
  promptLines.push(text);
  return promptLines.join("\n");
}

function extractOperationalModeIntent(text: string): { action: "activate" | "deactivate"; reason: string } | null {
  const normalized = normalizeIntentText(text);
  if (!normalized) {
    return null;
  }

  if (includesAny(normalized, [
    "sair do plantao",
    "sair do plantão",
    "encerrar plantao",
    "encerrar plantão",
    "modo normal",
    "desativar modo rua",
    "fim do plantao",
    "fim do plantão",
  ])) {
    return {
      action: "deactivate",
      reason: "modo normal",
    };
  }

  if (includesAny(normalized, [
    "estou em plantao",
    "estou em plantão",
    "estou na rua",
    "vou sair e so volto amanha",
    "vou sair e só volto amanhã",
    "vou direto do",
    "estou em campo",
    "modo rua",
    "entrar em plantao",
    "entrar em plantão",
  ])) {
    return {
      action: "activate",
      reason: text.trim(),
    };
  }

  return null;
}

function buildPendingDraftAdjustmentPrompt(pendingDraft: PendingEmailDraft, userInstruction: string): string {
  return [
    `Ajuste o rascunho pendente do email UID ${pendingDraft.uid}.`,
    "Use o texto atual como base e aplique exatamente as instruções do usuário.",
    "Não envie ainda.",
    "",
    "Rascunho atual:",
    pendingDraft.body,
    "",
    "Instruções do usuário:",
    userInstruction,
  ].join("\n");
}

function extractLatestUserTurn(history: ChatTurn[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role === "user" && turn.text.trim()) {
      return turn.text.trim();
    }
  }
  return undefined;
}

function extractDateReference(text: string): string | undefined {
  return text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)?.[0];
}

function extractCalendarChoiceOption(optionLabel: string): { summary: string; account?: string; date?: string } | null {
  const account = optionLabel.match(/\|\s*conta:\s*([^|]+)$/i)?.[1]?.trim();
  const withoutAccount = optionLabel.replace(/\|\s*conta:\s*([^|]+)$/i, "").trim();
  const [summaryPart] = withoutAccount.split(/\s+—\s+/);
  const summary = summaryPart?.trim();
  const date = extractDateReference(withoutAccount);
  if (!summary) {
    return null;
  }
  return {
    summary,
    account,
    date,
  };
}

function buildConcretePromptFromPendingChoice(history: ChatTurn[], optionLabel: string): string | null {
  const latestUserTurn = extractLatestUserTurn(history);
  const selected = extractCalendarChoiceOption(optionLabel);
  if (!latestUserTurn || !selected) {
    return null;
  }

  const normalized = normalizeIntentText(latestUserTurn);
  const dateReference = extractDateReference(latestUserTurn) ?? selected.date;
  const dateSegment = dateReference ? ` em ${dateReference}` : "";
  const accountSegment = selected.account ? ` na conta ${selected.account}` : "";

  if (includesAny(normalized, [
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
  ])) {
    return `cancele o evento ${selected.summary}${dateSegment}${accountSegment}`;
  }

  const updateMatch = latestUserTurn.match(
    /\b(mova|mover|reagende|reagendar|mude|mudar|altere|alterar|atualize|atualizar|ajuste|ajustar|edite|editar|renomeie|renomear)\s+o?\s*evento\s+(.+?)\s+(para|com)\s+([\s\S]+)/i,
  );
  if (!updateMatch?.[1] || !updateMatch[3] || !updateMatch[4]?.trim()) {
    return null;
  }

  return `${updateMatch[1]} o evento ${selected.summary}${dateSegment}${accountSegment} ${updateMatch[3]} ${updateMatch[4].trim()}`;
}

export class TelegramService {
  private readonly hasAllowlist: boolean;
  private readonly chatHistory = new Map<number, ChatTurn[]>();
  private readonly pendingActionDrafts = new Map<number, PendingActionDraft>();
  private readonly pendingChoiceStates = new Map<number, PendingChoiceState>();
  private readonly lastCalendarUndoActions = new Map<number, CalendarUndoAction>();
  private readonly operationalModes = new Map<number, OperationalModeState>();
  private readonly voiceHandler?: VoiceMessageHandler;
  private readonly scheduleImport?: OpenAiScheduleImportService;
  private readonly whatsapp: EvolutionApiClient;
  private readonly videoRenderer: ShortVideoRenderService;
  private readonly youtubePublisher: YouTubePublisherService;
  private backgroundJobsStarted = false;
  private lastMorningBriefRunKey?: string;
  private lastEditorialCutoffRunKey?: string;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly core: AgentCore,
    private readonly contentOps: ContentOpsStore,
    googleAuth: GoogleWorkspaceAuthService,
    private readonly api: TelegramApi,
    private readonly approvalEngine: ApprovalEngine,
    private readonly clarificationEngine: ClarificationEngine,
    private readonly whatsappMessages: WhatsAppMessageStore,
  ) {
    this.hasAllowlist = this.config.telegram.allowedUserIds.length > 0;
    this.whatsapp = new EvolutionApiClient(
      this.config.whatsapp,
      this.logger.child({ scope: "whatsapp-evolution" }),
    );
    this.videoRenderer = new ShortVideoRenderService(
      this.config,
      this.logger.child({ scope: "short-video-renderer" }),
    );
    this.youtubePublisher = new YouTubePublisherService(
      googleAuth,
      this.logger.child({ scope: "youtube-publisher" }),
    );
    this.voiceHandler = createVoiceMessageHandler(
      this.config,
      this.logger.child({ scope: "telegram-voice" }),
    );
    if (this.config.llm.provider === "openai" && this.config.llm.apiKey) {
      this.scheduleImport = new OpenAiScheduleImportService(
        this.config.llm.apiKey,
        this.config.llm.baseUrl,
        this.config.llm.model,
        this.logger.child({ scope: "schedule-import" }),
      );
    }
  }

  private getOperationalMode(chatId: number): OperationalModeState | null {
    const mode = this.operationalModes.get(chatId);
    if (!mode) {
      return null;
    }
    if (mode.expiresAt <= Date.now()) {
      this.operationalModes.delete(chatId);
      return null;
    }
    return mode;
  }

  private activateOperationalMode(chatId: number, reason: string): OperationalModeState {
    const mode: OperationalModeState = {
      kind: "field",
      reason: reason.trim() || "operação externa",
      activatedAt: Date.now(),
      expiresAt: Date.now() + this.config.telegram.operationalModeHours * 60 * 60 * 1000,
    };
    this.operationalModes.set(chatId, mode);
    return mode;
  }

  private clearOperationalMode(chatId: number): void {
    this.operationalModes.delete(chatId);
  }

  async start(signal: AbortSignal): Promise<void> {
    if (!this.config.telegram.botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is required to start the Telegram integration");
    }

    const bot = await this.api.getMe();
    await this.api.deleteWebhook(false);

    this.logger.info("Telegram bot ready", {
      botId: bot.id,
      username: bot.username,
      allowlistedUsers: this.config.telegram.allowedUserIds,
      allowlistConfigured: this.hasAllowlist,
    });

    this.startBackgroundJobs(signal);

    let offset = 0;

    while (!signal.aborted) {
      try {
        const updates = await this.api.getUpdates({
          offset,
          timeout: this.config.telegram.pollTimeoutSeconds,
          allowed_updates: ["message", "callback_query"],
        });

        for (const update of updates) {
          offset = update.update_id + 1;
          await this.handleUpdate(update, bot);
        }
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        this.logger.error("Telegram polling failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        await delay(2000, undefined, { signal }).catch(() => undefined);
      }
    }
  }

  private startBackgroundJobs(signal: AbortSignal): void {
    if (this.backgroundJobsStarted) {
      return;
    }
    this.backgroundJobsStarted = true;
    if (this.config.telegram.dailyEditorialAutomationEnabled) {
      void this.runDailyEditorialResearchLoop(signal);
      void this.runDailyEditorialCutoffLoop(signal);
    } else {
      this.logger.info("Daily editorial automation disabled; skipping automatic research and cutoff loops.");
    }
    if (this.config.telegram.morningBriefEnabled) {
      void this.runWeekdayMorningBriefLoop(signal);
    } else {
      this.logger.info("Morning brief automation disabled; skipping weekday morning brief loop.");
    }
  }

  private async runDailyEditorialResearchLoop(signal: AbortSignal): Promise<void> {
    const timezone = this.config.google.defaultTimezone || "America/Sao_Paulo";
    while (!signal.aborted) {
      try {
        const now = new Date();
        const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
        const hour = local.getHours();
        const minute = local.getMinutes();

        if (hour === 6 && minute < 5) {
          const result = await this.core.runDailyEditorialResearch({
            channelKey: "riqueza_despertada_youtube",
            timezone,
            trendsLimit: 10,
            ideasLimit: 6,
            now,
          });

          if (!result.skipped) {
            for (const chatId of this.config.telegram.allowedUserIds) {
              try {
                await this.sendText(chatId, result.reply, {
                  disable_web_page_preview: true,
                });
              } catch (error) {
                this.logger.warn("Failed to send daily editorial research packet", {
                  chatId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }
          }
        }
      } catch (error) {
        this.logger.error("Daily editorial research loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await delay(60_000, undefined, { signal }).catch(() => undefined);
    }
  }

  private async runWeekdayMorningBriefLoop(signal: AbortSignal): Promise<void> {
    const timezone = this.config.google.defaultTimezone || "America/Sao_Paulo";
    while (!signal.aborted) {
      try {
        const now = new Date();
        const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
        const weekday = local.getDay();
        const hour = local.getHours();
        const minute = local.getMinutes();
        const runKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;

        if (weekday >= 1 && weekday <= 5 && hour === 6 && minute >= 30 && minute < 35 && this.lastMorningBriefRunKey !== runKey) {
          const result = await this.core.runUserPrompt("gere meu briefing da manhã");
          for (const chatId of this.config.telegram.allowedUserIds) {
            try {
              await this.sendText(chatId, result.reply, {
                disable_web_page_preview: true,
              });
            } catch (error) {
              this.logger.warn("Failed to send weekday morning brief", {
                chatId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
          this.lastMorningBriefRunKey = runKey;
        }
      } catch (error) {
        this.logger.error("Weekday morning brief loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await delay(60_000, undefined, { signal }).catch(() => undefined);
    }
  }

  private async runDailyEditorialCutoffLoop(signal: AbortSignal): Promise<void> {
    const timezone = this.config.google.defaultTimezone || "America/Sao_Paulo";
    const channelKey = "riqueza_despertada_youtube";
    const cutoffRunType = "daily_slot_cutoff";

    while (!signal.aborted) {
      try {
        const now = new Date();
        const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
        const hour = local.getHours();
        const minute = local.getMinutes();
        const runKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
        const existing = this.contentOps.getLatestResearchRun(channelKey, cutoffRunType, runKey);

        if (existing?.status === "success") {
          this.lastEditorialCutoffRunKey = runKey;
        }

        if (hour === 6 && minute >= 45 && minute < 50 && this.lastEditorialCutoffRunKey !== runKey) {
          await this.executeDailyEditorialCutoff({
            now,
            timezone,
            runDate: runKey,
            channelKey,
            cutoffRunType,
          });
          this.lastEditorialCutoffRunKey = runKey;
        }
      } catch (error) {
        this.logger.error("Daily editorial cutoff loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await delay(60_000, undefined, { signal }).catch(() => undefined);
    }
  }

  private async executeDailyEditorialCutoff(input: {
    now: Date;
    timezone: string;
    runDate: string;
    channelKey: string;
    cutoffRunType: string;
  }): Promise<void> {
    const existing = this.contentOps.getLatestResearchRun(input.channelKey, input.cutoffRunType, input.runDate);
    if (existing?.status === "success") {
      return;
    }

    let researchRun = this.contentOps.getLatestResearchRun(input.channelKey, "daily_research_brief", input.runDate);
    if (!researchRun || researchRun.status !== "success") {
      await this.core.runDailyEditorialResearch({
        channelKey: input.channelKey,
        timezone: input.timezone,
        trendsLimit: 10,
        ideasLimit: 6,
        now: input.now,
      });
      researchRun = this.contentOps.getLatestResearchRun(input.channelKey, "daily_research_brief", input.runDate);
    }

    if (!researchRun) {
      const summary = `Cutoff editorial das 06:45 falhou: briefing diário não encontrado para ${input.runDate}.`;
      this.contentOps.createResearchRun({
        channelKey: input.channelKey,
        runType: input.cutoffRunType,
        runDate: input.runDate,
        status: "failed",
        summary,
      });
      for (const chatId of this.config.telegram.allowedUserIds) {
        await this.sendText(chatId, summary, { disable_web_page_preview: true }).catch(() => undefined);
      }
      return;
    }

    const payload = parseDailyEditorialResearchPayload(researchRun.payloadJson);
    const candidateIds = Array.isArray(payload?.createdItemIds)
      ? payload!.createdItemIds.filter((value): value is number => Number.isFinite(value))
      : [];
    const candidates = candidateIds
      .map((id) => this.contentOps.getItemById(id))
      .filter((item): item is ContentItemRecord => Boolean(item))
      .filter((item) => item.channelKey === input.channelKey && item.status !== "archived" && item.status !== "published");

    const slotOrder: ScheduledEditorialSlotKey[] = ["morning_finance", "lunch_income", "night_trends"];
    const winners: Array<{
      slotKey: ScheduledEditorialSlotKey;
      item: ContentItemRecord;
      shortPackage: ParsedShortPackage;
      scheduledFor: string;
    }> = [];
    const failures: Array<{ slotKey: ScheduledEditorialSlotKey; error: string }> = [];

    for (const slotKey of slotOrder) {
      const slotCandidates = candidates
        .filter((item) => extractEditorialSlotKeyFromNotes(item.notes) === slotKey)
        .sort((left, right) => {
          const scoreDelta = scoreEditorialSelection(right) - scoreEditorialSelection(left);
          if (scoreDelta !== 0) {
            return scoreDelta;
          }
          return right.id - left.id;
        });

      const selected = slotCandidates[0];
      if (!selected) {
        failures.push({
          slotKey,
          error: "nenhum item disponível para este slot",
        });
        continue;
      }

      try {
        const resolved = await this.ensureShortPackageForItem(selected.id);
        if (!resolved.shortPackage) {
          failures.push({
            slotKey,
            error: `item #${selected.id} sem SHORT_PACKAGE_V3 após tentativa de geração`,
          });
          continue;
        }

        winners.push({
          slotKey,
          item: resolved.item,
          shortPackage: resolved.shortPackage,
          scheduledFor: buildEditorialTargetDate(input.runDate, slotKey),
        });
      } catch (error) {
        failures.push({
          slotKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (winners.length === 0) {
      const summary = [
        `Cutoff editorial das 06:45 falhou para ${input.runDate}.`,
        ...failures.map((failure) => `- ${getEditorialSlotSchedule(failure.slotKey).label}: ${failure.error}`),
      ].join("\n");
      this.contentOps.createResearchRun({
        channelKey: input.channelKey,
        runType: input.cutoffRunType,
        runDate: input.runDate,
        status: "failed",
        summary,
        payloadJson: JSON.stringify({ failures }),
      });
      for (const chatId of this.config.telegram.allowedUserIds) {
        await this.sendText(chatId, summary, { disable_web_page_preview: true }).catch(() => undefined);
      }
      return;
    }

    const kickoffSummary = [
      `Cutoff editorial das 06:45 concluído para ${input.runDate}.`,
      "Vencedores por slot:",
      ...winners.map((winner) => {
        const slot = getEditorialSlotSchedule(winner.slotKey);
        return `- ${slot.label} -> #${winner.item.id} | ${winner.item.title} | score: ${scoreEditorialSelection(winner.item)}`;
      }),
      ...(failures.length > 0
        ? ["", "Slots com ajuste pendente:", ...failures.map((failure) => `- ${getEditorialSlotSchedule(failure.slotKey).label}: ${failure.error}`)]
        : []),
      "",
      "Vou renderizar os rascunhos e colocar cada um na fila de publicação.",
    ].join("\n");

    for (const chatId of this.config.telegram.allowedUserIds) {
      await this.sendText(chatId, kickoffSummary, {
        disable_web_page_preview: true,
      }).catch((error) => {
        this.logger.warn("Failed to send editorial cutoff summary", {
          chatId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    if (!this.videoRenderer.isReady()) {
      const readiness = this.videoRenderer.getReadinessReport();
      const readinessReply = buildVideoPipelineReadinessReply({
        acceptedInput: readiness.acceptedInput,
        ttsProvider: readiness.ttsProvider === "openai" ? "OpenAI TTS" : "nenhum",
        ttsReady: readiness.ttsReady,
        assetsProvider: readiness.assetsProvider === "pexels" ? "Pexels" : "manual",
        assetsReady: readiness.assetsReady,
        canRender: readiness.canRender,
        youtubeUploadReady: this.youtubePublisher.canUpload(),
      });
      this.contentOps.createResearchRun({
        channelKey: input.channelKey,
        runType: input.cutoffRunType,
        runDate: input.runDate,
        status: "failed",
        summary: readinessReply,
        payloadJson: JSON.stringify({
          winners: winners.map((winner) => ({
            id: winner.item.id,
            slotKey: winner.slotKey,
            scheduledFor: winner.scheduledFor,
          })),
          failures,
        }),
      });
      for (const chatId of this.config.telegram.allowedUserIds) {
        await this.sendText(chatId, readinessReply, {
          disable_web_page_preview: true,
        }).catch(() => undefined);
      }
      return;
    }

    const renderedIds: number[] = [];
    const renderFailures: Array<{ id: number; slotKey: ScheduledEditorialSlotKey; error: string }> = [];
    for (const winner of winners) {
      for (const chatId of this.config.telegram.allowedUserIds) {
        try {
          const updated = await this.renderVideoDraftForItem({
            chatId,
            item: winner.item,
            shortPackage: winner.shortPackage,
            scheduledFor: winner.scheduledFor,
            slotKey: winner.slotKey,
            autoSelected: true,
          });
          renderedIds.push(updated.id);
          winner.item = updated;
        } catch (error) {
          renderFailures.push({
            id: winner.item.id,
            slotKey: winner.slotKey,
            error: error instanceof Error ? error.message : String(error),
          });
          this.logger.error("Automatic editorial cutoff render failed", {
            chatId,
            itemId: winner.item.id,
            slotKey: winner.slotKey,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const summary = [
      `Fila diária preparada para ${input.runDate}.`,
      `Vencedores: ${winners.length}`,
      `Rascunhos enfileirados: ${new Set(renderedIds).size}`,
      `Falhas de render: ${renderFailures.length}`,
      ...winners.map((winner) => {
        const slot = getEditorialSlotSchedule(winner.slotKey);
        return `- ${slot.label} -> #${winner.item.id} | ${winner.item.title} | agendado: ${slot.time}`;
      }),
      ...(renderFailures.length > 0
        ? ["", "Falhas:", ...renderFailures.map((failure) => `- #${failure.id} | ${getEditorialSlotSchedule(failure.slotKey).label} | ${failure.error}`)]
        : []),
    ].join("\n");

    this.contentOps.createResearchRun({
      channelKey: input.channelKey,
      runType: input.cutoffRunType,
      runDate: input.runDate,
      status: renderFailures.length === winners.length ? "failed" : "success",
      summary,
      payloadJson: JSON.stringify({
        winners: winners.map((winner) => ({
          id: winner.item.id,
          slotKey: winner.slotKey,
          scheduledFor: winner.scheduledFor,
        })),
        failures: [...failures, ...renderFailures.map((failure) => ({
          slotKey: failure.slotKey,
          error: failure.error,
        }))],
      }),
    });
  }

  private async ensureShortPackageForItem(itemId: number): Promise<{
    item: ContentItemRecord;
    shortPackage: ParsedShortPackage | null;
  }> {
    let item = this.contentOps.getItemById(itemId);
    if (!item) {
      throw new Error(`Content item not found: ${itemId}`);
    }

    let shortPackage = extractLatestShortPackage(item.notes);
    if (shortPackage) {
      return { item, shortPackage };
    }

    await this.core.runUserPrompt(`gere roteiro para o item #${itemId}`);
    item = this.contentOps.getItemById(itemId);
    if (!item) {
      throw new Error(`Content item not found after packaging: ${itemId}`);
    }
    shortPackage = extractLatestShortPackage(item.notes);
    return { item, shortPackage };
  }

  private async handleUpdate(update: TelegramUpdate, bot: TelegramUser): Promise<void> {
    if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message?.from) {
      return;
    }

    if (!shouldHandleMessage(message, bot)) {
      return;
    }

    const userId = message.from.id;
    const userAllowed = this.config.telegram.allowedUserIds.includes(userId);

    if (!userAllowed) {
      if (message.chat.type === "private") {
        await this.sendText(message.chat.id, buildUnauthorizedMessage(userId, this.hasAllowlist), {
          reply_to_message_id: message.message_id,
        });
      }
      return;
    }

    let text = extractMessageText(message);
    const importAttachment = extractImportAttachment(message);
    const audioAttachment = importAttachment ? undefined : (text ? undefined : extractTelegramVoiceAttachment(message));
    if (!text && !audioAttachment && !importAttachment) {
      await this.sendText(
        message.chat.id,
        "Esta versão processa texto, links, áudio, PDF e print de agenda.",
        {
          reply_to_message_id: message.message_id,
        },
      );
      return;
    }

    if (text === "/start") {
      this.clearChatHistory(message.chat.id);
      this.clearPendingChoiceState(message.chat.id);
      await this.sendText(message.chat.id, buildWelcomeMessage(bot, userId, userAllowed), {
        reply_to_message_id: message.message_id,
      });
      return;
    }

    if (text === "/id") {
      await this.sendText(
        message.chat.id,
        `user_id=${userId}\nchat_id=${message.chat.id}\nchat_type=${message.chat.type}`,
        {
          reply_to_message_id: message.message_id,
        },
      );
      return;
    }

    if (text === "/reset") {
      this.clearChatHistory(message.chat.id);
      this.clearPendingChoiceState(message.chat.id);
      await this.sendText(message.chat.id, "Histórico curto deste chat foi limpo.", {
        reply_to_message_id: message.message_id,
      });
      return;
    }

    if (!text && audioAttachment) {
      if (!this.voiceHandler) {
        await this.sendText(
          message.chat.id,
          "O processamento de voz ainda não está ativo neste ambiente. Manda em texto por enquanto.",
          {
            reply_to_message_id: message.message_id,
          },
        );
        return;
      }

      try {
        const transcription = await this.voiceHandler.handleTelegramVoice({
          chatId: message.chat.id,
          userId,
          attachment: audioAttachment,
          telegram: this.api,
        });
        text = transcription.text;
        this.logger.info("Telegram audio accepted as text input", {
          chatId: message.chat.id,
          userId,
          kind: audioAttachment.kind,
          provider: transcription.provider,
          model: transcription.model,
          sizeBytes: transcription.sizeBytes,
        });
      } catch (error) {
        this.logger.warn("Telegram audio processing failed", {
          chatId: message.chat.id,
          userId,
          kind: audioAttachment.kind,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sendText(
          message.chat.id,
          buildVoiceUserErrorMessage(error),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
        return;
      }
    }

    const resolvedText = text?.trim();
    if (!resolvedText && !importAttachment) {
      return;
    }

    const normalizedText = normalizeTelegramText(resolvedText ?? "", bot.username);
    if (!normalizedText && !importAttachment) {
      return;
    }

    if (importAttachment) {
      await this.handleScheduleImportAttachment(message, importAttachment, normalizedText || undefined);
      return;
    }

    const operationalModeIntent = extractOperationalModeIntent(normalizedText);
    if (operationalModeIntent) {
      if (operationalModeIntent.action === "deactivate") {
        this.clearOperationalMode(message.chat.id);
        await this.sendText(
          message.chat.id,
          "Modo operacional de rua desativado. Voltei ao comportamento normal neste chat.",
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
      } else {
        const mode = this.activateOperationalMode(message.chat.id, operationalModeIntent.reason);
        await this.sendText(
          message.chat.id,
          [
            "Modo operacional de rua ativado.",
            `- Duração padrão: ${this.config.telegram.operationalModeHours}h`,
            "- Vou priorizar agenda, deslocamento, clima, itens e resposta curta neste chat.",
            `- Contexto: ${mode.reason}`,
          ].join("\n"),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
      }
      return;
    }

    if (resolvedText && isManualVideoScriptRequest(resolvedText)) {
      await this.handleManualVideoScriptRequest(message, resolvedText);
      return;
    }

    if (resolvedText && isBatchScriptGenerationRequest(resolvedText)) {
      await this.handleBatchScriptGenerationRequest(message, resolvedText);
      return;
    }

    if (isVideoPipelineStatusRequest(normalizedText)) {
      await this.handleVideoPipelineStatusRequest(message);
      return;
    }

    if (isBatchVideoDraftRenderRequest(resolvedText ?? normalizedText)) {
      await this.handleBatchVideoDraftRenderRequest(message, resolvedText ?? normalizedText);
      return;
    }

    if (isVideoDraftRenderRequest(normalizedText)) {
      await this.handleVideoDraftRenderRequest(message, normalizedText);
      return;
    }

    if (text === "/approvals" || isApprovalListRequest(normalizedText)) {
      const items = this.approvalEngine.listPending(message.chat.id, 10);
      await this.sendText(
        message.chat.id,
        buildApprovalListReply(items),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    if (isUndoLastCalendarChangeRequest(normalizedText)) {
      await this.handleUndoLastCalendarChange(message, normalizedText);
      return;
    }

    if (isExplicitDeleteConfirmation(normalizedText)) {
      const pendingDraft = this.tryHydratePendingDraftForConfirmation(message.chat.id)
        ?? this.tryHydrateDeleteDraftFromRecentAssistantTurn(message.chat.id);
      if (pendingDraft) {
        await this.handlePendingActionConfirmation(message, normalizedText, pendingDraft);
        return;
      }
    } else if (isExplicitSendConfirmation(normalizedText)) {
      const pendingDraft = this.tryHydratePendingDraftForConfirmation(message.chat.id);
      if (pendingDraft) {
        await this.handlePendingActionConfirmation(message, normalizedText, pendingDraft);
        return;
      }
    } else if (!this.pendingActionDrafts.has(message.chat.id)) {
      this.clearPendingActionDraft(message.chat.id);
    }

    const pendingDraft = this.pendingActionDrafts.get(message.chat.id)
      ?? this.tryHydrateContinuablePendingDraft(message.chat.id);
    if (pendingDraft && isDraftDiscardRequest(normalizedText)) {
      this.clearPendingActionDraft(message.chat.id, "discarded");
      await this.sendText(message.chat.id, "Rascunho pendente descartado. Nenhuma ação foi executada.", {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    if (pendingDraft?.kind === "monitored_channel_alert") {
      const handled = await this.handleMonitoredChannelAlert(message, normalizedText, pendingDraft);
      if (handled) {
        return;
      }
    }

    if (pendingDraft?.kind === "google_event" || pendingDraft?.kind === "google_event_update") {
      const accountResolution = this.resolveShortCalendarAccountReply(normalizedText);
      if (accountResolution?.kind === "both") {
        this.logger.info("Calendar draft account clarification required", {
          chatId: message.chat.id,
          draftKind: pendingDraft.kind,
        });
        await this.sendText(message.chat.id, "Preciso saber em qual agenda: pessoal ou abordagem?", {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        });
        return;
      }

      if (accountResolution?.kind === "single") {
        if (
          pendingDraft.kind === "google_event_update" &&
          pendingDraft.account &&
          pendingDraft.account !== accountResolution.account
        ) {
          await this.sendText(
            message.chat.id,
            `Esse rascunho já está vinculado à conta ${pendingDraft.account}. Para mover entre agendas, diga novamente qual evento e a agenda de destino.`,
            {
              reply_to_message_id: message.message_id,
              disable_web_page_preview: true,
            },
          );
          return;
        }

        const updatedDraft: PendingGoogleEventDraft | PendingGoogleEventUpdateDraft = {
          ...pendingDraft,
          account: accountResolution.account,
        };
        this.pendingActionDrafts.set(message.chat.id, updatedDraft);
        const approval = this.persistPendingApproval(message.chat.id, updatedDraft);
        const reply =
          updatedDraft.kind === "google_event_update"
            ? buildGoogleEventUpdateDraftReply(updatedDraft)
            : buildGoogleEventDraftReply(updatedDraft);
        this.logger.info("Calendar draft account resolved from short contextual reply", {
          chatId: message.chat.id,
          account: accountResolution.account,
          draftKind: updatedDraft.kind,
        });
        await this.sendText(
          message.chat.id,
          stripPendingDraftMarkers(reply),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
            reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
          },
        );
        return;
      }
    }

    if (
      (pendingDraft?.kind === "google_event" || pendingDraft?.kind === "google_event_update") &&
      /^com(?:\s+google)?\s+meet\b/.test(normalizeIntentText(normalizedText))
    ) {
      const updatedDraft: PendingGoogleEventDraft | PendingGoogleEventUpdateDraft = {
        ...pendingDraft,
        createMeet: true,
      };
      this.pendingActionDrafts.set(message.chat.id, updatedDraft);
      await this.sendText(message.chat.id, [
        "Rascunho atualizado.",
        `- Título: ${updatedDraft.summary}`,
        `- Início: ${formatLocalDateTime(updatedDraft.start, updatedDraft.timezone) ?? updatedDraft.start}`,
        `- Fim: ${formatLocalDateTime(updatedDraft.end, updatedDraft.timezone) ?? updatedDraft.end}`,
        `- Lembrete: ${updatedDraft.reminderMinutes ?? 30} minutos antes`,
        "- Meet: incluído",
        "Confirme com `sim, quero` ou `agendar`.",
      ].join("\n"), {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    if (
      (pendingDraft?.kind === "google_event" || pendingDraft?.kind === "google_event_update") &&
      /^sem(?:\s+google)?\s+meet\b/.test(normalizeIntentText(normalizedText))
    ) {
      const updatedDraft: PendingGoogleEventDraft | PendingGoogleEventUpdateDraft = {
        ...pendingDraft,
        createMeet: false,
      };
      this.pendingActionDrafts.set(message.chat.id, updatedDraft);
      await this.sendText(message.chat.id, [
        "Rascunho atualizado.",
        `- Título: ${updatedDraft.summary}`,
        `- Início: ${formatLocalDateTime(updatedDraft.start, updatedDraft.timezone) ?? updatedDraft.start}`,
        `- Fim: ${formatLocalDateTime(updatedDraft.end, updatedDraft.timezone) ?? updatedDraft.end}`,
        `- Lembrete: ${updatedDraft.reminderMinutes ?? 30} minutos antes`,
        "- Meet: não incluído",
        "Confirme com `sim, quero` ou `agendar`.",
      ].join("\n"), {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    if (pendingDraft?.kind === "google_event" || pendingDraft?.kind === "google_event_update") {
      const adjustedDraft = adjustEventDraftFromInstruction(pendingDraft, normalizedText);
      if (adjustedDraft) {
        this.pendingActionDrafts.set(message.chat.id, adjustedDraft);
        const approval = this.persistPendingApproval(message.chat.id, adjustedDraft);
        const reply =
          adjustedDraft.kind === "google_event_update"
            ? buildGoogleEventUpdateDraftReply(adjustedDraft)
            : buildGoogleEventDraftReply(adjustedDraft);
        await this.sendText(
          message.chat.id,
          stripPendingDraftMarkers(reply),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
            reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
          },
        );
        if (isShortCalendarContextReply(normalizedText)) {
          this.logger.info("Calendar draft adjusted from short contextual reply", {
            chatId: message.chat.id,
            draftKind: adjustedDraft.kind,
          });
        }
        return;
      }
    }

    if (pendingDraft?.kind === "google_event_import_batch") {
      await this.sendText(
        message.chat.id,
        [
          "Há uma importação de agenda pendente neste chat.",
          "Confirme com `agendar`, descarte com `cancelar rascunho` ou envie um novo PDF/print para substituir o lote atual.",
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    if (pendingDraft?.kind === "whatsapp_reply" && !isClearlyNewTopLevelIntent(normalizedText)) {
      const updatedDraft: PendingWhatsAppReplyDraft = {
        ...pendingDraft,
        replyText: normalizedText,
      };
      this.pendingActionDrafts.set(message.chat.id, updatedDraft);
      const approval = this.persistPendingApproval(message.chat.id, updatedDraft);
      await this.sendText(
        message.chat.id,
        buildCompactPendingActionReply(updatedDraft) ?? `Rascunho WhatsApp atualizado: ${updatedDraft.replyText}`,
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
          reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
        },
      );
      return;
    }

    if (!pendingDraft) {
      const clarificationHandled = await this.handlePendingClarification(message, normalizedText);
      if (clarificationHandled) {
        return;
      }

      const pendingChoiceHandled = await this.handlePendingChoice(message, normalizedText);
      if (pendingChoiceHandled) {
        return;
      }

      const history = this.getChatHistory(message.chat.id);
      const clarification = await this.clarificationEngine.maybeRequest({
        chatId: message.chat.id,
        channel: "telegram",
        prompt: normalizedText,
        intent: this.core.resolveIntent(buildAgentPrompt(message, normalizedText, history, this.getOperationalMode(message.chat.id))),
      });
      if (clarification) {
        const reply = this.clarificationEngine.buildQuestionMessage(clarification);
        this.appendChatTurn(message.chat.id, {
          role: "user",
          text: normalizedText,
        });
        this.appendChatTurn(message.chat.id, {
          role: "assistant",
          text: reply,
        });
        await this.sendText(message.chat.id, reply, {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        });
        return;
      }
    }

    try {
      const history = this.getChatHistory(message.chat.id);
      const pendingEmailDraft = pendingDraft?.kind === "email_reply" ? pendingDraft : undefined;
      const effectiveText = pendingEmailDraft
        ? buildPendingDraftAdjustmentPrompt(pendingEmailDraft, normalizedText)
        : normalizedText;
      if (pendingDraft && pendingDraft.kind !== "email_reply") {
        this.clearPendingActionDraft(message.chat.id);
      }
      const result = await this.core.runUserPrompt(
        buildAgentPrompt(message, effectiveText, history, this.getOperationalMode(message.chat.id)),
        { chatId: message.chat.id },
      );
      const structuredDecisionReply = await this.resolveStructuredAssistantDecisionReply(result.reply, message.chat.id);
      if (structuredDecisionReply.handled) {
        this.appendChatTurn(message.chat.id, {
          role: "user",
          text: pendingEmailDraft
            ? `${normalizedText} [ajuste de rascunho pendente]`
            : audioAttachment
              ? `[áudio] ${normalizedText}`
              : normalizedText,
        });
        this.appendChatTurn(message.chat.id, {
          role: "assistant",
          text: structuredDecisionReply.visibleReply,
        });
        await this.sendText(message.chat.id, structuredDecisionReply.visibleReply, {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        });
        return;
      }
      const nextPendingDraft = extractPendingActionDraft(result.reply);
      const baseVisibleReply = sanitizeToolPayloadLeak(stripPendingDraftMarkers(result.reply) || result.reply);
      const visibleReply =
        audioAttachment && nextPendingDraft
          ? buildCompactPendingActionReply(nextPendingDraft) ?? baseVisibleReply
          : baseVisibleReply;
      const approval = nextPendingDraft
        ? this.persistPendingApproval(message.chat.id, nextPendingDraft)
        : undefined;
      if (nextPendingDraft) {
        this.pendingActionDrafts.set(message.chat.id, nextPendingDraft);
      } else {
        this.clearPendingActionDraft(message.chat.id);
      }
      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: pendingEmailDraft
          ? `${normalizedText} [ajuste de rascunho pendente]`
          : audioAttachment
            ? `[áudio] ${normalizedText}`
            : normalizedText,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: visibleReply,
      });
      await this.sendText(message.chat.id, visibleReply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: false,
        reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
      });
    } catch (error) {
      this.logger.error("Telegram message processing failed", {
        chatId: message.chat.id,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendText(message.chat.id, buildAgentFailureMessage(error), {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
    }
  }

  private async handlePendingClarification(message: TelegramMessage, normalizedText: string): Promise<boolean> {
    const pending = this.clarificationEngine.getLatestPending(message.chat.id);
    if (!pending) {
      return false;
    }

    if (isClearlyNewTopLevelIntent(normalizedText)) {
      this.clarificationEngine.cancel(pending.id);
      return false;
    }

    if (isClarificationCancelRequest(normalizedText)) {
      this.clarificationEngine.cancel(pending.id);
      await this.sendText(
        message.chat.id,
        "Esclarecimento pendente cancelado. Pode mandar o próximo pedido.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return true;
    }

    if (pending.status === "pending_answer") {
      const updated = await this.clarificationEngine.answer(pending, normalizedText);
      if (isGoogleEventCreatePrompt(pending.originalPrompt) || isGoogleTaskCreatePrompt(pending.originalPrompt)) {
        let nextPendingDraft: PendingActionDraft | undefined;
        if (isGoogleEventCreatePrompt(pending.originalPrompt)) {
          const combinedPrompt = [pending.originalPrompt, normalizedText].filter(Boolean).join(" ");
          const baseDraft = buildEventDraftFromPrompt(pending.originalPrompt, this.config.google.defaultTimezone);
          if (baseDraft.draft) {
            const adjusted = adjustEventDraftFromInstruction(baseDraft.draft, normalizedText);
            nextPendingDraft = (adjusted ?? baseDraft.draft) as PendingGoogleEventDraft;
          } else {
            const combinedDraft = buildEventDraftFromPrompt(combinedPrompt, this.config.google.defaultTimezone);
            nextPendingDraft = combinedDraft.draft;
          }

          if (nextPendingDraft?.kind === "google_event") {
            if (refersToBothGoogleAccounts(combinedPrompt)) {
              await this.sendText(message.chat.id, "Preciso saber em qual agenda: pessoal ou abordagem?", {
                reply_to_message_id: message.message_id,
                disable_web_page_preview: true,
              });
              return true;
            }
            const explicitAccount = this.extractExplicitCalendarAccount(combinedPrompt);
            if (explicitAccount) {
              nextPendingDraft = {
                ...nextPendingDraft,
                account: explicitAccount,
              };
            }
            if (isShortCalendarContextReply(normalizedText)) {
              this.logger.info("Calendar clarification completed from short contextual reply", {
                chatId: message.chat.id,
                account: nextPendingDraft.account,
              });
            }
          }
        } else {
          const taskDraft = buildTaskDraftFromPrompt(
            [pending.originalPrompt, normalizedText].filter(Boolean).join(" "),
            this.config.google.defaultTimezone,
          );
          nextPendingDraft = taskDraft.draft;
        }

        if (nextPendingDraft) {
          this.clarificationEngine.confirm(updated.id);
          const visibleReply = nextPendingDraft.kind === "google_event"
            ? buildGoogleEventDraftReply(nextPendingDraft)
            : nextPendingDraft.kind === "google_task"
              ? buildGoogleTaskDraftReply(nextPendingDraft, this.config.google.defaultTimezone)
              : undefined;
          if (!visibleReply) {
            return false;
          }
          const approval = this.persistPendingApproval(message.chat.id, nextPendingDraft);
          this.pendingActionDrafts.set(message.chat.id, nextPendingDraft);
          this.appendChatTurn(message.chat.id, {
            role: "user",
            text: normalizedText,
          });
          this.appendChatTurn(message.chat.id, {
            role: "assistant",
            text: visibleReply,
          });
          await this.sendText(message.chat.id, visibleReply, {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
            reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
          });
          return true;
        }
      }

      if (this.clarificationEngine.shouldAutoExecuteAfterAnswer(updated)) {
        this.clarificationEngine.confirm(updated.id);
        await this.executeClarifiedPrompt(message, {
          effectiveText: updated.executionPrompt?.trim() || updated.originalPrompt,
          replyToMessageId: message.message_id,
          userHistoryText: normalizedText,
        });
        return true;
      }

      const reply = this.clarificationEngine.buildConfirmationMessage(updated);
      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: normalizedText,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: reply,
      });
      await this.sendText(message.chat.id, reply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return true;
    }

    if (pending.status === "pending_confirmation") {
      if (isExplicitSendConfirmation(normalizedText)) {
        this.clarificationEngine.confirm(pending.id);
        await this.executeClarifiedPrompt(message, {
          effectiveText: pending.executionPrompt?.trim() || pending.originalPrompt,
          replyToMessageId: message.message_id,
          userHistoryText: `${normalizedText} [confirmacao de contexto]`,
        });
        return true;
      }

      const updated = await this.clarificationEngine.answer(pending, normalizedText);
      const reply = this.clarificationEngine.buildConfirmationMessage(updated);
      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: `${normalizedText} [correcao de contexto]`,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: reply,
      });
      await this.sendText(message.chat.id, reply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return true;
    }

    return false;
  }

  private async handlePendingChoice(message: TelegramMessage, normalizedText: string): Promise<boolean> {
    if (this.clarificationEngine.getLatestPending(message.chat.id)) {
      return false;
    }

    const pending = this.getPendingChoiceState(message.chat.id);
    if (!pending) {
      return false;
    }

    if (isClearlyNewTopLevelIntent(normalizedText)) {
      this.clearPendingChoiceState(message.chat.id);
      return false;
    }

    const resolution = resolvePendingChoiceReply(pending, normalizedText);
    if (resolution.kind === "no_match") {
      if (normalizedText.length > 24 || normalizedText.split(/\s+/).length > 4) {
        this.clearPendingChoiceState(message.chat.id);
      }
      return false;
    }

    if (resolution.kind === "cancel" || resolution.kind === "clarify") {
      if (resolution.kind === "cancel") {
        this.clearPendingChoiceState(message.chat.id);
      }
      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: normalizedText,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: resolution.message,
      });
      await this.sendText(message.chat.id, resolution.message, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return true;
    }

    this.clearPendingChoiceState(message.chat.id);
    const history = this.getChatHistory(message.chat.id);
    const concretePrompt = buildConcretePromptFromPendingChoice(history, resolution.option.label);
    this.logger.info("Pending Telegram choice resolved", {
      chatId: message.chat.id,
      optionIndex: resolution.option.index,
      usedConcreteCalendarPrompt: Boolean(concretePrompt),
    });
    await this.executeClarifiedPrompt(message, {
      effectiveText: concretePrompt ?? buildPendingChoiceContinuationPrompt({
        state: pending,
        option: resolution.option,
        userReply: normalizedText,
      }),
      replyToMessageId: message.message_id,
      userHistoryText: `${normalizedText} [escolha pendente: ${resolution.option.index}]`,
    });
    return true;
  }

  private async executeClarifiedPrompt(
    message: TelegramMessage,
    input: {
      effectiveText: string;
      replyToMessageId: number;
      userHistoryText: string;
    },
  ): Promise<void> {
    const history = this.getChatHistory(message.chat.id);
    const result = await this.core.runUserPrompt(
      buildAgentPrompt(message, input.effectiveText, history, this.getOperationalMode(message.chat.id)),
      { chatId: message.chat.id },
    );
    const structuredDecisionReply = await this.resolveStructuredAssistantDecisionReply(result.reply, message.chat.id);
    if (structuredDecisionReply.handled) {
      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: input.userHistoryText,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: structuredDecisionReply.visibleReply,
      });
      await this.sendText(message.chat.id, structuredDecisionReply.visibleReply, {
        reply_to_message_id: input.replyToMessageId,
        disable_web_page_preview: true,
      });
      return;
    }

    const nextPendingDraft = extractPendingActionDraft(result.reply);
    const visibleReply = sanitizeToolPayloadLeak(stripPendingDraftMarkers(result.reply) || result.reply);
    const approval = nextPendingDraft
      ? this.persistPendingApproval(message.chat.id, nextPendingDraft)
      : undefined;
    if (nextPendingDraft) {
      this.pendingActionDrafts.set(message.chat.id, nextPendingDraft);
    } else {
      this.clearPendingActionDraft(message.chat.id);
    }
    this.appendChatTurn(message.chat.id, {
      role: "user",
      text: input.userHistoryText,
    });
    this.appendChatTurn(message.chat.id, {
      role: "assistant",
      text: visibleReply,
    });
    await this.sendText(message.chat.id, visibleReply, {
      reply_to_message_id: input.replyToMessageId,
      disable_web_page_preview: false,
      reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
    });
  }

  private resolveScheduleImportAccountAlias(contextText?: string): string {
    const normalized = normalizeIntentText(contextText ?? "");
    if (normalized.includes("primary") || normalized.includes("principal")) {
      return "primary";
    }
    if (normalized.includes("abordagem") || normalized.includes("social")) {
      return "abordagem";
    }
    return "abordagem";
  }

  private getGoogleAccountConfig(accountAlias: string) {
    return accountAlias === "primary"
      ? this.config.google
      : (this.config.googleAccounts[accountAlias] ?? this.config.google);
  }

  private getGoogleAccountAliases(): string[] {
    const aliases = Object.keys(this.config.googleAccounts);
    return aliases.length > 0 ? aliases : ["primary"];
  }

  private resolveShortCalendarAccountReply(text: string) {
    return resolveShortGoogleAccountReply(text, this.getGoogleAccountAliases());
  }

  private extractExplicitCalendarAccount(text: string): string | undefined {
    return extractExplicitGoogleAccountAlias(text, this.getGoogleAccountAliases());
  }

  private async handleScheduleImportAttachment(
    message: TelegramMessage,
    attachment: TelegramImportAttachment,
    captionText?: string,
  ): Promise<void> {
    if (!this.scheduleImport) {
      await this.sendText(
        message.chat.id,
        "A importação de agenda por PDF ou print depende de um provider OpenAI ativo com chave configurada.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    try {
      const accountAlias = this.resolveScheduleImportAccountAlias(captionText);
      const accountConfig = this.getGoogleAccountConfig(accountAlias);
      const timezone = accountConfig.defaultTimezone || this.config.google.defaultTimezone;
      await this.sendText(
        message.chat.id,
        [
          "Recebi a agenda e já estou processando.",
          `- Arquivo: ${attachment.fileName}`,
          `- Calendário alvo: ${accountAlias}`,
          "Vou extrair os eventos e te devolver um rascunho para aprovação.",
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      const remoteFile = await this.api.getFile(attachment.fileId);
      if (!remoteFile.file_path) {
        throw new Error("Telegram não retornou file_path para o arquivo enviado.");
      }
      const buffer = await this.api.downloadFile(remoteFile.file_path);
      const extracted = attachment.kind === "pdf"
        ? await this.scheduleImport.extractFromPdf({
            pdf: buffer,
            sourceLabel: attachment.fileName,
            caption: captionText,
            currentDate: new Date().toISOString().slice(0, 10),
            timezone,
          })
        : await this.scheduleImport.extractFromImage({
            image: buffer,
            mimeType: attachment.mimeType,
            sourceLabel: attachment.fileName,
            caption: captionText,
            currentDate: new Date().toISOString().slice(0, 10),
            timezone,
          });

      const events = extracted.events
        .map((event) => {
          const matchedTerms = matchPersonalCalendarTerms({
            account: accountAlias,
            summary: event.summary,
            description: event.description,
            location: event.location,
          });

          return {
            summary: event.summary,
            description: event.description,
            location: event.location,
            start: event.start,
            end: event.end,
            timezone: event.timezone,
            account: accountAlias,
            calendarId: accountConfig.calendarId,
            reminderMinutes: event.reminderMinutes,
            confidence: event.confidence,
            sourceLabel: event.sourceLabel,
            personallyRelevant: matchedTerms.length > 0,
            matchedTerms,
          };
        })
        .sort((left, right) => left.start.localeCompare(right.start));

      if (events.length === 0) {
        throw new Error("Não consegui identificar eventos válidos para importar.");
      }

      const draft: PendingGoogleEventImportBatchDraft = {
        kind: "google_event_import_batch",
        timezone,
        account: accountAlias,
        calendarId: accountConfig.calendarId,
        sourceLabel: attachment.fileName,
        totalExtracted: events.length,
        relevantCount: events.filter((event) => event.personallyRelevant).length,
        assumptions: [
          ...extracted.assumptions,
          ...extracted.uncertainties.map((item) => `incerteza: ${item}`),
        ].slice(0, 6),
        events,
      };

      this.clearPendingActionDraft(message.chat.id, "superseded");
      this.pendingActionDrafts.set(message.chat.id, draft);
      const approval = this.persistPendingApproval(message.chat.id, draft);
      const visibleReply = stripPendingDraftMarkers(buildGoogleEventImportBatchDraftReply(draft));

      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: captionText?.trim() ? `[agenda_anexo] ${captionText.trim()}` : `[agenda_anexo] ${attachment.fileName}`,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: visibleReply,
      });

      await this.sendText(message.chat.id, visibleReply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
        reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
      });
    } catch (error) {
      this.logger.error("Telegram schedule import failed", {
        chatId: message.chat.id,
        fileName: attachment.fileName,
        kind: attachment.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendText(
        message.chat.id,
        [
          "Não consegui transformar este arquivo em agenda nesta tentativa.",
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
          "Se puder, tente enviar um PDF pesquisável ou um print mais nítido.",
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
    }
  }

  private async handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
    const userId = callback.from.id;
    const userAllowed = this.config.telegram.allowedUserIds.includes(userId);
    const chatId = callback.message?.chat.id;

    if (!userAllowed || !chatId) {
      await this.api.answerCallbackQuery(callback.id, {
        text: "Ação não autorizada.",
        show_alert: false,
      }).catch(() => undefined);
      return;
    }

    const parsed = parseApprovalCallbackData(callback.data);
    if (!parsed) {
      await this.api.answerCallbackQuery(callback.id, {
        text: "Ação inválida.",
      }).catch(() => undefined);
      return;
    }

    const item = this.approvalEngine.getById(parsed.id);
    if (!item || item.chatId !== chatId) {
      await this.api.answerCallbackQuery(callback.id, {
        text: "Aprovação não encontrada.",
      }).catch(() => undefined);
      return;
    }

    if (item.status !== "pending") {
      await this.api.answerCallbackQuery(callback.id, {
        text: "Essa aprovação já foi tratada.",
      }).catch(() => undefined);
      return;
    }

    const draft = parsePendingActionDraftPayload(item.draftPayload);
    if (!draft) {
      this.approvalEngine.updateStatus(item.id, "failed");
      await this.api.answerCallbackQuery(callback.id, {
        text: "Rascunho inválido.",
        show_alert: true,
      }).catch(() => undefined);
      return;
    }

    if (parsed.action === "discard") {
      this.approvalEngine.updateStatus(item.id, "discarded");
      this.pendingActionDrafts.delete(chatId);
      await this.api.answerCallbackQuery(callback.id, {
        text: "Rascunho descartado.",
      }).catch(() => undefined);
      await this.sendText(chatId, "Rascunho pendente descartado. Nenhuma ação foi executada.", {
        reply_to_message_id: callback.message?.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    if (parsed.action === "edit") {
      if (draft.kind === "youtube_publish") {
        await this.api.answerCallbackQuery(callback.id, {
          text: "Para ajustar o vídeo, gere um novo rascunho.",
        }).catch(() => undefined);
        await this.sendText(
          chatId,
          [
            "A publicação do YouTube não tem edição inline neste MVP.",
            "Se quiser ajustar roteiro, título ou vídeo, gere um novo rascunho do item.",
          ].join("\n"),
          {
            reply_to_message_id: callback.message?.message_id,
            disable_web_page_preview: true,
          },
        );
        return;
      }

      this.pendingActionDrafts.set(chatId, draft);
      await this.api.answerCallbackQuery(callback.id, {
        text: "Envie a alteração em texto. Vou atualizar o rascunho.",
      }).catch(() => undefined);
      await this.sendText(
        chatId,
        draft.kind === "whatsapp_reply"
          ? [
              `Rascunho carregado para edição: WhatsApp para ${draft.pushName ?? draft.number}.`,
              ...(draft.account ? [`Conta: ${draft.account}.`] : []),
              ...(draft.instanceName ? [`Instância: ${draft.instanceName}.`] : []),
              `Mensagem atual: ${draft.replyText}`,
              "Envie a alteração em texto e eu atualizo antes de enviar.",
            ].join("\n")
          : draft.kind === "google_event_import_batch"
            ? [
                "Rascunho de importação carregado.",
                "Para alterar o lote, o caminho mais seguro é reenviar o PDF ou o print com a agenda corrigida.",
                "Se quiser abortar o lote atual, use `cancelar rascunho`.",
              ].join("\n")
            : "Rascunho carregado para edição. Envie a alteração em texto.",
        {
          reply_to_message_id: callback.message?.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    await this.api.answerCallbackQuery(callback.id, {
      text: "Executando aprovação...",
    }).catch(() => undefined);

    try {
      const execution = await this.executePendingActionDraft(draft);
      this.approvalEngine.updateStatus(item.id, execution.ok ? "executed" : "failed");
      if (execution.ok) {
        this.captureCalendarUndoAction(chatId, draft, execution.rawResult);
        this.pendingActionDrafts.delete(chatId);
      }

      await this.sendText(chatId, execution.reply, {
        reply_to_message_id: callback.message?.message_id,
        disable_web_page_preview: true,
      });
    } catch (error) {
      this.approvalEngine.updateStatus(item.id, "failed");
      await this.sendText(
        chatId,
        [
          "Falha ao executar a ação aprovada.",
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
        {
          reply_to_message_id: callback.message?.message_id,
          disable_web_page_preview: true,
        },
      );
    }
  }

  private buildYouTubePublishDraft(input: {
    contentItemId: number;
    filePath: string;
    title: string;
    description: string;
    tags: string[];
  }): PendingYouTubePublishDraft {
    return {
      kind: "youtube_publish",
      contentItemId: input.contentItemId,
      filePath: input.filePath,
      title: input.title,
      description: input.description,
      privacyStatus: "public",
      tags: input.tags.slice(0, 10),
    };
  }

  private buildYouTubeTags(item: {
    title: string;
    pillar: string | null;
    channelKey: string | null;
  }): string[] {
    const base = [
      "riqueza despertada",
      "dinheiro",
      "negocios",
      "saaS",
      "marketing",
      item.pillar ?? "",
      item.channelKey ?? "",
      ...item.title.split(/[^A-Za-zÀ-ÿ0-9]+/g),
    ];

    return [...new Set(
      base
        .map((entry) => normalizeIntentText(entry))
        .filter((entry) => entry.length >= 3)
        .slice(0, 10),
    )];
  }

  private async handleVideoPipelineStatusRequest(message: TelegramMessage): Promise<void> {
    const readiness = this.videoRenderer.getReadinessReport();
    await this.sendText(
      message.chat.id,
      buildVideoPipelineReadinessReply({
        acceptedInput: readiness.acceptedInput,
        ttsProvider: readiness.ttsProvider === "openai" ? "OpenAI TTS" : "nenhum",
        ttsReady: readiness.ttsReady,
        assetsProvider: readiness.assetsProvider === "pexels" ? "Pexels" : "manual",
        assetsReady: readiness.assetsReady,
        canRender: readiness.canRender,
        youtubeUploadReady: this.youtubePublisher.canUpload(),
      }),
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );
  }

  private async renderVideoDraftForItem(input: {
    chatId: number;
    item: ContentItemRecord;
    shortPackage: ParsedShortPackage;
    replyToMessageId?: number;
    scheduledFor?: string;
    slotKey?: ScheduledEditorialSlotKey;
    autoSelected?: boolean;
  }): Promise<ContentItemRecord> {
    const rendered = await this.videoRenderer.renderDraft({
      item: input.item,
      shortPackage: input.shortPackage,
    });

    const nextNotes = [
      input.item.notes?.trim() ?? "",
      "",
      "VIDEO_RENDER_DRAFT",
      `rendered_at: ${new Date().toISOString()}`,
      `output_path: ${rendered.outputPath}`,
      `manifest_path: ${rendered.manifestPath}`,
      "END_VIDEO_RENDER_DRAFT",
      ...(input.autoSelected && input.slotKey && input.scheduledFor
        ? [
            "",
            "AUTO_SLOT_SELECTION",
            `slot: ${input.slotKey}`,
            `scheduled_for: ${input.scheduledFor}`,
            `selected_at: ${new Date().toISOString()}`,
            "END_AUTO_SLOT_SELECTION",
          ]
        : []),
    ].filter(Boolean).join("\n");

    const updated = this.contentOps.updateItem({
      id: input.item.id,
      assetPath: rendered.outputPath,
      notes: nextNotes,
      status: input.scheduledFor ? "scheduled" : "draft",
      targetDate: input.scheduledFor ?? input.item.targetDate,
    });

    await this.api.sendVideo(input.chatId, rendered.outputPath, {
      caption: `Rascunho pronto: item #${updated.id} | ${updated.title}`,
      reply_to_message_id: input.replyToMessageId,
      supports_streaming: true,
      duration: rendered.durationSeconds,
      width: 1080,
      height: 1920,
    });

    const publishDraft = this.buildYouTubePublishDraft({
      contentItemId: updated.id,
      filePath: rendered.outputPath,
      title: input.shortPackage.platformVariants.youtubeShort.title || updated.title,
      description: [input.shortPackage.description, "", input.shortPackage.platformVariants.youtubeShort.caption]
        .filter((entry) => entry?.trim())
        .join("\n\n"),
      tags: this.buildYouTubeTags(updated),
    });
    const approval = this.persistPendingApproval(input.chatId, publishDraft);
    const slotLabel = input.slotKey ? getEditorialSlotSchedule(input.slotKey).label : undefined;

    await this.sendText(
      input.chatId,
      [
        "Vídeo rascunho entregue para revisão.",
        `- Item: #${updated.id}`,
        `- Arquivo: ${rendered.outputPath}`,
        `- Duração: ${rendered.durationSeconds}s`,
        ...(input.scheduledFor
          ? [`- Janela: ${formatLocalDateTime(input.scheduledFor) ?? input.scheduledFor}${slotLabel ? ` | ${slotLabel}` : ""}`]
          : []),
        "",
        buildCompactPendingActionReply(publishDraft) ?? "Publicação pronta para aprovação.",
      ].join("\n"),
      {
        reply_to_message_id: input.replyToMessageId,
        disable_web_page_preview: true,
        reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
      },
    );
    return updated;
  }

  private async handleManualVideoScriptRequest(message: TelegramMessage, rawText: string): Promise<void> {
    const payload = extractManualShortScriptPayload(rawText);
    if (!payload) {
      await this.sendText(
        message.chat.id,
        "Não consegui isolar um roteiro utilizável. Envie `Título:` opcional e depois `Roteiro:` com o texto completo.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    const title = inferManualShortTitle(payload.title, payload.body);
    const created = this.contentOps.createItem({
      title,
      platform: "youtube",
      format: "short_video",
      status: "idea",
      channelKey: "riqueza_despertada_youtube",
      notes: buildManualShortScriptNotes({
        body: payload.body,
        title,
      }),
      hook: payload.body.split(/(?<=[.!?])\s+/)[0]?.trim() || undefined,
      queuePriority: 95,
      ideaScore: 95,
      scoreReason: "roteiro manual fornecido pelo usuário",
    });

    await this.sendText(
      message.chat.id,
      [
        `Roteiro recebido. Criei o item #${created.id}.`,
        "Vou estruturar o SHORT_PACKAGE e tentar renderizar o rascunho automaticamente.",
      ].join("\n"),
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );

    try {
      const result = await this.core.runUserPrompt(`gere roteiro para o item #${created.id}`);
      const refreshed = this.contentOps.getItemById(created.id);
      const shortPackage = refreshed ? extractLatestShortPackage(refreshed.notes) : null;

      if (!refreshed || !shortPackage) {
        await this.sendText(
          message.chat.id,
          [
            `Consegui criar o item #${created.id}, mas o pacote ainda não ficou pronto.`,
            result.reply,
          ].join("\n\n"),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
        return;
      }

      if (!this.videoRenderer.isReady()) {
        const readiness = this.videoRenderer.getReadinessReport();
        await this.sendText(
          message.chat.id,
          [
            `Item #${refreshed.id} estruturado com SHORT_PACKAGE_V3.`,
            buildVideoPipelineReadinessReply({
              acceptedInput: readiness.acceptedInput,
              ttsProvider: readiness.ttsProvider === "openai" ? "OpenAI TTS" : "nenhum",
              ttsReady: readiness.ttsReady,
              assetsProvider: readiness.assetsProvider === "pexels" ? "Pexels" : "manual",
              assetsReady: readiness.assetsReady,
              canRender: readiness.canRender,
              youtubeUploadReady: this.youtubePublisher.canUpload(),
            }),
          ].join("\n\n"),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
        return;
      }

      await this.sendText(
        message.chat.id,
        `Pacote pronto para o item #${refreshed.id}. Vou renderizar o rascunho agora.`,
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );

      await this.renderVideoDraftForItem({
        chatId: message.chat.id,
        item: refreshed,
        shortPackage,
        replyToMessageId: message.message_id,
      });
    } catch (error) {
      await this.sendText(
        message.chat.id,
        [
          `Criei o item #${created.id}, mas falhei ao seguir para o pacote ou render.`,
          buildAgentFailureMessage(error),
        ].join("\n\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
    }
  }

  private async handleBatchScriptGenerationRequest(message: TelegramMessage, rawText: string): Promise<void> {
    const itemIds = extractContentItemIdsFromText(rawText);
    if (itemIds.length < 2) {
      await this.sendText(
        message.chat.id,
        "Informe pelo menos 2 itens para o lote. Exemplo: `gere roteiro para os itens #31, #34 e #35`.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    await this.sendText(
      message.chat.id,
      `Gerando o roteiro em lote para ${itemIds.length} itens: ${itemIds.map((id) => `#${id}`).join(", ")}.`,
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );

    const successes: Array<{ id: number; title: string }> = [];
    const failures: Array<{ id: number; error: string }> = [];

    for (const itemId of itemIds) {
      try {
        const resolved = await this.ensureShortPackageForItem(itemId);
        if (!resolved.shortPackage) {
          failures.push({
            id: itemId,
            error: "SHORT_PACKAGE_V3 não foi salvo",
          });
          continue;
        }
        successes.push({
          id: resolved.item.id,
          title: resolved.item.title,
        });
      } catch (error) {
        failures.push({
          id: itemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.sendText(
      message.chat.id,
      [
        `Lote de roteiro concluído.`,
        `- Pacotes prontos: ${successes.length}`,
        `- Falhas: ${failures.length}`,
        ...(successes.length > 0
          ? ["", "Itens prontos:", ...successes.map((item) => `- #${item.id} | ${item.title}`)]
          : []),
        ...(failures.length > 0
          ? ["", "Itens com erro:", ...failures.map((item) => `- #${item.id} | ${item.error}`)]
          : []),
        "",
        "Se quiser, agora peça os vídeos rascunho do mesmo lote em uma única mensagem.",
      ].join("\n"),
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );
  }

  private async handleBatchVideoDraftRenderRequest(message: TelegramMessage, rawText: string): Promise<void> {
    const itemIds = extractContentItemIdsFromText(rawText);
    if (itemIds.length < 2) {
      await this.sendText(
        message.chat.id,
        "Informe pelo menos 2 itens para o lote. Exemplo: `gere os vídeos rascunho dos itens #31, #34 e #35`.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    if (!this.videoRenderer.isReady()) {
      const readiness = this.videoRenderer.getReadinessReport();
      await this.sendText(
        message.chat.id,
        buildVideoPipelineReadinessReply({
          acceptedInput: readiness.acceptedInput,
          ttsProvider: readiness.ttsProvider === "openai" ? "OpenAI TTS" : "nenhum",
          ttsReady: readiness.ttsReady,
          assetsProvider: readiness.assetsProvider === "pexels" ? "Pexels" : "manual",
          assetsReady: readiness.assetsReady,
          canRender: readiness.canRender,
          youtubeUploadReady: this.youtubePublisher.canUpload(),
        }),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    await this.sendText(
      message.chat.id,
      [
        `Processando lote de vídeos rascunho para ${itemIds.length} itens: ${itemIds.map((id) => `#${id}`).join(", ")}.`,
        "Se algum item ainda não tiver roteiro pronto, eu vou gerar o SHORT_PACKAGE antes de renderizar.",
        "Os vídeos serão enviados um por vez para aprovação individual.",
      ].join("\n"),
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );

    const successes: Array<{ id: number; title: string }> = [];
    const failures: Array<{ id: number; error: string }> = [];

    for (const itemId of itemIds) {
      try {
        const resolved = await this.ensureShortPackageForItem(itemId);
        if (!resolved.shortPackage) {
          failures.push({
            id: itemId,
            error: "SHORT_PACKAGE_V3 não foi salvo",
          });
          continue;
        }

        const updated = await this.renderVideoDraftForItem({
          chatId: message.chat.id,
          item: resolved.item,
          shortPackage: resolved.shortPackage,
          replyToMessageId: message.message_id,
        });
        successes.push({
          id: updated.id,
          title: updated.title,
        });
      } catch (error) {
        failures.push({
          id: itemId,
          error: error instanceof Error ? error.message : String(error),
        });
        this.logger.error("Batch short video render failed", {
          chatId: message.chat.id,
          itemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.sendText(
      message.chat.id,
      [
        "Lote de vídeo rascunho concluído.",
        `- Vídeos entregues: ${successes.length}`,
        `- Falhas: ${failures.length}`,
        ...(successes.length > 0
          ? ["", "Vídeos enviados:", ...successes.map((item) => `- #${item.id} | ${item.title}`)]
          : []),
        ...(failures.length > 0
          ? ["", "Itens com erro:", ...failures.map((item) => `- #${item.id} | ${item.error}`)]
          : []),
        "",
        "Cada vídeo ficou com aprovação separada no Telegram.",
      ].join("\n"),
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );
  }

  private async handleVideoDraftRenderRequest(message: TelegramMessage, normalizedText: string): Promise<void> {
    const itemId = extractContentItemIdFromText(normalizedText);
    if (!itemId) {
      await this.sendText(
        message.chat.id,
        [
          "Informe o item no formato `item #15` para eu renderizar o rascunho.",
          "Entrada aceita pelo pipeline nativo: item editorial com SHORT_PACKAGE_V3 salvo.",
          "Se quiser, peça também: `mostre o status do pipeline de vídeo`.",
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    const item = this.contentOps.getItemById(itemId);
    if (!item) {
      await this.sendText(
        message.chat.id,
        `Não encontrei o item #${itemId}.`,
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    if (!this.videoRenderer.isReady()) {
      const readiness = this.videoRenderer.getReadinessReport();
      await this.sendText(
        message.chat.id,
        buildVideoPipelineReadinessReply({
          acceptedInput: readiness.acceptedInput,
          ttsProvider: readiness.ttsProvider === "openai" ? "OpenAI TTS" : "nenhum",
          ttsReady: readiness.ttsReady,
          assetsProvider: readiness.assetsProvider === "pexels" ? "Pexels" : "manual",
          assetsReady: readiness.assetsReady,
          canRender: readiness.canRender,
          youtubeUploadReady: this.youtubePublisher.canUpload(),
        }),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    }

    await this.sendText(
      message.chat.id,
      `Renderizando o rascunho do item #${itemId}. Se faltar roteiro, vou gerar o pacote primeiro. Isso pode levar alguns minutos.`,
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      },
    );

    try {
      const resolved = await this.ensureShortPackageForItem(itemId);
      if (!resolved.shortPackage) {
        await this.sendText(
          message.chat.id,
          [
            `Não consegui estruturar o SHORT_PACKAGE_V3 para o item #${itemId}.`,
            "Revise o item e tente gerar o roteiro novamente.",
          ].join("\n"),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
        return;
      }
      await this.renderVideoDraftForItem({
        chatId: message.chat.id,
        item: resolved.item,
        shortPackage: resolved.shortPackage,
        replyToMessageId: message.message_id,
      });
    } catch (error) {
      this.logger.error("Short video render failed", {
        chatId: message.chat.id,
        itemId,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendText(
        message.chat.id,
        [
          `Falha ao renderizar o item #${itemId}.`,
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
    }
  }

  private async executePendingActionDraft(
    pendingDraft: PendingActionDraft,
  ): Promise<{ ok: boolean; reply: string; rawResult: unknown }> {
    if (pendingDraft.kind === "monitored_channel_alert") {
      throw new Error("Alerta monitorado precisa ser convertido em evento, tarefa, resposta ou registro antes da execução.");
    }

    const execution =
      pendingDraft.kind === "email_reply"
        ? await this.core.executeToolDirect("send_email_reply", {
            uid: pendingDraft.uid,
            body: pendingDraft.body,
            ...(pendingDraft.subjectOverride ? { subject_override: pendingDraft.subjectOverride } : {}),
          })
        : pendingDraft.kind === "youtube_publish"
          ? {
              rawResult: await this.youtubePublisher.uploadShort({
                filePath: pendingDraft.filePath,
                title: pendingDraft.title,
                description: pendingDraft.description,
                privacyStatus: pendingDraft.privacyStatus,
                tags: pendingDraft.tags,
              }),
            }
        : pendingDraft.kind === "whatsapp_reply"
          ? {
              rawResult: await this.whatsapp.sendText({
                instanceName: pendingDraft.instanceName,
                number: pendingDraft.number,
                text: pendingDraft.replyText,
              }),
            }
        : pendingDraft.kind === "google_task"
            ? await this.core.executeToolDirect("execute_task_operation", {
                action: "create",
                title: pendingDraft.title,
                ...(pendingDraft.notes ? { notes: pendingDraft.notes } : {}),
                ...(pendingDraft.due ? { due: pendingDraft.due } : {}),
                ...(pendingDraft.taskListId ? { task_list_id: pendingDraft.taskListId } : {}),
                ...(pendingDraft.account ? { account: pendingDraft.account } : {}),
              })
            : pendingDraft.kind === "google_event"
              ? await this.core.executeToolDirect("execute_calendar_operation", {
                  action: "create",
                  summary: pendingDraft.summary,
                  start: pendingDraft.start,
                  end: pendingDraft.end,
                  ...(pendingDraft.description ? { description: pendingDraft.description } : {}),
                  ...(pendingDraft.location ? { location: pendingDraft.location } : {}),
                  ...(pendingDraft.attendees?.length ? { attendees: pendingDraft.attendees } : {}),
                  ...(pendingDraft.timezone ? { timezone: pendingDraft.timezone } : {}),
                  ...(pendingDraft.calendarId ? { calendar_id: pendingDraft.calendarId } : {}),
                  ...(pendingDraft.account ? { account: pendingDraft.account } : {}),
                  ...(typeof pendingDraft.reminderMinutes === "number"
                    ? { reminder_minutes: pendingDraft.reminderMinutes }
                    : {}),
                  ...(pendingDraft.createMeet ? { create_meet: true } : {}),
                })
              : pendingDraft.kind === "google_event_update"
                ? await this.core.executeToolDirect("execute_calendar_operation", {
                    action: "update",
                    event_id: pendingDraft.eventId,
                    summary: pendingDraft.summary,
                    start: pendingDraft.start,
                    end: pendingDraft.end,
                    ...(pendingDraft.description ? { description: pendingDraft.description } : {}),
                    ...(pendingDraft.location ? { location: pendingDraft.location } : {}),
                    ...(pendingDraft.attendees?.length ? { attendees: pendingDraft.attendees } : {}),
                    ...(pendingDraft.timezone ? { timezone: pendingDraft.timezone } : {}),
                    ...(pendingDraft.calendarId ? { calendar_id: pendingDraft.calendarId } : {}),
                    ...(pendingDraft.account ? { account: pendingDraft.account } : {}),
                    ...(typeof pendingDraft.reminderMinutes === "number"
                      ? { reminder_minutes: pendingDraft.reminderMinutes }
                      : {}),
                    ...(pendingDraft.createMeet ? { create_meet: true } : {}),
                  })
                : pendingDraft.kind === "google_event_delete"
                  ? await this.core.executeToolDirect("execute_calendar_operation", {
                      action: "delete",
                      event_id: pendingDraft.eventId,
                      ...(pendingDraft.calendarId ? { calendar_id: pendingDraft.calendarId } : {}),
                      ...(pendingDraft.account ? { account: pendingDraft.account } : {}),
                    })
                  : pendingDraft.kind === "google_event_delete_batch"
                    ? await Promise.all(
                        pendingDraft.events.map((event) =>
                          this.core.executeToolDirect("execute_calendar_operation", {
                            action: "delete",
                            event_id: event.eventId,
                            ...(event.calendarId ? { calendar_id: event.calendarId } : {}),
                            ...(event.account ? { account: event.account } : {}),
                          }),
                        ),
                      ).then((results) => ({
                        rawResult: {
                          ok: results.every((result) => {
                            const record = result.rawResult as Record<string, unknown> | undefined;
                            return record?.ok === true;
                          }),
                          deleted: results.length,
                        },
                      }))
                    : await (async () => {
                        const created: Array<Record<string, unknown>> = [];
                        const failed: Array<Record<string, unknown>> = [];

                        for (const event of pendingDraft.events) {
                          const result = await this.core.executeToolDirect("execute_calendar_operation", {
                            action: "create",
                            summary: event.summary,
                            start: event.start,
                            end: event.end,
                            ...(event.description ? { description: event.description } : {}),
                            ...(event.location ? { location: event.location } : {}),
                            ...(event.attendees?.length ? { attendees: event.attendees } : {}),
                            ...(event.timezone ? { timezone: event.timezone } : {}),
                            ...(event.calendarId ? { calendar_id: event.calendarId } : {}),
                            ...(event.account ? { account: event.account } : {}),
                            ...(typeof event.reminderMinutes === "number"
                              ? { reminder_minutes: event.reminderMinutes }
                              : {}),
                            ...(event.createMeet ? { create_meet: true } : {}),
                          });

                          const record = result.rawResult && typeof result.rawResult === "object"
                            ? (result.rawResult as Record<string, unknown>)
                            : undefined;
                          const eventRecord = record?.event && typeof record.event === "object"
                            ? (record.event as Record<string, unknown>)
                            : undefined;
                          if (record?.ok === true && eventRecord) {
                            created.push({
                              id: eventRecord.id,
                              summary: eventRecord.summary ?? event.summary,
                              start: eventRecord.start ?? event.start,
                              account: event.account,
                              calendarId: event.calendarId,
                            });
                          } else {
                            failed.push({
                              summary: event.summary,
                              rawResult: result.rawResult,
                            });
                          }
                        }

                        return {
                          rawResult: {
                            ok: failed.length === 0,
                            created,
                            failed,
                          },
                        };
                      })();

    const record = execution.rawResult && typeof execution.rawResult === "object"
      ? (execution.rawResult as Record<string, unknown>)
      : undefined;
    const ok = pendingDraft.kind === "whatsapp_reply"
      ? true
      : pendingDraft.kind === "youtube_publish"
        ? true
      : pendingDraft.kind === "google_event_import_batch"
        ? Array.isArray(record?.created) && record.created.length > 0
        : record?.ok === true;
    const reply = pendingDraft.kind === "email_reply"
      ? ok
        ? buildEmailSendSuccessMessage(execution.rawResult, pendingDraft.uid)
        : buildEmailSendFailureMessage(execution.rawResult)
      : pendingDraft.kind === "youtube_publish"
        ? [
            "Vídeo publicado no YouTube com sucesso.",
            `Item: #${pendingDraft.contentItemId}`,
            `Título: ${pendingDraft.title}`,
            `Privacidade: ${pendingDraft.privacyStatus}`,
            record?.url ? `URL: ${String(record.url)}` : undefined,
          ].filter(Boolean).join("\n")
      : pendingDraft.kind === "whatsapp_reply"
        ? buildWhatsAppSendSuccessMessage(execution.rawResult, pendingDraft)
        : pendingDraft.kind === "google_task"
          ? ok
            ? buildGoogleTaskCreateSuccessMessage(execution.rawResult)
            : buildGenericControlledActionFailureMessage("a criação da tarefa Google", execution.rawResult)
          : pendingDraft.kind === "google_event"
            ? ok
              ? buildGoogleEventCreateSuccessMessage(execution.rawResult)
              : buildGenericControlledActionFailureMessage("a criação do evento Google", execution.rawResult)
            : pendingDraft.kind === "google_event_update"
              ? ok
                ? buildGoogleEventUpdateSuccessMessage(execution.rawResult)
                : buildGenericControlledActionFailureMessage("a atualização do evento Google", execution.rawResult)
              : pendingDraft.kind === "google_event_delete"
                ? ok
                  ? buildGoogleEventDeleteSuccessMessage(execution.rawResult)
                  : buildGenericControlledActionFailureMessage("o cancelamento do evento Google", execution.rawResult)
                : pendingDraft.kind === "google_event_delete_batch"
                  ? ok
                    ? `Eventos do Google cancelados com sucesso.\nTotal: ${pendingDraft.events.length}`
                    : buildGenericControlledActionFailureMessage("o cancelamento em lote dos eventos Google", execution.rawResult)
                  : buildGoogleEventImportBatchSuccessMessage(pendingDraft, execution.rawResult);

    if (ok && pendingDraft.kind === "whatsapp_reply") {
      this.whatsappMessages.saveMessage({
        instanceName: pendingDraft.instanceName,
        remoteJid: pendingDraft.remoteJid,
        number: pendingDraft.number,
        pushName: pendingDraft.pushName,
        direction: "outbound",
        text: pendingDraft.replyText,
      });
    }

    if (ok && pendingDraft.kind === "youtube_publish") {
      const item = this.contentOps.getItemById(pendingDraft.contentItemId);
      if (item) {
        const rawReply = record?.url ? `\n\nYOUTUBE_PUBLISH_RESULT\nurl: ${String(record.url)}\nvideo_id: ${String(record.videoId ?? "")}\nEND_YOUTUBE_PUBLISH_RESULT` : "";
        this.contentOps.updateItem({
          id: item.id,
          status: "published",
          notes: `${item.notes?.trim() ?? ""}${rawReply}`,
        });
      }
    }

    return {
      ok,
      reply,
      rawResult: execution.rawResult,
    };
  }

  private async handleMonitoredChannelAlert(
    message: TelegramMessage,
    normalizedText: string,
    pendingDraft: PendingMonitoredChannelAlertDraft,
  ): Promise<boolean> {
    if (isClearlyNewTopLevelIntent(normalizedText)) {
      this.clearPendingActionDraft(message.chat.id, "superseded");
      return false;
    }

    const resolution = resolveMonitoredAlertReplyAction(pendingDraft, normalizedText);
    if (resolution.kind === "clarify") {
      await this.sendText(
        message.chat.id,
        resolution.message ?? "Responda com `agenda`, `cria tarefa`, `responda`, `resumo`, `registrar`, `ignora` ou `sim`.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return true;
    }

    if (resolution.kind === "ignore") {
      this.clearPendingActionDraft(message.chat.id, "discarded");
      await this.sendText(
        message.chat.id,
        "Alerta monitorado ignorado. Nenhuma ação foi executada.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return true;
    }

    if (resolution.kind === "summary") {
      await this.sendText(
        message.chat.id,
        [
          "Resumo do alerta monitorado:",
          `- Canal: ${pendingDraft.sourceDisplayName}`,
          `- Contato: ${pendingDraft.sourcePushName ?? pendingDraft.sourceNumber}`,
          `- Classificação: ${pendingDraft.classification}`,
          ...(pendingDraft.reasons.length > 0 ? [`- Sinais: ${pendingDraft.reasons.join(" | ")}`] : []),
          "",
          pendingDraft.sourceText,
          "",
          "Se quiser agir, responda com `agenda`, `cria tarefa`, `responda`, `registrar` ou `ignora`.",
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return true;
    }

    if (resolution.kind === "register") {
      this.clearPendingActionDraft(message.chat.id, "executed");
      await this.sendText(
        message.chat.id,
        "Registrado no histórico operacional. Nenhuma ação externa foi executada.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return true;
    }

    const nextDraft =
      resolution.kind === "event"
        ? pendingDraft.eventDraft
        : resolution.kind === "task"
          ? pendingDraft.taskDraft
          : resolution.kind === "reply"
            ? pendingDraft.replyDraft && ({
                kind: "whatsapp_reply",
                instanceName: pendingDraft.replyDraft.instanceName,
                account: pendingDraft.replyDraft.account,
                remoteJid: pendingDraft.replyDraft.remoteJid,
                number: pendingDraft.replyDraft.number,
                pushName: pendingDraft.replyDraft.pushName,
                inboundText: pendingDraft.replyDraft.inboundText,
                replyText: pendingDraft.replyDraft.replyText,
                relationship: pendingDraft.replyDraft.relationship,
                persona: pendingDraft.replyDraft.persona,
              } satisfies PendingWhatsAppReplyDraft)
            : undefined;

    if (!nextDraft) {
      await this.sendText(
        message.chat.id,
        "Ainda não tenho base suficiente para montar esse rascunho com segurança.",
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
      return true;
    }

    this.clearPendingActionDraft(message.chat.id, "executed");
    this.pendingActionDrafts.set(message.chat.id, nextDraft);
    const approval = this.persistPendingApproval(message.chat.id, nextDraft);
    await this.sendText(
      message.chat.id,
      buildCompactPendingActionReply(nextDraft)
        ?? (resolution.kind === "reply" && "replyText" in nextDraft
          ? `Rascunho de resposta pronto: ${nextDraft.replyText}`
          : "Rascunho pronto."),
      {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
        reply_markup: buildApprovalInlineKeyboard(approval.id),
      },
    );
    return true;
  }

  private async handlePendingActionConfirmation(
    message: TelegramMessage,
    normalizedText: string,
    pendingDraft: PendingActionDraft,
  ): Promise<void> {
    try {
      const execution = await this.executePendingActionDraft(pendingDraft);
      if (execution.ok) {
        this.captureCalendarUndoAction(message.chat.id, pendingDraft, execution.rawResult);
        this.clearPendingActionDraft(message.chat.id, "executed");
      } else {
        this.approvalEngine.markLatestPending(message.chat.id, "failed");
      }

      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: normalizedText,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: execution.reply,
      });

      await this.sendText(message.chat.id, execution.reply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
    } catch (error) {
      this.logger.error("Pending controlled action confirmation failed", {
        chatId: message.chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendText(
        message.chat.id,
        [
          "Falha ao executar a ação confirmada.",
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
        );
    }
  }

  private captureCalendarUndoAction(chatId: number, pendingDraft: PendingActionDraft, rawResult: unknown): void {
    if (pendingDraft.kind === "google_event") {
      const event = rawResult && typeof rawResult === "object"
        ? (rawResult as Record<string, unknown>).event as Record<string, unknown> | undefined
        : undefined;
      const eventId = typeof event?.id === "string" ? event.id : undefined;
      if (!eventId) {
        return;
      }
      this.lastCalendarUndoActions.set(chatId, {
        kind: "create",
        eventId,
        account: pendingDraft.account,
        calendarId: pendingDraft.calendarId,
        summary: pendingDraft.summary,
      });
      return;
    }

    if (pendingDraft.kind === "google_task") {
      const task = rawResult && typeof rawResult === "object"
        ? (rawResult as Record<string, unknown>).task as Record<string, unknown> | undefined
        : undefined;
      const taskId = typeof task?.id === "string" ? task.id : undefined;
      const taskListId = typeof task?.taskListId === "string" ? task.taskListId : pendingDraft.taskListId;
      if (!taskId || !taskListId) {
        return;
      }
      this.lastCalendarUndoActions.set(chatId, {
        kind: "task_create",
        taskId,
        taskListId,
        account: pendingDraft.account,
        title: pendingDraft.title,
      });
      return;
    }

    if (pendingDraft.kind === "google_event_update") {
      this.lastCalendarUndoActions.set(chatId, {
        kind: "update",
        eventId: pendingDraft.eventId,
        account: pendingDraft.account,
        calendarId: pendingDraft.calendarId,
        previous: {
          summary: pendingDraft.originalSummary ?? pendingDraft.summary,
          description: pendingDraft.description,
          location: pendingDraft.originalLocation,
          start: pendingDraft.originalStart,
          end: pendingDraft.originalEnd,
          timezone: pendingDraft.timezone,
          reminderMinutes: pendingDraft.reminderMinutes,
        },
      });
      return;
    }

    if (pendingDraft.kind === "google_event_delete" && pendingDraft.start && pendingDraft.end) {
      this.lastCalendarUndoActions.set(chatId, {
        kind: "delete",
        restoreDraft: {
          kind: "google_event",
          summary: pendingDraft.summary,
          description: pendingDraft.description,
          location: pendingDraft.location,
          start: pendingDraft.start,
          end: pendingDraft.end,
          timezone: pendingDraft.timezone,
          calendarId: pendingDraft.calendarId,
          account: pendingDraft.account,
          reminderMinutes: pendingDraft.reminderMinutes ?? 30,
        },
      });
      return;
    }

    if (pendingDraft.kind === "google_event_delete_batch") {
      const restoreDrafts = pendingDraft.events
        .filter((event) => Boolean(event.start) && Boolean(event.end))
        .map((event) => ({
          kind: "google_event" as const,
          summary: event.summary,
          start: event.start as string,
          end: event.end as string,
          timezone: pendingDraft.timezone,
          calendarId: event.calendarId,
          account: event.account,
          reminderMinutes: 30,
        }));
      if (restoreDrafts.length > 0) {
        this.lastCalendarUndoActions.set(chatId, {
          kind: "delete_batch",
          restoreDrafts,
        });
      }
      return;
    }

    if (pendingDraft.kind === "google_event_import_batch") {
      const record = rawResult && typeof rawResult === "object"
        ? (rawResult as Record<string, unknown>)
        : undefined;
      const created = Array.isArray(record?.created)
        ? record.created as Array<Record<string, unknown>>
        : [];
      const events = created
        .map((event) => ({
          eventId: typeof event.id === "string" ? event.id : undefined,
          account: typeof event.account === "string" ? event.account : pendingDraft.account,
          calendarId: typeof event.calendarId === "string" ? event.calendarId : pendingDraft.calendarId,
          summary: typeof event.summary === "string" ? event.summary : undefined,
        }))
        .filter((event) => Boolean(event.eventId))
        .map((event) => ({
          eventId: event.eventId as string,
          account: event.account,
          calendarId: event.calendarId,
          summary: event.summary,
        }));
      if (events.length > 0) {
        this.lastCalendarUndoActions.set(chatId, {
          kind: "create_batch",
          events,
        });
      }
    }
  }

  private async handleUndoLastCalendarChange(message: TelegramMessage, normalizedText: string): Promise<void> {
    const undoAction = this.lastCalendarUndoActions.get(message.chat.id);
    if (!undoAction) {
      await this.sendText(message.chat.id, "Não tenho uma alteração recente de agenda para desfazer neste chat.", {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    try {
      let reply = "Última alteração de agenda desfeita com sucesso.";

      if (undoAction.kind === "create") {
        await this.core.executeToolDirect("execute_calendar_operation", {
          action: "delete",
          event_id: undoAction.eventId,
          ...(undoAction.calendarId ? { calendar_id: undoAction.calendarId } : {}),
          ...(undoAction.account ? { account: undoAction.account } : {}),
        });
        reply = undoAction.summary
          ? `Último agendamento desfeito: ${undoAction.summary}.`
          : reply;
      } else if (undoAction.kind === "create_batch") {
        await Promise.all(
          undoAction.events.map((event) =>
            this.core.executeToolDirect("execute_calendar_operation", {
              action: "delete",
              event_id: event.eventId,
              ...(event.calendarId ? { calendar_id: event.calendarId } : {}),
              ...(event.account ? { account: event.account } : {}),
            })
          ),
        );
        reply = `Última importação de agenda desfeita. Total removido: ${undoAction.events.length}.`;
      } else if (undoAction.kind === "task_create") {
        await this.core.executeToolDirect("execute_task_operation", {
          action: "delete",
          task_id: undoAction.taskId,
          task_list_id: undoAction.taskListId,
          ...(undoAction.account ? { account: undoAction.account } : {}),
        });
        reply = undoAction.title
          ? `Última tarefa desfeita: ${undoAction.title}.`
          : "Última criação de tarefa foi desfeita.";
      } else if (undoAction.kind === "update") {
        await this.core.executeToolDirect("execute_calendar_operation", {
          action: "update",
          event_id: undoAction.eventId,
          summary: undoAction.previous.summary,
          ...(undoAction.previous.description ? { description: undoAction.previous.description } : {}),
          ...(undoAction.previous.location ? { location: undoAction.previous.location } : {}),
          ...(undoAction.previous.start ? { start: undoAction.previous.start } : {}),
          ...(undoAction.previous.end ? { end: undoAction.previous.end } : {}),
          ...(undoAction.previous.timezone ? { timezone: undoAction.previous.timezone } : {}),
          ...(undoAction.calendarId ? { calendar_id: undoAction.calendarId } : {}),
          ...(undoAction.account ? { account: undoAction.account } : {}),
          ...(typeof undoAction.previous.reminderMinutes === "number"
            ? { reminder_minutes: undoAction.previous.reminderMinutes }
            : {}),
        });
        reply = `Última alteração de agenda desfeita: ${undoAction.previous.summary}.`;
      } else if (undoAction.kind === "delete") {
        await this.core.executeToolDirect("execute_calendar_operation", {
          action: "create",
          summary: undoAction.restoreDraft.summary,
          start: undoAction.restoreDraft.start,
          end: undoAction.restoreDraft.end,
          ...(undoAction.restoreDraft.description ? { description: undoAction.restoreDraft.description } : {}),
          ...(undoAction.restoreDraft.location ? { location: undoAction.restoreDraft.location } : {}),
          ...(undoAction.restoreDraft.timezone ? { timezone: undoAction.restoreDraft.timezone } : {}),
          ...(undoAction.restoreDraft.calendarId ? { calendar_id: undoAction.restoreDraft.calendarId } : {}),
          ...(undoAction.restoreDraft.account ? { account: undoAction.restoreDraft.account } : {}),
          ...(typeof undoAction.restoreDraft.reminderMinutes === "number"
            ? { reminder_minutes: undoAction.restoreDraft.reminderMinutes }
            : {}),
        });
        reply = `Último cancelamento desfeito: ${undoAction.restoreDraft.summary}.`;
      } else {
        await Promise.all(
          undoAction.restoreDrafts.map((draft) =>
            this.core.executeToolDirect("execute_calendar_operation", {
              action: "create",
              summary: draft.summary,
              start: draft.start,
              end: draft.end,
              ...(draft.timezone ? { timezone: draft.timezone } : {}),
              ...(draft.calendarId ? { calendar_id: draft.calendarId } : {}),
              ...(draft.account ? { account: draft.account } : {}),
              ...(typeof draft.reminderMinutes === "number" ? { reminder_minutes: draft.reminderMinutes } : {}),
            }),
          ),
        );
        reply = `Último cancelamento em lote desfeito. Total restaurado: ${undoAction.restoreDrafts.length}.`;
      }

      this.lastCalendarUndoActions.delete(message.chat.id);
      this.appendChatTurn(message.chat.id, {
        role: "user",
        text: normalizedText,
      });
      this.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: reply,
      });
      await this.sendText(message.chat.id, reply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
    } catch (error) {
      this.logger.error("Undo last calendar change failed", {
        chatId: message.chat.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.sendText(
        message.chat.id,
        [
          "Não consegui desfazer a última alteração de agenda.",
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
        {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        },
      );
    }
  }

  private getChatHistory(chatId: number): ChatTurn[] {
    return [...(this.chatHistory.get(chatId) ?? [])];
  }

  private appendChatTurn(chatId: number, turn: ChatTurn): void {
    const history = this.chatHistory.get(chatId) ?? [];
    history.push({
      role: turn.role,
      text: turn.text.trim(),
    });
    this.chatHistory.set(chatId, history.slice(-MAX_CHAT_HISTORY_TURNS));
  }

  private clearChatHistory(chatId: number): void {
    this.chatHistory.delete(chatId);
  }

  private getPendingChoiceState(chatId: number): PendingChoiceState | undefined {
    const pending = this.pendingChoiceStates.get(chatId);
    if (!pending) {
      return undefined;
    }

    if (Date.now() - pending.createdAt > PENDING_CHOICE_WINDOW_MS) {
      this.pendingChoiceStates.delete(chatId);
      return undefined;
    }

    return pending;
  }

  private clearPendingChoiceState(chatId: number): void {
    this.pendingChoiceStates.delete(chatId);
  }

  private clearPendingActionDraft(chatId: number, status?: "discarded" | "executed" | "superseded"): void {
    this.pendingActionDrafts.delete(chatId);
    if (status) {
      this.approvalEngine.markLatestPending(chatId, status);
    }
  }

  private tryHydratePendingDraftForConfirmation(chatId: number): PendingActionDraft | undefined {
    const pendingDraft = this.pendingActionDrafts.get(chatId);
    if (pendingDraft) {
      return pendingDraft;
    }

    const latestApproval = this.approvalEngine.getLatestPending(chatId);
    if (!latestApproval) {
      return undefined;
    }

    const approvalUpdatedAt = Date.parse(latestApproval.updatedAt || latestApproval.createdAt);
    if (Number.isFinite(approvalUpdatedAt) && Date.now() - approvalUpdatedAt > RECENT_PENDING_CONFIRMATION_WINDOW_MS) {
      return undefined;
    }

    const latestClarification = this.clarificationEngine.getLatestPending(chatId);
    const clarificationUpdatedAt = latestClarification
      ? Date.parse(latestClarification.updatedAt || latestClarification.createdAt)
      : Number.NaN;
    if (Number.isFinite(approvalUpdatedAt) && Number.isFinite(clarificationUpdatedAt) && clarificationUpdatedAt > approvalUpdatedAt) {
      return undefined;
    }

    const hydratedDraft = parsePendingActionDraftPayload(latestApproval.draftPayload);
    if (!hydratedDraft) {
      return undefined;
    }
    if (hydratedDraft.kind === "monitored_channel_alert") {
      return undefined;
    }

    this.pendingActionDrafts.set(chatId, hydratedDraft);
    this.logger.info("Hydrated pending action draft from approval inbox for explicit confirmation", {
      chatId,
      approvalId: latestApproval.id,
      kind: hydratedDraft.kind,
    });
    return hydratedDraft;
  }

  private tryHydrateDeleteDraftFromRecentAssistantTurn(chatId: number): PendingGoogleEventDeleteDraft | undefined {
    const history = this.getChatHistory(chatId);
    const lastAssistantTurn = [...history].reverse().find((turn) => turn.role === "assistant");
    if (!lastAssistantTurn?.text) {
      return undefined;
    }

    const draft = extractDeleteDraftFromAssistantText(lastAssistantTurn.text, this.config.google.defaultTimezone);
    if (!draft) {
      return undefined;
    }

    this.pendingActionDrafts.set(chatId, draft);
    this.logger.info("Hydrated calendar delete draft from recent assistant turn", {
      chatId,
      eventId: draft.eventId,
      account: draft.account,
    });
    return draft;
  }

  private tryHydrateContinuablePendingDraft(chatId: number): PendingActionDraft | undefined {
    const pendingDraft = this.pendingActionDrafts.get(chatId);
    if (pendingDraft) {
      return pendingDraft;
    }

    const latestApproval = this.approvalEngine.getLatestPending(chatId);
    if (!latestApproval) {
      return undefined;
    }

    const approvalUpdatedAt = Date.parse(latestApproval.updatedAt || latestApproval.createdAt);
    if (Number.isFinite(approvalUpdatedAt) && Date.now() - approvalUpdatedAt > RECENT_PENDING_CONFIRMATION_WINDOW_MS) {
      return undefined;
    }

    const hydratedDraft = parsePendingActionDraftPayload(latestApproval.draftPayload);
    if (!hydratedDraft || hydratedDraft.kind !== "monitored_channel_alert") {
      return undefined;
    }

    this.pendingActionDrafts.set(chatId, hydratedDraft);
    this.logger.info("Hydrated continuable monitored alert draft from approval inbox", {
      chatId,
      subject: latestApproval.subject,
    });
    return hydratedDraft;
  }

  private async resolveStructuredAssistantDecisionReply(rawReply: string, chatId?: number): Promise<{
    handled: boolean;
    visibleReply: string;
  }> {
    const parsed = parseAssistantDecisionReply(rawReply);
    if (parsed.kind === "absent") {
      return {
        handled: false,
        visibleReply: "",
      };
    }

    if (parsed.kind === "invalid") {
      this.logger.warn("Rejected invalid structured assistant decision", {
        error: parsed.error,
      });
      return {
        handled: true,
        visibleReply: [
          "Recebi uma decisão estruturada inválida para execução local.",
          "Nada foi executado.",
          `Detalhe: ${parsed.error}`,
        ].join("\n"),
      };
    }

    if (!parsed.decision.should_execute || !parsed.decision.execution) {
      return {
        handled: true,
        visibleReply: parsed.decision.assistant_reply,
      };
    }

    try {
      const resolvedPayload = parsed.decision.execution.tool === "execute_task_operation"
        ? await this.core.resolveStructuredTaskOperationPayload(parsed.decision.execution.payload, {
            recentMessages: chatId !== undefined
              ? this.getChatHistory(chatId).map((turn) => turn.text).slice(-6)
              : [],
          })
        : null;

      if (resolvedPayload?.kind === "clarify") {
        return {
          handled: true,
          visibleReply: resolvedPayload.message,
        };
      }

      if (resolvedPayload?.kind === "invalid") {
        return {
          handled: true,
          visibleReply: [
            "Não consegui executar a decisão estruturada local.",
            `Detalhe: ${resolvedPayload.error}`,
          ].join("\n"),
        };
      }

      const execution = await this.core.executeToolDirect(
        parsed.decision.execution.tool,
        resolvedPayload?.kind === "resolved"
          ? resolvedPayload.payload
          : parsed.decision.execution.payload,
      );
      const rawResult = execution.rawResult && typeof execution.rawResult === "object"
        ? execution.rawResult as Record<string, unknown>
        : undefined;
      if (rawResult?.ok === false) {
        return {
          handled: true,
          visibleReply: [
            "Não consegui executar a decisão estruturada local.",
            `Detalhe: ${typeof rawResult.error === "string" ? rawResult.error : "Falha na execução local."}`,
          ].join("\n"),
        };
      }

      return {
        handled: true,
        visibleReply: parsed.decision.assistant_reply,
      };
    } catch (error) {
      this.logger.error("Structured assistant decision execution failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        handled: true,
        visibleReply: [
          "Não consegui executar a decisão estruturada local.",
          `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
        ].join("\n"),
      };
    }
  }

  private persistPendingApproval(chatId: number, draft: PendingActionDraft) {
    const result = this.approvalEngine.request({
      chatId,
      channel: "telegram",
      actionKind: draft.kind,
      subject: buildPendingActionSubject(draft),
      draftPayload: JSON.stringify(draft),
    });
    if (!result.approvalItem) {
      throw new Error(`Approval request for ${draft.kind} was not persisted.`);
    }
    return result.approvalItem;
  }

  private async sendText(
    chatId: number,
    text: string,
    options: {
      reply_to_message_id?: number;
      disable_web_page_preview?: boolean;
      reply_markup?: TelegramInlineKeyboardMarkup;
    } = {},
  ): Promise<void> {
    const chunks = splitTelegramText(text);

    for (let index = 0; index < chunks.length; index += 1) {
      await this.api.sendMessage(chatId, chunks[index], {
        reply_to_message_id: index === 0 ? options.reply_to_message_id : undefined,
        disable_web_page_preview: options.disable_web_page_preview,
        reply_markup: index === 0 ? options.reply_markup : undefined,
      });
    }

    const pendingChoice = extractPendingChoiceState(text);
    if (pendingChoice) {
      this.pendingChoiceStates.set(chatId, pendingChoice);
      this.logger.info("Registered pending choice state from assistant reply", {
        chatId,
        options: pendingChoice.options.map((option) => option.index),
      });
    }
  }
}
