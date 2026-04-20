import { stripPendingDraftMarkers, type PendingActionDraft } from "../../core/draft-action-service.js";
import type { ApprovalInboxItemRecord } from "../../types/approval-inbox.js";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { normalizeVoiceTranscriptForTelegram } from "../../core/voice-semantic-normalizer.js";
import {
  refineScheduleImportEvents,
  type ScheduleImportCategory,
  type ScheduleImportIgnoredItem,
  type ScheduleImportMode,
} from "../../core/schedule-import-refinement.js";
import { matchPersonalCalendarTerms } from "../../core/calendar-relevance.js";
import type { PendingGoogleEventImportBatchDraft } from "../../core/google-draft-utils.js";
import { buildGoogleEventImportBatchDraftReply } from "../../core/google-draft-utils.js";
import { createVoiceMessageHandler, buildVoiceUserErrorMessage, type VoiceMessageHandler } from "../voice/voice-message-handler.js";
import { OpenAiScheduleImportService } from "../openai/schedule-import.js";
import type { TelegramApi } from "./telegram-api.js";
import type { PresenceSession } from "../presence/chat-presence.js";
import {
  normalizeTelegramText,
  type TelegramImportRoute,
  type TelegramVoiceRoute,
  type TelegramImportAttachment,
} from "./telegram-message-router.js";
import {
  buildVisualTaskFailureReply,
  buildVisualTaskState,
  buildVisualTaskStrategyReply,
  buildVisualTaskUnsupportedReply,
  detectVisualTaskPlan,
  markVisualTaskDraftReady,
  markVisualTaskExtractionFailed,
  shouldAttemptScheduleImport,
  type VisualTaskState,
} from "./visual-task-flow.js";
import { buildApprovalInlineKeyboard } from "./telegram-approval-ui.js";
import type { ChannelConversationTurn } from "../../core/channel-message-adapter.js";

export interface TelegramMediaFlowContinueConversationInput {
  message: TelegramVoiceRoute["message"];
  userId: number;
  resolvedText: string;
  normalizedText: string;
  audioInput: boolean;
}

export interface TelegramMediaFlowDependencies {
  sendText(
    chatId: number,
    text: string,
    options?: {
      reply_to_message_id?: number;
      disable_web_page_preview?: boolean;
      reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>> };
    },
  ): Promise<void>;
  beginTypingFeedback(
    chatId: number,
    options?: {
      flow?: string;
      replyToMessageId?: number;
      progressText?: string;
      fallbackText?: string;
    },
  ): PresenceSession | undefined;
  endTypingFeedback(chatId: number, session?: PresenceSession): Promise<void>;
  continueConversation(input: TelegramMediaFlowContinueConversationInput): Promise<void>;
  appendChatTurn(chatId: number, turn: { role: ChannelConversationTurn["role"]; text: string }): void;
  getPendingDraft(chatId: number): PendingActionDraft | undefined;
  replaceDraft(
    chatId: number,
    draft: PendingActionDraft,
    options?: { supersedeStatus?: "discarded" | "executed" | "failed" | "superseded" },
  ): ApprovalInboxItemRecord;
  clearDraft(chatId: number, status?: "discarded" | "executed" | "failed" | "superseded"): void;
  resolveScheduleImportAccountAlias(contextText?: string): string;
  getGoogleAccountConfig(accountAlias: string): { calendarId?: string; defaultTimezone?: string };
  resolvePreferredScheduleImportMode(): Promise<ScheduleImportMode | undefined>;
  resolveCalendarInterpretationRule(key: string): Promise<string | undefined>;
}

interface ScheduleImportLike {
  detectAgendaCandidateFromPdf(input: { pdf: Buffer; caption?: string }): Promise<{ confidence: number; signals: string[] }>;
  detectAgendaCandidateFromImage(input: { image: Buffer; mimeType: string; caption?: string }): Promise<{ confidence: number; signals: string[] }>;
  extractFromPdf(input: {
    pdf: Buffer;
    sourceLabel: string;
    caption?: string;
    currentDate: string;
    timezone: string;
  }): Promise<{
    events: Array<{
      summary: string;
      description?: string;
      location?: string;
      start: string;
      end: string;
      timezone: string;
      reminderMinutes: number;
      confidence?: number;
      sourceLabel?: string;
      category?: ScheduleImportCategory;
      rawText?: string;
      assumedTime?: boolean;
    }>;
    nonEvents: Array<{
      summary: string;
      category: ScheduleImportIgnoredItem["category"];
      reason?: string;
      date?: string;
      shift?: string;
      rawText?: string;
    }>;
    assumptions: string[];
    uncertainties: string[];
  }>;
  extractFromImage(input: {
    image: Buffer;
    mimeType: string;
    sourceLabel: string;
    caption?: string;
    currentDate: string;
    timezone: string;
  }): Promise<{
    events: Array<{
      summary: string;
      description?: string;
      location?: string;
      start: string;
      end: string;
      timezone: string;
      reminderMinutes: number;
      confidence?: number;
      sourceLabel?: string;
      category?: ScheduleImportCategory;
      rawText?: string;
      assumedTime?: boolean;
    }>;
    nonEvents: Array<{
      summary: string;
      category: ScheduleImportIgnoredItem["category"];
      reason?: string;
      date?: string;
      shift?: string;
      rawText?: string;
    }>;
    assumptions: string[];
    uncertainties: string[];
  }>;
}

export class TelegramMediaFlow {
  private readonly pendingVisualTasks = new Map<number, VisualTaskState>();
  private readonly voiceHandler?: VoiceMessageHandler;
  private readonly scheduleImport?: ScheduleImportLike;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly api: TelegramApi,
    private readonly deps: TelegramMediaFlowDependencies,
    options: {
      voiceHandler?: VoiceMessageHandler;
      scheduleImport?: ScheduleImportLike;
    } = {},
  ) {
    this.voiceHandler = options.voiceHandler ?? createVoiceMessageHandler(
      this.config,
      this.logger.child({ scope: "telegram-voice" }),
    );

    if (options.scheduleImport) {
      this.scheduleImport = options.scheduleImport;
    } else {
      const openai = this.config.llm.openai ?? (this.config.llm.provider === "openai" ? this.config.llm : undefined);
      if (openai?.apiKey) {
        this.scheduleImport = new OpenAiScheduleImportService(
          openai.apiKey,
          openai.baseUrl,
          openai.model,
          this.logger.child({ scope: "schedule-import" }),
        );
      }
    }
  }

  clearChatState(chatId: number): void {
    this.pendingVisualTasks.delete(chatId);
  }

  async handleVoiceMessage(input: TelegramVoiceRoute): Promise<void> {
    if (!this.voiceHandler) {
      await this.deps.sendText(
        input.message.chat.id,
        "O processamento de voz ainda não está ativo neste ambiente. Manda em texto por enquanto.",
        {
          reply_to_message_id: input.message.message_id,
        },
      );
      return;
    }

    let text: string | undefined;
    const typingSession = this.deps.beginTypingFeedback(input.message.chat.id, {
      flow: "voice_transcription",
      replyToMessageId: input.message.message_id,
      progressText: "Estou ouvindo esse áudio agora.",
      fallbackText: "Esse áudio está demorando mais do que deveria. Ainda estou tentando transcrever.",
    });
    try {
      const transcription = await this.voiceHandler.handleTelegramVoice({
        chatId: input.message.chat.id,
        userId: input.userId,
        attachment: input.attachment,
        telegram: this.api,
      });
      const voiceNormalization = normalizeVoiceTranscriptForTelegram(
        transcription.text,
        this.config.google.defaultTimezone,
      );
      text = voiceNormalization.text;
      this.logger.info("Telegram audio accepted as text input", {
        chatId: input.message.chat.id,
        userId: input.userId,
        kind: input.attachment.kind,
        provider: transcription.provider,
        model: transcription.model,
        sizeBytes: transcription.sizeBytes,
        semanticIntent: voiceNormalization.intentHint,
        normalized: voiceNormalization.changed,
        contextualReply: voiceNormalization.intentHint === "contextual_reply",
        hasEventDraftPreview: Boolean(voiceNormalization.eventDraftPreview),
        hasTaskDraftPreview: Boolean(voiceNormalization.taskDraftPreview),
      });
    } catch (error) {
      this.logger.warn("Telegram audio processing failed", {
        chatId: input.message.chat.id,
        userId: input.userId,
        kind: input.attachment.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      await this.deps.sendText(
        input.message.chat.id,
        buildVoiceUserErrorMessage(error),
        {
          reply_to_message_id: input.message.message_id,
          disable_web_page_preview: true,
        },
      );
      return;
    } finally {
      await this.deps.endTypingFeedback(input.message.chat.id, typingSession);
    }

    const resolvedText = text?.trim();
    if (!resolvedText) {
      return;
    }

    await this.deps.continueConversation({
      message: input.message,
      userId: input.userId,
      resolvedText,
      normalizedText: normalizeTelegramText(resolvedText, input.bot.username),
      audioInput: true,
    });
  }

  async handleImportAttachment(input: TelegramImportRoute): Promise<void> {
    await this.handleVisualDocumentAttachment(input.message, input.attachment, input.normalizedText);
  }

  private async downloadImportAttachmentBuffer(attachment: TelegramImportAttachment): Promise<Buffer> {
    const remoteFile = await this.api.getFile(attachment.fileId);
    if (!remoteFile.file_path) {
      throw new Error("Telegram não retornou file_path para o arquivo enviado.");
    }
    return this.api.downloadFile(remoteFile.file_path);
  }

  private async handleVisualDocumentAttachment(
    message: TelegramImportRoute["message"],
    attachment: TelegramImportAttachment,
    captionText?: string,
  ): Promise<void> {
    const previous = this.pendingVisualTasks.get(message.chat.id);
    let prefetchedBuffer: Buffer | undefined;
    let agendaEvidence:
      | {
          confidence: number;
          signals: string[];
        }
      | undefined;

    if (this.scheduleImport) {
      try {
        prefetchedBuffer = await this.downloadImportAttachmentBuffer(attachment);
        agendaEvidence = attachment.kind === "pdf"
          ? await this.scheduleImport.detectAgendaCandidateFromPdf({
              pdf: prefetchedBuffer,
              caption: captionText,
            })
          : await this.scheduleImport.detectAgendaCandidateFromImage({
              image: prefetchedBuffer,
              mimeType: attachment.mimeType,
              caption: captionText,
            });
      } catch (error) {
        this.logger.warn("Telegram visual agenda evidence detection failed", {
          chatId: message.chat.id,
          attachmentKind: attachment.kind,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const plan = detectVisualTaskPlan({
      text: captionText,
      attachmentKind: attachment.kind,
      previous,
      agendaEvidence,
    });
    const state = buildVisualTaskState({
      previous,
      plan,
      attachment,
    });
    this.pendingVisualTasks.set(message.chat.id, state);

    this.logger.info("Telegram visual/document task detected", {
      chatId: message.chat.id,
      kind: state.kind,
      fileCount: state.files.length,
      attachmentKind: attachment.kind,
      shouldAttemptExtraction: plan.shouldAttemptExtraction,
      agendaSignalConfidence: agendaEvidence?.confidence,
      agendaSignals: agendaEvidence?.signals,
    });

    const strategyReply = buildVisualTaskStrategyReply(state, plan);
    if (plan.shortClarification) {
      await this.deps.sendText(message.chat.id, strategyReply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
    }
    if (!shouldAttemptScheduleImport(plan)) {
      const reply = [
        strategyReply,
        "",
        buildVisualTaskUnsupportedReply(state, plan),
      ].join("\n");
      this.deps.appendChatTurn(message.chat.id, {
        role: "user",
        text: captionText?.trim() ? `[visual] ${captionText.trim()}` : `[visual] ${attachment.fileName}`,
      });
      this.deps.appendChatTurn(message.chat.id, {
        role: "assistant",
        text: reply,
      });
      await this.deps.sendText(message.chat.id, reply, {
        reply_to_message_id: message.message_id,
        disable_web_page_preview: true,
      });
      return;
    }

    await this.deps.sendText(message.chat.id, strategyReply, {
      reply_to_message_id: message.message_id,
      disable_web_page_preview: true,
    });
    await this.handleScheduleImportAttachment(message, attachment, captionText, {
      visualTask: state,
      skipInitialReply: true,
      prefetchedBuffer,
    });
  }

  private async handleScheduleImportAttachment(
    message: TelegramImportRoute["message"],
    attachment: TelegramImportAttachment,
    captionText?: string,
    options: {
      visualTask?: VisualTaskState;
      skipInitialReply?: boolean;
      prefetchedBuffer?: Buffer;
    } = {},
  ): Promise<void> {
    if (!this.scheduleImport) {
      if (options.visualTask) {
        const failedState = markVisualTaskExtractionFailed(
          options.visualTask,
          "a extração automática de agenda depende de um provider OpenAI ativo com chave configurada",
        );
        this.pendingVisualTasks.set(message.chat.id, failedState);
        await this.deps.sendText(message.chat.id, buildVisualTaskFailureReply(failedState), {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        });
        return;
      }
      await this.deps.sendText(
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
      const accountAlias = this.deps.resolveScheduleImportAccountAlias(captionText);
      const accountConfig = this.deps.getGoogleAccountConfig(accountAlias);
      const timezone = accountConfig.defaultTimezone || this.config.google.defaultTimezone;
      if (!options.skipInitialReply) {
        await this.deps.sendText(
          message.chat.id,
          [
            "Vou tentar extrair os eventos desse material de agenda.",
            `- Arquivo: ${attachment.fileName}`,
            `- Calendário alvo: ${accountAlias}`,
            "Se a leitura falhar, continuo com esta tarefa e te digo o melhor próximo formato.",
          ].join("\n"),
          {
            reply_to_message_id: message.message_id,
            disable_web_page_preview: true,
          },
        );
      }
      const typingSession = this.deps.beginTypingFeedback(message.chat.id, {
        flow: "visual_schedule_import",
        replyToMessageId: message.message_id,
        progressText: "Estou lendo esse material agora.",
        fallbackText: "Esse material está demorando mais do que deveria. Ainda estou tentando extrair o que der.",
      });
      try {
        const buffer = options.prefetchedBuffer ?? await this.downloadImportAttachmentBuffer(attachment);
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
              category: event.category,
              rawText: event.rawText,
              assumedTime: event.assumedTime,
              personallyRelevant: matchedTerms.length > 0,
              matchedTerms,
            };
          })
          .sort((left, right) => left.start.localeCompare(right.start));

        if (events.length === 0) {
          throw new Error("Não consegui identificar eventos válidos para importar.");
        }

        const existingDraft = this.deps.getPendingDraft(message.chat.id);
        const previousImport = existingDraft?.kind === "google_event_import_batch" && existingDraft.account === accountAlias
          ? existingDraft
          : undefined;
        const extractedNonEvents: ScheduleImportIgnoredItem[] = extracted.nonEvents.map((item) => ({
          summary: item.summary,
          category: item.category,
          reason: item.reason ?? "bloco não importado como evento",
          date: item.date,
          shift: item.shift,
          sourceLabel: item.rawText,
        }));
        const previousCandidates = previousImport?.allImportableEvents ?? previousImport?.events ?? [];
        const mergedEvents = [
          ...previousCandidates.map((event) => ({
            ...event,
            category: event.importCategory ?? ("event_importable" as const),
          })),
          ...events,
        ];
        const dedupedEvents = Array.from(
          new Map(
            mergedEvents.map((event) => [
              `${event.start}|${event.end}|${event.summary.trim().toLowerCase()}`,
              event,
            ]),
          ).values(),
        ).sort((left, right) => left.start.localeCompare(right.start));
        const ignoredItems = Array.from(
          new Map(
            [
              ...(previousImport?.ignoredItems ?? []),
              ...extractedNonEvents,
            ].map((item) => [
              `${item.category}|${item.shift ?? ""}|${item.summary.trim().toLowerCase()}`,
              item,
            ]),
          ).values(),
        );
        const assumptions = [
          ...(previousImport?.assumptions ?? []),
          ...extracted.assumptions,
          ...extracted.uncertainties.map((item) => `incerteza: ${item}`),
        ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 8);
        const preferredMode = previousImport?.importMode ?? await this.deps.resolvePreferredScheduleImportMode();
        const pseudoLocationRule = await this.deps.resolveCalendarInterpretationRule("pseudo_location_rua");
        const titleSeparatorRule = await this.deps.resolveCalendarInterpretationRule("title_separator_preference");
        const refinedImport = refineScheduleImportEvents(dedupedEvents, {
          mode: preferredMode,
          nonEvents: ignoredItems,
          assumptions,
        });
        if (
          pseudoLocationRule === "drop_location"
          && dedupedEvents.some((event) => /^(?:rua|na rua)$/i.test((event.location ?? "").trim()))
        ) {
          this.logger.info("Applying learned calendar interpretation rule during schedule import", {
            chatId: message.chat.id,
            rule: "pseudo_location_rua",
          });
          refinedImport.observations = [
            'Regra aprendida aplicada: "Rua" continua fora do campo local.',
            ...refinedImport.observations,
          ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 10);
        }
        if (
          titleSeparatorRule === "prefer_dash_separator"
          && refinedImport.allImportableEvents.some((event) => (event.originalSummary ?? "").includes(":"))
        ) {
          this.logger.info("Applying learned calendar interpretation rule during schedule import", {
            chatId: message.chat.id,
            rule: "title_separator_preference",
          });
          refinedImport.observations = [
            "Regra aprendida aplicada: títulos compostos seguem com separador em traço.",
            ...refinedImport.observations,
          ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 10);
        }

        const draft: PendingGoogleEventImportBatchDraft = {
          kind: "google_event_import_batch",
          timezone,
          account: accountAlias,
          calendarId: accountConfig.calendarId,
          sourceLabel: previousImport
            ? `${previousImport.sourceLabel}; ${attachment.fileName}`
            : attachment.fileName,
          totalExtracted: refinedImport.blockCounts.total,
          relevantCount: refinedImport.selectedEvents.filter((event) => event.personallyRelevant || event.relevanceLevel === "high").length,
          skippedCount: refinedImport.ignoredItems.length + Math.max(0, refinedImport.allImportableEvents.length - refinedImport.selectedEvents.length),
          assumptions: refinedImport.observations,
          importMode: refinedImport.mode,
          allImportableEvents: refinedImport.allImportableEvents,
          ignoredItems: refinedImport.ignoredItems,
          demands: refinedImport.demands,
          ambiguousItems: refinedImport.ambiguousItems,
          blockCounts: refinedImport.blockCounts,
          modeCounts: refinedImport.modeCounts,
          events: refinedImport.selectedEvents,
        };

        const approval = this.deps.replaceDraft(message.chat.id, draft, {
          supersedeStatus: "superseded",
        });
        if (options.visualTask) {
          this.pendingVisualTasks.set(message.chat.id, markVisualTaskDraftReady(options.visualTask));
        }
        const visibleReply = stripPendingDraftMarkers(buildGoogleEventImportBatchDraftReply(draft));

        await this.deps.endTypingFeedback(message.chat.id, typingSession);
        this.deps.appendChatTurn(message.chat.id, {
          role: "user",
          text: captionText?.trim() ? `[agenda_anexo] ${captionText.trim()}` : `[agenda_anexo] ${attachment.fileName}`,
        });
        this.deps.appendChatTurn(message.chat.id, {
          role: "assistant",
          text: visibleReply,
        });

        await this.deps.sendText(message.chat.id, visibleReply, {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
          reply_markup: approval ? buildApprovalInlineKeyboard(approval.id) : undefined,
        });
      } finally {
        await this.deps.endTypingFeedback(message.chat.id, typingSession);
      }
    } catch (error) {
      this.logger.error("Telegram schedule import failed", {
        chatId: message.chat.id,
        fileName: attachment.fileName,
        kind: attachment.kind,
        error: error instanceof Error ? error.message : String(error),
      });
      if (options.visualTask) {
        const failedState = markVisualTaskExtractionFailed(
          options.visualTask,
          error instanceof Error ? error.message : String(error),
        );
        this.pendingVisualTasks.set(message.chat.id, failedState);
        const reply = buildVisualTaskFailureReply(failedState);
        this.deps.appendChatTurn(message.chat.id, {
          role: "user",
          text: captionText?.trim() ? `[agenda_visual] ${captionText.trim()}` : `[agenda_visual] ${attachment.fileName}`,
        });
        this.deps.appendChatTurn(message.chat.id, {
          role: "assistant",
          text: reply,
        });
        await this.deps.sendText(message.chat.id, reply, {
          reply_to_message_id: message.message_id,
          disable_web_page_preview: true,
        });
        return;
      }
      await this.deps.sendText(
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
}
