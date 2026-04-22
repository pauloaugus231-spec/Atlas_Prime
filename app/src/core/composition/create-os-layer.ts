import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { ApprovalEngine } from "../approval-engine.js";
import { BriefingPrivacyPolicy } from "../briefing-privacy-policy.js";
import { BriefingProfileService } from "../briefing-profile-service.js";
import { CommandCenterService } from "../command-center/command-center-service.js";
import { DestinationRegistry } from "../destination-registry.js";
import { PersonalOSService } from "../personal-os.js";
import { ProfessionBootstrapService } from "../profession-bootstrap-service.js";
import { ProfessionPackService } from "../profession-pack-service.js";
import { SharedBriefingComposer } from "../shared-briefing-composer.js";
import { UserRoleProfileService } from "../user-role-profile-service.js";
import type { AutonomyLayer, IntegrationsLayer, IntelligenceLayer, OsLayer, StorageLayer } from "./types.js";

export function createOsLayer(
  config: AppConfig,
  logger: Logger,
  storage: Pick<StorageLayer, "approvals" | "workflows" | "memory" | "memoryEntities" | "personalMemory" | "goalStore" | "growthOps">,
  autonomy: Pick<AutonomyLayer, "autonomySuggestions" | "autonomyLoop" | "commitments">,
  intelligence: Pick<IntelligenceLayer, "approvalPolicy" | "entityLinker" | "contextMemory">,
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
  };
}
