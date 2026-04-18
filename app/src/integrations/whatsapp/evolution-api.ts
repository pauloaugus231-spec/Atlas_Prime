import type { WhatsAppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export interface EvolutionSendTextInput {
  instanceName?: string;
  number: string;
  text: string;
}

export interface EvolutionWebhookPayload {
  event?: string;
  instance?: string;
  data?: Record<string, unknown>;
  date_time?: string;
  sender?: string;
  apikey?: string;
  key?: Record<string, unknown>;
  pushName?: string;
  message?: Record<string, unknown>;
  messageType?: string;
  messages?: unknown[];
}

export interface EvolutionWebhookMessage {
  remoteJid?: string;
  pushName?: string;
  fromMe: boolean;
  text?: string;
  messageType?: string;
}

export interface EvolutionInstanceWebhookConfig {
  enabled: boolean;
  url: string;
  webhookByEvents: boolean;
  webhookBase64: boolean;
  events: string[];
}

export interface EvolutionRecentChatRecord {
  remoteJid: string;
  remoteJidAlt?: string;
  chatName?: string;
  senderName?: string;
  pushName?: string;
  updatedAt?: string;
  lastMessageText?: string;
  fromMe?: boolean;
  isGroup: boolean;
  isSystem: boolean;
  mentionedJids: string[];
}

function stripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D+/g, "");
}

function readStringLike(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function extractTextFromMessage(data: Record<string, unknown>): string | undefined {
  const message = data.message;
  if (!message || typeof message !== "object") {
    return undefined;
  }

  const record = message as Record<string, unknown>;
  const directConversation = typeof record.conversation === "string" ? record.conversation.trim() : "";
  if (directConversation) {
    return directConversation;
  }

  const candidates = [
    record.extendedTextMessage,
    record.imageMessage,
    record.videoMessage,
    record.documentMessage,
    record.audioMessage,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const candidateRecord = candidate as Record<string, unknown>;
    const text =
      (typeof candidateRecord.text === "string" && candidateRecord.text.trim()) ||
      (typeof candidateRecord.caption === "string" && candidateRecord.caption.trim()) ||
      (typeof candidateRecord.speechToText === "string" && candidateRecord.speechToText.trim());
    if (text) {
      return text;
    }
  }

  return undefined;
}

function extractTextFromAnyMessage(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  return extractTextFromMessage({ message: message as Record<string, unknown> });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function resolveWebhookEnvelope(payload: EvolutionWebhookPayload): Record<string, unknown> | undefined {
  const directPayload = asRecord(payload);
  const nestedData = asRecord(payload.data);
  if (nestedData) {
    return nestedData;
  }
  if (directPayload) {
    if (asRecord(directPayload.key) || asRecord(directPayload.message)) {
      return directPayload;
    }
    const directMessages = Array.isArray(directPayload.messages) ? directPayload.messages : undefined;
    if (directMessages?.length) {
      const firstMessage = asRecord(directMessages[0]);
      if (firstMessage) {
        return firstMessage;
      }
    }
  }
  return undefined;
}

function resolveWebhookRemoteJid(payload: EvolutionWebhookPayload): string | undefined {
  const envelope = resolveWebhookEnvelope(payload);
  const envelopeKey = asRecord(envelope?.key);
  const rootPayload = asRecord(payload);
  const rootKey = asRecord(rootPayload?.key);
  const nestedData = asRecord(rootPayload?.data);
  const nestedKey = asRecord(nestedData?.key);

  const candidates = [
    readStringLike(envelopeKey?.remoteJid),
    readStringLike(rootKey?.remoteJid),
    readStringLike(nestedKey?.remoteJid),
    readStringLike(rootPayload?.remoteJid),
    readStringLike(nestedData?.remoteJid),
    readStringLike(rootPayload?.sender),
    readStringLike(nestedData?.sender),
  ];

  return candidates.find(Boolean);
}

export function looksLikeEvolutionMessageWebhook(payload: EvolutionWebhookPayload): boolean {
  return Boolean(resolveWebhookEnvelope(payload));
}

export function parseEvolutionWebhookMessage(payload: EvolutionWebhookPayload): EvolutionWebhookMessage | null {
  const data = resolveWebhookEnvelope(payload);
  if (!data) {
    return null;
  }

  const keyRecord = asRecord(data.key);
  const remoteJid = resolveWebhookRemoteJid(payload);
  const fromMe = keyRecord?.fromMe === true;
  const pushName = readStringLike(data.pushName) ?? readStringLike(payload.pushName);
  const messageType = readStringLike(data.messageType) ?? readStringLike(payload.messageType);
  const text = extractTextFromMessage(data);

  return {
    remoteJid,
    pushName,
    fromMe,
    text,
    messageType,
  };
}

export function extractPhoneFromRemoteJid(remoteJid: string | undefined): string | undefined {
  if (!remoteJid) {
    return undefined;
  }
  const digits = normalizePhoneNumber(remoteJid);
  return digits || undefined;
}

export class EvolutionApiClient {
  constructor(
    private readonly config: WhatsAppConfig,
    private readonly logger: Logger,
  ) {}

  getStatus(): {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    apiUrl?: string;
    defaultInstanceName?: string;
    message: string;
  } {
    if (!this.config.enabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        apiUrl: this.config.apiUrl,
        defaultInstanceName: this.config.defaultInstanceName,
        message: "WhatsApp/Evolution desativado.",
      };
    }

    const configured = Boolean(this.config.apiUrl?.trim() && this.config.apiKey?.trim());
    return {
      enabled: true,
      configured,
      ready: configured,
      apiUrl: this.config.apiUrl,
      defaultInstanceName: this.config.defaultInstanceName,
      message: configured
        ? "WhatsApp/Evolution pronto."
        : "WhatsApp/Evolution habilitado, mas faltam EVOLUTION_API_URL e/ou EVOLUTION_API_KEY.",
    };
  }

  async sendText(input: EvolutionSendTextInput): Promise<Record<string, unknown>> {
    const status = this.getStatus();
    if (!status.ready || !this.config.apiUrl || !this.config.apiKey) {
      throw new Error(status.message);
    }

    const instanceName = input.instanceName?.trim() || this.config.defaultInstanceName?.trim();
    if (!instanceName) {
      throw new Error("Instância do WhatsApp não configurada. Defina EVOLUTION_INSTANCE_NAME ou informe no rascunho.");
    }

    const number = normalizePhoneNumber(input.number);
    if (!number) {
      throw new Error("Número do WhatsApp inválido para envio.");
    }

    const response = await fetch(
      `${stripTrailingSlashes(this.config.apiUrl)}/message/sendText/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.config.apiKey,
        },
        body: JSON.stringify({
          number,
          text: input.text.trim(),
        }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Evolution API sendText failed (${response.status}): ${details || response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    this.logger.info("WhatsApp message sent via Evolution", {
      instanceName,
      number,
    });
    return data;
  }

  async findWebhook(instanceName: string): Promise<Record<string, unknown> | null> {
    const status = this.getStatus();
    if (!status.ready || !this.config.apiUrl || !this.config.apiKey) {
      throw new Error(status.message);
    }

    const response = await fetch(
      `${stripTrailingSlashes(this.config.apiUrl)}/webhook/find/${encodeURIComponent(instanceName.trim())}`,
      {
        method: "GET",
        headers: {
          apikey: this.config.apiKey,
        },
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Evolution API findWebhook failed (${response.status}): ${details || response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown> | null;
    return data;
  }

  async setWebhook(instanceName: string, webhook: EvolutionInstanceWebhookConfig): Promise<Record<string, unknown>> {
    const status = this.getStatus();
    if (!status.ready || !this.config.apiUrl || !this.config.apiKey) {
      throw new Error(status.message);
    }

    const response = await fetch(
      `${stripTrailingSlashes(this.config.apiUrl)}/webhook/set/${encodeURIComponent(instanceName.trim())}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.config.apiKey,
        },
        body: JSON.stringify({ webhook }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Evolution API setWebhook failed (${response.status}): ${details || response.statusText}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }

  async ensureWebhook(instanceName: string, expected: EvolutionInstanceWebhookConfig): Promise<"unchanged" | "updated"> {
    const current = await this.findWebhook(instanceName);
    if (
      current &&
      current.enabled === expected.enabled &&
      current.url === expected.url &&
      current.webhookByEvents === expected.webhookByEvents &&
      current.webhookBase64 === expected.webhookBase64 &&
      JSON.stringify(current.events ?? []) === JSON.stringify(expected.events)
    ) {
      return "unchanged";
    }

    await this.setWebhook(instanceName, expected);
    return "updated";
  }

  async findChats(instanceName: string, limit = 10): Promise<EvolutionRecentChatRecord[]> {
    const status = this.getStatus();
    if (!status.ready || !this.config.apiUrl || !this.config.apiKey) {
      throw new Error(status.message);
    }

    const response = await fetch(
      `${stripTrailingSlashes(this.config.apiUrl)}/chat/findChats/${encodeURIComponent(instanceName.trim())}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.config.apiKey,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Evolution API findChats failed (${response.status}): ${details || response.statusText}`);
    }

    const data = (await response.json()) as Array<Record<string, unknown>>;
    return data
      .slice(0, Math.max(1, Math.min(50, Math.floor(limit))))
      .map((item) => {
        const lastMessage = item.lastMessage && typeof item.lastMessage === "object"
          ? item.lastMessage as Record<string, unknown>
          : undefined;
        const key = lastMessage?.key && typeof lastMessage.key === "object"
          ? lastMessage.key as Record<string, unknown>
          : undefined;
        const contextInfo = lastMessage?.contextInfo && typeof lastMessage.contextInfo === "object"
          ? lastMessage.contextInfo as Record<string, unknown>
          : undefined;
        const remoteJid = typeof item.remoteJid === "string" ? item.remoteJid : "";
        const mentionedJids = Array.isArray(contextInfo?.mentionedJid)
          ? contextInfo.mentionedJid.filter((value): value is string => typeof value === "string")
          : [];
        return {
          remoteJid,
          remoteJidAlt: typeof key?.remoteJidAlt === "string" ? key.remoteJidAlt : undefined,
          chatName: typeof item.pushName === "string" ? item.pushName : undefined,
          senderName: typeof lastMessage?.pushName === "string"
            ? lastMessage.pushName
            : typeof lastMessage?.participant === "string"
              ? lastMessage.participant
              : undefined,
          pushName: typeof item.pushName === "string"
            ? item.pushName
            : typeof lastMessage?.pushName === "string"
              ? lastMessage.pushName
              : undefined,
          updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
          lastMessageText: extractTextFromAnyMessage(lastMessage?.message),
          fromMe: key?.fromMe === true,
          isGroup: remoteJid.endsWith("@g.us"),
          isSystem: remoteJid === "status@broadcast" || remoteJid === "0@s.whatsapp.net",
          mentionedJids,
        };
      })
      .filter((item) => item.remoteJid);
  }
}
