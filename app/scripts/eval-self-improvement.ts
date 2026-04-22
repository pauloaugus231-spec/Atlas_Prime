import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { FailedRequestStore } from "../src/core/self-improvement/failed-request-store.js";
import { ImprovementBacklogStore } from "../src/core/self-improvement/improvement-backlog.js";
import { ProductFeedbackStore } from "../src/core/self-improvement/product-feedback-store.js";
import { SelfImprovementService } from "../src/core/self-improvement/self-improvement-service.js";
import { SelfImprovementDirectService } from "../src/core/self-improvement-direct-service.js";
import { RequestOrchestrator } from "../src/core/request-orchestrator.js";
import type { Logger } from "../src/types/logger.js";
import type { ProductGapRecord } from "../src/types/product-gaps.js";
import type { AssistantActionDispatcher } from "../src/core/action-dispatcher.js";
import type { AgentCoreRequestRuntime } from "../src/core/agent-core.js";

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

function openGap(): ProductGapRecord {
  return {
    id: 77,
    description: "Usuário pediu resposta em áudio e TTS ainda não existe.",
    inferredObjective: "Responder em áudio",
    missingCapabilities: ["tts.reply"],
    impact: "high",
    occurrences: 3,
    status: "open",
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-22T08:00:00.000Z",
  };
}

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-self-improvement-"));
  const dbPath = path.join(sandboxDir, "self-improvement.sqlite");
  const results: EvalResult[] = [];

  try {
    const failedRequests = new FailedRequestStore(dbPath, logger);
    const feedback = new ProductFeedbackStore(dbPath, logger);
    const backlog = new ImprovementBacklogStore(dbPath, logger);
    const service = new SelfImprovementService(
      { listProductGaps: () => [openGap()] },
      failedRequests,
      feedback,
      backlog,
      logger,
    );
    const direct = new SelfImprovementDirectService({
      logger,
      selfImprovement: service,
      buildBaseMessages: () => [],
    });

    const initialBacklog = service.renderBacklog();
    results.push({
      name: "self_improvement_includes_open_product_gaps",
      passed: initialBacklog.includes("Responder em áudio") && initialBacklog.includes("tts.reply"),
      detail: initialBacklog,
    });

    const failure1 = service.recordFailedRequest({
      channel: "telegram",
      prompt: "me responda em áudio",
      errorMessage: "TTS indisponível",
      errorKind: "tts_unavailable",
    });
    const failure2 = service.recordFailedRequest({
      channel: "telegram",
      prompt: "me responda em áudio",
      errorMessage: "TTS indisponível",
      errorKind: "tts_unavailable",
    });
    results.push({
      name: "self_improvement_dedupes_failed_requests_by_signature",
      passed: failure1.id === failure2.id && failure2.recurrence === 2,
      detail: JSON.stringify({ failure1, failure2 }, null, 2),
    });

    const savedFeedback = service.recordFeedback({
      channel: "telegram",
      feedback: "As entregas por email ainda precisam de preview melhor.",
    });
    const recentFailures = service.renderRecentFailures();
    const refreshedBacklog = service.renderBacklog();
    results.push({
      name: "self_improvement_promotes_feedback_and_failures_into_backlog",
      passed:
        savedFeedback.feedback.includes("preview")
        && recentFailures.includes("recorrência 2")
        && refreshedBacklog.includes("Feedback de produto via telegram")
        && refreshedBacklog.includes("Falha recorrente em telegram"),
      detail: JSON.stringify({ recentFailures, refreshedBacklog }, null, 2),
    });

    const directReply = direct.tryRun({
      userPrompt: "registre feedback: o atlas ainda precisa melhorar o preview do email",
      requestId: "self-improvement-direct-1",
      orchestration: {
        route: { primaryDomain: "orchestrator", secondaryDomains: [], confidence: 1, actionMode: "communicate", reasons: [] },
        policy: {
          riskLevel: "low",
          autonomyLevel: "observe_only",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: false,
            canDraftExternalReplies: false,
            canSendExternalReplies: false,
            canWriteWorkspace: false,
            canPersistMemory: true,
            canRunProjectTools: false,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
    });
    results.push({
      name: "self_improvement_direct_service_accepts_natural_feedback",
      passed: directReply?.reply.includes("Feedback registrado para o Atlas") === true,
      detail: JSON.stringify(directReply, null, 2),
    });

    const orchestrator = new RequestOrchestrator(
      {
        runUserPrompt: async () => {
          throw new Error("upstream failure");
        },
      } as AgentCoreRequestRuntime,
      {
        resolveStructuredReply: async () => ({ handled: false, visibleReply: "" }),
      } as unknown as AssistantActionDispatcher,
      logger,
      undefined,
      undefined,
      service,
    );
    let captured = false;
    try {
      await orchestrator.run({
        channel: "telegram",
        agentPrompt: "falhe de propósito",
        recentMessages: [],
      });
    } catch {
      captured = true;
    }
    const failuresAfterOrchestrator = service.renderRecentFailures();
    results.push({
      name: "self_improvement_request_orchestrator_captures_failures",
      passed:
        captured === true
        && failuresAfterOrchestrator.includes("Error")
        && failuresAfterOrchestrator.includes("telegram"),
      detail: failuresAfterOrchestrator,
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }
  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nSelf improvement evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
