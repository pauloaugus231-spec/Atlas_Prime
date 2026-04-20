import process from "node:process";
import { AssistantActionDispatcher } from "../src/core/action-dispatcher.js";
import {
  buildCliChannelPrompt,
  buildTelegramChannelPrompt,
  buildWhatsAppChannelPrompt,
} from "../src/core/channel-message-adapter.js";
import {
  extractPendingActionDraft,
  sanitizeToolPayloadLeak,
  stripPendingDraftMarkers,
} from "../src/core/draft-action-service.js";
import { RequestOrchestrator } from "../src/core/request-orchestrator.js";
import type { AgentCoreRequestRuntime, AgentRunOptions, AgentRunResult } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

class FakeRuntime implements AgentCoreRequestRuntime {
  public replies: string[] = [];
  public runCalls: Array<{ prompt: string; options?: AgentRunOptions }> = [];
  public resolveCalls: unknown[] = [];
  public executeCalls: Array<{ tool: string; payload: unknown }> = [];

  async runUserPrompt(userPrompt: string, options?: AgentRunOptions): Promise<AgentRunResult> {
    this.runCalls.push({ prompt: userPrompt, options });
    return {
      requestId: `req-${this.runCalls.length}`,
      reply: this.replies.shift() ?? "",
      messages: [],
      toolExecutions: [],
    };
  }

  async resolveStructuredTaskOperationPayload(payload: unknown): Promise<{
    kind: "resolved" | "clarify" | "invalid";
    payload?: unknown;
    message?: string;
    error?: string;
  }> {
    this.resolveCalls.push(payload);
    if (payload && typeof payload === "object") {
      const record = payload as Record<string, unknown>;
      if (record.force === "clarify") {
        return { kind: "clarify", message: "Preciso esclarecer a tarefa." };
      }
      if (record.force === "invalid") {
        return { kind: "invalid", error: "Payload inválido." };
      }
    }
    return { kind: "resolved", payload };
  }

  async executeToolDirect(toolName: string, rawArguments: unknown): Promise<{ rawResult: unknown }> {
    this.executeCalls.push({ tool: toolName, payload: rawArguments });
    return { rawResult: { ok: true } };
  }
}

function assert(name: string, condition: boolean, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const results: EvalResult[] = [];

  {
    const prompt = buildTelegramChannelPrompt({
      chatType: "private",
      chatId: 42,
      userId: 7,
      text: "organize meu dia",
      history: [
        { role: "user", text: "oi" },
        { role: "assistant", text: "Estou aqui." },
      ],
      operationalMode: { kind: "field", reason: "plantão" },
    });
    results.push(assert(
      "telegram_adapter_serializes_metadata_and_mode",
      prompt.includes("chat_id=42")
        && prompt.includes("Usuário: oi")
        && prompt.includes("modo_operacional=field")
        && prompt.includes("organize meu dia"),
      prompt,
    ));
  }

  {
    const prompt = buildWhatsAppChannelPrompt({
      chatId: "instancia:jid",
      remoteJid: "5551999999999@s.whatsapp.net",
      number: "5551999999999",
      pushName: "Paulo",
      text: "me mostra hotéis",
      history: [],
    });
    results.push(assert(
      "whatsapp_adapter_preserves_operational_style",
      prompt.includes("canal=whatsapp")
        && prompt.includes("push_name=Paulo")
        && prompt.includes("responda de forma curta, natural e operacional para WhatsApp"),
      prompt,
    ));
  }

  {
    const prompt = buildCliChannelPrompt({
      text: "qual minha agenda amanhã?",
      history: [{ role: "user", text: "oi atlas" }],
    });
    results.push(assert(
      "cli_adapter_uses_operator_context",
      prompt.includes("canal=cli")
        && prompt.includes("Histórico recente do chat:")
        && prompt.includes("qual minha agenda amanhã?"),
      prompt,
    ));
  }

  {
    const reply = [
      "Evento pronto.",
      "GOOGLE_EVENT_DRAFT",
      JSON.stringify({
        kind: "google_event",
        summary: "Reunião",
        start: "2026-04-20T09:00:00-03:00",
        end: "2026-04-20T10:00:00-03:00",
      }),
      "END_GOOGLE_EVENT_DRAFT",
    ].join("\n");
    const draft = extractPendingActionDraft(reply);
    const stripped = stripPendingDraftMarkers(reply);
    results.push(assert(
      "draft_service_extracts_and_strips_google_event",
      draft?.kind === "google_event"
        && draft.summary === "Reunião"
        && stripped === "Evento pronto.",
      JSON.stringify({ draft, stripped }, null, 2),
    ));
  }

  {
    const leaked = sanitizeToolPayloadLeak(JSON.stringify({
      function_name: "execute_calendar_operation",
      arguments: { action: "create" },
    }));
    results.push(assert(
      "draft_service_sanitizes_raw_tool_payload",
      leaked.includes("Ferramenta detectada: execute_calendar_operation"),
      leaked,
    ));
  }

  {
    const runtime = new FakeRuntime();
    const dispatcher = new AssistantActionDispatcher(runtime, logger);
    const resolution = await dispatcher.resolveStructuredReply("texto simples", {
      recentMessages: [],
      channelLabel: "telegram",
    });
    results.push(assert(
      "action_dispatcher_ignores_absent_structured_reply",
      resolution.handled === false && resolution.visibleReply === "",
      JSON.stringify(resolution, null, 2),
    ));
  }

  {
    const runtime = new FakeRuntime();
    const dispatcher = new AssistantActionDispatcher(runtime, logger);
    const resolution = await dispatcher.resolveStructuredReply("{\"type\":\"assistant_decision\"}", {
      recentMessages: [],
      channelLabel: "telegram",
    });
    results.push(assert(
      "action_dispatcher_rejects_invalid_structured_reply",
      resolution.handled === true && resolution.visibleReply.includes("decisão estruturada inválida"),
      JSON.stringify(resolution, null, 2),
    ));
  }

  {
    const runtime = new FakeRuntime();
    const dispatcher = new AssistantActionDispatcher(runtime, logger);
    const resolution = await dispatcher.resolveStructuredReply(JSON.stringify({
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
    }), {
      recentMessages: ["anota comprar pilhas"],
      channelLabel: "telegram",
    });
    results.push(assert(
      "action_dispatcher_executes_local_tool_for_valid_reply",
      resolution.handled === true
        && resolution.visibleReply === "Tarefa criada."
        && runtime.executeCalls.length === 1
        && runtime.executeCalls[0]?.tool === "execute_task_operation",
      JSON.stringify({ resolution, executeCalls: runtime.executeCalls }, null, 2),
    ));
  }

  {
    const runtime = new FakeRuntime();
    const dispatcher = new AssistantActionDispatcher(runtime, logger);
    const resolution = await dispatcher.resolveStructuredReply(JSON.stringify({
      type: "assistant_decision",
      intent: "task_update",
      should_execute: true,
      assistant_reply: "Vou ajustar.",
      execution: {
        tool: "execute_task_operation",
        payload: {
          action: "update",
          task_id: "123",
          title: "Atualizar relatório",
          force: "clarify",
        },
      },
    }), {
      recentMessages: ["ajusta a tarefa"],
      channelLabel: "whatsapp",
    });
    results.push(assert(
      "action_dispatcher_returns_clarification_when_runtime_requires_it",
      resolution.handled === true
        && resolution.visibleReply === "Preciso esclarecer a tarefa."
        && runtime.executeCalls.length === 0,
      JSON.stringify({ resolution, resolveCalls: runtime.resolveCalls }, null, 2),
    ));
  }

  {
    const runtime = new FakeRuntime();
    runtime.replies.push([
      "Rascunho pronto.",
      "GOOGLE_TASK_DRAFT",
      JSON.stringify({ kind: "google_task", title: "Comprar pilhas" }),
      "END_GOOGLE_TASK_DRAFT",
    ].join("\n"));
    const dispatcher = new AssistantActionDispatcher(runtime, logger);
    const orchestrator = new RequestOrchestrator(runtime, dispatcher, logger);
    const result = await orchestrator.run({
      channel: "telegram",
      agentPrompt: "prompt",
      recentMessages: ["anota comprar pilhas"],
      draftReplyFormatter: (draft) => draft.kind === "google_task" ? `Tarefa pronta: ${draft.title}` : undefined,
    });
    results.push(assert(
      "request_orchestrator_formats_pending_draft_reply",
      result.pendingDraft?.kind === "google_task"
        && result.visibleReply === "Tarefa pronta: Comprar pilhas"
        && result.structuredReplyHandled === false,
      JSON.stringify(result, null, 2),
    ));
  }

  {
    const runtime = new FakeRuntime();
    runtime.replies.push(JSON.stringify({
      type: "assistant_decision",
      intent: "task_create",
      should_execute: true,
      assistant_reply: "Tarefa criada localmente.",
      execution: {
        tool: "execute_task_operation",
        payload: {
          action: "create",
          title: "Comprar pilhas",
        },
      },
    }));
    const dispatcher = new AssistantActionDispatcher(runtime, logger);
    const orchestrator = new RequestOrchestrator(runtime, dispatcher, logger);
    const result = await orchestrator.run({
      channel: "cli",
      agentPrompt: "prompt",
      recentMessages: ["comprar pilhas"],
    });
    results.push(assert(
      "request_orchestrator_short_circuits_structured_reply",
      result.structuredReplyHandled === true
        && result.visibleReply === "Tarefa criada localmente."
        && runtime.executeCalls.length === 1,
      JSON.stringify({ result, executeCalls: runtime.executeCalls }, null, 2),
    ));
  }

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nRequest orchestration evals ok: ${results.length}/${results.length}`);
}

void run();
