import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { GoogleAuthStatus, GoogleWorkspaceAuthService } from "../src/integrations/google/google-auth.js";
import { AccountConnectionStore } from "../src/core/account-linking/account-connection-store.js";
import { AccountLinkingService } from "../src/core/account-linking/account-linking-service.js";
import { ConnectionSessionStore } from "../src/core/account-linking/connection-session-store.js";
import { OauthProviderRegistry } from "../src/core/account-linking/oauth-provider-registry.js";
import { ProviderPermissions } from "../src/core/account-linking/provider-permissions.js";
import { TokenVault } from "../src/core/account-linking/token-vault.js";
import type { AppConfig } from "../src/types/config.js";
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

function makeConfig(dbPath: string): AppConfig {
  return {
    paths: {
      appHome: "/tmp",
      workspaceDir: "/tmp",
      pluginsDir: "/tmp",
      logsDir: "/tmp",
      authorizedProjectsDir: "/tmp",
      builtInPluginsDir: "/tmp",
      memoryDbPath: dbPath,
      goalDbPath: dbPath,
      preferencesDbPath: dbPath,
      growthDbPath: dbPath,
      contentDbPath: dbPath,
      socialAssistantDbPath: dbPath,
      workflowDbPath: dbPath,
      memoryEntityDbPath: dbPath,
      contactIntelligenceDbPath: dbPath,
      approvalInboxDbPath: dbPath,
      clarificationInboxDbPath: dbPath,
      whatsappMessagesDbPath: dbPath,
      userBehaviorModelDbPath: dbPath,
      autonomyDbPath: dbPath,
      accountLinkingDbPath: dbPath,
      destinationRegistryDbPath: dbPath,
    },
    llm: { provider: "ollama", baseUrl: "http://localhost:11434", model: "qwen3:1.7b", timeoutMs: 1000 },
    telegram: { botToken: undefined, allowedUserIds: [], pollTimeoutSeconds: 30, morningBriefEnabled: true, dailyEditorialAutomationEnabled: false, operationalModeHours: 18, typingEnabled: true },
    presence: { enabled: false, startDelayMs: 0, refreshIntervalMs: 0, progressDelayMs: 0, maxDurationMs: 0 },
    voice: { enabled: false, sttProvider: "openai", maxAudioSeconds: 120, maxAudioBytes: 1000, tempDir: "/tmp", sttArgs: [], sttTimeoutMs: 1000, openAiModel: "gpt-4o-mini-transcribe" },
    briefing: { weatherEnabled: true, weatherLocation: "Porto Alegre", weatherDays: 1, morningBriefTime: "06:30" },
    externalReasoning: { mode: "off", enabled: false, timeoutMs: 1000, routeSimpleReads: false },
    email: { enabled: false, port: 0, secure: false, mailbox: "INBOX", lookbackHours: 24, maxMessages: 20, maxSourceBytes: 10000, maxTextChars: 5000, writeEnabled: false, smtpPort: 0, smtpSecure: false, replyAllowedSenders: [], replyAllowedDomains: [] },
    emailAccounts: {},
    google: { enabled: true, oauthPort: 3000, credentialsPath: "/tmp/creds.json", tokenPath: "/tmp/token.json", extraScopes: [], calendarId: "primary", calendarAliases: {}, defaultTimezone: "America/Sao_Paulo", maxEvents: 10, maxTasks: 10, maxContacts: 10 },
    googleAccounts: {},
    googleMaps: { enabled: false, defaultRegionCode: "BR", defaultLanguageCode: "pt-BR" },
    altiva: { enabled: false, companyName: "Altiva", timezone: "America/Sao_Paulo", trackedMetrics: [] },
    media: { enabled: false, providerStrategy: "balanced", premiumSceneProvider: "fal", pexelsEnabled: false, pexelsMaxResultsPerScene: 5, pexelsMaxScenesPerRequest: 3, pexelsMinDurationSeconds: 5, pexelsCacheTtlSeconds: 60, falEnabled: false, falTextToVideoModel: "", falRequestTimeoutSeconds: 60, falMaxPollSeconds: 60, falDefaultResolution: "720p", klingEnabled: false, klingApiBaseUrl: "", klingTextToVideoModel: "", klingDirectGenerationEnabled: false, klingRequestTimeoutSeconds: 60, klingMaxPollSeconds: 60 },
    safeExec: { enabled: false, allowedCommands: [], maxOutputChars: 1000, auditLogPath: "/tmp/audit.log" },
    supabaseMacQueue: { enabled: false, commandsTable: "cmd", workersTable: "workers", targetHost: "atlas", pollIntervalSeconds: 60, maxExecutionSeconds: 60, allowedCommands: [], allowedCwds: [] },
    operator: { operatorId: "operator-1", name: "Operator", channels: [], preferredAlertChannelId: undefined },
    whatsapp: { enabled: false, defaultAccountAlias: "primary", instanceAccounts: {}, sidecarEnabled: false, conversationEnabled: false, allowedNumbers: [], unauthorizedMode: "ignore", ignoreGroups: true, sidecarPort: 8790, webhookPath: "/webhook" },
    runtime: { nodeEnv: "test", logLevel: "info", maxToolIterations: 6, tokenVaultSecret: "secret-test" },
  };
}

function makeGoogleAuth(status: GoogleAuthStatus, authUrl = "https://accounts.google.com/o/oauth2/v2/auth?fake=1"): GoogleWorkspaceAuthService {
  return {
    getStatus: () => status,
    createAuthUrl: () => authUrl,
  } as unknown as GoogleWorkspaceAuthService;
}

function run(): void {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-account-linking-"));
  const dbPath = path.join(sandboxDir, "account-linking.sqlite");
  const config = makeConfig(dbPath);
  const sessions = new ConnectionSessionStore(dbPath, logger);
  const connections = new AccountConnectionStore(dbPath, logger);
  const permissions = new ProviderPermissions();
  const results: EvalResult[] = [];

  try {
    const pendingRegistry = new OauthProviderRegistry(
      makeGoogleAuth({
        enabled: true,
        configured: true,
        authenticated: false,
        ready: false,
        credentialsPath: "/tmp/creds.json",
        tokenPath: "/tmp/token.json",
        message: "Google precisa ser autorizado.",
      }),
      permissions,
    );
    const pendingService = new AccountLinkingService(
      config,
      sessions,
      connections,
      pendingRegistry,
      permissions,
      new TokenVault(dbPath, "secret-test", logger),
      logger,
    );
    const started = pendingService.startConnection({ provider: "google" });
    results.push({
      name: "account_linking_start_creates_pending_session",
      passed: started.session?.provider === "google" && started.reply.includes("https://accounts.google.com"),
      detail: JSON.stringify(started, null, 2),
    });

    const readyRegistry = new OauthProviderRegistry(
      makeGoogleAuth({
        enabled: true,
        configured: true,
        authenticated: true,
        ready: true,
        writeReady: true,
        grantedScopes: permissions.resolveScopes("google", ["calendar_tasks_read", "calendar_tasks_write"]),
        credentialsPath: "/tmp/creds.json",
        tokenPath: "/tmp/token.json",
        message: "Google pronto.",
      }),
      permissions,
    );
    const readyService = new AccountLinkingService(
      config,
      sessions,
      connections,
      readyRegistry,
      permissions,
      new TokenVault(dbPath, "secret-test", logger),
      logger,
    );
    const overview = readyService.renderOverview();
    const synced = readyService.listConnections();
    results.push({
      name: "account_linking_syncs_ready_google_connection",
      passed: synced.some((item) => item.provider === "google" && item.status === "active") && overview.includes("Google: ativo"),
      detail: JSON.stringify({ synced, overview }, null, 2),
    });

    const revoked = readyService.revokeConnection("google");
    const revokedStatus = connections.getByProvider(config.operator.operatorId, "google")?.status;
    results.push({
      name: "account_linking_revoke_marks_connection_revoked",
      passed: revokedStatus === "revoked" && revoked.includes("desconectado"),
      detail: JSON.stringify({ revoked, revokedStatus }, null, 2),
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
  console.log(`\nAccount linking evals ok: ${results.length}/${results.length}`);
}

run();
