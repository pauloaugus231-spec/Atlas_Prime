import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ApprovalEngine } from "../approval-engine.js";
import { BriefingPrivacyPolicy } from "../briefing-privacy-policy.js";
import { BriefingProfileService } from "../briefing-profile-service.js";
import { ChannelDeliveryService } from "../delivery/channel-delivery-service.js";
import { CommandCenterService } from "../command-center/command-center-service.js";
import { DestinationRegistry } from "../destination-registry.js";
import { FinanceReviewService } from "../finance/finance-review-service.js";
import { MissionReviewService } from "../missions/mission-review.js";
import { MissionService } from "../missions/mission-service.js";
import { OperatorModeService } from "../operator-modes/operator-mode-service.js";
import { PersonalOSService } from "../personal-os.js";
import { ProfessionBootstrapService } from "../profession-bootstrap-service.js";
import { ProfessionPackService } from "../profession-pack-service.js";
import { RelationshipService } from "../relationship/relationship-service.js";
import { SelfImprovementService } from "../self-improvement/self-improvement-service.js";
import { SharedBriefingComposer } from "../shared-briefing-composer.js";
import { TimeOsService } from "../time-os-service.js";
import { UserRoleProfileService } from "../user-role-profile-service.js";
import type { AutonomyLayer, BootstrapLayer, IntegrationsLayer, IntelligenceLayer, OsLayer, StorageLayer } from "./types.js";

export function createOsLayer(
  config: AppConfig,
  logger: Logger,
  bootstrap: Pick<BootstrapLayer, "safeExec" | "projectOps">,
  storage: Pick<StorageLayer, "approvals" | "workflows" | "memory" | "memoryEntities" | "personalMemory" | "goalStore" | "growthOps" | "financeStore" | "relationshipStore" | "missionStore" | "contacts" | "deliveryAudit" | "browserTasks" | "failedRequests" | "productFeedback" | "improvementBacklog">,
  autonomy: Pick<AutonomyLayer, "autonomySuggestions" | "autonomyLoop" | "commitments">,
  intelligence: Pick<IntelligenceLayer, "approvalPolicy" | "entityLinker" | "contextMemory" | "graphIngestion">,
  integrations: Pick<IntegrationsLayer, "googleWorkspaces" | "emailAccounts" | "communicationRouter" | "founderOps" | "googleWorkspace" | "email" | "accountLinking">,
): OsLayer {
  const approvalEngine = new ApprovalEngine(
    storage.approvals,
    intelligence.approvalPolicy,
    logger.child({ scope: "approval-engine" }),
    intelligence.entityLinker,
  );
  const personalOs = new PersonalOSService(
    config.google.defaultTimezone,
    logger.child({ scope: "personal-os" }),
    config.briefing,
    integrations.googleWorkspaces,
    integrations.emailAccounts,
    integrations.communicationRouter,
    storage.approvals,
    storage.workflows,
    integrations.founderOps,
    storage.memory,
    storage.memoryEntities,
    intelligence.contextMemory,
    storage.personalMemory,
    storage.goalStore,
    autonomy.autonomySuggestions,
    autonomy.autonomyLoop,
  );
  const userRoleProfiles = new UserRoleProfileService();
  const professionPacks = new ProfessionPackService();
  const professionBootstrap = new ProfessionBootstrapService(
    professionPacks,
    userRoleProfiles,
  );
  const destinationRegistry = new DestinationRegistry(
    config.paths.destinationRegistryDbPath,
    config,
    logger.child({ scope: "destination-registry" }),
  );
  const briefingPrivacyPolicy = new BriefingPrivacyPolicy();
  const sharedBriefingComposer = new SharedBriefingComposer(briefingPrivacyPolicy);
  const briefingProfiles = new BriefingProfileService(
    storage.personalMemory,
    personalOs,
    logger.child({ scope: "briefing-profile-service" }),
    sharedBriefingComposer,
  );
  const commandCenter = new CommandCenterService({
    logger: logger.child({ scope: "command-center" }),
    approvals: storage.approvals,
    suggestions: autonomy.autonomySuggestions,
    commitments: autonomy.commitments,
    growthOps: storage.growthOps,
    personalMemory: storage.personalMemory,
    personalOs,
    googleWorkspace: integrations.googleWorkspace,
    email: integrations.email,
    whatsappConfig: config.whatsapp,
  }, logger.child({ scope: "command-center" }));
  const timeOs = new TimeOsService(
    personalOs,
    logger.child({ scope: "time-os" }),
  );
  const financeReview = new FinanceReviewService(
    storage.financeStore,
    logger.child({ scope: "finance-review" }),
  );
  const relationships = new RelationshipService(
    storage.relationshipStore,
    storage.growthOps,
    storage.contacts,
    autonomy.commitments,
    logger.child({ scope: "relationships" }),
    intelligence.graphIngestion,
  );
  const missions = new MissionService(
    storage.missionStore,
    autonomy.commitments,
    logger.child({ scope: "missions" }),
    intelligence.graphIngestion,
  );
  const missionReview = new MissionReviewService(
    storage.missionStore,
    logger.child({ scope: "mission-review" }),
  );
  const deliveryService = new ChannelDeliveryService(
    briefingProfiles,
    storage.deliveryAudit,
    logger.child({ scope: "channel-delivery" }),
  );
  const operatorModes = new OperatorModeService(
    storage.browserTasks,
    bootstrap.safeExec,
    bootstrap.projectOps,
    logger.child({ scope: "operator-modes" }),
  );
  const selfImprovement = new SelfImprovementService(
    storage.personalMemory,
    storage.failedRequests,
    storage.productFeedback,
    storage.improvementBacklog,
    logger.child({ scope: "self-improvement" }),
  );

  return {
    approvalEngine,
    personalOs,
    briefingProfiles,
    userRoleProfiles,
    professionPacks,
    professionBootstrap,
    destinationRegistry,
    briefingPrivacyPolicy,
    sharedBriefingComposer,
    commandCenter,
    timeOs,
    financeReview,
    relationships,
    missions,
    missionReview,
    deliveryService,
    operatorModes,
    selfImprovement,
  };
}
