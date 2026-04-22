import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { BriefingPrivacyPolicy } from "../src/core/briefing-privacy-policy.js";
import { DestinationRegistry } from "../src/core/destination-registry.js";
import { SharedBriefingComposer } from "../src/core/shared-briefing-composer.js";
import type { AppConfig } from "../src/types/config.js";
import type { Logger } from "../src/types/logger.js";
import type { BriefingProfile } from "../src/types/briefing-profile.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { PersonalOperationalProfile } from "../src/types/personal-operational-memory.js";

interface EvalResult { name: string; passed: boolean; detail?: string; }
class SilentLogger implements Logger { debug(): void {} info(): void {} warn(): void {} error(): void {} child(): Logger { return this; } }

function makeConfig(dbPath: string): AppConfig {
  return {
    paths: {
      appHome: "/tmp", workspaceDir: "/tmp", pluginsDir: "/tmp", logsDir: "/tmp", authorizedProjectsDir: "/tmp", builtInPluginsDir: "/tmp",
      memoryDbPath: dbPath, goalDbPath: dbPath, preferencesDbPath: dbPath, growthDbPath: dbPath, contentDbPath: dbPath, socialAssistantDbPath: dbPath,
      workflowDbPath: dbPath, memoryEntityDbPath: dbPath, contactIntelligenceDbPath: dbPath, approvalInboxDbPath: dbPath, clarificationInboxDbPath: dbPath,
      whatsappMessagesDbPath: dbPath, userBehaviorModelDbPath: dbPath, autonomyDbPath: dbPath, accountLinkingDbPath: dbPath, destinationRegistryDbPath: dbPath,
    },
    llm: { provider: "ollama", baseUrl: "http://localhost:11434", model: "qwen3:1.7b", timeoutMs: 1000 },
    telegram: { botToken: undefined, allowedUserIds: [123], pollTimeoutSeconds: 30, morningBriefEnabled: true, dailyEditorialAutomationEnabled: false, operationalModeHours: 18, typingEnabled: true },
    presence: { enabled: false, startDelayMs: 0, refreshIntervalMs: 0, progressDelayMs: 0, maxDurationMs: 0 },
    voice: { enabled: false, sttProvider: "openai", maxAudioSeconds: 120, maxAudioBytes: 1000, tempDir: "/tmp", sttArgs: [], sttTimeoutMs: 1000, openAiModel: "gpt-4o-mini-transcribe" },
    briefing: { weatherEnabled: true, weatherLocation: "Porto Alegre", weatherDays: 1, morningBriefTime: "06:30" },
    externalReasoning: { mode: "off", enabled: false, timeoutMs: 1000, routeSimpleReads: false },
    email: { enabled: false, port: 0, secure: false, mailbox: "INBOX", lookbackHours: 24, maxMessages: 20, maxSourceBytes: 10000, maxTextChars: 5000, writeEnabled: false, smtpPort: 0, smtpSecure: false, replyAllowedSenders: [], replyAllowedDomains: [] },
    emailAccounts: {},
    google: { enabled: false, oauthPort: 3000, credentialsPath: "/tmp/creds.json", tokenPath: "/tmp/token.json", extraScopes: [], calendarId: "primary", calendarAliases: {}, defaultTimezone: "America/Sao_Paulo", maxEvents: 10, maxTasks: 10, maxContacts: 10 },
    googleAccounts: {}, googleMaps: { enabled: false, defaultRegionCode: "BR", defaultLanguageCode: "pt-BR" },
    altiva: { enabled: false, companyName: "Altiva", timezone: "America/Sao_Paulo", trackedMetrics: [] },
    media: { enabled: false, providerStrategy: "balanced", premiumSceneProvider: "fal", pexelsEnabled: false, pexelsMaxResultsPerScene: 5, pexelsMaxScenesPerRequest: 3, pexelsMinDurationSeconds: 5, pexelsCacheTtlSeconds: 60, falEnabled: false, falTextToVideoModel: "", falRequestTimeoutSeconds: 60, falMaxPollSeconds: 60, falDefaultResolution: "720p", klingEnabled: false, klingApiBaseUrl: "", klingTextToVideoModel: "", klingDirectGenerationEnabled: false, klingRequestTimeoutSeconds: 60, klingMaxPollSeconds: 60 },
    safeExec: { enabled: false, allowedCommands: [], maxOutputChars: 1000, auditLogPath: "/tmp/audit.log" },
    supabaseMacQueue: { enabled: false, commandsTable: "cmd", workersTable: "workers", targetHost: "atlas", pollIntervalSeconds: 60, maxExecutionSeconds: 60, allowedCommands: [], allowedCwds: [] },
    operator: { operatorId: "operator-1", name: "Operator", channels: [{ channelId: "tg", operatorId: "operator-1", provider: "telegram", externalId: "123", mode: "direct_operator", enabled: true, displayName: "Telegram principal" }], preferredAlertChannelId: undefined },
    whatsapp: { enabled: false, defaultAccountAlias: "primary", instanceAccounts: {}, sidecarEnabled: false, conversationEnabled: false, allowedNumbers: [], unauthorizedMode: "ignore", ignoreGroups: true, sidecarPort: 8790, webhookPath: "/webhook" },
    runtime: { nodeEnv: "test", logLevel: "info", maxToolIterations: 6, tokenVaultSecret: "secret-test" },
  };
}

const personalProfile: PersonalOperationalProfile = {
  displayName: "Paulo",
  primaryRole: "líder",
  userRole: "team_lead",
  profession: "consultor",
  professionPackId: "consultant",
  routineSummary: [],
  timezone: "America/Sao_Paulo",
  preferredChannels: ["telegram"],
  audiencePolicy: { mode: "team_briefer", defaultAudience: "team", allowSharedBriefings: true, requireReviewForTeamDestinations: true, allowedChannels: ["telegram", "email"] },
  priorityAreas: ["clientes"],
  defaultAgendaScope: "both",
  workCalendarAliases: [],
  responseStyle: "direto e objetivo",
  briefingPreference: "executivo",
  morningBriefTime: "06:30",
  briefingProfiles: [],
  detailLevel: "equilibrado",
  tonePreference: "executivo",
  defaultOperationalMode: "normal",
  mobilityPreferences: [],
  autonomyPreferences: [],
  savedFocus: [],
  routineAnchors: [],
  operationalRules: [],
  attire: { umbrellaProbabilityThreshold: 60, coldTemperatureC: 14, lightClothingTemperatureC: 24, carryItems: [] },
  fieldModeHours: 18,
};

const brief: ExecutiveMorningBrief = {
  timezone: "America/Sao_Paulo",
  events: [{ account: "primary", summary: "Reunião com equipe", start: "2026-04-22T09:00:00-03:00", hasConflict: false }],
  taskBuckets: { today: [{ title: "Fechar follow-up", due: "2026-04-22T18:00:00-03:00", source: "google" }], overdue: [], stale: [], actionableCount: 1 },
  emails: [{ subject: "Resposta do cliente", from: ["Cliente <cliente@x.com>"], priority: "alta", summary: "" }],
  approvals: [],
  workflows: [],
  focus: [],
  memoryEntities: { total: 0, byKind: {}, recent: [] },
  motivation: { text: "Objetividade vence dispersão." },
  founderSnapshot: { executiveLine: "", sections: [], trackedMetrics: [] },
  nextAction: "Responder o cliente e alinhar a equipe.",
  personalFocus: [],
  overloadLevel: "leve",
  mobilityAlerts: [],
  operationalSignals: [],
  conflictSummary: { overlaps: 0, duplicates: 0, naming: 0 },
  weather: { locationLabel: "Porto Alegre", current: { description: "tempo firme", temperatureC: 20 }, days: [] },
  goalSummary: "Objetivos: fechar 2 clientes; revisar proposta ativa.",
  dayRecommendation: "Fechar follow-ups antes do almoço.",
};

function run(): void {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-destination-privacy-"));
  const dbPath = path.join(sandboxDir, "destinations.sqlite");
  const config = makeConfig(dbPath);
  const registry = new DestinationRegistry(dbPath, config, logger);
  const privacy = new BriefingPrivacyPolicy();
  const composer = new SharedBriefingComposer(privacy);
  const results: EvalResult[] = [];

  try {
    const saved = registry.upsert({
      label: "minha equipe",
      aliases: ["equipe comercial"],
      kind: "telegram_chat",
      channel: "telegram",
      address: "-100123456",
      audience: "team",
      maxPrivacyLevel: "team_shareable",
    });
    const resolved = registry.resolve("envie para minha equipe");
    results.push({
      name: "destination_registry_saves_and_resolves_natural_alias",
      passed: saved.label === "minha equipe" && resolved?.address === "-100123456",
      detail: JSON.stringify({ saved, resolved }, null, 2),
    });

    const teamProfile: BriefingProfile = {
      id: "team-brief",
      name: "briefing da equipe",
      aliases: ["briefing da equipe"],
      enabled: true,
      deliveryMode: "both",
      deliveryChannel: "telegram",
      audience: "team",
      targetRecipientIds: ["-100123456"],
      targetLabel: "minha equipe",
      time: "08:00",
      weekdays: [1,2,3,4,5],
      timezone: "America/Sao_Paulo",
      style: "executive",
      sections: ["focus", "next_action", "agenda", "emails", "tasks", "motivation"],
    };
    const composed = composer.compose({ profile: teamProfile, brief, personalProfile, maxPrivacyLevel: resolved?.maxPrivacyLevel });
    results.push({
      name: "shared_briefing_composer_filters_private_sections_for_team",
      passed: composed.removedSections.includes("emails") && composed.removedSections.includes("tasks") && !composed.reply.includes("Emails críticos") && !composed.reply.includes("*Tarefas*"),
      detail: JSON.stringify(composed, null, 2),
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
  console.log(`\nDestination/privacy evals ok: ${results.length}/${results.length}`);
}

run();
