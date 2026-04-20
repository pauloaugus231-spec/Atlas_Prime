import { DirectRouteRunner, type DirectRouteExecutionInput } from "../src/core/direct-route-runner.js";
import { buildConversationDirectRoutes } from "../src/core/direct-routes/index.js";
import type { Logger } from "../src/types/logger.js";

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

function makeInput(): DirectRouteExecutionInput {
  return {
    userPrompt: "oi atlas",
    activeUserPrompt: "oi atlas",
    requestId: "route-1",
    requestLogger: makeLogger(),
    intent: {
      rawPrompt: "oi atlas",
      activeUserPrompt: "oi atlas",
      mentionedDomains: [],
      compoundIntent: false,
      historyUserTurns: [],
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
    },
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
    options: {
      chatId: "chat-1",
    },
  };
}

async function run(): Promise<void> {
  const logger = makeLogger();
  const runner = new DirectRouteRunner(logger);
  const results: EvalResult[] = [];

  {
    const executed: string[] = [];
    const output = await runner.run(
      makeInput(),
      [
        {
          key: "first",
          group: "conversation",
          async run() {
            executed.push("first");
            return null;
          },
        },
        {
          key: "second",
          group: "conversation",
          async run() {
            executed.push("second");
            return {
              requestId: "route-1",
              reply: "resolved by second",
              messages: [],
              toolExecutions: [],
            };
          },
        },
        {
          key: "third",
          group: "conversation",
          async run() {
            executed.push("third");
            return {
              requestId: "route-1",
              reply: "should not execute",
              messages: [],
              toolExecutions: [],
            };
          },
        },
      ],
    );

    results.push(assert(
      "direct_route_runner_stops_after_first_match",
      output?.reply === "resolved by second" && executed.join(",") === "first,second",
      JSON.stringify({ output, executed }),
    ));
  }

  {
    const executed: string[] = [];
    const output = await runner.run(
      makeInput(),
      [
        {
          key: "first",
          group: "capability",
          async run() {
            executed.push("first");
            return null;
          },
        },
        {
          key: "second",
          group: "capability",
          async run() {
            executed.push("second");
            return null;
          },
        },
      ],
      async () => {
        executed.push("fallback");
        return {
          requestId: "route-1",
          reply: "fallback-result",
          messages: [],
          toolExecutions: [],
        };
      },
    );

    results.push(assert(
      "direct_route_runner_invokes_fallback_after_all_routes",
      output?.reply === "fallback-result" && executed.join(",") === "first,second,fallback",
      JSON.stringify({ output, executed }),
    ));
  }

  {
    const output = await runner.run(makeInput(), []);
    results.push(assert(
      "direct_route_runner_returns_null_without_routes_or_fallback",
      output === null,
      JSON.stringify({ output }),
    ));
  }

  {
    const routes = buildConversationDirectRoutes({
      ping: async () => null,
      greeting: async () => null,
      conversationStyleCorrection: async () => null,
      agentIdentity: async () => null,
    });

    results.push(assert(
      "conversation_direct_route_builder_preserves_declared_order",
      routes.map((route) => `${route.group}:${route.key}`).join(",")
        === [
          "conversation:ping",
          "conversation:greeting",
          "conversation:conversation_style_correction",
          "conversation:agent_identity",
        ].join(","),
      JSON.stringify(routes.map((route) => ({ key: route.key, group: route.group }))),
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
