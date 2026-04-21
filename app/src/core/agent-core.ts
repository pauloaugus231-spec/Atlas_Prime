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
import {
  AgentDirectRouteService,
  type AgentDirectRouteServiceDependencies,
} from "./agent-direct-route-service.js";
import { AgentDirectServiceRegistry } from "./agent-direct-service-registry.js";
import { AgentDirectServiceComposer } from "./agent-direct-service-composer.js";
import { ActivePlanningSessionService } from "./active-planning-session-service.js";
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

export class AgentCore {
  private readonly capabilityPlanner: CapabilityPlanner;
  private readonly contextAssembler: ContextAssembler;
  private readonly responseSynthesizer: ResponseSynthesizer;
  private readonly turnPlanner: TurnPlanner;
  private readonly directRouteService: AgentDirectRouteService;
  private readonly messagingDirectService: MessagingDirectService;
  private readonly directServiceComposer: AgentDirectServiceComposer;
  private readonly activePlanningSession: ActivePlanningSessionService;
  private readonly createWebResearchService: (logger: Logger) => Pick<WebResearchService, "search" | "fetchPageExcerpt">;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly fileAccess: FileAccessPolicy,
    private readonly client: LlmClient,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly pluginRegistry: ToolPluginRegistry,
    private readonly memory: OperationalMemoryStore,
    private readonly goalStore: GoalStore,
    private readonly preferences: UserPreferencesStore,
    private readonly personalMemory: PersonalOperationalMemoryStore,
    private readonly growthOps: GrowthOpsStore,
    private readonly contentOps: ContentOpsStore,
    private readonly socialAssistant: SocialAssistantStore,
    private readonly contacts: ContactIntelligenceStore,
    private readonly communicationRouter: CommunicationRouter,
    private readonly approvals: ApprovalInboxStore,
    private readonly memoryEntities: MemoryEntityStore,
    private readonly whatsappMessages: WhatsAppMessageStore,
    private readonly workflows: WorkflowOrchestratorStore,
    private readonly workflowRuntime: WorkflowExecutionRuntime,
    private readonly entityLinker: EntityLinker,
    private readonly macCommandQueue: SupabaseMacCommandQueue,
    private readonly email: EmailReader,
    private readonly emailWriter: EmailWriter,
    private readonly emailAccounts: EmailAccountsService,
    private readonly googleWorkspace: GoogleWorkspaceService,
    private readonly googleWorkspaces: GoogleWorkspaceAccountsService,
    private readonly googleMaps: GoogleMapsService,
    private readonly personalOs: PersonalOSService,
    private readonly intentRouter: IntentRouter,
    private readonly responseOs: ResponseOS,
    private readonly contextPacks: ContextPackService,
    private readonly planBuilder: WorkflowPlanBuilderService,
    private readonly externalReasoning: ExternalReasoningClient,
    private readonly pexelsMedia: PexelsMediaService,
    private readonly projectOps: ProjectOpsService,
    private readonly safeExec: SafeExecService,
    private readonly reasoningEngine?: ReasoningEngine,
    private readonly userModelTracker?: UserModelTracker,
  ) {
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
        executeTool: async (input) => this.executeSynthesizedTool(input),
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
      createWebResearchService: this.createWebResearchService,
      executeToolDirect: (toolName, rawArguments) => this.executeToolDirect(toolName, rawArguments),
      buildActiveGoalUserDataReply: (goal, plan) => this.activePlanningSession.buildActiveGoalUserDataReply(goal, plan),
      resolveEmailReferenceFromPrompt: (prompt, logger) => this.resolveEmailReferenceFromPrompt(prompt, logger),
      runDailyEditorialResearch: (input) => this.runDailyEditorialResearch(input),
      buildWorkflowExecutionBrief: (plan, step, requestLogger) => this.buildWorkflowExecutionBrief(plan, step, requestLogger),
      saveWorkflowExecutionArtifact: (plan, step, brief) => this.saveWorkflowExecutionArtifact(plan, step, brief),
      generateWorkflowDomainDeliverable: (plan, step, brief, requestLogger) =>
        this.generateWorkflowDomainDeliverable(plan, step, brief, requestLogger),
    });
    this.directRouteService = new AgentDirectRouteService(
      new DirectRouteRunner(
        this.logger.child({ scope: "direct-route-runner" }),
      ),
      this.buildDirectRouteServiceDependencies(),
      async (fallbackInput) => this.tryRunExternalReasoning(
        fallbackInput.activeUserPrompt,
        fallbackInput.requestId,
        fallbackInput.requestLogger,
        fallbackInput.intent,
        fallbackInput.preferences,
        fallbackInput.options,
        "post_direct_routes",
      ),
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

  private getGoogleWorkspaceDirectService(): GoogleWorkspaceDirectService {
    return this.directServiceComposer.getGoogleWorkspaceDirectService();
  }

  private getExternalIntelligenceDirectService(): ExternalIntelligenceDirectService {
    return this.directServiceComposer.getExternalIntelligenceDirectService();
  }

  private getCapabilityActionService(): CapabilityActionService {
    return this.directServiceComposer.getCapabilityActionService();
  }

  private getCapabilityInspectionService(): CapabilityInspectionService {
    return this.directServiceComposer.getCapabilityInspectionService();
  }

  private getKnowledgeProjectDirectService(): KnowledgeProjectDirectService {
    return this.directServiceComposer.getKnowledgeProjectDirectService();
  }

  private getOperationalContextDirectService(): OperationalContextDirectService {
    return this.directServiceComposer.getOperationalContextDirectService();
  }

  private getMemoryContactDirectService(): MemoryContactDirectService {
    return this.directServiceComposer.getMemoryContactDirectService();
  }

  private getWorkflowDirectService(): WorkflowDirectService {
    return this.directServiceComposer.getWorkflowDirectService();
  }

  private getOperationalReviewDirectService(): OperationalReviewDirectService {
    return this.directServiceComposer.getOperationalReviewDirectService();
  }

  private getWorkspaceMacDirectService(): WorkspaceMacDirectService {
    return this.directServiceComposer.getWorkspaceMacDirectService();
  }

  private getEmailDirectService(): EmailDirectService {
    return this.directServiceComposer.getEmailDirectService();
  }

  private getContentDirectService(): ContentDirectService {
    return this.directServiceComposer.getContentDirectService();
  }

  private getContentGenerationDirectService(): ContentGenerationDirectService {
    return this.directServiceComposer.getContentGenerationDirectService();
  }

  private async tryRunPreLocalExternalReasoning(
    input: {
      activeUserPrompt: string;
      requestId: string;
      requestLogger: Logger;
      intent: IntentResolution;
      preferences: UserPreferences;
      options?: AgentRunOptions;
    },
  ): Promise<AgentRunResult | null> {
    const shouldBypassPreLocalExternalReasoning = shouldBypassPreLocalExternalReasoningForPrompt(
      input.activeUserPrompt,
      input.intent,
    );
    if (shouldBypassPreLocalExternalReasoning) {
      input.requestLogger.info("Skipping external reasoning for direct local context command", {
        mode: this.config.externalReasoning.mode,
      });
      return null;
    }

    return this.tryRunExternalReasoning(
      input.activeUserPrompt,
      input.requestId,
      input.requestLogger,
      input.intent,
      input.preferences,
      input.options,
      "pre_local",
    );
  }

  private buildDirectRouteServiceDependencies(): AgentDirectRouteServiceDependencies {
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
        activeGoal: async (input) => this.activePlanningSession.tryRunActiveGoalTurn({
          userPrompt: input.activeUserPrompt,
          requestId: input.requestId,
          requestLogger: input.requestLogger,
          orchestration: input.orchestration,
          preferences: input.preferences,
          options: input.options,
        }),
        capabilityPlanning: async (input) => this.activePlanningSession.tryRunCapabilityAwarePlanning({
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
        whatsappSend: async (input) => this.messagingDirectService.tryRunWhatsAppSend({
          activeUserPrompt: input.activeUserPrompt,
          fullPrompt: input.userPrompt,
          requestId: input.requestId,
          orchestration: input.orchestration,
        }),
        whatsappRecentSearch: async (input) => this.messagingDirectService.tryRunWhatsAppRecentSearch({
          activeUserPrompt: input.activeUserPrompt,
          fullPrompt: input.userPrompt,
          requestId: input.requestId,
          orchestration: input.orchestration,
        }),
        whatsappPendingApprovals: async (input) => this.messagingDirectService.tryRunWhatsAppPendingApprovals({
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

  async runDailyEditorialResearch(input?: {
    channelKey?: string;
    timezone?: string;
    trendsLimit?: number;
    ideasLimit?: number;
    now?: Date;
  }): Promise<{
    reply: string;
    runDate: string;
    createdItemIds: number[];
    skipped: boolean;
  }> {
    const timezone = input?.timezone?.trim() || this.config.google.defaultTimezone;
    const now = input?.now ?? new Date();
    const runDate = formatDateForTimezone(now, timezone);
    const runType = "daily_research_brief";
    const channelKey = input?.channelKey ?? "riqueza_despertada_youtube";
    const existing = this.contentOps.getLatestResearchRun(channelKey, runType, runDate);
    if (existing?.status === "success") {
      return {
        reply: existing.summary ?? `Research Kernel já executado para ${channelKey} em ${runDate}.`,
        runDate,
        createdItemIds: [],
        skipped: true,
      };
    }

    const channel = this.contentOps.listChannels({ limit: 20 }).find((item) => item.key === channelKey);
    if (!channel) {
      const summary = `Nao encontrei o canal editorial ${channelKey} para rodar o Research Kernel.`;
      this.contentOps.createResearchRun({
        channelKey,
        runType,
        runDate,
        status: "failed",
        summary,
      });
      return {
        reply: summary,
        runDate,
        createdItemIds: [],
        skipped: false,
      };
    }

    const trendService = new GoogleTrendsIntakeService(this.logger.child({ scope: "google-trends" }));
    const researchService = new WebResearchService(this.logger.child({ scope: "web-research" }));
    const trends = await trendService.fetchBrazilDailyTrends(input?.trendsLimit ?? 10);
    const formats = this.contentOps.listFormatTemplates({ activeOnly: true, limit: 20 });
    const hooks = this.contentOps.listHookTemplates({ limit: 20 });
    const series = this.contentOps.listSeries({ channelKey: channel.key, limit: 20 });
    const ideasLimit = 6;

    const shortlistFallback: Array<{
      title: string;
      approxTraffic?: string;
      fitScore: number;
      angle: string;
      useTrend: boolean;
    }> = trends.slice(0, 3).map((trend, index) => ({
      title: trend.title,
      approxTraffic: trend.approxTraffic,
      fitScore: Math.max(55 - index * 7, 20),
      angle: "Se não houver aderência forte ao canal, usar como contraste e cair para pauta evergreen.",
      useTrend: false,
    }));

    let selectedTrends = shortlistFallback;
    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o editor-chefe do canal Riqueza Despertada.",
              "Analise trends do Brasil e selecione no máximo 3 com melhor aderência ao canal.",
              "O canal fala apenas de finanças, negócios, renda, vendas, SaaS, produtos e execução para ganhar dinheiro.",
              "Rejeite esporte, celebridade, entretenimento e notícia geral sem impacto financeiro prático para o público.",
              "Só marque useTrend=true se o tema puder virar conteúdo útil para ganhar, vender, economizar ou decidir melhor financeiramente.",
              "Se o fitScore for menor que 60, useTrend deve ser false.",
              "Se nenhum trend servir, marque useTrend=false e proponha fallback evergreen.",
              "Responda somente JSON válido no formato {\"selectedTrends\":[...]}",
              "Cada item: title, fitScore, angle, useTrend.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              "",
              "Trends BR do momento:",
              ...trends.slice(0, 8).map((trend) =>
                `- ${trend.title}${trend.approxTraffic ? ` | tráfego: ${trend.approxTraffic}` : ""}${trend.newsItems[0]?.title ? ` | notícia: ${trend.newsItems[0].title}` : ""}`,
              ),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as {
        selectedTrends?: Array<{ title?: string; fitScore?: number; angle?: string; useTrend?: boolean }>;
      };
      if (Array.isArray(parsed.selectedTrends) && parsed.selectedTrends.length > 0) {
        selectedTrends = parsed.selectedTrends
          .filter((item) => item && typeof item.title === "string" && item.title.trim())
          .map((item) => {
            const original = trends.find((trend) => normalizeEmailAnalysisText(trend.title) === normalizeEmailAnalysisText(item.title ?? ""));
            return {
              title: item.title!.trim(),
              fitScore: typeof item.fitScore === "number" ? Math.max(0, Math.min(100, Math.round(item.fitScore))) : 50,
              angle:
                typeof item.angle === "string" && item.angle.trim().length > 0
                  ? item.angle.trim()
                  : "Trend com potencial, mas precisa de recorte editorial mais forte.",
              useTrend: item.useTrend !== false,
              approxTraffic: original?.approxTraffic,
            };
          })
          .slice(0, 3);
      }
    } catch (error) {
      this.logger.warn("Trend shortlist fell back to deterministic ranking", {
        channelKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    selectedTrends = filterSelectedTrendsForChannel({
      channelKey: channel.key,
      selectedTrends,
      rawTrends: trends,
    });

    const usableTrends = selectedTrends.filter((item) => item.useTrend);
    const fallbackMode = usableTrends.length === 0;

    const enrichedTrendContext: Array<{
      trend: GoogleTrendItem;
      angle?: string;
      fitScore?: number;
      research: Array<{ title: string; url: string; snippet: string; sourceHost: string }>;
    }> = [];
    for (const item of usableTrends.slice(0, 3)) {
      const trend = trends.find((entry) => normalizeEmailAnalysisText(entry.title) === normalizeEmailAnalysisText(item.title));
      if (!trend) {
        continue;
      }
      let research = [] as Array<{ title: string; url: string; snippet: string; sourceHost: string }>;
      try {
        research = (await researchService.search({
          query: trend.title,
          maxResults: 3,
          includePageExcerpt: false,
          mode: "executive",
        })).map((entry) => ({
          title: entry.title,
          url: entry.url,
          snippet: entry.snippet,
          sourceHost: entry.sourceHost,
        }));
      } catch (error) {
        this.logger.warn("Trend enrichment failed", {
          trend: trend.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      enrichedTrendContext.push({
        trend,
        angle: item.angle,
        fitScore: item.fitScore,
        research,
      });
    }

    type GeneratedIdea = {
      slotKey?: EditorialSlotKey;
      title: string;
      hook?: string;
      pillar?: string;
      audience?: string;
      formatTemplateKey?: string;
      seriesKey?: string | null;
      notes?: string;
    };

    const slotFallbacks = buildDailyEditorialSlotFallbackIdeas({
      fallbackMode,
      usableTrendTitle: usableTrends[0]?.title,
    });
    let generatedIdeas: GeneratedIdea[] = slotFallbacks.flatMap((slot) =>
      buildFallbackEditorialIdeas({
        channelName: channel.name,
        seed: slot.seed,
        formatKeys: formats.map((item) => item.key),
        seriesKeys: series.map((item) => item.key),
        limit: 2,
      }).map((idea) => ({
        ...idea,
        slotKey: slot.slotKey,
        audience: channel.persona ?? idea.audience,
        notes: [`[slot:${slot.slotKey}]`, idea.notes, fallbackMode ? "fallback evergreen por baixa aderência do trend." : ""]
          .filter(Boolean)
          .join(" | "),
      })),
    ).slice(0, ideasLimit);

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você gera pautas para short-form content do canal Riqueza Despertada.",
              "Cada pauta deve ajudar o espectador a ganhar dinheiro, vender melhor, economizar ou tomar decisão financeira mais inteligente.",
              "Não use futebol, celebridade, entretenimento ou curiosidade sem mecanismo claro de receita, caixa, venda, negócio ou patrimônio.",
              "Responda somente JSON válido.",
              "Formato: {\"ideas\":[...]}",
              "Cada item: slotKey, title, hook, pillar, audience, formatTemplateKey, seriesKey, notes.",
              "Gere exatamente 6 ideias: 2 para morning_finance, 2 para lunch_income, 2 para night_trends.",
              "morning_finance = notícia financeira ou de negócios com impacto prático no bolso ou no mercado.",
              "lunch_income = meios reais de renda extra, serviços, micro-ofertas, execução simples e aplicável.",
              "night_trends = trend do dia adaptado para dinheiro, negócio, renda ou execução. Se não houver trend útil, use evergreen com cara de trend.",
              "Se os trends não servirem, crie pautas evergreen fortes para riqueza, renda, SaaS e execução.",
              "Não gere placeholders nem títulos genéricos.",
              "Use apenas formatTemplateKey e seriesKey que existirem no contexto.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Canal: ${channel.name}`,
              `Plataforma: ${channel.platform}`,
              `Nicho: ${channel.niche ?? ""}`,
              `Persona: ${channel.persona ?? ""}`,
              `Objetivo: ${channel.primaryGoal ?? ""}`,
              `Modo: ${fallbackMode ? "evergreen fallback" : "trend-first"}`,
              `Quantidade: 6`,
              "",
              "Slots obrigatórios:",
              "- morning_finance => publicação das 07:00",
              "- lunch_income => publicação das 12:00",
              "- night_trends => publicação das 20:00",
              "",
              "Formatos disponíveis:",
              ...formats.map((item) => `- ${item.key}: ${item.label} | ${item.structure}`),
              "",
              "Séries disponíveis:",
              ...(series.length > 0
                ? series.map((item) => `- ${item.key}: ${item.title} | ${item.premise ?? ""}`)
                : ["- nenhuma série específica"]),
              "",
              "Hooks de referência:",
              ...hooks.slice(0, 8).map((item) => `- ${item.label}: ${item.template}`),
              "",
              "Contexto de trends:",
              ...(enrichedTrendContext.length > 0
                ? enrichedTrendContext.flatMap((item) => [
                    `- Trend: ${item.trend.title}${item.trend.approxTraffic ? ` | tráfego: ${item.trend.approxTraffic}` : ""}${item.angle ? ` | ângulo: ${item.angle}` : ""}`,
                    ...item.research.map((entry) => `  - Fonte: ${entry.title} | ${entry.sourceHost} | ${truncateBriefText(entry.snippet, 96)}`),
                  ])
                : ["- Nenhum trend com aderência suficiente; use temas evergreen do canal."]),
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as { ideas?: GeneratedIdea[] } | GeneratedIdea[];
      const rawIdeas = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.ideas)
          ? parsed.ideas
          : [];
      if (rawIdeas.length > 0) {
        generatedIdeas = rawIdeas
          .filter((item) => item && typeof item.title === "string" && item.title.trim().length > 0)
          .slice(0, 6)
          .map((item) => ({
            slotKey: normalizeEditorialSlotKey(item.slotKey, "morning_finance"),
            title: item.title.trim(),
            hook: typeof item.hook === "string" ? item.hook.trim() : undefined,
            pillar: typeof item.pillar === "string" ? item.pillar.trim() : undefined,
            audience: item.audience ?? channel.persona ?? "público buscando riqueza e renda",
            formatTemplateKey: item.formatTemplateKey,
            seriesKey: item.seriesKey,
            notes: [`[slot:${normalizeEditorialSlotKey(item.slotKey, "morning_finance")}]`, typeof item.notes === "string" ? item.notes.trim() : ""]
              .filter(Boolean)
              .join(" | "),
          }));
      }
    } catch (error) {
      this.logger.warn("Daily editorial research ideas fell back to deterministic ideas", {
        channelKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const savedItems = generatedIdeas.map((idea) =>
      this.contentOps.createItem({
        title: idea.title,
        platform: channel.platform,
        format: "short_video",
        status: "idea",
        pillar: idea.pillar,
        audience: idea.audience,
        hook: idea.hook,
        notes: idea.notes,
        channelKey: channel.key,
        seriesKey: idea.seriesKey ?? undefined,
        formatTemplateKey: idea.formatTemplateKey ?? undefined,
      }),
    );

    const packagedItemIds: number[] = [];
    const packageFailures: Array<{ id: number; error: string }> = [];
    for (const createdItem of savedItems) {
      try {
        await this.runUserPrompt(`gere roteiro para o item #${createdItem.id}`);
        const refreshed = this.contentOps.getItemById(createdItem.id);
        if (refreshed && hasSavedShortPackage(refreshed.notes)) {
          packagedItemIds.push(createdItem.id);
          continue;
        }
        packageFailures.push({
          id: createdItem.id,
          error: "pacote não foi salvo após a geração",
        });
      } catch (error) {
        packageFailures.push({
          id: createdItem.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const refreshedItems = savedItems.map((item) => this.contentOps.getItemById(item.id) ?? item);

    const reply = buildDailyEditorialResearchReply({
      channelName: channel.name,
      runDate,
      primaryTrend: usableTrends[0]?.title,
      selectedTrends: usableTrends,
      items: refreshedItems.map((item) => ({
        ...item,
        slotKey: extractEditorialSlotKeyFromNotes(item.notes),
        hasScriptPackage: hasSavedShortPackage(item.notes),
      })),
      fallbackMode,
      packageReadyCount: packagedItemIds.length,
      packageFailedCount: packageFailures.length,
    });

    this.contentOps.createResearchRun({
      channelKey: channel.key,
      runType,
      runDate,
      status: "success",
      primaryTrend: usableTrends[0]?.title,
      summary: reply,
      payloadJson: JSON.stringify({
        selectedTrends: usableTrends,
        fallbackMode,
        createdItemIds: savedItems.map((item) => item.id),
        packagedItemIds,
        packageFailures,
        slots: savedItems.map((item) => ({
          id: item.id,
          slotKey: extractEditorialSlotKeyFromNotes(item.notes) ?? null,
        })),
      }),
    });

    return {
      reply,
      runDate,
      createdItemIds: savedItems.map((item) => item.id),
      skipped: false,
    };
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

    const preLocalExternalReasoningResult = await this.tryRunPreLocalExternalReasoning({
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
    const contextWithReasoning = this.enrichContextWithReasoning(context, intent, requestLogger);
    const synthesis = await this.responseSynthesizer.synthesize(contextWithReasoning, { requestLogger });
    const outcome = await this.turnPlanner.plan(contextWithReasoning, synthesis, { channelLabel: "core" });

    return {
      requestId,
      reply: outcome.reply,
      messages: outcome.messages,
      toolExecutions: outcome.toolExecutions,
    };
  }

  private enrichContextWithReasoning(
    context: ContextBundle,
    intent: IntentResolution,
    requestLogger: Logger,
  ): ContextBundle {
    if (!this.reasoningEngine || !context.operationalState || !context.profile) {
      return context;
    }

    try {
      const trace = this.reasoningEngine.analyze({
        userPrompt: context.activeUserPrompt,
        operationalState: context.operationalState,
        profile: context.profile,
        recentMessages: context.recentMessages,
        currentHour: new Date().getHours(),
      });
      const surfacedInsights = trace.proactiveInsights
        .filter((insight) => this.reasoningEngine?.shouldSurfaceInsight(insight) ?? false)
        .slice(0, 2);
      const reasoningTrace: ReasoningTrace = {
        ...trace,
        proactiveInsights: surfacedInsights,
      };
      const insightMessage = surfacedInsights.length > 0
        ? [{
            role: "system" as const,
            content: [
              "Percepção proativa do Atlas antes de responder:",
              ...surfacedInsights.map((insight) => `[${insight.urgency}] ${insight.message}`),
            ].join("\n"),
          }]
        : [];

      this.recordUserModelInteraction(context, intent, surfacedInsights.length > 0, requestLogger);
      requestLogger.info("Deliberative reasoning applied", {
        insightCount: surfacedInsights.length,
        responseStyle: reasoningTrace.suggestedResponseStyle,
        energyHint: reasoningTrace.energyHint,
      });

      return {
        ...context,
        reasoningTrace,
        messages: [
          ...context.messages,
          ...insightMessage,
        ],
      };
    } catch (error) {
      requestLogger.warn("Deliberative reasoning failed; continuing without trace", {
        error: error instanceof Error ? error.message : String(error),
      });
      return context;
    }
  }

  private recordUserModelInteraction(
    context: ContextBundle,
    intent: IntentResolution,
    hadProactiveInsight: boolean,
    requestLogger: Logger,
  ): void {
    if (!this.userModelTracker) {
      return;
    }

    try {
      const promptLength = context.activeUserPrompt.length;
      const promptComplexity =
        intent.compoundIntent || /estrat[eé]gia|decis[aã]o|compar|diagn[oó]stico|plano/i.test(context.activeUserPrompt)
          ? "strategic"
          : promptLength > 180 || context.activeUserPrompt.split(/[.!?]/).filter(Boolean).length > 2
            ? "complex"
            : "simple";
      this.userModelTracker.updateFromInteraction({
        hour: new Date().getHours(),
        domain: context.orchestration.route.primaryDomain,
        promptComplexity,
        hadProactiveInsight,
        userReacted: false,
      });
    } catch (error) {
      requestLogger.debug("User behavior model update skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async executeSynthesizedTool(input: ExecuteSynthesizedToolInput): Promise<{
    content: string;
    rawResult?: unknown;
  }> {
    return this.pluginRegistry.execute(input.toolName, input.rawArguments, {
      requestId: input.requestId,
      toolCallId: input.toolCallId,
      config: this.config,
      logger: input.requestLogger,
      fileAccess: this.fileAccess,
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
      orchestration: input.context.orchestration,
    });
  }

  async executeToolDirect(toolName: string, rawArguments: unknown): Promise<{
    requestId: string;
    content: string;
    rawResult: unknown;
  }> {
    const requestId = randomUUID();
    const toolCallId = randomUUID();
    const orchestration = buildOrchestrationContext(`executar ferramenta ${toolName}`);
    const requestLogger = this.logger.child({ requestId, tool: toolName, toolCallId, direct: true });
    const execution = await this.pluginRegistry.execute(toolName, rawArguments, {
      requestId,
      toolCallId,
      config: this.config,
      logger: requestLogger,
      fileAccess: this.fileAccess,
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
      orchestration,
    });

    return {
      requestId,
      content: execution.content,
      rawResult: execution.rawResult,
    };
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

  private async tryRunExternalReasoning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    intent: IntentResolution,
    preferences: UserPreferences,
    options?: AgentRunOptions,
    stage: ExternalReasoningStage = "post_direct_routes",
  ): Promise<AgentRunResult | null> {
    if (!shouldAttemptExternalReasoning(this.config.externalReasoning, userPrompt, intent, stage)) {
      return null;
    }

    requestLogger.info("Trying external reasoning provider", {
      mode: this.config.externalReasoning.mode,
      stage,
      primaryDomain: intent.orchestration.route.primaryDomain,
      actionMode: intent.orchestration.route.actionMode,
      compoundIntent: intent.compoundIntent,
    });

    try {
      const contextPack = await this.contextPacks.buildForPrompt(userPrompt, intent);
      const request = await this.buildExternalReasoningRequest(
        userPrompt,
        intent,
        preferences,
        contextPack,
        options,
      );
      const response = await this.externalReasoning.reason(request);
      requestLogger.info("External reasoning completed", {
        mode: this.config.externalReasoning.mode,
        stage,
        responseKind: response.kind,
      });
      requestLogger.info(
        response.kind === "assistant_decision"
          ? "External reasoning assistant_decision accepted"
          : "External reasoning text response accepted",
        {
          mode: this.config.externalReasoning.mode,
          stage,
        },
      );
      const personalProfile = this.personalMemory.getProfile();
      const operationalMode = resolveEffectiveOperationalMode(userPrompt, personalProfile);

      return {
        requestId,
        reply: rewriteConversationalSimpleReply(userPrompt, response.content, {
          profile: personalProfile,
          operationalMode,
        }),
        messages: buildBaseMessages(userPrompt, intent.orchestration, preferences),
        toolExecutions: [
          {
            toolName: "external_reasoning",
            resultPreview: JSON.stringify(
              {
                kind: response.kind,
                primaryDomain: intent.orchestration.route.primaryDomain,
                actionMode: intent.orchestration.route.actionMode,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      requestLogger.warn("External reasoning failed; falling back to local flow", {
        mode: this.config.externalReasoning.mode,
        stage,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async buildExternalReasoningRequest(
    userPrompt: string,
    intent: IntentResolution,
    preferences: UserPreferences,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
    options?: AgentRunOptions,
  ): Promise<ExternalReasoningRequest> {
    const personalProfile = this.personalMemory.getProfile();
    const operationalState = this.personalMemory.getOperationalState();
    const briefEvents = (contextPack?.brief?.events ?? [])
      .slice(0, 6)
      .flatMap((event) => {
        if (!event.start) {
          return [];
        }
        return [{
          summary: event.summary,
          start: event.start,
          ...(event.location ? { location: event.location } : {}),
          ...(event.account ? { account: event.account } : {}),
        }];
      });

    const memorySignals = contextPack?.signals.filter((signal) =>
      includesAny(signal.toLowerCase(), ["approval", "workflow", "memoria", "memória", "email", "tarefa", "clima"])
    ) ?? [];
    const personalSignals = [
      ...personalProfile.savedFocus.map((item) => `foco salvo: ${item}`),
      ...personalProfile.routineAnchors.map((item) => `rotina: ${item}`),
      ...personalProfile.operationalRules.map((item) => `regra operacional: ${item}`),
    ].slice(0, 8);
    const relevantLearnedPreferences = selectRelevantLearnedPreferences(
      userPrompt,
      this.personalMemory.listLearnedPreferences({
        activeOnly: true,
        limit: 12,
      }),
      4,
    );
    const tasksContext = await this.buildExternalReasoningTasksContext(userPrompt, intent, contextPack);
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, personalProfile);

    return {
      user_message: userPrompt,
      ...(options?.chatId !== undefined ? { chat_id: String(options.chatId) } : {}),
      intent: {
        primary_domain: intent.orchestration.route.primaryDomain,
        secondary_domains: intent.orchestration.route.secondaryDomains,
        mentioned_domains: intent.mentionedDomains,
        action_mode: intent.orchestration.route.actionMode,
        confidence: intent.orchestration.route.confidence,
        compound: intent.compoundIntent,
      },
      context: {
        signals: contextPack?.signals ?? [],
        ...(briefEvents.length > 0
          ? {
              calendar: {
                timezone: this.config.google.defaultTimezone,
                events: briefEvents,
              },
            }
          : {}),
        ...(memorySignals.length > 0 ? { memory: memorySignals } : {}),
        ...(personalSignals.length > 0 ? { personal: personalSignals } : {}),
        personal_profile: summarizeIdentityProfileForReasoning(personalProfile),
        operational_state: summarizeOperationalStateForReasoning(operationalState),
        ...(relevantLearnedPreferences.length > 0
          ? {
              learned_preferences: relevantLearnedPreferences.map((item) => ({
                type: item.type,
                description: item.description,
                value: item.value,
                confidence: item.confidence,
                confirmations: item.confirmations,
              })),
            }
          : {}),
        ...(operationalMode ? { operational_mode: operationalMode } : {}),
        ...(tasksContext ? { tasks: tasksContext } : {}),
        preferences: {
          response_style: preferences.responseStyle,
          response_length: preferences.responseLength,
          proactive_next_step: preferences.proactiveNextStep,
        },
        recent_messages: intent.historyUserTurns.slice(-6),
      },
    };
  }

  private shouldAttachTasksContextToExternalReasoning(
    userPrompt: string,
    intent: IntentResolution,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
  ): boolean {
    const normalizedPrompt = normalizeEmailAnalysisText(userPrompt);
    if (includesAny(normalizedPrompt, [
      "taref",
      "google tasks",
      "task",
      "penden",
      "lembrete",
      "concluir",
      "finalizar",
      "follow up",
    ])) {
      return true;
    }

    if ((contextPack?.signals ?? []).some((signal) =>
      includesAny(normalizeEmailAnalysisText(signal), ["taref", "google tasks", "task", "penden"])
    )) {
      return true;
    }

    return intent.orchestration.route.primaryDomain === "secretario_operacional"
      && ["plan", "analyze", "execute"].includes(intent.orchestration.route.actionMode);
  }

  private async buildExternalReasoningTasksContext(
    userPrompt: string,
    intent: IntentResolution,
    contextPack: Awaited<ReturnType<ContextPackService["buildForPrompt"]>>,
  ): Promise<ExternalReasoningRequest["context"]["tasks"] | undefined> {
    if (!this.shouldAttachTasksContextToExternalReasoning(userPrompt, intent, contextPack)) {
      return undefined;
    }

    const candidateAliases = resolvePromptAccountAliases(userPrompt, this.googleWorkspaces.getAliases());
    const lists: NonNullable<ExternalReasoningRequest["context"]["tasks"]>["lists"] = [];
    const items: NonNullable<ExternalReasoningRequest["context"]["tasks"]>["items"] = [];

    for (const alias of candidateAliases) {
      const workspace = this.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) {
        continue;
      }

      try {
        const taskLists = await workspace.listTaskLists();
        lists.push(
          ...taskLists.slice(0, 3).map((taskList) => ({
            account: alias,
            id: taskList.id,
            title: taskList.title,
          })),
        );

        const tasks = await workspace.listTasks({
          maxResults: 4,
          showCompleted: false,
        });
        items.push(
          ...tasks.slice(0, 4).map((task) => ({
            account: alias,
            task_id: task.id,
            task_list_id: task.taskListId,
            task_list_title: task.taskListTitle,
            title: task.title,
            status: task.status,
            ...(task.due ? { due: task.due } : {}),
          })),
        );
      } catch (error) {
        this.logger.debug("Skipping Google Tasks context for external reasoning", {
          account: alias,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (lists.length >= 6 && items.length >= 8) {
        break;
      }
    }

    if (lists.length === 0 && items.length === 0) {
      return undefined;
    }

    const recentFocus = intent.historyUserTurns
      .map((turn) => turn.trim())
      .filter((turn) => includesAny(normalizeEmailAnalysisText(turn), ["taref", "task", "penden", "concluir", "finalizar"]))
      .slice(-2);

    return {
      lists: lists.slice(0, 6),
      items: items.slice(0, 8),
      ...(recentFocus.length > 0 ? { recent_focus: recentFocus } : {}),
      guidance: [
        "For task create, include title.",
        "For task update/delete, include task_id and task_list_id when known.",
        "If only the task list title is known, you may include task_list_title.",
        "If only the current task title is known, you may include target_title.",
        "Never invent task_id or task_list_id. If uncertain, return text or should_execute=false.",
      ],
    };
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

  private async tryRunDirectAgentIdentity(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isAgentIdentityPrompt(userPrompt)) {
      return null;
    }

    return {
      requestId,
      reply: buildAgentIdentityReply(this.preferences.get().preferredAgentName),
      messages: buildBaseMessages(userPrompt, orchestration, this.preferences.get()),
      toolExecutions: [],
    };
  }

  private async tryRunDirectGreeting(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isGreetingPrompt(userPrompt)) {
      return null;
    }

    const profile = this.personalMemory.getProfile();
    const operationalMode = resolveEffectiveOperationalMode(userPrompt, profile);
    return {
      requestId,
      reply: buildGreetingReply(userPrompt, {
        profile,
        operationalMode,
      }),
      messages: buildBaseMessages(userPrompt, orchestration, this.preferences.get()),
      toolExecutions: [],
    };
  }

  private async tryRunDirectConversationStyleCorrection(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    const currentProfile = this.personalMemory.getProfile();
    const correction = extractConversationStyleCorrection(userPrompt, currentProfile);
    if (!correction) {
      return null;
    }

    await this.executeToolDirect("update_personal_operational_profile", {
      ...(correction.profileUpdate.responseStyle ? { responseStyle: correction.profileUpdate.responseStyle } : {}),
      ...(correction.profileUpdate.briefingPreference ? { briefingPreference: correction.profileUpdate.briefingPreference } : {}),
      ...(correction.profileUpdate.detailLevel ? { detailLevel: correction.profileUpdate.detailLevel } : {}),
      ...(correction.profileUpdate.tonePreference ? { tonePreference: correction.profileUpdate.tonePreference } : {}),
      ...(correction.profileUpdate.autonomyPreferences ? { autonomyPreferences: correction.profileUpdate.autonomyPreferences } : {}),
    });
    this.preferences.update(correction.preferenceUpdate);

    try {
      await this.executeToolDirect("save_learned_preference", {
        ...correction.learnedPreference,
        observe: true,
      });
    } catch (error) {
      this.logger.warn("Failed to save learned conversation style preference", {
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

  private async tryRunDirectMemoryUpdateGuard(
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

  private async tryRunDirectEmailSummary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getEmailDirectService().tryRunEmailSummary({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectEmailLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getEmailDirectService().tryRunEmailLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectOperationalBrief(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunOperationalBrief({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectMorningBrief(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunMorningBrief({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectMacQueueStatus(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getWorkspaceMacDirectService().tryRunMacQueueStatus({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  private async tryRunDirectMacQueueList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getWorkspaceMacDirectService().tryRunMacQueueList({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  private async tryRunDirectMacQueueEnqueue(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getWorkspaceMacDirectService().tryRunMacQueueEnqueue({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  private async tryRunDirectGoogleTasks(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleTasks({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectCalendarLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunCalendarLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectGoogleTaskDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleTaskDraft({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectCalendarConflictReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunCalendarConflictReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectGoogleEventDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleEventDraft({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectCalendarPeriodList(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunCalendarPeriodList({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectGoogleEventMove(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleEventMove({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectGoogleEventDelete(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleEventDelete({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectGoogleContacts(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleContacts({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectGoogleCalendarsList(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunGoogleCalendarsList({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectPlaceLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getGoogleWorkspaceDirectService().tryRunPlaceLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectInternalKnowledgeLookup(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getKnowledgeProjectDirectService().tryRunInternalKnowledgeLookup({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectWebResearch(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getExternalIntelligenceDirectService().tryRunWebResearch({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectWeather(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isWeatherPrompt(userPrompt)) {
      return null;
    }

    const location = extractWeatherLocation(userPrompt) ?? this.config.briefing.weatherLocation;

    requestLogger.info("Using direct weather route", {
      location,
    });

    const service = new WeatherService(requestLogger.child({ scope: "weather" }));
    const forecast = await service.getForecast({
      location,
      days: 3,
      timezone: this.config.google.defaultTimezone,
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

  private async tryRunDirectRevenueScoreboard(
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
    const scoreboard = this.growthOps.getMonthlyScoreboard(referenceMonth);

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

  private async tryRunDirectAllowedSpaces(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getWorkspaceMacDirectService().tryRunAllowedSpaces({
      userPrompt,
      requestId,
      orchestration,
    });
  }

  private async tryRunDirectProjectScan(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getKnowledgeProjectDirectService().tryRunProjectScan({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectProjectMirror(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getKnowledgeProjectDirectService().tryRunProjectMirror({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentOverview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunContentOverview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentChannels(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunContentChannels({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentIdeaGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentGenerationDirectService().tryRunContentIdeaGeneration({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectDailyEditorialResearch(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunDailyEditorialResearch({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentGenerationDirectService().tryRunContentReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentScriptGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentGenerationDirectService().tryRunContentScriptGeneration({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentBatchPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentGenerationDirectService().tryRunContentBatchPlanning({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentBatchGeneration(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentGenerationDirectService().tryRunContentBatchGeneration({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentDistributionStrategy(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentGenerationDirectService().tryRunContentDistributionStrategy({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentSeries(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunContentSeries({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentFormatLibrary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunContentFormatLibrary({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectContentHookLibrary(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunContentHookLibrary({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectSafeExec(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getWorkspaceMacDirectService().tryRunSafeExec({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectCaseNotes(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getContentDirectService().tryRunCaseNotes({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectUserPreferences(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    if (!isUserPreferencesPrompt(userPrompt)) {
      return null;
    }

    const update = extractPreferenceUpdate(userPrompt);
    const preferences = update ? this.preferences.update(update) : this.preferences.get();

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

  private async tryRunDirectPersonalOperationalProfileShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunProfileShow({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectOperationalStateShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunOperationalStateShow({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectLearnedPreferencesList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunLearnedPreferencesList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectLearnedPreferencesDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunLearnedPreferencesDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectCapabilityInspection(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getCapabilityInspectionService().tryRunInspection({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectPersonalOperationalProfileUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunProfileUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectActiveGoalsList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunGoalList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectActiveGoalSave(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunGoalSave({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectActiveGoalProgressUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunGoalProgressUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectActiveGoalDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunGoalDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectPersonalOperationalProfileDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunProfileDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectPersonalMemoryList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunPersonalMemoryList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectPersonalMemorySave(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunPersonalMemorySave({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectPersonalMemoryUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunPersonalMemoryUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectPersonalMemoryDelete(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalContextDirectService().tryRunPersonalMemoryDelete({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectWorkflowPlanning(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getWorkflowDirectService().tryRunWorkflowPlanning({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectContactList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getMemoryContactDirectService().tryRunContactList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectContactUpsert(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getMemoryContactDirectService().tryRunContactUpsert({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectMemoryEntityList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getMemoryContactDirectService().tryRunMemoryEntityList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectMemoryEntitySearch(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getMemoryContactDirectService().tryRunMemoryEntitySearch({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectIntentResolve(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    if (!isIntentResolvePrompt(userPrompt)) {
      return null;
    }

    const subject = extractIntentResolveSubject(userPrompt);
    const resolution = this.intentRouter.resolve(subject);
    const contextPack = await this.contextPacks.buildForPrompt(subject, resolution);
    return {
      requestId,
      reply: this.responseOs.buildIntentAnalysisReply({
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

  private async tryRunDirectOperationalPlanning(
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

    const contextPack = await this.contextPacks.buildForPrompt(userPrompt, intent);
    const brief = contextPack?.brief;
    if (!brief) {
      return null;
    }

    return {
      requestId,
      reply: this.responseOs.buildOrganizationReply(
        buildOperationalPlanContract(userPrompt, brief, this.personalMemory.getProfile()),
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

  private async tryRunDirectWorkflowList(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getWorkflowDirectService().tryRunWorkflowList({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectWorkflowShow(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getWorkflowDirectService().tryRunWorkflowShow({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectWorkflowArtifacts(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getWorkflowDirectService().tryRunWorkflowArtifacts({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectWorkflowExecution(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getWorkflowDirectService().tryRunWorkflowExecution({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
      preferences,
    });
  }

  private async tryRunDirectWorkflowStepUpdate(
    userPrompt: string,
    requestId: string,
    orchestration: OrchestrationContext,
    preferences: UserPreferences,
  ): Promise<AgentRunResult | null> {
    return this.getWorkflowDirectService().tryRunWorkflowStepUpdate({
      userPrompt,
      requestId,
      orchestration,
      preferences,
    });
  }

  private async createWorkflowPlanFromPrompt(
    userPrompt: string,
    orchestration: OrchestrationContext,
    requestLogger: Logger,
  ): Promise<WorkflowPlanRecord> {
    const fallbackInput = this.buildFallbackWorkflowPlanInput(userPrompt, orchestration);

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o orquestrador do Atlas Prime.",
              "Sua função é transformar um objetivo em um workflow executável multi-etapas.",
              "Responda somente JSON válido.",
              "Use estes domínios permitidos: orchestrator, assistente_social, secretario_operacional, social_media, dev_full_stack, analista_negocios_growth.",
              "Crie um plano pragmático com entre 4 e 8 etapas.",
              "Cada etapa deve ter: title, ownerDomain, taskType, objective, deliverable, successCriteria, dependsOn, suggestedTools.",
              "O plano deve ter: title, executiveSummary, primaryDomain, secondaryDomains, deliverables, nextAction, steps.",
              "Não inclua texto fora do JSON.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Objetivo: ${userPrompt}`,
              `Domínio principal atual: ${orchestration.route.primaryDomain}`,
              `Domínios secundários: ${orchestration.route.secondaryDomains.join(", ") || "nenhum"}`,
              `Modo de ação: ${orchestration.route.actionMode}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      const input = this.normalizeWorkflowPlanInput(parsed, userPrompt, orchestration, fallbackInput);
      return this.workflows.createPlan(input);
    } catch (error) {
      requestLogger.warn("Workflow plan generation fell back to deterministic plan", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.workflows.createPlan(fallbackInput);
    }
  }

  private async buildWorkflowExecutionBrief(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    requestLogger: Logger,
  ): Promise<{
    summary: string;
    immediateActions: string[];
    risks: string[];
    outputs: string[];
    suggestedTools: string[];
    followUp: string;
  }> {
    const completedSteps = plan.steps
      .filter((item) => item.status === "completed")
      .map((item) => `${item.stepNumber}. ${item.title}`)
      .slice(0, 8);

    const fallback = {
      summary: `Iniciar a etapa ${step.stepNumber} com foco em ${step.objective}.`,
      immediateActions: [
        `Validar o objetivo da etapa: ${step.objective}`,
        `Produzir o entregável esperado: ${step.deliverable}`,
        "Registrar decisões, lacunas e próximos passos no artefato da etapa.",
      ],
      risks: [
        "Escopo da etapa ficar aberto demais.",
        "Faltar dado ou contexto para concluir a entrega com qualidade.",
      ],
      outputs: [
        step.deliverable,
        "Checklist do que foi validado e do que ainda está pendente.",
      ],
      suggestedTools: step.suggestedTools,
      followUp: `Executar a etapa ${step.stepNumber}, registrar o resultado e marcar como concluída quando o critério de sucesso for atendido.`,
    };

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é o coordenador operacional do Atlas Prime.",
              "Gere um brief curto e executável para iniciar ou retomar uma etapa de workflow.",
              "Responda somente JSON válido.",
              "Formato: summary, immediateActions, risks, outputs, suggestedTools, followUp.",
              "Use linguagem pragmática e operacional.",
              "Limite immediateActions a 5 itens, risks a 4, outputs a 5.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow: ${plan.title}`,
              `Resumo do workflow: ${plan.executiveSummary}`,
              `Etapa: ${step.stepNumber}. ${step.title}`,
              `Domínio dono: ${step.ownerDomain}`,
              `Objetivo da etapa: ${step.objective}`,
              `Entregável: ${step.deliverable}`,
              `Critério de sucesso: ${step.successCriteria}`,
              `Dependências: ${step.dependsOn.length ? step.dependsOn.join(", ") : "nenhuma"}`,
              `Etapas concluídas: ${completedSteps.join(" | ") || "nenhuma"}`,
              `Tools sugeridas: ${step.suggestedTools.join(", ") || "nenhuma"}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      return {
        summary: typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallback.summary,
        immediateActions: Array.isArray(parsed.immediateActions)
          ? parsed.immediateActions.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : fallback.immediateActions,
        risks: Array.isArray(parsed.risks)
          ? parsed.risks.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4)
          : fallback.risks,
        outputs: Array.isArray(parsed.outputs)
          ? parsed.outputs.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : fallback.outputs,
        suggestedTools: Array.isArray(parsed.suggestedTools)
          ? parsed.suggestedTools.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6)
          : fallback.suggestedTools,
        followUp: typeof parsed.followUp === "string" && parsed.followUp.trim() ? parsed.followUp.trim() : fallback.followUp,
      };
    } catch (error) {
      requestLogger.warn("Workflow execution brief fell back to deterministic brief", {
        planId: plan.id,
        stepNumber: step.stepNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return fallback;
    }
  }

  private saveWorkflowExecutionArtifact(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: {
      summary: string;
      immediateActions: string[];
      risks: string[];
      outputs: string[];
      suggestedTools: string[];
      followUp: string;
    },
  ): WorkflowArtifactRecord {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workflowDir = path.join(
      this.config.paths.workspaceDir,
      "reports",
      "workflows",
      `workflow-${plan.id}`,
    );
    mkdirSync(workflowDir, { recursive: true });

    const filename = `step-${step.stepNumber}-${slugifySegment(step.title)}-${timestamp}.md`;
    const filePath = path.join(workflowDir, filename);
    const content = [
      `# Workflow #${plan.id} - Etapa ${step.stepNumber}`,
      "",
      `## Título`,
      step.title,
      "",
      `## Domínio dono`,
      step.ownerDomain,
      "",
      `## Objetivo`,
      step.objective,
      "",
      `## Entregável esperado`,
      step.deliverable,
      "",
      `## Critério de sucesso`,
      step.successCriteria,
      "",
      `## Resumo operacional`,
      brief.summary,
      "",
      `## Ações imediatas`,
      ...brief.immediateActions.map((item) => `- ${item}`),
      "",
      `## Riscos`,
      ...brief.risks.map((item) => `- ${item}`),
      "",
      `## Saídas esperadas`,
      ...brief.outputs.map((item) => `- ${item}`),
      "",
      `## Tools sugeridas`,
      ...(brief.suggestedTools.length > 0 ? brief.suggestedTools : step.suggestedTools).map((item) => `- ${item}`),
      "",
      `## Próxima ação`,
      brief.followUp,
      "",
      `## Registrado em`,
      new Date().toISOString(),
      "",
    ].join("\n");

    writeFileSync(filePath, content, "utf8");
    return this.workflows.saveArtifact({
      planId: plan.id,
      stepNumber: step.stepNumber,
      artifactType: "execution_brief",
      title: `Brief da etapa ${step.stepNumber}: ${step.title}`,
      summary: brief.summary,
      content,
      filePath,
    });
  }

  private async generateWorkflowDomainDeliverable(
    plan: WorkflowPlanRecord,
    step: WorkflowStepRecord,
    brief: {
      summary: string;
      immediateActions: string[];
      risks: string[];
      outputs: string[];
      suggestedTools: string[];
      followUp: string;
    },
    requestLogger: Logger,
  ): Promise<{ artifact: WorkflowArtifactRecord; summary: string }> {
    const domainSpecs: Record<WorkflowStepRecord["ownerDomain"], { sections: string[]; guidance: string }> = {
      orchestrator: {
        sections: ["Resumo executivo", "Dependências", "Plano integrado", "Riscos", "Próximos passos"],
        guidance: "Produza um entregável de coordenação cross-functional, com plano integrado, checkpoints e handoffs claros.",
      },
      analista_negocios_growth: {
        sections: ["Mercado", "Hipóteses", "Concorrentes", "Experimentos", "KPIs", "Recomendação prática"],
        guidance: "Produza um artefato analítico de growth com hipóteses, sinais de demanda, concorrentes, experimentos e KPIs acionáveis.",
      },
      social_media: {
        sections: ["Mensagem central", "Pilares de conteúdo", "Campanha", "Peças", "CTAs", "Próximos passos"],
        guidance: "Produza um pacote de conteúdo e campanha pronto para execução, com mensagens, criativos e CTAs.",
      },
      dev_full_stack: {
        sections: ["Escopo técnico", "Arquitetura", "Backlog", "Plano de implementação", "Validação", "Riscos"],
        guidance: "Produza um entregável técnico executável: backlog, arquitetura, milestones e validações objetivas.",
      },
      secretario_operacional: {
        sections: ["Resumo operacional", "Compromissos", "Follow-ups", "Checklist", "Próximos passos"],
        guidance: "Produza um plano operacional de agenda, follow-up e execução administrativa com clareza de dono e prazo.",
      },
      assistente_social: {
        sections: ["Resumo do caso", "Encaminhamentos", "Documentos", "Cuidados", "Próximos passos"],
        guidance: "Produza um material formal e cuidadoso, sem extrapolar fatos, com foco em encaminhamento e registro responsável.",
      },
    };

    const spec = domainSpecs[step.ownerDomain] ?? domainSpecs.orchestrator;
    const fallbackTitle = `Entregável da etapa ${step.stepNumber}: ${step.title}`;
    const fallbackSummary = `Primeira versão do entregável da etapa ${step.stepNumber} pronta para revisão.`;
    const fallbackContent = [
      `# ${fallbackTitle}`,
      "",
      `## Resumo executivo`,
      brief.summary,
      "",
      `## Objetivo da etapa`,
      step.objective,
      "",
      `## Entregável esperado`,
      step.deliverable,
      "",
      `## Ações imediatas`,
      ...brief.immediateActions.map((item) => `- ${item}`),
      "",
      `## Riscos`,
      ...brief.risks.map((item) => `- ${item}`),
      "",
      `## Saídas esperadas`,
      ...brief.outputs.map((item) => `- ${item}`),
      "",
      `## Próximos passos`,
      brief.followUp,
      "",
    ].join("\n");

    let title = fallbackTitle;
    let summary = fallbackSummary;
    let content = fallbackContent;

    try {
      const response = await this.client.chat({
        messages: [
          {
            role: "system",
            content: [
              "Você é um executor especialista do Atlas Prime.",
              "Gere um entregável real e útil para a etapa do workflow.",
              "Responda somente JSON válido.",
              "Formato: title, summary, content.",
              "O campo content deve ser Markdown pronto para uso.",
              spec.guidance,
            ].join(" "),
          },
          {
            role: "user",
            content: [
              `Workflow: ${plan.title}`,
              `Resumo do workflow: ${plan.executiveSummary}`,
              `Etapa: ${step.stepNumber}. ${step.title}`,
              `Domínio dono: ${step.ownerDomain}`,
              `Objetivo: ${step.objective}`,
              `Entregável esperado: ${step.deliverable}`,
              `Critério de sucesso: ${step.successCriteria}`,
              `Resumo operacional: ${brief.summary}`,
              `Ações imediatas: ${brief.immediateActions.join(" | ")}`,
              `Riscos: ${brief.risks.join(" | ")}`,
              `Saídas esperadas: ${brief.outputs.join(" | ")}`,
              `Seções obrigatórias: ${spec.sections.join(" | ")}`,
            ].join("\n"),
          },
        ],
      });

      const parsed = JSON.parse(stripCodeFences(response.message.content ?? "")) as Record<string, unknown>;
      title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallbackTitle;
      summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : fallbackSummary;
      content = typeof parsed.content === "string" && parsed.content.trim() ? parsed.content.trim() : fallbackContent;
    } catch (error) {
      requestLogger.warn("Workflow deliverable generation fell back to deterministic artifact", {
        planId: plan.id,
        stepNumber: step.stepNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const workflowDir = path.join(
      this.config.paths.workspaceDir,
      "reports",
      "workflows",
      `workflow-${plan.id}`,
    );
    mkdirSync(workflowDir, { recursive: true });
    const filename = `step-${step.stepNumber}-deliverable-${slugifySegment(step.title)}-${timestamp}.md`;
    const filePath = path.join(workflowDir, filename);
    writeFileSync(filePath, content, "utf8");

    const artifact = this.workflows.saveArtifact({
      planId: plan.id,
      stepNumber: step.stepNumber,
      artifactType: "deliverable",
      title,
      summary,
      content,
      filePath,
    });

    return {
      artifact,
      summary,
    };
  }

  private normalizeWorkflowPlanInput(
    parsed: Record<string, unknown>,
    userPrompt: string,
    orchestration: OrchestrationContext,
    fallback: CreateWorkflowPlanInput,
  ): CreateWorkflowPlanInput {
    const allowedDomains = new Set([
      "orchestrator",
      "assistente_social",
      "secretario_operacional",
      "social_media",
      "dev_full_stack",
      "analista_negocios_growth",
    ]);

    const normalizeDomain = (value: unknown, backup: CreateWorkflowPlanInput["primaryDomain"]) =>
      typeof value === "string" && allowedDomains.has(value) ? (value as CreateWorkflowPlanInput["primaryDomain"]) : backup;

    const secondaryDomains: CreateWorkflowPlanInput["secondaryDomains"] = Array.isArray(parsed.secondaryDomains)
      ? parsed.secondaryDomains
          .filter((item): item is string => typeof item === "string" && allowedDomains.has(item))
          .map((item) => item as CreateWorkflowPlanInput["primaryDomain"])
      : fallback.secondaryDomains ?? [];

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps: CreateWorkflowPlanInput["steps"] = [];
    rawSteps.forEach((item, index) => {
        if (!item || typeof item !== "object") {
          return;
        }
        const record = item as Record<string, unknown>;
        steps.push({
          title: typeof record.title === "string" ? record.title.trim() : `Etapa ${index + 1}`,
          ownerDomain: normalizeDomain(record.ownerDomain, fallback.steps[Math.min(index, fallback.steps.length - 1)]?.ownerDomain ?? fallback.primaryDomain),
          taskType: typeof record.taskType === "string" ? record.taskType.trim() : "execution",
          objective: typeof record.objective === "string" ? record.objective.trim() : `Avançar o objetivo: ${userPrompt}`,
          deliverable: typeof record.deliverable === "string" ? record.deliverable.trim() : "Entregável definido",
          successCriteria:
            typeof record.successCriteria === "string" ? record.successCriteria.trim() : "Etapa concluída com saída verificável",
          dependsOn: Array.isArray(record.dependsOn)
            ? record.dependsOn.map((value) => Number.parseInt(String(value), 10)).filter((value) => Number.isFinite(value))
            : [],
          suggestedTools: Array.isArray(record.suggestedTools)
            ? record.suggestedTools.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : [],
          status: "pending" as const,
        });
    });
    const normalizedSteps = steps.slice(0, 8);

    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : fallback.title,
      objective: userPrompt,
      executiveSummary:
        typeof parsed.executiveSummary === "string" && parsed.executiveSummary.trim()
          ? parsed.executiveSummary.trim()
          : fallback.executiveSummary,
      status: "draft",
      primaryDomain: normalizeDomain(parsed.primaryDomain, fallback.primaryDomain),
      secondaryDomains,
      deliverables: Array.isArray(parsed.deliverables)
        ? parsed.deliverables.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 8)
        : fallback.deliverables,
      nextAction:
        typeof parsed.nextAction === "string" && parsed.nextAction.trim()
          ? parsed.nextAction.trim()
          : fallback.nextAction,
      steps: normalizedSteps.length > 0 ? normalizedSteps : fallback.steps,
    };
  }

  private buildFallbackWorkflowPlanInput(
    userPrompt: string,
    orchestration: OrchestrationContext,
  ): CreateWorkflowPlanInput {
    const primary = orchestration.route.primaryDomain === "orchestrator"
      ? "analista_negocios_growth"
      : orchestration.route.primaryDomain;
    const secondary = orchestration.route.secondaryDomains;

    return {
      title: `Workflow Atlas Prime: ${userPrompt.slice(0, 72).trim()}`,
      objective: userPrompt,
      executiveSummary:
        "Plano orquestrado para decompor o objetivo em pesquisa, análise, execução, revisão e entrega com responsáveis claros.",
      status: "draft",
      primaryDomain: primary,
      secondaryDomains: secondary,
      deliverables: [
        "brief executivo",
        "backlog priorizado",
        "artefatos principais do objetivo",
      ],
      nextAction: "Validar o workflow, iniciar a etapa 1 e marcar o que já está pronto.",
      steps: [
        {
          title: "Descoberta e contexto",
          ownerDomain: "analista_negocios_growth",
          taskType: "research",
          objective: "Levantar contexto, restrições, público e sinais de valor.",
          deliverable: "brief de contexto",
          successCriteria: "Contexto e metas organizados com lacunas identificadas.",
          suggestedTools: ["web_search", "list_memory_items", "list_recent_emails"],
        },
        {
          title: "Plano operacional",
          ownerDomain: "orchestrator",
          taskType: "planning",
          objective: "Quebrar o objetivo em frentes, dependências e critérios de conclusão.",
          deliverable: "plano operacional por etapas",
          successCriteria: "Etapas, responsáveis e ordem definidos.",
          dependsOn: [1],
          suggestedTools: ["get_memory_summary"],
        },
        {
          title: "Execução da frente principal",
          ownerDomain: primary,
          taskType: "execution",
          objective: "Executar a frente principal do objetivo com base no plano.",
          deliverable: "entregável principal",
          successCriteria: "Entrega principal pronta para revisão.",
          dependsOn: [2],
          suggestedTools: ["safe_exec", "scan_project", "write_workspace_file"],
        },
        {
          title: "Distribuição e comunicação",
          ownerDomain: "social_media",
          taskType: "communication",
          objective: "Preparar mensagens, conteúdos e materiais de divulgação quando necessário.",
          deliverable: "copys, posts ou comunicações",
          successCriteria: "Materiais de comunicação alinhados ao objetivo.",
          dependsOn: [3],
          suggestedTools: ["export_content_calendar", "write_workspace_file"],
        },
        {
          title: "Fechamento e próximos passos",
          ownerDomain: "secretario_operacional",
          taskType: "coordination",
          objective: "Registrar entregas, pendências, follow-ups e compromissos derivados.",
          deliverable: "resumo final e próximos passos",
          successCriteria: "Nada crítico fica sem dono ou data.",
          dependsOn: [3, 4],
          suggestedTools: ["save_memory_item", "create_google_task", "create_calendar_event"],
        },
      ],
    };
  }

  private async tryRunDirectSupportReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalReviewDirectService().tryRunSupportReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectInboxTriage(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalReviewDirectService().tryRunInboxTriage({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectFollowUpReview(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalReviewDirectService().tryRunFollowUpReview({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectNextCommitmentPrep(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalReviewDirectService().tryRunNextCommitmentPrep({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectEmailDraft(
    userPrompt: string,
    requestId: string,
    requestLogger: Logger,
    orchestration: OrchestrationContext,
  ): Promise<AgentRunResult | null> {
    return this.getOperationalReviewDirectService().tryRunEmailDraft({
      userPrompt,
      requestId,
      requestLogger,
      orchestration,
    });
  }

  private async tryRunDirectPing(
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

    if (!requestsPingTool || !this.pluginRegistry.hasTool("ping")) {
      return null;
    }

    requestLogger.info("Using direct tool route", {
      tool: "ping",
    });

    const execution = await this.pluginRegistry.execute("ping", {}, {
      requestId,
      toolCallId: randomUUID(),
      config: this.config,
      logger: requestLogger.child({ tool: "ping", toolCallId: "direct" }),
      fileAccess: this.fileAccess,
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

export interface AgentCoreRequestRuntime extends Pick<
  AgentCore,
  "runUserPrompt" | "resolveStructuredTaskOperationPayload" | "executeToolDirect"
> {}
