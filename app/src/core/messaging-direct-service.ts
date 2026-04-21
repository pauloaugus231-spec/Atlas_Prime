import { EvolutionApiClient } from "../integrations/whatsapp/evolution-api.js";
import type { WhatsAppConfig } from "../types/config.js";
import type { ContactPersona, ContactRelationship } from "../types/contact-intelligence.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import { rankApprovals } from "./approval-priority.js";
import type { ApprovalInboxStore } from "./approval-inbox.js";
import type { AgentRunResult } from "./agent-core.js";
import type { ContactIntelligenceStore } from "./contact-intelligence.js";
import {
  buildWhatsAppDirectDraftReply,
  buildWhatsAppDraftMarker,
  buildWhatsAppScopedRecentChatsReply,
  extractPhoneFromText,
  extractWhatsAppMessageBody,
  extractWhatsAppSearchQuery,
  extractWhatsAppTargetReference,
  findRecentWhatsAppSendPrompt,
  isLikelyWhatsAppBodyFollowUp,
  isWhatsAppPendingApprovalsPrompt,
  isWhatsAppRecentSearchPrompt,
  isWhatsAppSendPrompt,
  normalizeAliasToken,
  normalizePhoneDigits,
} from "./messaging-direct-helpers.js";
import type { WhatsAppMessageStore } from "./whatsapp-message-store.js";
import { describeWhatsAppRoute } from "./whatsapp-routing.js";

interface MessageHistoryReplyInput {
  scopeLabel: string;
  items: Array<{
    when: string;
    who: string;
    direction: "recebida" | "enviada";
    text: string;
  }>;
  recommendedNextStep?: string;
}

interface ApprovalReviewReplyInput {
  scopeLabel: string;
  items: Array<{
    id: number;
    subject: string;
    actionKind: string;
    createdAt: string;
  }>;
  recommendedNextStep?: string;
}

export interface MessagingDirectServiceDependencies {
  whatsappConfig: WhatsAppConfig;
  logger: Logger;
  contacts: Pick<ContactIntelligenceStore, "searchContacts">;
  approvals: Pick<ApprovalInboxStore, "listPendingAll">;
  whatsappMessages: Pick<WhatsAppMessageStore, "searchContacts" | "searchRecent" | "listRecentByInstance">;
  buildBaseMessages: (userPrompt: string, orchestration: OrchestrationContext) => ConversationMessage[];
  buildMessageHistoryReply: (input: MessageHistoryReplyInput) => string;
  buildApprovalReviewReply: (input: ApprovalReviewReplyInput) => string;
}

interface WhatsAppTargetResolution {
  number?: string;
  displayName?: string;
  remoteJid?: string;
  relationship?: ContactRelationship;
  persona?: ContactPersona;
}

interface MessagingDirectInput {
  activeUserPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  fullPrompt?: string;
}

export class MessagingDirectService {
  private readonly whatsappLogger: Logger;

  constructor(private readonly deps: MessagingDirectServiceDependencies) {
    this.whatsappLogger = deps.logger.child({ scope: "whatsapp-evolution" });
  }

  async tryRunWhatsAppSend(input: MessagingDirectInput): Promise<AgentRunResult | null> {
    const fullPrompt = input.fullPrompt ?? input.activeUserPrompt;
    const recentSendPrompt = findRecentWhatsAppSendPrompt(fullPrompt);
    const currentHasPhone = Boolean(normalizePhoneDigits(extractPhoneFromText(input.activeUserPrompt)));
    const currentHasExplicitBody = Boolean(extractWhatsAppMessageBody(input.activeUserPrompt));
    const currentLooksLikeBodyFollowUp =
      Boolean(recentSendPrompt) &&
      !currentHasPhone &&
      !currentHasExplicitBody &&
      isLikelyWhatsAppBodyFollowUp(input.activeUserPrompt);
    const isFollowUpForRecentSend =
      !isWhatsAppSendPrompt(input.activeUserPrompt) &&
      Boolean(recentSendPrompt) &&
      (currentHasPhone || currentHasExplicitBody || currentLooksLikeBodyFollowUp);

    if (!isWhatsAppSendPrompt(input.activeUserPrompt) && !isFollowUpForRecentSend) {
      return null;
    }

    if (!this.deps.whatsappConfig.enabled) {
      return {
        requestId: input.requestId,
        reply: "O WhatsApp do Atlas não está habilitado neste ambiente.",
        messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const baseTargetPrompt =
      currentHasPhone || extractWhatsAppTargetReference(input.activeUserPrompt)
        ? input.activeUserPrompt
        : recentSendPrompt ?? input.activeUserPrompt;
    const target = this.resolveWhatsAppTarget(baseTargetPrompt);
    const body = extractWhatsAppMessageBody(input.activeUserPrompt)
      ?? (currentLooksLikeBodyFollowUp ? input.activeUserPrompt.trim() : undefined);

    if (!target.number && target.displayName) {
      return {
        requestId: input.requestId,
        reply: [
          `Não encontrei o número de WhatsApp de ${target.displayName}.`,
          "Responda em uma linha neste formato: `+55... | sua mensagem`.",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    if (!target.number) {
      return {
        requestId: input.requestId,
        reply: "Para enviar no WhatsApp, me passe em uma linha: `+55... | sua mensagem`.",
        messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    if (!body) {
      return {
        requestId: input.requestId,
        reply: [
          `Tenho o destino: ${target.displayName ?? target.number} (${target.number}).`,
          "Agora me diga o texto em uma linha, por exemplo: `Olá, bom dia.`",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const whatsappRoutingContext = [recentSendPrompt, baseTargetPrompt, input.activeUserPrompt]
      .filter(Boolean)
      .join("\n");
    const route = describeWhatsAppRoute(this.deps.whatsappConfig, {
      text: whatsappRoutingContext,
    });
    if (!route.instanceName) {
      return {
        requestId: input.requestId,
        reply: [
          `Não encontrei uma instância de WhatsApp configurada para a conta ${route.accountAlias}.`,
          "Defina `WHATSAPP_INSTANCE_ACCOUNTS` para mapear a instância correta antes de enviar.",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const marker = buildWhatsAppDraftMarker({
      instanceName: route.instanceName,
      account: route.accountAlias,
      remoteJid: target.remoteJid ?? `${target.number}@s.whatsapp.net`,
      number: target.number,
      pushName: target.displayName,
      inboundText: "",
      replyText: body,
      relationship: target.relationship,
      persona: target.persona,
    });

    return {
      requestId: input.requestId,
      reply: buildWhatsAppDirectDraftReply({
        nameOrNumber: target.displayName ?? target.number,
        number: target.number,
        text: body,
        account: route.accountAlias,
        instanceName: route.instanceName,
        marker,
      }),
      messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  async tryRunWhatsAppRecentSearch(input: MessagingDirectInput): Promise<AgentRunResult | null> {
    const fullPrompt = input.fullPrompt ?? input.activeUserPrompt;
    if (!isWhatsAppRecentSearchPrompt(input.activeUserPrompt)) {
      return null;
    }

    const query = extractWhatsAppSearchQuery(input.activeUserPrompt, fullPrompt);
    if (!query) {
      return {
        requestId: input.requestId,
        reply: "Diga de quem devo procurar as mensagens recentes no WhatsApp.",
        messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const normalizedQuery = query
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const route = describeWhatsAppRoute(this.deps.whatsappConfig, {
      text: [input.activeUserPrompt, fullPrompt].join("\n"),
    });
    const normalizedInstance = route.instanceName
      ?.normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    const isScopedAccountQuery = normalizedQuery === route.accountAlias || normalizedQuery === normalizedInstance;

    if (isScopedAccountQuery && route.instanceName && this.deps.whatsappConfig.enabled) {
      try {
        const whatsapp = new EvolutionApiClient(
          this.deps.whatsappConfig,
          this.whatsappLogger,
        );
        const chats = await whatsapp.findChats(route.instanceName, 8);
        if (chats.length > 0) {
          return {
            requestId: input.requestId,
            reply: buildWhatsAppScopedRecentChatsReply(route.accountAlias, chats),
            messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
            toolExecutions: [],
          };
        }
      } catch (error) {
        this.deps.logger.warn("WhatsApp recent chat fallback failed", {
          account: route.accountAlias,
          instanceName: route.instanceName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const messages = isScopedAccountQuery && route.instanceName
      ? this.deps.whatsappMessages.listRecentByInstance(route.instanceName, 8)
      : this.deps.whatsappMessages.searchRecent(query, 8);

    return {
      requestId: input.requestId,
      reply: this.deps.buildMessageHistoryReply({
        scopeLabel: isScopedAccountQuery && route.instanceName
          ? `WhatsApp ${route.accountAlias}`
          : `WhatsApp para ${query}`,
        items: messages.map((item) => ({
          when: new Intl.DateTimeFormat("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(item.createdAt)),
          who: item.pushName ?? item.number ?? item.remoteJid,
          direction: item.direction === "inbound" ? "recebida" : "enviada",
          text: item.text,
        })),
        recommendedNextStep: messages[0]
          ? "Ler a última mensagem e decidir se o próximo passo é responder, acompanhar ou registrar contexto."
          : !this.deps.whatsappConfig.enabled
            ? "Não achei mensagens no histórico local. Para leitura ao vivo, confira se Evolution/WhatsApp está habilitado no ambiente."
          : undefined,
      }),
      messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  async tryRunWhatsAppPendingApprovals(input: MessagingDirectInput): Promise<AgentRunResult | null> {
    if (!isWhatsAppPendingApprovalsPrompt(input.activeUserPrompt)) {
      return null;
    }

    const pending = this.deps.approvals
      .listPendingAll(12)
      .filter((item) => item.actionKind === "whatsapp_reply");
    const rankedPending = rankApprovals(pending);

    return {
      requestId: input.requestId,
      reply: this.deps.buildApprovalReviewReply({
        scopeLabel: "WhatsApp",
        items: rankedPending.map((entry) => ({
          id: entry.item.id,
          subject: entry.item.subject,
          actionKind: entry.item.actionKind,
          createdAt: entry.item.createdAt,
        })),
        recommendedNextStep: rankedPending[0]
          ? `Decidir a resposta pendente de WhatsApp: ${rankedPending[0].item.subject}.`
          : undefined,
      }),
      messages: this.deps.buildBaseMessages(input.activeUserPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  private resolveWhatsAppTarget(prompt: string): WhatsAppTargetResolution {
    const directNumber = normalizePhoneDigits(extractPhoneFromText(prompt));
    const targetReference = extractWhatsAppTargetReference(prompt);

    if (directNumber) {
      return {
        number: directNumber,
        displayName: targetReference,
        remoteJid: `${directNumber}@s.whatsapp.net`,
      };
    }

    if (!targetReference) {
      return {};
    }

    const candidates = this.deps.contacts.searchContacts(targetReference, 6);
    const exactDisplay = candidates.find((item) =>
      normalizeAliasToken(item.displayName ?? "") === normalizeAliasToken(targetReference),
    );
    const whatsappCandidate = [exactDisplay, ...candidates].find((item) => {
      if (!item) {
        return false;
      }
      if (item.channel === "whatsapp" && normalizePhoneDigits(item.identifier)) {
        return true;
      }
      return Boolean(normalizePhoneDigits(item.identifier));
    });

    const number = normalizePhoneDigits(whatsappCandidate?.identifier);
    if (!number) {
      const recentWhatsAppContacts = this.deps.whatsappMessages.searchContacts(targetReference, 6);
      const exactRecent = recentWhatsAppContacts.find((item) =>
        normalizeAliasToken(item.pushName ?? "") === normalizeAliasToken(targetReference),
      );
      const fallbackRecent = exactRecent ?? recentWhatsAppContacts[0];
      const fallbackNumber = normalizePhoneDigits(fallbackRecent?.number ?? undefined);

      if (!fallbackNumber) {
        return {
          displayName: targetReference,
        };
      }

      return {
        number: fallbackNumber,
        displayName: fallbackRecent?.pushName ?? targetReference,
        remoteJid: fallbackRecent?.remoteJid ?? `${fallbackNumber}@s.whatsapp.net`,
      };
    }

    return {
      number,
      displayName: whatsappCandidate?.displayName ?? targetReference,
      remoteJid: `${number}@s.whatsapp.net`,
      relationship: whatsappCandidate?.relationship,
      persona: whatsappCandidate?.persona,
    };
  }
}
