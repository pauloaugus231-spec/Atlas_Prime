import os from "node:os";
import path from "node:path";
import process from "node:process";
import { mkdtempSync } from "node:fs";
import type { Logger } from "../src/types/logger.js";
import { defineDirectRoute, DirectRouteRunner, type DirectRouteExecutionInput } from "../src/core/direct-route-runner.js";
import { RouteDecisionAuditStore } from "../src/core/routing/route-decision-audit-store.js";
import { buildTurnFrame } from "../src/core/routing/turn-understanding-service.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function buildResult(requestId: string, reply: string) {
  return {
    requestId,
    reply,
    messages: [],
    toolExecutions: [],
  };
}

async function run() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "atlas-routing-shadow-"));
  const audit = new RouteDecisionAuditStore(path.join(tempDir, "routing.sqlite"), logger);
  const runner = new DirectRouteRunner(logger, audit);

  const routes = [
    defineDirectRoute(
      "legacy_first",
      "test",
      async (input) => buildResult(input.requestId, "legacy response"),
      {
        intents: ["command_center.show"],
        objects: ["command_center"],
        operations: ["show"],
        priority: 10,
      },
    ),
    defineDirectRoute(
      "intent_target",
      "test",
      async (input) => buildResult(input.requestId, "intent response"),
      {
        intents: ["email.summarize"],
        objects: ["email"],
        operations: ["summarize"],
        priority: 50,
      },
    ),
  ];

  const input: DirectRouteExecutionInput = {
    userPrompt: "me dá um resumo desse email uid=123",
    activeUserPrompt: "me dá um resumo desse email uid=123",
    requestId: "req-shadow",
    requestLogger: logger,
    intent: {
      rawPrompt: "me dá um resumo desse email uid=123",
      activeUserPrompt: "me dá um resumo desse email uid=123",
      historyUserTurns: [],
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          confidence: 0.9,
          actionMode: "communicate",
          reasons: ["eval"],
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "draft_with_confirmation",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: true,
            canDraftExternalReplies: true,
            canSendExternalReplies: false,
            canWriteWorkspace: false,
            canPersistMemory: true,
            canRunProjectTools: false,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
      mentionedDomains: ["secretario_operacional"],
      compoundIntent: false,
      turnFrame: buildTurnFrame({ text: "me dá um resumo desse email uid=123" }),
    },
    orchestration: {
      route: {
        primaryDomain: "secretario_operacional",
        secondaryDomains: [],
        confidence: 0.9,
        actionMode: "communicate",
        reasons: ["eval"],
      },
      policy: {
        riskLevel: "low",
        autonomyLevel: "draft_with_confirmation",
        guardrails: [],
        requiresApprovalFor: [],
        capabilities: {
          canReadSensitiveChannels: true,
          canDraftExternalReplies: true,
          canSendExternalReplies: false,
          canWriteWorkspace: false,
          canPersistMemory: true,
          canRunProjectTools: false,
          canModifyCalendar: false,
          canPublishContent: false,
        },
      },
    },
    preferences: {
      responseStyle: "secretary",
      responseLength: "short",
      proactiveNextStep: false,
      autoSourceFallback: false,
      preferredAgentName: "Atlas",
    },
  };

  const result = await runner.run(input, routes);
  const auditRows = audit.listRecent(5);
  const latest = auditRows[0];

  const results: EvalResult[] = [
    {
      name: "shadow_mode_keeps_legacy_execution",
      passed: result?.reply === "legacy response",
      detail: JSON.stringify(result, null, 2),
    },
    {
      name: "shadow_mode_records_selector_divergence",
      passed: latest?.selectedRoute === "intent_target"
        && latest?.legacyRoute === "legacy_first"
        && latest?.executedRoute === "legacy_first"
        && latest?.divergence === true,
      detail: JSON.stringify(latest, null, 2),
    },
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

  console.log(`\nRouting shadow evals ok: ${results.length}/${results.length}`);
}

void run();
