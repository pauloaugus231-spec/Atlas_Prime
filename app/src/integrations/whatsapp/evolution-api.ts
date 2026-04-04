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
}

export interface EvolutionWebhookMessage {
  remoteJid?: string;
  pushName?: string;
  fromMe: boolean;
  text?: string;
  messageType?: string;
}

function stripTrailingSlashes(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizePhoneNumber(value: string): string {
  return value.replace(/\D+/g, "");
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

export function parseEvolutionWebhookMessage(payload: EvolutionWebhookPayload): EvolutionWebhookMessage | null {
  const data = payload.data;
  if (!data || typeof data !== "object") {
    return null;
  }

  const key = data.key;
  const keyRecord = key && typeof key === "object" ? (key as Record<string, unknown>) : undefined;
  const remoteJid = typeof keyRecord?.remoteJid === "string" ? keyRecord.remoteJid : undefined;
  const fromMe = keyRecord?.fromMe === true;
  const pushName = typeof data.pushName === "string" ? data.pushName : undefined;
  const messageType = typeof data.messageType === "string" ? data.messageType : undefined;
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
}
