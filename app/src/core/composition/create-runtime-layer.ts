import type { LlmClient } from "../../types/llm.js";
import type { Logger } from "../../types/logger.js";
import { AssistantActionDispatcher } from "../action-dispatcher.js";
import { AgentCore, type AgentCoreDependencies } from "../agent-core.js";
import { ContextPackService } from "../context-pack.js";
import { DraftApprovalService } from "../draft-approval-service.js";
import { RequestOrchestrator } from "../request-orchestrator.js";
import { ClarificationEngine } from "../clarification-engine.js";
import { WorkflowPlanBuilderService } from "../plan-builder.js";
import { setSystemPromptContextProvider } from "../system-prompt.js";
import type { AutonomyLayer, BootstrapLayer, IntelligenceLayer, IntegrationsLayer, LlmLayer, OsLayer, PluginLayer, RuntimeLayer, StorageLayer } from "./types.js";

interface RuntimeLayerInput {
  bootstrap: BootstrapLayer;
  storage: StorageLayer;
  autonomy: AutonomyLayer;
  intelligence: IntelligenceLayer;
  integrations: IntegrationsLayer;
  llm: LlmLayer;
  plugins: PluginLayer;
  os: OsLayer;
}

function createPlanBuilder(client: LlmClient, storage: Pick<StorageLayer, "goalStore" | "workflows">, logger: Logger): WorkflowPlanBuilderService {
  return new WorkflowPlanBuilderService(
    client,
    storage.workflows,
    logger.child({ scope: "plan-builder" }),
    () => {
      const goals = storage.goalStore.list();
      return goals.length > 0 ? storage.goalStore.summarize() : undefined;
    },
  );
}

function buildAgentCoreDependencies(input: RuntimeLayerInput, contextPacks: ContextPackService, planBuilder: WorkflowPlanBuilderService): AgentCoreDependencies {
  const { bootstrap, storage, autonomy, intelligence, integrations, llm, plugins, os } = input;
  return {
    config: bootstrap.config,
    logger: bootstrap.logger.child({ scope: "agent-core" }),
    fileAccess: bootstrap.fileAccess,
    client: llm.client,
    capabilityRegistry: plugins.capabilityRegistry,
    pluginRegistry: plugins.registry,
    memory: storage.memory,
    goalStore: storage.goalStore,
    preferences: storage.preferences,
    personalMemory: storage.personalMemory,
    growthOps: storage.growthOps,
    contentOps: storage.contentOps,
    socialAssistant: storage.socialAssistant,
    contacts: storage.contacts,
    communicationRouter: integrations.communicationRouter,
    approvals: storage.approvals,
    memoryEntities: storage.memoryEntities,
    whatsappMessages: storage.whatsappMessages,
    workflows: storage.workflows,
    workflowRuntime: integrations.workflowRuntime,
    entityLinker: intelligence.entityLinker,
    macCommandQueue: integrations.macCommandQueue,
    email: integrations.email,
    emailWriter: integrations.emailWriter,
    emailAccounts: integrations.emailAccounts,
    googleWorkspace: integrations.googleWorkspace,
    googleWorkspaces: integrations.googleWorkspaces,
    googleMaps: integrations.googleMaps,
    personalOs: os.personalOs,
    intentRouter: intelligence.intentRouter,
    responseOs: intelligence.responseOs,
    contextPacks,
    planBuilder,
    externalReasoning: integrations.externalReasoning,
    pexelsMedia: integrations.pexelsMedia,
    projectOps: bootstrap.projectOps,
    safeExec: bootstrap.safeExec,
    accountLinking: integrations.accountLinking,
    userRoleProfiles: os.userRoleProfiles,
    professionPacks: os.professionPacks,
    professionBootstrap: os.professionBootstrap,
    destinationRegistry: os.destinationRegistry,
    briefingPrivacyPolicy: os.briefingPrivacyPolicy,
    sharedBriefingComposer: os.sharedBriefingComposer,
    commandCenter: os.commandCenter,
    reasoningEngine: intelligence.reasoningEngine,
    userModelTracker: intelligence.userModelTracker,
    autonomyObservations: autonomy.autonomyObservations,
    autonomySuggestions: autonomy.autonomySuggestions,
    autonomyAudit: autonomy.autonomyAudit,
    autonomyFeedback: autonomy.autonomyFeedback,
    commitments: autonomy.commitments,
    memoryCandidates: autonomy.memoryCandidates,
    autonomyLoop: autonomy.autonomyLoop,
  };
}

export function createRuntimeLayer(input: RuntimeLayerInput): RuntimeLayer {
  const { bootstrap, storage, autonomy, intelligence, integrations, llm, plugins, os } = input;

  setSystemPromptContextProvider(() => {
    const goals = storage.goalStore.list();
    return {
      goalSummary: goals.length > 0 ? storage.goalStore.summarize() : undefined,
      recentDecisions: intelligence.decisionsLoader.summarizeSync(),
      availableCapabilities: plugins.capabilityRegistry
        .listCapabilities()
        .map((capability) => capability.name)
        .sort((left, right) => left.localeCompare(right)),
    };
  });

  const clarificationEngine = new ClarificationEngine(
    storage.clarifications,
    llm.client,
    bootstrap.logger.child({ scope: "clarification-engine" }),
    bootstrap.config.google.defaultTimezone,
    intelligence.intentRouter,
  );
  const contextPacks = new ContextPackService(
    os.personalOs,
    storage.approvals,
    intelligence.contextMemory,
    bootstrap.logger.child({ scope: "context-pack" }),
  );
  const planBuilder = createPlanBuilder(llm.client, storage, bootstrap.logger);
  const core = new AgentCore(
    buildAgentCoreDependencies(input, contextPacks, planBuilder),
  );
  const actionDispatcher = new AssistantActionDispatcher(
    core,
    bootstrap.logger.child({ scope: "assistant-action-dispatcher" }),
  );
  const draftApprovalService = new DraftApprovalService(
    os.approvalEngine,
    bootstrap.logger.child({ scope: "draft-approval-service" }),
  );
  const requestOrchestrator = new RequestOrchestrator(
    core,
    actionDispatcher,
    bootstrap.logger.child({ scope: "request-orchestrator" }),
    {
      extractor: autonomy.commitmentExtractor,
      store: autonomy.commitments,
    },
    {
      extractor: autonomy.memoryCandidateExtractor,
      store: autonomy.memoryCandidates,
    },
  );

  return {
    clarificationEngine,
    contextPacks,
    planBuilder,
    core,
    actionDispatcher,
    draftApprovalService,
    requestOrchestrator,
  };
}
