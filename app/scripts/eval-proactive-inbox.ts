import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strict as assert } from "node:assert";
import { ObservationStore } from "../src/core/autonomy/observation-store.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "../src/core/autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "../src/core/autonomy/feedback-store.js";
import { AutonomyDirectService } from "../src/core/autonomy/autonomy-direct-service.js";
import { BriefRenderer } from "../src/core/brief-renderer.js";
import type { Logger } from "../src/types/logger.js";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

const orchestration = {
  route: {
    primaryDomain: "secretario_operacional" as const,
    secondaryDomains: [],
    confidence: 0.9,
    actionMode: "communicate" as const,
    reasons: [],
  },
  policy: {
    riskLevel: "low" as const,
    autonomyLevel: "draft_with_confirmation" as const,
    guardrails: [],
    requiresApprovalFor: [],
    capabilities: {
      canReadSensitiveChannels: true,
      canDraftExternalReplies: true,
      canSendExternalReplies: false,
      canWriteWorkspace: true,
      canPersistMemory: true,
      canRunProjectTools: false,
      canModifyCalendar: false,
      canPublishContent: false,
    },
  },
};

function createWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "atlas-proactive-inbox-"));
}

function seedStores(root: string) {
  const dbPath = path.join(root, "autonomy.sqlite");
  const observations = new ObservationStore(dbPath, logger);
  const suggestions = new SuggestionStore(dbPath, logger);
  const audit = new AutonomyAuditStore(dbPath, logger);
  const feedback = new FeedbackStore(dbPath, logger);

  const observation = observations.upsert({
    fingerprint: "goal-risk:fechar-clientes",
    kind: "goal_at_risk",
    sourceKind: "system",
    sourceTrust: "owned_account",
    title: "Meta de receita perto do prazo",
    summary: "Fechar 2 clientes SaaS segue sem avanço claro e o prazo está perto.",
    evidence: [
      "Objetivo ativo com prazo em 3 dias.",
      "Progresso ainda em 10%.",
    ],
    observedAt: "2026-04-21T08:00:00.000Z",
    expiresAt: "2026-04-24T18:00:00.000Z",
  });

  const suggestion = suggestions.upsert({
    observationId: observation.id,
    fingerprint: observation.fingerprint,
    title: "Revisar plano para fechar 2 clientes SaaS",
    body: "O objetivo está perto do prazo e ainda sem progresso suficiente.",
    explanation: "Prazo próximo com progresso muito baixo aumenta o risco de não fechar a meta.",
    status: "queued",
    priority: 0.87,
    requiresApproval: false,
  });

  return { observations, suggestions, audit, feedback, observation, suggestion };
}

async function main(): Promise<void> {
  const workspace = createWorkspace();

  try {
    const { observations, suggestions, audit, feedback, suggestion } = seedStores(workspace);
    const service = new AutonomyDirectService({
      logger,
      loop: { runOnce: async () => ({ observations: [], assessments: [], suggestions: [] }) },
      actionService: {
        approveSuggestion: async (approvedSuggestion) => {
          suggestions.updateStatus({
            id: approvedSuggestion.id,
            status: "approved",
          });
          feedback.record({
            suggestionId: approvedSuggestion.id,
            feedbackKind: "accepted",
            note: "approved_in_eval_stub",
          });
          return {
            kind: "approved_only" as const,
            reply: `Marquei isso como aprovado: ${approvedSuggestion.title}. Vou tratar como direção confirmada daqui para frente.`,
          };
        },
      },
      suggestions,
      observations,
      audit,
      feedback,
      buildBaseMessages: () => [],
    });

    const listResult = await service.tryRunAutonomyReview({
      userPrompt: "o que eu preciso revisar?",
      requestId: "req-list",
      orchestration,
    });
    assert.ok(listResult);
    assert.match(listResult!.reply, /Separei 1 ponto\(s\) para revisão agora:/);
    assert.match(listResult!.reply, /por que a 1\?/i);
    assert.equal(suggestions.getById(suggestion.id)?.status, "notified");

    const explainResult = await service.tryRunAutonomyReview({
      userPrompt: "por que a 1?",
      requestId: "req-why",
      orchestration,
    });
    assert.ok(explainResult);
    assert.match(explainResult!.reply, /Prazo próximo com progresso muito baixo/i);
    assert.match(explainResult!.reply, /Objetivo ativo com prazo em 3 dias/i);

    const approveResult = await service.tryRunAutonomyReview({
      userPrompt: "aprova a 1",
      requestId: "req-approve",
      orchestration,
    });
    assert.ok(approveResult);
    assert.equal(suggestions.getById(suggestion.id)?.status, "approved");
    assert.equal(feedback.listBySuggestion(suggestion.id)[0]?.feedbackKind, "accepted");

    suggestions.updateStatus({
      id: suggestion.id,
      status: "notified",
    });

    const dismissResult = await service.tryRunAutonomyReview({
      userPrompt: "ignora a 1",
      requestId: "req-dismiss",
      orchestration,
    });
    assert.ok(dismissResult);
    assert.equal(suggestions.getById(suggestion.id)?.status, "dismissed");

    suggestions.updateStatus({
      id: suggestion.id,
      status: "notified",
    });

    const snoozeResult = await service.tryRunAutonomyReview({
      userPrompt: "adia a 1 para amanhã às 9h",
      requestId: "req-snooze",
      orchestration,
    });
    assert.ok(snoozeResult);
    assert.equal(suggestions.getById(suggestion.id)?.status, "snoozed");
    assert.ok(suggestions.getById(suggestion.id)?.snoozedUntil);

    const briefRenderer = new BriefRenderer();
    const brief = briefRenderer.render({
      timezone: "America/Sao_Paulo",
      events: [],
      taskBuckets: {
        today: [],
        overdue: [],
        stale: [],
        actionableCount: 0,
      },
      emails: [],
      autonomySuggestions: [
        {
          id: suggestion.id,
          title: "Revisar plano para fechar 2 clientes SaaS",
          body: "O objetivo está perto do prazo e ainda sem progresso suficiente.",
          priority: 0.87,
          requiresApproval: false,
        },
      ],
      approvals: [],
      workflows: [],
      focus: [],
      memoryEntities: {
        total: 0,
        byKind: {},
        recent: [],
      },
      motivation: {
        text: "Um passo claro já melhora o dia.",
      },
      founderSnapshot: {
        executiveLine: "Founder brief indisponível.",
        sections: [],
        trackedMetrics: [],
      },
      personalFocus: [],
      overloadLevel: "leve",
      mobilityAlerts: [],
      operationalSignals: [],
      conflictSummary: {
        overlaps: 0,
        duplicates: 0,
        naming: 0,
      },
    });
    assert.match(brief, /\*Pontos para revisar\*/);
    assert.match(brief, /Revisar plano para fechar 2 clientes SaaS/);

    const audits = audit.listRecent(12);
    assert.ok(audits.some((item) => item.kind === "suggestion_status_changed"));

    console.log("eval-proactive-inbox: 6/6 passed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("eval-proactive-inbox failed");
  console.error(error);
  process.exitCode = 1;
});
