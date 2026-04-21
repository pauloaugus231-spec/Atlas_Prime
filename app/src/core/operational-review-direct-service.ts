import type { AgentRunResult } from "./agent-core.js";
import type { LeadRecord } from "../types/growth-ops.js";
import type { ConversationMessage, LlmClient } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type {
  CommitmentPrepContract,
  FollowUpReviewContract,
  InboxTriageContract,
  SupportQueueContract,
} from "../types/response-contracts.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { EmailOperationalGroup, EmailOperationalSummary, EmailOperationalPriority } from "../integrations/email/email-analysis.js";
import type { EmailAvailabilityStatus, EmailMessageContent, EmailMessageSummary, EmailReader } from "../integrations/email/email-reader.js";
import type { IntentResolution } from "./intent-router.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";

interface ApprovalRecordLike {
  id: number;
  subject: string;
  actionKind: string;
  createdAt: string;
}

interface WhatsAppMessageLike {
  pushName?: string | null;
  number?: string | null;
  remoteJid: string;
  text: string;
  direction: "inbound" | "outbound";
}

interface SupportClassification {
  relationship: string;
  persona: string;
  actionPolicy: string;
}

interface SupportContextPack {
  signals?: string[];
}

interface ResponseOsLike {
  buildSupportQueueReply: (input: SupportQueueContract) => string;
  buildInboxTriageReply: (input: InboxTriageContract) => string;
  buildFollowUpReviewReply: (input: FollowUpReviewContract) => string;
  buildCommitmentPrepReply: (input: CommitmentPrepContract) => string;
}

interface CommunicationRouterLike {
  classify: (input: {
    channel: string;
    identifier: string | null | undefined;
    displayName?: string | null;
    subject?: string;
    text?: string;
  }) => SupportClassification;
}

interface ApprovalsLike {
  listPendingAll: (limit?: number) => ApprovalRecordLike[];
}

interface WhatsAppMessagesLike {
  listRecent: (limit?: number) => WhatsAppMessageLike[];
}

interface GrowthOpsLike {
  listLeads: (input?: { limit?: number }) => LeadRecord[];
}

interface PersonalOsLike {
  getExecutiveMorningBrief: () => Promise<ExecutiveMorningBrief>;
}

interface ContextPacksLike {
  buildForPrompt: (prompt: string, intent: IntentResolution) => Promise<SupportContextPack | null>;
}

interface EmailResolvedReference {
  message?: EmailMessageSummary;
  label: string;
  totalMatches: number;
  request: {
    senderQuery?: string;
    category?: EmailOperationalGroup;
    unreadOnly: boolean;
    sinceHours: number;
    existenceOnly?: boolean;
  };
}

type ReplyContext = "pessoal" | "profissional_dev" | "profissional_social" | "autonomo" | "geral";
type ReplyTone = "formal" | "informal" | "polida" | "rude" | "neutra";

interface OperationalReviewDirectHelpers {
  isSupportReviewPrompt: (prompt: string) => boolean;
  isInboxTriagePrompt: (prompt: string) => boolean;
  isFollowUpReviewPrompt: (prompt: string) => boolean;
  isNextCommitmentPrepPrompt: (prompt: string) => boolean;
  isEmailDraftPrompt: (prompt: string) => boolean;
  summarizeEmailForOperations: (input: {
    subject: string;
    from: string[];
    text: string;
  }) => EmailOperationalSummary;
  extractEmailIdentifier: (from: string[]) => string | undefined;
  normalizeEmailAnalysisText: (value: string) => string;
  includesAny: (source: string, tokens: string[]) => boolean;
  isUrgentSupportSignal: (value: string) => boolean;
  extractSupportTheme: (value: string) => string | null;
  classifyFollowUpBucket: (lead: LeadRecord) => "overdue" | "today" | "upcoming" | "unscheduled" | "later";
  formatFollowUpDueLabel: (value: string | null | undefined) => string;
  truncateBriefText: (value: string, maxLength: number) => string;
  formatBriefDateTime: (value: string | null | undefined, timezone: string) => string;
  summarizeCalendarLocation: (value: string | undefined) => string | undefined;
  extractEmailUidFromPrompt: (prompt: string) => string | undefined;
  buildEmailLookupMissReply: (request: EmailResolvedReference["request"]) => string;
  extractDisplayName: (value: string) => string | undefined;
  inferReplyContext: (userPrompt: string, subject: string, text: string) => ReplyContext;
  extractToneHint: (prompt: string) => ReplyTone;
  extractExactReplyBody: (prompt: string) => string | undefined;
  hasAffirmativeIntent: (prompt: string) => boolean;
  buildAffirmativeReplyTemplate: (input: {
    recipientName?: string;
    context: ReplyContext;
    tone: ReplyTone;
  }) => string;
  hasRejectionIntent: (prompt: string) => boolean;
  buildRejectionReplyTemplate: (input: {
    recipientName?: string;
    tone: ReplyTone;
  }) => string;
  stripCodeFences: (value: string) => string;
}

export interface OperationalReviewDirectServiceDependencies {
  logger: Logger;
  client: Pick<LlmClient, "chat">;
  email: EmailReader;
  approvals: ApprovalsLike;
  whatsappMessages: WhatsAppMessagesLike;
  communicationRouter: CommunicationRouterLike;
  contextPacks: ContextPacksLike;
  responseOs: ResponseOsLike;
  growthOps: GrowthOpsLike;
  personalOs: PersonalOsLike;
  resolveEmailReferenceFromPrompt: (prompt: string, logger: Logger) => Promise<EmailResolvedReference | null>;
  buildBaseMessages: (userPrompt: string, orchestration: OrchestrationContext, preferences?: UserPreferences) => ConversationMessage[];
  helpers: OperationalReviewDirectHelpers;
}

interface OperationalReviewDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  requestLogger?: Logger;
  preferences?: UserPreferences;
}

interface InboxTriageItem {
  uid: string;
  date: string | null;
  subject: string;
  from: string[];
  category: string;
  relationship: string;
  persona: string;
  policy: string;
  priority: string;
  status: string;
  action: string;
}

export class OperationalReviewDirectService {
  constructor(private readonly deps: OperationalReviewDirectServiceDependencies) {}

  async tryRunSupportReview(input: OperationalReviewDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isSupportReviewPrompt(input.userPrompt)) {
      return null;
    }

    const requestLogger = input.requestLogger ?? this.deps.logger;
    requestLogger.info("Using direct support review route");

    const emailStatus = await this.deps.email.getStatus();
    const emails = emailStatus.ready
      ? await this.deps.email.listRecentMessages({
          limit: 12,
          unreadOnly: false,
          sinceHours: 168,
        })
      : [];

    const supportEmailItems = emails
      .map((email) => {
        const summary = this.deps.helpers.summarizeEmailForOperations({
          subject: email.subject,
          from: email.from,
          text: email.preview,
        });
        const routing = this.deps.communicationRouter.classify({
          channel: "email",
          identifier: this.deps.helpers.extractEmailIdentifier(email.from),
          displayName: email.from.join(", "),
          subject: email.subject,
          text: email.preview,
        });
        const normalized = this.deps.helpers.normalizeEmailAnalysisText([email.subject, email.preview].join("\n"));
        const supportSignal = this.deps.helpers.includesAny(normalized, [
          "suporte",
          "ticket",
          "erro",
          "problema",
          "duvida",
          "dúvida",
          "ajuda",
          "atendimento",
          "cliente",
        ]);
        return {
          email,
          summary,
          routing,
          urgent: this.deps.helpers.isUrgentSupportSignal([email.subject, email.preview].join("\n")),
          theme: this.deps.helpers.extractSupportTheme([email.subject, email.preview].join("\n")),
          keep: routing.relationship === "client" || routing.relationship === "lead" || supportSignal,
        };
      })
      .filter((item) => item.keep)
      .slice(0, 4);

    const pendingReplyApprovals = this.deps.approvals
      .listPendingAll(12)
      .filter((item) => item.actionKind === "whatsapp_reply")
      .slice(0, 4);

    const recentSupportMessages = this.deps.whatsappMessages
      .listRecent(20)
      .map((message) => {
        const routing = this.deps.communicationRouter.classify({
          channel: "whatsapp",
          identifier: message.number ?? message.remoteJid,
          displayName: message.pushName,
          text: message.text,
        });
        const normalized = this.deps.helpers.normalizeEmailAnalysisText(message.text);
        const supportSignal = this.deps.helpers.includesAny(normalized, [
          "suporte",
          "erro",
          "problema",
          "duvida",
          "dúvida",
          "ajuda",
          "cliente",
          "atendimento",
        ]);
        return {
          message,
          routing,
          urgent: this.deps.helpers.isUrgentSupportSignal(message.text),
          theme: this.deps.helpers.extractSupportTheme(message.text),
          keep: message.direction === "inbound" && (routing.relationship === "client" || routing.relationship === "lead" || supportSignal),
        };
      })
      .filter((item) => item.keep)
      .slice(0, 4);

    const contextPack = await this.deps.contextPacks.buildForPrompt(input.userPrompt, {
      rawPrompt: input.userPrompt,
      activeUserPrompt: input.userPrompt,
      historyUserTurns: [],
      orchestration: input.orchestration,
      mentionedDomains: [input.orchestration.route.primaryDomain],
      compoundIntent: /\s+e\s+|depois|em seguida|ao mesmo tempo|junto com/i.test(input.userPrompt),
    });

    if (supportEmailItems.length === 0 && pendingReplyApprovals.length === 0 && recentSupportMessages.length === 0) {
      return {
        requestId: input.requestId,
        reply: this.deps.responseOs.buildSupportQueueReply({
          objective: "revisar a fila de suporte e atendimento",
          currentSituation: [
            emailStatus.ready
              ? "não encontrei sinais fortes de fila de suporte nas fontes recentes"
              : `email indisponível; análise feita só com sinais locais disponíveis`,
          ],
          channelSummary: ["sem sinais suficientes por email ou WhatsApp para montar uma fila real agora"],
          criticalCases: [],
          pendingReplies: [],
          recurringThemes: contextPack?.signals ?? ["validar se a fila de suporte está chegando por email, WhatsApp ou outro canal"],
          recommendedNextStep: "Se quiser, eu posso revisar primeiro o inbox, o WhatsApp ou só as aprovações pendentes.",
        }),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const currentSituation: string[] = [];
    if (supportEmailItems.length > 0) {
      currentSituation.push(`${supportEmailItems.length} email(s) com sinal de suporte ou cliente`);
    }
    if (pendingReplyApprovals.length > 0) {
      currentSituation.push(`${pendingReplyApprovals.length} resposta(s) de WhatsApp aguardando aprovação`);
    }
    if (recentSupportMessages.length > 0) {
      currentSituation.push(`${recentSupportMessages.length} mensagem(ns) inbound recente(s) com contexto de cliente`);
    }
    if (!emailStatus.ready) {
      currentSituation.push(`email indisponível: ${emailStatus.message}`);
    }

    const channelSummary: string[] = [];
    if (supportEmailItems.length > 0) {
      channelSummary.push(`email: ${supportEmailItems.length} caso(s) com sinal de cliente ou suporte`);
    }
    if (recentSupportMessages.length > 0) {
      channelSummary.push(`whatsapp: ${recentSupportMessages.length} mensagem(ns) inbound de cliente`);
    }
    if (pendingReplyApprovals.length > 0) {
      channelSummary.push(`aprovações: ${pendingReplyApprovals.length} resposta(s) pronta(s) para decidir`);
    }

    const criticalCases = [
      ...pendingReplyApprovals.slice(0, 2).map((item) => ({
        label: item.subject,
        channel: "approval" as const,
        detail: "resposta pronta aguardando decisão",
      })),
      ...supportEmailItems.filter((item) => item.urgent).slice(0, 2).map((item) => ({
        label: item.email.subject || "(sem assunto)",
        channel: "email" as const,
        detail: `${item.theme ?? "atendimento geral"} | ${item.summary.action}`,
      })),
      ...recentSupportMessages.filter((item) => item.urgent).slice(0, 2).map((item) => ({
        label: item.message.pushName ?? item.message.number ?? item.message.remoteJid,
        channel: "whatsapp" as const,
        detail: `${item.theme ?? "atendimento geral"} | ${this.deps.helpers.truncateBriefText(item.message.text, 88)}`,
      })),
    ].slice(0, 4);

    const pendingReplies = [
      ...pendingReplyApprovals.slice(0, 3).map((item) => ({
        label: item.subject,
        channel: "approval" as const,
        detail: "revisar rascunho antes de enviar",
      })),
      ...recentSupportMessages.slice(0, 2).map((item) => ({
        label: item.message.pushName ?? item.message.number ?? item.message.remoteJid,
        channel: "whatsapp" as const,
        detail: this.deps.helpers.truncateBriefText(item.message.text, 88),
      })),
    ].slice(0, 4);

    const themeCounts = new Map<string, number>();
    for (const item of [...supportEmailItems, ...recentSupportMessages]) {
      const theme = item.theme;
      if (!theme) {
        continue;
      }
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }
    const recurringThemes = [...themeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([theme, count]) => `${theme}: ${count} ocorrência(s)`);

    let recommendedNextStep = "Escolher o primeiro caso para resposta ou priorização.";
    if (pendingReplyApprovals[0]) {
      recommendedNextStep = `Abrir a aprovação mais urgente: ${this.deps.helpers.truncateBriefText(pendingReplyApprovals[0].subject, 96)}.`;
    } else if (criticalCases[0]) {
      recommendedNextStep = `Atacar primeiro o caso crítico em ${criticalCases[0].channel}: ${this.deps.helpers.truncateBriefText(criticalCases[0].label, 96)}.`;
    } else if (recentSupportMessages[0]) {
      recommendedNextStep = `Ler a última mensagem de ${this.deps.helpers.truncateBriefText(recentSupportMessages[0].message.pushName ?? recentSupportMessages[0].message.number ?? recentSupportMessages[0].message.remoteJid, 48)} e decidir a resposta.`;
    } else if (supportEmailItems[0]) {
      recommendedNextStep = `Revisar o email de cliente mais relevante: ${this.deps.helpers.truncateBriefText(supportEmailItems[0].email.subject || "(sem assunto)", 96)}.`;
    }

    return {
      requestId: input.requestId,
      reply: this.deps.responseOs.buildSupportQueueReply({
        objective: "revisar a fila de suporte e atendimento",
        currentSituation,
        channelSummary,
        criticalCases,
        pendingReplies,
        recurringThemes: recurringThemes.length > 0
          ? recurringThemes
          : (contextPack?.signals ?? []).slice(0, 3),
        recommendedNextStep,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "support_review_context",
          resultPreview: JSON.stringify(
            {
              supportEmails: supportEmailItems.length,
              pendingReplyApprovals: pendingReplyApprovals.length,
              recentSupportMessages: recentSupportMessages.length,
              criticalCases: criticalCases.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunInboxTriage(input: OperationalReviewDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isInboxTriagePrompt(input.userPrompt)) {
      return null;
    }

    const unreadOnly = !/todos|all/i.test(input.userPrompt);
    const limitMatch = input.userPrompt.match(/\b(\d{1,2})\b/);
    const limit = limitMatch ? Math.min(Math.max(Number.parseInt(limitMatch[1], 10), 1), 20) : 10;
    const emailStatus = await this.deps.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const requestLogger = input.requestLogger ?? this.deps.logger;
    requestLogger.info("Using direct inbox triage route", {
      limit,
      unreadOnly,
    });

    const emails = await this.deps.email.listRecentMessages({
      limit,
      unreadOnly,
      sinceHours: 168,
    });
    const priorityWeight = {
      alta: 0,
      media: 1,
      baixa: 2,
    } as const;

    const items: InboxTriageItem[] = emails
      .map((email) => {
        const summary = this.deps.helpers.summarizeEmailForOperations({
          subject: email.subject,
          from: email.from,
          text: email.preview,
        });
        const routing = this.deps.communicationRouter.classify({
          channel: "email",
          identifier: this.deps.helpers.extractEmailIdentifier(email.from),
          displayName: email.from.join(", "),
          subject: email.subject,
          text: email.preview,
        });
        return {
          uid: email.uid,
          date: email.date,
          subject: email.subject,
          from: email.from,
          category: summary.category,
          relationship: routing.relationship,
          persona: routing.persona,
          policy: routing.actionPolicy,
          priority: summary.priority,
          status: summary.status,
          action: summary.action,
        } satisfies InboxTriageItem;
      })
      .sort((left, right) => {
        const priorityDelta = priorityWeight[left.priority as keyof typeof priorityWeight] - priorityWeight[right.priority as keyof typeof priorityWeight];
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return (right.date ?? "").localeCompare(left.date ?? "");
      });

    const categoryCounts = new Map<string, number>();
    const relationshipCounts = new Map<string, number>();
    for (const item of items) {
      categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
      relationshipCounts.set(item.relationship, (relationshipCounts.get(item.relationship) ?? 0) + 1);
    }
    const groupSummary = [
      ...[...categoryCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 2)
        .map(([category, count]) => `categoria ${category}: ${count} email(s)`),
      ...[...relationshipCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 2)
        .map(([relationship, count]) => `relação ${relationship}: ${count} email(s)`),
    ];

    return {
      requestId: input.requestId,
      reply: this.deps.responseOs.buildInboxTriageReply({
        scopeLabel: "email principal",
        unreadOnly,
        limit,
        items: items.map((item) => ({
          uid: item.uid,
          subject: item.subject,
          from: item.from,
          relationship: item.relationship,
          priority: item.priority as EmailOperationalPriority,
          category: item.category,
          action: item.action,
        })),
        groupSummary,
        recommendedNextStep: items[0]
          ? `Executar a próxima ação do UID ${items[0].uid}: ${items[0].action}.`
          : undefined,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "list_recent_emails",
          resultPreview: JSON.stringify(
            {
              total: emails.length,
              unreadOnly,
              limit,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunFollowUpReview(input: OperationalReviewDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isFollowUpReviewPrompt(input.userPrompt)) {
      return null;
    }

    const requestLogger = input.requestLogger ?? this.deps.logger;
    requestLogger.info("Using direct follow-up review route");
    const leads = this.deps.growthOps.listLeads({ limit: 30 });
    const openLeads = leads.filter((lead) => !["won", "lost"].includes(lead.status));
    const overdueItems = openLeads
      .filter((lead) => this.deps.helpers.classifyFollowUpBucket(lead) === "overdue")
      .slice(0, 4)
      .map((lead) => ({
        label: `${lead.name}${lead.company ? ` | ${lead.company}` : ""}`,
        status: lead.status,
        dueLabel: `vencido desde ${this.deps.helpers.formatFollowUpDueLabel(lead.nextFollowUpAt)}`,
      }));
    const todayItems = openLeads
      .filter((lead) => this.deps.helpers.classifyFollowUpBucket(lead) === "today")
      .slice(0, 4)
      .map((lead) => ({
        label: `${lead.name}${lead.company ? ` | ${lead.company}` : ""}`,
        status: lead.status,
        dueLabel: `hoje às ${this.deps.helpers.formatFollowUpDueLabel(lead.nextFollowUpAt)}`,
      }));
    const unscheduledItems = openLeads
      .filter((lead) => this.deps.helpers.classifyFollowUpBucket(lead) === "unscheduled")
      .slice(0, 3)
      .map((lead) => ({
        label: `${lead.name}${lead.company ? ` | ${lead.company}` : ""}`,
        status: lead.status,
        dueLabel: "sem data",
      }));

    const currentSituation = [
      `${openLeads.length} lead(s) abertos no pipeline`,
      `${overdueItems.length} follow-up(s) vencido(s)`,
      `${todayItems.length} follow-up(s) para hoje ou próximas 24h`,
    ];

    const recommendedNextStep = overdueItems[0]
      ? `Atacar primeiro o follow-up vencido de ${this.deps.helpers.truncateBriefText(overdueItems[0].label, 96)}.`
      : todayItems[0]
        ? `Executar o follow-up de hoje: ${this.deps.helpers.truncateBriefText(todayItems[0].label, 96)}.`
        : unscheduledItems[0]
          ? `Definir data para o lead sem follow-up: ${this.deps.helpers.truncateBriefText(unscheduledItems[0].label, 96)}.`
          : "Se quiser, eu posso abrir o pipeline e listar cada lead por estágio.";

    return {
      requestId: input.requestId,
      reply: this.deps.responseOs.buildFollowUpReviewReply({
        scopeLabel: "pipeline e leads ativos",
        currentSituation,
        overdueItems,
        todayItems,
        unscheduledItems,
        recommendedNextStep,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "follow_up_review_context",
          resultPreview: JSON.stringify(
            {
              openLeads: openLeads.length,
              overdue: overdueItems.length,
              today: todayItems.length,
              unscheduled: unscheduledItems.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunNextCommitmentPrep(input: OperationalReviewDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isNextCommitmentPrepPrompt(input.userPrompt)) {
      return null;
    }

    const requestLogger = input.requestLogger ?? this.deps.logger;
    requestLogger.info("Using direct next commitment prep route");
    const brief = await this.deps.personalOs.getExecutiveMorningBrief();
    const nextEvent = brief.events.find((event) => event.owner === "paulo") ?? brief.events[0];
    if (!nextEvent?.start) {
      return {
        requestId: input.requestId,
        reply: "Não encontrei um próximo compromisso para preparar agora.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const eventDate = new Date(nextEvent.start);
    const todayKey = eventDate.toDateString();
    const nowKey = new Date().toDateString();
    const weatherTip = todayKey === nowKey
      ? brief.weather?.days[0]?.tip
      : brief.weather?.days[1]?.tip ?? brief.weather?.days[0]?.tip;

    const checklist: string[] = [];
    if (nextEvent.context === "externo") {
      checklist.push("confirmar endereço e rota antes de sair");
    }
    if (nextEvent.owner === "delegavel") {
      checklist.push("validar quem será o responsável por tocar esse compromisso");
    } else {
      checklist.push(nextEvent.prepHint);
    }
    if (nextEvent.location) {
      checklist.push(`levar o local salvo: ${this.deps.helpers.summarizeCalendarLocation(nextEvent.location)}`);
    }
    if (weatherTip) {
      checklist.push(weatherTip);
    }
    for (const mobilityAlert of brief.mobilityAlerts.filter((item) => item.startsWith("itens base:")).slice(0, 1)) {
      checklist.push(mobilityAlert);
    }

    const alerts: string[] = [];
    if (nextEvent.hasConflict) {
      alerts.push("há conflito de agenda nesse horário");
    }
    if (nextEvent.context === "externo" && !nextEvent.location) {
      alerts.push("compromisso externo sem local claro");
    }

    return {
      requestId: input.requestId,
      reply: this.deps.responseOs.buildCommitmentPrepReply({
        title: nextEvent.summary,
        startLabel: this.deps.helpers.formatBriefDateTime(nextEvent.start, brief.timezone),
        account: nextEvent.account,
        owner: nextEvent.owner,
        context: nextEvent.context,
        location: nextEvent.location,
        weatherTip,
        checklist,
        alerts,
        recommendedNextStep: alerts[0]
          ? `Resolver primeiro este alerta: ${alerts[0]}.`
          : `${nextEvent.prepHint[0]?.toUpperCase() ?? ""}${nextEvent.prepHint.slice(1)} para ${nextEvent.summary}.`,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "next_commitment_prep",
          resultPreview: JSON.stringify(
            {
              summary: nextEvent.summary,
              start: nextEvent.start,
              owner: nextEvent.owner,
              context: nextEvent.context,
              hasConflict: nextEvent.hasConflict,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunEmailDraft(input: OperationalReviewDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isEmailDraftPrompt(input.userPrompt)) {
      return null;
    }

    const emailStatus = await this.deps.email.getStatus();
    if (!emailStatus.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração de email não está pronta para leitura. ${emailStatus.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const requestLogger = input.requestLogger ?? this.deps.logger;
    const explicitUid = this.deps.helpers.extractEmailUidFromPrompt(input.userPrompt);
    const resolvedReference = explicitUid
      ? null
      : await this.deps.resolveEmailReferenceFromPrompt(input.userPrompt, requestLogger);
    if (!explicitUid && !resolvedReference) {
      return null;
    }
    if (!explicitUid && resolvedReference && !resolvedReference.message) {
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildEmailLookupMissReply(resolvedReference.request),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const targetUid = explicitUid ?? resolvedReference?.message?.uid;
    if (!targetUid) {
      return null;
    }

    requestLogger.info("Using direct email drafting route", {
      uid: targetUid,
      resolvedLabel: resolvedReference?.label,
    });

    const emailMessage = await this.deps.email.readMessage(targetUid);
    const recipientName = this.deps.helpers.extractDisplayName(emailMessage.from[0] ?? "");
    const inferredContext = this.deps.helpers.inferReplyContext(input.userPrompt, emailMessage.subject, emailMessage.text);
    const tone = this.deps.helpers.extractToneHint(input.userPrompt);
    const exactReplyBody = this.deps.helpers.extractExactReplyBody(input.userPrompt);
    const deterministicDraft = exactReplyBody
      ? exactReplyBody
      : this.deps.helpers.hasAffirmativeIntent(input.userPrompt)
        ? this.deps.helpers.buildAffirmativeReplyTemplate({
            recipientName,
            context: inferredContext,
            tone,
          })
        : this.deps.helpers.hasRejectionIntent(input.userPrompt)
          ? this.deps.helpers.buildRejectionReplyTemplate({
              recipientName,
              tone,
            })
          : undefined;
    const draftingMessages: ConversationMessage[] = [
      ...this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences).slice(0, 2),
      {
        role: "system",
        content: [
          "Você está redigindo uma resposta de email e não deve usar ferramentas nesta etapa.",
          "Escreva em português, de forma elegante e prática, considerando o contexto pessoal ou profissional indicado pelo usuário.",
          "Retorne somente o corpo final do email em texto puro.",
          "Não inclua explicações, introduções, markdown, assunto, blocos de código ou placeholders genéricos como [seu nome].",
          "Não invente atrasos, desculpas, contexto extra ou fatos que não estejam no email original ou no pedido do usuário.",
          "Se o usuário estiver aceitando um contato ou oportunidade, responda com clareza, objetividade e próximos passos.",
          "Se você não souber a assinatura nominal do usuário, finalize sem inventar nome próprio.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Pedido do usuário:",
          input.userPrompt,
          "",
          "Email original:",
          `UID: ${emailMessage.uid}`,
          `Assunto: ${emailMessage.subject}`,
          `De: ${emailMessage.from.join(", ") || "(desconhecido)"}`,
          `Para: ${emailMessage.to.join(", ") || "(desconhecido)"}`,
          `CC: ${emailMessage.cc.join(", ") || "(vazio)"}`,
          "",
          "Corpo do email original:",
          emailMessage.text || "(sem conteúdo textual)",
        ].join("\n"),
      },
    ];

    const response = deterministicDraft
      ? {
          message: {
            role: "assistant" as const,
            content: deterministicDraft,
          },
        }
      : await this.deps.client.chat({
          messages: draftingMessages,
        });
    const draftBody =
      this.deps.helpers.stripCodeFences(response.message.content ?? "").trim() ||
      "Não foi possível redigir a resposta do email nesta tentativa.";
    const targetLabel = explicitUid
      ? `o email UID ${targetUid}`
      : `o email mais recente para ${resolvedReference?.label ?? "o filtro informado"}`;
    const reply = draftBody.startsWith("Não foi possível")
      ? draftBody
      : [
          `Rascunho pronto para ${targetLabel}.`,
          "",
          draftBody,
          "",
          "EMAIL_REPLY_DRAFT",
          `uid=${targetUid}`,
          "body:",
          draftBody,
          "END_EMAIL_REPLY_DRAFT",
        ].join("\n");

    return {
      requestId: input.requestId,
      reply,
      messages: [...draftingMessages, response.message],
      toolExecutions: [
        {
          toolName: "read_email_message",
          resultPreview: JSON.stringify(
            {
              uid: emailMessage.uid,
              subject: emailMessage.subject,
              from: emailMessage.from,
            },
            null,
            2,
          ).slice(0, 240),
        },
      ],
    };
  }
}
