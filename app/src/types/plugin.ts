import type { AppConfig } from "./config.js";
import type { JsonSchema } from "./json-schema.js";
import type { Logger } from "./logger.js";
import type { FileAccessPolicy } from "../core/file-access-policy.js";
import type { EmailReader } from "../integrations/email/email-reader.js";
import type { EmailWriter } from "../integrations/email/email-writer.js";
import type { EmailAccountsService } from "../integrations/email/email-accounts.js";
import type { OperationalMemoryStore } from "../core/operational-memory.js";
import type { OrchestrationContext } from "./orchestration.js";
import type { GoogleWorkspaceService } from "../integrations/google/google-workspace.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";
import type { GrowthOpsStore } from "../core/growth-ops.js";
import type { ContentOpsStore } from "../core/content-ops.js";
import type { SocialAssistantStore } from "../core/social-assistant.js";
import type { ProjectOpsService } from "../core/project-ops.js";
import type { SafeExecService } from "../core/safe-exec.js";
import type { UserPreferencesStore } from "../core/user-preferences.js";
import type { WorkflowOrchestratorStore } from "../core/workflow-orchestrator.js";
import type { PersonalOperationalMemoryStore } from "../core/personal-operational-memory.js";

export type ToolPluginResult =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | unknown[]
  | undefined;

export interface ToolExecutionContext {
  requestId: string;
  toolCallId: string;
  config: AppConfig;
  logger: Logger;
  fileAccess: FileAccessPolicy;
  memory: OperationalMemoryStore;
  email: EmailReader;
  emailWriter: EmailWriter;
  emailAccounts: EmailAccountsService;
  googleWorkspace: GoogleWorkspaceService;
  googleWorkspaces: GoogleWorkspaceAccountsService;
  growthOps: GrowthOpsStore;
  contentOps: ContentOpsStore;
  socialAssistant: SocialAssistantStore;
  projectOps: ProjectOpsService;
  safeExec: SafeExecService;
  preferences: UserPreferencesStore;
  personalMemory: PersonalOperationalMemoryStore;
  workflows: WorkflowOrchestratorStore;
  orchestration: OrchestrationContext;
}

export interface ToolPluginDefinition<TParameters = Record<string, unknown>> {
  kind: "tool";
  name: string;
  description: string;
  parameters: JsonSchema;
  exposeToModel?: boolean;
  execute(
    parameters: TParameters,
    context: ToolExecutionContext,
  ): Promise<ToolPluginResult> | ToolPluginResult;
}

export interface LoadedToolPlugin<TParameters = Record<string, unknown>> {
  plugin: ToolPluginDefinition<TParameters>;
  sourcePath: string;
  origin: "builtin" | "external";
}

export function defineToolPlugin<TParameters = Record<string, unknown>>(
  plugin: Omit<ToolPluginDefinition<TParameters>, "kind">,
): ToolPluginDefinition<TParameters> {
  return {
    kind: "tool",
    ...plugin,
  };
}
