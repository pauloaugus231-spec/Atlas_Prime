import {
  buildMonitoredChannelAlertReply,
  buildMonitoredChannelAlertSummaryReply,
  classifyMonitoredWhatsAppMessage,
  resolveMonitoredAlertReplyAction,
  type PendingMonitoredChannelAlertDraft,
} from "../src/core/monitored-channel-alerts.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import { resolveIncomingWhatsAppChannel } from "../src/core/operator-profile.js";
import {
  looksLikeEvolutionMessageWebhook,
  parseEvolutionWebhookMessage,
  type EvolutionWebhookPayload,
} from "../src/integrations/whatsapp/evolution-api.js";
import { WhatsAppMonitorService } from "../src/integrations/whatsapp/whatsapp-monitor-service.js";
import type { AppConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(condition: boolean, name: string, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function makeConfig(): AppConfig {
  return {
    telegram: {
      botToken: "token",
      allowedUserIds: [123],
      pollTimeoutSeconds: 30,
      morningBriefEnabled: true,
      dailyEditorialAutomationEnabled: false,
      operationalModeHours: 18,
    },
    operator: {
      operatorId: "paulo",
      name: "Paulo",
      preferredAlertChannelId: "telegram_operator",
      channels: [
        {
          channelId: "telegram_operator",
          operatorId: "paulo",
          provider: "telegram",
          externalId: "123",
          mode: "backup_operator",
          enabled: true,
          displayName: "Telegram operador",
        },
        {
          channelId: "whatsapp_monitored_atlas_institucional",
          operatorId: "paulo",
          provider: "whatsapp",
          externalId: "atlas_institucional",
          mode: "monitored",
          enabled: true,
          displayName: "WhatsApp institucional",
        },
      ],
    },
    whatsapp: {
      enabled: true,
      apiUrl: "http://evolution-api:8080",
      apiKey: "test",
      defaultInstanceName: "atlas_institucional",
      defaultAccountAlias: "abordagem",
      instanceAccounts: { atlas_institucional: "abordagem" },
      sidecarEnabled: true,
      conversationEnabled: false,
      allowedNumbers: [],
      unauthorizedMode: "ignore",
      ignoreGroups: true,
      sidecarPort: 8790,
      webhookPath: "/webhooks/evolution",
      notifyTelegramChatId: 123,
    },
    google: {
      calendarId: "primary",
      defaultTimezone: "America/Sao_Paulo",
    },
    googleAccounts: {},
  } as unknown as AppConfig;
}

function makeApprovals() {
  const items: Array<Record<string, unknown>> = [];
  return {
    items,
    createPending(input: Record<string, unknown>) {
      const record = { id: items.length + 1, ...input };
      items.push(record);
      return record;
    },
  };
}

function makeContacts() {
  return {
    upsertContact: () => undefined,
  };
}

function makeRouter() {
  return {
    classify() {
      return {
        relationship: "operacional",
        persona: "direto",
        priority: "medium",
        actionPolicy: "reply",
      };
    },
  };
}

function makeMessages() {
  const messages: Array<Record<string, unknown>> = [];
  return {
    messages,
    saveMessage(input: Record<string, unknown>) {
      messages.push(input);
      return input;
    },
  };
}

function makeAlerts() {
  const sent: string[] = [];
  return {
    sent,
    async sendToPreferredChannel(text: string) {
      sent.push(text);
      return { ok: true, provider: "telegram", channelId: "telegram_operator" };
    },
  };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];

  {
    const config = makeConfig();
    const direct = resolveIncomingWhatsAppChannel(config.operator, {
      instanceName: "atlas_institucional",
      senderNumber: "5551999999999",
    });
    const monitored = resolveIncomingWhatsAppChannel(config.operator, {
      instanceName: "atlas_institucional",
      senderNumber: "5551888888888",
    });
    results.push(assert(direct?.mode !== "direct_operator", "telegram_is_operator_no_direct_whatsapp_binding"));
    results.push(assert(monitored?.mode === "monitored", "institutional_instance_is_monitored_channel"));
  }

  {
    const directPayload: EvolutionWebhookPayload = {
      key: {
        remoteJid: "5551888888888@s.whatsapp.net",
        fromMe: false,
      },
      pushName: "Coordenação",
      messageType: "conversation",
      message: {
        conversation: "Paulo, reunião amanhã às 9h no CREAS",
      },
    };
    const wrappedPayload: EvolutionWebhookPayload = {
      event: "messages.upsert",
      data: {
        key: {
          remoteJid: "5551888888888@s.whatsapp.net",
          fromMe: false,
        },
        pushName: "Coordenação",
        messageType: "conversation",
        message: {
          conversation: "Paulo, reunião amanhã às 9h no CREAS",
        },
      },
    };
    const directParsed = parseEvolutionWebhookMessage(directPayload);
    const wrappedParsed = parseEvolutionWebhookMessage(wrappedPayload);
    results.push(assert(looksLikeEvolutionMessageWebhook(directPayload), "direct_evolution_payload_is_recognized"));
    results.push(assert(directParsed?.text === "Paulo, reunião amanhã às 9h no CREAS", "direct_evolution_payload_extracts_text"));
    results.push(assert(wrappedParsed?.remoteJid === "5551888888888@s.whatsapp.net", "wrapped_evolution_payload_extracts_remote_jid"));
  }

  {
    const ignored = classifyMonitoredWhatsAppMessage({
      text: "ok",
      operatorName: "Paulo",
    });
    const meeting = classifyMonitoredWhatsAppMessage({
      text: "Paulo, reunião amanhã às 9h no CREAS",
      operatorName: "Paulo",
    });
    const task = classifyMonitoredWhatsAppMessage({
      text: "Paulo, entregar relatório até sexta",
      operatorName: "Paulo",
    });
    results.push(assert(ignored.classification === "ignore" && ignored.shouldAlert === false, "irrelevant_monitored_message_is_ignored"));
    results.push(assert(meeting.classification === "possible_event" && meeting.suggestedAction === "event", "meeting_message_is_classified_as_event"));
    results.push(assert(task.classification === "possible_task" || task.classification === "action_needed", "task_message_is_classified_as_task_or_action"));
  }

  {
    const approvals = makeApprovals();
    const alerts = makeAlerts();
    const messages = makeMessages();
    const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-monitored-whatsapp-"));
    const personalMemory = new PersonalOperationalMemoryStore(path.join(sandboxDir, "personal.sqlite"), makeLogger());
    const service = new WhatsAppMonitorService(
      makeConfig(),
      makeLogger(),
      approvals as never,
      makeContacts() as never,
      makeRouter() as never,
      messages as never,
      personalMemory as never,
      {
        async chat() {
          return {
            message: {
              content: "Posso verificar isso e te retorno em seguida.",
            },
          };
        },
      } as never,
      alerts as never,
    );

    try {
      const result = await service.handleInboundText({
        instanceName: "atlas_institucional",
        accountAlias: "abordagem",
        remoteJid: "5551888888888@s.whatsapp.net",
        number: "5551888888888",
        pushName: "Coordenação",
        text: "Paulo, reunião amanhã às 9h no CREAS",
      });
      const state = personalMemory.getOperationalState();

      results.push(assert(result.ok && result.alertSent === true, "important_monitored_message_generates_alert"));
      results.push(assert(approvals.items.length === 1, "alert_is_persisted_as_pending_item"));
      results.push(assert(alerts.sent.length === 1 && alerts.sent[0]?.includes("Possível reunião no institucional"), "alert_is_sent_to_operator_channel_with_operational_copy"));
      results.push(assert(messages.messages.length === 1, "monitored_channel_does_not_auto_reply"));
      results.push(assert(state.pendingAlerts.some((item) => item.includes("Institucional: Paulo, reunião amanhã às 9h no CREAS")), "relevant_monitored_message_updates_operational_state_pending_alerts"));
      results.push(assert(state.signals.some((item) => item.active && item.source === "monitored_whatsapp" && item.kind === "possible_event"), "relevant_monitored_message_creates_active_operational_signal"));
    } finally {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
  }

  {
    const draft: PendingMonitoredChannelAlertDraft = {
      kind: "monitored_channel_alert",
      operatorId: "paulo",
      sourceProvider: "whatsapp",
      sourceChannelId: "atlas_institucional",
      sourceDisplayName: "WhatsApp institucional",
      sourceInstanceName: "atlas_institucional",
      sourceAccount: "abordagem",
      sourceRemoteJid: "5551888888888@s.whatsapp.net",
      sourceNumber: "5551888888888",
      sourcePushName: "Coordenação",
      sourceText: "Paulo, reunião amanhã às 9h no CREAS",
      classification: "possible_event",
      summary: "Paulo, reunião amanhã às 9h no CREAS",
      reasons: ["menção direta ao operador", "sinal de compromisso com data/horário"],
      suggestedAction: "event",
      operationalScore: 7,
      urgency: "medium",
      timeSignal: "tomorrow",
      eventDraft: {
        kind: "google_event",
        summary: "Reunião no CREAS",
        start: "2026-04-18T09:00:00-03:00",
        end: "2026-04-18T10:00:00-03:00",
        timezone: "America/Sao_Paulo",
        account: "abordagem",
      },
      createdAt: new Date().toISOString(),
    };
    const alertText = buildMonitoredChannelAlertReply(draft);
    const summaryText = buildMonitoredChannelAlertSummaryReply(draft);
    const sim = resolveMonitoredAlertReplyAction(draft, "sim");
    const ignore = resolveMonitoredAlertReplyAction(draft, "ignora");
    const register = resolveMonitoredAlertReplyAction(draft, "só registra");
    results.push(assert(alertText.includes("Possível reunião no institucional") && alertText.includes("crie evento"), "alert_reply_is_operational_and_actionable"));
    results.push(assert(summaryText.includes("urgência") && summaryText.includes("Se quiser agir"), "summary_reply_is_short_and_operational"));
    results.push(assert(sim.kind === "event", "short_followup_sim_continues_with_suggested_action"));
    results.push(assert(ignore.kind === "ignore", "ignore_closes_monitored_alert_flow"));
    results.push(assert(register.kind === "register", "register_synonym_closes_without_external_action"));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "ok" : "not ok";
    console.log(`${prefix} - ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
  }

  if (failed.length > 0) {
    console.error(`\nMonitored WhatsApp evals failed: ${failed.length}/${results.length}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nMonitored WhatsApp evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
