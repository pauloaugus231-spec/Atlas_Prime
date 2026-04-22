import path from "node:path";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ApprovalPolicyService } from "../approval-policy.js";
import { ContextMemoryService } from "../context-memory.js";
import { DecisionsLoader } from "../decisions-loader.js";
import { EntityLinker } from "../entity-linker.js";
import { IntentRouter } from "../intent-router.js";
import { GraphIngestionService } from "../knowledge-graph/graph-ingestion.js";
import { GraphQueryService } from "../knowledge-graph/graph-query.js";
import { ReasoningEngine } from "../reasoning-engine.js";
import { ResearchDeskService } from "../research/research-desk-service.js";
import { SourcePolicy } from "../research/source-policy.js";
import { ResponseOS } from "../response-os.js";
import { UserModelTracker } from "../user-model-tracker.js";
import { WebResearchService } from "../web-research.js";
import type { BootstrapLayer, IntelligenceLayer, StorageLayer } from "./types.js";

export function createIntelligenceLayer(
  bootstrap: Pick<BootstrapLayer, "config" | "logger" | "fileAccess">,
  storage: Pick<StorageLayer, "goalStore" | "personalMemory" | "memory" | "memoryEntities" | "researchMemory" | "knowledgeEntities" | "knowledgeRelationships">,
): IntelligenceLayer {
  const { config, logger, fileAccess } = bootstrap;
  const reasoningEngine = new ReasoningEngine(
    storage.goalStore,
    storage.personalMemory,
    storage.memory,
    logger.child({ scope: "reasoning-engine" }),
  );
  const userModelTracker = UserModelTracker.open(
    config.paths.userBehaviorModelDbPath,
    logger.child({ scope: "user-model-tracker" }),
  );
  const entityLinker = new EntityLinker(storage.memoryEntities);
  const approvalPolicy = new ApprovalPolicyService();
  const contextMemory = new ContextMemoryService(
    storage.memoryEntities,
    logger.child({ scope: "context-memory" }),
  );
  const decisionsLoader = new DecisionsLoader(
    fileAccess,
    logger.child({ scope: "decisions-loader" }),
    path.resolve(config.paths.appHome, "..", "DECISIONS.md"),
  );
  const sourcePolicy = new SourcePolicy();
  const graphIngestion = new GraphIngestionService(
    storage.knowledgeEntities,
    storage.knowledgeRelationships,
    logger.child({ scope: "graph-ingestion" }),
  );
  const graphQuery = new GraphQueryService(
    storage.knowledgeEntities,
    storage.knowledgeRelationships,
    logger.child({ scope: "graph-query" }),
  );
  const researchDesk = new ResearchDeskService(
    storage.researchMemory,
    sourcePolicy,
    (researchLogger) => new WebResearchService(researchLogger),
    logger.child({ scope: "research-desk" }),
    graphIngestion,
  );

  return {
    reasoningEngine,
    userModelTracker,
    entityLinker,
    approvalPolicy,
    contextMemory,
    decisionsLoader,
    intentRouter: new IntentRouter(),
    responseOs: new ResponseOS(),
    sourcePolicy,
    researchDesk,
    graphIngestion,
    graphQuery,
  };
}
