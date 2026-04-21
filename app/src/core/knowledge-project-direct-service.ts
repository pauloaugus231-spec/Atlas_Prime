import type { AgentRunResult } from "./agent-core.js";
import { resolveKnowledgeAlias } from "./knowledge-aliases.js";
import { LocalKnowledgeService } from "./local-knowledge.js";
import type { ReadableRootKey, FileAccessPolicy } from "./file-access-policy.js";
import type { ProjectOpsService } from "./project-ops.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";

interface KnowledgeProjectDirectHelpers {
  isInternalKnowledgePrompt: (prompt: string) => boolean;
  extractInternalKnowledgeQuery: (prompt: string) => string;
  buildInternalKnowledgeReply: (input: {
    query: string;
    aliasLabel?: string;
    matches: Array<{
      rootLabel: string;
      relativePath: string;
      snippet: string;
      absolutePath: string;
    }>;
  }) => string;
  isProjectScanPrompt: (prompt: string) => boolean;
  extractProjectRoot: (prompt: string) => ReadableRootKey;
  extractProjectPath: (prompt: string) => string | undefined;
  buildProjectScanReply: (project: Record<string, unknown>, gitStatus?: Record<string, unknown>) => string;
  isMirrorProjectPrompt: (prompt: string) => boolean;
  extractMirrorSourceRoot: (prompt: string) => ReadableRootKey;
  extractMirrorTargetPath: (prompt: string) => string | undefined;
}

interface ProjectOpsLike {
  scanProject: Pick<ProjectOpsService, "scanProject">["scanProject"];
  getGitStatus: Pick<ProjectOpsService, "getGitStatus">["getGitStatus"];
}

export interface KnowledgeProjectDirectServiceDependencies {
  logger: Logger;
  fileAccess: Pick<FileAccessPolicy, "resolveReadablePathFromRoot">;
  projectOps: ProjectOpsLike;
  executeToolDirect: (toolName: string, rawArguments: unknown) => Promise<{
    requestId: string;
    content: string;
    rawResult: unknown;
  }>;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  helpers: KnowledgeProjectDirectHelpers;
}

interface BaseKnowledgeProjectInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
  preferences?: UserPreferences;
}

export class KnowledgeProjectDirectService {
  constructor(private readonly deps: KnowledgeProjectDirectServiceDependencies) {}

  async tryRunInternalKnowledgeLookup(input: BaseKnowledgeProjectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isInternalKnowledgePrompt(input.userPrompt)) {
      return null;
    }

    const query = this.deps.helpers.extractInternalKnowledgeQuery(input.userPrompt);
    if (!query) {
      return null;
    }

    const alias = resolveKnowledgeAlias(query);
    input.requestLogger.info("Using direct internal knowledge route", {
      query,
      alias: alias?.id,
    });

    const localKnowledge = new LocalKnowledgeService(
      this.deps.fileAccess as FileAccessPolicy,
      input.requestLogger.child({ scope: "local-knowledge" }),
    );
    const matches = await localKnowledge.search({
      query,
      alias,
      maxResults: 5,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildInternalKnowledgeReply({
        query,
        aliasLabel: alias?.label,
        matches,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "internal_search",
          resultPreview: JSON.stringify(
            {
              query,
              total: matches.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunProjectScan(input: BaseKnowledgeProjectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isProjectScanPrompt(input.userPrompt)) {
      return null;
    }

    if (!input.orchestration.policy.capabilities.canRunProjectTools) {
      return {
        requestId: input.requestId,
        reply: "A politica atual do dominio nao permite analise de projeto nesta solicitacao.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const root = this.deps.helpers.extractProjectRoot(input.userPrompt);
    const projectPath = this.deps.helpers.extractProjectPath(input.userPrompt) ?? ".";
    input.requestLogger.info("Using direct project scan route", {
      root,
      projectPath,
    });

    const project = await this.deps.projectOps.scanProject({
      root,
      path: projectPath,
    });
    const gitStatus =
      root === "workspace" || root === "authorized_projects" || root === "authorized_dev"
        ? await this.deps.projectOps.getGitStatus(root, projectPath).catch(() => undefined)
        : undefined;

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildProjectScanReply(project, gitStatus),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "scan_project",
          resultPreview: JSON.stringify(
            {
              root,
              project_name: project.project_name,
              absolute_path: project.absolute_path,
            },
            null,
            2,
          ),
        },
        ...(gitStatus
          ? [
              {
                toolName: "project_git_status",
                resultPreview: JSON.stringify(
                  {
                    branch: gitStatus.branch,
                    dirty: gitStatus.dirty,
                  },
                  null,
                  2,
                ),
              },
            ]
          : []),
      ],
    };
  }

  async tryRunProjectMirror(input: BaseKnowledgeProjectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isMirrorProjectPrompt(input.userPrompt)) {
      return null;
    }

    if (!input.orchestration.policy.capabilities.canRunProjectTools) {
      return {
        requestId: input.requestId,
        reply: "A politica atual do dominio nao permite preparar espelhos de projeto nesta solicitacao.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [],
      };
    }

    const root = this.deps.helpers.extractMirrorSourceRoot(input.userPrompt);
    const projectPath = this.deps.helpers.extractProjectPath(input.userPrompt) ?? ".";
    const targetPath = this.deps.helpers.extractMirrorTargetPath(input.userPrompt);
    input.requestLogger.info("Using direct project mirror route", {
      root,
      projectPath,
      targetPath,
    });

    let result: Record<string, unknown>;
    try {
      const execution = await this.deps.executeToolDirect("mirror_project_to_workspace", {
        root,
        path: projectPath,
        ...(targetPath ? { target_path: targetPath } : {}),
        clean: true,
      });
      result = execution.rawResult as Record<string, unknown>;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        requestId: input.requestId,
        reply: [
          "Nao consegui criar o espelho do projeto.",
          `- Root: ${root}`,
          `- Caminho: ${projectPath}`,
          `- Motivo: ${errorMessage}`,
        ].join("\n"),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
        toolExecutions: [
          {
            toolName: "mirror_project_to_workspace",
            resultPreview: JSON.stringify(
              {
                root,
                projectPath,
                error: errorMessage,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return {
      requestId: input.requestId,
      reply: [
        "Espelho criado no workspace.",
        `- Origem: ${String(result.source_absolute_path ?? result.source_path ?? "")}`,
        `- Destino: ${String(result.target_absolute_path ?? result.target_path ?? "")}`,
        "- Pastas pesadas ou geradas foram excluidas do espelho: .git, node_modules, dist, build, .next, .turbo, .wrangler, coverage.",
      ].join("\n"),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, input.preferences),
      toolExecutions: [
        {
          toolName: "mirror_project_to_workspace",
          resultPreview: JSON.stringify(
            {
              root,
              source_path: result.source_path,
              target_path: result.target_path,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
