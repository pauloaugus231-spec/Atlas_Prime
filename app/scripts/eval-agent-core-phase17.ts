import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
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

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.9,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: true,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const listRecentCalls: Array<Record<string, unknown>> = [];
  const readMessageCalls: string[] = [];
  const resolveReferenceCalls: string[] = [];
  const chatCalls: number[] = [];

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).client = {
    chat: async ({ messages }: { messages: unknown[] }) => {
      chatCalls.push(messages.length);
      return {
        model: "eval-model",
        done: true,
        message: {
          role: "assistant",
          content: "Segue o rascunho final.",
        },
      };
    },
  };
  (core as any).email = {
    getStatus: async () => ({
      enabled: true,
      configured: true,
      ready: true,
      mailbox: "INBOX",
      message: "ok",
    }),
    listRecentMessages: async (input: Record<string, unknown>) => {
      listRecentCalls.push(input);
      return [
        {
          uid: "100",
          subject: "Cliente com problema urgente",
          from: ["Cliente <cliente@example.com>"],
          to: ["atlas@example.com"],
          date: "2026-04-20T10:00:00.000Z",
          flags: [],
          preview: "Preciso de ajuda hoje com o erro no sistema.",
          messageId: "m1",
        },
      ];
    },
    scanRecentMessages: async () => [],
    readMessage: async (uid: string) => {
      readMessageCalls.push(uid);
      return {
        uid,
        subject: "Cliente com problema urgente",
        from: ["Cliente <cliente@example.com>"],
        to: ["atlas@example.com"],
        cc: [],
        replyTo: [],
        date: "2026-04-20T10:00:00.000Z",
        flags: [],
        preview: "Preciso de ajuda hoje com o erro no sistema.",
        messageId: "m1",
        text: "Preciso de ajuda hoje com o erro no sistema.",
        truncated: false,
        references: [],
      };
    },
  };
  (core as any).approvals = {
    listPendingAll: () => [
      {
        id: 9,
        subject: "Resposta para cliente X",
        actionKind: "whatsapp_reply",
        createdAt: "2026-04-20T09:00:00.000Z",
      },
    ],
  };
  (core as any).whatsappMessages = {
    listRecent: () => [
      {
        pushName: "Cliente X",
        number: "5551999999999",
        remoteJid: "5551999999999@s.whatsapp.net",
        text: "Preciso de ajuda com suporte agora.",
        direction: "inbound",
      },
    ],
  };
  (core as any).communicationRouter = {
    classify: ({ channel }: { channel: string }) => ({
      relationship: channel === "email" ? "client" : "lead",
      persona: "profissional_comercial",
      actionPolicy: "draft_first",
    }),
  };
  (core as any).contextPacks = {
    buildForPrompt: async () => ({
      signals: ["1 aprovação pendente"],
    }),
  };
  (core as any).responseOs = {
    buildSupportQueueReply: (input: { currentSituation: string[] }) => `SUPPORT::${input.currentSituation.join(" | ")}`,
    buildInboxTriageReply: (input: { items: Array<{ uid: string }> }) => `INBOX::${input.items.map((item) => item.uid).join(",")}`,
    buildFollowUpReviewReply: (input: { currentSituation: string[] }) => `FOLLOWUP::${input.currentSituation.join(" | ")}`,
    buildCommitmentPrepReply: (input: { title: string; recommendedNextStep: string }) => `PREP::${input.title}::${input.recommendedNextStep}`,
  };
  (core as any).growthOps = {
    listLeads: () => [
      {
        id: 1,
        name: "Lead A",
        company: "Empresa A",
        status: "active",
        nextFollowUpAt: "2026-04-20T15:00:00.000Z",
      },
    ],
  };
  (core as any).personalOs = {
    getExecutiveMorningBrief: async () => ({
      timezone: "America/Sao_Paulo",
      events: [
        {
          account: "abordagem",
          summary: "Reunião no CAPS",
          start: "2026-04-20T12:00:00.000Z",
          end: "2026-04-20T13:00:00.000Z",
          location: "Porto Alegre",
          owner: "paulo",
          context: "externo",
          hasConflict: false,
          prepHint: "levar pauta",
        },
      ],
      taskBuckets: {
        today: [],
        overdue: [],
        stale: [],
        actionableCount: 0,
      },
      emails: [],
      approvals: [],
      workflows: [],
      focus: [],
      memoryEntities: {
        total: 0,
        byKind: {},
        recent: [],
      },
      motivation: {
        text: "Segue o dia.",
      },
      founderSnapshot: {
        executiveLine: "ok",
        sections: [],
        trackedMetrics: [],
      },
      personalFocus: [],
      overloadLevel: "leve",
      mobilityAlerts: ["itens base: carregar carregador"],
      operationalSignals: [],
      conflictSummary: {
        overlaps: 0,
        duplicates: 0,
        naming: 0,
      },
      weather: {
        locationLabel: "Porto Alegre",
        days: [
          {
            label: "hoje",
            description: "sol",
            tip: "casaco leve",
          },
        ],
      },
    }),
  };
  (core as any).resolveEmailReferenceFromPrompt = async (prompt: string) => {
    resolveReferenceCalls.push(prompt);
    return {
      label: "cliente@example.com",
      totalMatches: 1,
      request: { senderQuery: "cliente" },
      message: {
        uid: "100",
        subject: "Cliente com problema urgente",
        from: ["Cliente <cliente@example.com>"],
        to: ["atlas@example.com"],
        date: "2026-04-20T10:00:00.000Z",
        flags: [],
        preview: "Preciso de ajuda hoje com o erro no sistema.",
        messageId: "m1",
      },
    };
  };

  return { core, listRecentCalls, readMessageCalls, resolveReferenceCalls, chatCalls };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, listRecentCalls, readMessageCalls, resolveReferenceCalls, chatCalls } = buildCoreStub();
  const orchestration = buildOrchestration();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectSupportReview(
      "revise a fila de suporte",
      "req-phase17-support",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_support_review_wrapper_uses_operational_review_service",
      Boolean(
        result?.reply?.startsWith("SUPPORT::") &&
        result.toolExecutions[0]?.toolName === "support_review_context",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectInboxTriage(
      "faça a triagem do inbox",
      "req-phase17-inbox",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_inbox_triage_wrapper_uses_operational_review_service",
      Boolean(
        result?.reply === "INBOX::100" &&
        listRecentCalls.length >= 2 &&
        result.toolExecutions[0]?.toolName === "list_recent_emails",
      ),
      JSON.stringify({ listRecentCalls, reply: result?.reply }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectFollowUpReview(
      "revise meus follow-ups",
      "req-phase17-followup",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_followup_review_wrapper_uses_operational_review_service",
      Boolean(
        result?.reply?.startsWith("FOLLOWUP::") &&
        result.toolExecutions[0]?.toolName === "follow_up_review_context",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectNextCommitmentPrep(
      "prepare meu próximo compromisso",
      "req-phase17-next-commitment",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_next_commitment_prep_wrapper_uses_operational_review_service",
      Boolean(
        result?.reply?.startsWith("PREP::Reunião no CAPS::") &&
        result.toolExecutions[0]?.toolName === "next_commitment_prep",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectEmailDraft(
      "apenas redija uma resposta para o último email do cliente confirmando que vamos ajudar, não envie",
      "req-phase17-email-draft",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_email_draft_wrapper_uses_operational_review_service",
      Boolean(
        result?.reply?.includes("Rascunho pronto para o email mais recente para cliente@example.com.") &&
        readMessageCalls.includes("100") &&
        resolveReferenceCalls.length === 1 &&
        chatCalls.length === 1 &&
        result.toolExecutions[0]?.toolName === "read_email_message",
      ),
      JSON.stringify({ readMessageCalls, resolveReferenceCalls, chatCalls, reply: result?.reply }),
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase17 failed", error);
  process.exitCode = 1;
});
