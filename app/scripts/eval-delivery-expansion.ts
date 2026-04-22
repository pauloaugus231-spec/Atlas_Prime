import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { BriefingProfileService } from "../src/core/briefing-profile-service.js";
import { ChannelDeliveryService } from "../src/core/delivery/channel-delivery-service.js";
import { DeliveryAuditStore } from "../src/core/delivery/delivery-audit-store.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { BriefingProfile } from "../src/types/briefing-profile.js";
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

function makeBrief(): ExecutiveMorningBrief {
  return {
    timezone: "America/Sao_Paulo",
    events: [
      {
        account: "primary",
        summary: "Alinhamento com equipe",
        start: "2026-04-22T08:00:00-03:00",
      },
    ],
    taskBuckets: {
      today: [{ text: "Revisar briefing compartilhável", source: "manual" }],
      overdue: [],
      stale: [],
      actionableCount: 1,
    },
    emails: [],
    approvals: [],
    workflows: [],
    focus: [],
    memoryEntities: { total: 0, byKind: {}, recent: [] },
    motivation: { text: "Clareza antes de volume." },
    founderSnapshot: { executiveLine: "", sections: [], trackedMetrics: [] },
    nextAction: "Confirmar prioridades do dia.",
    personalFocus: [],
    overloadLevel: "leve",
    mobilityAlerts: [],
    operationalSignals: [],
    conflictSummary: { overlaps: 0, duplicates: 0, naming: 0 },
    weather: {
      locationLabel: "Porto Alegre",
      current: { description: "céu limpo", temperatureC: 24 },
      days: [],
    },
  };
}

function createProfiles(): BriefingProfile[] {
  return [
    {
      id: "default-morning-brief",
      name: "briefing da manhã",
      aliases: ["briefing", "briefing da manhã"],
      enabled: true,
      deliveryMode: "both",
      deliveryChannel: "telegram",
      audience: "self",
      targetRecipientIds: [],
      time: "06:00",
      weekdays: [1, 2, 3, 4, 5],
      timezone: "America/Sao_Paulo",
      style: "executive",
      sections: ["weather", "agenda", "tasks", "motivation"],
    },
    {
      id: "team-email",
      name: "briefing da equipe",
      aliases: ["briefing da equipe"],
      enabled: true,
      deliveryMode: "both",
      deliveryChannel: "email",
      audience: "team",
      targetRecipientIds: ["team@atlas.local"],
      targetLabel: "Equipe",
      time: "08:00",
      weekdays: [1, 2, 3, 4, 5],
      timezone: "America/Sao_Paulo",
      style: "compact",
      sections: ["agenda", "goals", "motivation"],
    },
    {
      id: "team-whatsapp",
      name: "radar do comercial",
      aliases: ["radar do comercial"],
      enabled: true,
      deliveryMode: "both",
      deliveryChannel: "whatsapp",
      audience: "team",
      targetRecipientIds: ["group:comercial"],
      targetLabel: "Comercial",
      time: "12:00",
      weekdays: [1, 2, 3, 4, 5],
      timezone: "America/Sao_Paulo",
      style: "compact",
      sections: ["agenda", "tasks", "motivation"],
    },
  ];
}

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-delivery-expansion-"));
  const dbPath = path.join(sandboxDir, "delivery.sqlite");
  const results: EvalResult[] = [];

  try {
    const briefingProfiles = new BriefingProfileService(
      {
        getProfile: () => ({
          timezone: "America/Sao_Paulo",
          morningBriefTime: "06:00",
          briefingProfiles: createProfiles(),
          preferredAlertChannel: "telegram",
          briefingPreference: "executivo",
        }),
      },
      { getExecutiveMorningBrief: async () => makeBrief() },
      logger,
    );
    const delivery = new ChannelDeliveryService(
      briefingProfiles,
      new DeliveryAuditStore(dbPath, logger),
      logger,
    );

    const telegramPrepared = await delivery.prepareBriefing({ profileId: "default-morning-brief" });
    results.push({
      name: "delivery_expansion_prepares_self_telegram_brief",
      passed:
        telegramPrepared.channel === "telegram"
        && telegramPrepared.disposition === "ready"
        && telegramPrepared.recipients.includes("self")
        && telegramPrepared.body.includes("Alinhamento com equipe"),
      detail: JSON.stringify(telegramPrepared, null, 2),
    });

    const emailPrepared = await delivery.prepareBriefing({ profileId: "team-email" });
    results.push({
      name: "delivery_expansion_prepares_team_email_as_draft_only",
      passed:
        emailPrepared.channel === "email"
        && emailPrepared.disposition === "draft_only"
        && emailPrepared.requiresApproval === true
        && typeof emailPrepared.subject === "string"
        && emailPrepared.subject.includes("briefing da equipe"),
      detail: JSON.stringify(emailPrepared, null, 2),
    });

    const whatsappPrepared = await delivery.prepareBriefing({ profileId: "team-whatsapp" });
    results.push({
      name: "delivery_expansion_keeps_whatsapp_controlled",
      passed:
        whatsappPrepared.channel === "whatsapp"
        && whatsappPrepared.disposition === "draft_only"
        && whatsappPrepared.requiresApproval === true
        && whatsappPrepared.recipients.includes("group:comercial"),
      detail: JSON.stringify(whatsappPrepared, null, 2),
    });

    const webPrepared = await delivery.prepareBriefing({
      profileId: "default-morning-brief",
      channelOverride: "web",
    });
    results.push({
      name: "delivery_expansion_supports_web_preview_mode",
      passed:
        webPrepared.channel === "web"
        && webPrepared.disposition === "preview_only"
        && webPrepared.body.startsWith("# briefing da manhã"),
      detail: JSON.stringify(webPrepared, null, 2),
    });

    const auditLines = delivery.renderChannelStatus();
    results.push({
      name: "delivery_expansion_records_delivery_audit",
      passed:
        auditLines.includes("telegram | prepared | ready")
        && auditLines.includes("email | drafted | draft_only")
        && auditLines.includes("web | previewed | preview_only"),
      detail: auditLines,
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

  console.log(`\nDelivery expansion evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
