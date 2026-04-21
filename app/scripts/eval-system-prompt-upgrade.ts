import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DecisionsLoader } from "../src/core/decisions-loader.js";
import { FileAccessPolicy } from "../src/core/file-access-policy.js";
import { GoalStore } from "../src/core/goal-store.js";
import { buildSystemPrompt, setSystemPromptContextProvider } from "../src/core/system-prompt.js";
import { createLogger } from "../src/utils/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function assert(name: string, condition: boolean, detail?: string): EvalResult {
  return {
    name,
    passed: condition,
    detail,
  };
}

async function run(): Promise<void> {
  const logger = createLogger("error");
  const results: EvalResult[] = [];

  setSystemPromptContextProvider(undefined);

  const basePrompt = buildSystemPrompt();
  results.push(assert(
    "system_prompt_without_context_includes_structured_reasoning",
    basePrompt.includes("Antes de responder qualquer pergunta técnica, estratégica ou operacional"),
    basePrompt,
  ));

  const promptWithGoal = buildSystemPrompt({
    goalSummary: "Objetivos: (1) Fechar 2 clientes SaaS — receita, prazo: 2026-05-31, 30%",
  });
  results.push(assert(
    "system_prompt_includes_goal_summary",
    promptWithGoal.includes("Objetivos ativos do usuário: Objetivos: (1) Fechar 2 clientes SaaS"),
    promptWithGoal,
  ));

  const promptWithDecisions = buildSystemPrompt({
    recentDecisions: "(1) 2026-04-21 — Services de conteúdo e registry",
  });
  results.push(assert(
    "system_prompt_includes_recent_decisions",
    promptWithDecisions.includes("Histórico de decisões do projeto: (1) 2026-04-21 — Services de conteúdo e registry"),
    promptWithDecisions,
  ));

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-system-prompt-upgrade-"));

  try {
    const goalDbPath = path.join(tempRoot, "state", "goals.sqlite");
    const goalStore = new GoalStore(goalDbPath, logger);
    const savedGoal = goalStore.upsert({
      title: "Fechar 2 clientes SaaS",
      description: "Avançar pipeline comercial desta semana",
      metric: "2 contratos fechados",
      deadline: "2026-05-31",
      progress: 0.3,
      domain: "revenue",
    });
    const goalSummary = goalStore.summarize();
    results.push(assert(
      "goal_store_upsert_and_summarize_work",
      savedGoal.id.length > 0
        && goalStore.list().length === 1
        && goalSummary.includes("Fechar 2 clientes SaaS")
        && goalSummary.includes("receita")
        && goalSummary.includes("30%"),
      JSON.stringify({ savedGoal, goalSummary }, null, 2),
    ));

    const workspaceDir = path.join(tempRoot, "workspace");
    const authorizedProjectsDir = path.join(tempRoot, "authorized_projects");
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(authorizedProjectsDir, { recursive: true });

    const fileAccess = new FileAccessPolicy(workspaceDir, authorizedProjectsDir);
    const missingLoader = new DecisionsLoader(
      fileAccess,
      logger,
      path.join(tempRoot, "DECISIONS-missing.md"),
    );
    const missingDecisions = await missingLoader.load();
    results.push(assert(
      "decisions_loader_returns_undefined_when_file_is_missing",
      missingDecisions === undefined,
      JSON.stringify({ missingDecisions }),
    ));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    for (const item of failed) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
    }
    process.exit(1);
  }

  console.log(`\nSystem prompt upgrade evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
