import type { Logger } from "../../types/logger.js";
import { extractTelegramVoiceAttachment } from "../voice/telegram-voice.js";
import type { TelegramVoiceAttachment } from "../voice/voice-types.js";
import type {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramMessageEntity,
  TelegramUpdate,
  TelegramUser,
} from "./types.js";

export interface TelegramImportAttachment {
  fileId: string;
  fileName: string;
  mimeType: string;
  kind: "pdf" | "image";
}

interface TelegramRouteContext {
  allowedUserIds: number[];
}

interface TelegramBaseMessageRoute {
  bot: TelegramUser;
  message: TelegramMessage;
  userId: number;
}

export interface TelegramUnauthorizedRoute extends TelegramBaseMessageRoute {}

export interface TelegramUnsupportedRoute extends TelegramBaseMessageRoute {}

export interface TelegramCommandRoute extends TelegramBaseMessageRoute {
  command: "start" | "id" | "reset";
}

export interface TelegramTextRoute extends TelegramBaseMessageRoute {
  text: string;
  normalizedText: string;
}

export interface TelegramVoiceRoute extends TelegramBaseMessageRoute {
  attachment: TelegramVoiceAttachment;
}

export interface TelegramImportRoute extends TelegramBaseMessageRoute {
  attachment: TelegramImportAttachment;
  text?: string;
  normalizedText?: string;
}

export interface TelegramMessageRouterHandlers {
  onCallbackQuery(callback: TelegramCallbackQuery): Promise<void>;
  onUnauthorizedMessage(input: TelegramUnauthorizedRoute): Promise<void>;
  onUnsupportedMessage(input: TelegramUnsupportedRoute): Promise<void>;
  onCommand(input: TelegramCommandRoute): Promise<void>;
  onTextMessage(input: TelegramTextRoute): Promise<void>;
  onVoiceMessage(input: TelegramVoiceRoute): Promise<void>;
  onImportAttachment(input: TelegramImportRoute): Promise<void>;
}

export function normalizeTelegramText(text: string, botUsername?: string): string {
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

  const allEntities: TelegramMessageEntity[] = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
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

export class TelegramMessageRouter {
  constructor(
    private readonly logger: Logger,
    private readonly context: TelegramRouteContext,
    private readonly handlers: TelegramMessageRouterHandlers,
  ) {}

  async routeUpdate(update: TelegramUpdate, bot: TelegramUser): Promise<void> {
    if (update.callback_query) {
      this.logger.debug("Routing Telegram callback query", {
        callbackId: update.callback_query.id,
      });
      await this.handlers.onCallbackQuery(update.callback_query);
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
    if (!this.context.allowedUserIds.includes(userId)) {
      if (message.chat.type === "private") {
        this.logger.debug("Routing unauthorized Telegram message", {
          chatId: message.chat.id,
          userId,
        });
        await this.handlers.onUnauthorizedMessage({ bot, message, userId });
      }
      return;
    }

    const text = extractMessageText(message);
    const importAttachment = extractImportAttachment(message);
    const audioAttachment = importAttachment ? undefined : (text ? undefined : extractTelegramVoiceAttachment(message));

    if (!text && !audioAttachment && !importAttachment) {
      this.logger.debug("Routing unsupported Telegram message", {
        chatId: message.chat.id,
        userId,
      });
      await this.handlers.onUnsupportedMessage({ bot, message, userId });
      return;
    }

    if (text === "/start" || text === "/id" || text === "/reset") {
      this.logger.debug("Routing Telegram command", {
        chatId: message.chat.id,
        userId,
        command: text,
      });
      await this.handlers.onCommand({
        bot,
        message,
        userId,
        command: text.slice(1) as "start" | "id" | "reset",
      });
      return;
    }

    if (importAttachment) {
      const resolvedText = text?.trim();
      const normalizedText = resolvedText ? normalizeTelegramText(resolvedText, bot.username) : undefined;
      this.logger.debug("Routing Telegram import attachment", {
        chatId: message.chat.id,
        userId,
        kind: importAttachment.kind,
      });
      await this.handlers.onImportAttachment({
        bot,
        message,
        userId,
        text: resolvedText,
        normalizedText: normalizedText || undefined,
        attachment: importAttachment,
      });
      return;
    }

    if (!text && audioAttachment) {
      this.logger.debug("Routing Telegram voice message", {
        chatId: message.chat.id,
        userId,
        kind: audioAttachment.kind,
      });
      await this.handlers.onVoiceMessage({
        bot,
        message,
        userId,
        attachment: audioAttachment,
      });
      return;
    }

    const resolvedText = text?.trim();
    if (!resolvedText) {
      return;
    }
    const normalizedText = normalizeTelegramText(resolvedText, bot.username);
    if (!normalizedText) {
      return;
    }

    this.logger.debug("Routing Telegram text message", {
      chatId: message.chat.id,
      userId,
      textLength: resolvedText.length,
    });
    await this.handlers.onTextMessage({
      bot,
      message,
      userId,
      text: resolvedText,
      normalizedText,
    });
  }
}
