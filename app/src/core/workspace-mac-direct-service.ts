import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AgentRunResult } from "./agent-core.js";
import type { ReadableRootKey } from "./file-access-policy.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";

interface SafeExecLike {
  execute: (request: {
    argv: string[];
    root: ReadableRootKey;
    path?: string;
  }) => Promise<{
    argv: string[];
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

interface MacQueueLike {
  getStatus: () => {
    enabled: boolean;
    configured: boolean;
    ready: boolean;
    targetHost: string;
    commandsTable: string;
    workersTable: string;
    message: string;
  };
  listPending: (limit?: number) => Promise<Array<{ id: string; summary: string; status: string; createdAt: string }>>;
  enqueueCommand: (input: {
    summary: string;
    argv: string[];
    cwd?: string;
    requestedBy?: string;
  }) => Promise<{ id: string; summary: string; targetHost?: string }>;
}

interface WorkspaceFileAccess {
  describeReadableRoots: () => Record<ReadableRootKey, string>;
}

interface WorkspaceMacDirectHelpers {
  isAllowedSpacesPrompt: (prompt: string) => boolean;
  buildAllowedSpacesReply: (roots: Record<ReadableRootKey, string>) => string;
  extractSafeExecRequest: (prompt: string) => { argv: string[]; root: ReadableRootKey; path?: string } | null;
  buildSafeExecReply: (result: {
    argv: string[];
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }) => string;
  isMacQueueStatusPrompt: (prompt: string) => boolean;
  isMacQueueListPrompt: (prompt: string) => boolean;
  buildMacQueueStatusReply: (input: {
    status: {
      enabled: boolean;
      configured: boolean;
      ready: boolean;
      targetHost: string;
      commandsTable: string;
      workersTable: string;
      message: string;
    };
  }) => string;
  buildMacQueueListReply: (items: Array<{ id: string; summary: string; status: string; createdAt: string }>) => string;
  buildMacQueueEnqueueReply: (input: { id: string; summary: string; targetHost?: string }) => string;
  extractMacOpenApp: (prompt: string) => string | undefined;
  extractMacOpenUrl: (prompt: string) => string | undefined;
  extractMacNotificationText: (prompt: string) => string | undefined;
  extractMacProjectOpenAlias: (prompt: string) => string | undefined;
  extractMacProjectCommand: (prompt: string) => { argv: string[]; projectAlias: string } | undefined;
}

export interface WorkspaceMacDirectServiceDependencies {
  logger: Logger;
  workspaceDir: string;
  authorizedProjectsDir: string;
  fileAccess: WorkspaceFileAccess;
  safeExec: SafeExecLike;
  macCommandQueue: MacQueueLike;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: WorkspaceMacDirectHelpers;
}

interface WorkspaceMacDirectInput {
  userPrompt: string;
  requestId: string;
  orchestration: OrchestrationContext;
  requestLogger?: Logger;
  preferences?: UserPreferences;
}

function normalizeAliasToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s._/-]+/g, "");
}

export class WorkspaceMacDirectService {
  constructor(private readonly deps: WorkspaceMacDirectServiceDependencies) {}

  tryRunAllowedSpaces(input: WorkspaceMacDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isAllowedSpacesPrompt(input.userPrompt)) {
      return null;
    }

    const roots = this.deps.fileAccess.describeReadableRoots();
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildAllowedSpacesReply(roots),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "list_allowed_spaces",
          resultPreview: JSON.stringify(roots, null, 2),
        },
      ],
    };
  }

  async tryRunSafeExec(input: WorkspaceMacDirectInput & { requestLogger: Logger }): Promise<AgentRunResult | null> {
    const request = this.deps.helpers.extractSafeExecRequest(input.userPrompt);
    if (!request) {
      return null;
    }

    if (!input.orchestration.policy.capabilities.canRunProjectTools) {
      return {
        requestId: input.requestId,
        reply: "A politica atual do dominio nao permite execucao tecnica nesta solicitacao.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    input.requestLogger.info("Using direct safe exec route", {
      argv: request.argv,
      root: request.root,
      path: request.path,
    });

    try {
      const result = await this.deps.safeExec.execute(request);
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildSafeExecReply(result),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "safe_exec",
            resultPreview: JSON.stringify(
              {
                argv: result.argv,
                cwd: result.cwd,
                exitCode: result.exitCode,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        requestId: input.requestId,
        reply: [
          "Execucao bloqueada ou falhou.",
          `- Comando: ${request.argv.join(" ")}`,
          `- Root: ${request.root}`,
          `- Caminho: ${request.path ?? "."}`,
          `- Motivo: ${errorMessage}`,
          "",
          "Se este comando precisa escrever em disco, primeiro espelhe o projeto para o workspace e execute la.",
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "safe_exec",
            resultPreview: JSON.stringify(
              {
                argv: request.argv,
                root: request.root,
                path: request.path,
                error: errorMessage,
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  }

  tryRunMacQueueStatus(input: WorkspaceMacDirectInput): AgentRunResult | null {
    if (!this.deps.helpers.isMacQueueStatusPrompt(input.userPrompt)) {
      return null;
    }

    const status = this.deps.macCommandQueue.getStatus();
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMacQueueStatusReply({ status }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "mac_queue_status",
          resultPreview: JSON.stringify(status, null, 2),
        },
      ],
    };
  }

  async tryRunMacQueueList(input: WorkspaceMacDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isMacQueueListPrompt(input.userPrompt)) {
      return null;
    }

    const status = this.deps.macCommandQueue.getStatus();
    if (!status.ready) {
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildMacQueueStatusReply({ status }),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const items = await this.deps.macCommandQueue.listPending(10);
    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMacQueueListReply(items),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "mac_queue_list",
          resultPreview: JSON.stringify({ count: items.length }, null, 2),
        },
      ],
    };
  }

  async tryRunMacQueueEnqueue(input: WorkspaceMacDirectInput): Promise<AgentRunResult | null> {
    const status = this.deps.macCommandQueue.getStatus();
    const intent = this.buildMacQueueIntent(input.userPrompt);
    if (!intent) {
      return null;
    }

    if (!status.ready) {
      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildMacQueueStatusReply({ status }),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const command = await this.deps.macCommandQueue.enqueueCommand({
      summary: intent.summary,
      argv: intent.argv,
      cwd: intent.cwd,
      requestedBy: "atlas",
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildMacQueueEnqueueReply({
        id: command.id,
        summary: command.summary,
        targetHost: command.targetHost,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "mac_queue_enqueue",
          resultPreview: JSON.stringify(
            {
              id: command.id,
              summary: command.summary,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private buildMacQueueIntent(userPrompt: string):
    | {
        summary: string;
        argv: string[];
        cwd?: string;
      }
    | undefined {
    const appName = this.deps.helpers.extractMacOpenApp(userPrompt);
    if (appName) {
      return {
        summary: `Abrir app no Mac: ${appName}`,
        argv: ["open", "-a", appName],
      };
    }

    const url = this.deps.helpers.extractMacOpenUrl(userPrompt);
    if (url) {
      return {
        summary: `Abrir URL no Mac: ${url}`,
        argv: ["open", url],
      };
    }

    const notificationText = this.deps.helpers.extractMacNotificationText(userPrompt);
    if (notificationText) {
      return {
        summary: `Notificação local no Mac: ${notificationText.slice(0, 60)}`,
        argv: [
          "osascript",
          "-e",
          `display notification "${notificationText.replace(/"/g, '\\"')}" with title "Atlas Prime"`,
        ],
      };
    }

    const projectAlias = this.deps.helpers.extractMacProjectOpenAlias(userPrompt);
    if (projectAlias) {
      const projectPath = this.resolveHostProjectPath(projectAlias);
      if (projectPath) {
        return {
          summary: `Abrir projeto no VS Code: ${projectAlias}`,
          argv: ["code", "-r", projectPath],
          cwd: projectPath,
        };
      }
    }

    const projectCommand = this.deps.helpers.extractMacProjectCommand(userPrompt);
    if (projectCommand) {
      const projectPath = this.resolveHostProjectPath(projectCommand.projectAlias);
      if (projectPath) {
        return {
          summary: `Executar ${projectCommand.argv.join(" ")} no projeto ${projectCommand.projectAlias}`,
          argv: projectCommand.argv,
          cwd: projectPath,
        };
      }
    }

    return undefined;
  }

  private resolveHostProjectPath(alias: string): string | undefined {
    const normalizedAlias = normalizeAliasToken(alias);
    const documentsRoot = process.env.HOST_USER_DOCUMENTS_DIR?.trim();
    const authorizedProjectsRoot = this.deps.authorizedProjectsDir;
    const roots = [
      documentsRoot,
      this.deps.workspaceDir,
      authorizedProjectsRoot,
      path.join(authorizedProjectsRoot, "Dev"),
      path.join(authorizedProjectsRoot, "Social"),
      path.join(authorizedProjectsRoot, "Conteudo"),
      path.join(authorizedProjectsRoot, "Financeiro"),
      path.join(authorizedProjectsRoot, "Admin"),
    ].filter((value): value is string => Boolean(value));

    for (const root of roots) {
      const direct = path.resolve(root, alias);
      if (existsSync(direct)) {
        return direct;
      }
      if (!existsSync(root)) {
        continue;
      }
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory() && normalizeAliasToken(entry.name) === normalizedAlias) {
          return path.join(root, entry.name);
        }
      }
    }

    return undefined;
  }
}
