import type { ConversationMessage } from "../src/types/llm.js";
import type { Logger } from "../src/types/logger.js";
import { ContextAssembler } from "../src/core/context-assembler.js";
import { ResponseSynthesizer } from "../src/core/response-synthesizer.js";
import { TurnPlanner } from "../src/core/turn-planner.js";

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

async function run(): Promise<void> {
  const logger = makeLogger();
  const results: EvalResult[] = [];

  {
    const assembler = new ContextAssembler(
      logger,
      {
        buildBaseMessages: (userPrompt) => [
          { role: "system", content: "system-base" },
          { role: "user", content: userPrompt },
        ],
        selectToolsForPrompt: (userPrompt) => userPrompt.includes("clima")
          ? [{
              type: "function" as const,
              function: {
                name: "weather_lookup",
                description: "Busca clima",
                parameters: { type: "object", properties: {} },
              },
            }]
          : [],
        getMemorySummary: () => "agenda às 9h",
        getProfile: () => ({
          name: "Paulo",
          defaultOperationalMode: "normal",
          responseStyle: "direct",
          responseLength: "short",
          preferredChannels: [],
          savedFocus: [],
          routineAnchors: [],
          operationalRules: [],
          importantPhysicalItems: [],
          lifeAreas: [],
        }),
        getOperationalState: () => ({
          mode: "normal",
          updatedAt: new Date().toISOString(),
        }),
      },
      { maxToolIterations: 3 },
    );

    const bundle = assembler.assemble({
      requestId: "ctx-1",
      userPrompt: "qual o clima hoje?",
      activeUserPrompt: "qual o clima hoje?",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "answer",
          confidence: 0.7,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
      preferences: {
        responseStyle: "concise",
        responseLength: "short",
        proactiveNextStep: true,
        preferredAgentName: "Atlas",
      },
      recentMessages: ["bom dia"],
    });

    results.push(assert(
      "context_assembler_builds_bundle_with_memory_and_tools",
      bundle.messages.length === 4
        && bundle.messages[2]?.content.includes("agenda às 9h")
        && bundle.messages[3]?.content === "qual o clima hoje?"
        && bundle.tools.length === 1
        && bundle.maxToolIterations === 3,
      JSON.stringify(bundle, null, 2),
    ));
  }

  {
    const responseSynthesizer = new ResponseSynthesizer(
      {
        async chat(input: { messages: ConversationMessage[] }) {
          return {
            model: "stub",
            done: true,
            message: {
              role: "assistant" as const,
              content: input.messages.some((message) => message.role === "tool")
                ? "Resposta final consolidada."
                : "Primeira resposta sem tools.",
            },
          };
        },
        async listModels() {
          return ["stub"];
        },
      },
      logger,
      {
        executeTool: async (input) => ({
          content: JSON.stringify({ ok: true, tool: input.toolName }),
        }),
      },
    );

    const directReply = await responseSynthesizer.synthesize({
      requestId: "syn-1",
      userPrompt: "oi",
      activeUserPrompt: "oi",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "answer",
          confidence: 0.8,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
      preferences: {
        responseStyle: "concise",
        responseLength: "short",
        proactiveNextStep: false,
        preferredAgentName: "Atlas",
      },
      recentMessages: [],
      messages: [
        { role: "system", content: "system-base" },
        { role: "user", content: "oi" },
      ],
      tools: [],
      maxToolIterations: 2,
    }, {
      requestLogger: logger,
    });

    results.push(assert(
      "response_synthesizer_returns_assistant_reply_when_no_tools_are_called",
      directReply.completion === "assistant_reply"
        && directReply.rawReply === "Primeira resposta sem tools."
        && directReply.toolExecutions.length === 0,
      JSON.stringify(directReply, null, 2),
    ));
  }

  {
    let chatCalls = 0;
    const responseSynthesizer = new ResponseSynthesizer(
      {
        async chat(input: { messages: ConversationMessage[]; tools?: unknown[] }) {
          chatCalls += 1;
          if (chatCalls === 1) {
            return {
              model: "stub",
              done: true,
              message: {
                role: "assistant" as const,
                content: "",
                tool_calls: [{
                  function: {
                    name: "weather_lookup",
                    arguments: { city: "Porto Alegre" },
                  },
                }],
              },
            };
          }
          return {
            model: "stub",
            done: true,
            message: {
              role: "assistant" as const,
              content: "Resposta final consolidada.",
            },
          };
        },
        async listModels() {
          return ["stub"];
        },
      },
      logger,
      {
        executeTool: async () => ({
          content: "{\"ok\":true}",
        }),
      },
    );

    const forced = await responseSynthesizer.synthesize({
      requestId: "syn-2",
      userPrompt: "clima de hoje",
      activeUserPrompt: "clima de hoje",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "answer",
          confidence: 0.8,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
      preferences: {
        responseStyle: "concise",
        responseLength: "short",
        proactiveNextStep: false,
        preferredAgentName: "Atlas",
      },
      recentMessages: [],
      messages: [
        { role: "system", content: "system-base" },
        { role: "user", content: "clima de hoje" },
      ],
      tools: [{
        type: "function" as const,
        function: {
          name: "weather_lookup",
          description: "Busca clima",
          parameters: { type: "object", properties: {} },
        },
      }],
      maxToolIterations: 1,
    }, {
      requestLogger: logger,
    });

    results.push(assert(
      "response_synthesizer_forces_final_synthesis_after_tool_budget",
      forced.completion === "forced_final_synthesis"
        && forced.forcedReason === "tool-budget-reached"
        && forced.toolExecutions.length === 1
        && forced.rawReply === "Resposta final consolidada.",
      JSON.stringify(forced, null, 2),
    ));
  }

  {
    const planner = new TurnPlanner(
      logger,
      {
        getProfile: () => ({
          name: "Paulo",
          defaultOperationalMode: "normal",
          responseStyle: "direct",
          responseLength: "short",
          preferredChannels: [],
          savedFocus: [],
          routineAnchors: [],
          operationalRules: [],
          importantPhysicalItems: [],
          lifeAreas: [],
        }),
        resolveOperationalMode: () => null,
        rewriteReply: (_prompt, reply) => `revised:${reply}`,
        resolveStructuredReply: async (rawReply) => rawReply.includes("assistant_decision")
          ? { handled: true, visibleReply: "Tarefa criada." }
          : { handled: false, visibleReply: "" },
        rewriteStructuredReply: false,
      },
    );

    const plainOutcome = await planner.plan({
      requestId: "ctx-plain",
      userPrompt: "oi",
      activeUserPrompt: "oi",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "answer",
          confidence: 0.8,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
      preferences: {
        responseStyle: "concise",
        responseLength: "short",
        proactiveNextStep: false,
        preferredAgentName: "Atlas",
      },
      recentMessages: [],
      messages: [],
      tools: [],
      maxToolIterations: 2,
    }, {
      requestId: "plain",
      completion: "assistant_reply",
      rawReply: "Tudo certo por aqui.",
      messages: [],
      toolExecutions: [],
      iterations: 1,
    });

    const structuredOutcome = await planner.plan({
      requestId: "ctx-structured",
      userPrompt: "crie tarefa",
      activeUserPrompt: "crie tarefa",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "execute",
          confidence: 0.8,
        },
        policy: {
          riskLevel: "medium",
          autonomyLevel: "assist",
        },
      },
      preferences: {
        responseStyle: "concise",
        responseLength: "short",
        proactiveNextStep: false,
        preferredAgentName: "Atlas",
      },
      recentMessages: ["crie tarefa comprar pilhas"],
      messages: [],
      tools: [],
      maxToolIterations: 2,
    }, {
      requestId: "structured",
      completion: "assistant_reply",
      rawReply: "{\"type\":\"assistant_decision\"}",
      messages: [],
      toolExecutions: [],
      iterations: 1,
    });

    results.push(assert(
      "turn_planner_rewrites_plain_reply_and_can_resolve_structured_reply",
      plainOutcome.reply === "revised:Tudo certo por aqui."
        && plainOutcome.structuredReplyHandled === false
        && structuredOutcome.reply === "Tarefa criada."
        && structuredOutcome.structuredReplyHandled === true
        && structuredOutcome.kind === "structured_reply",
      JSON.stringify({ plainOutcome, structuredOutcome }, null, 2),
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
