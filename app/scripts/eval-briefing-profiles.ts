import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { BriefingProfileService } from "../src/core/briefing-profile-service.js";
import { syncBriefingProfilesWithLegacyProfile } from "../src/core/briefing-profile-helpers.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
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

const brief: ExecutiveMorningBrief = {
  timezone: "America/Sao_Paulo",
  events: [
    {
      account: "primary",
      summary: "Alinhamento da equipe",
      start: "2026-04-21T12:30:00-03:00",
      end: "2026-04-21T13:00:00-03:00",
      owner: "equipe",
      context: "interno",
      hasConflict: false,
      prepHint: "revisar pauta",
    },
  ],
  taskBuckets: {
    today: [],
    overdue: [],
    stale: [],
    actionableCount: 0,
  },
  emails: [],
  approvals: [
    {
      id: 1,
      channel: "telegram",
      chatId: 123,
      actionKind: "send_message",
      subject: "Aprovar resumo para equipe",
      draftPayload: "{}",
      status: "pending",
      createdAt: "2026-04-21T09:00:00-03:00",
      updatedAt: "2026-04-21T09:00:00-03:00",
    },
  ],
  workflows: [],
  focus: [],
  memoryEntities: {
    total: 0,
    byKind: {},
    recent: [],
  },
  motivation: {
    text: "Foco bom ainda vence pressa ruim.",
  },
  founderSnapshot: {
    executiveLine: "Sem snapshot de founder nesta simulação.",
    sections: [],
    trackedMetrics: [],
  },
  nextAction: "Confirmar a pauta do alinhamento da equipe.",
  personalFocus: [],
  overloadLevel: "leve",
  mobilityAlerts: [],
  operationalSignals: [],
  conflictSummary: {
    overlaps: 0,
    duplicates: 0,
    naming: 0,
  },
  weather: {
    locationLabel: "Porto Alegre",
    current: {
      description: "tempo firme",
      temperatureC: 21,
    },
    days: [],
  },
};

async function run() {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-briefing-profiles-"));
  const dbPath = path.join(sandboxDir, "personal-memory.sqlite");
  const store = new PersonalOperationalMemoryStore(dbPath, logger);
  const results: EvalResult[] = [];

  try {
    const legacyProfiles = syncBriefingProfilesWithLegacyProfile(store.getProfile());
    results.push({
      name: "briefing_profiles_migrate_legacy_morning_schedule",
      passed: legacyProfiles.length >= 1 && legacyProfiles[0]?.time === "06:30",
      detail: JSON.stringify(legacyProfiles, null, 2),
    });

    const updated = store.updateProfile({
      morningBriefTime: "06:00",
      briefingProfiles: [
        {
          id: "default-morning-brief",
          name: "briefing da manhã",
          aliases: ["briefing da manhã", "briefing"],
          enabled: true,
          deliveryMode: "both",
          deliveryChannel: "telegram",
          audience: "self",
          targetRecipientIds: [],
          time: "06:00",
          weekdays: [1, 2, 3, 4, 5],
          timezone: "America/Sao_Paulo",
          style: "executive",
          sections: ["weather", "focus", "next_action", "agenda", "tasks", "motivation"],
        },
        {
          id: "team-lunch",
          name: "radar da equipe",
          aliases: ["radar da equipe"],
          enabled: true,
          deliveryMode: "both",
          deliveryChannel: "telegram",
          audience: "team",
          targetRecipientIds: ["123456"],
          time: "12:00",
          weekdays: [1, 2, 3, 4, 5],
          timezone: "America/Sao_Paulo",
          style: "executive",
          sections: ["focus", "next_action", "agenda", "approvals", "motivation"],
        },
      ],
    });

    const service = new BriefingProfileService(
      store,
      {
        getExecutiveMorningBrief: async () => brief,
      },
      logger,
    );

    const scheduled = service.listScheduledProfiles("telegram");
    const matched = service.resolveProfileForPrompt("me mostra o radar da equipe");
    const rendered = await service.render({ prompt: "gere o radar da equipe" });

    results.push({
      name: "briefing_profiles_store_multiple_profiles",
      passed: (updated.briefingProfiles ?? []).length >= 2,
      detail: JSON.stringify(updated.briefingProfiles, null, 2),
    });
    results.push({
      name: "briefing_profiles_assign_default_purpose_and_presentation",
      passed:
        legacyProfiles.every((item) => item.purpose && item.presentation?.hierarchy === "daily_prep_v1")
        && (updated.briefingProfiles ?? []).every((item) => item.purpose && item.presentation?.maxPrimaryCommitments),
      detail: JSON.stringify({
        legacyProfiles,
        updatedBriefingProfiles: updated.briefingProfiles,
      }, null, 2),
    });
    results.push({
      name: "briefing_profile_service_matches_custom_named_profile",
      passed: matched?.id === "team-lunch",
      detail: JSON.stringify(matched, null, 2),
    });
    results.push({
      name: "briefing_profile_service_lists_scheduled_telegram_profiles",
      passed: scheduled.length >= 2,
      detail: JSON.stringify(scheduled, null, 2),
    });
    results.push({
      name: "briefing_profile_service_renders_named_profile",
      passed: rendered.profile.id === "team-lunch" && rendered.reply.includes("*Agenda*"),
      detail: rendered.reply,
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

  console.log(`\nBriefing profile evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
