import { loadConfig } from "../config/load-config.js";
import { EmailAccountsService } from "../integrations/email/email-accounts.js";
import { ExternalReasoningClient } from "../integrations/external-reasoning/external-reasoning-client.js";
import { GoogleMapsService } from "../integrations/google/google-maps.js";
import { GoogleWorkspaceAuthService } from "../integrations/google/google-auth.js";
import { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import { PexelsMediaService } from "../integrations/media/pexels.js";
import { SupabaseMacCommandQueue } from "../integrations/supabase/mac-command-queue.js";
import { createLogger } from "../utils/logger.js";
import { AgentCore } from "./agent-core.js";
import { ApprovalInboxStore } from "./approval-inbox.js";
import { CommunicationRouter, ContactIntelligenceStore } from "./contact-intelligence.js";
import { ContentOpsStore } from "./content-ops.js";
import { FileAccessPolicy } from "./file-access-policy.js";
import { FounderOpsService } from "./founder-ops.js";
import { GrowthOpsStore } from "./growth-ops.js";
import { OpenAIClient } from "./openai-client.js";
import { OllamaClient } from "./ollama-client.js";
import { FallbackLlmClient } from "./fallback-llm-client.js";
import { OperationalMemoryStore } from "./operational-memory.js";
import { PersonalOSService } from "./personal-os.js";
import { loadToolPlugins } from "./plugin-loader.js";
import { ToolPluginRegistry } from "./plugin-registry.js";
import { ProjectOpsService } from "./project-ops.js";
import { SafeExecService } from "./safe-exec.js";
import { SocialAssistantStore } from "./social-assistant.js";
import { UserPreferencesStore } from "./user-preferences.js";
import { WhatsAppMessageStore } from "./whatsapp-message-store.js";
import { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import type { LlmClient } from "../types/llm.js";
import type { AppConfig, LlmProviderConfig } from "../types/config.js";
import { ApprovalPolicyService } from "./approval-policy.js";
import { ApprovalEngine } from "./approval-engine.js";
import { WorkflowExecutionRuntime } from "./execution-runtime.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { createBuiltInCapabilities } from "./capabilities/index.js";
import { createDeclaredCapabilityCatalog } from "./capabilities/catalog.js";
import { MemoryEntityStore } from "./memory-entity-store.js";
import { EntityLinker } from "./entity-linker.js";
import { IntentRouter } from "./intent-router.js";
import { WorkflowPlanBuilderService } from "./plan-builder.js";
import { ClarificationInboxStore } from "./clarification-inbox.js";
import { ClarificationEngine } from "./clarification-engine.js";
import { ResponseOS } from "./response-os.js";
import { ContextPackService } from "./context-pack.js";
import { ContextMemoryService } from "./context-memory.js";
import { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";

function withLlmProviderConfig(config: AppConfig, providerConfig: LlmProviderConfig): AppConfig {
  return {
    ...config,
    llm: {
      ...config.llm,
      provider: providerConfig.provider,
      baseUrl: providerConfig.baseUrl,
      model: providerConfig.model,
      timeoutMs: providerConfig.timeoutMs,
      apiKey: providerConfig.apiKey,
    },
  };
}

function createSingleLlmClient(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
  providerConfig: LlmProviderConfig,
): LlmClient {
  const scopedConfig = withLlmProviderConfig(config, providerConfig);
  return providerConfig.provider === "openai"
    ? new OpenAIClient(scopedConfig, logger.child({ scope: "openai" }))
    : new OllamaClient(scopedConfig, logger.child({ scope: "ollama" }));
}

function createConfiguredLlmClient(config: AppConfig, logger: ReturnType<typeof createLogger>): LlmClient {
  if (config.llm.provider === "fallback" && config.llm.fallback) {
    const primary = createSingleLlmClient(config, logger, config.llm.fallback.primary);
    const secondary = createSingleLlmClient(config, logger, config.llm.fallback.secondary);
    return new FallbackLlmClient(
      primary,
      secondary,
      logger.child({ scope: "llm-fallback" }),
      {
        primaryLabel: `${config.llm.fallback.primary.provider}:${config.llm.fallback.primary.model}`,
        secondaryLabel: `${config.llm.fallback.secondary.provider}:${config.llm.fallback.secondary.model}`,
      },
    );
  }

  const singleProvider = config.llm.provider === "openai"
    ? config.llm.openai ?? {
        provider: "openai" as const,
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
        apiKey: config.llm.apiKey,
      }
    : config.llm.ollama ?? {
        provider: "ollama" as const,
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
      };
  return createSingleLlmClient(config, logger, singleProvider);
}

export async function createAgentCore() {
  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel);
  const pluginLogger = logger.child({ scope: "plugins" });
  const memory = new OperationalMemoryStore(
    config.paths.memoryDbPath,
    logger.child({ scope: "operational-memory" }),
  );
  const growthOps = new GrowthOpsStore(
    config.paths.growthDbPath,
    logger.child({ scope: "growth-ops" }),
  );
  const preferences = new UserPreferencesStore(
    config.paths.preferencesDbPath,
    logger.child({ scope: "user-preferences" }),
  );
  const personalMemory = new PersonalOperationalMemoryStore(
    config.paths.preferencesDbPath,
    logger.child({ scope: "personal-operational-memory" }),
  );
  const contentOps = new ContentOpsStore(
    config.paths.contentDbPath,
    logger.child({ scope: "content-ops" }),
  );
  const socialAssistant = new SocialAssistantStore(
    config.paths.socialAssistantDbPath,
    logger.child({ scope: "social-assistant" }),
  );
  const contacts = new ContactIntelligenceStore(
    config.paths.contactIntelligenceDbPath,
    logger.child({ scope: "contact-intelligence" }),
  );
  const approvals = new ApprovalInboxStore(
    config.paths.approvalInboxDbPath,
    logger.child({ scope: "approval-inbox" }),
  );
  const clarifications = new ClarificationInboxStore(
    config.paths.clarificationInboxDbPath,
    logger.child({ scope: "clarification-inbox" }),
  );
  const memoryEntities = new MemoryEntityStore(
    config.paths.memoryEntityDbPath,
    logger.child({ scope: "memory-entities" }),
  );
  const entityLinker = new EntityLinker(memoryEntities);
  const approvalPolicy = new ApprovalPolicyService();
  const contextMemory = new ContextMemoryService(
    memoryEntities,
    logger.child({ scope: "context-memory" }),
  );
  const approvalEngine = new ApprovalEngine(
    approvals,
    approvalPolicy,
    logger.child({ scope: "approval-engine" }),
    entityLinker,
  );
  const whatsappMessages = new WhatsAppMessageStore(
    config.paths.whatsappMessagesDbPath,
    logger.child({ scope: "whatsapp-messages" }),
  );
  const communicationRouter = new CommunicationRouter(contacts);
  const workflows = new WorkflowOrchestratorStore(
    config.paths.workflowDbPath,
    logger.child({ scope: "workflow-orchestrator" }),
  );
  const workflowRuntime = new WorkflowExecutionRuntime(
    workflows,
    logger.child({ scope: "workflow-runtime" }),
    entityLinker,
  );
  const macCommandQueue = new SupabaseMacCommandQueue(
    config.supabaseMacQueue,
    logger.child({ scope: "supabase-mac-queue" }),
  );
  const googleAuth = new GoogleWorkspaceAuthService(
    config.google,
    logger.child({ scope: "google-auth" }),
  );
  const googleWorkspace = new GoogleWorkspaceService(
    config.google,
    googleAuth,
    logger.child({ scope: "google-workspace" }),
  );
  const googleWorkspaces = new GoogleWorkspaceAccountsService(
    config.googleAccounts,
    logger.child({ scope: "google-workspace-accounts" }),
  );
  const googleMaps = new GoogleMapsService(
    config.googleMaps,
    logger.child({ scope: "google-maps" }),
  );
  const externalReasoning = new ExternalReasoningClient(
    config.externalReasoning,
    logger.child({ scope: "external-reasoning" }),
  );
  const founderOps = new FounderOpsService(
    config.altiva,
    logger.child({ scope: "founder-ops" }),
  );
  const pexelsMedia = new PexelsMediaService(
    config.media,
    logger.child({ scope: "pexels-media" }),
  );
  const emailAccounts = new EmailAccountsService(
    config.emailAccounts,
    googleWorkspaces,
    logger.child({ scope: "email-accounts" }),
  );
  const personalOs = new PersonalOSService(
    config.google.defaultTimezone,
    logger.child({ scope: "personal-os" }),
    config.briefing,
    googleWorkspaces,
    emailAccounts,
    communicationRouter,
    approvals,
    workflows,
    founderOps,
    memory,
    memoryEntities,
    contextMemory,
    personalMemory,
  );
  const email = emailAccounts.getReader("primary");
  const emailWriter = emailAccounts.getWriter("primary");
  const fileAccess = new FileAccessPolicy(
    config.paths.workspaceDir,
    config.paths.authorizedProjectsDir,
  );
  const projectOps = new ProjectOpsService(
    fileAccess,
    logger.child({ scope: "project-ops" }),
  );
  const safeExec = new SafeExecService(
    config.safeExec,
    fileAccess,
    logger.child({ scope: "safe-exec" }),
  );

  const loadedPlugins = await loadToolPlugins(
    [
      {
        dir: config.paths.pluginsDir,
        origin: "external",
      },
      {
        dir: config.paths.builtInPluginsDir,
        origin: "builtin",
      },
    ],
    pluginLogger,
  );

  const registry = new ToolPluginRegistry(loadedPlugins, logger.child({ scope: "tool-registry" }));
  const capabilityRegistry = new CapabilityRegistry(
    registry,
    createBuiltInCapabilities(),
    createDeclaredCapabilityCatalog(),
    logger.child({ scope: "capability-registry" }),
  );
  const client: LlmClient = createConfiguredLlmClient(config, logger);
  const intentRouter = new IntentRouter();
  const clarificationEngine = new ClarificationEngine(
    clarifications,
    client,
    logger.child({ scope: "clarification-engine" }),
    config.google.defaultTimezone,
    intentRouter,
  );
  const responseOs = new ResponseOS();
  const contextPacks = new ContextPackService(
    personalOs,
    approvals,
    contextMemory,
    logger.child({ scope: "context-pack" }),
  );
  const planBuilder = new WorkflowPlanBuilderService(
    client,
    workflows,
    logger.child({ scope: "plan-builder" }),
  );
  const core = new AgentCore(
    config,
    logger.child({ scope: "agent-core" }),
    fileAccess,
    client,
    capabilityRegistry,
    registry,
    memory,
    preferences,
    personalMemory,
    growthOps,
    contentOps,
    socialAssistant,
    contacts,
    communicationRouter,
    approvals,
    memoryEntities,
    whatsappMessages,
    workflows,
    workflowRuntime,
    entityLinker,
    macCommandQueue,
    email,
    emailWriter,
    emailAccounts,
    googleWorkspace,
    googleWorkspaces,
    googleMaps,
    personalOs,
    intentRouter,
    responseOs,
    contextPacks,
    planBuilder,
    externalReasoning,
    pexelsMedia,
    projectOps,
    safeExec,
  );

  return {
    config,
    logger,
    memory,
    preferences,
    personalMemory,
    contentOps,
    socialAssistant,
    contacts,
    approvals,
    clarifications,
    memoryEntities,
    approvalPolicy,
    approvalEngine,
    clarificationEngine,
    workflowRuntime,
    entityLinker,
    whatsappMessages,
    communicationRouter,
    workflows,
    macCommandQueue,
    email,
    emailWriter,
    emailAccounts,
    loadedPlugins,
    registry,
    capabilityRegistry,
    client,
    core,
    googleAuth,
    googleWorkspace,
    googleWorkspaces,
    googleMaps,
    externalReasoning,
    founderOps,
    personalOs,
    intentRouter,
    planBuilder,
    pexelsMedia,
    growthOps,
    projectOps,
    fileAccess,
    safeExec,
  };
}
