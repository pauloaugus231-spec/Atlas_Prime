import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strict as assert } from "node:assert";
import { ObservationStore } from "../src/core/autonomy/observation-store.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "../src/core/autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "../src/core/autonomy/feedback-store.js";
import { AutonomyDirectService } from "../src/core/autonomy/autonomy-direct-service.js";
import { AutonomyPolicy } from "../src/core/autonomy/autonomy-policy.js";
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
    confidence: 0.92,
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

async function main(): Promise<void> {
  const workspace = mkdtempSync(path.join(tmpdir(), "atlas-autonomy-review-"));

  try {
    const dbPath = path.join(workspace, "autonomy.sqlite");
    const observations = new ObservationStore(dbPath, logger);
    const suggestions = new SuggestionStore(dbPath, logger);
    const audit = new AutonomyAuditStore(dbPath, logger);
    const feedback = new FeedbackStore(dbPath, logger);

    const firstObservation = observations.upsert({
      fingerprint: "goal:review-1",
      kind: "goal_at_risk",
      sourceKind: "system",
      sourceTrust: "owned_account",
      title: "Meta em risco: fechar clientes",
      summary: "Meta com prazo próximo e progresso baixo.",
      evidence: ["deadline em 3 dias"],
      observedAt: "2026-04-21T08:00:00.000Z",
    });
    const secondObservation = observations.upsert({
      fingerprint: "reply:review-2",
      kind: "pending_reply",
      sourceKind: "whatsapp",
      sourceTrust: "owned_account",
      title: "Resposta pendente do institucional",
      summary: "Existe um retorno importante pendente.",
      evidence: ["alerta monitorado"],
      observedAt: "2026-04-21T09:00:00.000Z",
    });

    const firstSuggestion = suggestions.upsert({
      observationId: firstObservation.id,
      fingerprint: firstObservation.fingerprint,
      title: firstObservation.title,
      body: firstObservation.summary,
      explanation: "Meta segue sem progresso suficiente.",
      status: "queued",
      priority: 0.82,
      requiresApproval: false,
    });
    const secondSuggestion = suggestions.upsert({
      observationId: secondObservation.id,
      fingerprint: secondObservation.fingerprint,
      title: secondObservation.title,
      body: secondObservation.summary,
      explanation: "Resposta externa importante ainda pendente.",
      status: "notified",
      priority: 0.68,
      requiresApproval: false,
    });

    feedback.record({ suggestionId: firstSuggestion.id, feedbackKind: "dismissed", createdAt: "2026-04-18T10:00:00.000Z" });
    feedback.record({ suggestionId: firstSuggestion.id, feedbackKind: "dismissed", createdAt: "2026-04-19T10:00:00.000Z" });
    feedback.record({ suggestionId: firstSuggestion.id, feedbackKind: "dismissed", createdAt: "2026-04-20T10:00:00.000Z" });
    feedback.record({ suggestionId: secondSuggestion.id, feedbackKind: "accepted", createdAt: "2026-04-20T12:00:00.000Z" });
    feedback.record({ suggestionId: secondSuggestion.id, feedbackKind: "snoozed", createdAt: "2026-04-20T18:00:00.000Z" });

    const service = new AutonomyDirectService({
      logger,
      loop: { runOnce: async () => ({ observations: [], assessments: [], suggestions: [] }) },
      actionService: { approveSuggestion: async () => ({ kind: "approved_only" as const, reply: "ok" }) },
      suggestions,
      observations,
      audit,
      feedback,
      buildBaseMessages: () => [],
    });

    const review = await service.tryRunAutonomyReview({
      userPrompt: "revisão da semana",
      requestId: "weekly-1",
      orchestration,
    });
    assert.ok(review);
    assert.match(review!.reply, /Fechamento da semana na fila de autonomia:/);
    assert.match(review!.reply, /aprovadas ou executadas: 1/);
    assert.match(review!.reply, /descartadas: 3/);
    assert.match(review!.reply, /Ainda abertas:/);
    assert.match(review!.reply, /vou reduzir a insistência nisso/i);

    const policy = new AutonomyPolicy();
    const feedbackDecision = policy.shouldRequeueFromFeedback(feedback.listBySuggestion(firstSuggestion.id), "2026-04-21T12:00:00.000Z");
    assert.equal(feedbackDecision.allow, false);
    assert.ok(policy.adjustPriorityForFeedback(0.8, feedback.listBySuggestion(firstSuggestion.id)) < 0.8);
    assert.equal(policy.isQuietHours("2026-04-21T23:15:00.000-03:00"), true);
    assert.equal(policy.isQuietHours("2026-04-21T15:15:00.000-03:00"), false);

    console.log("eval-autonomy-review: 5/5 passed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("eval-autonomy-review failed");
  console.error(error);
  process.exitCode = 1;
});
