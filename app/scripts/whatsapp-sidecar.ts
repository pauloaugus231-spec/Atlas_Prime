import http from "node:http";
import { createAgentCore } from "../src/core/create-agent-core.js";
import { resolveIncomingWhatsAppChannel } from "../src/core/operator-profile.js";
import { describeWhatsAppRoute, resolveWhatsAppInboundMode } from "../src/core/whatsapp-routing.js";
import { OperatorAlertDispatcher } from "../src/integrations/operator/operator-alert-dispatcher.js";
import { TelegramApi } from "../src/integrations/telegram/telegram-api.js";
import {
  EvolutionApiClient,
  extractPhoneFromRemoteJid,
  parseEvolutionWebhookMessage,
  type EvolutionWebhookPayload,
} from "../src/integrations/whatsapp/evolution-api.js";
import { WhatsAppConversationService } from "../src/integrations/whatsapp/whatsapp-conversation-service.js";
import { WhatsAppMonitorService } from "../src/integrations/whatsapp/whatsapp-monitor-service.js";
import type { AppConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function isSupportedWebhookEvent(event: string | undefined): boolean {
  const normalized = (event ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, ".");
  return normalized === "messages.upsert";
}

async function ensureConfiguredWebhooks(
  evolution: EvolutionApiClient,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  const instanceNames = Array.from(
    new Set([
      config.whatsapp.defaultInstanceName?.trim(),
      ...Object.keys(config.whatsapp.instanceAccounts),
    ].filter((value): value is string => Boolean(value && value.trim()))),
  );

  if (instanceNames.length === 0) {
    return;
  }

  const expectedWebhook = {
    enabled: true,
    url: `http://whatsapp-sidecar:${config.whatsapp.sidecarPort}${config.whatsapp.webhookPath}`,
    webhookByEvents: false,
    webhookBase64: false,
    events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
  } as const;

  for (const instanceName of instanceNames) {
    try {
      const status = await evolution.ensureWebhook(instanceName, expectedWebhook);
      logger.info("WhatsApp webhook ensured", {
        instanceName,
        status,
        url: expectedWebhook.url,
      });
    } catch (error) {
      logger.warn("WhatsApp webhook ensure failed", {
        instanceName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function main(): Promise<void> {
  const {
    config,
    logger,
    core,
    client,
    approvals,
    communicationRouter,
    contacts,
    whatsappMessages,
  } = await createAgentCore();

  const evolution = new EvolutionApiClient(
    config.whatsapp,
    logger.child({ scope: "whatsapp-evolution" }),
  );
  const status = evolution.getStatus();
  if (!config.whatsapp.sidecarEnabled) {
    throw new Error("WHATSAPP_SIDECAR_ENABLED=false. Ative para subir o sidecar.");
  }
  if (!status.ready) {
    throw new Error(status.message);
  }

  const telegramChatId = config.whatsapp.notifyTelegramChatId ?? config.telegram.allowedUserIds[0];
  const telegramApi = config.telegram.botToken ? new TelegramApi(config.telegram.botToken) : undefined;
  const webhookPath = config.whatsapp.webhookPath;
  const monitoringCanHappen = !config.whatsapp.conversationEnabled || config.whatsapp.unauthorizedMode === "monitor";
  if (!telegramChatId && monitoringCanHappen) {
    throw new Error("Nenhum chat do Telegram configurado para receber monitoramento/aprovações de WhatsApp.");
  }
  if (
    config.whatsapp.conversationEnabled &&
    config.whatsapp.unauthorizedMode === "monitor" &&
    config.whatsapp.allowedNumbers.length === 0
  ) {
    logger.warn("WhatsApp hybrid mode enabled without operator numbers", {
      unauthorizedMode: config.whatsapp.unauthorizedMode,
    });
  }
  const conversation = new WhatsAppConversationService(
    config,
    logger.child({ scope: "whatsapp-conversation" }),
    core,
    evolution,
    whatsappMessages,
  );
  const alertDispatcher = new OperatorAlertDispatcher(
    config,
    logger.child({ scope: "operator-alerts" }),
    telegramApi,
    evolution,
  );
  const monitor = new WhatsAppMonitorService(
    config,
    logger.child({ scope: "whatsapp-monitor" }),
    approvals,
    contacts,
    communicationRouter,
    whatsappMessages,
    client,
    alertDispatcher,
  );

  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method !== "POST" || !request.url || !request.url.startsWith(webhookPath)) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, message: "not found" }));
      return;
    }

    try {
      const payload = (await readJsonBody(request)) as EvolutionWebhookPayload;
      if (payload.apikey && config.whatsapp.apiKey && payload.apikey !== config.whatsapp.apiKey) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "invalid apikey" }));
        return;
      }

      if (!isSupportedWebhookEvent(payload.event)) {
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, ignored: true, reason: "event_not_supported" }));
        return;
      }

      const message = parseEvolutionWebhookMessage(payload);
      if (!message || message.fromMe || !message.remoteJid) {
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, ignored: true, reason: "empty_or_outbound" }));
        return;
      }

      const number = extractPhoneFromRemoteJid(message.remoteJid);
      const inboundText = message.text?.trim();
      if (!number || !inboundText) {
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, ignored: true, reason: "no_text_payload" }));
        return;
      }
      const route = describeWhatsAppRoute(config.whatsapp, {
        instanceName: payload.instance ?? config.whatsapp.defaultInstanceName,
        text: inboundText,
      });
      const operatorChannel = resolveIncomingWhatsAppChannel(config.operator, {
        instanceName: route.instanceName,
        senderNumber: number,
      });
      const inboundMode = operatorChannel?.mode === "monitored"
        ? "monitor"
        : operatorChannel && (operatorChannel.mode === "direct_operator" || operatorChannel.mode === "backup_operator")
          ? "conversation"
          : resolveWhatsAppInboundMode(config.whatsapp, { number });
      logger.info("WhatsApp inbound routed", {
        instanceName: route.instanceName,
        account: route.accountAlias,
        number,
        inboundMode,
        operatorChannelId: operatorChannel?.channelId,
      });

      if (inboundMode === "conversation") {
        const result = await conversation.handleInboundText({
          instanceName: route.instanceName,
          remoteJid: message.remoteJid,
          number,
          pushName: message.pushName,
          text: inboundText,
          createdAt: payload.date_time,
        });
        response.writeHead(result.ignored ? 202 : 200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
        return;
      }

      if (inboundMode === "ignore") {
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, ignored: true, reason: "unauthorized_number" }));
        return;
      }

      if (!telegramChatId) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, message: "telegram approval chat not configured" }));
        return;
      }
      const monitored = await monitor.handleInboundText({
        instanceName: route.instanceName,
        accountAlias: route.accountAlias,
        remoteJid: message.remoteJid,
        number,
        pushName: message.pushName,
        text: inboundText,
        createdAt: payload.date_time,
      });
      response.writeHead(monitored.ignored ? 202 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(monitored));
    } catch (error) {
      logger.error("WhatsApp sidecar webhook failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.whatsapp.sidecarPort, "0.0.0.0", () => {
      logger.info("WhatsApp sidecar ready", {
        port: config.whatsapp.sidecarPort,
        webhookPath,
        notifyChatId: telegramChatId,
      });
      resolve();
    });
  });

  await ensureConfiguredWebhooks(evolution, config, logger);
  const webhookEnsureInterval = setInterval(() => {
    void ensureConfiguredWebhooks(evolution, config, logger);
  }, 2 * 60 * 1000);
  webhookEnsureInterval.unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
