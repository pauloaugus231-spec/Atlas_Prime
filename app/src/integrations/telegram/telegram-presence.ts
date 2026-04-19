import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ChatPresenceSession, type PresenceSession } from "../presence/chat-presence.js";
import type { TelegramApi } from "./telegram-api.js";

interface TelegramPresenceSessionOptions {
  config: AppConfig;
  logger: Logger;
  api: TelegramApi;
  chatId: number;
  flow?: string;
  progressText?: string;
  timeoutText?: string;
  sendProgress: (text: string) => Promise<void>;
}

export function createTelegramPresenceSession(
  options: TelegramPresenceSessionOptions,
): PresenceSession | undefined {
  if (!options.config.presence.enabled || !options.config.telegram.typingEnabled) {
    return undefined;
  }

  return new ChatPresenceSession({
    channel: "telegram",
    flow: options.flow,
    logger: options.logger.child({
      scope: "telegram-presence",
      channel: "telegram",
      chatId: options.chatId,
    }),
    config: options.config.presence,
    progressText: options.progressText,
    timeoutText: options.timeoutText,
    sendPresence: async () => {
      await options.api.sendChatAction(options.chatId, "typing");
    },
    sendProgress: options.sendProgress,
  });
}
