import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { BrowserTaskStore } from "../src/core/operator-modes/browser-task-store.js";
import { OperatorModeService } from "../src/core/operator-modes/operator-mode-service.js";
import { OperatorModeDirectService } from "../src/core/operator-mode-direct-service.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-operator-modes-"));
  const dbPath = path.join(sandboxDir, "browser-tasks.sqlite");
  const results: EvalResult[] = [];

  try {
    const service = new OperatorModeService(
      new BrowserTaskStore(dbPath, logger),
      { getStatus: () => ({ enabled: true, approvedRoots: ["workspace"] }) },
      {
        scanProject: async () => ({
          project_name: "agente_ai",
          project_types: ["nodejs", "typescript"],
          absolute_path: "/tmp/agente_ai",
        }),
      },
      logger,
    );
    const direct = new OperatorModeDirectService({
      logger,
      operatorModes: service,
      buildBaseMessages: () => [],
    });

    const overview = await service.renderOverview();
    results.push({
      name: "operator_modes_render_overview_from_runtime_status",
      passed: overview.includes("Safe exec: ativo") && overview.includes("Browser tasks abertas: 0"),
      detail: overview,
    });

    const readTask = service.createBrowserTask({
      url: "https://example.com/read",
      intent: "revisar página do cliente",
      sourceChannel: "telegram",
    });
    const writeTask = service.createBrowserTask({
      url: "https://example.com/publish",
      intent: "publicar formulário de aprovação",
      sourceChannel: "telegram",
    });
    results.push({
      name: "operator_modes_classify_browser_tasks_by_risk",
      passed:
        readTask.mode === "read"
        && readTask.requiresApproval === false
        && writeTask.mode === "write"
        && writeTask.requiresApproval === true,
      detail: JSON.stringify({ readTask, writeTask }, null, 2),
    });

    const browserTasks = service.renderBrowserTasks();
    results.push({
      name: "operator_modes_list_browser_tasks",
      passed: browserTasks.includes("revisar página do cliente") && browserTasks.includes("exige aprovação"),
      detail: browserTasks,
    });

    const voice = service.parseVoiceConfirmation("confirmo enviar");
    results.push({
      name: "operator_modes_parse_voice_confirmation",
      passed: voice.includes("aprovação") && voice.includes("send"),
      detail: voice,
    });

    const project = await service.renderProjectOverview();
    results.push({
      name: "operator_modes_render_project_overview",
      passed: project.includes("agente_ai") && project.includes("nodejs, typescript"),
      detail: project,
    });

    const directOverview = await direct.tryRun({
      userPrompt: "modo operador",
      requestId: "operator-direct-1",
      orchestration: {
        route: { primaryDomain: "dev_full_stack", secondaryDomains: [], confidence: 0.9, actionMode: "analyze", reasons: [] },
        policy: {
          riskLevel: "low",
          autonomyLevel: "observe_only",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: false,
            canDraftExternalReplies: false,
            canSendExternalReplies: false,
            canWriteWorkspace: true,
            canPersistMemory: false,
            canRunProjectTools: true,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
    });
    const directTask = await direct.tryRun({
      userPrompt: "crie tarefa de navegador https://example.com revisar a página inicial",
      requestId: "operator-direct-2",
      orchestration: {
        route: { primaryDomain: "dev_full_stack", secondaryDomains: [], confidence: 0.9, actionMode: "execute", reasons: [] },
        policy: {
          riskLevel: "medium",
          autonomyLevel: "draft_with_confirmation",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: false,
            canDraftExternalReplies: false,
            canSendExternalReplies: false,
            canWriteWorkspace: true,
            canPersistMemory: false,
            canRunProjectTools: true,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
    });
    results.push({
      name: "operator_modes_direct_service_supports_natural_prompts",
      passed:
        directOverview?.reply.includes("Modo operador") === true
        && directTask?.reply.includes("Tarefa de navegador criada") === true,
      detail: JSON.stringify({ directOverview, directTask }, null, 2),
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }
  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nOperator modes evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
