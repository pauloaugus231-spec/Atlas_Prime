import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strict as assert } from "node:assert";
import { MemoryCandidateExtractor } from "../src/core/autonomy/memory-candidate-extractor.js";
import { MemoryCandidateStore } from "../src/core/autonomy/memory-candidate-store.js";
import { MemoryCandidateCollector } from "../src/core/autonomy/collectors/memory-candidate-collector.js";
import { RequestOrchestrator } from "../src/core/request-orchestrator.js";
import { AssistantActionDispatcher } from "../src/core/action-dispatcher.js";
import { ObservationStore } from "../src/core/autonomy/observation-store.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "../src/core/autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "../src/core/autonomy/feedback-store.js";
import { AutonomyActionService } from "../src/core/autonomy/autonomy-action-service.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import type { Logger } from "../src/types/logger.js";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

async function main(): Promise<void> {
  const workspace = mkdtempSync(path.join(tmpdir(), "atlas-memory-candidates-"));

  try {
    const autonomyDbPath = path.join(workspace, "autonomy.sqlite");
    const personalDbPath = path.join(workspace, "personal.sqlite");
    const extractor = new MemoryCandidateExtractor(logger);
    const store = new MemoryCandidateStore(autonomyDbPath, logger);
    const personalMemory = new PersonalOperationalMemoryStore(personalDbPath, logger);

    const extracted = extractor.extract({
      text: "Prefiro respostas curtas e diretas.",
      sourceKind: "operator",
      sourceId: "chat-1",
    });
    assert.equal(extracted.length, 1);
    assert.equal(extracted[0]!.kind, "style");

    const dispatcher = new AssistantActionDispatcher(
      {
        runUserPrompt: async () => ({ requestId: "req", reply: "ok", toolExecutions: [] }),
      } as never,
      logger,
    );
    const orchestrator = new RequestOrchestrator(
      {
        runUserPrompt: async () => ({ requestId: "req-2", reply: "ok", toolExecutions: [] }),
      } as never,
      dispatcher,
      logger,
      undefined,
      {
        extractor,
        store,
      },
    );

    await orchestrator.run({
      channel: "telegram",
      agentPrompt: "Prefiro respostas curtas e diretas.",
      recentMessages: [],
      options: { chatId: "chat-1" },
    });
    const stored = store.listByStatus(["candidate"], 10);
    assert.ok(stored.some((item) => item.statement.includes("Prefiro respostas curtas")));

    const collector = new MemoryCandidateCollector(store);
    const observations = collector.collect({ now: new Date().toISOString() });
    assert.ok(observations.some((item) => item.kind === "memory_candidate"));

    const observationStore = new ObservationStore(autonomyDbPath, logger);
    const suggestionStore = new SuggestionStore(autonomyDbPath, logger);
    const auditStore = new AutonomyAuditStore(autonomyDbPath, logger);
    const feedbackStore = new FeedbackStore(autonomyDbPath, logger);

    const styleCandidate = stored.find((item) => item.kind === "style")!;
    const styleObservation = observationStore.upsert(observations.find((item) => item.sourceId === styleCandidate.id)!);
    const styleSuggestion = suggestionStore.upsert({
      observationId: styleObservation.id,
      fingerprint: styleObservation.fingerprint,
      title: styleObservation.title,
      body: styleObservation.summary,
      explanation: "Preferência explícita detectada.",
      status: "queued",
      priority: 0.7,
      requiresApproval: false,
    });

    const actionService = new AutonomyActionService({
      logger,
      capabilityRegistry: { getCapability: () => null } as never,
      observations: observationStore,
      suggestions: suggestionStore,
      audit: auditStore,
      feedback: feedbackStore,
      memoryCandidates: store,
      personalMemory,
      executeToolDirect: async () => ({
        requestId: "req-x",
        content: "ok",
        rawResult: { ok: true },
      }),
    });

    const styleOutcome = await actionService.approveSuggestion(styleSuggestion);
    assert.equal(styleOutcome.kind, "approved_only");
    assert.equal(store.getById(styleCandidate.id)?.status, "active");
    assert.ok(personalMemory.listLearnedPreferences({ activeOnly: false }).some((item) => item.type === "response_style"));

    const ruleCandidate = store.upsert({
      kind: "rule",
      statement: "Sempre me lembre de levar casaco leve e carregador.",
      sourceKind: "operator",
      sourceId: "chat-1",
      evidence: ["Regra explícita informada."],
      confidence: 0.88,
      sensitivity: "normal",
      status: "candidate",
      reviewStatus: "needs_review",
    });
    const ruleObservation = observationStore.upsert({
      id: undefined,
      fingerprint: `memory-candidate:${ruleCandidate.id}`,
      kind: "memory_candidate",
      sourceKind: "system",
      sourceId: ruleCandidate.id,
      sourceTrust: "operator",
      title: `Memória candidata: ${ruleCandidate.statement}`,
      summary: `Possível memória útil detectada: ${ruleCandidate.statement}.`,
      evidence: ruleCandidate.evidence,
      observedAt: ruleCandidate.lastSeenAt,
    });
    const ruleSuggestion = suggestionStore.upsert({
      observationId: ruleObservation.id,
      fingerprint: ruleObservation.fingerprint,
      title: ruleObservation.title,
      body: ruleObservation.summary,
      explanation: "Regra operacional explícita detectada.",
      status: "queued",
      priority: 0.72,
      requiresApproval: false,
    });
    await actionService.approveSuggestion(ruleSuggestion);
    assert.equal(store.getById(ruleCandidate.id)?.status, "active");
    assert.ok(personalMemory.listItems({ search: "casaco leve", limit: 10 }).length > 0);

    console.log("eval-memory-candidates: 5/5 passed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("eval-memory-candidates failed");
  console.error(error);
  process.exitCode = 1;
});
