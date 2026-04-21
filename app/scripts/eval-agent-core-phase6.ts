import { MessagingDirectService } from "../src/core/messaging-direct-service.js";
import type { ContactProfileRecord } from "../src/types/contact-intelligence.js";
import type { Logger } from "../src/types/logger.js";
import type { WhatsAppConfig } from "../src/types/config.js";
import type { ApprovalInboxItemRecord } from "../src/types/approval-inbox.js";
import type { WhatsAppContactRecord, WhatsAppMessageRecord } from "../src/core/whatsapp-message-store.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, condition: boolean, detail?: string): EvalResult {
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

function makeWhatsAppConfig(overrides: Partial<WhatsAppConfig> = {}): WhatsAppConfig {
  return {
    enabled: true,
    apiUrl: "http://localhost:8080",
    apiKey: "test",
    defaultInstanceName: "atlas_primary",
    defaultAccountAlias: "primary",
    instanceAccounts: {
      atlas_primary: "primary",
      atlas_abordagem: "abordagem",
    },
    sidecarEnabled: true,
    conversationEnabled: true,
    allowedNumbers: [],
    unauthorizedMode: "ignore",
    ignoreGroups: true,
    sidecarPort: 8790,
    webhookPath: "/webhooks/evolution",
    ...overrides,
  };
}

function makeService(input: {
  config?: Partial<WhatsAppConfig>;
  contacts?: ContactProfileRecord[];
  recentContacts?: WhatsAppContactRecord[];
  recentMessages?: WhatsAppMessageRecord[];
  approvals?: ApprovalInboxItemRecord[];
}) {
  const contacts = input.contacts ?? [];
  const recentContacts = input.recentContacts ?? [];
  const recentMessages = input.recentMessages ?? [];
  const approvals = input.approvals ?? [];

  return new MessagingDirectService({
    whatsappConfig: makeWhatsAppConfig(input.config),
    logger: makeLogger(),
    contacts: {
      searchContacts(query: string) {
        return contacts.filter((item) => {
          const haystack = [item.displayName, item.identifier, item.company, item.notes]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query.toLowerCase());
        });
      },
    },
    approvals: {
      listPendingAll() {
        return approvals;
      },
    },
    whatsappMessages: {
      searchContacts(query: string) {
        return recentContacts.filter((item) => {
          const haystack = [item.pushName, item.number, item.remoteJid]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query.toLowerCase());
        });
      },
      searchRecent(query: string) {
        return recentMessages.filter((item) => {
          const haystack = [item.pushName, item.number, item.remoteJid, item.text]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query.toLowerCase());
        });
      },
      listRecentByInstance(instanceName: string) {
        return recentMessages.filter((item) => item.instanceName === instanceName);
      },
    },
    buildBaseMessages() {
      return [];
    },
    buildMessageHistoryReply(payload) {
      return `${payload.scopeLabel} :: ${payload.items.length}`;
    },
    buildApprovalReviewReply(payload) {
      return `${payload.scopeLabel} :: ${payload.items.length} :: ${payload.recommendedNextStep ?? ""}`;
    },
  });
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];

  {
    const service = makeService({
      contacts: [
        {
          id: 1,
          channel: "whatsapp",
          identifier: "5551999999999",
          displayName: "Joana",
          relationship: "client",
          persona: "operacional_neutro",
          priority: "alta",
          company: null,
          preferredTone: null,
          notes: null,
          tags: [],
          source: "manual",
          createdAt: "2026-04-20T08:00:00.000Z",
          updatedAt: "2026-04-20T08:00:00.000Z",
        },
      ],
    });
    const fullPrompt = [
      "Histórico recente do chat:",
      "Usuário: mande mensagem no whatsapp para Joana",
      "Mensagem atual do usuário:",
      "Pode vir amanhã às 9h.",
    ].join("\n");
    const result = await service.tryRunWhatsAppSend({
      activeUserPrompt: "Pode vir amanhã às 9h.",
      fullPrompt,
      requestId: "msg-1",
      orchestration: {
        route: {
          primaryDomain: "comunicacao",
          secondaryDomains: [],
          actionMode: "communicate",
          confidence: 0.9,
        },
        policy: {
          riskLevel: "medium",
          autonomyLevel: "assist",
        },
      },
    });

    results.push(assert(
      "messaging_service_uses_recent_send_context_for_follow_up_body",
      Boolean(result?.reply.includes("Rascunho WhatsApp pronto para Joana.") && result.reply.includes("Pode vir amanhã às 9h.")),
      result?.reply,
    ));
  }

  {
    const service = makeService({
      recentMessages: [
        {
          id: 1,
          instanceName: "atlas_primary",
          remoteJid: "5551999999999@s.whatsapp.net",
          number: "5551999999999",
          pushName: "Joana",
          direction: "inbound",
          text: "Preciso confirmar o horário.",
          createdAt: "2026-04-20T10:00:00.000Z",
        },
      ],
    });
    const result = await service.tryRunWhatsAppRecentSearch({
      activeUserPrompt: "veja no whatsapp por Joana",
      fullPrompt: "veja no whatsapp por Joana",
      requestId: "msg-2",
      orchestration: {
        route: {
          primaryDomain: "comunicacao",
          secondaryDomains: [],
          actionMode: "monitor",
          confidence: 0.9,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
    });

    results.push(assert(
      "messaging_service_reads_recent_history_from_store",
      result?.reply === "WhatsApp para Joana :: 1",
      result?.reply,
    ));
  }

  {
    const service = makeService({
      approvals: [
        {
          id: 1,
          chatId: 10,
          channel: "telegram",
          actionKind: "google_event",
          subject: "Evento de teste",
          draftPayload: "{}",
          status: "pending",
          createdAt: "2026-04-20T09:00:00.000Z",
          updatedAt: "2026-04-20T09:00:00.000Z",
        },
        {
          id: 2,
          chatId: 10,
          channel: "telegram",
          actionKind: "whatsapp_reply",
          subject: "Responder Joana",
          draftPayload: "{}",
          status: "pending",
          createdAt: "2026-04-20T08:00:00.000Z",
          updatedAt: "2026-04-20T08:00:00.000Z",
        },
      ],
    });
    const result = await service.tryRunWhatsAppPendingApprovals({
      activeUserPrompt: "quais aprovações pendentes do whatsapp?",
      requestId: "msg-3",
      orchestration: {
        route: {
          primaryDomain: "comunicacao",
          secondaryDomains: [],
          actionMode: "monitor",
          confidence: 0.9,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
    });

    results.push(assert(
      "messaging_service_filters_only_whatsapp_reply_approvals",
      Boolean(result?.reply.startsWith("WhatsApp :: 1 :: Decidir a resposta pendente de WhatsApp: Responder Joana.")),
      result?.reply,
    ));
  }

  const failed = results.filter((result) => !result.passed);
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} eval(s) falharam.`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n${results.length}/${results.length} evals passaram.`);
}

void run();
