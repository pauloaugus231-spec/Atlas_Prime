import process from "node:process";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function buildOrchestration(canRunProjectTools = true): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.9,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildCoreStub(tempRoot: string) {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const workspaceDir = path.join(tempRoot, "workspace");
  const authorizedProjectsDir = path.join(tempRoot, "authorized-projects");
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(authorizedProjectsDir, { recursive: true });
  mkdirSync(path.join(authorizedProjectsDir, "Dev", "Atlas_Prime"), { recursive: true });

  const scanCalls: Array<{ root: string; path?: string }> = [];
  const safeExecCalls: Array<{ argv: string[]; root: string; path?: string }> = [];
  const macQueueEnqueued: Array<{ summary: string; argv: string[]; cwd?: string; requestedBy?: string }> = [];

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
    paths: {
      workspaceDir,
      authorizedProjectsDir,
    },
  };
  (core as any).fileAccess = {
    describeReadableRoots: () => ({
      workspace: workspaceDir,
      authorized_projects: authorizedProjectsDir,
      authorized_dev: path.join(authorizedProjectsDir, "Dev"),
      authorized_social: path.join(authorizedProjectsDir, "Social"),
      authorized_content: path.join(authorizedProjectsDir, "Conteudo"),
      authorized_finance: path.join(authorizedProjectsDir, "Financeiro"),
      authorized_admin: path.join(authorizedProjectsDir, "Admin"),
    }),
    resolveReadablePathFromRoot: (root: string, targetPath = ".") => {
      const roots: Record<string, string> = {
        workspace: workspaceDir,
        authorized_projects: authorizedProjectsDir,
        authorized_dev: path.join(authorizedProjectsDir, "Dev"),
        authorized_social: path.join(authorizedProjectsDir, "Social"),
        authorized_content: path.join(authorizedProjectsDir, "Conteudo"),
        authorized_finance: path.join(authorizedProjectsDir, "Financeiro"),
        authorized_admin: path.join(authorizedProjectsDir, "Admin"),
      };
      return path.resolve(roots[root], targetPath);
    },
  };
  (core as any).projectOps = {
    scanProject: async (input: { root: string; path?: string }) => {
      scanCalls.push(input);
      return {
        root: input.root,
        absolute_path: `/virtual/${input.root}/${input.path ?? "."}`,
        project_name: "atlas-prime",
        project_types: ["nodejs"],
        root_directories: ["src"],
        root_files: ["package.json"],
        scripts: ["build"],
        dependencies: ["typescript"],
      };
    },
    getGitStatus: async () => ({
      branch: "main",
      dirty: false,
      status_lines: [],
    }),
  };
  (core as any).safeExec = {
    execute: async (request: { argv: string[]; root: string; path?: string }) => {
      safeExecCalls.push(request);
      return {
        argv: request.argv,
        cwd: `/virtual/${request.root}/${request.path ?? "."}`,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      };
    },
  };
  (core as any).macCommandQueue = {
    getStatus: () => ({
      enabled: true,
      configured: true,
      ready: true,
      targetHost: "atlas_mac",
      commandsTable: "mac_commands",
      workersTable: "mac_workers",
      message: "Fila remota do Mac pronta.",
    }),
    listPending: async () => [
      {
        id: "cmd-1",
        summary: "Abrir projeto no VS Code: Atlas_Prime",
        status: "pending",
        createdAt: "2026-04-20T12:00:00.000Z",
      },
    ],
    enqueueCommand: async (input: { summary: string; argv: string[]; cwd?: string; requestedBy?: string }) => {
      macQueueEnqueued.push(input);
      return {
        id: "cmd-2",
        summary: input.summary,
        targetHost: "atlas_mac",
      };
    },
  };

  return { core, scanCalls, safeExecCalls, macQueueEnqueued, workspaceDir, authorizedProjectsDir };
}

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-phase13-"));
  const results: EvalResult[] = [];
  try {
    const { core, scanCalls, safeExecCalls, macQueueEnqueued, workspaceDir, authorizedProjectsDir } = buildCoreStub(tempRoot);
    const logger = makeLogger();

    {
      const result = await (core as any).tryRunDirectProjectScan(
        'analise o projeto "Atlas_Prime" em projetos autorizados',
        "req-phase13-project-path",
        logger,
        buildOrchestration(true),
      );

      results.push(assert(
        "project_path_parser_stops_before_root_hint",
        Boolean(
          result?.reply?.includes("Resumo do projeto: atlas-prime") &&
          scanCalls[0]?.path === "Atlas_Prime",
        ),
        JSON.stringify(scanCalls[0]),
      ));
    }

    {
      const result = await (core as any).tryRunDirectAllowedSpaces(
        "quais espacos eu posso ler?",
        "req-phase13-allowed-spaces",
        buildOrchestration(true),
      );

      results.push(assert(
        "agent_core_allowed_spaces_wrapper_uses_workspace_mac_service",
        Boolean(
          result?.reply?.includes(workspaceDir) &&
          result.reply.includes(authorizedProjectsDir) &&
          result.toolExecutions[0]?.toolName === "list_allowed_spaces",
        ),
        result?.reply,
      ));
    }

    {
      const result = await (core as any).tryRunDirectSafeExec(
        'rode git status no projeto "Atlas_Prime" em projetos autorizados',
        "req-phase13-safe-exec",
        logger,
        buildOrchestration(true),
      );

      results.push(assert(
        "agent_core_safe_exec_wrapper_uses_workspace_mac_service_and_clean_path",
        Boolean(
          result?.reply?.includes("Comando executado: git status --short") &&
          safeExecCalls.length === 1 &&
          safeExecCalls[0]?.root === "authorized_projects" &&
          safeExecCalls[0]?.path === "Atlas_Prime" &&
          result.toolExecutions[0]?.toolName === "safe_exec",
        ),
        JSON.stringify(safeExecCalls[0]),
      ));
    }

    {
      const result = await (core as any).tryRunDirectMacQueueStatus(
        "como está a fila do mac?",
        "req-phase13-mac-status",
        buildOrchestration(true),
      );

      results.push(assert(
        "agent_core_mac_queue_status_wrapper_uses_workspace_mac_service",
        Boolean(
          result?.reply?.includes("Status da fila remota do Mac:") &&
          result.reply.includes("Pronta: sim") &&
          result.toolExecutions[0]?.toolName === "mac_queue_status",
        ),
        result?.reply,
      ));
    }

    {
      const result = await (core as any).tryRunDirectMacQueueEnqueue(
        "abra o projeto Atlas Prime no meu mac",
        "req-phase13-mac-enqueue",
        buildOrchestration(true),
      );

      const expectedPath = path.join(authorizedProjectsDir, "Dev", "Atlas_Prime");
      results.push(assert(
        "agent_core_mac_queue_enqueue_wrapper_uses_workspace_mac_service_and_resolves_project_alias",
        Boolean(
          result?.reply?.includes("Comando enfileirado para o Mac.") &&
          macQueueEnqueued.length === 1 &&
          macQueueEnqueued[0]?.argv?.[0] === "code" &&
          macQueueEnqueued[0]?.cwd === expectedPath &&
          result.toolExecutions[0]?.toolName === "mac_queue_enqueue",
        ),
        JSON.stringify(macQueueEnqueued[0]),
      ));
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase13 failed", error);
  process.exitCode = 1;
});
