import { randomUUID } from "node:crypto";
import type { AppConfig } from "../types/config.js";
import type { Logger } from "../types/logger.js";
import type { EmailReader } from "../integrations/email/email-reader.js";
import type { EmailWriter } from "../integrations/email/email-writer.js";
import type { EmailAccountsService } from "../integrations/email/email-accounts.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import type { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import { buildOrchestrationContext } from "./orchestration.js";
import type { FileAccessPolicy } from "./file-access-policy.js";
import type { OperationalMemoryStore } from "./operational-memory.js";
import type { UserPreferencesStore } from "./user-preferences.js";
import type { PersonalOperationalMemoryStore } from "./personal-operational-memory.js";
import type { GrowthOpsStore } from "./growth-ops.js";
import type { ContentOpsStore } from "./content-ops.js";
import type { SocialAssistantStore } from "./social-assistant.js";
import type { WorkflowOrchestratorStore } from "./workflow-orchestrator.js";
import type { ProjectOpsService } from "./project-ops.js";
import type { SafeExecService } from "./safe-exec.js";
import type { ToolPluginRegistry } from "./plugin-registry.js";
import type { ExecuteSynthesizedToolInput } from "./response-synthesizer.js";

export interface ToolExecutionServiceDependencies {
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
}

export class ToolExecutionService {
  constructor(private readonly deps: ToolExecutionServiceDependencies) {}

  async executeSynthesizedTool(input: ExecuteSynthesizedToolInput): Promise<{
    content: string;
    rawResult?: unknown;
  }> {
    return this.deps.pluginRegistry.execute(input.toolName, input.rawArguments, {
      requestId: input.requestId,
      toolCallId: input.toolCallId,
      config: this.deps.config,
      logger: input.requestLogger,
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
    const requestLogger = this.deps.logger.child({ requestId, tool: toolName, toolCallId, direct: true });
    const execution = await this.deps.pluginRegistry.execute(toolName, rawArguments, {
      requestId,
      toolCallId,
      config: this.deps.config,
      logger: requestLogger,
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

    return {
      requestId,
      content: execution.content,
      rawResult: execution.rawResult,
    };
  }
}
