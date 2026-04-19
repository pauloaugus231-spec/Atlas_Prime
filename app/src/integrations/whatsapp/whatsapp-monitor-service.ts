import {
  buildEventDraftFromPrompt,
  buildTaskDraftFromPrompt,
  type PendingGoogleEventDraft,
  type PendingGoogleTaskDraft,
} from "../../core/google-draft-utils.js";
import {
  buildMonitoredChannelAlertReply,
  classifyMonitoredWhatsAppMessage,
  type MonitoredAlertSuggestedAction,
  type MonitoredWhatsAppReplyDraft,
  type PendingMonitoredChannelAlertDraft,
} from "../../core/monitored-channel-alerts.js";
import { buildOperationalStatePatchForMonitoredAlert } from "../../core/operational-state-signals.js";
import type { ApprovalInboxStore } from "../../core/approval-inbox.js";
import type { CommunicationRouter, ContactIntelligenceStore } from "../../core/contact-intelligence.js";
import type { PersonalOperationalMemoryStore } from "../../core/personal-operational-memory.js";
import type { WhatsAppMessageStore } from "../../core/whatsapp-message-store.js";
import type { LlmClient } from "../../types/llm.js";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { OperatorAlertDispatcher } from "../operator/operator-alert-dispatcher.js";

export interface MonitoredWhatsAppInput {
  instanceName?: string;
  accountAlias: string;
  remoteJid: string;
  number: string;
  pushName?: string;
  text: string;
  createdAt?: string;
}

export interface MonitoredWhatsAppResult {
  ok: boolean;
  classification: string;
  alertSent: boolean;
  ignored?: boolean;
  reason?: string;
  approvalId?: number;
}

function resolveSuggestedAction(input: {
  suggestedAction: MonitoredAlertSuggestedAction;
  eventDraft?: PendingGoogleEventDraft;
  taskDraft?: PendingGoogleTaskDraft;
  replyDraft?: MonitoredWhatsAppReplyDraft;
}): MonitoredAlertSuggestedAction {
  if (input.suggestedAction === "event" && input.eventDraft) {
    return "event";
  }
  if (input.suggestedAction === "task" && input.taskDraft) {
    return "task";
  }
  if (input.suggestedAction === "reply" && input.replyDraft) {
    return "reply";
  }
  if (input.eventDraft) {
    return "event";
  }
  if (input.taskDraft) {
    return "task";
  }
  if (input.replyDraft) {
    return "reply";
  }
  return input.suggestedAction === "summary" ? "summary" : "register";
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

export class WhatsAppMonitorService {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly approvals: ApprovalInboxStore,
    private readonly contacts: ContactIntelligenceStore,
    private readonly communicationRouter: CommunicationRouter,
    private readonly whatsappMessages: WhatsAppMessageStore,
    private readonly personalMemory: PersonalOperationalMemoryStore,
    private readonly client: LlmClient,
    private readonly alerts: OperatorAlertDispatcher,
  ) {}

  async handleInboundText(input: MonitoredWhatsAppInput): Promise<MonitoredWhatsAppResult> {
    this.whatsappMessages.saveMessage({
      instanceName: input.instanceName,
      remoteJid: input.remoteJid,
      number: input.number,
      pushName: input.pushName,
      direction: "inbound",
      text: input.text,
      createdAt: input.createdAt,
    });

    const routing = this.communicationRouter.classify({
      channel: "whatsapp",
      identifier: input.number,
      displayName: input.pushName,
      text: input.text,
    });

    this.contacts.upsertContact({
      channel: "whatsapp",
      identifier: input.number,
      displayName: input.pushName ?? input.number,
      relationship: routing.relationship,
      persona: routing.persona,
      priority: routing.priority,
      tags: [
        `account:${input.accountAlias}`,
        ...(input.instanceName ? [`instance:${input.instanceName}`] : []),
        "mode:monitored",
      ],
      source: "whatsapp_monitor_service",
    });

    const classification = classifyMonitoredWhatsAppMessage({
      text: input.text,
      operatorName: this.config.operator.name,
    });

    this.logger.info("Monitored WhatsApp message classified", {
      instanceName: input.instanceName,
      account: input.accountAlias,
      number: input.number,
      classification: classification.classification,
      shouldAlert: classification.shouldAlert,
      suggestedAction: classification.suggestedAction,
      operationalScore: classification.operationalScore,
      urgency: classification.urgency,
      timeSignal: classification.timeSignal,
    });

    if (!classification.shouldAlert) {
      return {
        ok: true,
        ignored: true,
        classification: classification.classification,
        alertSent: false,
        reason: classification.classification === "ignore" ? "classifier_ignore" : "classifier_informational_only",
      };
    }

    const googleAccountConfig = input.accountAlias === "primary"
      ? this.config.google
      : (this.config.googleAccounts[input.accountAlias] ?? this.config.google);
    const eventDraft = this.buildEventDraft(input.text, input.accountAlias, googleAccountConfig.calendarId, googleAccountConfig.defaultTimezone);
    const taskDraft = this.buildTaskDraft(input.text, input.accountAlias, googleAccountConfig.defaultTimezone);
    const replyDraft = await this.buildReplyDraft({
      instanceName: input.instanceName,
      account: input.accountAlias,
      remoteJid: input.remoteJid,
      number: input.number,
      pushName: input.pushName,
      inboundText: input.text,
      relationship: routing.relationship,
      persona: routing.persona,
      actionPolicy: routing.actionPolicy,
      classification: classification.classification,
    });
    const suggestedAction = resolveSuggestedAction({
      suggestedAction: classification.suggestedAction,
      eventDraft,
      taskDraft,
      replyDraft,
    });

    const draft: PendingMonitoredChannelAlertDraft = {
      kind: "monitored_channel_alert",
      operatorId: this.config.operator.operatorId,
      sourceProvider: "whatsapp",
      sourceChannelId: input.instanceName ?? "whatsapp_monitored",
      sourceDisplayName: input.instanceName ? `WhatsApp ${input.instanceName}` : "WhatsApp monitorado",
      sourceInstanceName: input.instanceName,
      sourceAccount: input.accountAlias,
      sourceRemoteJid: input.remoteJid,
      sourceNumber: input.number,
      sourcePushName: input.pushName,
      sourceText: input.text,
      classification: classification.classification,
      summary: classification.summary,
      reasons: classification.reasons,
      suggestedAction,
      operationalScore: classification.operationalScore,
      urgency: classification.urgency,
      timeSignal: classification.timeSignal,
      ...(eventDraft ? { eventDraft } : {}),
      ...(taskDraft ? { taskDraft } : {}),
      ...(replyDraft ? { replyDraft } : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.logger.info("Monitored WhatsApp alert draft prepared", {
      instanceName: input.instanceName,
      account: input.accountAlias,
      number: input.number,
      classification: draft.classification,
      suggestedAction: draft.suggestedAction,
      operationalScore: draft.operationalScore,
      urgency: draft.urgency,
      hasEventDraft: Boolean(eventDraft),
      hasTaskDraft: Boolean(taskDraft),
      hasReplyDraft: Boolean(replyDraft),
    });

    const alertChannel = this.config.operator.preferredAlertChannelId
      ? this.config.operator.channels.find((item) => item.channelId === this.config.operator.preferredAlertChannelId)
      : this.config.operator.channels.find((item) => item.provider === "telegram");
    const alertChatId = alertChannel?.provider === "telegram"
      ? Number.parseInt(alertChannel.externalId, 10)
      : this.config.whatsapp.notifyTelegramChatId ?? this.config.telegram.allowedUserIds[0];
    if (!alertChatId || !Number.isFinite(alertChatId)) {
      return {
        ok: false,
        classification: classification.classification,
        alertSent: false,
        reason: "operator_alert_channel_not_configured",
      };
    }

    const approval = this.approvals.createPending({
      chatId: alertChatId,
      channel: "whatsapp",
      actionKind: draft.kind,
      subject: `WhatsApp monitorado${draft.sourceAccount ? ` ${draft.sourceAccount}` : ""}: ${input.pushName ?? input.number}`,
      draftPayload: JSON.stringify(draft),
    });

    const currentState = this.personalMemory.getOperationalState();
    const operationalPatch = buildOperationalStatePatchForMonitoredAlert(currentState, draft);
    const pendingApprovals = typeof (this.approvals as { listPending?: unknown }).listPending === "function"
      ? (this.approvals as { listPending: (chatId: number, limit?: number) => unknown[] }).listPending(alertChatId, 20).length
      : currentState.pendingApprovals;
    const nextState = this.personalMemory.updateOperationalState({
      ...operationalPatch,
      pendingApprovals: Math.max(currentState.pendingApprovals, pendingApprovals),
    });
    this.logger.info("Operational state updated from monitored WhatsApp alert", {
      account: input.accountAlias,
      signalCount: nextState.signals.filter((item) => item.active).length,
      pendingAlerts: nextState.pendingAlerts.slice(0, 3),
      primaryRisk: nextState.primaryRisk,
    });

    await this.alerts.sendToPreferredChannel(buildMonitoredChannelAlertReply(draft));
    return {
      ok: true,
      classification: classification.classification,
      alertSent: true,
      approvalId: approval.id,
    };
  }

  private buildEventDraft(
    text: string,
    account: string,
    calendarId: string,
    timezone: string,
  ): PendingGoogleEventDraft | undefined {
    const result = buildEventDraftFromPrompt(text, timezone);
    if (!result.draft) {
      return undefined;
    }

    return {
      ...result.draft,
      account,
      calendarId,
    };
  }

  private buildTaskDraft(
    text: string,
    account: string,
    timezone: string,
  ): PendingGoogleTaskDraft | undefined {
    const result = buildTaskDraftFromPrompt(text, timezone);
    if (!result.draft) {
      return undefined;
    }

    return {
      ...result.draft,
      account,
    };
  }

  private async buildReplyDraft(input: {
    instanceName?: string;
    account: string;
    remoteJid: string;
    number: string;
    pushName?: string;
    inboundText: string;
    relationship: string;
    persona: string;
    actionPolicy: string;
    classification: string;
  }): Promise<MonitoredWhatsAppReplyDraft | undefined> {
    if (!["possible_reply", "action_needed", "attention"].includes(input.classification)) {
      return undefined;
    }

    try {
      const llm = await this.client.chat({
        messages: [
          {
            role: "system",
            content: "Você é o roteador de respostas do Atlas para WhatsApp. Gere somente o texto final sugerido.",
          },
          {
            role: "user",
            content: buildWhatsAppDraftPrompt({
              pushName: input.pushName,
              number: input.number,
              text: input.inboundText,
              relationship: input.relationship,
              persona: input.persona,
              actionPolicy: input.actionPolicy,
            }),
          },
        ],
      });

      return {
        kind: "whatsapp_reply",
        instanceName: input.instanceName,
        account: input.account,
        remoteJid: input.remoteJid,
        number: input.number,
        pushName: input.pushName,
        inboundText: input.inboundText,
        replyText: extractReplyCandidate(llm.message.content),
        relationship: input.relationship,
        persona: input.persona,
      };
    } catch (error) {
      this.logger.warn("Monitored WhatsApp reply draft generation failed", {
        account: input.account,
        instanceName: input.instanceName,
        number: input.number,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
