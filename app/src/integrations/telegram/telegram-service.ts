import { setTimeout as delay } from "node:timers/promises";
import type { AgentCore } from "../../core/agent-core.js";
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
  buildGoogleEventImportBatchDraftReply,
  buildGoogleEventDraftReply,
  buildGoogleEventUpdateDraftReply,
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
} from "../../core/google-draft-utils.js";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { OpenAiAudioTranscriptionService } from "../openai/audio-transcription.js";
import { OpenAiScheduleImportService } from "../openai/schedule-import.js";
import type { ApprovalInboxStore } from "../../core/approval-inbox.js";
import type { WhatsAppMessageStore } from "../../core/whatsapp-message-store.js";
import { matchPersonalCalendarTerms } from "../../core/calendar-relevance.js";
import { EvolutionApiClient } from "../whatsapp/evolution-api.js";
import { TelegramApi } from "./telegram-api.js";
import type {
  TelegramCallbackQuery,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./types.js";

const MAX_CHAT_HISTORY_TURNS = 6;

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
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText: string;
  replyText: string;
  relationship?: string;
  persona?: string;
}

type PendingActionDraft =
  | PendingEmailDraft
  | PendingWhatsAppReplyDraft
  | PendingGoogleTaskDraft
  | PendingGoogleEventDraft
  | PendingGoogleEventUpdateDraft
  | PendingGoogleEventDeleteDraft
  | PendingGoogleEventDeleteBatchDraft
  | PendingGoogleEventImportBatchDraft;

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

interface TelegramAudioAttachment {
  fileId: string;
  fileName: string;
  mimeType?: string;
  kind: "voice" | "audio";
}

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

function extensionFromMimeType(mimeType: string | undefined, fallback = "bin"): string {
  switch (mimeType?.toLowerCase()) {
    case "audio/ogg":
    case "application/ogg":
      return "ogg";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return fallback;
  }
}

function extractAudioAttachment(message: TelegramMessage): TelegramAudioAttachment | undefined {
  if (message.voice?.file_id) {
    const extension = extensionFromMimeType(message.voice.mime_type, "ogg");
    return {
      fileId: message.voice.file_id,
      fileName: `voice_${message.message_id}.${extension}`,
      mimeType: message.voice.mime_type,
      kind: "voice",
    };
  }

  if (message.audio?.file_id) {
    const extension = extensionFromMimeType(message.audio.mime_type, "mp3");
    return {
      fileId: message.audio.file_id,
      fileName: message.audio.file_name?.trim() || `audio_${message.message_id}.${extension}`,
      mimeType: message.audio.mime_type,
      kind: "audio",
    };
  }

  return undefined;
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

function isApprovalListRequest(text: string): boolean {
  const normalized = normalizeIntentText(text);
  return [
    "aprovacoes",
    "aprovações",
    "liste aprovacoes",
    "liste aprovações",
    "aprovacoes pendentes",
    "aprovações pendentes",
    "liste aprovacoes pendentes",
    "liste aprovações pendentes",
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
        remoteJid: parsed.remoteJid,
        number: parsed.number,
        pushName: typeof parsed.pushName === "string" ? parsed.pushName : undefined,
        inboundText: parsed.inboundText,
        replyText: parsed.replyText,
        relationship: typeof parsed.relationship === "string" ? parsed.relationship : undefined,
        persona: typeof parsed.persona === "string" ? parsed.persona : undefined,
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
      `Resposta: ${draft.replyText}`,
      "Use os botões `Enviar`, `Editar` ou `Ignorar`.",
    ].join("\n");
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
      ...draft.events.slice(0, 6).map((event) => `- ${event.summary} | ${formatLocalDateTime(event.start, draft.timezone) ?? event.start}`),
      draft.events.length > 6 ? `- ... e mais ${draft.events.length - 6} evento(s).` : undefined,
      "Confirme com `agendar`.",
    ].filter(Boolean).join("\n");
  }

  return undefined;
}

function buildPendingActionSubject(draft: PendingActionDraft): string {
  if (draft.kind === "email_reply") {
    return `Email UID ${draft.uid}`;
  }
  if (draft.kind === "whatsapp_reply") {
    return `WhatsApp: ${draft.pushName ?? draft.number}`;
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
  return `Cancelamento em lote (${draft.events.length} eventos)`;
}

function buildWhatsAppSendSuccessMessage(rawResult: unknown, draft: PendingWhatsAppReplyDraft): string {
  const record = rawResult && typeof rawResult === "object" ? (rawResult as Record<string, unknown>) : undefined;
  return [
    "Resposta de WhatsApp enviada com sucesso.",
    `Contato: ${draft.pushName ?? draft.number}`,
    record ? `Retorno: ${JSON.stringify(record).slice(0, 300)}` : undefined,
  ].filter(Boolean).join("\n");
}

function buildApprovalListReply(items: Array<{
  id: number;
  subject: string;
  actionKind: string;
  createdAt: string;
}>): string {
  if (items.length === 0) {
    return "Não há aprovações pendentes neste chat.";
  }

  return [
    `Aprovações pendentes: ${items.length}.`,
    ...items.map((item) => `- #${item.id} | ${item.actionKind} | ${item.subject} | ${item.createdAt}`),
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

  for (const event of created.slice(0, 6)) {
    const summary = typeof event.summary === "string" ? event.summary : "Evento";
    const start = typeof event.start === "string" ? formatLocalDateTime(event.start, pendingDraft.timezone) ?? event.start : undefined;
    lines.push(`- ${summary}${start ? ` | ${start}` : ""}`);
  }

  if (created.length > 6) {
    lines.push(`- ... e mais ${created.length - 6} evento(s).`);
  }

  if (failed.length > 0) {
    lines.push(`Falhas: ${failed.length}`);
    for (const event of failed.slice(0, 4)) {
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

function buildAgentPrompt(message: TelegramMessage, text: string, history: ChatTurn[]): string {
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

  promptLines.push("Mensagem atual do usuário:");
  promptLines.push(text);
  return promptLines.join("\n");
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

export class TelegramService {
  private readonly hasAllowlist: boolean;
  private readonly chatHistory = new Map<number, ChatTurn[]>();
  private readonly pendingActionDrafts = new Map<number, PendingActionDraft>();
  private readonly lastCalendarUndoActions = new Map<number, CalendarUndoAction>();
  private readonly audioTranscription?: OpenAiAudioTranscriptionService;
  private readonly scheduleImport?: OpenAiScheduleImportService;
  private readonly whatsapp: EvolutionApiClient;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly core: AgentCore,
    private readonly api: TelegramApi,
    private readonly approvals: ApprovalInboxStore,
    private readonly whatsappMessages: WhatsAppMessageStore,
  ) {
    this.hasAllowlist = this.config.telegram.allowedUserIds.length > 0;
    this.whatsapp = new EvolutionApiClient(
      this.config.whatsapp,
      this.logger.child({ scope: "whatsapp-evolution" }),
    );
    if (this.config.llm.provider === "openai" && this.config.llm.apiKey) {
      this.audioTranscription = new OpenAiAudioTranscriptionService(
        this.config.llm.apiKey,
        this.config.llm.baseUrl,
      );
      this.scheduleImport = new OpenAiScheduleImportService(
        this.config.llm.apiKey,
        this.config.llm.baseUrl,
        this.config.llm.model,
        this.logger.child({ scope: "schedule-import" }),
      );
    }
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
    const audioAttachment = importAttachment ? undefined : (text ? undefined : extractAudioAttachment(message));
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
      await this.sendText(message.chat.id, "Histórico curto deste chat foi limpo.", {
        reply_to_message_id: message.message_id,
      });
      return;
    }

    if (!text && audioAttachment) {
      if (!this.audioTranscription) {
        await this.sendText(
          message.chat.id,
          "A transcrição de áudio depende de um provider OpenAI ativo com chave configurada.",
          {
            reply_to_message_id: message.message_id,
          },
        );
        return;
      }

      try {
        const remoteFile = await this.api.getFile(audioAttachment.fileId);
        if (!remoteFile.file_path) {
          throw new Error("Telegram não retornou file_path para o áudio enviado");
        }
        const buffer = await this.api.downloadFile(remoteFile.file_path);
        const transcription = await this.audioTranscription.transcribe({
          audio: buffer,
          filename: audioAttachment.fileName,
          mimeType: audioAttachment.mimeType,
          language: "pt",
        });
        text = transcription.text;
        this.logger.info("Telegram audio transcribed", {
          chatId: message.chat.id,
          userId,
          kind: audioAttachment.kind,
          model: transcription.model,
        });
      } catch (error) {
        this.logger.error("Telegram audio transcription failed", {
          chatId: message.chat.id,
          userId,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.sendText(
          message.chat.id,
          [
            "Não consegui transcrever este áudio.",
            `Detalhe: ${error instanceof Error ? error.message : String(error)}`,
          ].join("\n"),
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

    if (text === "/approvals" || isApprovalListRequest(normalizedText)) {
      const items = this.approvals.listPending(message.chat.id, 10);
      await this.sendText(
        message.chat.id,
        buildApprovalListReply(
          items.map((item) => ({
            id: item.id,
            subject: item.subject,
            actionKind: item.actionKind,
            createdAt: item.createdAt,
          })),
        ),
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

    if (isExplicitSendConfirmation(normalizedText)) {
      const pendingDraft = this.pendingActionDrafts.get(message.chat.id);
      if (pendingDraft) {
        await this.handlePendingActionConfirmation(message, normalizedText, pendingDraft);
        return;
      }
    } else if (!this.pendingActionDrafts.has(message.chat.id)) {
      this.clearPendingActionDraft(message.chat.id);
    }

    const pendingDraft = this.pendingActionDrafts.get(message.chat.id);
    if (pendingDraft && isDraftDiscardRequest(normalizedText)) {
      this.clearPendingActionDraft(message.chat.id, "discarded");
      await this.sendText(message.chat.id, "Rascunho pendente descartado. Nenhuma ação foi executada.", {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
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

    try {
      const history = this.getChatHistory(message.chat.id);
      const pendingEmailDraft = pendingDraft?.kind === "email_reply" ? pendingDraft : undefined;
      const effectiveText = pendingEmailDraft
        ? buildPendingDraftAdjustmentPrompt(pendingEmailDraft, normalizedText)
        : normalizedText;
      if (pendingDraft && pendingDraft.kind !== "email_reply") {
        this.clearPendingActionDraft(message.chat.id);
      }
      const result = await this.core.runUserPrompt(buildAgentPrompt(message, effectiveText, history));
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

    const item = this.approvals.getById(parsed.id);
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
      this.approvals.updateStatus(item.id, "failed");
      await this.api.answerCallbackQuery(callback.id, {
        text: "Rascunho inválido.",
        show_alert: true,
      }).catch(() => undefined);
      return;
    }

    if (parsed.action === "discard") {
      this.approvals.updateStatus(item.id, "discarded");
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
      this.pendingActionDrafts.set(chatId, draft);
      await this.api.answerCallbackQuery(callback.id, {
        text: "Envie a alteração em texto. Vou atualizar o rascunho.",
      }).catch(() => undefined);
      await this.sendText(
        chatId,
        draft.kind === "whatsapp_reply"
          ? [
              `Rascunho carregado para edição: WhatsApp para ${draft.pushName ?? draft.number}.`,
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
      this.approvals.updateStatus(item.id, execution.ok ? "executed" : "failed");
      if (execution.ok) {
        this.captureCalendarUndoAction(chatId, draft, execution.rawResult);
        this.pendingActionDrafts.delete(chatId);
      }

      await this.sendText(chatId, execution.reply, {
        reply_to_message_id: callback.message?.message_id,
        disable_web_page_preview: true,
      });
    } catch (error) {
      this.approvals.updateStatus(item.id, "failed");
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

  private async executePendingActionDraft(
    pendingDraft: PendingActionDraft,
  ): Promise<{ ok: boolean; reply: string; rawResult: unknown }> {
    const execution =
      pendingDraft.kind === "email_reply"
        ? await this.core.executeToolDirect("send_email_reply", {
            uid: pendingDraft.uid,
            body: pendingDraft.body,
            ...(pendingDraft.subjectOverride ? { subject_override: pendingDraft.subjectOverride } : {}),
          })
        : pendingDraft.kind === "whatsapp_reply"
          ? {
              rawResult: await this.whatsapp.sendText({
                instanceName: pendingDraft.instanceName,
                number: pendingDraft.number,
                text: pendingDraft.replyText,
              }),
            }
          : pendingDraft.kind === "google_task"
            ? await this.core.executeToolDirect("create_google_task", {
                title: pendingDraft.title,
                ...(pendingDraft.notes ? { notes: pendingDraft.notes } : {}),
                ...(pendingDraft.due ? { due: pendingDraft.due } : {}),
                ...(pendingDraft.taskListId ? { task_list_id: pendingDraft.taskListId } : {}),
                ...(pendingDraft.account ? { account: pendingDraft.account } : {}),
              })
            : pendingDraft.kind === "google_event"
              ? await this.core.executeToolDirect("create_calendar_event", {
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
                ? await this.core.executeToolDirect("update_calendar_event", {
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
                  ? await this.core.executeToolDirect("delete_calendar_event", {
                      event_id: pendingDraft.eventId,
                      ...(pendingDraft.calendarId ? { calendar_id: pendingDraft.calendarId } : {}),
                      ...(pendingDraft.account ? { account: pendingDraft.account } : {}),
                    })
                  : pendingDraft.kind === "google_event_delete_batch"
                    ? await Promise.all(
                        pendingDraft.events.map((event) =>
                          this.core.executeToolDirect("delete_calendar_event", {
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
                          const result = await this.core.executeToolDirect("create_calendar_event", {
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
      : pendingDraft.kind === "google_event_import_batch"
        ? Array.isArray(record?.created) && record.created.length > 0
        : record?.ok === true;
    const reply = pendingDraft.kind === "email_reply"
      ? ok
        ? buildEmailSendSuccessMessage(execution.rawResult, pendingDraft.uid)
        : buildEmailSendFailureMessage(execution.rawResult)
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

    return {
      ok,
      reply,
      rawResult: execution.rawResult,
    };
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
        this.markLatestPendingApproval(message.chat.id, "failed");
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
        await this.core.executeToolDirect("delete_calendar_event", {
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
            this.core.executeToolDirect("delete_calendar_event", {
              event_id: event.eventId,
              ...(event.calendarId ? { calendar_id: event.calendarId } : {}),
              ...(event.account ? { account: event.account } : {}),
            })
          ),
        );
        reply = `Última importação de agenda desfeita. Total removido: ${undoAction.events.length}.`;
      } else if (undoAction.kind === "task_create") {
        await this.core.executeToolDirect("delete_google_task", {
          task_id: undoAction.taskId,
          task_list_id: undoAction.taskListId,
          ...(undoAction.account ? { account: undoAction.account } : {}),
        });
        reply = undoAction.title
          ? `Última tarefa desfeita: ${undoAction.title}.`
          : "Última criação de tarefa foi desfeita.";
      } else if (undoAction.kind === "update") {
        await this.core.executeToolDirect("update_calendar_event", {
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
        await this.core.executeToolDirect("create_calendar_event", {
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
            this.core.executeToolDirect("create_calendar_event", {
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

  private clearPendingActionDraft(chatId: number, status?: "discarded" | "executed" | "superseded"): void {
    this.pendingActionDrafts.delete(chatId);
    if (status) {
      this.markLatestPendingApproval(chatId, status);
    }
  }

  private persistPendingApproval(chatId: number, draft: PendingActionDraft) {
    return this.approvals.createPending({
      chatId,
      channel: "telegram",
      actionKind: draft.kind,
      subject: buildPendingActionSubject(draft),
      draftPayload: JSON.stringify(draft),
    });
  }

  private markLatestPendingApproval(chatId: number, status: "discarded" | "executed" | "failed" | "superseded"): void {
    const pending = this.approvals.getLatestPending(chatId);
    if (!pending) {
      return;
    }
    this.approvals.updateStatus(pending.id, status);
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
  }
}
