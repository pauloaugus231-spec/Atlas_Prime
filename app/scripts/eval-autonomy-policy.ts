import process from "node:process";
import { IntentRouter } from "../src/core/intent-router.js";
import { resolveActionAutonomyRule } from "../src/core/action-autonomy-policy.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function run() {
  const router = new IntentRouter();
  const results: EvalResult[] = [];

  const agendaIntent = router.resolve("qual minha agenda para amanhã?");
  const agendaRule = resolveActionAutonomyRule("qual minha agenda para amanhã?", agendaIntent);
  results.push({
    name: "agenda_simple_read_is_high_autonomy",
    passed: agendaRule.requirement === "autonomous_read" && agendaRule.key === "calendar.read.simple",
    detail: JSON.stringify(agendaRule, null, 2),
  });

  const briefIntent = router.resolve("gere meu briefing da manhã");
  const briefRule = resolveActionAutonomyRule("gere meu briefing da manhã", briefIntent);
  results.push({
    name: "brief_is_high_autonomy",
    passed: briefRule.requirement === "autonomous_read",
    detail: JSON.stringify(briefRule, null, 2),
  });

  const planIntent = router.resolve("organize meu dia");
  const planRule = resolveActionAutonomyRule("organize meu dia", planIntent);
  results.push({
    name: "day_planning_can_use_provider_or_local",
    passed: planRule.requirement === "provider_or_local",
    detail: JSON.stringify(planRule, null, 2),
  });

  const createEventIntent = router.resolve("agende uma reunião amanhã às 14h");
  const createEventRule = resolveActionAutonomyRule("agende uma reunião amanhã às 14h", createEventIntent);
  results.push({
    name: "calendar_create_requires_short_confirmation",
    passed: createEventRule.requirement === "short_confirmation",
    detail: JSON.stringify(createEventRule, null, 2),
  });

  const deleteTaskIntent = router.resolve("exclua a tarefa revisar agenda");
  const deleteTaskRule = resolveActionAutonomyRule("exclua a tarefa revisar agenda", deleteTaskIntent);
  results.push({
    name: "task_delete_requires_strong_confirmation",
    passed: deleteTaskRule.requirement === "strong_confirmation",
    detail: JSON.stringify(deleteTaskRule, null, 2),
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

  console.log(`\nAutonomy policy evals ok: ${results.length}/${results.length}`);
}

run();
