import { getPreferredAlertChannel } from "../../core/operator-profile.js";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { TelegramApi } from "../telegram/telegram-api.js";
import type { EvolutionApiClient } from "../whatsapp/evolution-api.js";

export class OperatorAlertDispatcher {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly telegramApi?: TelegramApi,
    private readonly whatsappApi?: EvolutionApiClient,
  ) {}

  async sendToPreferredChannel(text: string): Promise<{
    ok: boolean;
    provider?: "telegram" | "whatsapp";
    channelId?: string;
    reason?: string;
  }> {
    const channel = getPreferredAlertChannel(this.config.operator);
    if (!channel) {
      return {
        ok: false,
        reason: "preferred_alert_channel_not_configured",
      };
    }

    if (channel.provider === "telegram") {
      if (!this.telegramApi) {
        return {
          ok: false,
          provider: "telegram",
          channelId: channel.channelId,
          reason: "telegram_api_not_available",
        };
      }

      await this.telegramApi.sendMessage(Number(channel.externalId), text, {
        disable_web_page_preview: true,
      });
      this.logger.info("Operator alert sent", {
        provider: "telegram",
        channelId: channel.channelId,
      });
      return {
        ok: true,
        provider: "telegram",
        channelId: channel.channelId,
      };
    }

    if (!this.whatsappApi) {
      return {
        ok: false,
        provider: "whatsapp",
        channelId: channel.channelId,
        reason: "whatsapp_api_not_available",
      };
    }

    const instanceName = channel.metadata?.instanceName?.trim() || this.config.whatsapp.defaultInstanceName?.trim();
    if (!instanceName) {
      return {
        ok: false,
        provider: "whatsapp",
        channelId: channel.channelId,
        reason: "whatsapp_instance_not_configured",
      };
    }

    await this.whatsappApi.sendText({
      instanceName,
      number: channel.externalId,
      text,
    });
    this.logger.info("Operator alert sent", {
      provider: "whatsapp",
      channelId: channel.channelId,
      instanceName,
    });
    return {
      ok: true,
      provider: "whatsapp",
      channelId: channel.channelId,
    };
  }
}
