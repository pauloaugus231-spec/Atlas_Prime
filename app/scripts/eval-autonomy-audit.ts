import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strict as assert } from "node:assert";
import { ObservationStore } from "../src/core/autonomy/observation-store.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "../src/core/autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "../src/core/autonomy/feedback-store.js";
import { AutonomyActionService } from "../src/core/autonomy/autonomy-action-service.js";
import { extractPendingActionDraft } from "../src/core/draft-action-service.js";
import type { Logger } from "../src/types/logger.js";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function createWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "atlas-autonomy-audit-"));
}

function createStores(root: string) {
  const dbPath = path.join(root, "autonomy.sqlite");
  return {
    observations: new ObservationStore(dbPath, logger),
    suggestions: new SuggestionStore(dbPath, logger),
    audit: new AutonomyAuditStore(dbPath, logger),
    feedback: new FeedbackStore(dbPath, logger),
  };
}

async function main(): Promise<void> {
  const workspace = createWorkspace();

  try {
    const { observations, suggestions, audit, feedback } = createStores(workspace);
    const observation = observations.upsert({
      fingerprint: "goal:receita-em-risco",
      kind: "goal_at_risk",
      sourceKind: "system",
      sourceTrust: "owned_account",
      title: "Meta comercial em risco",
      summary: "A meta de receita está perto do prazo.",
      evidence: ["Progresso em 10%.", "Prazo em 3 dias."],
      observedAt: "2026-04-21T08:00:00.000Z",
    });

    const actionService = new AutonomyActionService({
      logger,
      capabilityRegistry: {
        getCapability: (name: string) => {
          if (name === "low.read") {
            return {
              name,
              domain: "secretario_operacional",
              description: "Leitura direta",
              inputSchema: { type: "object", properties: {}, additionalProperties: true },
              risk: "low",
              sideEffects: ["read"],
              requiresApproval: false,
            };
          }
          if (name === "high.send") {
            return {
              name,
              domain: "secretario_operacional",
              description: "Envio controlado",
              inputSchema: { type: "object", properties: {}, additionalProperties: true },
              risk: "high",
              sideEffects: ["send"],
              requiresApproval: true,
              sendsToExternalRecipient: true,
              auditRequired: true,
              autonomyLevel: "L5",
            };
          }
          return null;
        },
      },
      observations,
      suggestions,
      audit,
      feedback,
      executeToolDirect: async (toolName) => ({
        requestId: `req-${toolName}`,
        content: `execução ${toolName} ok`,
        rawResult: { ok: true, toolName },
      }),
    });

    const plainSuggestion = suggestions.upsert({
      observationId: observation.id,
      fingerprint: "goal:plain",
      title: "Revisar a meta comercial",
      body: "Vale revisar a abordagem desta semana.",
      explanation: "Meta próxima do prazo.",
      status: "queued",
      priority: 0.7,
      requiresApproval: false,
    });
    const plainOutcome = await actionService.approveSuggestion(plainSuggestion);
    assert.equal(plainOutcome.kind, "approved_only");
    assert.equal(suggestions.getById(plainSuggestion.id)?.status, "approved");

    const directSuggestion = suggestions.upsert({
      observationId: observation.id,
      fingerprint: "goal:direct-exec",
      title: "Ler o panorama atual",
      body: "Executar leitura direta do panorama.",
      explanation: "Leitura sem efeito colateral.",
      status: "queued",
      priority: 0.72,
      requiresApproval: false,
      suggestedAction: {
        capabilityName: "low.read",
        arguments: { now: true },
      },
    });
    const directOutcome = await actionService.approveSuggestion(directSuggestion);
    assert.equal(directOutcome.kind, "executed");
    assert.equal(suggestions.getById(directSuggestion.id)?.status, "executed");
    assert.equal(feedback.listBySuggestion(directSuggestion.id)[0]?.feedbackKind, "executed");

    const approvalSuggestion = suggestions.upsert({
      observationId: observation.id,
      fingerprint: "goal:approval-needed",
      title: "Enviar follow-up curto",
      body: "Preparar follow-up para o lead parado.",
      explanation: "A oportunidade pode esfriar sem retorno.",
      status: "queued",
      priority: 0.82,
      requiresApproval: true,
      suggestedAction: {
        capabilityName: "high.send",
        arguments: { leadId: "42", body: "Posso te mandar a proposta hoje?" },
      },
    });
    const approvalOutcome = await actionService.approveSuggestion(approvalSuggestion);
    assert.equal(approvalOutcome.kind, "approval_requested");
    assert.equal(suggestions.getById(approvalSuggestion.id)?.status, "approved");
    const pendingDraft = extractPendingActionDraft(approvalOutcome.reply);
    assert.ok(pendingDraft);
    assert.equal(pendingDraft?.kind, "autonomy_capability");

    const audits = audit.listRecent(20);
    assert.ok(audits.some((item) => item.kind === "suggestion_action_planned"));
    assert.ok(audits.some((item) => item.kind === "suggestion_action_executed"));
    assert.ok(audits.some((item) => item.kind === "suggestion_action_approval_requested"));

    console.log("eval-autonomy-audit: 3/3 passed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("eval-autonomy-audit failed");
  console.error(error);
  process.exitCode = 1;
});
