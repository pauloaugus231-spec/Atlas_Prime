import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../types/config.js";
import type { LeadRecord } from "../types/growth-ops.js";
import type { ConversationMessage, LlmClient, LlmToolCall } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type {
  ContactPersona,
  ContactProfileRecord,
  ContactRelationship,
  UpsertContactProfileInput,
} from "../types/contact-intelligence.js";
import { FileAccessPolicy, type ReadableRootKey } from "./file-access-policy.js";
import { ContentOpsStore } from "./content-ops.js";
import { GrowthOpsStore } from "./growth-ops.js";
import type { FounderOpsSnapshot } from "./founder-ops.js";
import {
  adjustEventDraftFromInstruction,
  buildGoogleEventDeleteDraftReply,
  buildGoogleEventDeleteBatchDraftReply,
  buildEventDraftFromPrompt,
  buildGoogleEventDraftReply,
  buildGoogleEventUpdateDraftReply,
  buildGoogleTaskDraftReply,
  buildTaskDraftFromPrompt,
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
} from "./google-draft-utils.js";
import type {
  PendingGoogleEventDraft,
  PendingGoogleEventDeleteBatchDraft,
  PendingGoogleEventUpdateDraft,
} from "./google-draft-utils.js";
import { OperationalMemoryStore } from "./operational-memory.js";
import { PersonalOSService, type ExecutiveMorningBrief } from "./personal-os.js";
import { rankApprovals } from "./approval-priority.js";
import { ProjectOpsService } from "./project-ops.js";
import { ResponseOS } from "./response-os.js";
import { SafeExecService } from "./safe-exec.js";
import { WorkflowExecutionRuntime } from "./execution-runtime.js";
import { EntityLinker } from "./entity-linker.js";
import { IntentRouter, type IntentResolution } from "./intent-router.js";
import { AssistantActionDispatcher } from "./action-dispatcher.js";
import {
  ContextAssembler,
} from "./context-assembler.js";
import { ContextPackService } from "./context-pack.js";
import { MemoryEntityStore } from "./memory-entity-store.js";
import { WorkflowPlanBuilderService } from "./plan-builder.js";
import { ToolPluginRegistry } from "./plugin-registry.js";
import {
  ResponseSynthesizer,
  type ExecuteSynthesizedToolInput,
} from "./response-synthesizer.js";
import { SocialAssistantStore } from "./social-assistant.js";
import { UserPreferencesStore } from "./user-preferences.js";
import { WhatsAppMessageStore } from "./whatsapp-message-store.js";
import { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import { buildOrchestrationContext, buildOrchestrationSystemMessage } from "./orchestration.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { WeatherService } from "./weather-service.js";
import { ApprovalInboxStore } from "./approval-inbox.js";
import { BriefRenderer } from "./brief-renderer.js";
import { CommunicationRouter, ContactIntelligenceStore } from "./contact-intelligence.js";
import { isPersonallyRelevantCalendarEvent, matchPersonalCalendarTerms } from "./calendar-relevance.js";
import type { EmailMessageSummary, EmailReader } from "../integrations/email/email-reader.js";
import { EmailAccountsService } from "../integrations/email/email-accounts.js";
import { ExternalReasoningClient } from "../integrations/external-reasoning/external-reasoning-client.js";
import type { EmailWriter } from "../integrations/email/email-writer.js";
import {
  summarizeEmailForOperations,
  type EmailOperationalGroup,
  type EmailOperationalSummary,
} from "../integrations/email/email-analysis.js";
import {
  GoogleMapsService,
  type GooglePlaceLookupResult,
  type GoogleRouteLookupResult,
} from "../integrations/google/google-maps.js";
import type { CalendarListSummary, DailyOperationalBrief, TaskSummary } from "../integrations/google/google-workspace.js";
import { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import { PexelsMediaService, type PexelsVideoSuggestion } from "../integrations/media/pexels.js";
import { SupabaseMacCommandQueue } from "../integrations/supabase/mac-command-queue.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { MemoryEntityKind, MemoryEntityRecord } from "../types/memory-entities.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type {
  CreateWorkflowPlanInput,
  WorkflowArtifactRecord,
  WorkflowPlanRecord,
  WorkflowStepRecord,
} from "../types/workflow.js";
import { WebResearchService, type WebResearchMode } from "./web-research.js";
import type { ExternalReasoningRequest } from "../types/external-reasoning.js";
import { analyzeCalendarInsights } from "./calendar-insights.js";
import { resolveCalendarEventReference } from "./calendar-event-resolution.js";
import {
  extractExplicitGoogleAccountAlias,
  resolveGoogleAccountAliasesForPrompt,
} from "./google-account-resolution.js";
import { resolveActionAutonomyRule } from "./action-autonomy-policy.js";
import { looksLikeLowFrictionReadPrompt } from "./clarification-rules.js";
import { interpretConversationTurn } from "./conversation-interpreter.js";
import { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";
import { GoalStore } from "./goal-store.js";
import { AccountLinkingService } from "./account-linking/account-linking-service.js";
import { DestinationRegistry } from "./destination-registry.js";
import { ObservationStore } from "./autonomy/observation-store.js";
import { SuggestionStore } from "./autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "./autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "./autonomy/feedback-store.js";
import { AutonomyLoop } from "./autonomy/autonomy-loop.js";
import { AutonomyDirectService } from "./autonomy/autonomy-direct-service.js";
import { CommitmentStore } from "./autonomy/commitment-store.js";
import { MemoryCandidateStore } from "./autonomy/memory-candidate-store.js";
import {
  selectRelevantLearnedPreferences,
  summarizeIdentityProfileForReasoning,
  summarizeOperationalStateForReasoning,
} from "./personal-context-summary.js";
import { ProfessionBootstrapService } from "./profession-bootstrap-service.js";
import { ProfessionPackService } from "./profession-pack-service.js";
import { TimeOsService } from "./time-os-service.js";
import { FinanceStore } from "./finance/finance-store.js";
import { FinanceReviewService } from "./finance/finance-review-service.js";
import { RelationshipService } from "./relationship/relationship-service.js";
import { MissionService } from "./missions/mission-service.js";
import { MissionReviewService } from "./missions/mission-review.js";
import { ResearchDeskService } from "./research/research-desk-service.js";
import { GraphIngestionService } from "./knowledge-graph/graph-ingestion.js";
import { GraphQueryService } from "./knowledge-graph/graph-query.js";
import {
  TurnPlanner,
} from "./turn-planner.js";
import {
  ReasoningEngine,
} from "./reasoning-engine.js";
import { UserModelTracker } from "./user-model-tracker.js";
import { UserRoleProfileService } from "./user-role-profile-service.js";
import { SharedBriefingComposer } from "./shared-briefing-composer.js";
import { BriefingPrivacyPolicy } from "./briefing-privacy-policy.js";
import { CommandCenterService } from "./command-center/command-center-service.js";
import { ChannelDeliveryService } from "./delivery/channel-delivery-service.js";
import { OperatorModeService } from "./operator-modes/operator-mode-service.js";
import { SelfImprovementService } from "./self-improvement/self-improvement-service.js";
import {
  DirectRouteRunner,
} from "./direct-route-runner.js";
import type {
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
  UpdatePersonalOperationalProfileInput,
} from "../types/personal-operational-memory.js";
import type { CreateLearnedPreferenceInput, LearnedPreference } from "../types/learned-preferences.js";
import type { OperationalState } from "../types/operational-state.js";
import type { ProductGapRecord } from "../types/product-gaps.js";
import { resolveStructuredTaskOperationPayload } from "./task-operation-resolution.js";
import { shouldAttemptExternalReasoning, type ExternalReasoningStage } from "./external-reasoning-policy.js";
import { CapabilityRegistry } from "./capability-registry.js";
import {
  CapabilityPlanner,
  looksLikeCapabilityAwarePlacePrompt,
  looksLikeCapabilityAwareTravelPrompt,
  looksLikeCapabilityAwareWebPrompt,
  looksLikeCapabilityInspectionPrompt,
  type CapabilityPlan,
} from "./capability-planner.js";
import type { CapabilityAvailabilityRecord } from "../types/capability.js";
import {
  buildPlaceDiscoveryGoalFromPrompt,
  buildPlaceDiscoveryPrompt,
  buildTravelPlanningGoalFromPrompt,
  buildTravelPlanningPrompt,
  describePlaceDiscoveryGoal,
  describeTravelPlanningGoal,
  isActiveGoalCancellationPrompt,
  mergePlaceDiscoveryGoal,
  mergeTravelPlanningGoal,
  type TravelPlanningGoal,
  type ActivePlanningGoal,
} from "./active-goal-state.js";
import { MessagingDirectService } from "./messaging-direct-service.js";
import { GoogleWorkspaceDirectService } from "./google-workspace-direct-service.js";
import { ExternalIntelligenceDirectService } from "./external-intelligence-direct-service.js";
import { CapabilityActionService } from "./capability-action-service.js";
import { CapabilityInspectionService } from "./capability-inspection-service.js";
import { KnowledgeProjectDirectService } from "./knowledge-project-direct-service.js";
import { LifeManagementDirectService } from "./life-management-direct-service.js";
import { MemoryContactDirectService } from "./memory-contact-direct-service.js";
import { MissionDirectService } from "./mission-direct-service.js";
import { OperationalReviewDirectService } from "./operational-review-direct-service.js";
import { OperationalContextDirectService } from "./operational-context-direct-service.js";
import { ResearchKnowledgeDirectService } from "./research-knowledge-direct-service.js";
import { WorkspaceMacDirectService } from "./workspace-mac-direct-service.js";
import { WorkflowDirectService } from "./workflow-direct-service.js";
import { ContentDirectService } from "./content-direct-service.js";
import { ContentGenerationDirectService } from "./content-generation-direct-service.js";
import { DeliveryDirectService } from "./delivery-direct-service.js";
import { EmailDirectService } from "./email-direct-service.js";
import {
  AgentDirectRouteService,
  type AgentDirectRouteServiceDependencies,
} from "./agent-direct-route-service.js";
import { AgentDirectServiceComposer } from "./agent-direct-service-composer.js";
import { OperatorModeDirectService } from "./operator-mode-direct-service.js";
import { SelfImprovementDirectService } from "./self-improvement-direct-service.js";
import { ActivePlanningSessionService } from "./active-planning-session-service.js";
import { ToolExecutionService } from "./tool-execution-service.js";
import { ExternalReasoningRunner } from "./external-reasoning-runner.js";
import { WorkflowSupportService } from "./workflow-support-service.js";
import { AgentDirectRouteHandlers } from "./agent-direct-route-handlers.js";
import { DeliberativeReasoningRuntime } from "./deliberative-reasoning-runtime.js";
import {
  DailyEditorialResearchService,
  type DailyEditorialResearchInput,
  type DailyEditorialResearchResult,
} from "./daily-editorial-research-service.js";
import {
  applyAtlasV2SceneEngine,
  applyReasoningReplyPolicy,
  assessShortQualityV2,
  buildAddressLookupReply,
  buildAffirmativeReplyTemplate,
  buildAgentIdentityReply,
  buildAllowedSpacesReply,
  buildBaseMessages,
  buildCalendarLookupReply,
  buildCalendarPeriodReply,
  buildCapabilityAvailabilityReply,
  buildCapabilityGapReply,
  buildCapabilityGapSignature,
  buildCapabilityPlanUserDataReply,
  buildCaseNotesReply,
  buildContactListReply,
  buildContactSaveReply,
  buildContentBatchGenerationReply,
  buildContentBatchReply,
  buildContentChannelsReply,
  buildContentDistributionStrategyReply,
  buildContentFormatsReply,
  buildContentHooksReply,
  buildContentIdeaGenerationReply,
  buildContentOverviewReply,
  buildContentReviewNotFoundReply,
  buildContentReviewReply,
  buildContentScriptReply,
  buildContentSeriesReply,
  buildDeterministicFactLookupReply,
  buildDirectGoogleEventCreateReply,
  buildDistributionPlan,
  buildEmailLookupLabel,
  buildEmailLookupMissReply,
  buildEmailLookupReply,
  buildEmailSummaryReply,
  buildEmptyCalendarPeriodReply,
  buildEventLocationResearchQuery,
  buildGoogleCalendarsReply,
  buildGoogleContactsReply,
  buildGoogleTasksReply,
  buildGreetingReply,
  buildInboxTriageReply,
  buildInternalKnowledgeReply,
  buildLearnedPreferenceDeactivatedReply,
  buildLearnedPreferencesReply,
  buildLocationTermHints,
  buildMacQueueEnqueueReply,
  buildMacQueueListReply,
  buildMacQueueStatusReply,
  buildManualSceneAssetQuery,
  buildManualSceneOverlay,
  buildManualSceneVisualDirection,
  buildManualShortFormPackage,
  buildMapsRouteReply,
  buildMemoryEntityListReply,
  buildMorningBriefReply,
  buildMorningTaskBuckets,
  buildOperationalBriefReply,
  buildOperationalPlanContract,
  buildOperationalStateReply,
  buildOverlayHighlightWords,
  buildPersonalMemoryAmbiguousReply,
  buildPersonalMemoryDeletedReply,
  buildPersonalMemoryListReply,
  buildPersonalMemorySavedReply,
  buildPersonalMemoryTitle,
  buildPersonalMemoryUpdatedReply,
  buildPersonalOperationalProfileRemovedReply,
  buildPersonalOperationalProfileReply,
  buildPersonalOperationalProfileUpdatedReply,
  buildPlaceDiscoveryReply,
  buildPlaceLookupReply,
  buildProductGapDetailReply,
  buildProductGapsReply,
  buildProjectScanReply,
  buildRejectionReplyTemplate,
  buildResearchFocusTerms,
  buildRevenueScoreboardReply,
  buildSafeExecReply,
  buildSceneCtaSubtitle,
  buildSceneEditInstruction,
  buildSceneSubtitleLine,
  buildShortFormFallbackPackage,
  buildShortProductionPack,
  buildShortStyleProfile,
  buildUserPreferencesReply,
  buildWeatherReply,
  buildWeatherTip,
  buildWebResearchReply,
  buildWorkflowArtifactsReply,
  buildWorkflowExecutionReply,
  buildWorkflowListReply,
  buildWorkflowPlanReply,
  buildWorkflowStepUpdateReply,
  CalendarLookupRequest,
  CalendarPeriodWindow,
  chooseMorningNextAction,
  clampSceneDuration,
  clampShortTargetDuration,
  classifyBriefPeriod,
  classifyContentReviewFeedback,
  classifyFollowUpBucket,
  classifyMorningTaskBucket,
  cleanCalendarEventTopicReference,
  cleanSenderQuery,
  compressOverlayText,
  decodeHtmlEntities,
  defaultPersonaForRelationship,
  deriveScriptFromScenes,
  describeFounderSectionStatus,
  diffDayKeys,
  DistributionPlan,
  EmailLookupRequest,
  emailRelationshipWeight,
  enrichShortScenePlanV2,
  excerptBudgetForResearchMode,
  extractActiveUserPrompt,
  extractAddressFromText,
  extractCalendarDeleteTopic,
  extractCalendarLookupRequest,
  extractCalendarLookupTopic,
  extractCalendarMoveParts,
  extractCapacityFromText,
  extractCarryItemsFromProfilePrompt,
  extractConclusionLine,
  extractContactProfileInput,
  extractContentChannelKey,
  extractContentIdeaSeed,
  extractContentItemId,
  extractContentPlatform,
  extractContentQueueOrdinal,
  extractContentReviewReason,
  extractConversationStyleCorrection,
  extractDisplayName,
  extractEmailIdentifier,
  extractEmailLookbackHours,
  extractEmailLookupCategory,
  extractEmailLookupRequest,
  extractEmailUidFromPrompt,
  extractEmphasisWords,
  extractExactReplyBody,
  extractExplicitAccountAlias,
  extractExplicitCalendarAlias,
  extractFirstName,
  extractFocusedExcerpt,
  extractGoogleContactsQuery,
  extractHoursFromText,
  extractIntentResolveSubject,
  extractInternalKnowledgeQuery,
  extractLabeledValue,
  extractLearnedPreferenceDeleteTarget,
  extractLearnedPreferenceId,
  extractMacNotificationText,
  extractMacOpenApp,
  extractMacOpenUrl,
  extractMacProjectCommand,
  extractMacProjectOpenAlias,
  extractManualSectionBullets,
  extractManualShortScriptSource,
  extractManualTheme,
  extractMemoryEntityKindFromPrompt,
  extractMemoryEntitySearchQuery,
  extractMemoryItemId,
  extractMirrorSourceRoot,
  extractMirrorTargetPath,
  extractOperationalMode,
  extractPersonalMemoryDeleteTarget,
  extractPersonalMemoryId,
  extractPersonalMemoryStatement,
  extractPersonalMemoryUpdateContent,
  extractPersonalMemoryUpdateTarget,
  extractPersonalOperationalProfileRemoveQuery,
  extractPersonalOperationalProfileUpdate,
  extractPhoneFromText,
  extractPlaceLookupQuery,
  extractPreferenceUpdate,
  extractProjectPath,
  extractProjectRoot,
  extractPromptLimit,
  extractReferenceMonth,
  extractRequestedResearchFactTypes,
  extractResearchFacts,
  extractSafeExecRequest,
  extractSenderQuery,
  extractSupportTheme,
  extractSyntheticToolCalls,
  extractToneHint,
  extractWeatherLocation,
  extractWebResearchMode,
  extractWebResearchQuery,
  extractWorkflowPlanId,
  extractWorkflowStepNumber,
  extractWorkflowStepStatus,
  fetchOfficialAliasSources,
  fetchOfficialHtmlExcerpt,
  formatBriefDateTime,
  formatBriefTemperature,
  formatBriefTemperatureRange,
  formatCalendarDayHeader,
  formatCalendarTimeRange,
  formatCapabilityObjectiveLabel,
  formatCurrency,
  formatDurationMinutes,
  formatEmailTimestamp,
  formatFollowUpDueLabel,
  formatKilometers,
  formatLearnedPreferenceTypeLabel,
  formatMoneyAmount,
  formatPersonalMemoryKindLabel,
  formatTaskDue,
  getBriefDayKey,
  getEditorialSlotLabel,
  getWeekdayTargetDate,
  hasAffirmativeIntent,
  hasMemoryUpdateFields,
  hasRejectionIntent,
  hasTechnicalSimpleReplyFraming,
  InboxTriageItem,
  includesAny,
  inferAssetSemanticProfile,
  inferDefaultContentChannelKey,
  inferDistributionHypothesis,
  inferIntentNextStep,
  inferIntentObjective,
  inferManualShortStyleMode,
  inferOfficialFallbackUrls,
  inferPersonalMemoryKind,
  inferProfileResponseLength,
  inferReplyContext,
  inferResearchSynthesisProfile,
  inferSceneAssetProvider,
  inferSceneEmotionalTrigger,
  inferSceneNarrativeFunction,
  inferSceneProofType,
  inferSceneQueryPreset,
  inferSceneRetentionDriver,
  inferShortStyleMode,
  isAddressLookupPrompt,
  isAgentIdentityPrompt,
  isAllowedSpacesPrompt,
  isAmbiguousPublicServiceLocation,
  isCalendarConflictReviewPrompt,
  isCalendarDeletePrompt,
  isCalendarLookupPrompt,
  isCalendarMovePrompt,
  isCalendarPeriodDeletePrompt,
  isCalendarPeriodListPrompt,
  isCapacityLookupPrompt,
  isCaseNotesPrompt,
  isContactListPrompt,
  isContactUpsertPrompt,
  isContentBatchGenerationPrompt,
  isContentBatchPlanningPrompt,
  isContentChannelsPrompt,
  isContentDistributionStrategyPrompt,
  isContentFormatLibraryPrompt,
  isContentHookLibraryPrompt,
  isContentIdeaGenerationPrompt,
  isContentOverviewPrompt,
  isContentReviewPrompt,
  isContentScriptGenerationPrompt,
  isContentSeriesPrompt,
  isConversationStyleCorrectionPrompt,
  isDailyEditorialResearchPrompt,
  isDirectLocalContextCommandPrompt,
  isEmailDraftPrompt,
  isEmailFocusedPrompt,
  isEmailSummaryPrompt,
  isFollowUpReviewPrompt,
  isGoogleCalendarsListPrompt,
  isGoogleContactsPrompt,
  isGoogleTasksPrompt,
  isGreetingPrompt,
  isHoursLookupPrompt,
  isImplicitResearchPrompt,
  isInboxTriagePrompt,
  isIntentResolvePrompt,
  isInternalKnowledgePrompt,
  isLearnedPreferencesDeletePrompt,
  isLearnedPreferencesListPrompt,
  isMacQueueListPrompt,
  isMacQueueStatusPrompt,
  isMemoryEntityListPrompt,
  isMemoryEntitySearchPrompt,
  isMemoryUpdatePrompt,
  isMirrorProjectPrompt,
  isMorningBriefPrompt,
  isNextCommitmentPrepPrompt,
  isOperationalBriefPrompt,
  isOperationalNoise,
  isOperationalPlanningPrompt,
  isOperationalStateShowPrompt,
  isPersonalMemoryDeletePrompt,
  isPersonalMemoryListPrompt,
  isPersonalMemorySavePrompt,
  isPersonalMemoryUpdatePrompt,
  isPersonalOperationalProfileDeletePrompt,
  isPersonalOperationalProfileShowPrompt,
  isPersonalOperationalProfileUpdatePrompt,
  isPhoneLookupPrompt,
  isPlaceLookupPrompt,
  isProjectScanPrompt,
  isRevenueScoreboardPrompt,
  isRiquezaContentItemEligible,
  isRiquezaTrendEligible,
  isSupportReviewPrompt,
  isUrgentSupportSignal,
  isUserPreferencesPrompt,
  isWeatherPrompt,
  isWebResearchPrompt,
  isWorkflowArtifactListPrompt,
  isWorkflowExecutionPrompt,
  isWorkflowListPrompt,
  isWorkflowPlanningPrompt,
  isWorkflowShowPrompt,
  isWorkflowStepUpdatePrompt,
  labelAgendaScope,
  labelBriefOwner,
  looksLikePostalAddress,
  lookupVenueAddress,
  matchesCalendarEventTopic,
  matchesSenderQuery,
  maxResearchResultsForMode,
  MorningBriefEmailItem,
  MorningTaskBuckets,
  normalizeAssetSearchQuery,
  normalizeCalendarUpdateInstruction,
  normalizeFacelessVisualDirection,
  normalizeForbiddenVisuals,
  normalizeScenePlan,
  normalizeShortComparableText,
  normalizeShortLine,
  normalizeShortStyleMode,
  normalizeSyntheticArguments,
  normalizeTonePreferenceFromText,
  parseCalendarLookupDate,
  parseCalendarPeriodWindow,
  parseContactRelationship,
  parseManualNarrationScenes,
  parseManualTimedScenes,
  rebalanceSceneDurations,
  refineAssetSearchQuery,
  removeFromPersonalOperationalProfile,
  removeMatchingEntries,
  ResearchFactType,
  ResearchSynthesisProfile,
  resolveCalendarTargets,
  ResolvedEmailReference,
  resolveDuckDuckGoRedirectUrl,
  resolveEffectiveOperationalMode,
  resolveLearnedPreferencesListFilter,
  resolvePromptAccountAliases,
  resolveSceneAssets,
  rewriteConversationalSimpleReply,
  SceneAssetProvider,
  SceneEmotionalTrigger,
  SceneNarrativeFunction,
  SceneProofType,
  SceneRetentionDriver,
  SceneVisualCamera,
  SceneVisualEnvironment,
  SceneVisualPacing,
  scoreFocusedExcerpt,
  ShortAssetSemanticProfile,
  ShortFormPackage,
  ShortPlatformVariants,
  ShortProductionPack,
  ShortQualityAssessment,
  ShortScenePlan,
  ShortStyleMode,
  shouldAutoCreateGoogleEvent,
  shouldAutoExecuteWorkflowDeliverable,
  shouldBypassPreLocalExternalReasoningForPrompt,
  shouldSearchAllCalendars,
  slugifySegment,
  stateDateTimeLabel,
  stripForbiddenShortPromises,
  stripHtmlTags,
  stripResearchReplyMarkdown,
  summarizeCalendarLocation,
  summarizeEmailSender,
  summarizeTrackedMetrics,
  sumSceneDurations,
  uniqueAppend,
  validateShortFormPackage,
} from "./agent-core-helpers.js";

export {
  isWeatherPrompt,
  isGreetingPrompt,
  buildGreetingReply,
  rewriteConversationalSimpleReply,
  extractConversationStyleCorrection,
  shouldBypassPreLocalExternalReasoningForPrompt,
  buildWeatherReply,
  buildMorningBriefReply,
} from "./agent-core-helpers.js";
export interface AgentRunResult {
  requestId: string;
  reply: string;
  messages: ConversationMessage[];
  toolExecutions: Array<{
    toolName: string;
    resultPreview: string;
  }>;
}

export interface AgentRunOptions {
  chatId?: string | number;
}

export interface AgentCoreDependencies {
  config: AppConfig;
  logger: Logger;
  fileAccess: FileAccessPolicy;
  client: LlmClient;
  capabilityRegistry: CapabilityRegistry;
  pluginRegistry: ToolPluginRegistry;
  memory: OperationalMemoryStore;
  goalStore: GoalStore;
  preferences: UserPreferencesStore;
  personalMemory: PersonalOperationalMemoryStore;
  growthOps: GrowthOpsStore;
  contentOps: ContentOpsStore;
  socialAssistant: SocialAssistantStore;
  contacts: ContactIntelligenceStore;
  communicationRouter: CommunicationRouter;
  approvals: ApprovalInboxStore;
  memoryEntities: MemoryEntityStore;
  whatsappMessages: WhatsAppMessageStore;
  workflows: WorkflowOrchestratorStore;
  workflowRuntime: WorkflowExecutionRuntime;
  entityLinker: EntityLinker;
  macCommandQueue: SupabaseMacCommandQueue;
  email: EmailReader;
  emailWriter: EmailWriter;
  emailAccounts: EmailAccountsService;
  googleWorkspace: GoogleWorkspaceService;
  googleWorkspaces: GoogleWorkspaceAccountsService;
  googleMaps: GoogleMapsService;
  personalOs: PersonalOSService;
  intentRouter: IntentRouter;
  responseOs: ResponseOS;
  contextPacks: ContextPackService;
  planBuilder: WorkflowPlanBuilderService;
  externalReasoning: ExternalReasoningClient;
  pexelsMedia: PexelsMediaService;
  projectOps: ProjectOpsService;
  safeExec: SafeExecService;
  accountLinking?: AccountLinkingService;
  userRoleProfiles?: UserRoleProfileService;
  professionPacks?: ProfessionPackService;
  professionBootstrap?: ProfessionBootstrapService;
  destinationRegistry?: DestinationRegistry;
  briefingPrivacyPolicy?: BriefingPrivacyPolicy;
  sharedBriefingComposer?: SharedBriefingComposer;
  commandCenter?: CommandCenterService;
  timeOs?: TimeOsService;
  financeStore?: FinanceStore;
  financeReview?: FinanceReviewService;
  relationships?: RelationshipService;
  missions?: MissionService;
  missionReview?: MissionReviewService;
  researchDesk?: ResearchDeskService;
  graphIngestion?: GraphIngestionService;
  graphQuery?: GraphQueryService;
  deliveryService?: ChannelDeliveryService;
  operatorModes?: OperatorModeService;
  selfImprovement?: SelfImprovementService;
  reasoningEngine?: ReasoningEngine;
  userModelTracker?: UserModelTracker;
  autonomyObservations?: ObservationStore;
  autonomySuggestions?: SuggestionStore;
  autonomyAudit?: AutonomyAuditStore;
  autonomyFeedback?: FeedbackStore;
  commitments?: CommitmentStore;
  memoryCandidates?: MemoryCandidateStore;
  autonomyLoop?: AutonomyLoop;
}

export class AgentCore {
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly fileAccess: FileAccessPolicy;
  private readonly client: LlmClient;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly pluginRegistry: ToolPluginRegistry;
  private readonly memory: OperationalMemoryStore;
  private readonly goalStore: GoalStore;
  private readonly preferences: UserPreferencesStore;
  private readonly personalMemory: PersonalOperationalMemoryStore;
  private readonly growthOps: GrowthOpsStore;
  private readonly contentOps: ContentOpsStore;
  private readonly socialAssistant: SocialAssistantStore;
  private readonly contacts: ContactIntelligenceStore;
  private readonly communicationRouter: CommunicationRouter;
  private readonly approvals: ApprovalInboxStore;
  private readonly memoryEntities: MemoryEntityStore;
  private readonly whatsappMessages: WhatsAppMessageStore;
  private readonly workflows: WorkflowOrchestratorStore;
  private readonly workflowRuntime: WorkflowExecutionRuntime;
  private readonly entityLinker: EntityLinker;
  private readonly macCommandQueue: SupabaseMacCommandQueue;
  private readonly email: EmailReader;
  private readonly emailWriter: EmailWriter;
  private readonly emailAccounts: EmailAccountsService;
  private readonly googleWorkspace: GoogleWorkspaceService;
  private readonly googleWorkspaces: GoogleWorkspaceAccountsService;
  private readonly googleMaps: GoogleMapsService;
  private readonly personalOs: PersonalOSService;
  private readonly intentRouter: IntentRouter;
  private readonly responseOs: ResponseOS;
  private readonly contextPacks: ContextPackService;
  private readonly planBuilder: WorkflowPlanBuilderService;
  private readonly externalReasoning: ExternalReasoningClient;
  private readonly pexelsMedia: PexelsMediaService;
  private readonly projectOps: ProjectOpsService;
  private readonly safeExec: SafeExecService;
  private readonly accountLinking?: AccountLinkingService;
  private readonly userRoleProfiles?: UserRoleProfileService;
  private readonly professionPacks?: ProfessionPackService;
  private readonly professionBootstrap?: ProfessionBootstrapService;
  private readonly destinationRegistry?: DestinationRegistry;
  private readonly briefingPrivacyPolicy?: BriefingPrivacyPolicy;
  private readonly sharedBriefingComposer?: SharedBriefingComposer;
  private readonly commandCenter?: CommandCenterService;
  private readonly timeOs?: TimeOsService;
  private readonly financeStore?: FinanceStore;
  private readonly financeReview?: FinanceReviewService;
  private readonly relationships?: RelationshipService;
  private readonly missions?: MissionService;
  private readonly missionReview?: MissionReviewService;
  private readonly researchDesk?: ResearchDeskService;
  private readonly graphIngestion?: GraphIngestionService;
  private readonly graphQuery?: GraphQueryService;
  private readonly deliveryService?: ChannelDeliveryService;
  private readonly operatorModes?: OperatorModeService;
  private readonly selfImprovement?: SelfImprovementService;
  private readonly reasoningEngine?: ReasoningEngine;
  private readonly userModelTracker?: UserModelTracker;
  private readonly autonomyObservations?: ObservationStore;
  private readonly autonomySuggestions?: SuggestionStore;
  private readonly autonomyAudit?: AutonomyAuditStore;
  private readonly autonomyFeedback?: FeedbackStore;
  private readonly commitments?: CommitmentStore;
  private readonly memoryCandidates?: MemoryCandidateStore;
  private readonly autonomyLoop?: AutonomyLoop;
  private readonly capabilityPlanner: CapabilityPlanner;
  private readonly contextAssembler: ContextAssembler;
  private readonly responseSynthesizer: ResponseSynthesizer;
  private readonly turnPlanner: TurnPlanner;
  private readonly directRouteService: AgentDirectRouteService;
  private readonly directRouteHandlers: AgentDirectRouteHandlers;
  private readonly messagingDirectService: MessagingDirectService;
  private directServiceComposer?: AgentDirectServiceComposer;
  private readonly activePlanningSession: ActivePlanningSessionService;
  private readonly toolExecutionService: ToolExecutionService;
  private readonly externalReasoningRunner: ExternalReasoningRunner;
  private readonly workflowSupportService: WorkflowSupportService;
  private readonly dailyEditorialResearchService: DailyEditorialResearchService;
  private readonly deliberativeReasoningRuntime: DeliberativeReasoningRuntime;
  private readonly createWebResearchService: (logger: Logger) => Pick<WebResearchService, "search" | "fetchPageExcerpt">;

  constructor(deps: AgentCoreDependencies) {
    this.config = deps.config;
    this.logger = deps.logger;
    this.fileAccess = deps.fileAccess;
    this.client = deps.client;
    this.capabilityRegistry = deps.capabilityRegistry;
    this.pluginRegistry = deps.pluginRegistry;
    this.memory = deps.memory;
    this.goalStore = deps.goalStore;
    this.preferences = deps.preferences;
    this.personalMemory = deps.personalMemory;
    this.growthOps = deps.growthOps;
    this.contentOps = deps.contentOps;
    this.socialAssistant = deps.socialAssistant;
    this.contacts = deps.contacts;
    this.communicationRouter = deps.communicationRouter;
    this.approvals = deps.approvals;
    this.memoryEntities = deps.memoryEntities;
    this.whatsappMessages = deps.whatsappMessages;
    this.workflows = deps.workflows;
    this.workflowRuntime = deps.workflowRuntime;
    this.entityLinker = deps.entityLinker;
    this.macCommandQueue = deps.macCommandQueue;
    this.email = deps.email;
    this.emailWriter = deps.emailWriter;
    this.emailAccounts = deps.emailAccounts;
    this.googleWorkspace = deps.googleWorkspace;
    this.googleWorkspaces = deps.googleWorkspaces;
    this.googleMaps = deps.googleMaps;
    this.personalOs = deps.personalOs;
    this.intentRouter = deps.intentRouter;
    this.responseOs = deps.responseOs;
    this.contextPacks = deps.contextPacks;
    this.planBuilder = deps.planBuilder;
    this.externalReasoning = deps.externalReasoning;
    this.pexelsMedia = deps.pexelsMedia;
    this.projectOps = deps.projectOps;
    this.safeExec = deps.safeExec;
    this.accountLinking = deps.accountLinking;
    this.userRoleProfiles = deps.userRoleProfiles;
    this.professionPacks = deps.professionPacks;
    this.professionBootstrap = deps.professionBootstrap;
    this.destinationRegistry = deps.destinationRegistry;
    this.briefingPrivacyPolicy = deps.briefingPrivacyPolicy;
    this.sharedBriefingComposer = deps.sharedBriefingComposer;
    this.commandCenter = deps.commandCenter;
    this.timeOs = deps.timeOs;
    this.financeStore = deps.financeStore;
    this.financeReview = deps.financeReview;
    this.relationships = deps.relationships;
    this.missions = deps.missions;
    this.missionReview = deps.missionReview;
    this.researchDesk = deps.researchDesk;
    this.graphIngestion = deps.graphIngestion;
    this.graphQuery = deps.graphQuery;
    this.deliveryService = deps.deliveryService;
    this.operatorModes = deps.operatorModes;
    this.selfImprovement = deps.selfImprovement;
    this.reasoningEngine = deps.reasoningEngine;
    this.userModelTracker = deps.userModelTracker;
    this.autonomyObservations = deps.autonomyObservations;
    this.autonomySuggestions = deps.autonomySuggestions;
    this.autonomyAudit = deps.autonomyAudit;
    this.autonomyFeedback = deps.autonomyFeedback;
    this.commitments = deps.commitments;
    this.memoryCandidates = deps.memoryCandidates;
    this.autonomyLoop = deps.autonomyLoop;

    this.createWebResearchService = (logger) => new WebResearchService(logger);
    this.capabilityPlanner = new CapabilityPlanner(
      this.config,
      this.capabilityRegistry,
      this.googleWorkspaces,
      this.googleMaps,
      this.externalReasoning,
      this.logger.child({ scope: "capability-planner" }),
      () => {
        const activeGoals = this.goalStore.list();
        return {
          goalSummary: activeGoals.length > 0 ? this.goalStore.summarize() : undefined,
          activeGoals: activeGoals.slice(0, 4).map((goal) => ({
            title: goal.title,
            description: goal.description,
            domain: goal.domain,
            deadline: goal.deadline,
            progress: goal.progress,
          })),
        };
      },
    );
    this.toolExecutionService = new ToolExecutionService({
      config: this.config,
      logger: this.logger,
      fileAccess: this.fileAccess,
      pluginRegistry: this.pluginRegistry,
      memory: this.memory,
      preferences: this.preferences,
      personalMemory: this.personalMemory,
      growthOps: this.growthOps,
      contentOps: this.contentOps,
      socialAssistant: this.socialAssistant,
      workflows: this.workflows,
      email: this.email,
      emailWriter: this.emailWriter,
      emailAccounts: this.emailAccounts,
      googleWorkspace: this.googleWorkspace,
      googleWorkspaces: this.googleWorkspaces,
      projectOps: this.projectOps,
      safeExec: this.safeExec,
    });
    this.externalReasoningRunner = new ExternalReasoningRunner({
      config: this.config,
      contextPacks: this.contextPacks,
      externalReasoning: this.externalReasoning,
      personalMemory: this.personalMemory,
      googleWorkspaces: this.googleWorkspaces,
      logger: this.logger.child({ scope: "external-reasoning-runner" }),
    });
    this.workflowSupportService = new WorkflowSupportService({
      config: this.config,
      client: this.client,
      workflows: this.workflows,
    });
    this.dailyEditorialResearchService = new DailyEditorialResearchService({
      config: this.config,
      logger: this.logger.child({ scope: "daily-editorial-research-service" }),
      client: this.client,
      contentOps: this.contentOps,
      runUserPrompt: (prompt) => this.runUserPrompt(prompt),
    });
    this.deliberativeReasoningRuntime = new DeliberativeReasoningRuntime({
      reasoningEngine: this.reasoningEngine,
      userModelTracker: this.userModelTracker,
    });
    this.contextAssembler = new ContextAssembler(
      this.logger.child({ scope: "context-assembler" }),
      {
        buildBaseMessages,
        selectToolsForPrompt: (userPrompt) => this.selectToolsForPrompt(userPrompt),
        getMemorySummary: () => this.memory.getContextSummary() ?? undefined,
        getProfile: () => this.personalMemory.getProfile(),
        getOperationalState: () => this.personalMemory.getOperationalState(),
      },
      {
        maxToolIterations: this.config.runtime.maxToolIterations,
      },
    );
    this.responseSynthesizer = new ResponseSynthesizer(
      this.client,
      this.logger.child({ scope: "response-synthesizer" }),
      {
        executeTool: async (input) => this.toolExecutionService.executeSynthesizedTool(input),
      },
    );
    const assistantActionDispatcher = new AssistantActionDispatcher(
      this,
      this.logger.child({ scope: "agent-core-action-dispatcher" }),
    );
    this.turnPlanner = new TurnPlanner(
      this.logger.child({ scope: "turn-planner" }),
      {
        getProfile: () => this.personalMemory.getProfile(),
        resolveOperationalMode: resolveEffectiveOperationalMode,
        rewriteReply: (prompt, reply, input) => rewriteConversationalSimpleReply(prompt, reply, input),
        resolveStructuredReply: async (rawReply, input) => assistantActionDispatcher.resolveStructuredReply(rawReply, input),
        rewriteStructuredReply: false,
      },
    );
    this.messagingDirectService = new MessagingDirectService({
      whatsappConfig: this.config.whatsapp,
      logger: this.logger.child({ scope: "messaging-direct-service" }),
      contacts: this.contacts,
      approvals: this.approvals,
      whatsappMessages: this.whatsappMessages,
      buildBaseMessages: (userPrompt, orchestration) => buildBaseMessages(userPrompt, orchestration),
      buildMessageHistoryReply: (input) => this.responseOs.buildMessageHistoryReply(input),
      buildApprovalReviewReply: (input) => this.responseOs.buildApprovalReviewReply(input),
    });
    this.activePlanningSession = new ActivePlanningSessionService({
      capabilityPlanner: this.capabilityPlanner,
      personalMemory: this.personalMemory,
      getExternalIntelligenceDirectService: () => this.getExternalIntelligenceDirectService(),
      getCapabilityActionService: () => this.getCapabilityActionService(),
    });
    this.directServiceComposer = new AgentDirectServiceComposer({
      config: this.config,
      logger: this.logger,
      fileAccess: this.fileAccess,
      client: this.client,
      capabilityRegistry: this.capabilityRegistry,
      autonomyObservations: this.autonomyObservations!,
      autonomySuggestions: this.autonomySuggestions!,
      autonomyAudit: this.autonomyAudit!,
      autonomyFeedback: this.autonomyFeedback!,
      commitments: this.commitments!,
      memoryCandidates: this.memoryCandidates!,
      autonomyLoop: this.autonomyLoop!,
      capabilityPlanner: this.capabilityPlanner,
      memory: this.memory,
      goalStore: this.goalStore,
      preferences: this.preferences,
      personalMemory: this.personalMemory,
      growthOps: this.growthOps,
      contentOps: this.contentOps,
      socialAssistant: this.socialAssistant,
      contacts: this.contacts,
      communicationRouter: this.communicationRouter,
      approvals: this.approvals,
      memoryEntities: this.memoryEntities,
      whatsappMessages: this.whatsappMessages,
      workflows: this.workflows,
      workflowRuntime: this.workflowRuntime,
      entityLinker: this.entityLinker,
      macCommandQueue: this.macCommandQueue,
      email: this.email,
      emailAccounts: this.emailAccounts,
      googleWorkspace: this.googleWorkspace,
      googleWorkspaces: this.googleWorkspaces,
      googleMaps: this.googleMaps,
      personalOs: this.personalOs,
      responseOs: this.responseOs,
      contextPacks: this.contextPacks,
      planBuilder: this.planBuilder,
      pexelsMedia: this.pexelsMedia,
      projectOps: this.projectOps,
      safeExec: this.safeExec,
      accountLinking: this.accountLinking,
      userRoleProfiles: this.userRoleProfiles,
      professionPacks: this.professionPacks,
      professionBootstrap: this.professionBootstrap,
      destinationRegistry: this.destinationRegistry,
      sharedBriefingComposer: this.sharedBriefingComposer,
      commandCenter: this.commandCenter,
      timeOs: this.timeOs,
      financeStore: this.financeStore,
      financeReview: this.financeReview,
      relationships: this.relationships,
      missions: this.missions,
      missionReview: this.missionReview,
      researchDesk: this.researchDesk,
      graphIngestion: this.graphIngestion,
      graphQuery: this.graphQuery,
      deliveryService: this.deliveryService,
      operatorModes: this.operatorModes,
      selfImprovement: this.selfImprovement,
      createWebResearchService: this.createWebResearchService,
      executeToolDirect: (toolName, rawArguments) => this.toolExecutionService.executeToolDirect(toolName, rawArguments),
      buildActiveGoalUserDataReply: (goal, plan) => this.activePlanningSession.buildActiveGoalUserDataReply(goal, plan),
      resolveEmailReferenceFromPrompt: (prompt, logger) => this.resolveEmailReferenceFromPrompt(prompt, logger),
      runDailyEditorialResearch: (input) => this.runDailyEditorialResearch(input),
      buildWorkflowExecutionBrief: (plan, step, requestLogger) => this.workflowSupportService.buildWorkflowExecutionBrief(plan, step, requestLogger),
      saveWorkflowExecutionArtifact: (plan, step, brief) => this.workflowSupportService.saveWorkflowExecutionArtifact(plan, step, brief),
      generateWorkflowDomainDeliverable: (plan, step, brief, requestLogger) =>
        this.workflowSupportService.generateWorkflowDomainDeliverable(plan, step, brief, requestLogger),
    });
    this.directRouteHandlers = new AgentDirectRouteHandlers({
      config: this.config,
      logger: this.logger,
      fileAccess: this.fileAccess,
      pluginRegistry: this.pluginRegistry,
      memory: this.memory,
      preferences: this.preferences,
      personalMemory: this.personalMemory,
      growthOps: this.growthOps,
      contentOps: this.contentOps,
      socialAssistant: this.socialAssistant,
      workflows: this.workflows,
      email: this.email,
      emailWriter: this.emailWriter,
      emailAccounts: this.emailAccounts,
      googleWorkspace: this.googleWorkspace,
      googleWorkspaces: this.googleWorkspaces,
      projectOps: this.projectOps,
      safeExec: this.safeExec,
      intentRouter: this.intentRouter,
      contextPacks: this.contextPacks,
      responseOs: this.responseOs,
      activePlanningSession: this.activePlanningSession,
      messagingDirectService: this.messagingDirectService,
      toolExecutionService: this.toolExecutionService,
      getGoogleWorkspaceDirectService: () => this.getGoogleWorkspaceDirectService(),
      getExternalIntelligenceDirectService: () => this.getExternalIntelligenceDirectService(),
      getCapabilityInspectionService: () => this.getCapabilityInspectionService(),
      getKnowledgeProjectDirectService: () => this.getKnowledgeProjectDirectService(),
      getLifeManagementDirectService: () => this.getLifeManagementDirectService(),
      getMissionDirectService: () => this.getMissionDirectService(),
      getResearchKnowledgeDirectService: () => this.getResearchKnowledgeDirectService(),
      getOperationalContextDirectService: () => this.getOperationalContextDirectService(),
      getAutonomyDirectService: () => this.getAutonomyDirectService(),
      getMemoryContactDirectService: () => this.getMemoryContactDirectService(),
      getWorkflowDirectService: () => this.getWorkflowDirectService(),
      getOperationalReviewDirectService: () => this.getOperationalReviewDirectService(),
      getWorkspaceMacDirectService: () => this.getWorkspaceMacDirectService(),
      getEmailDirectService: () => this.getEmailDirectService(),
      getContentDirectService: () => this.getContentDirectService(),
      getContentGenerationDirectService: () => this.getContentGenerationDirectService(),
      getDeliveryDirectService: () => this.getDeliveryDirectService(),
      getOperatorModeDirectService: () => this.getOperatorModeDirectService(),
      getSelfImprovementDirectService: () => this.getSelfImprovementDirectService(),
    });
    this.directRouteService = new AgentDirectRouteService(
      new DirectRouteRunner(
        this.logger.child({ scope: "direct-route-runner" }),
      ),
      this.directRouteHandlers.buildDirectRouteServiceDependencies(),
      async (fallbackInput) => this.externalReasoningRunner.tryRun({
        userPrompt: fallbackInput.activeUserPrompt,
        requestId: fallbackInput.requestId,
        requestLogger: fallbackInput.requestLogger,
        intent: fallbackInput.intent,
        preferences: fallbackInput.preferences,
        options: fallbackInput.options,
        stage: "post_direct_routes",
      }),
    );
  }

  resolveIntent(userPrompt: string): IntentResolution {
    return this.intentRouter.resolve(userPrompt);
  }

  shouldBypassClarification(userPrompt: string, options?: AgentRunOptions): boolean {
    return this.activePlanningSession.shouldBypassClarification(userPrompt, options);
  }

  clearChatState(chatId?: string | number): void {
    this.activePlanningSession.clearChatState(chatId);
  }

  private getDirectServiceComposer(): AgentDirectServiceComposer {
    if (!this.directServiceComposer) {
      this.directServiceComposer = new AgentDirectServiceComposer({
        config: this.config,
        logger: this.logger,
        fileAccess: this.fileAccess,
        client: this.client,
        capabilityRegistry: this.capabilityRegistry,
        autonomyObservations: this.autonomyObservations!,
        autonomySuggestions: this.autonomySuggestions!,
        autonomyAudit: this.autonomyAudit!,
        autonomyFeedback: this.autonomyFeedback!,
        commitments: this.commitments!,
        memoryCandidates: this.memoryCandidates!,
        autonomyLoop: this.autonomyLoop!,
        capabilityPlanner: this.capabilityPlanner,
        memory: this.memory,
        goalStore: this.goalStore,
        preferences: this.preferences,
        personalMemory: this.personalMemory,
        growthOps: this.growthOps,
        contentOps: this.contentOps,
        socialAssistant: this.socialAssistant,
        contacts: this.contacts,
        communicationRouter: this.communicationRouter,
        approvals: this.approvals,
        memoryEntities: this.memoryEntities,
        whatsappMessages: this.whatsappMessages,
        workflows: this.workflows,
        workflowRuntime: this.workflowRuntime,
        entityLinker: this.entityLinker,
        macCommandQueue: this.macCommandQueue,
        email: this.email,
        emailAccounts: this.emailAccounts,
        googleWorkspace: this.googleWorkspace,
        googleWorkspaces: this.googleWorkspaces,
        googleMaps: this.googleMaps,
        personalOs: this.personalOs,
        responseOs: this.responseOs,
        contextPacks: this.contextPacks,
        planBuilder: this.planBuilder,
        pexelsMedia: this.pexelsMedia,
        projectOps: this.projectOps,
        safeExec: this.safeExec,
        accountLinking: this.accountLinking,
        userRoleProfiles: this.userRoleProfiles,
        professionPacks: this.professionPacks,
        professionBootstrap: this.professionBootstrap,
        destinationRegistry: this.destinationRegistry,
        sharedBriefingComposer: this.sharedBriefingComposer,
        commandCenter: this.commandCenter,
        timeOs: this.timeOs,
        financeStore: this.financeStore,
        financeReview: this.financeReview,
        relationships: this.relationships,
        missions: this.missions,
        missionReview: this.missionReview,
        researchDesk: this.researchDesk,
        graphIngestion: this.graphIngestion,
        graphQuery: this.graphQuery,
        deliveryService: this.deliveryService,
        operatorModes: this.operatorModes,
        selfImprovement: this.selfImprovement,
        createWebResearchService: this.createWebResearchService,
        executeToolDirect: (toolName, rawArguments) => this.toolExecutionService
          ? this.toolExecutionService.executeToolDirect(toolName, rawArguments)
          : Promise.reject(new Error("ToolExecutionService indisponível.")),
        buildActiveGoalUserDataReply: (goal, plan) => this.activePlanningSession
          ? this.activePlanningSession.buildActiveGoalUserDataReply(goal, plan)
          : buildCapabilityPlanUserDataReply(plan),
        resolveEmailReferenceFromPrompt: (prompt, logger) => this.resolveEmailReferenceFromPrompt(prompt, logger),
        runDailyEditorialResearch: (input) => this.runDailyEditorialResearch(input),
        buildWorkflowExecutionBrief: (plan, step, requestLogger) => this.workflowSupportService
          ? this.workflowSupportService.buildWorkflowExecutionBrief(plan, step, requestLogger)
          : (this as any).buildWorkflowExecutionBrief(plan, step, requestLogger),
        saveWorkflowExecutionArtifact: (plan, step, brief) => this.workflowSupportService
          ? this.workflowSupportService.saveWorkflowExecutionArtifact(plan, step, brief)
          : (this as any).saveWorkflowExecutionArtifact(plan, step, brief),
        generateWorkflowDomainDeliverable: (plan, step, brief, requestLogger) => this.workflowSupportService
          ? this.workflowSupportService.generateWorkflowDomainDeliverable(plan, step, brief, requestLogger)
          : (this as any).generateWorkflowDomainDeliverable(plan, step, brief, requestLogger),
      });
    }
    return this.directServiceComposer;
  }

  private getGoogleWorkspaceDirectService(): GoogleWorkspaceDirectService {
    return this.getDirectServiceComposer().getGoogleWorkspaceDirectService();
  }

  private getExternalIntelligenceDirectService(): ExternalIntelligenceDirectService {
    return this.getDirectServiceComposer().getExternalIntelligenceDirectService();
  }

  private getCapabilityActionService(): CapabilityActionService {
    return this.getDirectServiceComposer().getCapabilityActionService();
  }

  private getCapabilityInspectionService(): CapabilityInspectionService {
    return this.getDirectServiceComposer().getCapabilityInspectionService();
  }

  private getKnowledgeProjectDirectService(): KnowledgeProjectDirectService {
    return this.getDirectServiceComposer().getKnowledgeProjectDirectService();
  }

  private getLifeManagementDirectService(): LifeManagementDirectService {
    return this.getDirectServiceComposer().getLifeManagementDirectService();
  }

  private getMissionDirectService(): MissionDirectService {
    return this.getDirectServiceComposer().getMissionDirectService();
  }

  private getResearchKnowledgeDirectService(): ResearchKnowledgeDirectService {
    return this.getDirectServiceComposer().getResearchKnowledgeDirectService();
  }

  private getOperationalContextDirectService(): OperationalContextDirectService {
    return this.getDirectServiceComposer().getOperationalContextDirectService();
  }

  private getAutonomyDirectService(): AutonomyDirectService {
    return this.getDirectServiceComposer().getAutonomyDirectService();
  }

  private getMemoryContactDirectService(): MemoryContactDirectService {
    return this.getDirectServiceComposer().getMemoryContactDirectService();
  }

  private getWorkflowDirectService(): WorkflowDirectService {
    return this.getDirectServiceComposer().getWorkflowDirectService();
  }

  private getOperationalReviewDirectService(): OperationalReviewDirectService {
    return this.getDirectServiceComposer().getOperationalReviewDirectService();
  }

  private getWorkspaceMacDirectService(): WorkspaceMacDirectService {
    return this.getDirectServiceComposer().getWorkspaceMacDirectService();
  }

  private getEmailDirectService(): EmailDirectService {
    return this.getDirectServiceComposer().getEmailDirectService();
  }

  private getContentDirectService(): ContentDirectService {
    return this.getDirectServiceComposer().getContentDirectService();
  }

  private getContentGenerationDirectService(): ContentGenerationDirectService {
    return this.getDirectServiceComposer().getContentGenerationDirectService();
  }

  private getDeliveryDirectService(): DeliveryDirectService {
    return this.getDirectServiceComposer().getDeliveryDirectService();
  }

  private getOperatorModeDirectService(): OperatorModeDirectService {
    return this.getDirectServiceComposer().getOperatorModeDirectService();
  }

  private getSelfImprovementDirectService(): SelfImprovementDirectService {
    return this.getDirectServiceComposer().getSelfImprovementDirectService();
  }

  private async tryRunDirectRoutes(input: {
    userPrompt: string;
    activeUserPrompt: string;
    requestId: string;
    requestLogger: Logger;
    intent: IntentResolution;
    orchestration: OrchestrationContext;
    preferences: UserPreferences;
    options?: AgentRunOptions;
  }): Promise<AgentRunResult | null> {
    return this.directRouteService.run(input);
  }

  async runDailyEditorialResearch(input?: DailyEditorialResearchInput): Promise<DailyEditorialResearchResult> {
    return this.dailyEditorialResearchService.run(input);
  }

  async runUserPrompt(userPrompt: string, options?: AgentRunOptions): Promise<AgentRunResult> {
    const requestId = randomUUID();
    const requestLogger = this.logger.child({ requestId });
    const intent = this.intentRouter.resolve(userPrompt);
    const activeUserPrompt = intent.activeUserPrompt;
    const orchestration = intent.orchestration;
    const preferences = this.preferences.get();

    requestLogger.info("Resolved orchestration context", {
      primaryDomain: orchestration.route.primaryDomain,
      secondaryDomains: orchestration.route.secondaryDomains,
      mentionedDomains: intent.mentionedDomains,
      compoundIntent: intent.compoundIntent,
      historyTurns: intent.historyUserTurns.length,
      actionMode: orchestration.route.actionMode,
      confidence: orchestration.route.confidence,
      riskLevel: orchestration.policy.riskLevel,
      autonomyLevel: orchestration.policy.autonomyLevel,
    });

    const preLocalExternalReasoningResult = await this.externalReasoningRunner.tryRunPreLocal({
      activeUserPrompt,
      requestId,
      requestLogger,
      intent,
      preferences,
      options,
    });
    if (preLocalExternalReasoningResult) {
      return preLocalExternalReasoningResult;
    }

    const directRouteResult = await this.tryRunDirectRoutes({
      userPrompt,
      activeUserPrompt,
      requestId,
      requestLogger,
      intent,
      orchestration,
      preferences,
      options,
    });
    if (directRouteResult) {
      return directRouteResult;
    }

    const context = this.contextAssembler.assemble({
      requestId,
      userPrompt,
      activeUserPrompt,
      orchestration,
      preferences,
      recentMessages: intent.historyUserTurns.slice(-6),
    });
    const contextWithReasoning = this.deliberativeReasoningRuntime.enrichContext({
      context,
      intent,
      requestLogger,
    });
    const synthesis = await this.responseSynthesizer.synthesize(contextWithReasoning, { requestLogger });
    const outcome = await this.turnPlanner.plan(contextWithReasoning, synthesis, { channelLabel: "core" });

    return {
      requestId,
      reply: outcome.reply,
      messages: outcome.messages,
      toolExecutions: outcome.toolExecutions,
    };
  }

  async executeToolDirect(toolName: string, rawArguments: unknown): Promise<{
    requestId: string;
    content: string;
    rawResult: unknown;
  }> {
    return this.toolExecutionService.executeToolDirect(toolName, rawArguments);
  }

  async resolveStructuredTaskOperationPayload(
    payload: Record<string, unknown>,
    options?: {
      recentMessages?: string[];
    },
  ) {
    return resolveStructuredTaskOperationPayload({
      payload,
      recentMessages: options?.recentMessages,
      accounts: this.googleWorkspaces,
    });
  }

  private async resolveEmailReferenceFromPrompt(
    userPrompt: string,
    requestLogger: Logger,
  ): Promise<ResolvedEmailReference | null> {
    const lookupRequest = extractEmailLookupRequest(userPrompt);
    if (!lookupRequest) {
      return null;
    }

    const messages = await this.email.scanRecentMessages({
      scanLimit: 180,
      unreadOnly: lookupRequest.unreadOnly,
      sinceHours: lookupRequest.sinceHours,
    });
    const matches = messages.filter((message) => {
      const summary = summarizeEmailForOperations({
        subject: message.subject,
        from: message.from,
        text: message.preview,
      });

      if (lookupRequest.senderQuery && !matchesSenderQuery(message, lookupRequest.senderQuery)) {
        return false;
      }

      if (lookupRequest.category && summary.group !== lookupRequest.category) {
        return false;
      }

      return true;
    });

    requestLogger.info("Resolved email lookup request", {
      senderQuery: lookupRequest.senderQuery,
      category: lookupRequest.category,
      unreadOnly: lookupRequest.unreadOnly,
      sinceHours: lookupRequest.sinceHours,
      totalScanned: messages.length,
      totalMatches: matches.length,
    });

    if (!matches.length) {
      return {
        label: buildEmailLookupLabel(lookupRequest),
        totalMatches: 0,
        request: lookupRequest,
      };
    }

    return {
      message: matches[0],
      label: buildEmailLookupLabel(lookupRequest),
      totalMatches: matches.length,
      request: lookupRequest,
    };
  }

  private selectToolsForPrompt(userPrompt: string) {
    const tools = this.pluginRegistry.listToolsForModel();
    if (!isEmailFocusedPrompt(userPrompt)) {
      const informationalPrompt =
        isWebResearchPrompt(userPrompt) ||
        isImplicitResearchPrompt(userPrompt) ||
        isInternalKnowledgePrompt(userPrompt) ||
        isWeatherPrompt(userPrompt) ||
        isAgentIdentityPrompt(userPrompt);

      if (!informationalPrompt) {
        return tools;
      }

      const mutatingTools = new Set([
        "write_workspace_file",
        "save_memory_item",
        "update_memory_item",
        "save_content_item",
        "update_content_item",
        "save_case_note",
        "save_lead",
        "update_lead_stage",
        "save_revenue_entry",
        "create_google_task",
        "create_calendar_event",
        "send_email_message",
        "send_email_reply",
        "mirror_project_to_workspace",
        "safe_exec",
        "export_growth_report",
        "export_content_calendar",
      ]);

      return tools.filter((tool) => !mutatingTools.has(tool.function.name));
    }

    const allowedEmailTools = new Set([
      "email_inbox_status",
      "list_recent_emails",
      "read_email_message",
      "triage_inbox",
    ]);

    return tools.filter((tool) => allowedEmailTools.has(tool.function.name));
  }

}

export interface AgentCoreRequestRuntime extends Pick<
  AgentCore,
  "runUserPrompt" | "resolveStructuredTaskOperationPayload" | "executeToolDirect"
> {}
