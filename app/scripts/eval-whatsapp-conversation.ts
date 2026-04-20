import { AssistantActionDispatcher } from "../src/core/action-dispatcher.js";
import { RequestOrchestrator } from "../src/core/request-orchestrator.js";
import { WhatsAppConversationService } from "../src/integrations/whatsapp/whatsapp-conversation-service.js";
import { resolveWhatsAppInboundMode } from "../src/core/whatsapp-routing.js";
import type { AppConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";

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

function makeConfig(overrides?: Partial<AppConfig["whatsapp"]>): AppConfig {
  return {
    whatsapp: {
      enabled: true,
      apiUrl: "http://evolution-api:8080",
      apiKey: "test",
      defaultInstanceName: "atlas_prime",
      defaultAccountAlias: "primary",
      instanceAccounts: { atlas_prime: "primary" },
      sidecarEnabled: true,
      conversationEnabled: true,
      allowedNumbers: [],
      unauthorizedMode: "ignore",
      ignoreGroups: true,
      sidecarPort: 8790,
      webhookPath: "/webhooks/evolution",
      ...overrides,
    },
  } as unknown as AppConfig;
}

function makeStore() {
  const messages: Array<Record<string, unknown>> = [];
  return {
    messages,
    saveMessage(input: Record<string, unknown>) {
      messages.push(input);
      return { id: messages.length, ...input };
    },
  };
}

function makeSender() {
  const sent: Array<{ instanceName?: string; number: string; text: string }> = [];
  return {
    sent,
    async sendText(input: { instanceName?: string; number: string; text: string }) {
      sent.push(input);
      return { ok: true };
    },
  };
}

function makeRequestOrchestrator(core: {
  runUserPrompt(prompt: string, options?: unknown): Promise<unknown>;
  executeToolDirect(toolName: string, payload: unknown): Promise<unknown>;
  resolveStructuredTaskOperationPayload(payload: unknown, options?: unknown): Promise<unknown>;
}) {
  const logger = makeLogger();
  const dispatcher = new AssistantActionDispatcher(core as never, logger);
  return new RequestOrchestrator(core as never, dispatcher, logger);
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];

  {
    const store = makeStore();
    const sender = makeSender();
    const core = {
      async runUserPrompt(prompt: string) {
        return {
          requestId: "r1",
          reply: prompt.includes("qual minha agenda") ? "Amanhã: 08:00 — Reunião no CAPS." : "Resposta curta.",
          messages: [],
          toolExecutions: [],
        };
      },
      async executeToolDirect() {
        throw new Error("should not execute");
      },
      async resolveStructuredTaskOperationPayload(payload: Record<string, unknown>) {
        return { kind: "resolved", payload };
      },
    };
    const service = new WhatsAppConversationService(
      makeConfig(),
      makeLogger(),
      core as never,
      makeRequestOrchestrator(core),
      sender,
      store as never,
    );
    const result = await service.handleInboundText({
      instanceName: "atlas_prime",
      remoteJid: "5551999999999@s.whatsapp.net",
      number: "5551999999999",
      pushName: "Paulo",
      text: "qual minha agenda amanhã?",
    });
    results.push(assert(result.ok && sender.sent[0]?.text.includes("Amanhã"), "text_message_is_processed_and_replied"));
    results.push(assert(store.messages.length === 2, "inbound_and_outbound_are_persisted"));
  }

  {
    const store = makeStore();
    const sender = makeSender();
    let executed = false;
    const core = {
      async runUserPrompt() {
        return {
          requestId: "r2",
          reply: [
            "Evento pronto.",
            "GOOGLE_EVENT_DRAFT",
            JSON.stringify({
              kind: "google_event",
              summary: "Reunião no CAPS",
              start: "2026-04-18T08:00:00-03:00",
              end: "2026-04-18T09:00:00-03:00",
              timezone: "America/Sao_Paulo",
              account: "primary",
            }),
            "END_GOOGLE_EVENT_DRAFT",
          ].join("\n"),
          messages: [],
          toolExecutions: [],
        };
      },
      async executeToolDirect(toolName: string, payload: Record<string, unknown>) {
        executed = toolName === "execute_calendar_operation" && payload.action === "create";
        return {
          requestId: "direct",
          content: "",
          rawResult: {
            ok: true,
            event: {
              summary: payload.summary,
              start: payload.start,
            },
          },
        };
      },
      async resolveStructuredTaskOperationPayload(payload: Record<string, unknown>) {
        return { kind: "resolved", payload };
      },
    };
    const service = new WhatsAppConversationService(
      makeConfig(),
      makeLogger(),
      core as never,
      makeRequestOrchestrator(core),
      sender,
      store as never,
    );
    await service.handleInboundText({
      instanceName: "atlas_prime",
      remoteJid: "5551999999999@s.whatsapp.net",
      number: "5551999999999",
      text: "coloque reunião no caps amanhã às 8h",
    });
    const confirm = await service.handleInboundText({
      instanceName: "atlas_prime",
      remoteJid: "5551999999999@s.whatsapp.net",
      number: "5551999999999",
      text: "sim",
    });
    results.push(assert(executed && confirm.reply?.includes("Evento criado"), "pending_calendar_create_confirms_locally"));
  }

  {
    const config = makeConfig({
      allowedNumbers: ["5551999999999"],
      unauthorizedMode: "monitor",
    });
    results.push(assert(
      resolveWhatsAppInboundMode(config.whatsapp, { number: "5551999999999" }) === "conversation",
      "allowed_operator_number_uses_conversation_mode",
    ));
    results.push(assert(
      resolveWhatsAppInboundMode(config.whatsapp, { number: "5551888888888" }) === "monitor",
      "non_allowed_number_uses_monitor_mode_when_configured",
    ));
  }

  {
    const config = makeConfig({
      allowedNumbers: ["5551999999999"],
      unauthorizedMode: "ignore",
    });
    results.push(assert(
      resolveWhatsAppInboundMode(config.whatsapp, { number: "5551888888888" }) === "ignore",
      "non_allowed_number_can_be_ignored_when_monitor_is_disabled",
    ));
  }

  {
    const store = makeStore();
    const sender = makeSender();
    const core = {
      async runUserPrompt() {
        throw new Error("should not run for groups");
      },
      async executeToolDirect() {
        throw new Error("should not execute");
      },
      async resolveStructuredTaskOperationPayload(payload: Record<string, unknown>) {
        return { kind: "resolved", payload };
      },
    };
    const service = new WhatsAppConversationService(
      makeConfig(),
      makeLogger(),
      core as never,
      makeRequestOrchestrator(core),
      sender,
      store as never,
    );
    const result = await service.handleInboundText({
      instanceName: "atlas_prime",
      remoteJid: "120363000000000000@g.us",
      number: "120363000000000000",
      text: "grupo teste",
    });
    results.push(assert(result.ignored === true && result.reason === "group_ignored", "groups_are_ignored_by_default"));
  }

  {
    const store = makeStore();
    const sender = makeSender();
    const core = {
      async runUserPrompt() {
        throw new Error("should not run for unauthorized");
      },
      async executeToolDirect() {
        throw new Error("should not execute");
      },
      async resolveStructuredTaskOperationPayload(payload: Record<string, unknown>) {
        return { kind: "resolved", payload };
      },
    };
    const service = new WhatsAppConversationService(
      makeConfig({ allowedNumbers: ["5551888888888"] }),
      makeLogger(),
      core as never,
      makeRequestOrchestrator(core),
      sender,
      store as never,
    );
    const result = await service.handleInboundText({
      instanceName: "atlas_prime",
      remoteJid: "5551999999999@s.whatsapp.net",
      number: "5551999999999",
      text: "oi",
    });
    results.push(assert(result.ignored === true && result.reason === "unauthorized_number", "unauthorized_numbers_are_ignored"));
  }

  {
    const store = makeStore();
    const sender = makeSender();
    let executedTool = "";
    const core = {
      async runUserPrompt() {
        return {
          requestId: "r3",
          reply: JSON.stringify({
            type: "assistant_decision",
            intent: "task_create",
            should_execute: true,
            assistant_reply: "Tarefa criada.",
            execution: {
              tool: "execute_task_operation",
              payload: {
                action: "create",
                title: "Comprar pilhas",
              },
            },
          }),
          messages: [],
          toolExecutions: [],
        };
      },
      async executeToolDirect(toolName: string) {
        executedTool = toolName;
        return {
          requestId: "direct",
          content: "",
          rawResult: { ok: true, task: { title: "Comprar pilhas" } },
        };
      },
      async resolveStructuredTaskOperationPayload(payload: Record<string, unknown>) {
        return { kind: "resolved", payload };
      },
    };
    const service = new WhatsAppConversationService(
      makeConfig(),
      makeLogger(),
      core as never,
      makeRequestOrchestrator(core),
      sender,
      store as never,
    );
    const result = await service.handleInboundText({
      instanceName: "atlas_prime",
      remoteJid: "5551999999999@s.whatsapp.net",
      number: "5551999999999",
      text: "crie tarefa comprar pilhas",
    });
    results.push(assert(result.reply === "Tarefa criada." && executedTool === "execute_task_operation", "assistant_decision_executes_locally"));
  }

  const failed = results.filter((result) => !result.passed);
  for (const result of results) {
    console.log(`${result.passed ? "ok" : "fail"} - ${result.name}${result.detail ? `: ${result.detail}` : ""}`);
  }
  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`\nWhatsApp conversation evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
