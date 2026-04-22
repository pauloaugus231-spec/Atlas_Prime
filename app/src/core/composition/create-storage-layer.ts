import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ApprovalInboxStore } from "../approval-inbox.js";
import { ClarificationInboxStore } from "../clarification-inbox.js";
import { ContactIntelligenceStore } from "../contact-intelligence.js";
import { ContentOpsStore } from "../content-ops.js";
import { DeliveryAuditStore } from "../delivery/delivery-audit-store.js";
import { FinanceStore } from "../finance/finance-store.js";
import { GoalStore } from "../goal-store.js";
import { GrowthOpsStore } from "../growth-ops.js";
import { EntityStore } from "../knowledge-graph/entity-store.js";
import { RelationshipStore as KnowledgeRelationshipStore } from "../knowledge-graph/relationship-store.js";
import { MemoryEntityStore } from "../memory-entity-store.js";
import { MissionStore } from "../missions/mission-store.js";
import { OperationalMemoryStore } from "../operational-memory.js";
import { BrowserTaskStore } from "../operator-modes/browser-task-store.js";
import { PersonalOperationalMemoryStore } from "../personal-operational-memory.js";
import { RelationshipStore } from "../relationship/relationship-store.js";
import { ResearchMemoryStore } from "../research/research-memory-store.js";
import { RouteDecisionAuditStore } from "../routing/route-decision-audit-store.js";
import { FailedRequestStore } from "../self-improvement/failed-request-store.js";
import { ImprovementBacklogStore } from "../self-improvement/improvement-backlog.js";
import { ProductFeedbackStore } from "../self-improvement/product-feedback-store.js";
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
    financeStore: new FinanceStore(
      config.paths.financeDbPath,
      logger.child({ scope: "finance-store" }),
    ),
    relationshipStore: new RelationshipStore(
      config.paths.relationshipDbPath,
      logger.child({ scope: "relationship-store" }),
    ),
    missionStore: new MissionStore(
      config.paths.missionDbPath,
      logger.child({ scope: "mission-store" }),
    ),
    researchMemory: new ResearchMemoryStore(
      config.paths.researchDbPath,
      logger.child({ scope: "research-memory" }),
    ),
    knowledgeEntities: new EntityStore(
      config.paths.knowledgeGraphDbPath,
      logger.child({ scope: "knowledge-entities" }),
    ),
    knowledgeRelationships: new KnowledgeRelationshipStore(
      config.paths.knowledgeGraphDbPath,
      logger.child({ scope: "knowledge-relationships" }),
    ),
    deliveryAudit: new DeliveryAuditStore(
      config.paths.deliveryAuditDbPath,
      logger.child({ scope: "delivery-audit" }),
    ),
    browserTasks: new BrowserTaskStore(
      config.paths.browserOpsDbPath,
      logger.child({ scope: "browser-tasks" }),
    ),
    failedRequests: new FailedRequestStore(
      config.paths.selfImprovementDbPath,
      logger.child({ scope: "failed-requests" }),
    ),
    productFeedback: new ProductFeedbackStore(
      config.paths.selfImprovementDbPath,
      logger.child({ scope: "product-feedback" }),
    ),
    improvementBacklog: new ImprovementBacklogStore(
      config.paths.selfImprovementDbPath,
      logger.child({ scope: "improvement-backlog" }),
    ),
    routingAudit: new RouteDecisionAuditStore(
      config.paths.routingAuditDbPath,
      logger.child({ scope: "routing-audit" }),
    ),
  };
}
