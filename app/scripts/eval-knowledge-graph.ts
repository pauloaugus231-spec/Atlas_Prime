import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { CommitmentStore } from "../src/core/autonomy/commitment-store.js";
import { EntityStore } from "../src/core/knowledge-graph/entity-store.js";
import { GraphIngestionService } from "../src/core/knowledge-graph/graph-ingestion.js";
import { GraphQueryService } from "../src/core/knowledge-graph/graph-query.js";
import { RelationshipStore as GraphRelationshipStore } from "../src/core/knowledge-graph/relationship-store.js";
import { MissionService } from "../src/core/missions/mission-service.js";
import { MissionStore } from "../src/core/missions/mission-store.js";
import { ResearchMemoryStore } from "../src/core/research/research-memory-store.js";
import { ResearchDeskService } from "../src/core/research/research-desk-service.js";
import { SourcePolicy } from "../src/core/research/source-policy.js";
import { RelationshipService } from "../src/core/relationship/relationship-service.js";
import { RelationshipStore } from "../src/core/relationship/relationship-store.js";
import type { Logger } from "../src/types/logger.js";

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
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-knowledge-graph-"));
  const dbPath = path.join(sandboxDir, "knowledge.sqlite");
  const results: EvalResult[] = [];

  try {
    const entities = new EntityStore(dbPath, logger);
    const graphRelationships = new GraphRelationshipStore(dbPath, logger);
    const graph = new GraphIngestionService(entities, graphRelationships, logger);
    const query = new GraphQueryService(entities, graphRelationships, logger);
    const commitments = new CommitmentStore(dbPath, logger);
    const relationshipService = new RelationshipService(
      new RelationshipStore(dbPath, logger),
      { listLeads: () => [] },
      { listContacts: () => [] },
      commitments,
      logger,
      graph,
    );
    const missionService = new MissionService(new MissionStore(dbPath, logger), commitments, logger, graph);
    const researchDesk = new ResearchDeskService(
      new ResearchMemoryStore(dbPath, logger),
      new SourcePolicy(),
      () => ({
        search: async () => [
          {
            title: "Guia operacional de oficina",
            url: "https://www.gov.br/transportes/oficina-guia",
            sourceHost: "www.gov.br",
            snippet: "Guia oficial para oficinas.",
            excerpt: "Procedimentos operacionais.",
          },
        ],
      }),
      logger,
      graph,
    );

    const commitment = commitments.upsert({
      sourceKind: "telegram",
      sourceTrust: "operator",
      statement: "Retornar para Maria com a proposta.",
      normalizedAction: "Retornar para Maria com a proposta",
      confidence: 0.94,
      evidence: ["chat"],
      status: "confirmed",
    });
    const profile = relationshipService.saveManual({
      displayName: "Contato Maria",
      kind: "client",
      nextFollowUpAt: "2026-04-23T12:00:00.000Z",
    });
    const mission = missionService.create({
      title: "Retornar para Maria com a proposta",
      nextAction: "Enviar proposta ainda hoje",
    });
    graph.linkRelationshipToMission(profile, mission);

    const mariaKnowledge = query.explain("Contato Maria");
    const missionKnowledge = query.explain("Retornar para Maria com a proposta");
    results.push({
      name: "knowledge_graph_ingests_entities_and_links_relationships",
      passed:
        mariaKnowledge.includes("Conhecimento sobre Contato Maria")
        && mariaKnowledge.includes("Relações: 1")
        && missionKnowledge.includes("supports"),
      detail: JSON.stringify({ mariaKnowledge, missionKnowledge, commitment }, null, 2),
    });

    await researchDesk.researchAndSave({ topic: "oficinas mecânicas" });
    const researchKnowledge = query.explain("oficinas mecânicas");
    results.push({
      name: "knowledge_graph_ingests_research_sessions",
      passed: researchKnowledge.includes("research_session"),
      detail: researchKnowledge,
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

  console.log(`\nKnowledge graph evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
