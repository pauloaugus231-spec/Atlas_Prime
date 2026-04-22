import path from "node:path";
import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ApprovalPolicyService } from "../approval-policy.js";
import { ContextMemoryService } from "../context-memory.js";
import { DecisionsLoader } from "../decisions-loader.js";
import { EntityLinker } from "../entity-linker.js";
import { IntentRouter } from "../intent-router.js";
import { ReasoningEngine } from "../reasoning-engine.js";
import { ResponseOS } from "../response-os.js";
import { UserModelTracker } from "../user-model-tracker.js";
import type { BootstrapLayer, IntelligenceLayer, StorageLayer } from "./types.js";

export function createIntelligenceLayer(
  bootstrap: Pick<BootstrapLayer, "config" | "logger" | "fileAccess">,
  storage: Pick<StorageLayer, "goalStore" | "personalMemory" | "memory" | "memoryEntities">,
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

  return {
    reasoningEngine,
    userModelTracker,
    entityLinker,
    approvalPolicy,
    contextMemory,
    decisionsLoader,
    intentRouter: new IntentRouter(),
    responseOs: new ResponseOS(),
  };
}
