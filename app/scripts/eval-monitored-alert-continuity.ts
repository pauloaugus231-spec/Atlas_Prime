import process from "node:process";
import { resolveMonitoredAlertTurnBehavior } from "../src/integrations/telegram/monitored-alert-continuation.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function check(name: string, actual: string, expected: string): EvalResult {
  return {
    name,
    passed: actual === expected,
    detail: `expected=${expected} actual=${actual}`,
  };
}

async function run() {
  const results: EvalResult[] = [];

  results.push(check(
    "pending_alert_plus_agenda_continues",
    resolveMonitoredAlertTurnBehavior("agenda"),
    "continue",
  ));
  results.push(check(
    "pending_alert_plus_sim_continues",
    resolveMonitoredAlertTurnBehavior("sim"),
    "continue",
  ));
  results.push(check(
    "pending_alert_plus_ignora_continues_as_alert_action",
    resolveMonitoredAlertTurnBehavior("ignora"),
    "continue",
  ));
  results.push(check(
    "pending_alert_plus_weather_interrupts",
    resolveMonitoredAlertTurnBehavior("qual o clima hoje?"),
    "interrupt",
  ));
  results.push(check(
    "pending_alert_plus_brief_interrupts",
    resolveMonitoredAlertTurnBehavior("briefing da manhã"),
    "interrupt",
  ));
  results.push(check(
    "pending_alert_plus_plan_day_interrupts",
    resolveMonitoredAlertTurnBehavior("organize meu dia"),
    "interrupt",
  ));
  results.push(check(
    "pending_alert_plus_agenda_request_interrupts",
    resolveMonitoredAlertTurnBehavior("qual minha agenda amanhã?"),
    "interrupt",
  ));
  results.push(check(
    "pending_alert_plus_tasks_request_interrupts",
    resolveMonitoredAlertTurnBehavior("me mostra minhas tarefas"),
    "interrupt",
  ));
  results.push(check(
    "pending_alert_plus_memory_request_interrupts",
    resolveMonitoredAlertTurnBehavior("salva na memória que em plantão quero respostas curtas"),
    "interrupt",
  ));
  results.push(check(
    "without_pending_only_exact_short_vocabulary_would_continue",
    resolveMonitoredAlertTurnBehavior("quero ver o clima"),
    "interrupt",
  ));

  const failures = results.filter((item) => !item.passed);
  for (const item of results) {
    const prefix = item.passed ? "PASS" : "FAIL";
    console.log(`${prefix} ${item.name}${item.detail ? ` :: ${item.detail}` : ""}`);
  }

  if (failures.length > 0) {
    console.error(`\nMonitored alert continuity evals failed: ${failures.length}/${results.length}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nMonitored alert continuity evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
