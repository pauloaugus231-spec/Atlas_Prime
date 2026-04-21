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
import { MemoryContactDirectService } from "./memory-contact-direct-service.js";
import { OperationalReviewDirectService } from "./operational-review-direct-service.js";
import { OperationalContextDirectService } from "./operational-context-direct-service.js";
import { WorkspaceMacDirectService } from "./workspace-mac-direct-service.js";
import { WorkflowDirectService } from "./workflow-direct-service.js";
import { ContentDirectService } from "./content-direct-service.js";
import { ContentGenerationDirectService } from "./content-generation-direct-service.js";
import { EmailDirectService } from "./email-direct-service.js";
import { AutonomyDirectService } from "./autonomy/autonomy-direct-service.js";
import {
  AgentDirectRouteService,
  type AgentDirectRouteServiceDependencies,
} from "./agent-direct-route-service.js";
import { AgentDirectServiceComposer } from "./agent-direct-service-composer.js";
import { ActivePlanningSessionService } from "./active-planning-session-service.js";
import { ToolExecutionService } from "./tool-execution-service.js";
import { ExternalReasoningRunner } from "./external-reasoning-runner.js";
import { WorkflowSupportService } from "./workflow-support-service.js";
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
import type { AgentRunOptions, AgentRunResult } from "./agent-core.js";

export interface AgentDirectRouteHandlersDependencies {
  config: AppConfig;
  logger: Logger;
  fileAccess: FileAccessPolicy;
  pluginRegistry: ToolPluginRegistry;
  memory: OperationalMemoryStore;
  preferences: UserPreferencesStore;
  personalMemory: PersonalOperationalMemoryStore;
  growthOps: GrowthOpsStore;
  contentOps: ContentOpsStore;
  socialAssistant: SocialAssistantStore;
  workflows: WorkflowOrchestratorStore;
  email: EmailReader;
  emailWriter: EmailWriter;
  emailAccounts: EmailAccountsService;
  googleWorkspace: GoogleWorkspaceService;
  googleWorkspaces: GoogleWorkspaceAccountsService;
  projectOps: ProjectOpsService;
  safeExec: SafeExecService;
  intentRouter: IntentRouter;
  contextPacks: ContextPackService;
  responseOs: ResponseOS;
  activePlanningSession: ActivePlanningSessionService;
  messagingDirectService: MessagingDirectService;
  toolExecutionService: ToolExecutionService;
  getGoogleWorkspaceDirectService: () => GoogleWorkspaceDirectService;
  getExternalIntelligenceDirectService: () => ExternalIntelligenceDirectService;
  getCapabilityInspectionService: () => CapabilityInspectionService;
  getKnowledgeProjectDirectService: () => KnowledgeProjectDirectService;
  getOperationalContextDirectService: () => OperationalContextDirectService;
  getAutonomyDirectService: () => AutonomyDirectService;
  getMemoryContactDirectService: () => MemoryContactDirectService;
  getWorkflowDirectService: () => WorkflowDirectService;
  getOperationalReviewDirectService: () => OperationalReviewDirectService;
  getWorkspaceMacDirectService: () => WorkspaceMacDirectService;
  getEmailDirectService: () => EmailDirectService;
  getContentDirectService: () => ContentDirectService;
  getContentGenerationDirectService: () => ContentGenerationDirectService;
}

export class AgentDirectRouteHandlers {
  constructor(private readonly deps: AgentDirectRouteHandlersDependencies) {}

  buildDirectRouteServiceDependencies(): AgentDirectRouteServiceDependencies {
    return {
      conversation: {
        ping: async (input) => this.tryRunDirectPing(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        greeting: async (input) => this.tryRunDirectGreeting(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        conversationStyleCorrection: async (input) => this.tryRunDirectConversationStyleCorrection(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        agentIdentity: async (input) => this.tryRunDirectAgentIdentity(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
      },
      capability: {
        personalProfileShow: async (input) => this.tryRunDirectPersonalOperationalProfileShow(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        operationalStateShow: async (input) => this.tryRunDirectOperationalStateShow(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        learnedPreferencesList: async (input) => this.tryRunDirectLearnedPreferencesList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        learnedPreferencesDelete: async (input) => this.tryRunDirectLearnedPreferencesDelete(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        capabilityInspection: async (input) => this.tryRunDirectCapabilityInspection(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        activeGoal: async (input) => this.deps.activePlanningSession.tryRunActiveGoalTurn({
          userPrompt: input.activeUserPrompt,
          requestId: input.requestId,
          requestLogger: input.requestLogger,
          orchestration: input.orchestration,
          preferences: input.preferences,
          options: input.options,
        }),
        capabilityPlanning: async (input) => this.deps.activePlanningSession.tryRunCapabilityAwarePlanning({
          userPrompt: input.activeUserPrompt,
          requestId: input.requestId,
          requestLogger: input.requestLogger,
          orchestration: input.orchestration,
          preferences: input.preferences,
          options: input.options,
        }),
      },
      memoryAndPreference: {
        personalProfileUpdate: async (input) => this.tryRunDirectPersonalOperationalProfileUpdate(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        personalProfileDelete: async (input) => this.tryRunDirectPersonalOperationalProfileDelete(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        userPreferences: async (input) => this.tryRunDirectUserPreferences(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        activeGoalsList: async (input) => this.tryRunDirectActiveGoalsList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        activeGoalSave: async (input) => this.tryRunDirectActiveGoalSave(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        activeGoalProgressUpdate: async (input) => this.tryRunDirectActiveGoalProgressUpdate(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        activeGoalDelete: async (input) => this.tryRunDirectActiveGoalDelete(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        personalMemoryList: async (input) => this.tryRunDirectPersonalMemoryList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        personalMemorySave: async (input) => this.tryRunDirectPersonalMemorySave(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        personalMemoryUpdate: async (input) => this.tryRunDirectPersonalMemoryUpdate(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        personalMemoryDelete: async (input) => this.tryRunDirectPersonalMemoryDelete(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
      },
      operational: {
        morningBrief: async (input) => this.tryRunDirectMorningBrief(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        operationalPlanning: async (input) => this.tryRunDirectOperationalPlanning(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.intent,
          input.preferences,
        ),
        macQueueStatus: async (input) => this.tryRunDirectMacQueueStatus(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        macQueueList: async (input) => this.tryRunDirectMacQueueList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        macQueueEnqueue: async (input) => this.tryRunDirectMacQueueEnqueue(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        contactList: async (input) => this.tryRunDirectContactList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        contactUpsert: async (input) => this.tryRunDirectContactUpsert(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        memoryEntityList: async (input) => this.tryRunDirectMemoryEntityList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        memoryEntitySearch: async (input) => this.tryRunDirectMemoryEntitySearch(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        intentResolve: async (input) => this.tryRunDirectIntentResolve(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
      },
      workflow: {
        workflowList: async (input) => this.tryRunDirectWorkflowList(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        workflowShow: async (input) => this.tryRunDirectWorkflowShow(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        workflowArtifacts: async (input) => this.tryRunDirectWorkflowArtifacts(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        workflowExecution: async (input) => this.tryRunDirectWorkflowExecution(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
          input.preferences,
        ),
        workflowStepUpdate: async (input) => this.tryRunDirectWorkflowStepUpdate(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
          input.preferences,
        ),
        workflowPlanning: async (input) => this.tryRunDirectWorkflowPlanning(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
          input.preferences,
        ),
      },
      review: {
        memoryUpdateGuard: async (input) => this.tryRunDirectMemoryUpdateGuard(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        autonomyReview: async (input) => this.tryRunDirectAutonomyReview(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
          input.preferences,
        ),
        supportReview: async (input) => this.tryRunDirectSupportReview(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        followUpReview: async (input) => this.tryRunDirectFollowUpReview(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        inboxTriage: async (input) => this.tryRunDirectInboxTriage(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        operationalBrief: async (input) => this.tryRunDirectOperationalBrief(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        nextCommitmentPrep: async (input) => this.tryRunDirectNextCommitmentPrep(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
      },
      googleWorkspace: {
        calendarLookup: async (input) => this.tryRunDirectCalendarLookup(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        calendarConflictReview: async (input) => this.tryRunDirectCalendarConflictReview(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        calendarPeriodList: async (input) => this.tryRunDirectCalendarPeriodList(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleTaskDraft: async (input) => this.tryRunDirectGoogleTaskDraft(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleEventDraft: async (input) => this.tryRunDirectGoogleEventDraft(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleEventMove: async (input) => this.tryRunDirectGoogleEventMove(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleEventDelete: async (input) => this.tryRunDirectGoogleEventDelete(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleTasks: async (input) => this.tryRunDirectGoogleTasks(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleContacts: async (input) => this.tryRunDirectGoogleContacts(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        googleCalendarsList: async (input) => this.tryRunDirectGoogleCalendarsList(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        placeLookup: async (input) => this.tryRunDirectPlaceLookup(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
      },
      messaging: {
        whatsappSend: async (input) => this.deps.messagingDirectService.tryRunWhatsAppSend({
          activeUserPrompt: input.activeUserPrompt,
          fullPrompt: input.userPrompt,
          requestId: input.requestId,
          orchestration: input.orchestration,
        }),
        whatsappRecentSearch: async (input) => this.deps.messagingDirectService.tryRunWhatsAppRecentSearch({
          activeUserPrompt: input.activeUserPrompt,
          fullPrompt: input.userPrompt,
          requestId: input.requestId,
          orchestration: input.orchestration,
        }),
        whatsappPendingApprovals: async (input) => this.deps.messagingDirectService.tryRunWhatsAppPendingApprovals({
          activeUserPrompt: input.activeUserPrompt,
          requestId: input.requestId,
          orchestration: input.orchestration,
        }),
      },
      knowledgeAndProject: {
        weather: async (input) => this.tryRunDirectWeather(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        internalKnowledgeLookup: async (input) => this.tryRunDirectInternalKnowledgeLookup(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        webResearch: async (input) => this.tryRunDirectWebResearch(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        revenueScoreboard: async (input) => this.tryRunDirectRevenueScoreboard(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        allowedSpaces: async (input) => this.tryRunDirectAllowedSpaces(
          input.activeUserPrompt,
          input.requestId,
          input.orchestration,
        ),
        projectScan: async (input) => this.tryRunDirectProjectScan(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        projectMirror: async (input) => this.tryRunDirectProjectMirror(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        safeExec: async (input) => this.tryRunDirectSafeExec(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
      },
      content: {
        dailyEditorialResearch: async (input) => this.tryRunDirectDailyEditorialResearch(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentIdeaGeneration: async (input) => this.tryRunDirectContentIdeaGeneration(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentReview: async (input) => this.tryRunDirectContentReview(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentScriptGeneration: async (input) => this.tryRunDirectContentScriptGeneration(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentBatchPlanning: async (input) => this.tryRunDirectContentBatchPlanning(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentBatchGeneration: async (input) => this.tryRunDirectContentBatchGeneration(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentDistributionStrategy: async (input) => this.tryRunDirectContentDistributionStrategy(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentChannels: async (input) => this.tryRunDirectContentChannels(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentSeries: async (input) => this.tryRunDirectContentSeries(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentFormatLibrary: async (input) => this.tryRunDirectContentFormatLibrary(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentHookLibrary: async (input) => this.tryRunDirectContentHookLibrary(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        contentOverview: async (input) => this.tryRunDirectContentOverview(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        caseNotes: async (input) => this.tryRunDirectCaseNotes(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
      },
      email: {
        emailDraft: async (input) => this.tryRunDirectEmailDraft(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        emailSummary: async (input) => this.tryRunDirectEmailSummary(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
        emailLookup: async (input) => this.tryRunDirectEmailLookup(
          input.activeUserPrompt,
          input.requestId,
          input.requestLogger,
          input.orchestration,
        ),
      },
    };
  }

  async tryRunDirectAgentIdentity(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isAgentIdentityPrompt(userPrompt)) {
      return null;
    }

    return {
      requestId,
      reply: buildAgentIdentityReply(this.deps.preferences.get().preferredAgentName),
      messages: buildBaseMessages(userPrompt, orchestration, this.deps.preferences.get()),
      toolExecutions: [],
    };
  }

  async tryRunDirectGreeting(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGreetingPrompt(userPrompt)) {
      return null;
    }

    const profile = this.deps.personalMemory.getProfile();
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, profile);
    return {
      requestId,
      reply: buildGreetingReply(userPrompt, {
        profile,
        operationalMode,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, this.deps.preferences.get()),
      toolExecutions: [],
    };
  }

  async tryRunDirectConversationStyleCorrection(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    const currentProfile = this.deps.personalMemory.getProfile();
    const correction = extractConversationStyleCorrection(userPrompt, currentProfile);
    if (!correction) {
      return null;
    }

    await this.deps.toolExecutionService.executeToolDirect("update_personal_operational_profile", {
      ...(correction.profileUpdate.responseStyle ? { responseStyle: correction.profileUpdate.responseStyle } : {}),
      ...(correction.profileUpdate.briefingPreference ? { briefingPreference: correction.profileUpdate.briefingPreference } : {}),
      ...(correction.profileUpdate.detailLevel ? { detailLevel: correction.profileUpdate.detailLevel } : {}),
      ...(correction.profileUpdate.tonePreference ? { tonePreference: correction.profileUpdate.tonePreference } : {}),
      ...(correction.profileUpdate.autonomyPreferences ? { autonomyPreferences: correction.profileUpdate.autonomyPreferences } : {}),
    });
    this.deps.preferences.update(correction.preferenceUpdate);

    try {
      await this.deps.toolExecutionService.executeToolDirect("save_learned_preference", {
        ...correction.learnedPreference,
        observe: true,
      });
    } catch (error) {
      this.deps.logger.warn("Failed to save learned conversation style preference", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      requestId,
      reply: correction.reply,
      messages: buildBaseMessages(userPrompt, orchestration, {
        ...preferences,
        ...correction.preferenceUpdate,
      }),
      toolExecutions: [
        {
          toolName: "update_personal_operational_profile",
          resultPreview: correction.reply,
        },
        {
          toolName: "save_learned_preference",
          resultPreview: correction.learnedPreference.value,
        },
      ],
    };
  }

  async tryRunDirectMemoryUpdateGuard(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isMemoryUpdatePrompt(userPrompt)) {
      return null;
    }

    const id = extractMemoryItemId(userPrompt);
    if (!id) {
      return {
        requestId,
        reply: "Diga qual item da memória devo atualizar, por exemplo: `Atualize o item 3 para status done.`",
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    if (!hasMemoryUpdateFields(userPrompt)) {
      return {
        requestId,
        reply: [
          `Encontrei a referência ao item ${id}, mas faltou dizer o que devo alterar.`,
          "Exemplos:",
          `- Atualize o item ${id} para status done.`,
          `- Atualize o item ${id} com prioridade high.`,
          `- Atualize o item ${id} com o título X e detalhes Y.`,
        ].join("\n"),
        messages: buildBaseMessages(userPrompt, orchestration),
        toolExecutions: [],
      };
    }

    return null;
  }

  async tryRunDirectEmailSummary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getEmailDirectService().tryRunEmailSummary({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectEmailLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getEmailDirectService().tryRunEmailLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectOperationalBrief(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunOperationalBrief({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectMorningBrief(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunMorningBrief({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectMacQueueStatus(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkspaceMacDirectService().tryRunMacQueueStatus({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  async tryRunDirectMacQueueList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkspaceMacDirectService().tryRunMacQueueList({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  async tryRunDirectMacQueueEnqueue(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkspaceMacDirectService().tryRunMacQueueEnqueue({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  async tryRunDirectGoogleTasks(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleTasks({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectCalendarLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunCalendarLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectGoogleTaskDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleTaskDraft({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectCalendarConflictReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunCalendarConflictReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectGoogleEventDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleEventDraft({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectCalendarPeriodList(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunCalendarPeriodList({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectGoogleEventMove(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleEventMove({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectGoogleEventDelete(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleEventDelete({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectGoogleContacts(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleContacts({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectGoogleCalendarsList(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunGoogleCalendarsList({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectPlaceLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getGoogleWorkspaceDirectService().tryRunPlaceLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectInternalKnowledgeLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getKnowledgeProjectDirectService().tryRunInternalKnowledgeLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectWebResearch(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getExternalIntelligenceDirectService().tryRunWebResearch({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectAutonomyReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getAutonomyDirectService().tryRunAutonomyReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectWeather(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isWeatherPrompt(userPrompt)) {
      return null;
    }

    const location = extractWeatherLocation(userPrompt) ?? this.deps.config.briefing.weatherLocation;

    requestLogger.info("Using direct weather route", {
      location,
    });

    const service = new WeatherService(requestLogger.child({ scope: "weather" }));
    const forecast = await service.getForecast({
      location,
      days: 3,
      timezone: this.deps.config.google.defaultTimezone,
    });

    const reply = forecast
      ? buildWeatherReply(forecast)
      : `Não encontrei previsão do tempo confiável para: ${location}.`;

    return {
      requestId,
      reply,
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "get_weather_forecast",
          resultPreview: JSON.stringify(
            {
              location,
              found: Boolean(forecast),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunDirectRevenueScoreboard(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isRevenueScoreboardPrompt(userPrompt)) {
      return null;
    }

    const referenceMonth = extractReferenceMonth(userPrompt);
    requestLogger.info("Using direct revenue scoreboard route", {
      referenceMonth,
    });
    const scoreboard = this.deps.growthOps.getMonthlyScoreboard(referenceMonth);

    return {
      requestId,
      reply: buildRevenueScoreboardReply({
        referenceMonth: scoreboard.referenceMonth,
        totalProjected: scoreboard.totalProjected,
        totalWon: scoreboard.totalWon,
        totalReceived: scoreboard.totalReceived,
        recurringProjected: scoreboard.recurringProjected,
        recurringReceived: scoreboard.recurringReceived,
        oneOffReceived: scoreboard.oneOffReceived,
        pipelineOpenValue: scoreboard.pipelineOpenValue,
        leadsByStatus: scoreboard.leadsByStatus,
        upcomingFollowUps: scoreboard.upcomingFollowUps.map((lead) => ({
          name: lead.name,
          company: lead.company,
          status: lead.status,
          nextFollowUpAt: lead.nextFollowUpAt,
        })),
      }),
      messages: buildBaseMessages(userPrompt, orchestration),
      toolExecutions: [
        {
          toolName: "monthly_revenue_scoreboard",
          resultPreview: JSON.stringify(
            {
              referenceMonth: scoreboard.referenceMonth,
              totalProjected: scoreboard.totalProjected,
              totalReceived: scoreboard.totalReceived,
              pipelineOpenValue: scoreboard.pipelineOpenValue,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunDirectAllowedSpaces(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkspaceMacDirectService().tryRunAllowedSpaces({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  async tryRunDirectProjectScan(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getKnowledgeProjectDirectService().tryRunProjectScan({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectProjectMirror(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getKnowledgeProjectDirectService().tryRunProjectMirror({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentOverview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunContentOverview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentChannels(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunContentChannels({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentIdeaGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentGenerationDirectService().tryRunContentIdeaGeneration({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectDailyEditorialResearch(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunDailyEditorialResearch({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentGenerationDirectService().tryRunContentReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentScriptGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentGenerationDirectService().tryRunContentScriptGeneration({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentBatchPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentGenerationDirectService().tryRunContentBatchPlanning({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentBatchGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentGenerationDirectService().tryRunContentBatchGeneration({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentDistributionStrategy(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentGenerationDirectService().tryRunContentDistributionStrategy({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentSeries(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunContentSeries({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentFormatLibrary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunContentFormatLibrary({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectContentHookLibrary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunContentHookLibrary({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectSafeExec(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkspaceMacDirectService().tryRunSafeExec({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectCaseNotes(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getContentDirectService().tryRunCaseNotes({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectUserPreferences(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isUserPreferencesPrompt(userPrompt)) {
      return null;
    }

    const update = extractPreferenceUpdate(userPrompt);
    const preferences = update ? this.deps.preferences.update(update) : this.deps.preferences.get();

    const reply = update
      ? [
          "Preferências atualizadas.",
          buildUserPreferencesReply(preferences),
        ].join("\n")
      : buildUserPreferencesReply(preferences);

    return {
      requestId,
      reply,
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  async tryRunDirectPersonalOperationalProfileShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunProfileShow({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectOperationalStateShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunOperationalStateShow({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectLearnedPreferencesList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunLearnedPreferencesList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectLearnedPreferencesDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunLearnedPreferencesDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectCapabilityInspection(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getCapabilityInspectionService().tryRunInspection({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectPersonalOperationalProfileUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunProfileUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectActiveGoalsList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunGoalList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectActiveGoalSave(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunGoalSave({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectActiveGoalProgressUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunGoalProgressUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectActiveGoalDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunGoalDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectPersonalOperationalProfileDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunProfileDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectPersonalMemoryList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunPersonalMemoryList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectPersonalMemorySave(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunPersonalMemorySave({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectPersonalMemoryUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunPersonalMemoryUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectPersonalMemoryDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalContextDirectService().tryRunPersonalMemoryDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectWorkflowPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkflowDirectService().tryRunWorkflowPlanning({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectContactList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getMemoryContactDirectService().tryRunContactList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectContactUpsert(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getMemoryContactDirectService().tryRunContactUpsert({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectMemoryEntityList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getMemoryContactDirectService().tryRunMemoryEntityList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectMemoryEntitySearch(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getMemoryContactDirectService().tryRunMemoryEntitySearch({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectIntentResolve(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isIntentResolvePrompt(userPrompt)) {
      return null;
    }

    const subject = extractIntentResolveSubject(userPrompt);
    const resolution = this.deps.intentRouter.resolve(subject);
    const contextPack = await this.deps.contextPacks.buildForPrompt(subject, resolution);
    return {
      requestId,
      reply: this.deps.responseOs.buildIntentAnalysisReply({
        objective: inferIntentObjective(subject, resolution),
        primaryDomain: resolution.orchestration.route.primaryDomain,
        mentionedDomains: resolution.mentionedDomains,
        actionMode: resolution.orchestration.route.actionMode,
        confidence: resolution.orchestration.route.confidence,
        compound: resolution.compoundIntent,
        contextSignals: contextPack?.signals ?? [],
        reasons: resolution.orchestration.route.reasons,
        recommendedNextStep: inferIntentNextStep(resolution),
      }),
      messages: buildBaseMessages(userPrompt, orchestration, preferences),
      toolExecutions: [],
    };
  }

  async tryRunDirectOperationalPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    intent: IntentResolution,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isOperationalPlanningPrompt(userPrompt)) {
      return null;
    }

    requestLogger.info("Using direct operational planning route", {
      primaryDomain: intent.orchestration.route.primaryDomain,
      actionMode: intent.orchestration.route.actionMode,
    });

    const contextPack = await this.deps.contextPacks.buildForPrompt(userPrompt, intent);
    const brief = contextPack?.brief;
    if (!brief) {
      return null;
    }

    return {
      requestId,
      reply: this.deps.responseOs.buildOrganizationReply(
        buildOperationalPlanContract(userPrompt, brief, this.deps.personalMemory.getProfile()),
      ),
      messages: buildBaseMessages(userPrompt, intent.orchestration, preferences),
      toolExecutions: [
        {
          toolName: "context_pack_operational_overview",
          resultPreview: JSON.stringify(
            {
              events: brief.events.length,
              approvals: brief.approvals.length,
              tasks: brief.taskBuckets.actionableCount,
              emails: brief.emails.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunDirectWorkflowList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkflowDirectService().tryRunWorkflowList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectWorkflowShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkflowDirectService().tryRunWorkflowShow({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectWorkflowArtifacts(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkflowDirectService().tryRunWorkflowArtifacts({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectWorkflowExecution(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkflowDirectService().tryRunWorkflowExecution({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectWorkflowStepUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.deps.getWorkflowDirectService().tryRunWorkflowStepUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  async tryRunDirectSupportReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalReviewDirectService().tryRunSupportReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectInboxTriage(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalReviewDirectService().tryRunInboxTriage({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectFollowUpReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalReviewDirectService().tryRunFollowUpReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectNextCommitmentPrep(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalReviewDirectService().tryRunNextCommitmentPrep({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectEmailDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.deps.getOperationalReviewDirectService().tryRunEmailDraft({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  async tryRunDirectPing(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    const normalizedPrompt = userPrompt.toLowerCase();
    const requestsPingTool =
      normalizedPrompt.includes("ferramenta ping") ||
      normalizedPrompt.includes("use ping") ||
      normalizedPrompt.trim().endsWith("ping");

    if (!requestsPingTool || !this.deps.pluginRegistry.hasTool("ping")) {
      return null;
    }

    requestLogger.info("Using direct tool route", {
      tool: "ping",
    });

    const execution = await this.deps.pluginRegistry.execute("ping", {}, {
      requestId,
      toolCallId: randomUUID(),
      config: this.deps.config,
      logger: requestLogger.child({ tool: "ping", toolCallId: "direct" }),
      fileAccess: this.deps.fileAccess,
      memory: this.deps.memory,
      preferences: this.deps.preferences,
      personalMemory: this.deps.personalMemory,
      growthOps: this.deps.growthOps,
      contentOps: this.deps.contentOps,
      socialAssistant: this.deps.socialAssistant,
      workflows: this.deps.workflows,
      email: this.deps.email,
      emailWriter: this.deps.emailWriter,
      emailAccounts: this.deps.emailAccounts,
      googleWorkspace: this.deps.googleWorkspace,
      googleWorkspaces: this.deps.googleWorkspaces,
      projectOps: this.deps.projectOps,
      safeExec: this.deps.safeExec,
      orchestration,
    });

    const rawResult =
      execution.rawResult && typeof execution.rawResult === "object"
        ? (execution.rawResult as Record<string, unknown>)
        : undefined;
    const pongValue =
      rawResult && typeof rawResult.pong === "string" ? rawResult.pong : "pong";
    const timestampValue =
      rawResult && typeof rawResult.timestamp === "string" ? rawResult.timestamp : undefined;

    return {
      requestId,
      reply: timestampValue
        ? `Resultado do ping: ${pongValue}\nTimestamp: ${timestampValue}`
        : `Resultado do ping: ${pongValue}`,
      messages: [
        ...buildBaseMessages(userPrompt, orchestration),
        {
          role: "tool",
          tool_name: "ping",
          content: execution.content,
        },
      ],
      toolExecutions: [
        {
          toolName: "ping",
          resultPreview: execution.content.slice(0, 240),
        },
      ],
    };
  }
}
