import http from "node:http";
import { createAgentCore } from "../src/core/create-agent-core.js";
import {
  buildEventDraftFromPrompt,
  formatDraftDateTime,
  type PendingGoogleEventDraft,
} from "../src/core/google-draft-utils.js";
import { matchPersonalCalendarTerms } from "../src/core/calendar-relevance.js";
import { describeWhatsAppRoute } from "../src/core/whatsapp-routing.js";
import { TelegramApi } from "../src/integrations/telegram/telegram-api.js";
import {
  EvolutionApiClient,
  extractPhoneFromRemoteJid,
  parseEvolutionWebhookMessage,
  type EvolutionWebhookPayload,
} from "../src/integrations/whatsapp/evolution-api.js";
import type { AppConfig } from "../src/types/config.js";

type PendingWhatsAppReplyDraft = {
  kind: "whatsapp_reply";
  instanceName?: string;
  account?: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  inboundText: string;
  replyText: string;
  relationship?: string;
  persona?: string;
};

function buildApprovalInlineKeyboard(id: number) {
  return {
    inline_keyboard: [[
      { text: "Enviar", callback_data: `approval:send:${id}` },
      { text: "Editar", callback_data: `approval:edit:${id}` },
      { text: "Ignorar", callback_data: `approval:discard:${id}` },
    ]],
  };
}

function normalizeDraftText(value: string): string {
  return value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReplyCandidate(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/rascunho(?: de resposta)?:\s*([\s\S]*)$/i);
  if (match?.[1]?.trim()) {
    return normalizeDraftText(match[1]);
  }
  return normalizeDraftText(trimmed);
}

function buildWhatsAppDraftPrompt(input: {
  pushName?: string;
  number: string;
  text: string;
  relationship: string;
  persona: string;
  actionPolicy: string;
}): string {
  return [
    "Você está preparando um rascunho curto de resposta para WhatsApp.",
    "Não explique seu raciocínio. Não use markdown. Não diga que vai enviar.",
    "Adapte o tom à persona e à relação.",
    `Relação: ${input.relationship}`,
    `Persona: ${input.persona}`,
    `Política: ${input.actionPolicy}`,
    `Contato: ${input.pushName ?? input.number}`,
    `Mensagem recebida: ${input.text}`,
    "Responda apenas com o texto final sugerido para envio.",
  ].join("\n");
}

function getGoogleAccountConfig(config: AppConfig, accountAlias: string) {
  return accountAlias === "primary"
    ? config.google
    : (config.googleAccounts[accountAlias] ?? config.google);
}

function parseEventTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function findCalendarConflicts(
  events: Array<{ summary: string; start: string | null; end: string | null }>,
  draft: PendingGoogleEventDraft,
): Array<{ summary: string; start: string | null; end: string | null }> {
  const draftStart = parseEventTime(draft.start);
  const draftEnd = parseEventTime(draft.end);
  if (draftStart == null || draftEnd == null) {
    return [];
  }

  return events.filter((event) => {
    const eventStart = parseEventTime(event.start);
    const eventEnd = parseEventTime(event.end);
    if (eventStart == null || eventEnd == null) {
      return false;
    }
    return draftStart < eventEnd && draftEnd > eventStart;
  });
}

function buildCalendarSuggestionMessage(input: {
  draft: PendingGoogleEventDraft;
  accountAlias: string;
  instanceName?: string;
  pushName?: string;
  number: string;
  inboundText: string;
  conflicts: Array<{ summary: string; start: string | null; end: string | null }>;
  personallyRelevant: boolean;
}): string {
  return [
    "Possível compromisso detectado no WhatsApp.",
    `- Contato: ${input.pushName ?? input.number}`,
    `- Conta operacional: ${input.accountAlias}`,
    ...(input.instanceName ? [`- Instância: ${input.instanceName}`] : []),
    `- Título: ${input.draft.summary}`,
    `- Início: ${formatDraftDateTime(input.draft.start, input.draft.timezone) ?? input.draft.start}`,
    `- Fim: ${formatDraftDateTime(input.draft.end, input.draft.timezone) ?? input.draft.end}`,
    ...(input.draft.location ? [`- Local: ${input.draft.location}`] : []),
    `- Relevante para você: ${input.personallyRelevant ? "sim" : "não"}`,
    ...(input.conflicts.length
      ? [
          `- Conflitos detectados: ${input.conflicts.length}`,
          ...input.conflicts.slice(0, 3).map((event) =>
            `  - ${event.summary} | ${formatDraftDateTime(event.start ?? undefined, input.draft.timezone) ?? event.start ?? "sem horário"}`
          ),
        ]
      : ["- Conflitos detectados: 0"]),
    "",
    `Mensagem recebida: ${input.inboundText}`,
    "",
    "Se fizer sentido, confirme com `Agendar` ou ajuste antes de aprovar.",
  ].join("\n");
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

async function main(): Promise<void> {
  const {
    config,
    logger,
    client,
    approvals,
    communicationRouter,
    contacts,
    whatsappMessages,
    googleWorkspaces,
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
  if (!telegramChatId) {
    throw new Error("Nenhum chat do Telegram configurado para receber aprovações de WhatsApp.");
  }

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

      if (payload.event !== "messages.upsert") {
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

      whatsappMessages.saveMessage({
        instanceName: route.instanceName,
        remoteJid: message.remoteJid,
        number,
        pushName: message.pushName,
        direction: "inbound",
        text: inboundText,
        createdAt: payload.date_time,
      });

      const classification = communicationRouter.classify({
        channel: "whatsapp",
        identifier: number,
        displayName: message.pushName,
        text: inboundText,
      });

      contacts.upsertContact({
        channel: "whatsapp",
        identifier: number,
        displayName: message.pushName ?? number,
        relationship: classification.relationship,
        persona: classification.persona,
        priority: classification.priority,
        tags: [
          `account:${route.accountAlias}`,
          ...(route.instanceName ? [`instance:${route.instanceName}`] : []),
        ],
        source: "whatsapp_sidecar",
      });

      if (classification.actionPolicy === "ignore") {
        response.writeHead(202, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, ignored: true, reason: "router_ignore" }));
        return;
      }

      const llm = await client.chat({
        messages: [
          {
            role: "system",
            content: "Você é o roteador de respostas do Atlas para WhatsApp. Gere somente o texto final sugerido.",
          },
          {
            role: "user",
            content: buildWhatsAppDraftPrompt({
              pushName: message.pushName,
              number,
              text: inboundText,
              relationship: classification.relationship,
              persona: classification.persona,
              actionPolicy: classification.actionPolicy,
            }),
          },
        ],
      });

      const draft: PendingWhatsAppReplyDraft = {
        kind: "whatsapp_reply",
        instanceName: route.instanceName,
        account: route.accountAlias,
        remoteJid: message.remoteJid,
        number,
        pushName: message.pushName,
        inboundText,
        replyText: extractReplyCandidate(llm.message.content),
        relationship: classification.relationship,
        persona: classification.persona,
      };

      const approval = approvals.createPending({
        chatId: telegramChatId,
        channel: "whatsapp",
        actionKind: draft.kind,
        subject: `WhatsApp ${route.accountAlias}: ${message.pushName ?? number}`,
        draftPayload: JSON.stringify(draft),
      });

      if (telegramApi) {
        await telegramApi.sendMessage(
          telegramChatId,
          [
            "Nova triagem WhatsApp.",
            `- Contato: ${message.pushName ?? number}`,
            `- Número: ${number}`,
            `- Conta operacional: ${route.accountAlias}`,
            ...(route.instanceName ? [`- Instância: ${route.instanceName}`] : []),
            `- Relação: ${classification.relationship}`,
            `- Persona: ${classification.persona}`,
            `- Política: ${classification.actionPolicy}`,
            `- Mensagem recebida: ${inboundText}`,
            "",
            "Rascunho sugerido:",
            draft.replyText,
          ].join("\n"),
          {
            disable_web_page_preview: true,
            reply_markup: buildApprovalInlineKeyboard(approval.id),
          },
        );
      }

      try {
        const googleAccountConfig = getGoogleAccountConfig(config, route.accountAlias);
        const eventDraftResult = buildEventDraftFromPrompt(inboundText, googleAccountConfig.defaultTimezone);
        if (eventDraftResult.draft) {
          const calendarDraft: PendingGoogleEventDraft = {
            ...eventDraftResult.draft,
            account: route.accountAlias,
            calendarId: googleAccountConfig.calendarId,
          };
          const conflicts = findCalendarConflicts(
            await googleWorkspaces.getWorkspace(route.accountAlias).listEventsInWindow({
              timeMin: calendarDraft.start,
              timeMax: calendarDraft.end,
              maxResults: 5,
              calendarId: googleAccountConfig.calendarId,
            }),
            calendarDraft,
          );
          const personallyRelevant = matchPersonalCalendarTerms({
            account: route.accountAlias,
            summary: calendarDraft.summary,
            description: calendarDraft.description,
            location: calendarDraft.location,
          }).length > 0;

          const eventApproval = approvals.createPending({
            chatId: telegramChatId,
            channel: "whatsapp",
            actionKind: calendarDraft.kind,
            subject: `Agenda ${route.accountAlias}: ${calendarDraft.summary}`,
            draftPayload: JSON.stringify(calendarDraft),
          });

          if (telegramApi) {
            await telegramApi.sendMessage(
              telegramChatId,
              buildCalendarSuggestionMessage({
                draft: calendarDraft,
                accountAlias: route.accountAlias,
                instanceName: route.instanceName,
                pushName: message.pushName,
                number,
                inboundText,
                conflicts,
                personallyRelevant,
              }),
              {
                disable_web_page_preview: true,
                reply_markup: buildApprovalInlineKeyboard(eventApproval.id),
              },
            );
          }
        }
      } catch (error) {
        logger.warn("WhatsApp sidecar could not prepare calendar suggestion", {
          account: route.accountAlias,
          instanceName: route.instanceName,
          number,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, approvalId: approval.id }));
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
