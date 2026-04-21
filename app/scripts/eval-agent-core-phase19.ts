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
  const readMessageCalls: string[] = [];
  const resolveReferenceCalls: string[] = [];

  (core as any).logger = logger;
  (core as any).email = {
    getStatus: async () => ({
      enabled: true,
      configured: true,
      ready: true,
      mailbox: "INBOX",
      message: "ok",
    }),
    listRecentMessages: async () => [],
    scanRecentMessages: async () => [],
    readMessage: async (uid: string) => {
      readMessageCalls.push(uid);
      return {
        uid,
        threadId: null,
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
  (core as any).communicationRouter = {
    classify: () => ({
      relationship: "client",
      persona: "profissional_comercial",
      actionPolicy: "draft_first",
    }),
  };
  (core as any).resolveEmailReferenceFromPrompt = async (prompt: string) => {
    resolveReferenceCalls.push(prompt);
    return {
      label: "cliente@example.com",
      totalMatches: 1,
      request: {
        senderQuery: "cliente",
        unreadOnly: false,
        sinceHours: 720,
        existenceOnly: false,
      },
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

  return { core, readMessageCalls, resolveReferenceCalls };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, readMessageCalls, resolveReferenceCalls } = buildCoreStub();
  const orchestration = buildOrchestration();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectEmailSummary(
      "resuma o email uid 100",
      "req-phase19-email-summary",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_email_summary_wrapper_uses_email_direct_service",
      Boolean(
        result?.reply?.includes("Resumo do email UID 100") &&
        readMessageCalls.includes("100") &&
        result.toolExecutions[0]?.toolName === "read_email_message",
      ),
      JSON.stringify({ readMessageCalls, reply: result?.reply }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectEmailLookup(
      "qual o último email do cliente",
      "req-phase19-email-lookup",
      logger,
      orchestration,
    );

    results.push(assert(
      "agent_core_email_lookup_wrapper_uses_email_direct_service",
      Boolean(
        result?.reply?.includes("Encontrei 1 email(s) recente(s) para cliente@example.com.") &&
        resolveReferenceCalls.length === 1 &&
        result.toolExecutions[0]?.toolName === "list_recent_emails",
      ),
      JSON.stringify({ resolveReferenceCalls, reply: result?.reply }),
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
  console.error("eval-agent-core-phase19 failed", error);
  process.exitCode = 1;
});
