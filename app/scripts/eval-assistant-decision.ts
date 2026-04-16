import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseAssistantDecisionReply } from "../src/core/assistant-decision.js";
import { ExternalReasoningClient } from "../src/integrations/external-reasoning/external-reasoning-client.js";
import type { ExternalReasoningConfig } from "../src/types/config.js";
import type { ExternalReasoningRequest } from "../src/types/external-reasoning.js";
import type { Logger } from "../src/types/logger.js";

interface EvalCase {
  name: string;
  rawReply: unknown;
  expect: {
    handled: boolean;
    executionCalls: number;
    visibleReplyIncludes: string;
    tool?: string;
    action?: string;
  };
}

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

function loadCases(): EvalCase[] {
  const filePath = path.resolve(process.cwd(), "evals", "assistant-decision-cases.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as EvalCase[];
}

async function resolveStructuredDecisionForEval(
  rawReply: string,
  executeToolDirect: (toolName: string, rawArguments: unknown) => Promise<{ rawResult: unknown }>,
): Promise<{ handled: boolean; visibleReply: string; executionCalls: number; lastTool?: string; lastPayload?: unknown }> {
  const parsed = parseAssistantDecisionReply(rawReply);
  let executionCalls = 0;
  let lastTool: string | undefined;
  let lastPayload: unknown;

  if (parsed.kind === "absent") {
    return {
      handled: false,
      visibleReply: rawReply,
      executionCalls,
    };
  }

  if (parsed.kind === "invalid") {
    return {
      handled: true,
      visibleReply: [
        "Recebi uma decisão estruturada inválida para execução local.",
        "Nada foi executado.",
        `Detalhe: ${parsed.error}`,
      ].join("\n"),
      executionCalls,
    };
  }

  if (!parsed.decision.should_execute || !parsed.decision.execution) {
    return {
      handled: true,
      visibleReply: parsed.decision.assistant_reply,
      executionCalls,
    };
  }

  executionCalls += 1;
  lastTool = parsed.decision.execution.tool;
  lastPayload = parsed.decision.execution.payload;
  const execution = await executeToolDirect(parsed.decision.execution.tool, parsed.decision.execution.payload);
  const rawResult = execution.rawResult && typeof execution.rawResult === "object"
    ? execution.rawResult as Record<string, unknown>
    : undefined;
  if (rawResult?.ok === false) {
    return {
      handled: true,
      visibleReply: [
        "Não consegui executar a decisão estruturada de calendário.",
        `Detalhe: ${typeof rawResult.error === "string" ? rawResult.error : "Falha na execução local."}`,
      ].join("\n"),
      executionCalls,
      lastTool,
      lastPayload,
    };
  }

  return {
    handled: true,
    visibleReply: parsed.decision.assistant_reply,
    executionCalls,
    lastTool,
    lastPayload,
  };
}

async function withServer(
  handler: (requestBody: string, respond: (status: number, body: string, contentType?: string) => void) => void | Promise<void>,
  run: (baseUrl: string) => Promise<EvalResult>,
): Promise<EvalResult> {
  let server: Server | undefined;

  try {
    const result = await new Promise<EvalResult>((resolve) => {
      server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", async () => {
          const body = Buffer.concat(chunks).toString("utf8");
          await handler(body, (status, payload, contentType = "application/json") => {
            res.statusCode = status;
            res.setHeader("content-type", contentType);
            res.end(payload);
          });
        });
      });

      server.listen(0, "127.0.0.1", async () => {
        const address = server?.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolve(await run(`http://127.0.0.1:${port}`));
      });
    });

    return result;
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  }
}

function buildRequest(): ExternalReasoningRequest {
  return {
    user_message: "organize meu dia",
    chat_id: "123",
    intent: {
      primary_domain: "secretario_operacional",
      secondary_domains: [],
      mentioned_domains: ["secretario_operacional"],
      action_mode: "plan",
      confidence: 0.81,
      compound: false,
    },
    context: {
      signals: ["2 compromisso(s) hoje", "1 aprovação pendente"],
      preferences: {
        response_style: "executive",
        response_length: "short",
        proactive_next_step: true,
      },
      recent_messages: ["organize meu dia"],
    },
  };
}

async function runDecisionCases(): Promise<EvalResult[]> {
  const cases = loadCases();
  const results: EvalResult[] = [];

  for (const item of cases) {
    const calls: Array<{ tool: string; payload: unknown }> = [];
    const resolved = await resolveStructuredDecisionForEval(
      JSON.stringify(item.rawReply),
      async (toolName, rawArguments) => {
        calls.push({ tool: toolName, payload: rawArguments });
        return { rawResult: { ok: true } };
      },
    );

    const payloadAction = calls[0]?.payload && typeof calls[0].payload === "object"
      ? (calls[0].payload as Record<string, unknown>).action
      : undefined;

    const passed = resolved.handled === item.expect.handled
      && resolved.executionCalls === item.expect.executionCalls
      && resolved.visibleReply.includes(item.expect.visibleReplyIncludes)
      && (item.expect.tool ? calls[0]?.tool === item.expect.tool : true)
      && (item.expect.action ? payloadAction === item.expect.action : true);

    results.push({
      name: item.name,
      passed,
      detail: passed
        ? undefined
        : JSON.stringify(
            {
              resolved,
              calls,
              expected: item.expect,
            },
            null,
            2,
          ),
    });
  }

  return results;
}

async function runProviderCases(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  const logger = new SilentLogger();

  results.push(await withServer(
    async (_body, respond) => {
      respond(200, "Texto simples do provider.", "text/plain");
    },
    async (baseUrl) => {
      const client = new ExternalReasoningClient({
        enabled: true,
        baseUrl,
        timeoutMs: 1000,
        routeSimpleReads: false,
      } satisfies ExternalReasoningConfig, logger);
      const response = await client.reason(buildRequest());
      const passed = response.kind === "text" && response.content.includes("Texto simples");
      return {
        name: "provider_text_response_is_accepted_without_execution",
        passed,
        detail: passed ? undefined : JSON.stringify(response, null, 2),
      };
    },
  ));

  results.push(await withServer(
    async (_body, respond) => {
      setTimeout(() => respond(200, JSON.stringify({ ok: true })), 120);
    },
    async (baseUrl) => {
      const client = new ExternalReasoningClient({
        enabled: true,
        baseUrl,
        timeoutMs: 50,
        routeSimpleReads: false,
      } satisfies ExternalReasoningConfig, logger);

      let fellBack = false;
      try {
        await client.reason(buildRequest());
      } catch (error) {
        fellBack = error instanceof Error && error.message.includes("timed out");
      }

      return {
        name: "provider_timeout_triggers_safe_fallback",
        passed: fellBack,
        detail: fellBack ? undefined : "Timeout was not surfaced as a fallback condition.",
      };
    },
  ));

  results.push(await withServer(
    async (_body, respond) => {
      respond(200, "{ invalid json", "application/json");
    },
    async (baseUrl) => {
      const client = new ExternalReasoningClient({
        enabled: true,
        baseUrl,
        timeoutMs: 1000,
        routeSimpleReads: false,
      } satisfies ExternalReasoningConfig, logger);

      let fellBack = false;
      try {
        await client.reason(buildRequest());
      } catch (error) {
        fellBack = error instanceof Error && error.message.includes("invalid JSON");
      }

      return {
        name: "provider_invalid_json_triggers_safe_fallback",
        passed: fellBack,
        detail: fellBack ? undefined : "Invalid JSON was not rejected safely.",
      };
    },
  ));

  {
    const client = new ExternalReasoningClient({
      enabled: false,
      baseUrl: undefined,
      timeoutMs: 1000,
      routeSimpleReads: false,
    } satisfies ExternalReasoningConfig, logger);

    let fellBack = false;
    try {
      await client.reason(buildRequest());
    } catch (error) {
      fellBack = error instanceof Error && error.message.includes("disabled");
    }

    results.push({
      name: "provider_disabled_keeps_local_flow_available",
      passed: fellBack && client.isEnabled() === false,
      detail: fellBack ? undefined : "Disabled provider did not short-circuit safely.",
    });
  }

  return results;
}

async function main() {
  const results = [
    ...await runDecisionCases(),
    ...await runProviderCases(),
  ];

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

  console.log(`\nAssistant decision evals ok: ${results.length}/${results.length}`);
}

await main();
