import type { DraftApprovalService } from "../../core/draft-approval-service.js";
import {
  type PendingActionDraft,
} from "../../core/draft-action-service.js";
import { buildMonitoredChannelAlertReply } from "../../core/monitored-channel-alerts.js";
import type { Logger } from "../../types/logger.js";
import { TelegramApi } from "./telegram-api.js";
import type {
  TelegramCallbackQuery,
  TelegramInlineKeyboardMarkup,
} from "./types.js";

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

export function buildApprovalInlineKeyboard(id: number): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [[
      { text: "Enviar", callback_data: buildApprovalCallbackData("send", id) },
      { text: "Editar", callback_data: buildApprovalCallbackData("edit", id) },
      { text: "Ignorar", callback_data: buildApprovalCallbackData("discard", id) },
    ]],
  };
}

export function buildCompactPendingActionReply(draft: PendingActionDraft): string | undefined {
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

  if (draft.kind === "autonomy_capability") {
    return [
      `Ação pronta para aprovação: ${draft.title}.`,
      `Capability: ${draft.capabilityName}`,
      draft.summary ? `Contexto: ${draft.summary}` : undefined,
      "Use `Enviar` para executar, `Editar` para refazer por conversa ou `Ignorar` para descartar.",
    ].filter(Boolean).join("\n");
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

function buildEditPrompt(draft: PendingActionDraft): string {
  if (draft.kind === "whatsapp_reply") {
    return [
      `Rascunho carregado para edição: WhatsApp para ${draft.pushName ?? draft.number}.`,
      ...(draft.account ? [`Conta: ${draft.account}.`] : []),
      ...(draft.instanceName ? [`Instância: ${draft.instanceName}.`] : []),
      `Mensagem atual: ${draft.replyText}`,
      "Envie a alteração em texto e eu atualizo antes de enviar.",
    ].join("\n");
  }

  if (draft.kind === "google_event_import_batch") {
    return [
      "Rascunho de importação carregado.",
      "Para alterar o lote, o caminho mais seguro é reenviar o PDF ou o print com a agenda corrigida.",
      "Se quiser abortar o lote atual, use `cancelar rascunho`.",
    ].join("\n");
  }

  if (draft.kind === "autonomy_capability") {
    return [
      "Essa ação de autonomia não tem edição inline neste passo.",
      "Se quiser mudar o que ela vai fazer, me peça para refazer a sugestão ou gere uma nova revisão.",
    ].join("\n");
  }

  return "Rascunho carregado para edição. Envie a alteração em texto.";
}

export interface TelegramApprovalUiExecutionResult {
  ok: boolean;
  reply: string;
  rawResult?: unknown;
}

export interface TelegramApprovalUiHandlers {
  sendText(
    chatId: number,
    text: string,
    options?: {
      reply_to_message_id?: number;
      disable_web_page_preview?: boolean;
      reply_markup?: TelegramInlineKeyboardMarkup;
    },
  ): Promise<void>;
  executeDraft(draft: PendingActionDraft): Promise<TelegramApprovalUiExecutionResult>;
  onExecuted?(input: { chatId: number; draft: PendingActionDraft; rawResult?: unknown }): void | Promise<void>;
}

export class TelegramApprovalUi {
  constructor(
    private readonly allowedUserIds: number[],
    private readonly logger: Logger,
    private readonly api: TelegramApi,
    private readonly draftApprovalService: DraftApprovalService,
    private readonly handlers: TelegramApprovalUiHandlers,
  ) {}

  async handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
    const userId = callback.from.id;
    const userAllowed = this.allowedUserIds.includes(userId);
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

    const loaded = this.draftApprovalService.loadApprovalDraft(parsed.id, {
      expectedChatId: chatId,
      requirePending: true,
    });

    if (loaded.kind === "not_found" || loaded.kind === "chat_mismatch") {
      await this.api.answerCallbackQuery(callback.id, {
        text: "Aprovação não encontrada.",
      }).catch(() => undefined);
      return;
    }

    if (loaded.kind === "not_pending") {
      await this.api.answerCallbackQuery(callback.id, {
        text: "Essa aprovação já foi tratada.",
      }).catch(() => undefined);
      return;
    }

    if (loaded.kind === "invalid_draft") {
      this.draftApprovalService.updateApprovalStatus(loaded.approval.id, "failed");
      await this.api.answerCallbackQuery(callback.id, {
        text: "Rascunho inválido.",
        show_alert: true,
      }).catch(() => undefined);
      return;
    }

    const { approval, draft } = loaded;

    if (parsed.action === "discard") {
      this.draftApprovalService.updateApprovalStatus(approval.id, "discarded");
      this.draftApprovalService.clear(chatId);
      await this.api.answerCallbackQuery(callback.id, {
        text: "Rascunho descartado.",
      }).catch(() => undefined);
      await this.handlers.sendText(chatId, "Rascunho pendente descartado. Nenhuma ação foi executada.", {
        reply_to_message_id: callback.message?.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    if (parsed.action === "edit") {
      if (draft.kind === "youtube_publish" || draft.kind === "autonomy_capability") {
        await this.api.answerCallbackQuery(callback.id, {
          text: draft.kind === "youtube_publish"
            ? "Para ajustar o vídeo, gere um novo rascunho."
            : "Essa ação precisa ser refeita pela conversa.",
        }).catch(() => undefined);
        await this.handlers.sendText(
          chatId,
          draft.kind === "youtube_publish"
            ? [
                "A publicação do YouTube não tem edição inline neste MVP.",
                "Se quiser ajustar roteiro, título ou vídeo, gere um novo rascunho do item.",
              ].join("\n")
            : [
                "Essa ação de autonomia não tem edição inline neste passo.",
                "Se quiser mudar o que será executado, me peça para refazer a sugestão em linguagem natural.",
              ].join("\n"),
          {
            reply_to_message_id: callback.message?.message_id,
            disable_web_page_preview: true,
          },
        );
        return;
      }

      this.draftApprovalService.remember(chatId, draft);
      await this.api.answerCallbackQuery(callback.id, {
        text: "Envie a alteração em texto. Vou atualizar o rascunho.",
      }).catch(() => undefined);
      await this.handlers.sendText(chatId, buildEditPrompt(draft), {
        reply_to_message_id: callback.message?.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    await this.api.answerCallbackQuery(callback.id, {
      text: "Executando aprovação...",
    }).catch(() => undefined);

    try {
      const execution = await this.handlers.executeDraft(draft);
      this.draftApprovalService.updateApprovalStatus(approval.id, execution.ok ? "executed" : "failed");
      if (execution.ok) {
        await this.handlers.onExecuted?.({
          chatId,
          draft,
          rawResult: execution.rawResult,
        });
        this.draftApprovalService.clear(chatId);
      }

      await this.handlers.sendText(chatId, execution.reply, {
        reply_to_message_id: callback.message?.message_id,
        disable_web_page_preview: true,
      });
    } catch (error) {
      this.logger.error("Telegram approval callback execution failed", {
        chatId,
        approvalId: approval.id,
        action: parsed.action,
        error: error instanceof Error ? error.message : String(error),
      });
      this.draftApprovalService.updateApprovalStatus(approval.id, "failed");
      await this.handlers.sendText(
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
}
