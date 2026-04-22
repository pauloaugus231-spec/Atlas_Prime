import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import listPersonalMemoryItemsPlugin from "../src/plugins/list_personal_memory_items.plugin.js";
import savePersonalMemoryItemPlugin from "../src/plugins/save_personal_memory_item.plugin.js";
import updatePersonalMemoryItemPlugin from "../src/plugins/update_personal_memory_item.plugin.js";
import deletePersonalMemoryItemPlugin from "../src/plugins/delete_personal_memory_item.plugin.js";
import getPersonalOperationalProfilePlugin from "../src/plugins/get_personal_operational_profile.plugin.js";
import updatePersonalOperationalProfilePlugin from "../src/plugins/update_personal_operational_profile.plugin.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import { extractPersonalOperationalProfileUpdate } from "../src/core/generic-prompt-helpers.js";
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
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-personal-memory-"));
  const dbPath = path.join(sandboxDir, "personal-memory.sqlite");
  const store = new PersonalOperationalMemoryStore(dbPath, logger);
  const context = buildContext(store);
  const results: EvalResult[] = [];

  try {
    const saved = await savePersonalMemoryItemPlugin.execute(
      {
        kind: "preference",
        title: "Respostas curtas em plantão",
        content: "Em dias de plantão quero respostas curtas.",
      },
      context,
    ) as Record<string, unknown>;
    const savedItem = saved.item as Record<string, unknown> | undefined;
    results.push({
      name: "personal_memory_save_ok",
      passed: saved.ok === true && typeof savedItem?.id === "number",
      detail: JSON.stringify(saved, null, 2),
    });

    const listed = await listPersonalMemoryItemsPlugin.execute(
      { limit: 10 },
      context,
    ) as Record<string, unknown>;
    const listedItems = Array.isArray(listed.items) ? listed.items as Array<Record<string, unknown>> : [];
    results.push({
      name: "personal_memory_list_ok",
      passed: listed.ok === true && listedItems.length >= 1,
      detail: JSON.stringify(listed, null, 2),
    });

    const savedId = Number(savedItem?.id ?? 0);
    const updated = await updatePersonalMemoryItemPlugin.execute(
      {
        id: savedId,
        kind: "routine",
        title: "Rotina de plantão",
        content: "Em dias de plantão quero respostas curtas e foco em deslocamento.",
      },
      context,
    ) as Record<string, unknown>;
    const updatedItem = updated.item as Record<string, unknown> | undefined;
    results.push({
      name: "personal_memory_update_ok",
      passed: updated.ok === true && updatedItem?.kind === "routine",
      detail: JSON.stringify(updated, null, 2),
    });

    const profile = store.getProfile();
    results.push({
      name: "personal_memory_profile_merges_items",
      passed: profile.routineAnchors.some((item) => item.includes("foco em deslocamento")),
      detail: JSON.stringify(profile, null, 2),
    });

    const baseProfile = await getPersonalOperationalProfilePlugin.execute(
      {},
      context,
    ) as Record<string, unknown>;
    const rawBaseProfile = baseProfile.profile as Record<string, unknown> | undefined;
    results.push({
      name: "personal_profile_get_ok",
      passed: baseProfile.ok === true && rawBaseProfile?.responseStyle === "direto e objetivo",
      detail: JSON.stringify(baseProfile, null, 2),
    });

    const updatedProfile = await updatePersonalOperationalProfilePlugin.execute(
      {
        responseStyle: "direto e objetivo",
        briefingPreference: "curto",
        morningBriefTime: "06:00",
        detailLevel: "resumo",
        tonePreference: "objetivo",
        defaultOperationalMode: "field",
        mobilityPreferences: ["priorizar deslocamento cedo"],
        carryItems: ["carregador", "casaco leve"],
      },
      context,
    ) as Record<string, unknown>;
    const rawUpdatedProfile = updatedProfile.profile as Record<string, unknown> | undefined;
    results.push({
      name: "personal_profile_update_ok",
      passed:
        updatedProfile.ok === true
        && rawUpdatedProfile?.briefingPreference === "curto"
        && rawUpdatedProfile?.morningBriefTime === "06:00"
        && Array.isArray(rawUpdatedProfile?.briefingProfiles)
        && (rawUpdatedProfile?.briefingProfiles as Array<Record<string, unknown>>).length >= 1
        && rawUpdatedProfile?.defaultOperationalMode === "field",
      detail: JSON.stringify(updatedProfile, null, 2),
    });

    const extractedProfileUpdate = extractPersonalOperationalProfileUpdate(
      "mude o briefing da manhã de 6h30 para 6h",
      store.getProfile(),
    );
    results.push({
      name: "briefing_schedule_natural_language_update_is_parsed_locally",
      passed: extractedProfileUpdate?.profile.morningBriefTime === "06:00",
      detail: JSON.stringify(extractedProfileUpdate, null, 2),
    });

    const multiBriefingUpdate = extractPersonalOperationalProfileUpdate(
      "quero outro briefing da equipe às 12h chamado radar do almoço com agenda e aprovações",
      store.getProfile(),
    );
    const parsedBriefingProfiles = multiBriefingUpdate?.profile.briefingProfiles ?? [];
    results.push({
      name: "briefing_profile_natural_language_can_create_second_briefing",
      passed:
        parsedBriefingProfiles.length >= 2
        && parsedBriefingProfiles.some((item) => item.time === "12:00" && item.audience === "team"),
      detail: JSON.stringify(multiBriefingUpdate, null, 2),
    });

    const deleted = await deletePersonalMemoryItemPlugin.execute(
      { id: savedId },
      context,
    ) as Record<string, unknown>;
    results.push({
      name: "personal_memory_delete_ok",
      passed: deleted.ok === true,
      detail: JSON.stringify(deleted, null, 2),
    });

    const afterDelete = store.listItems({ limit: 10 });
    results.push({
      name: "personal_memory_delete_removes_item",
      passed: afterDelete.every((item) => item.id !== savedId),
      detail: JSON.stringify(afterDelete, null, 2),
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

  console.log(`\nPersonal memory evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
