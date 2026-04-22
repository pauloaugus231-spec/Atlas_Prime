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
  type ContextBundle,
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
  normalizeEmailAnalysisText,
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
import type { RelationshipProfile } from "../types/relationship-profile.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type {
  CreateWorkflowPlanInput,
  WorkflowArtifactRecord,
  WorkflowPlanRecord,
  WorkflowStepRecord,
} from "../types/workflow.js";
import { WebResearchService, type WebResearchMode } from "./web-research.js";
import { GoogleTrendsIntakeService, type GoogleTrendItem } from "./trend-intake.js";
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
import { ObservationStore } from "./autonomy/observation-store.js";
import { SuggestionStore } from "./autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "./autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "./autonomy/feedback-store.js";
import { AutonomyLoop } from "./autonomy/autonomy-loop.js";
import { AutonomyActionService } from "./autonomy/autonomy-action-service.js";
import { AutonomyDirectService } from "./autonomy/autonomy-direct-service.js";
import { CommitmentStore } from "./autonomy/commitment-store.js";
import { MemoryCandidateStore } from "./autonomy/memory-candidate-store.js";
import {
  selectRelevantLearnedPreferences,
  summarizeIdentityProfileForReasoning,
  summarizeOperationalStateForReasoning,
} from "./personal-context-summary.js";
import {
  TurnPlanner,
} from "./turn-planner.js";
import {
  ReasoningEngine,
  type ReasoningTrace,
} from "./reasoning-engine.js";
import { UserModelTracker } from "./user-model-tracker.js";
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
import { EmailDirectService } from "./email-direct-service.js";
import { BriefingProfileService } from "./briefing-profile-service.js";
import type { AccountLinkingService } from "./account-linking/account-linking-service.js";
import type { CommandCenterService } from "./command-center/command-center-service.js";
import type { DestinationRegistry } from "./destination-registry.js";
import type { FinanceStore } from "./finance/finance-store.js";
import type { FinanceReviewService } from "./finance/finance-review-service.js";
import type { GraphIngestionService } from "./knowledge-graph/graph-ingestion.js";
import type { GraphQueryService } from "./knowledge-graph/graph-query.js";
import type { MissionReviewService } from "./missions/mission-review.js";
import type { MissionService } from "./missions/mission-service.js";
import type { ProfessionBootstrapService } from "./profession-bootstrap-service.js";
import type { ProfessionPackService } from "./profession-pack-service.js";
import type { RelationshipService } from "./relationship/relationship-service.js";
import type { ResearchDeskService } from "./research/research-desk-service.js";
import type { SharedBriefingComposer } from "./shared-briefing-composer.js";
import type { TimeOsService } from "./time-os-service.js";
import type { UserRoleProfileService } from "./user-role-profile-service.js";
import {
  AgentDirectRouteService,
  type AgentDirectRouteServiceDependencies,
} from "./agent-direct-route-service.js";
import { AgentDirectServiceRegistry } from "./agent-direct-service-registry.js";
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
  buildDailyEditorialResearchReply,
  buildDailyEditorialSlotFallbackIdeas,
  buildDeterministicFactLookupReply,
  buildDirectGoogleEventCreateReply,
  buildDistributionPlan,
  buildEmailLookupLabel,
  buildEmailLookupMissReply,
  buildEmailLookupReply,
  buildEmailSummaryReply,
  buildEmptyCalendarPeriodReply,
  buildEventLocationResearchQuery,
  buildFallbackEditorialIdeas,
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
  buildTrendChannelContext,
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
  EditorialSlotKey,
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
  extractEditorialSlotKeyFromNotes,
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
  filterSelectedTrendsForChannel,
  formatBriefDateTime,
  formatBriefTemperature,
  formatBriefTemperatureRange,
  formatCalendarDayHeader,
  formatCalendarTimeRange,
  formatCapabilityObjectiveLabel,
  formatCurrency,
  formatDateForTimezone,
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
  hasSavedShortPackage,
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
  normalizeEditorialSlotKey,
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
  stripCodeFences,
  stripForbiddenShortPromises,
  stripHtmlTags,
  stripResearchReplyMarkdown,
  summarizeCalendarLocation,
  summarizeEmailSender,
  summarizeTrackedMetrics,
  sumSceneDurations,
  truncateBriefText,
  uniqueAppend,
  validateShortFormPackage,
} from "./agent-core-helpers.js";
import type { AgentRunResult } from "./agent-core.js";


export interface WorkflowExecutionBriefPayload {
  summary: string;
  immediateActions: string[];
  risks: string[];
  outputs: string[];
  suggestedTools: string[];
  followUp: string;
}

export interface AgentDirectServiceComposerDependencies {
  config: AppConfig;
  logger: Logger;
  fileAccess: FileAccessPolicy;
  client: LlmClient;
  capabilityRegistry: CapabilityRegistry;
  autonomyObservations: ObservationStore;
  autonomySuggestions: SuggestionStore;
  autonomyAudit: AutonomyAuditStore;
  autonomyFeedback: FeedbackStore;
  commitments: CommitmentStore;
  memoryCandidates: MemoryCandidateStore;
  autonomyLoop: AutonomyLoop;
  capabilityPlanner: CapabilityPlanner;
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
  emailAccounts: EmailAccountsService;
  googleWorkspace: GoogleWorkspaceService;
  googleWorkspaces: GoogleWorkspaceAccountsService;
  googleMaps: GoogleMapsService;
  personalOs: PersonalOSService;
  responseOs: ResponseOS;
  contextPacks: ContextPackService;
  planBuilder: WorkflowPlanBuilderService;
  pexelsMedia: PexelsMediaService;
  projectOps: ProjectOpsService;
  safeExec: SafeExecService;
  accountLinking?: AccountLinkingService;
  userRoleProfiles?: UserRoleProfileService;
  professionPacks?: ProfessionPackService;
  professionBootstrap?: ProfessionBootstrapService;
  destinationRegistry?: DestinationRegistry;
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
  createWebResearchService: (logger: Logger) => Pick<WebResearchService, "search" | "fetchPageExcerpt">;
  executeToolDirect: (toolName: string, rawArguments: unknown) => Promise<{ requestId: string; content: string; rawResult: unknown }>;
  buildActiveGoalUserDataReply: (goal: ActivePlanningGoal, plan: CapabilityPlan) => string;
  resolveEmailReferenceFromPrompt: (prompt: string, logger: Logger) => Promise<ResolvedEmailReference | null>;
  runDailyEditorialResearch: (input?: {
    channelKey?: string;
    timezone?: string;
    trendsLimit?: number;
    ideasLimit?: number;
    now?: Date;
  }) => Promise<{ reply: string; runDate: string; createdItemIds: number[]; skipped: boolean }>;
  buildWorkflowExecutionBrief: (
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    requestLogger: Logger,
  ) => Promise<WorkflowExecutionBriefPayload>;
  saveWorkflowExecutionArtifact: (
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: WorkflowExecutionBriefPayload,
  ) => WorkflowArtifactRecord;
  generateWorkflowDomainDeliverable: (
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: WorkflowExecutionBriefPayload,
    requestLogger: Logger,
  ) => Promise<{ artifact: WorkflowArtifactRecord; summary: string }>;
}

export class AgentDirectServiceComposer {
  private directServiceRegistry?: AgentDirectServiceRegistry;

  constructor(private readonly deps: AgentDirectServiceComposerDependencies) {}

  private createLifeManagementDirectService(): LifeManagementDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackTimeOs = { renderOverview: async () => "Tempo e agenda indisponíveis." };
      const fallbackFinanceStore = {
        createEntry: (input: { title: string; amount: number; kind?: "income" | "expense" | "bill"; status?: "planned" | "due" | "paid" | "overdue"; category?: string; dueAt?: string; sourceKind?: "manual" | "email" | "document" | "message" | "system"; notes?: string; }) => ({
          id: 0,
          title: input.title,
          amount: input.amount,
          kind: input.kind ?? "expense",
          status: input.status ?? "planned",
          ...(input.category ? { category: input.category } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
          sourceKind: input.sourceKind ?? "manual",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }),
      };
      const fallbackFinanceReview = { renderOverview: () => "Finanças indisponíveis." };
      const fallbackRelationships = {
        renderFollowUpList: () => "Relacionamentos indisponíveis.",
        renderProfile: () => undefined as string | undefined,
        saveManual: (input: { displayName: string; kind?: RelationshipProfile["kind"]; notes?: string[]; nextFollowUpAt?: string; }) => ({
          id: "fallback",
          displayName: input.displayName,
          kind: input.kind ?? "unknown",
          channels: [],
          openCommitments: [],
          notes: input.notes ?? [],
          trustLevel: "known" as const,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }),
      };
      return new LifeManagementDirectService({
        logger: baseLogger.child({ scope: "life-management-direct-service" }),
        timeOs: this.deps.timeOs ?? fallbackTimeOs,
        financeStore: this.deps.financeStore ?? fallbackFinanceStore,
        financeReview: this.deps.financeReview ?? fallbackFinanceReview,
        relationships: this.deps.relationships ?? fallbackRelationships,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
      });
  }

  private createMissionDirectService(): MissionDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackMissions = {
        create: () => ({}),
        renderStatus: () => "Nenhuma missão disponível.",
        renderNextAction: () => "Nenhuma missão disponível.",
        renderRisks: () => "Nenhuma missão disponível.",
      };
      const fallbackReview = { renderReview: () => "Nenhuma missão disponível." };
      return new MissionDirectService({
        logger: baseLogger.child({ scope: "mission-direct-service" }),
        missions: this.deps.missions ?? fallbackMissions,
        missionReview: this.deps.missionReview ?? fallbackReview,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
      });
  }

  private createResearchKnowledgeDirectService(): ResearchKnowledgeDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackResearchDesk = {
        researchAndSave: async () => ({}),
        renderSaved: () => "Ainda não há pesquisa salva.",
      };
      const fallbackGraphQuery = {
        explain: () => "Grafo de conhecimento indisponível.",
      };
      return new ResearchKnowledgeDirectService({
        logger: baseLogger.child({ scope: "research-knowledge-direct-service" }),
        researchDesk: this.deps.researchDesk ?? fallbackResearchDesk,
        graphQuery: this.deps.graphQuery ?? fallbackGraphQuery,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
      });
  }

  private createAutonomyDirectService(): AutonomyDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const actionService = new AutonomyActionService({
        logger: baseLogger.child({ scope: "autonomy-action-service" }),
        capabilityRegistry: this.deps.capabilityRegistry,
        observations: this.deps.autonomyObservations,
        suggestions: this.deps.autonomySuggestions,
        audit: this.deps.autonomyAudit,
        feedback: this.deps.autonomyFeedback,
        commitments: this.deps.commitments,
        memoryCandidates: this.deps.memoryCandidates,
        personalMemory: this.deps.personalMemory,
        executeToolDirect: (toolName, rawArguments) => this.deps.executeToolDirect(toolName, rawArguments),
      });

      return new AutonomyDirectService({
        logger: baseLogger.child({ scope: "autonomy-direct-service" }),
        loop: this.deps.autonomyLoop,
        actionService,
        commitments: this.deps.commitments,
        memoryCandidates: this.deps.memoryCandidates,
        suggestions: this.deps.autonomySuggestions,
        observations: this.deps.autonomyObservations,
        audit: this.deps.autonomyAudit,
        feedback: this.deps.autonomyFeedback,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
      });
  }

  private createGoogleWorkspaceDirectService(): GoogleWorkspaceDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackEmailAccounts = {
        getAliases: (): string[] => [],
        getReader: () => ({
          getStatus: async () => ({ ready: false, message: "Email indisponível." }),
          scanRecentMessages: async () => [],
        }),
      };
      const fallbackResponseOs = {
        buildTaskReviewReply: (input: {
          scopeLabel: string;
          items: Array<{ title: string; account: string; dueLabel: string }>;
        }) => [
          `${input.scopeLabel}: ${input.items.length}.`,
          ...input.items.map((item) => `- ${item.title} | conta: ${item.account} | prazo: ${item.dueLabel}`),
        ].join("\n"),
        buildScheduleLookupReply: (input: {
          targetLabel: string;
          topicLabel?: string;
          events: Array<{ account: string; summary: string; start: string | null; location?: string }>;
          emailFallbackCount: number;
        }) => JSON.stringify({
          targetLabel: input.targetLabel,
          topicLabel: input.topicLabel,
          events: input.events.length,
          emailFallbackCount: input.emailFallbackCount,
        }),
        buildCalendarConflictReviewReply: (input: {
          scopeLabel: string;
          totalEvents: number;
          overlapCount: number;
          duplicateCount: number;
          namingCount: number;
        }) => JSON.stringify({
          scopeLabel: input.scopeLabel,
          totalEvents: input.totalEvents,
          overlapCount: input.overlapCount,
          duplicateCount: input.duplicateCount,
          namingCount: input.namingCount,
        }),
      };
      return new GoogleWorkspaceDirectService({
        logger: baseLogger.child({ scope: "google-workspace-direct-service" }),
        defaultTimezone: this.deps.config.google.defaultTimezone,
        googleWorkspaces: this.deps.googleWorkspaces,
        googleMaps: this.deps.googleMaps,
        emailAccounts: this.deps.emailAccounts ?? fallbackEmailAccounts,
        responseOs: this.deps.responseOs ?? fallbackResponseOs,
        getPreferences: () => this.deps.preferences?.get?.() ?? {
          responseStyle: "executive",
          responseLength: "medium",
          proactiveNextStep: false,
          autoSourceFallback: false,
          preferredAgentName: "Atlas",
        },
        getProfile: () => this.deps.personalMemory?.getProfile?.() ?? {
          displayName: "Usuário",
          primaryRole: "operador",
          routineSummary: [],
          timezone: this.deps.config.google.defaultTimezone,
          preferredChannels: ["telegram"],
          priorityAreas: [],
          defaultAgendaScope: "both",
          workCalendarAliases: [],
          responseStyle: "direto",
          briefingPreference: "executivo",
          detailLevel: "equilibrado",
          tonePreference: "objetivo",
          defaultOperationalMode: "normal",
          mobilityPreferences: [],
          autonomyPreferences: [],
          savedFocus: [],
          routineAnchors: [],
          operationalRules: [],
          attire: {
            umbrellaProbabilityThreshold: 40,
            coldTemperatureC: 14,
            lightClothingTemperatureC: 24,
            carryItems: [],
          },
          fieldModeHours: 6,
        },
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        executeToolDirect: (toolName, rawArguments) => this.deps.executeToolDirect(toolName, rawArguments),
        helpers: {
          isGoogleTasksPrompt,
          extractCalendarLookupRequest,
          extractExplicitAccountAlias,
          resolvePromptAccountAliases,
          resolveCalendarTargets,
          extractExplicitCalendarAlias,
          formatTaskDue,
          formatBriefDateTime,
          summarizeCalendarLocation,
          buildGoogleContactsReply,
          buildGoogleCalendarsReply,
          buildCalendarPeriodReply,
          buildPlaceLookupReply,
          looksLikePostalAddress,
          lookupVenueAddress: (location, prompt, logger) =>
            lookupVenueAddress(location, prompt, logger, this.deps.googleMaps),
          shouldAutoCreateGoogleEvent,
          buildDirectGoogleEventCreateReply,
          isGoogleContactsPrompt,
          extractGoogleContactsQuery,
          isGoogleCalendarsListPrompt,
          isPlaceLookupPrompt,
          extractPlaceLookupQuery,
          isCalendarPeriodListPrompt,
          parseCalendarPeriodWindow,
          resolveActionAutonomyKey: (prompt) => resolveActionAutonomyRule(prompt).key,
          resolveEffectiveOperationalMode,
          isCalendarConflictReviewPrompt,
          isCalendarMovePrompt,
          isCalendarPeriodDeletePrompt,
          isCalendarDeletePrompt,
          extractCalendarMoveParts,
          parseCalendarLookupDate,
          extractCalendarDeleteTopic,
          extractCalendarLookupTopic,
          cleanCalendarEventTopicReference,
          normalizeCalendarUpdateInstruction,
        },
      });
  }

  private createExternalIntelligenceDirectService(): ExternalIntelligenceDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const fallbackClient: Pick<LlmClient, "chat"> = {
        chat: async () => ({
          model: "fallback",
          done: true,
          message: {
            role: "assistant",
            content: "",
          },
        }),
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const createWebResearchService = this.deps.createWebResearchService ?? ((logger: Logger) => new WebResearchService(logger));

      return new ExternalIntelligenceDirectService({
        logger: baseLogger.child({ scope: "external-intelligence-direct-service" }),
        client: this.deps.client ?? fallbackClient,
        googleMaps: this.deps.googleMaps,
        createWebResearchService,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isWebResearchPrompt,
          isImplicitResearchPrompt,
          extractWebResearchQuery,
          extractWebResearchMode,
          maxResearchResultsForMode,
          excerptBudgetForResearchMode,
          inferOfficialFallbackUrls,
          buildResearchFocusTerms,
          extractRequestedResearchFactTypes,
          inferResearchSynthesisProfile,
          fetchOfficialAliasSources: (service, urls, logger, focusTerms, maxChars) =>
            fetchOfficialAliasSources(service as WebResearchService, urls, logger, focusTerms, maxChars),
          scoreFocusedExcerpt,
          buildDeterministicFactLookupReply,
          buildWebResearchReply,
          stripResearchReplyMarkdown,
          extractResearchFacts,
          buildMapsRouteReply,
          buildPlaceDiscoveryReply,
        },
      });
  }

  private createCapabilityActionService(): CapabilityActionService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackPersonalMemory = {
        recordProductGapObservation: (input: import("../types/product-gaps.js").CreateProductGapObservationInput) => ({
          id: 1,
          signature: input.signature,
          type: input.type,
          description: input.description,
          inferredObjective: input.inferredObjective,
          missingCapabilities: input.missingCapabilities,
          missingRequirementKinds: input.missingRequirementKinds,
          contextSummary: input.contextSummary,
          relatedSkill: input.relatedSkill,
          channel: input.channel,
          impact: input.impact === "high" || input.impact === "low" ? input.impact : "medium",
          recurrence: 1,
          status: "open",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastObservedAt: new Date(0).toISOString(),
        }),
      };

      return new CapabilityActionService({
        logger: baseLogger.child({ scope: "capability-action-service" }),
        personalMemory: this.deps.personalMemory ?? fallbackPersonalMemory,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          buildActiveGoalUserDataReply: (goal, plan) => this.deps.buildActiveGoalUserDataReply(goal, plan),
          buildCapabilityPlanUserDataReply,
          buildCapabilityGapReply,
          buildCapabilityGapSignature,
        },
      });
  }

  private createCapabilityInspectionService(): CapabilityInspectionService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackCapabilityPlanner = {
        isCapabilityInspectionPrompt: () => false,
        listCapabilityAvailability: () => [] as CapabilityAvailabilityRecord[],
      };
      const fallbackPersonalMemory = {
        listProductGaps: () => [] as ProductGapRecord[],
      };

      return new CapabilityInspectionService({
        logger: baseLogger.child({ scope: "capability-inspection-service" }),
        capabilityPlanner: this.deps.capabilityPlanner ?? fallbackCapabilityPlanner,
        personalMemory: this.deps.personalMemory ?? fallbackPersonalMemory,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          buildCapabilityAvailabilityReply,
          buildProductGapsReply,
          buildProductGapDetailReply,
        },
      });
  }

  private createKnowledgeProjectDirectService(): KnowledgeProjectDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackFileAccess = {
        resolveReadablePathFromRoot: () => {
          throw new Error("File access indisponivel.");
        },
      };
      const fallbackProjectOps = {
        scanProject: async () => ({}),
        getGitStatus: async () => undefined as unknown as Record<string, unknown>,
      };

      return new KnowledgeProjectDirectService({
        logger: baseLogger.child({ scope: "knowledge-project-direct-service" }),
        fileAccess: this.deps.fileAccess ?? fallbackFileAccess,
        projectOps: this.deps.projectOps ?? fallbackProjectOps,
        executeToolDirect: (toolName, rawArguments) => this.deps.executeToolDirect(toolName, rawArguments),
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isInternalKnowledgePrompt,
          extractInternalKnowledgeQuery,
          buildInternalKnowledgeReply,
          isProjectScanPrompt,
          extractProjectRoot,
          extractProjectPath,
          buildProjectScanReply,
          isMirrorProjectPrompt,
          extractMirrorSourceRoot,
          extractMirrorTargetPath,
        },
      });
  }

  private createOperationalContextDirectService(): OperationalContextDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      let fallbackPreferences: UserPreferences = {
        responseStyle: "executive",
        responseLength: "medium",
        proactiveNextStep: false,
        autoSourceFallback: false,
        preferredAgentName: "Atlas",
      };
      const fallbackProfile: PersonalOperationalProfile = {
        displayName: "Usuário",
        primaryRole: "operador",
        routineSummary: [],
        timezone: this.deps.config.google.defaultTimezone,
        preferredChannels: ["telegram"],
        priorityAreas: [],
        defaultAgendaScope: "both",
        workCalendarAliases: [],
        responseStyle: "direto",
        briefingPreference: "executivo",
        detailLevel: "equilibrado",
        tonePreference: "objetivo",
        defaultOperationalMode: "normal",
        mobilityPreferences: [],
        autonomyPreferences: [],
        savedFocus: [],
        routineAnchors: [],
        operationalRules: [],
        attire: {
          umbrellaProbabilityThreshold: 40,
          coldTemperatureC: 14,
          lightClothingTemperatureC: 24,
          carryItems: [],
        },
        fieldModeHours: 6,
      };
      const fallbackOperationalState: OperationalState = {
        mode: "normal",
        focus: [],
        weeklyPriorities: [],
        pendingAlerts: [],
        criticalTasks: [],
        upcomingCommitments: [],
        briefing: {},
        recentContext: [],
        signals: [],
        pendingApprovals: 0,
        updatedAt: new Date(0).toISOString(),
      };
      const fallbackGoogleWorkspace = {
        getStatus: () => ({
          ready: false,
          message: "Google Workspace indisponível.",
        }),
        getDailyBrief: async () => ({
          timezone: this.deps.config.google.defaultTimezone,
          windowStart: new Date(0).toISOString(),
          windowEnd: new Date(0).toISOString(),
          events: [],
          tasks: [],
        }),
      };
      const fallbackMemory = {
        getDailyFocus: () => [],
      };
      const fallbackPersonalOs = {
        getExecutiveMorningBrief: async () => ({
          timezone: this.deps.config.google.defaultTimezone,
          events: [],
          taskBuckets: {
            today: [],
            overdue: [],
            stale: [],
            actionableCount: 0,
          },
          emails: [],
          approvals: [],
          workflows: [],
          focus: [],
          memoryEntities: {
            total: 0,
            byKind: {},
            recent: [],
          },
          motivation: {
            text: "Sem mensagem do dia.",
          },
          founderSnapshot: {
            sections: [],
          },
          personalFocus: [],
          overloadLevel: "leve" as const,
          mobilityAlerts: [],
          operationalSignals: [],
          conflictSummary: {
            overlaps: 0,
            duplicates: 0,
            naming: 0,
          },
        }),
      };
      const fallbackPreferencesStore = {
        get: () => fallbackPreferences,
        update: (input: import("../types/user-preferences.js").UpdateUserPreferencesInput) => {
          fallbackPreferences = {
            ...fallbackPreferences,
            ...input,
          };
          return fallbackPreferences;
        },
      };
      const fallbackPersonalMemory = {
        getProfile: () => fallbackProfile,
        getOperationalState: () => fallbackOperationalState,
        findLearnedPreferences: () => [] as LearnedPreference[],
        findItems: () => [] as PersonalOperationalMemoryItem[],
      };
      const briefingProfiles = new BriefingProfileService(
        this.deps.personalMemory ?? fallbackPersonalMemory,
        this.deps.personalOs ?? fallbackPersonalOs,
        baseLogger.child({ scope: "briefing-profile-service" }),
      );
      const fallbackGoalStore = {
        list: () => [] as import("./goal-store.js").ActiveGoal[],
        get: () => undefined as import("./goal-store.js").ActiveGoal | undefined,
        upsert: (goal: Omit<import("./goal-store.js").ActiveGoal, "id" | "createdAt" | "updatedAt"> & { id?: string }) => ({
          id: goal.id ?? "fallback-goal",
          title: goal.title,
          description: goal.description,
          metric: goal.metric,
          deadline: goal.deadline,
          progress: goal.progress,
          domain: goal.domain,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }),
        updateProgress: () => undefined as import("./goal-store.js").ActiveGoal | undefined,
        remove: () => false,
        summarize: () => "Objetivos: nenhum ativo.",
      };
      const fallbackExecuteToolDirect = async () => ({
        requestId: "fallback-operational-context",
        content: "",
        rawResult: {},
      });

      return new OperationalContextDirectService({
        logger: baseLogger.child({ scope: "operational-context-direct-service" }),
        googleWorkspace: this.deps.googleWorkspace ?? fallbackGoogleWorkspace,
        memory: this.deps.memory ?? fallbackMemory,
        personalOs: this.deps.personalOs ?? fallbackPersonalOs,
        briefingProfiles,
        preferences: this.deps.preferences ?? fallbackPreferencesStore,
        personalMemory: this.deps.personalMemory ?? fallbackPersonalMemory,
        goalStore: this.deps.goalStore ?? fallbackGoalStore,
        professionBootstrap: this.deps.professionBootstrap,
        accountLinking: this.deps.accountLinking,
        destinationRegistry: this.deps.destinationRegistry,
        sharedBriefingComposer: this.deps.sharedBriefingComposer,
        commandCenter: this.deps.commandCenter,
        executeToolDirect: (toolName, rawArguments) =>
          this.deps.executeToolDirect ? this.deps.executeToolDirect(toolName, rawArguments) : fallbackExecuteToolDirect(),
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isOperationalBriefPrompt,
          buildOperationalBriefReply,
          isMorningBriefPrompt,
          buildMorningBriefReply,
          resolveEffectiveOperationalMode,
          isPersonalOperationalProfileShowPrompt,
          buildPersonalOperationalProfileReply,
          isOperationalStateShowPrompt,
          buildOperationalStateReply,
          isLearnedPreferencesListPrompt,
          resolveLearnedPreferencesListFilter,
          buildLearnedPreferencesReply,
          isLearnedPreferencesDeletePrompt,
          extractLearnedPreferenceId,
          extractLearnedPreferenceDeleteTarget,
          buildLearnedPreferenceDeactivatedReply,
          isPersonalOperationalProfileUpdatePrompt,
          extractPersonalOperationalProfileUpdate,
          buildPersonalOperationalProfileUpdatedReply,
          isPersonalOperationalProfileDeletePrompt,
          extractPersonalOperationalProfileRemoveQuery,
          removeFromPersonalOperationalProfile,
          buildPersonalOperationalProfileRemovedReply,
          isPersonalMemoryListPrompt,
          buildPersonalMemoryListReply,
          isPersonalMemorySavePrompt,
          extractPersonalMemoryStatement,
          inferPersonalMemoryKind,
          buildPersonalMemoryTitle,
          buildPersonalMemorySavedReply,
          isPersonalMemoryUpdatePrompt,
          extractPersonalMemoryId,
          extractPersonalMemoryUpdateTarget,
          extractPersonalMemoryUpdateContent,
          buildPersonalMemoryAmbiguousReply,
          buildPersonalMemoryUpdatedReply,
          isPersonalMemoryDeletePrompt,
          extractPersonalMemoryDeleteTarget,
          buildPersonalMemoryDeletedReply,
        },
      });
  }

  private createMemoryContactDirectService(): MemoryContactDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackContacts = {
        listContacts: () => [] as ContactProfileRecord[],
        upsertContact: (input: UpsertContactProfileInput) => ({
          id: 0,
          channel: input.channel,
          identifier: input.identifier,
          displayName: input.displayName ?? null,
          relationship: input.relationship,
          persona: input.persona,
          priority: input.priority ?? "media",
          company: input.company ?? null,
          preferredTone: input.preferredTone ?? null,
          notes: input.notes ?? null,
          tags: input.tags ?? [],
          source: input.source ?? null,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        }),
      };
      const fallbackEntityLinker = {
        upsertContact: () => undefined,
      };
      const fallbackMemoryEntities = {
        list: () => [] as MemoryEntityRecord[],
        search: () => [] as MemoryEntityRecord[],
      };

      return new MemoryContactDirectService({
        logger: baseLogger.child({ scope: "memory-contact-direct-service" }),
        contacts: this.deps.contacts ?? fallbackContacts,
        entityLinker: this.deps.entityLinker ?? fallbackEntityLinker,
        memoryEntities: this.deps.memoryEntities ?? fallbackMemoryEntities,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isContactListPrompt,
          isContactUpsertPrompt,
          extractContactProfileInput,
          buildContactSaveReply,
          buildContactListReply,
          isMemoryEntityListPrompt,
          isMemoryEntitySearchPrompt,
          extractMemoryEntityKindFromPrompt,
          extractMemoryEntitySearchQuery,
          buildMemoryEntityListReply,
        },
      });
  }

  private createWorkflowDirectService(): WorkflowDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackPlan: WorkflowPlanRecord = {
        id: 0,
        title: "Workflow fallback",
        objective: "fallback",
        executiveSummary: "fallback",
        status: "draft",
        primaryDomain: "secretario_operacional",
        secondaryDomains: [],
        deliverables: [],
        nextAction: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        steps: [],
      };
      const fallbackStep: WorkflowStepRecord = {
        planId: 0,
        stepNumber: 1,
        title: "Etapa fallback",
        ownerDomain: "secretario_operacional",
        taskType: "execution",
        objective: "fallback",
        deliverable: "fallback",
        successCriteria: "fallback",
        dependsOn: [],
        suggestedTools: [],
        status: "pending",
        notes: null,
      };
      const fallbackArtifact: WorkflowArtifactRecord = {
        id: 0,
        planId: 0,
        stepNumber: 1,
        artifactType: "execution_brief",
        title: "Artefato fallback",
        summary: "fallback",
        content: "fallback",
        filePath: null,
        createdAt: new Date(0).toISOString(),
      };
      const fallbackPlanBuilder = {
        createPlanFromPrompt: async () => fallbackPlan,
      };
      const fallbackEntityLinker = {
        upsertWorkflowRun: () => undefined,
      };
      const fallbackWorkflows = {
        listPlans: () => [] as WorkflowPlanRecord[],
        latestPlan: () => null,
        getPlan: () => null,
        listArtifacts: () => [] as WorkflowArtifactRecord[],
        saveArtifact: () => fallbackArtifact,
      };
      const fallbackWorkflowRuntime = {
        startStep: () => ({
          plan: fallbackPlan,
          step: fallbackStep,
        }),
        completeStep: () => ({
          plan: fallbackPlan,
          step: {
            ...fallbackStep,
            status: "completed" as const,
          },
        }),
        blockStep: () => ({
          plan: fallbackPlan,
          step: {
            ...fallbackStep,
            status: "blocked" as const,
          },
        }),
        failStep: () => ({
          plan: fallbackPlan,
          step: {
            ...fallbackStep,
            status: "failed" as const,
          },
        }),
        markWaitingApproval: () => ({
          plan: fallbackPlan,
          step: {
            ...fallbackStep,
            status: "waiting_approval" as const,
          },
        }),
        resetStepToPending: () => ({
          plan: fallbackPlan,
          step: fallbackStep,
        }),
        resumeStep: () => ({
          plan: {
            ...fallbackPlan,
            status: "active" as const,
          },
          step: {
            ...fallbackStep,
            status: "in_progress" as const,
          },
        }),
      };

      return new WorkflowDirectService({
        logger: baseLogger.child({ scope: "workflow-direct-service" }),
        planBuilder: this.deps.planBuilder ?? fallbackPlanBuilder,
        entityLinker: this.deps.entityLinker ?? fallbackEntityLinker,
        workflows: this.deps.workflows ?? fallbackWorkflows,
        workflowRuntime: this.deps.workflowRuntime ?? fallbackWorkflowRuntime,
        buildWorkflowExecutionBrief: (plan, step, requestLogger) => this.deps.buildWorkflowExecutionBrief(plan, step, requestLogger),
        saveWorkflowExecutionArtifact: (plan, step, brief) => this.deps.saveWorkflowExecutionArtifact(plan, step, brief),
        generateWorkflowDomainDeliverable: (plan, step, brief, requestLogger) =>
          this.deps.generateWorkflowDomainDeliverable(plan, step, brief, requestLogger),
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isWorkflowPlanningPrompt,
          isWorkflowShowPrompt,
          buildWorkflowPlanReply,
          isWorkflowListPrompt,
          buildWorkflowListReply,
          isWorkflowArtifactListPrompt,
          extractWorkflowPlanId,
          extractWorkflowStepNumber,
          buildWorkflowArtifactsReply,
          isWorkflowExecutionPrompt,
          shouldAutoExecuteWorkflowDeliverable,
          buildWorkflowExecutionReply,
          isWorkflowStepUpdatePrompt,
          extractWorkflowStepStatus,
          buildWorkflowStepUpdateReply,
        },
      });
  }

  private createOperationalReviewDirectService(): OperationalReviewDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackClient: Pick<LlmClient, "chat"> = {
        chat: async () => ({
          model: "fallback",
          done: true,
          message: {
            role: "assistant",
            content: "",
          },
        }),
      };
      const fallbackEmail: EmailReader = {
        getStatus: async () => ({
          enabled: false,
          configured: false,
          ready: false,
          mailbox: "INBOX",
          message: "Email indisponível.",
        }),
        listRecentMessages: async () => [],
        scanRecentMessages: async () => [],
        readMessage: async () => ({
          uid: "fallback",
          subject: "(sem assunto)",
          from: [],
          to: [],
          cc: [],
          replyTo: [],
          date: null,
          flags: [],
          preview: "",
          messageId: null,
          text: "",
          truncated: false,
          references: [],
        }),
      };
      const fallbackResponseOs = {
        buildSupportQueueReply: () => "Support review indisponível.",
        buildInboxTriageReply: () => "Inbox triage indisponível.",
        buildFollowUpReviewReply: () => "Follow-up review indisponível.",
        buildCommitmentPrepReply: () => "Preparação de compromisso indisponível.",
      };
      const fallbackCommunicationRouter = {
        classify: () => ({
          relationship: "unknown",
          persona: "operacional_neutro",
          actionPolicy: "manual_review",
        }),
      };
      const fallbackApprovals = {
        listPendingAll: () => [],
      };
      const fallbackWhatsAppMessages = {
        listRecent: () => [],
      };
      const fallbackGrowthOps = {
        listLeads: () => [] as LeadRecord[],
      };
      const fallbackPersonalOs = {
        getExecutiveMorningBrief: async () => ({
          timezone: this.deps.config.google.defaultTimezone,
          events: [],
          taskBuckets: {
            today: [],
            overdue: [],
            stale: [],
            actionableCount: 0,
          },
          emails: [],
          approvals: [],
          workflows: [],
          focus: [],
          memoryEntities: {
            total: 0,
            byKind: {},
            recent: [],
          },
          motivation: {
            text: "Sem mensagem do dia.",
          },
          founderSnapshot: {
            executiveLine: "Founder snapshot indisponível.",
            sections: [],
            trackedMetrics: [],
          },
          personalFocus: [],
          overloadLevel: "leve" as const,
          mobilityAlerts: [],
          operationalSignals: [],
          conflictSummary: {
            overlaps: 0,
            duplicates: 0,
            naming: 0,
          },
        }),
      };
      const fallbackContextPacks = {
        buildForPrompt: async () => null,
      };

      return new OperationalReviewDirectService({
        logger: baseLogger.child({ scope: "operational-review-direct-service" }),
        client: this.deps.client ?? fallbackClient,
        email: this.deps.email ?? fallbackEmail,
        approvals: this.deps.approvals ?? fallbackApprovals,
        whatsappMessages: this.deps.whatsappMessages ?? fallbackWhatsAppMessages,
        communicationRouter: this.deps.communicationRouter ?? fallbackCommunicationRouter,
        contextPacks: this.deps.contextPacks ?? fallbackContextPacks,
        responseOs: this.deps.responseOs ?? fallbackResponseOs,
        growthOps: this.deps.growthOps ?? fallbackGrowthOps,
        personalOs: this.deps.personalOs ?? fallbackPersonalOs,
        resolveEmailReferenceFromPrompt: (prompt, logger) => this.deps.resolveEmailReferenceFromPrompt(prompt, logger),
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isSupportReviewPrompt,
          isInboxTriagePrompt,
          isFollowUpReviewPrompt,
          isNextCommitmentPrepPrompt,
          isEmailDraftPrompt,
          summarizeEmailForOperations,
          extractEmailIdentifier,
          normalizeEmailAnalysisText,
          includesAny,
          isUrgentSupportSignal,
          extractSupportTheme,
          classifyFollowUpBucket,
          formatFollowUpDueLabel,
          truncateBriefText,
          formatBriefDateTime: (value, timezone) => formatBriefDateTime(value ?? null, timezone),
          summarizeCalendarLocation,
          extractEmailUidFromPrompt,
          buildEmailLookupMissReply: (request) => buildEmailLookupMissReply(request as {
            senderQuery?: string;
            category?: EmailOperationalGroup;
            unreadOnly: boolean;
            sinceHours: number;
            existenceOnly: boolean;
          }),
          extractDisplayName,
          inferReplyContext,
          extractToneHint,
          extractExactReplyBody,
          hasAffirmativeIntent,
          buildAffirmativeReplyTemplate,
          hasRejectionIntent,
          buildRejectionReplyTemplate,
          stripCodeFences,
        },
      });
  }

  private createWorkspaceMacDirectService(): WorkspaceMacDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackFileAccess = {
        describeReadableRoots: () => ({
          workspace: "",
          authorized_projects: "",
          authorized_dev: "",
          authorized_social: "",
          authorized_content: "",
          authorized_finance: "",
          authorized_admin: "",
        }),
      };
      const fallbackSafeExec = {
        execute: async () => {
          throw new Error("safe_exec indisponivel.");
        },
      };
      const fallbackMacCommandQueue = {
        getStatus: () => ({
          enabled: false,
          configured: false,
          ready: false,
          targetHost: "atlas_mac",
          commandsTable: "mac_commands",
          workersTable: "mac_workers",
          message: "Fila remota do Mac indisponível.",
        }),
        listPending: async () => [],
        enqueueCommand: async () => ({
          id: "fallback",
          summary: "fallback",
          targetHost: "atlas_mac",
          }),
      };

      return new WorkspaceMacDirectService({
        logger: baseLogger.child({ scope: "workspace-mac-direct-service" }),
        workspaceDir: this.deps.config.paths.workspaceDir,
        authorizedProjectsDir: this.deps.config.paths.authorizedProjectsDir,
        fileAccess: this.deps.fileAccess ?? fallbackFileAccess,
        safeExec: this.deps.safeExec ?? fallbackSafeExec,
        macCommandQueue: this.deps.macCommandQueue ?? fallbackMacCommandQueue,
        buildBaseMessages: (userPrompt, orchestration, preferences) =>
          buildBaseMessages(userPrompt, orchestration, preferences),
        helpers: {
          isAllowedSpacesPrompt,
          buildAllowedSpacesReply,
          extractSafeExecRequest,
          buildSafeExecReply,
          isMacQueueStatusPrompt,
          isMacQueueListPrompt,
          buildMacQueueStatusReply,
          buildMacQueueListReply,
          buildMacQueueEnqueueReply,
          extractMacOpenApp,
          extractMacOpenUrl,
          extractMacNotificationText,
          extractMacProjectOpenAlias,
          extractMacProjectCommand,
        },
      });
  }

  private createEmailDirectService(): EmailDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackEmail = {
        getStatus: async () => ({
          enabled: false,
          configured: false,
          ready: false,
          mailbox: "INBOX",
          message: "Email indisponível.",
        }),
        listRecentMessages: async () => [],
        scanRecentMessages: async () => [],
        readMessage: async (uid: string) => ({
          uid,
          threadId: null,
          subject: "(sem assunto)",
          from: [],
          to: [],
          cc: [],
          replyTo: [],
          date: null,
          flags: [],
          preview: "",
          messageId: null,
          text: "",
          truncated: false,
          references: [],
        }),
      };
      const fallbackCommunicationRouter = {
        classify: () => ({
          relationship: "unknown",
          persona: "operacional_neutro",
          actionPolicy: "review_first",
        }),
      };

      return new EmailDirectService({
        logger: baseLogger.child({ scope: "email-direct-service" }),
        email: this.deps.email ?? fallbackEmail,
        communicationRouter: this.deps.communicationRouter ?? fallbackCommunicationRouter,
        resolveEmailReferenceFromPrompt: (prompt, logger) => this.deps.resolveEmailReferenceFromPrompt(prompt, logger),
        buildBaseMessages: (userPrompt, orchestration) => buildBaseMessages(userPrompt, orchestration),
        helpers: {
          isEmailSummaryPrompt,
          extractEmailUidFromPrompt,
          summarizeEmailForOperations,
          extractEmailIdentifier,
          buildEmailSummaryReply,
          extractEmailLookupRequest,
          isEmailDraftPrompt,
          isInboxTriagePrompt,
          buildEmailLookupMissReply,
          buildEmailLookupReply,
        },
      });
  }

  private createContentDirectService(): ContentDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackContentOps = {
        listItems: () => [],
        listChannels: () => [],
        listSeries: () => [],
        listFormatTemplates: () => [],
        listHookTemplates: () => [],
      };
      const fallbackSocialAssistant = {
        listNotes: () => [],
      };

      return new ContentDirectService({
        logger: baseLogger.child({ scope: "content-direct-service" }),
        contentOps: this.deps.contentOps ?? fallbackContentOps,
        socialAssistant: this.deps.socialAssistant ?? fallbackSocialAssistant,
        defaultTimezone: this.deps.config.google.defaultTimezone,
        runDailyEditorialResearch: (input) => this.deps.runDailyEditorialResearch(input),
        buildBaseMessages: (userPrompt, orchestration) => buildBaseMessages(userPrompt, orchestration),
        helpers: {
          isContentOverviewPrompt,
          isContentChannelsPrompt,
          isContentSeriesPrompt,
          isContentFormatLibraryPrompt,
          isContentHookLibraryPrompt,
          isDailyEditorialResearchPrompt,
          isCaseNotesPrompt,
          extractPromptLimit,
          extractContentPlatform,
          extractContentChannelKey,
          inferDefaultContentChannelKey,
          normalizeEmailAnalysisText,
          buildContentOverviewReply,
          buildContentChannelsReply,
          buildContentSeriesReply,
          buildContentFormatsReply,
          buildContentHooksReply,
          buildCaseNotesReply,
        },
      });
  }

  private createContentGenerationDirectService(): ContentGenerationDirectService {
      const fallbackLogger: Logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        child: () => fallbackLogger,
      };
      const baseLogger = this.deps.logger ?? fallbackLogger;
      const fallbackContentOps = {
        listItems: () => [],
        listChannels: () => [],
        listSeries: () => [],
        listFormatTemplates: () => [],
        listHookTemplates: () => [],
        getItemById: () => null,
        createItem: () => {
          throw new Error("contentOps.createItem is not configured");
        },
        updateItem: () => {
          throw new Error("contentOps.updateItem is not configured");
        },
      };
      const fallbackPexelsMedia = {
        isEnabled: () => false,
        searchVideos: async () => [],
      };

      return new ContentGenerationDirectService({
        logger: baseLogger.child({ scope: "content-generation-direct-service" }),
        client: this.deps.client,
        contentOps: this.deps.contentOps ?? fallbackContentOps,
        pexelsMedia: this.deps.pexelsMedia ?? fallbackPexelsMedia,
        pexelsMaxScenesPerRequest: this.deps.config.media.pexelsMaxScenesPerRequest,
        buildBaseMessages: (userPrompt, orchestration) => buildBaseMessages(userPrompt, orchestration),
        helpers: {
          isContentIdeaGenerationPrompt,
          isContentReviewPrompt,
          isContentScriptGenerationPrompt,
          isContentBatchPlanningPrompt,
          isContentBatchGenerationPrompt,
          isContentDistributionStrategyPrompt,
          extractContentPlatform,
          extractContentChannelKey,
          inferDefaultContentChannelKey,
          extractContentIdeaSeed,
          extractPromptLimit,
          buildFallbackEditorialIdeas,
          stripCodeFences,
          buildContentIdeaGenerationReply,
          extractContentItemId,
          extractContentQueueOrdinal,
          normalizeEmailAnalysisText,
          extractContentReviewReason,
          classifyContentReviewFeedback,
          buildContentReviewNotFoundReply,
          buildContentReviewReply,
          buildManualShortFormPackage,
          buildShortFormFallbackPackage,
          normalizeShortStyleMode,
          clampShortTargetDuration,
          normalizeScenePlan,
          validateShortFormPackage,
          resolveSceneAssets,
          buildShortProductionPack,
          buildDistributionPlan,
          buildContentScriptReply,
          hasSavedShortPackage,
          buildContentBatchReply,
          buildContentBatchGenerationReply,
          isRiquezaContentItemEligible,
          buildContentDistributionStrategyReply,
        },
      });
  }

  private getDirectServiceRegistry(): AgentDirectServiceRegistry {
    if (!this.directServiceRegistry) {
      this.directServiceRegistry = new AgentDirectServiceRegistry({
        autonomyDirectService: () => this.createAutonomyDirectService(),
        googleWorkspaceDirectService: () => this.createGoogleWorkspaceDirectService(),
        externalIntelligenceDirectService: () => this.createExternalIntelligenceDirectService(),
        capabilityActionService: () => this.createCapabilityActionService(),
        capabilityInspectionService: () => this.createCapabilityInspectionService(),
        knowledgeProjectDirectService: () => this.createKnowledgeProjectDirectService(),
        lifeManagementDirectService: () => this.createLifeManagementDirectService(),
        missionDirectService: () => this.createMissionDirectService(),
        researchKnowledgeDirectService: () => this.createResearchKnowledgeDirectService(),
        operationalContextDirectService: () => this.createOperationalContextDirectService(),
        memoryContactDirectService: () => this.createMemoryContactDirectService(),
        workflowDirectService: () => this.createWorkflowDirectService(),
        operationalReviewDirectService: () => this.createOperationalReviewDirectService(),
        workspaceMacDirectService: () => this.createWorkspaceMacDirectService(),
        emailDirectService: () => this.createEmailDirectService(),
        contentDirectService: () => this.createContentDirectService(),
        contentGenerationDirectService: () => this.createContentGenerationDirectService(),
      });
    }

    return this.directServiceRegistry;
  }

  getGoogleWorkspaceDirectService(): GoogleWorkspaceDirectService {
    return this.getDirectServiceRegistry().getGoogleWorkspaceDirectService();
  }

  getAutonomyDirectService(): AutonomyDirectService {
    return this.getDirectServiceRegistry().getAutonomyDirectService();
  }

  getExternalIntelligenceDirectService(): ExternalIntelligenceDirectService {
    return this.getDirectServiceRegistry().getExternalIntelligenceDirectService();
  }

  getCapabilityActionService(): CapabilityActionService {
    return this.getDirectServiceRegistry().getCapabilityActionService();
  }

  getCapabilityInspectionService(): CapabilityInspectionService {
    return this.getDirectServiceRegistry().getCapabilityInspectionService();
  }

  getKnowledgeProjectDirectService(): KnowledgeProjectDirectService {
    return this.getDirectServiceRegistry().getKnowledgeProjectDirectService();
  }

  getLifeManagementDirectService(): LifeManagementDirectService {
    return this.getDirectServiceRegistry().getLifeManagementDirectService();
  }

  getMissionDirectService(): MissionDirectService {
    return this.getDirectServiceRegistry().getMissionDirectService();
  }

  getResearchKnowledgeDirectService(): ResearchKnowledgeDirectService {
    return this.getDirectServiceRegistry().getResearchKnowledgeDirectService();
  }

  getOperationalContextDirectService(): OperationalContextDirectService {
    return this.getDirectServiceRegistry().getOperationalContextDirectService();
  }

  getMemoryContactDirectService(): MemoryContactDirectService {
    return this.getDirectServiceRegistry().getMemoryContactDirectService();
  }

  getWorkflowDirectService(): WorkflowDirectService {
    return this.getDirectServiceRegistry().getWorkflowDirectService();
  }

  getOperationalReviewDirectService(): OperationalReviewDirectService {
    return this.getDirectServiceRegistry().getOperationalReviewDirectService();
  }

  getWorkspaceMacDirectService(): WorkspaceMacDirectService {
    return this.getDirectServiceRegistry().getWorkspaceMacDirectService();
  }

  getEmailDirectService(): EmailDirectService {
    return this.getDirectServiceRegistry().getEmailDirectService();
  }

  getContentDirectService(): ContentDirectService {
    return this.getDirectServiceRegistry().getContentDirectService();
  }

  getContentGenerationDirectService(): ContentGenerationDirectService {
    return this.getDirectServiceRegistry().getContentGenerationDirectService();
  }
}
