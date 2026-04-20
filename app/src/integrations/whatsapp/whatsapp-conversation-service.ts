import type { AgentCore } from "../../core/agent-core.js";
import {
  type PendingGoogleEventDeleteBatchDraft,
  type PendingGoogleEventDeleteDraft,
  type PendingGoogleEventDraft,
  type PendingGoogleEventImportBatchDraft,
  type PendingGoogleEventUpdateDraft,
  type PendingGoogleTaskDraft,
} from "../../core/google-draft-utils.js";
import { parseAssistantDecisionReply } from "../../core/assistant-decision.js";
import type { WhatsAppMessageStore } from "../../core/whatsapp-message-store.js";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { EvolutionSendTextInput } from "./evolution-api.js";

const MAX_CHAT_HISTORY_TURNS = 6;

interface WhatsAppSender {
  sendText(input: EvolutionSendTextInput): Promise<unknown>;
}

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

type PendingActionDraft =
  | PendingGoogleTaskDraft
  | PendingGoogleEventDraft
  | PendingGoogleEventUpdateDraft
  | PendingGoogleEventDeleteDraft
  | PendingGoogleEventDeleteBatchDraft
  | PendingGoogleEventImportBatchDraft;

export interface WhatsAppConversationInput {
  instanceName?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  text: string;
  createdAt?: string;
}

export interface WhatsAppConversationResult {
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  reply?: string;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function normalizePhone(value: string | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function stableChatId(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash % 2_000_000_000) || 1;
}

function isConfirmationText(text: string): boolean {
  const normalized = normalizeText(text);
  return [
    "sim",
    "ok",
    "confirmo",
    "confirmar",
    "pode seguir",
    "pode executar",
    "segue",
    "seguir",
    "agendar",
    "criar",
    "salvar",
  ].some((item) => normalized === item || normalized.includes(item));
}

function isStrongDeleteConfirmation(text: string): boolean {
  const normalized = normalizeText(text);
  return [
    "confirmar excluir",
    "confirmar apagar",
    "confirmar remover",
    "excluir mesmo",
    "apagar mesmo",
    "remover mesmo",
  ].some((item) => normalized === item || normalized.includes(item));
}

function isCancelText(text: string): boolean {
  const normalized = normalizeText(text);
  return [
    "cancelar",
    "cancela",
    "cancelar rascunho",
    "descartar",
    "descartar rascunho",
    "deixa",
    "esquece",
  ].some((item) => normalized === item || normalized.includes(item));
}

function stripPendingDraftMarkers(text: string): string {
  return text
    .replace(/GOOGLE_TASK_DRAFT[\s\S]*?END_GOOGLE_TASK_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DRAFT[\s\S]*?END_GOOGLE_EVENT_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_UPDATE_DRAFT[\s\S]*?END_GOOGLE_EVENT_UPDATE_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DELETE_DRAFT[\s\S]*?END_GOOGLE_EVENT_DELETE_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_IMPORT_BATCH_DRAFT[\s\S]*?END_GOOGLE_EVENT_IMPORT_BATCH_DRAFT/gi, "")
    .replace(/GOOGLE_EVENT_DELETE_BATCH_DRAFT[\s\S]*?END_GOOGLE_EVENT_DELETE_BATCH_DRAFT/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseJsonDraft<T>(text: string, marker: string): T | undefined {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*([\\s\\S]*?)\\s*END_${escaped}`, "i"));
  if (!match?.[1]?.trim()) {
    return undefined;
  }
  try {
    return JSON.parse(match[1].trim()) as T;
  } catch {
    return undefined;
  }
}

function extractPendingActionDraft(text: string): PendingActionDraft | undefined {
  const task = parseJsonDraft<PendingGoogleTaskDraft>(text, "GOOGLE_TASK_DRAFT");
  if (task?.kind === "google_task" && task.title?.trim()) {
    return task;
  }

  const event = parseJsonDraft<PendingGoogleEventDraft>(text, "GOOGLE_EVENT_DRAFT");
  if (event?.kind === "google_event" && event.summary?.trim() && event.start && event.end) {
    return event;
  }

  const update = parseJsonDraft<PendingGoogleEventUpdateDraft>(text, "GOOGLE_EVENT_UPDATE_DRAFT");
  if (
    update?.kind === "google_event_update" &&
    update.summary?.trim() &&
    update.start &&
    update.end &&
    update.eventId?.trim()
  ) {
    return update;
  }

  const importBatch = parseJsonDraft<PendingGoogleEventImportBatchDraft>(text, "GOOGLE_EVENT_IMPORT_BATCH_DRAFT");
  if (importBatch?.kind === "google_event_import_batch" && Array.isArray(importBatch.events) && importBatch.events.length > 0) {
    return importBatch;
  }

  const deleteBatch = parseJsonDraft<PendingGoogleEventDeleteBatchDraft>(text, "GOOGLE_EVENT_DELETE_BATCH_DRAFT");
  if (deleteBatch?.kind === "google_event_delete_batch" && Array.isArray(deleteBatch.events) && deleteBatch.events.length > 0) {
    return deleteBatch;
  }

  const deleteDraft = parseJsonDraft<PendingGoogleEventDeleteDraft>(text, "GOOGLE_EVENT_DELETE_DRAFT");
  if (deleteDraft?.kind === "google_event_delete" && deleteDraft.summary?.trim() && deleteDraft.eventId?.trim()) {
    return deleteDraft;
  }

  return undefined;
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

function buildPendingActionReply(draft: PendingActionDraft): string {
  if (draft.kind === "google_task") {
    return [
      `Tarefa pronta: ${draft.title}.`,
      draft.due ? `Prazo: ${formatLocalDateTime(draft.due) ?? draft.due}.` : undefined,
      "Confirme com `sim` ou cancele com `cancelar`.",
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event") {
    return [
      `Evento pronto: ${draft.summary}.`,
      `Quando: ${formatLocalDateTime(draft.start, draft.timezone) ?? draft.start} até ${formatLocalDateTime(draft.end, draft.timezone) ?? draft.end}.`,
      draft.location ? `Local: ${draft.location}.` : undefined,
      "Confirme com `sim` ou cancele com `cancelar`.",
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event_update") {
    return [
      `Ajuste pronto: ${draft.originalSummary ?? draft.summary}.`,
      `Novo horário: ${formatLocalDateTime(draft.start, draft.timezone) ?? draft.start} até ${formatLocalDateTime(draft.end, draft.timezone) ?? draft.end}.`,
      "Confirme com `sim` ou cancele com `cancelar`.",
    ].join("\n");
  }

  if (draft.kind === "google_event_delete") {
    return [
      `Excluir evento: ${draft.summary}.`,
      draft.start ? `Horário: ${formatLocalDateTime(draft.start, draft.timezone) ?? draft.start}.` : undefined,
      "Para excluir, responda `confirmar excluir`. Para manter, responda `cancelar`.",
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event_delete_batch") {
    return [
      `Excluir ${draft.events.length} evento(s).`,
      ...draft.events.slice(0, 10).map((event) => `- ${event.summary}`),
      "Para excluir, responda `confirmar excluir`. Para manter, responda `cancelar`.",
    ].join("\n");
  }

  return [
    `Importação pronta: ${draft.events.length} evento(s).`,
    ...draft.events.map((event) => `- ${event.summary} | ${formatLocalDateTime(event.start, draft.timezone) ?? event.start}`),
    "Confirme com `sim` ou cancele com `cancelar`.",
  ].join("\n");
}

function buildExecutionSuccessMessage(draft: PendingActionDraft, rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? rawResult as Record<string, unknown> : undefined;
  const event = record?.event && typeof record.event === "object" ? record.event as Record<string, unknown> : undefined;
  const task = record?.task && typeof record.task === "object" ? record.task as Record<string, unknown> : undefined;

  if (draft.kind === "google_task") {
    return [
      "Tarefa criada.",
      typeof task?.title === "string" ? `Título: ${task.title}` : `Título: ${draft.title}`,
      typeof task?.taskListTitle === "string" ? `Lista: ${task.taskListTitle}` : undefined,
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event") {
    return [
      "Evento criado.",
      typeof event?.summary === "string" ? `Título: ${event.summary}` : `Título: ${draft.summary}`,
      typeof event?.start === "string" ? `Início: ${formatLocalDateTime(event.start, draft.timezone) ?? event.start}` : undefined,
      typeof event?.htmlLink === "string" ? `Link: ${event.htmlLink}` : undefined,
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event_update") {
    return [
      "Evento atualizado.",
      typeof event?.summary === "string" ? `Título: ${event.summary}` : `Título: ${draft.summary}`,
      typeof event?.start === "string" ? `Início: ${formatLocalDateTime(event.start, draft.timezone) ?? event.start}` : undefined,
    ].filter(Boolean).join("\n");
  }

  if (draft.kind === "google_event_delete" || draft.kind === "google_event_delete_batch") {
    return "Evento(s) removido(s) da agenda.";
  }

  const created = Array.isArray(record?.created) ? record.created.length : 0;
  const failed = Array.isArray(record?.failed) ? record.failed.length : 0;
  return failed > 0
    ? `Importação concluída parcialmente. Criados: ${created}. Falhas: ${failed}.`
    : `Importação concluída. Eventos criados: ${created}.`;
}

function buildExecutionFailureMessage(label: string, rawResult: unknown): string {
  const record = rawResult && typeof rawResult === "object" ? rawResult as Record<string, unknown> : undefined;
  const status = record?.status && typeof record.status === "object" ? record.status as Record<string, unknown> : undefined;
  const detail =
    typeof record?.error === "string"
      ? record.error
      : typeof status?.message === "string"
        ? status.message
        : "Falha local na execução.";
  return [`Não consegui concluir ${label}.`, `Detalhe: ${detail}`].join("\n");
}

function hasNumberedOptions(text: string | undefined): boolean {
  return Boolean(text && /(?:^|\n)\s*(?:1[\).\s-]|1\s*—)/.test(text));
}

function buildWhatsAppAgentPrompt(input: {
  chatId: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  text: string;
  history: ChatTurn[];
}): string {
  const lines = [
    "Contexto do WhatsApp:",
    "canal=whatsapp",
    "chat_type=private",
    `chat_id=${input.chatId}`,
    `remote_jid=${input.remoteJid}`,
    `number=${input.number}`,
    input.pushName ? `push_name=${input.pushName}` : undefined,
    "responda de forma curta, natural e operacional para WhatsApp",
    "",
  ].filter(Boolean) as string[];

  if (input.history.length > 0) {
    lines.push("Histórico recente do chat:");
    for (const turn of input.history) {
      lines.push(`${turn.role === "user" ? "Usuário" : "Assistente"}: ${turn.text}`);
    }
    lines.push("");
  }

  lines.push("Mensagem atual do usuário:");
  lines.push(input.text);
  return lines.join("\n");
}

function normalizeChoiceContinuation(text: string, history: ChatTurn[]): string {
  const normalized = normalizeText(text);
  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant")?.text;
  if (!lastAssistant || !hasNumberedOptions(lastAssistant)) {
    return text;
  }

  const numeric = normalized.match(/^(?:opcao|opção)?\s*(\d{1,2})$/)?.[1]
    ?? normalized.match(/^quero\s+a\s+opcao\s+(\d{1,2})$/)?.[1]
    ?? normalized.match(/^segue\s+com\s+a?\s*(\d{1,2})$/)?.[1];
  if (numeric) {
    return `O usuário escolheu a opção ${numeric} da lista anterior. Siga essa opção sem reiniciar clarificação.`;
  }

  const naturalMap: Record<string, number> = {
    "a primeira": 1,
    "o primeiro": 1,
    "primeira": 1,
    "primeiro": 1,
    "a segunda": 2,
    "o segundo": 2,
    "segunda": 2,
    "segundo": 2,
    "a terceira": 3,
    "o terceiro": 3,
    "terceira": 3,
    "terceiro": 3,
    "a ultima": 99,
    "a última": 99,
    "ultima": 99,
    "última": 99,
  };
  const selected = naturalMap[normalized];
  if (selected) {
    return `O usuário escolheu ${selected === 99 ? "a última opção" : `a opção ${selected}`} da lista anterior. Siga essa opção sem reiniciar clarificação.`;
  }

  return text;
}

export class WhatsAppConversationService {
  private readonly chatHistory = new Map<string, ChatTurn[]>();
  private readonly pendingActionDrafts = new Map<string, PendingActionDraft>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly core: AgentCore,
    private readonly evolution: WhatsAppSender,
    private readonly whatsappMessages: WhatsAppMessageStore,
  ) {}

  async handleInboundText(input: WhatsAppConversationInput): Promise<WhatsAppConversationResult> {
    const chatKey = `${input.instanceName ?? this.config.whatsapp.defaultInstanceName ?? "default"}:${input.remoteJid}`;
    const normalizedNumber = normalizePhone(input.number);
    if (input.remoteJid.endsWith("@g.us") && this.config.whatsapp.ignoreGroups) {
      return { ok: true, ignored: true, reason: "group_ignored" };
    }

    if (!this.isAllowedNumber(normalizedNumber)) {
      this.logger.warn("WhatsApp conversation rejected unauthorized number", {
        instanceName: input.instanceName,
        number: normalizedNumber,
      });
      return { ok: true, ignored: true, reason: "unauthorized_number" };
    }

    const text = input.text.trim();
    if (!text) {
      return { ok: true, ignored: true, reason: "empty_text" };
    }

    this.whatsappMessages.saveMessage({
      instanceName: input.instanceName,
      remoteJid: input.remoteJid,
      number: normalizedNumber,
      pushName: input.pushName,
      direction: "inbound",
      text,
      createdAt: input.createdAt,
    });

    this.logger.info("WhatsApp conversation inbound text accepted", {
      instanceName: input.instanceName,
      chatKey,
      number: normalizedNumber,
      textLength: text.length,
    });

    const pending = this.pendingActionDrafts.get(chatKey);
    if (pending) {
      const pendingReply = await this.handlePendingAction(chatKey, input, pending, text);
      if (pendingReply) {
        return pendingReply;
      }
    }

    if (normalizeText(text) === "/reset") {
      this.chatHistory.delete(chatKey);
      this.pendingActionDrafts.delete(chatKey);
      this.core.clearChatState(stableChatId(chatKey));
      return this.reply(input, "Histórico curto deste WhatsApp foi limpo.");
    }

    const history = this.getHistory(chatKey);
    const effectiveText = normalizeChoiceContinuation(text, history);
    const result = await this.core.runUserPrompt(
      buildWhatsAppAgentPrompt({
        chatId: chatKey,
        remoteJid: input.remoteJid,
        number: normalizedNumber,
        pushName: input.pushName,
        text: effectiveText,
        history,
      }),
      { chatId: stableChatId(chatKey) },
    );

    const structuredDecision = await this.resolveStructuredAssistantDecisionReply(result.reply, chatKey);
    if (structuredDecision.handled) {
      this.appendHistory(chatKey, { role: "user", text });
      this.appendHistory(chatKey, { role: "assistant", text: structuredDecision.visibleReply });
      return this.reply(input, structuredDecision.visibleReply);
    }

    const nextPendingDraft = extractPendingActionDraft(result.reply);
    const visibleReply = stripPendingDraftMarkers(result.reply) || result.reply;
    const finalReply = nextPendingDraft ? buildPendingActionReply(nextPendingDraft) : visibleReply;
    if (nextPendingDraft) {
      this.pendingActionDrafts.set(chatKey, nextPendingDraft);
    } else {
      this.pendingActionDrafts.delete(chatKey);
    }

    this.appendHistory(chatKey, { role: "user", text });
    this.appendHistory(chatKey, { role: "assistant", text: finalReply });
    return this.reply(input, finalReply);
  }

  private isAllowedNumber(number: string): boolean {
    const allowed = this.config.whatsapp.allowedNumbers.map(normalizePhone).filter(Boolean);
    return allowed.length === 0 || allowed.includes(number);
  }

  private getHistory(chatKey: string): ChatTurn[] {
    return [...(this.chatHistory.get(chatKey) ?? [])];
  }

  private appendHistory(chatKey: string, turn: ChatTurn): void {
    const next = [...(this.chatHistory.get(chatKey) ?? []), turn].slice(-MAX_CHAT_HISTORY_TURNS);
    this.chatHistory.set(chatKey, next);
  }

  private async reply(input: WhatsAppConversationInput, text: string): Promise<WhatsAppConversationResult> {
    await this.evolution.sendText({
      instanceName: input.instanceName,
      number: input.number,
      text,
    });
    this.whatsappMessages.saveMessage({
      instanceName: input.instanceName,
      remoteJid: input.remoteJid,
      number: input.number,
      pushName: input.pushName,
      direction: "outbound",
      text,
    });
    this.logger.info("WhatsApp conversation outbound text sent", {
      instanceName: input.instanceName,
      remoteJid: input.remoteJid,
      textLength: text.length,
    });
    return { ok: true, reply: text };
  }

  private async handlePendingAction(
    chatKey: string,
    input: WhatsAppConversationInput,
    pending: PendingActionDraft,
    text: string,
  ): Promise<WhatsAppConversationResult | null> {
    if (isCancelText(text)) {
      this.pendingActionDrafts.delete(chatKey);
      this.appendHistory(chatKey, { role: "user", text });
      this.appendHistory(chatKey, { role: "assistant", text: "Rascunho descartado." });
      return this.reply(input, "Rascunho descartado.");
    }

    const destructive = pending.kind === "google_event_delete" || pending.kind === "google_event_delete_batch";
    if (destructive && isConfirmationText(text) && !isStrongDeleteConfirmation(text)) {
      const reply = "Para excluir, responda `confirmar excluir`. Para manter, responda `cancelar`.";
      this.appendHistory(chatKey, { role: "user", text });
      this.appendHistory(chatKey, { role: "assistant", text: reply });
      return this.reply(input, reply);
    }

    if (destructive ? isStrongDeleteConfirmation(text) : isConfirmationText(text)) {
      const execution = await this.executePendingActionDraft(pending);
      this.pendingActionDrafts.delete(chatKey);
      const reply = execution.ok
        ? buildExecutionSuccessMessage(pending, execution.rawResult)
        : buildExecutionFailureMessage("a ação confirmada", execution.rawResult);
      this.appendHistory(chatKey, { role: "user", text });
      this.appendHistory(chatKey, { role: "assistant", text: reply });
      return this.reply(input, reply);
    }

    return null;
  }

  private async executePendingActionDraft(draft: PendingActionDraft): Promise<{ ok: boolean; rawResult: unknown }> {
    const execution =
      draft.kind === "google_task"
        ? await this.core.executeToolDirect("execute_task_operation", {
            action: "create",
            title: draft.title,
            ...(draft.notes ? { notes: draft.notes } : {}),
            ...(draft.due ? { due: draft.due } : {}),
            ...(draft.taskListId ? { task_list_id: draft.taskListId } : {}),
            ...(draft.account ? { account: draft.account } : {}),
          })
        : draft.kind === "google_event"
          ? await this.core.executeToolDirect("execute_calendar_operation", {
              action: "create",
              summary: draft.summary,
              start: draft.start,
              end: draft.end,
              ...(draft.description ? { description: draft.description } : {}),
              ...(draft.location ? { location: draft.location } : {}),
              ...(draft.attendees?.length ? { attendees: draft.attendees } : {}),
              ...(draft.timezone ? { timezone: draft.timezone } : {}),
              ...(draft.calendarId ? { calendar_id: draft.calendarId } : {}),
              ...(draft.account ? { account: draft.account } : {}),
              ...(typeof draft.reminderMinutes === "number" ? { reminder_minutes: draft.reminderMinutes } : {}),
              ...(draft.createMeet ? { create_meet: true } : {}),
            })
          : draft.kind === "google_event_update"
            ? await this.core.executeToolDirect("execute_calendar_operation", {
                action: "update",
                event_id: draft.eventId,
                summary: draft.summary,
                start: draft.start,
                end: draft.end,
                ...(draft.description ? { description: draft.description } : {}),
                ...(draft.location ? { location: draft.location } : {}),
                ...(draft.attendees?.length ? { attendees: draft.attendees } : {}),
                ...(draft.timezone ? { timezone: draft.timezone } : {}),
                ...(draft.calendarId ? { calendar_id: draft.calendarId } : {}),
                ...(draft.account ? { account: draft.account } : {}),
                ...(typeof draft.reminderMinutes === "number" ? { reminder_minutes: draft.reminderMinutes } : {}),
                ...(draft.createMeet ? { create_meet: true } : {}),
              })
            : draft.kind === "google_event_delete"
              ? await this.core.executeToolDirect("execute_calendar_operation", {
                  action: "delete",
                  event_id: draft.eventId,
                  ...(draft.calendarId ? { calendar_id: draft.calendarId } : {}),
                  ...(draft.account ? { account: draft.account } : {}),
                })
              : draft.kind === "google_event_delete_batch"
                ? await Promise.all(
                    draft.events.map((event) =>
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
                    for (const event of draft.events) {
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
                        ...(typeof event.reminderMinutes === "number" ? { reminder_minutes: event.reminderMinutes } : {}),
                        ...(event.createMeet ? { create_meet: true } : {}),
                      });
                      const record = result.rawResult && typeof result.rawResult === "object"
                        ? result.rawResult as Record<string, unknown>
                        : undefined;
                      if (record?.ok === true) {
                        created.push({ summary: event.summary, account: event.account });
                      } else {
                        failed.push({ summary: event.summary, rawResult: result.rawResult });
                      }
                    }
                    return { rawResult: { ok: failed.length === 0, created, failed } };
                  })();

    const record = execution.rawResult && typeof execution.rawResult === "object"
      ? execution.rawResult as Record<string, unknown>
      : undefined;
    const ok = draft.kind === "google_event_import_batch"
      ? Array.isArray(record?.created) && record.created.length > 0
      : record?.ok === true;
    return { ok, rawResult: execution.rawResult };
  }

  private async resolveStructuredAssistantDecisionReply(rawReply: string, chatKey: string): Promise<{
    handled: boolean;
    visibleReply: string;
  }> {
    const parsed = parseAssistantDecisionReply(rawReply);
    if (parsed.kind === "absent") {
      return { handled: false, visibleReply: "" };
    }

    if (parsed.kind === "invalid") {
      this.logger.warn("Rejected invalid WhatsApp structured assistant decision", {
        error: parsed.error,
      });
      return {
        handled: true,
        visibleReply: ["Decisão estruturada inválida. Nada foi executado.", `Detalhe: ${parsed.error}`].join("\n"),
      };
    }

    if (!parsed.decision.should_execute || !parsed.decision.execution) {
      return { handled: true, visibleReply: parsed.decision.assistant_reply };
    }

    const resolvedPayload = parsed.decision.execution.tool === "execute_task_operation"
      ? await this.core.resolveStructuredTaskOperationPayload(parsed.decision.execution.payload, {
          recentMessages: this.getHistory(chatKey).map((turn) => turn.text).slice(-6),
        })
      : null;

    if (resolvedPayload?.kind === "clarify") {
      return { handled: true, visibleReply: resolvedPayload.message };
    }

    if (resolvedPayload?.kind === "invalid") {
      return {
        handled: true,
        visibleReply: ["Não consegui executar a decisão estruturada local.", `Detalhe: ${resolvedPayload.error}`].join("\n"),
      };
    }

    const execution = await this.core.executeToolDirect(
      parsed.decision.execution.tool,
      resolvedPayload?.kind === "resolved" ? resolvedPayload.payload : parsed.decision.execution.payload,
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

    return { handled: true, visibleReply: parsed.decision.assistant_reply };
  }
}
