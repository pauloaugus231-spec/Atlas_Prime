import process from "node:process";
import { IntentRouter } from "../src/core/intent-router.js";
import {
  buildClarificationRuleProposal,
  buildClarifiedExecutionPrompt,
} from "../src/core/clarification-rules.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run() {
  const router = new IntentRouter();
  const results: EvalResult[] = [];

  const operationalIntent = router.resolve("quero revisar aprovações e organizar minha agenda");
  const operationalProposal = buildClarificationRuleProposal(
    "quero revisar aprovações e organizar minha agenda",
    operationalIntent,
  );
  results.push({
    name: "operational_clarification_has_two_precise_questions",
    passed: Boolean(
      operationalProposal
      && operationalProposal.questions.length === 2
      && operationalProposal.questions[0]?.includes("agenda")
      && operationalProposal.questions[1]?.includes("aprovações"),
    ),
    detail: JSON.stringify(operationalProposal, null, 2),
  });

  const operationalExecutionPrompt = buildClarifiedExecutionPrompt(
    "quero revisar aprovações e organizar minha agenda",
    "hoje e priorize as que exigem ação agora",
    operationalIntent,
  );
  results.push({
    name: "operational_clarified_prompt_is_clean",
    passed: Boolean(
      operationalExecutionPrompt
      && operationalExecutionPrompt.includes("Revise as aprovações pendentes")
      && !operationalExecutionPrompt.includes("Pedido original do usuário"),
    ),
    detail: operationalExecutionPrompt ?? "(vazio)",
  });

  const growthIntent = router.resolve("preciso melhorar growth");
  const growthProposal = buildClarificationRuleProposal("preciso melhorar growth", growthIntent);
  results.push({
    name: "growth_clarification_asks_metric_focus",
    passed: Boolean(
      growthProposal
      && growthProposal.questions.length === 1
      && growthProposal.questions[0]?.includes("tráfego")
      && growthProposal.questions[0]?.includes("receita"),
    ),
    detail: JSON.stringify(growthProposal, null, 2),
  });

  const codeIntent = router.resolve("tem algo no código");
  const codeProposal = buildClarificationRuleProposal("tem algo no código", codeIntent);
  results.push({
    name: "code_clarification_asks_work_type",
    passed: Boolean(
      codeProposal
      && codeProposal.questions.length === 1
      && codeProposal.questions[0]?.includes("analise")
      && codeProposal.questions[0]?.includes("refatore"),
    ),
    detail: JSON.stringify(codeProposal, null, 2),
  });

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nClarification evals ok: ${results.length}/${results.length}`);
}

run();
