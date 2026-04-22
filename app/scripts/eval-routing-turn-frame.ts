import process from "node:process";
import { buildTurnFrame } from "../src/core/routing/turn-understanding-service.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function expect(condition: boolean, name: string, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

const results: EvalResult[] = [];

const briefingUpdate = buildTurnFrame({ text: "mude meu briefing da manhã para 6h" });
results.push(expect(
  briefingUpdate.primaryIntent === "briefing.update"
    && briefingUpdate.requestedObject === "briefing"
    && briefingUpdate.requestedOperation === "update",
  "briefing_update_intent_is_structured",
  JSON.stringify(briefingUpdate, null, 2),
));

const commandCenter = buildTurnFrame({ text: "como está minha operação agora?" });
results.push(expect(
  commandCenter.primaryIntent === "command_center.show",
  "command_center_prompt_maps_to_command_center_show",
  JSON.stringify(commandCenter, null, 2),
));

const connectionStart = buildTurnFrame({ text: "conectar google" });
results.push(expect(
  connectionStart.primaryIntent === "connection.start"
    && connectionStart.entities.provider === "google",
  "connection_start_detects_provider",
  JSON.stringify(connectionStart, null, 2),
));

const destinationSave = buildTurnFrame({ text: "cadastre minha equipe no telegram 123456" });
results.push(expect(
  destinationSave.primaryIntent === "destination.save"
    && destinationSave.requestedObject === "destination",
  "destination_save_detected",
  JSON.stringify(destinationSave, null, 2),
));

const ambiguousSummary = buildTurnFrame({ text: "me dá um resumo" });
results.push(expect(
  ambiguousSummary.primaryIntent === "unknown"
    && ambiguousSummary.ambiguities.includes("summary_target"),
  "ambiguous_summary_stays_unknown",
  JSON.stringify(ambiguousSummary, null, 2),
));

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
} else {
  console.log(`\nRouting turn frame evals ok: ${results.length}/${results.length}`);
}
