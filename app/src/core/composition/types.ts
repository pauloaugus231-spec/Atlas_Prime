import type { LlmClient } from "../../types/llm.js";
import type { Logger } from "../../types/logger.js";
import type { LoadedToolPlugin } from "../../types/plugin.js";
import type { AppConfig } from "../../types/config.js";
import type { ApprovalEngine } from "../approval-engine.js";
import type { ApprovalPolicyService } from "../approval-policy.js";
import type { ApprovalInboxStore } from "../approval-inbox.js";
import type { AssistantActionDispatcher } from "../action-dispatcher.js";
import type { AutonomyAssessor } from "../autonomy/autonomy-assessor.js";
import type { AutonomyAuditStore } from "../autonomy/autonomy-audit-store.js";
import type { AutonomyLoop } from "../autonomy/autonomy-loop.js";
import type { AutonomyPolicy } from "../autonomy/autonomy-policy.js";
import type { CommitmentExtractor } from "../autonomy/commitment-extractor.js";
import type { CommitmentStore } from "../autonomy/commitment-store.js";
import type { FeedbackStore } from "../autonomy/feedback-store.js";
import type { MemoryCandidateExtractor } from "../autonomy/memory-candidate-extractor.js";
import type { MemoryCandidateStore } from "../autonomy/memory-candidate-store.js";
import type { ObservationStore } from "../autonomy/observation-store.js";
import type { SuggestionStore } from "../autonomy/suggestion-store.js";
import type { BriefingProfileService } from "../briefing-profile-service.js";
import type { BriefingPrivacyPolicy } from "../briefing-privacy-policy.js";
import type { CapabilityRegistry } from "../capability-registry.js";
import type { ClarificationEngine } from "../clarification-engine.js";
import type { ClarificationInboxStore } from "../clarification-inbox.js";
import type { CommunicationRouter, ContactIntelligenceStore } from "../contact-intelligence.js";
import type { ContentOpsStore } from "../content-ops.js";
import type { ContextMemoryService } from "../context-memory.js";
import type { ContextPackService } from "../context-pack.js";
import type { DecisionsLoader } from "../decisions-loader.js";
import type { DraftApprovalService } from "../draft-approval-service.js";
import type { EntityLinker } from "../entity-linker.js";
import type { FileAccessPolicy } from "../file-access-policy.js";
import type { FounderOpsService } from "../founder-ops.js";
import type { GoalStore } from "../goal-store.js";
import type { GrowthOpsStore } from "../growth-ops.js";
import type { EntityStore } from "../knowledge-graph/entity-store.js";
import type { GraphIngestionService } from "../knowledge-graph/graph-ingestion.js";
import type { GraphQueryService } from "../knowledge-graph/graph-query.js";
import type { RelationshipStore as KnowledgeRelationshipStore } from "../knowledge-graph/relationship-store.js";
import type { AccountLinkingService } from "../account-linking/account-linking-service.js";
import type { AccountConnectionStore } from "../account-linking/account-connection-store.js";
import type { ConnectionSessionStore } from "../account-linking/connection-session-store.js";
import type { OauthProviderRegistry } from "../account-linking/oauth-provider-registry.js";
import type { ProviderPermissions } from "../account-linking/provider-permissions.js";
import type { TokenVault } from "../account-linking/token-vault.js";
import type { FinanceStore } from "../finance/finance-store.js";
import type { FinanceReviewService } from "../finance/finance-review-service.js";
import type { IntentRouter } from "../intent-router.js";
import type { MemoryEntityStore } from "../memory-entity-store.js";
import type { MissionReviewService } from "../missions/mission-review.js";
import type { MissionService } from "../missions/mission-service.js";
import type { MissionStore } from "../missions/mission-store.js";
import type { OperationalMemoryStore } from "../operational-memory.js";
import type { PersonalOperationalMemoryStore } from "../personal-operational-memory.js";
import type { PersonalOSService } from "../personal-os.js";
import type { ProjectOpsService } from "../project-ops.js";
import type { ProfessionBootstrapService } from "../profession-bootstrap-service.js";
import type { ProfessionPackService } from "../profession-pack-service.js";
import type { ReasoningEngine } from "../reasoning-engine.js";
import type { RelationshipService } from "../relationship/relationship-service.js";
import type { RelationshipStore } from "../relationship/relationship-store.js";
import type { ResearchDeskService } from "../research/research-desk-service.js";
import type { ResearchMemoryStore } from "../research/research-memory-store.js";
import type { SourcePolicy } from "../research/source-policy.js";
import type { RequestOrchestrator } from "../request-orchestrator.js";
import type { ResponseOS } from "../response-os.js";
import type { RouteDecisionAuditStore } from "../routing/route-decision-audit-store.js";
import type { SafeExecService } from "../safe-exec.js";
import type { SharedBriefingComposer } from "../shared-briefing-composer.js";
import type { SocialAssistantStore } from "../social-assistant.js";
import type { TimeOsService } from "../time-os-service.js";
import type { ToolPluginRegistry } from "../plugin-registry.js";
import type { UserRoleProfileService } from "../user-role-profile-service.js";
import type { UserModelTracker } from "../user-model-tracker.js";
import type { UserPreferencesStore } from "../user-preferences.js";
import type { WorkflowExecutionRuntime } from "../execution-runtime.js";
import type { WorkflowOrchestratorStore } from "../workflow-orchestrator.js";
import type { WorkflowPlanBuilderService } from "../plan-builder.js";
import type { AgentCore } from "../agent-core.js";
import type { GoogleMapsService } from "../../integrations/google/google-maps.js";
import type { GoogleWorkspaceAuthService } from "../../integrations/google/google-auth.js";
import type { GoogleWorkspaceAccountsService } from "../../integrations/google/google-workspace-accounts.js";
import type { GoogleWorkspaceService } from "../../integrations/google/google-workspace.js";
import type { EmailReader } from "../../integrations/email/email-reader.js";
import type { EmailWriter } from "../../integrations/email/email-writer.js";
import type { EmailAccountsService } from "../../integrations/email/email-accounts.js";
import type { ExternalReasoningClient } from "../../integrations/external-reasoning/external-reasoning-client.js";
import type { PexelsMediaService } from "../../integrations/media/pexels.js";
import type { SupabaseMacCommandQueue } from "../../integrations/supabase/mac-command-queue.js";
import type { WhatsAppMessageStore } from "../whatsapp-message-store.js";
import type { DestinationRegistry } from "../destination-registry.js";
import type { CommandCenterService } from "../command-center/command-center-service.js";
import type { ChannelDeliveryService } from "../delivery/channel-delivery-service.js";
import type { DeliveryAuditStore } from "../delivery/delivery-audit-store.js";
import type { BrowserTaskStore } from "../operator-modes/browser-task-store.js";
import type { OperatorModeService } from "../operator-modes/operator-mode-service.js";
import type { FailedRequestStore } from "../self-improvement/failed-request-store.js";
import type { ImprovementBacklogStore } from "../self-improvement/improvement-backlog.js";
import type { ProductFeedbackStore } from "../self-improvement/product-feedback-store.js";
import type { SelfImprovementService } from "../self-improvement/self-improvement-service.js";

export interface BootstrapLayer {
  config: AppConfig;
  logger: Logger;
  pluginLogger: Logger;
  fileAccess: FileAccessPolicy;
  projectOps: ProjectOpsService;
  safeExec: SafeExecService;
}

export interface StorageLayer {
  memory: OperationalMemoryStore;
  goalStore: GoalStore;
  growthOps: GrowthOpsStore;
  preferences: UserPreferencesStore;
  personalMemory: PersonalOperationalMemoryStore;
  contentOps: ContentOpsStore;
  socialAssistant: SocialAssistantStore;
  contacts: ContactIntelligenceStore;
  approvals: ApprovalInboxStore;
  clarifications: ClarificationInboxStore;
  memoryEntities: MemoryEntityStore;
  whatsappMessages: WhatsAppMessageStore;
  workflows: WorkflowOrchestratorStore;
  financeStore: FinanceStore;
  relationshipStore: RelationshipStore;
  missionStore: MissionStore;
  researchMemory: ResearchMemoryStore;
  knowledgeEntities: EntityStore;
  knowledgeRelationships: KnowledgeRelationshipStore;
  deliveryAudit: DeliveryAuditStore;
  browserTasks: BrowserTaskStore;
  failedRequests: FailedRequestStore;
  productFeedback: ProductFeedbackStore;
  improvementBacklog: ImprovementBacklogStore;
  routingAudit: RouteDecisionAuditStore;
}

export interface AutonomyLayer {
  autonomyObservations: ObservationStore;
  autonomySuggestions: SuggestionStore;
  autonomyAudit: AutonomyAuditStore;
  autonomyFeedback: FeedbackStore;
  commitments: CommitmentStore;
  memoryCandidates: MemoryCandidateStore;
  commitmentExtractor: CommitmentExtractor;
  memoryCandidateExtractor: MemoryCandidateExtractor;
  autonomyAssessor: AutonomyAssessor;
  autonomyPolicy: AutonomyPolicy;
  autonomyLoop: AutonomyLoop;
}

export interface IntelligenceLayer {
  reasoningEngine: ReasoningEngine;
  userModelTracker: UserModelTracker;
  entityLinker: EntityLinker;
  approvalPolicy: ApprovalPolicyService;
  contextMemory: ContextMemoryService;
  decisionsLoader: DecisionsLoader;
  intentRouter: IntentRouter;
  responseOs: ResponseOS;
  sourcePolicy: SourcePolicy;
  researchDesk: ResearchDeskService;
  graphIngestion: GraphIngestionService;
  graphQuery: GraphQueryService;
}

export interface IntegrationsLayer {
  communicationRouter: CommunicationRouter;
  workflowRuntime: WorkflowExecutionRuntime;
  macCommandQueue: SupabaseMacCommandQueue;
  googleAuth: GoogleWorkspaceAuthService;
  googleWorkspace: GoogleWorkspaceService;
  googleWorkspaces: GoogleWorkspaceAccountsService;
  googleMaps: GoogleMapsService;
  externalReasoning: ExternalReasoningClient;
  founderOps: FounderOpsService;
  pexelsMedia: PexelsMediaService;
  emailAccounts: EmailAccountsService;
  email: EmailReader;
  emailWriter: EmailWriter;
  connectionSessions: ConnectionSessionStore;
  accountConnections: AccountConnectionStore;
  tokenVault: TokenVault;
  providerPermissions: ProviderPermissions;
  oauthProviders: OauthProviderRegistry;
  accountLinking: AccountLinkingService;
}

export interface LlmLayer {
  client: LlmClient;
}

export interface PluginLayer {
  loadedPlugins: LoadedToolPlugin[];
  registry: ToolPluginRegistry;
  capabilityRegistry: CapabilityRegistry;
}

export interface OsLayer {
  approvalEngine: ApprovalEngine;
  personalOs: PersonalOSService;
  briefingProfiles: BriefingProfileService;
  userRoleProfiles: UserRoleProfileService;
  professionPacks: ProfessionPackService;
  professionBootstrap: ProfessionBootstrapService;
  destinationRegistry: DestinationRegistry;
  briefingPrivacyPolicy: BriefingPrivacyPolicy;
  sharedBriefingComposer: SharedBriefingComposer;
  commandCenter: CommandCenterService;
  timeOs: TimeOsService;
  financeReview: FinanceReviewService;
  relationships: RelationshipService;
  missions: MissionService;
  missionReview: MissionReviewService;
  deliveryService: ChannelDeliveryService;
  operatorModes: OperatorModeService;
  selfImprovement: SelfImprovementService;
}

export interface RuntimeLayer {
  clarificationEngine: ClarificationEngine;
  contextPacks: ContextPackService;
  planBuilder: WorkflowPlanBuilderService;
  core: AgentCore;
  actionDispatcher: AssistantActionDispatcher;
  draftApprovalService: DraftApprovalService;
  requestOrchestrator: RequestOrchestrator;
}

export type CreateAgentCoreResult = BootstrapLayer
  & StorageLayer
  & AutonomyLayer
  & IntelligenceLayer
  & IntegrationsLayer
  & LlmLayer
  & PluginLayer
  & OsLayer
  & RuntimeLayer;
