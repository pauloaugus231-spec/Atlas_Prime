import process from "node:process";
import { buildTurnFrame } from "../src/core/routing/turn-understanding-service.js";
import { ServiceSelector } from "../src/core/routing/service-selector.js";
import { buildCapabilityDirectRoutes, buildMemoryAndPreferenceDirectRoutes } from "../src/core/direct-routes/conversation-personal-routes.js";
import { buildOperationalDirectRoutes } from "../src/core/direct-routes/operational-direct-routes.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const noop = async () => null;
const selector = new ServiceSelector();

const routes = [
  ...buildCapabilityDirectRoutes({
    personalProfileShow: noop,
    operationalStateShow: noop,
    learnedPreferencesList: noop,
    learnedPreferencesDelete: noop,
    capabilityInspection: noop,
    activeGoal: noop,
    capabilityPlanning: noop,
  }),
  ...buildMemoryAndPreferenceDirectRoutes({
    personalProfileUpdate: noop,
    personalProfileDelete: noop,
    userPreferences: noop,
    activeGoalsList: noop,
    activeGoalSave: noop,
    activeGoalProgressUpdate: noop,
    activeGoalDelete: noop,
    personalMemoryList: noop,
    personalMemorySave: noop,
    personalMemoryUpdate: noop,
    personalMemoryDelete: noop,
  }),
  ...buildOperationalDirectRoutes({
    commandCenter: noop,
    connectionOverview: noop,
    connectionStart: noop,
    connectionRevoke: noop,
    destinationList: noop,
    destinationSave: noop,
    sharedBriefingPreview: noop,
    deliveryManagement: noop,
    operatorModes: noop,
    selfImprovement: noop,
    lifeManagement: noop,
    missionOs: noop,
    morningBrief: noop,
    operationalPlanning: noop,
    macQueueStatus: noop,
    macQueueList: noop,
    macQueueEnqueue: noop,
    contactList: noop,
    contactUpsert: noop,
    memoryEntityList: noop,
    memoryEntitySearch: noop,
    intentResolve: noop,
  }),
];

function expect(condition: boolean, name: string, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

const results: EvalResult[] = [];

const briefingUpdate = selector.select(buildTurnFrame({ text: "mude meu briefing da manhã para 6h" }), routes);
results.push(expect(
  briefingUpdate?.route.key === "personal_profile_update",
  "selector_prefers_personal_profile_update_for_briefing_update",
  JSON.stringify(briefingUpdate, null, 2),
));

const commandCenter = selector.select(buildTurnFrame({ text: "painel" }), routes);
results.push(expect(
  commandCenter?.route.key === "command_center",
  "selector_prefers_command_center_for_panel_prompt",
  JSON.stringify(commandCenter, null, 2),
));

const connectionStart = selector.select(buildTurnFrame({ text: "conectar google" }), routes);
results.push(expect(
  connectionStart?.route.key === "connection_start",
  "selector_prefers_connection_start_for_google_connect",
  JSON.stringify(connectionStart, null, 2),
));

const ambiguousSummary = selector.select(buildTurnFrame({ text: "me dá um resumo" }), routes);
results.push(expect(
  ambiguousSummary === null,
  "selector_does_not_pick_route_for_ambiguous_summary",
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
  console.log(`\nRouting selector evals ok: ${results.length}/${results.length}`);
}
