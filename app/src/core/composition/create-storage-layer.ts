import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ApprovalInboxStore } from "../approval-inbox.js";
import { ClarificationInboxStore } from "../clarification-inbox.js";
import { ContactIntelligenceStore } from "../contact-intelligence.js";
import { ContentOpsStore } from "../content-ops.js";
import { GoalStore } from "../goal-store.js";
import { GrowthOpsStore } from "../growth-ops.js";
import { MemoryEntityStore } from "../memory-entity-store.js";
import { OperationalMemoryStore } from "../operational-memory.js";
import { PersonalOperationalMemoryStore } from "../personal-operational-memory.js";
import { SocialAssistantStore } from "../social-assistant.js";
import { UserPreferencesStore } from "../user-preferences.js";
import { WhatsAppMessageStore } from "../whatsapp-message-store.js";
import { WorkflowOrchestratorStore } from "../workflow-orchestrator.js";
import type { StorageLayer } from "./types.js";

export function createStorageLayer(config: AppConfig, logger: Logger): StorageLayer {
  return {
    memory: new OperationalMemoryStore(
      config.paths.memoryDbPath,
      logger.child({ scope: "operational-memory" }),
    ),
    goalStore: new GoalStore(
      config.paths.goalDbPath,
      logger.child({ scope: "goal-store" }),
    ),
    growthOps: new GrowthOpsStore(
      config.paths.growthDbPath,
      logger.child({ scope: "growth-ops" }),
    ),
    preferences: new UserPreferencesStore(
      config.paths.preferencesDbPath,
      logger.child({ scope: "user-preferences" }),
    ),
    personalMemory: new PersonalOperationalMemoryStore(
      config.paths.preferencesDbPath,
      logger.child({ scope: "personal-operational-memory" }),
    ),
    contentOps: new ContentOpsStore(
      config.paths.contentDbPath,
      logger.child({ scope: "content-ops" }),
    ),
    socialAssistant: new SocialAssistantStore(
      config.paths.socialAssistantDbPath,
      logger.child({ scope: "social-assistant" }),
    ),
    contacts: new ContactIntelligenceStore(
      config.paths.contactIntelligenceDbPath,
      logger.child({ scope: "contact-intelligence" }),
    ),
    approvals: new ApprovalInboxStore(
      config.paths.approvalInboxDbPath,
      logger.child({ scope: "approval-inbox" }),
    ),
    clarifications: new ClarificationInboxStore(
      config.paths.clarificationInboxDbPath,
      logger.child({ scope: "clarification-inbox" }),
    ),
    memoryEntities: new MemoryEntityStore(
      config.paths.memoryEntityDbPath,
      logger.child({ scope: "memory-entities" }),
    ),
    whatsappMessages: new WhatsAppMessageStore(
      config.paths.whatsappMessagesDbPath,
      logger.child({ scope: "whatsapp-messages" }),
    ),
    workflows: new WorkflowOrchestratorStore(
      config.paths.workflowDbPath,
      logger.child({ scope: "workflow-orchestrator" }),
    ),
  };
}
