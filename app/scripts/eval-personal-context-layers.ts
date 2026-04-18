import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import getOperationalStatePlugin from "../src/plugins/get_operational_state.plugin.js";
import updateOperationalStatePlugin from "../src/plugins/update_operational_state.plugin.js";
import listLearnedPreferencesPlugin from "../src/plugins/list_learned_preferences.plugin.js";
import saveLearnedPreferencePlugin from "../src/plugins/save_learned_preference.plugin.js";
import deactivateLearnedPreferencePlugin from "../src/plugins/deactivate_learned_preference.plugin.js";
import getPersonalOperationalProfilePlugin from "../src/plugins/get_personal_operational_profile.plugin.js";
import updatePersonalOperationalProfilePlugin from "../src/plugins/update_personal_operational_profile.plugin.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import {
  selectRelevantLearnedPreferences,
  summarizeIdentityProfileForReasoning,
  summarizeOperationalStateForReasoning,
} from "../src/core/personal-context-summary.js";
import type { Logger } from "../src/types/logger.js";
import type { ToolExecutionContext } from "../src/types/plugin.js";

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

function buildContext(personalMemory: PersonalOperationalMemoryStore): ToolExecutionContext {
  return {
    personalMemory,
  } as unknown as ToolExecutionContext;
}

async function run() {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-personal-context-"));
  const dbPath = path.join(sandboxDir, "personal-context.sqlite");
  const store = new PersonalOperationalMemoryStore(dbPath, logger);
  const context = buildContext(store);
  const results: EvalResult[] = [];

  try {
    const baseProfile = await getPersonalOperationalProfilePlugin.execute({}, context) as Record<string, unknown>;
    const baseProfileRecord = baseProfile.profile as Record<string, unknown> | undefined;
    results.push({
      name: "identity_profile_defaults_are_available",
      passed:
        baseProfile.ok === true
        && typeof baseProfileRecord?.displayName === "string"
        && typeof baseProfileRecord?.primaryRole === "string"
        && typeof baseProfileRecord?.timezone === "string",
      detail: JSON.stringify(baseProfile, null, 2),
    });

    const updatedProfile = await updatePersonalOperationalProfilePlugin.execute({
      displayName: "Paulo",
      primaryRole: "assistente social operacional",
      preferredChannels: ["telegram", "whatsapp"],
      preferredAlertChannel: "telegram",
      priorityAreas: ["agenda", "deslocamento"],
      briefingPreference: "curto",
      detailLevel: "resumo",
    }, context) as Record<string, unknown>;
    const updatedProfileRecord = updatedProfile.profile as Record<string, unknown> | undefined;
    results.push({
      name: "identity_profile_updates_durable_preferences",
      passed:
        updatedProfile.ok === true
        && updatedProfileRecord?.displayName === "Paulo"
        && updatedProfileRecord?.primaryRole === "assistente social operacional"
        && Array.isArray(updatedProfileRecord?.preferredChannels),
      detail: JSON.stringify(updatedProfile, null, 2),
    });

    const updatedState = await updateOperationalStatePlugin.execute({
      mode: "field",
      modeReason: "plantão externo",
      focus: ["resolver conflitos"],
      weeklyPriorities: ["agenda da abordagem"],
      pendingAlerts: ["mensagem monitorada do institucional"],
      criticalTasks: ["confirmar reunião do CREAS"],
      primaryRisk: "conflito de agenda",
      pendingApprovals: 3,
      briefing: {
        nextAction: "organizar deslocamento",
        overloadLevel: "moderado",
      },
    }, context) as Record<string, unknown>;
    const stateRecord = updatedState.state as Record<string, unknown> | undefined;
    results.push({
      name: "operational_state_updates_current_context",
      passed:
        updatedState.ok === true
        && stateRecord?.mode === "field"
        && Array.isArray(stateRecord?.focus)
        && stateRecord?.pendingApprovals === 3,
      detail: JSON.stringify(updatedState, null, 2),
    });

    const learnedFirst = await saveLearnedPreferencePlugin.execute({
      type: "schedule_import_mode",
      key: "default_mode",
      description: "Modo preferido na importação de agenda por imagem/PDF",
      value: "self_plus_structural",
      source: "confirmation",
    }, context) as Record<string, unknown>;
    const learnedSecond = await saveLearnedPreferencePlugin.execute({
      type: "schedule_import_mode",
      key: "default_mode",
      description: "Modo preferido na importação de agenda por imagem/PDF",
      value: "self_plus_structural",
      source: "confirmation",
    }, context) as Record<string, unknown>;
    const learnedItem = learnedSecond.item as Record<string, unknown> | undefined;
    results.push({
      name: "learned_preference_records_and_accumulates_confirmations",
      passed:
        learnedFirst.ok === true
        && learnedSecond.ok === true
        && typeof learnedItem?.confirmations === "number"
        && Number(learnedItem.confirmations) >= 2,
      detail: JSON.stringify(learnedSecond, null, 2),
    });

    const listedLearned = await listLearnedPreferencesPlugin.execute({
      type: "schedule_import_mode",
      limit: 5,
    }, context) as Record<string, unknown>;
    const listedItems = Array.isArray(listedLearned.items) ? listedLearned.items as Array<Record<string, unknown>> : [];
    results.push({
      name: "learned_preference_list_returns_active_items",
      passed:
        listedLearned.ok === true
        && listedItems.length >= 1
        && listedItems[0]?.value === "self_plus_structural",
      detail: JSON.stringify(listedLearned, null, 2),
    });

    const relevant = selectRelevantLearnedPreferences(
      "importa essa agenda semanal por pdf",
      store.listLearnedPreferences({ activeOnly: true, limit: 10 }),
      3,
    );
    results.push({
      name: "learned_preference_is_used_for_relevant_flow_selection",
      passed: relevant.some((item) => item.type === "schedule_import_mode" && item.value === "self_plus_structural"),
      detail: JSON.stringify(relevant, null, 2),
    });

    const identitySummary = summarizeIdentityProfileForReasoning(store.getProfile());
    const operationalSummary = summarizeOperationalStateForReasoning(store.getOperationalState());
    results.push({
      name: "external_reasoning_receives_identity_and_operational_summaries",
      passed:
        identitySummary.display_name === "Paulo"
        && identitySummary.primary_role === "assistente social operacional"
        && operationalSummary.mode === "field"
        && operationalSummary.pending_approvals === 3,
      detail: JSON.stringify({ identitySummary, operationalSummary }, null, 2),
    });

    const separationProfile = store.getProfile();
    const separationState = store.getOperationalState();
    results.push({
      name: "durable_identity_and_momentary_state_remain_separated",
      passed:
        separationProfile.primaryRole === "assistente social operacional"
        && separationState.mode === "field"
        && !separationProfile.routineAnchors.includes("mensagem monitorada do institucional"),
      detail: JSON.stringify({ separationProfile, separationState }, null, 2),
    });

    const learnedId = Number((listedItems[0]?.id ?? 0));
    const deactivated = await deactivateLearnedPreferencePlugin.execute({
      id: learnedId,
    }, context) as Record<string, unknown>;
    const deactivatedItem = deactivated.item as Record<string, unknown> | undefined;
    results.push({
      name: "learned_preference_can_be_deactivated",
      passed: deactivated.ok === true && deactivatedItem?.active === false,
      detail: JSON.stringify(deactivated, null, 2),
    });

    const stateAfterGet = await getOperationalStatePlugin.execute({}, context) as Record<string, unknown>;
    results.push({
      name: "operational_state_get_returns_snapshot",
      passed: stateAfterGet.ok === true && typeof (stateAfterGet.state as Record<string, unknown> | undefined)?.mode === "string",
      detail: JSON.stringify(stateAfterGet, null, 2),
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

  console.log(`\nPersonal context layer evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
