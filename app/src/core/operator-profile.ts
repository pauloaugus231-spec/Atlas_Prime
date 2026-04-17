import type {
  OperatorChannelBinding,
  OperatorConfig,
} from "../types/config.js";

function normalizeDigits(value: string | undefined | null): string {
  return (value ?? "").replace(/\D+/g, "");
}

export function listEnabledOperatorChannels(config: OperatorConfig): OperatorChannelBinding[] {
  return config.channels.filter((item) => item.enabled);
}

export function getPreferredAlertChannel(config: OperatorConfig): OperatorChannelBinding | undefined {
  const enabled = listEnabledOperatorChannels(config);
  if (!enabled.length) {
    return undefined;
  }

  if (config.preferredAlertChannelId) {
    const explicit = enabled.find((item) => item.channelId === config.preferredAlertChannelId);
    if (explicit) {
      return explicit;
    }
  }

  return enabled.find((item) => item.provider === "telegram")
    ?? enabled.find((item) => item.mode === "direct_operator")
    ?? enabled[0];
}

export function resolveIncomingWhatsAppChannel(
  config: OperatorConfig,
  input: {
    instanceName?: string;
    senderNumber?: string;
  },
): OperatorChannelBinding | undefined {
  const enabled = listEnabledOperatorChannels(config).filter((item) => item.provider === "whatsapp");
  const senderNumber = normalizeDigits(input.senderNumber);

  const direct = enabled.find((item) =>
    (item.mode === "direct_operator" || item.mode === "backup_operator")
      && normalizeDigits(item.externalId) === senderNumber
  );
  if (direct) {
    return direct;
  }

  const instanceName = input.instanceName?.trim();
  if (!instanceName) {
    return undefined;
  }

  return enabled.find((item) => item.mode === "monitored" && item.externalId === instanceName);
}

export function resolveTelegramOperatorChannel(
  config: OperatorConfig,
  chatId: number,
): OperatorChannelBinding | undefined {
  const target = String(chatId);
  return listEnabledOperatorChannels(config).find((item) =>
    item.provider === "telegram" && item.externalId === target,
  );
}
