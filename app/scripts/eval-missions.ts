import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { CommitmentStore } from "../src/core/autonomy/commitment-store.js";
import { EntityStore } from "../src/core/knowledge-graph/entity-store.js";
import { GraphIngestionService } from "../src/core/knowledge-graph/graph-ingestion.js";
import { RelationshipStore as GraphRelationshipStore } from "../src/core/knowledge-graph/relationship-store.js";
import { MissionDirectService } from "../src/core/mission-direct-service.js";
import { MissionReviewService } from "../src/core/missions/mission-review.js";
import { MissionService } from "../src/core/missions/mission-service.js";
import { MissionStore } from "../src/core/missions/mission-store.js";
import type { Logger } from "../src/types/logger.js";
import type { Mission } from "../src/types/mission.js";

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

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-missions-"));
  const dbPath = path.join(sandboxDir, "missions.sqlite");
  const results: EvalResult[] = [];

  try {
    const commitments = new CommitmentStore(dbPath, logger);
    const entities = new EntityStore(dbPath, logger);
    const relationships = new GraphRelationshipStore(dbPath, logger);
    const graph = new GraphIngestionService(entities, relationships, logger);
    const missionStore = new MissionStore(dbPath, logger);
    const missions = new MissionService(missionStore, commitments, logger, graph);
    const review = new MissionReviewService(missionStore, logger);
    const direct = new MissionDirectService({
      logger,
      missions,
      missionReview: review,
      buildBaseMessages: () => [],
    });

    const commitment = commitments.upsert({
      sourceKind: "telegram",
      sourceTrust: "operator",
      statement: "Lançar produto digital até sexta.",
      normalizedAction: "Lançar produto digital",
      confidence: 0.92,
      evidence: ["chat"],
      status: "confirmed",
    });
    const mission = missions.create({
      title: "Lançar produto digital",
      nextAction: "Falar com 3 leads hoje",
      risks: ["Oferta ainda não validada."],
    });
    const missionStatus = missions.renderStatus("Lançar produto digital");
    const missionNextAction = missions.renderNextAction("Lançar produto digital");
    const missionRisks = missions.renderRisks("Lançar produto digital");
    results.push({
      name: "missions_create_status_and_supporting_commitments",
      passed:
        mission.supportingCommitmentIds.includes(commitment.id)
        && missionStatus.includes("Lançar produto digital")
        && missionNextAction.includes("Falar com 3 leads hoje")
        && missionRisks.includes("Oferta ainda não validada"),
      detail: JSON.stringify({ mission, missionStatus, missionNextAction, missionRisks }, null, 2),
    });

    const staleMission: Mission = {
      ...mission,
      id: "mission-stale",
      title: "Missão parada",
      nextAction: "Retomar plano",
      supportingCommitmentIds: [],
      updatedAt: "2026-04-10T12:00:00.000Z",
    };
    const blockedMission: Mission = {
      ...mission,
      id: "mission-blocked",
      title: "Missão bloqueada",
      status: "blocked",
      nextAction: "Desbloquear dependência",
      supportingCommitmentIds: [],
      updatedAt: new Date().toISOString(),
    };
    missionStore.upsert(staleMission);
    missionStore.upsert(blockedMission);
    const reviewReply = review.renderReview();
    results.push({
      name: "missions_review_flags_stale_and_blocked_work",
      passed: reviewReply.includes("Parada: Missão parada") && reviewReply.includes("Bloqueada: Missão bloqueada"),
      detail: reviewReply,
    });

    const createdViaPrompt = direct.tryRun({
      userPrompt: 'crie missão "Fechar parceria comercial"',
      requestId: "mission-direct-1",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    const nextActionViaPrompt = direct.tryRun({
      userPrompt: 'próxima ação da missão "Fechar parceria comercial"',
      requestId: "mission-direct-2",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    results.push({
      name: "missions_direct_service_understands_natural_prompts",
      passed:
        createdViaPrompt?.reply.includes("Missão criada") === true
        && nextActionViaPrompt?.reply.includes("definir primeiro passo") === true,
      detail: JSON.stringify({ createdViaPrompt, nextActionViaPrompt }, null, 2),
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

  console.log(`\nMission evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
