import process from "node:process";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  const scanCalls: Array<{ root: string; path?: string }> = [];
  const mirrorCalls: Array<{ toolName: string; rawArguments: unknown }> = [];

  const roots = {
    authorized_dev: path.join(tempRoot, "Dev"),
    authorized_social: path.join(tempRoot, "Social"),
    authorized_content: path.join(tempRoot, "Conteudo"),
  } as const;

  for (const dir of Object.values(roots)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
    path.join(roots.authorized_dev, "atlas-notes.md"),
    [
      "# Atlas Prime",
      "O Atlas Prime usa capability planner, monitoramento e agenda local.",
      "Este projeto tem suporte a Telegram e fluxo de projeto interno.",
    ].join("\n"),
    "utf8",
  );

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).fileAccess = {
    resolveReadablePathFromRoot: (root: string, targetPath = ".") => {
      const base = (roots as Record<string, string>)[root];
      if (!base) {
        throw new Error(`Unknown root: ${root}`);
      }
      return path.resolve(base, targetPath);
    },
  };
  (core as any).projectOps = {
    scanProject: async (input: { root: string; path?: string }) => {
      scanCalls.push(input);
      return {
        root: input.root,
        requested_path: input.path ?? ".",
        absolute_path: `/virtual/${input.root}/${input.path ?? "."}`,
        project_name: "atlas-prime",
        project_types: ["nodejs", "typescript"],
        root_files: ["package.json", "tsconfig.json"],
        root_directories: ["src", "scripts"],
        scripts: ["build", "typecheck"],
        dependencies: ["typescript", "tsx"],
      };
    },
    getGitStatus: async () => ({
      branch: "main",
      dirty: true,
      status_lines: [" M src/core/agent-core.ts"],
    }),
  };
  (core as any).executeToolDirect = async (toolName: string, rawArguments: unknown) => {
    mirrorCalls.push({ toolName, rawArguments });
    return {
      requestId: "req-mirror",
      content: "ok",
      rawResult: {
        source_path: "Atlas_Prime",
        target_path: "workspace/atlas-prime",
        source_absolute_path: "/authorized/Atlas_Prime",
        target_absolute_path: "/workspace/atlas-prime",
      },
    };
  };

  return { core, scanCalls, mirrorCalls };
}

async function run(): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-phase12-"));
  const results: EvalResult[] = [];
  try {
    const { core, scanCalls, mirrorCalls } = buildCoreStub(tempRoot);
    const logger = makeLogger();

    {
      const result = await (core as any).tryRunDirectInternalKnowledgeLookup(
        "pesquise internamente Atlas Prime capability planner",
        "req-phase12-knowledge",
        logger,
        buildOrchestration(),
      );

      results.push(assert(
        "agent_core_internal_knowledge_wrapper_uses_extracted_service",
        Boolean(
          result?.reply?.includes("Busca interna para: Atlas Prime capability planner") &&
          result.reply.includes("atlas-notes.md") &&
          result.toolExecutions[0]?.toolName === "internal_search",
        ),
        result?.reply,
      ));
    }

    {
      const result = await (core as any).tryRunDirectProjectScan(
        'analise o projeto "Atlas_Prime" em projetos autorizados',
        "req-phase12-project-scan",
        logger,
        buildOrchestration(true),
      );

      results.push(assert(
        "agent_core_project_scan_wrapper_uses_extracted_service",
        Boolean(
          result?.reply?.includes("Resumo do projeto: atlas-prime") &&
          result.reply.includes("Git branch: main") &&
          scanCalls.length === 1 &&
          scanCalls[0]?.root === "authorized_projects" &&
          result.toolExecutions.some((item: { toolName: string }) => item.toolName === "scan_project") &&
          result.toolExecutions.some((item: { toolName: string }) => item.toolName === "project_git_status"),
        ),
        result?.reply,
      ));
    }

    {
      const result = await (core as any).tryRunDirectProjectMirror(
        'espelhe o projeto "Atlas_Prime" em projetos autorizados para workspace/atlas-prime',
        "req-phase12-project-mirror",
        logger,
        buildOrchestration(true),
      );

      results.push(assert(
        "agent_core_project_mirror_wrapper_uses_extracted_service",
        Boolean(
          result?.reply?.includes("Espelho criado no workspace.") &&
          result.reply.includes("/workspace/atlas-prime") &&
          mirrorCalls.length === 1 &&
          mirrorCalls[0]?.toolName === "mirror_project_to_workspace" &&
          result.toolExecutions[0]?.toolName === "mirror_project_to_workspace",
        ),
        result?.reply,
      ));
    }

    {
      const result = await (core as any).tryRunDirectProjectScan(
        'analise o projeto "Atlas_Prime" em projetos autorizados',
        "req-phase12-project-scan-blocked",
        logger,
        buildOrchestration(false),
      );

      results.push(assert(
        "agent_core_project_scan_wrapper_preserves_policy_blocking_in_service",
        Boolean(
          result?.reply === "A politica atual do dominio nao permite analise de projeto nesta solicitacao." &&
          result.toolExecutions.length === 0,
        ),
        result?.reply,
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
  console.error("eval-agent-core-phase12 failed", error);
  process.exitCode = 1;
});
