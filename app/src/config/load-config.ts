import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type {
  AltivaConfig,
  AppConfig,
  BriefingConfig,
  EmailConfig,
  ExternalReasoningConfig,
  ExternalReasoningMode,
  GoogleMapsConfig,
  GoogleWorkspaceConfig,
  LlmConfig,
  LlmProvider,
  LlmProviderConfig,
  LlmSmartRoutingConfig,
  MediaConfig,
  OperatorChannelBinding,
  OperatorChannelMode,
  PresenceConfig,
  WhatsAppUnauthorizedMode,
  VoiceConfig,
  VoiceSttProvider,
} from "../types/config.js";
import type { LogLevel } from "../types/logger.js";

const DEFAULT_OLLAMA_BASE_URL = "http://host.docker.internal:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3:1.7b";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENAI_ADVANCED_MODEL = "gpt-5.4";
const DEFAULT_MAX_TOOL_ITERATIONS = 6;

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const result: Record<string, string> = {};
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      result[key] = value;
    }
  }
  return result;
}

function mergeEnvWithFiles(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const candidates = [
    env.ENV_FILE?.trim(),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
    env.APP_HOME ? path.resolve(env.APP_HOME, ".env") : undefined,
    env.APP_HOME ? path.resolve(env.APP_HOME, ".env.local") : undefined,
  ].filter((value): value is string => Boolean(value));

  const fileEnv = candidates.reduce<Record<string, string>>((acc, candidate) => {
    return { ...acc, ...parseEnvFile(candidate) };
  }, {});

  return {
    ...fileEnv,
    ...env,
  };
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

function parseLlmProvider(value: string | undefined): LlmProvider | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "ollama" || normalized === "openai") {
    return normalized;
  }
  return undefined;
}

function buildOllamaLlmConfig(env: NodeJS.ProcessEnv): LlmProviderConfig {
  return {
    provider: "ollama",
    baseUrl: normalizeOllamaBaseUrl(env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL),
    model: env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
    timeoutMs: parsePositiveInteger(env.OLLAMA_TIMEOUT_SECONDS, 60) * 1000,
  };
}

function buildOpenAiLlmConfig(env: NodeJS.ProcessEnv): LlmProviderConfig {
  return {
    provider: "openai",
    baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL),
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    timeoutMs: parsePositiveInteger(env.OPENAI_TIMEOUT_SECONDS, 60) * 1000,
    apiKey: env.OPENAI_API_KEY?.trim() || undefined,
  };
}

function buildOpenAiAdvancedLlmConfig(env: NodeJS.ProcessEnv): LlmProviderConfig | undefined {
  const apiKey = env.OPENAI_API_KEY?.trim() || undefined;
  if (!apiKey) {
    return undefined;
  }

  return {
    provider: "openai",
    baseUrl: normalizeBaseUrl(env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL),
    model: env.OPENAI_ADVANCED_MODEL?.trim() || DEFAULT_OPENAI_ADVANCED_MODEL,
    timeoutMs: parsePositiveInteger(env.OPENAI_ADVANCED_TIMEOUT_SECONDS, 90) * 1000,
    apiKey,
  };
}

function buildLlmSmartRoutingConfig(env: NodeJS.ProcessEnv): LlmSmartRoutingConfig {
  return {
    enabled: parseBoolean(env.LLM_SMART_ROUTING_ENABLED, true),
    complexityPromptChars: parsePositiveInteger(env.LLM_COMPLEXITY_PROMPT_CHARS, 180),
    toolComplexityPromptChars: parsePositiveInteger(env.LLM_TOOL_COMPLEXITY_PROMPT_CHARS, 80),
    useAdvancedForTools: parseBoolean(env.LLM_USE_ADVANCED_FOR_TOOLS, true),
  };
}

function buildLlmConfig(env: NodeJS.ProcessEnv): LlmConfig {
  const ollama = buildOllamaLlmConfig(env);
  const openai = buildOpenAiLlmConfig(env);
  const advanced = buildOpenAiAdvancedLlmConfig(env);
  const smartRouting = buildLlmSmartRoutingConfig(env);
  const requestedProvider = env.LLM_PROVIDER?.trim().toLowerCase();

  if (requestedProvider === "fallback") {
    const primaryProvider = parseLlmProvider(env.LLM_PRIMARY_PROVIDER) ?? "ollama";
    const secondaryProvider = parseLlmProvider(env.LLM_FALLBACK_PROVIDER) ?? (
      primaryProvider === "ollama" ? "openai" : "ollama"
    );
    const primary = primaryProvider === "openai" ? openai : ollama;
    const secondary = secondaryProvider === "openai" ? openai : ollama;

    return {
      provider: "fallback",
      baseUrl: primary.baseUrl,
      model: primary.model,
      timeoutMs: primary.timeoutMs,
      apiKey: primary.apiKey,
      ollama,
      openai,
      advanced,
      smartRouting,
      fallback: {
        primary,
        secondary,
      },
    };
  }

  const explicitProvider = parseLlmProvider(requestedProvider);
  const selectedProvider = explicitProvider ?? (env.OPENAI_API_KEY?.trim() ? "openai" : "ollama");
  const selected = selectedProvider === "openai" ? openai : ollama;

  return {
    provider: selected.provider,
    baseUrl: selected.baseUrl,
    model: selected.model,
    timeoutMs: selected.timeoutMs,
    apiKey: selected.apiKey,
    ollama,
    openai,
    advanced,
    smartRouting,
  };
}

function parseWhatsAppUnauthorizedMode(value: string | undefined): WhatsAppUnauthorizedMode {
  return value === "monitor" ? "monitor" : "ignore";
}

function parseOperatorChannelMode(value: string | undefined, fallback: OperatorChannelMode): OperatorChannelMode {
  if (value === "direct_operator" || value === "backup_operator" || value === "monitored") {
    return value;
  }
  return fallback;
}

function parseAllowedUserIds(value: string | undefined): number[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item));
}

function parseStringList(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDigits(value: string | undefined): string | undefined {
  const normalized = (value ?? "").replace(/\D+/g, "");
  return normalized || undefined;
}

function parseCommandMatrix(value: string | undefined, fallback: string[][]): string[][] {
  if (!value?.trim()) {
    return fallback;
  }

  const rows = value
    .split("|")
    .map((item) =>
      item
        .trim()
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .filter((parts) => parts.length > 0);

  return rows.length > 0 ? rows : fallback;
}

function readGoogleCredentialsFile(credentialsPath: string): {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
} {
  if (!existsSync(credentialsPath)) {
    return {};
  }

  try {
    const raw = readFileSync(credentialsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      installed?: { client_id?: string; client_secret?: string; redirect_uris?: string[] };
      web?: { client_id?: string; client_secret?: string; redirect_uris?: string[] };
    };
    const block = parsed.installed ?? parsed.web;
    return {
      clientId: block?.client_id?.trim() || undefined,
      clientSecret: block?.client_secret?.trim() || undefined,
      redirectUri: block?.redirect_uris?.[0]?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

function normalizeAccountAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseAccountAliases(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }

  return [...new Set(value.split(",").map((item) => normalizeAccountAlias(item)).filter(Boolean))];
}

function parseAliasMap(value: string | undefined, fallback?: Record<string, string>): Record<string, string> {
  const result = new Map<string, string>();

  for (const [key, mappedValue] of Object.entries(fallback ?? {})) {
    const normalizedKey = normalizeAccountAlias(key);
    if (normalizedKey && mappedValue?.trim()) {
      result.set(normalizedKey, mappedValue.trim());
    }
  }

  if (!value?.trim()) {
    return Object.fromEntries(result.entries());
  }

  for (const entry of value.split("|")) {
    const [rawKey, ...rawValueParts] = entry.split(":");
    const key = normalizeAccountAlias(rawKey ?? "");
    const mappedValue = rawValueParts.join(":").trim();
    if (key && mappedValue) {
      result.set(key, mappedValue);
    }
  }

  return Object.fromEntries(result.entries());
}

function parsePlainMap(
  value: string | undefined,
  fallback?: Record<string, string>,
): Record<string, string> {
  const result = new Map<string, string>();

  for (const [key, mappedValue] of Object.entries(fallback ?? {})) {
    const normalizedKey = key.trim();
    const normalizedValue = mappedValue.trim();
    if (normalizedKey && normalizedValue) {
      result.set(normalizedKey, normalizedValue);
    }
  }

  if (!value?.trim()) {
    return Object.fromEntries(result.entries());
  }

  for (const entry of value.split("|")) {
    const [rawKey, ...rawValueParts] = entry.split(":");
    const key = rawKey?.trim();
    const mappedValue = rawValueParts.join(":").trim();
    if (key && mappedValue) {
      result.set(key, mappedValue);
    }
  }

  return Object.fromEntries(result.entries());
}

function buildEmailConfig(env: NodeJS.ProcessEnv, prefix = "EMAIL_", defaults?: EmailConfig): EmailConfig {
  const fallback = defaults;
  return {
    enabled: parseBoolean(env[`${prefix}ENABLED`], fallback?.enabled ?? false),
    host: env[`${prefix}IMAP_HOST`]?.trim() || fallback?.host,
    port: parsePositiveInteger(env[`${prefix}IMAP_PORT`], fallback?.port ?? 993),
    secure: parseBoolean(env[`${prefix}IMAP_SECURE`], fallback?.secure ?? true),
    username: env[`${prefix}IMAP_USERNAME`]?.trim() || fallback?.username,
    password: env[`${prefix}IMAP_PASSWORD`]?.trim() || fallback?.password,
    mailbox: env[`${prefix}IMAP_MAILBOX`]?.trim() || fallback?.mailbox || "INBOX",
    lookbackHours: parsePositiveInteger(env[`${prefix}LOOKBACK_HOURS`], fallback?.lookbackHours ?? 72),
    maxMessages: parsePositiveInteger(env[`${prefix}MAX_MESSAGES`], fallback?.maxMessages ?? 10),
    maxSourceBytes: parsePositiveInteger(env[`${prefix}MAX_SOURCE_BYTES`], fallback?.maxSourceBytes ?? 200000),
    maxTextChars: parsePositiveInteger(env[`${prefix}MAX_TEXT_CHARS`], fallback?.maxTextChars ?? 12000),
    writeEnabled: parseBoolean(env[`${prefix}WRITE_ENABLED`], fallback?.writeEnabled ?? false),
    smtpHost: env[`${prefix}SMTP_HOST`]?.trim() || fallback?.smtpHost,
    smtpPort: parsePositiveInteger(env[`${prefix}SMTP_PORT`], fallback?.smtpPort ?? 465),
    smtpSecure: parseBoolean(env[`${prefix}SMTP_SECURE`], fallback?.smtpSecure ?? true),
    smtpUsername:
      env[`${prefix}SMTP_USERNAME`]?.trim() ||
      env[`${prefix}IMAP_USERNAME`]?.trim() ||
      fallback?.smtpUsername ||
      fallback?.username,
    smtpPassword:
      env[`${prefix}SMTP_PASSWORD`]?.trim() ||
      env[`${prefix}IMAP_PASSWORD`]?.trim() ||
      fallback?.smtpPassword ||
      fallback?.password,
    fromName: env[`${prefix}FROM_NAME`]?.trim() || fallback?.fromName,
    fromAddress:
      env[`${prefix}FROM_ADDRESS`]?.trim() ||
      env[`${prefix}SMTP_USERNAME`]?.trim() ||
      env[`${prefix}IMAP_USERNAME`]?.trim() ||
      fallback?.fromAddress ||
      fallback?.smtpUsername ||
      fallback?.username,
    replyAllowedSenders: parseStringList(env[`${prefix}REPLY_ALLOWED_SENDERS`] ?? fallback?.replyAllowedSenders.join(",")),
    replyAllowedDomains: parseStringList(
      env[`${prefix}REPLY_ALLOWED_DOMAINS`] ?? fallback?.replyAllowedDomains.join(","),
    ).map((item) => item.toLowerCase()),
  };
}

function buildSecondaryEmailFallback(defaults: EmailConfig): EmailConfig {
  return {
    ...defaults,
    username: undefined,
    password: undefined,
    smtpUsername: undefined,
    smtpPassword: undefined,
    fromAddress: undefined,
  };
}

function hasExplicitSecondaryEmailConfig(env: NodeJS.ProcessEnv, prefix: string): boolean {
  const hasIdentity = Boolean(env[`${prefix}IMAP_USERNAME`]?.trim() || env[`${prefix}SMTP_USERNAME`]?.trim());
  const hasSecret = Boolean(env[`${prefix}IMAP_PASSWORD`]?.trim() || env[`${prefix}SMTP_PASSWORD`]?.trim());
  return hasIdentity && hasSecret;
}

function buildGoogleConfig(
  env: NodeJS.ProcessEnv,
  options: {
    prefix?: string;
    fallback?: GoogleWorkspaceConfig;
    workspaceDir: string;
    defaultOauthPort: number;
    alias?: string;
  },
): GoogleWorkspaceConfig {
  const prefix = options.prefix ?? "GOOGLE_";
  const fallback = options.fallback;
  const alias = options.alias ? normalizeAccountAlias(options.alias) : "primary";
  const credentialsPath = path.resolve(
    env[`${prefix}CREDENTIALS_PATH`] ??
      (alias === "primary"
        ? fallback?.credentialsPath
        : path.join(options.workspaceDir, ".agent-state", `google-oauth-client-${alias}.json`)) ??
      path.join(options.workspaceDir, ".agent-state", `google-oauth-client-${alias}.json`),
  );
  const tokenPath = path.resolve(
    env[`${prefix}TOKEN_PATH`] ??
      (alias === "primary"
        ? fallback?.tokenPath
        : path.join(options.workspaceDir, ".agent-state", `google-oauth-token-${alias}.json`)) ??
      path.join(options.workspaceDir, ".agent-state", `google-oauth-token-${alias}.json`),
  );
  const oauthPort = parsePositiveInteger(env[`${prefix}OAUTH_PORT`], fallback?.oauthPort ?? options.defaultOauthPort);
  const credentials = readGoogleCredentialsFile(credentialsPath);

  return {
    enabled: parseBoolean(env[`${prefix}ENABLED`], alias === "primary" ? (fallback?.enabled ?? false) : false),
    clientId: env[`${prefix}CLIENT_ID`]?.trim() || credentials.clientId || fallback?.clientId,
    clientSecret: env[`${prefix}CLIENT_SECRET`]?.trim() || credentials.clientSecret || fallback?.clientSecret,
    redirectUri:
      env[`${prefix}REDIRECT_URI`]?.trim() ||
      credentials.redirectUri ||
      fallback?.redirectUri ||
      `http://127.0.0.1:${oauthPort}/oauth2callback`,
    oauthPort,
    credentialsPath,
    tokenPath,
    extraScopes: parseStringList(env[`${prefix}EXTRA_SCOPES`] ?? fallback?.extraScopes?.join(",")),
    calendarId: env[`${prefix}CALENDAR_ID`]?.trim() || fallback?.calendarId || "primary",
    calendarAliases: parseAliasMap(
      env[`${prefix}CALENDAR_ALIASES`],
      fallback?.calendarAliases ?? { principal: "primary", pessoal: "primary", personal: "primary" },
    ),
    defaultTimezone:
      env[`${prefix}DEFAULT_TIMEZONE`]?.trim() ||
      fallback?.defaultTimezone ||
      env.AGENT_TIMEZONE?.trim() ||
      "America/Sao_Paulo",
    maxEvents: parsePositiveInteger(env[`${prefix}MAX_EVENTS`], fallback?.maxEvents ?? 10),
    maxTasks: parsePositiveInteger(env[`${prefix}MAX_TASKS`], fallback?.maxTasks ?? 15),
    maxContacts: parsePositiveInteger(env[`${prefix}MAX_CONTACTS`], fallback?.maxContacts ?? 10),
  };
}

function buildGoogleMapsConfig(env: NodeJS.ProcessEnv): GoogleMapsConfig {
  const apiKey = env.GOOGLE_MAPS_API_KEY?.trim() || undefined;
  return {
    enabled: parseBoolean(env.GOOGLE_MAPS_ENABLED, Boolean(apiKey)),
    apiKey,
    defaultRegionCode: (env.GOOGLE_MAPS_DEFAULT_REGION ?? "BR").trim().toUpperCase(),
    defaultLanguageCode: (env.GOOGLE_MAPS_DEFAULT_LANGUAGE ?? "pt-BR").trim(),
  };
}

function buildAltivaConfig(env: NodeJS.ProcessEnv, fallbackTimezone: string): AltivaConfig {
  const apiBaseUrl = env.ALTIVA_API_BASE_URL?.trim() || undefined;
  const apiKey = env.ALTIVA_API_KEY?.trim() || undefined;
  const snapshotPath = env.ALTIVA_SNAPSHOT_PATH?.trim() || undefined;
  const enabled = parseBoolean(env.ALTIVA_ENABLED, Boolean(apiBaseUrl || snapshotPath));

  return {
    enabled,
    companyName: env.ALTIVA_COMPANY_NAME?.trim() || "Altiva",
    siteUrl: env.ALTIVA_SITE_URL?.trim() || undefined,
    apiBaseUrl,
    apiKey,
    snapshotPath,
    timezone: env.ALTIVA_TIMEZONE?.trim() || fallbackTimezone,
    trackedMetrics: parseStringList(env.ALTIVA_TRACKED_METRICS)
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function buildBriefingConfig(env: NodeJS.ProcessEnv): BriefingConfig {
  const weatherLocation = env.BRIEFING_WEATHER_LOCATION?.trim() || "Porto Alegre, RS, Brasil";
  return {
    weatherEnabled: parseBoolean(env.BRIEFING_WEATHER_ENABLED, true),
    weatherLocation,
    weatherDays: Math.min(Math.max(parsePositiveInteger(env.BRIEFING_WEATHER_DAYS, 2), 1), 3),
  };
}

function buildExternalReasoningConfig(env: NodeJS.ProcessEnv): ExternalReasoningConfig {
  const baseUrl = env.EXTERNAL_REASONING_BASE_URL?.trim() || undefined;
  const apiKey = env.EXTERNAL_REASONING_API_KEY?.trim() || undefined;
  const rawMode = env.EXTERNAL_REASONING_MODE?.trim().toLowerCase();
  const mode: ExternalReasoningMode =
    rawMode === "off" || rawMode === "smart" || rawMode === "always"
      ? rawMode
      : parseBoolean(env.EXTERNAL_REASONING_ENABLED, false)
        ? "smart"
        : "off";
  return {
    mode,
    enabled: mode !== "off" && Boolean(baseUrl),
    baseUrl,
    apiKey,
    timeoutMs: parsePositiveInteger(env.EXTERNAL_REASONING_TIMEOUT_MS, 20_000),
    routeSimpleReads: parseBoolean(env.EXTERNAL_REASONING_ROUTE_SIMPLE_READS, false),
  };
}

function buildPresenceConfig(env: NodeJS.ProcessEnv): PresenceConfig {
  const startDelayMs = parsePositiveInteger(env.PRESENCE_START_DELAY_MS, 1200);
  const refreshIntervalMs = parsePositiveInteger(env.PRESENCE_REFRESH_INTERVAL_MS, 4000);
  const maxDurationMs = parsePositiveInteger(env.PRESENCE_MAX_DURATION_MS, 25_000);
  return {
    enabled: parseBoolean(env.PRESENCE_ENABLED, true),
    startDelayMs,
    refreshIntervalMs,
    progressDelayMs: Math.min(parsePositiveInteger(env.PRESENCE_PROGRESS_DELAY_MS, 8000), maxDurationMs),
    maxDurationMs,
  };
}

function buildVoiceConfig(env: NodeJS.ProcessEnv, workspaceDir: string): VoiceConfig {
  const rawProvider = env.VOICE_STT_PROVIDER?.trim().toLowerCase();
  const sttProvider: VoiceSttProvider = rawProvider === "command" ? "command" : "openai";
  return {
    enabled: parseBoolean(env.VOICE_ENABLED, false),
    sttProvider,
    maxAudioSeconds: parsePositiveInteger(env.VOICE_MAX_AUDIO_SECONDS, 90),
    maxAudioBytes: parsePositiveInteger(env.VOICE_MAX_AUDIO_BYTES, 15 * 1024 * 1024),
    tempDir: path.resolve(
      env.VOICE_TEMP_DIR?.trim() || path.join(workspaceDir, ".agent-state", "voice-temp"),
    ),
    sttCommand: env.VOICE_STT_COMMAND?.trim() || undefined,
    sttArgs: parseStringList(env.VOICE_STT_ARGS),
    sttTimeoutMs: parsePositiveInteger(env.VOICE_STT_TIMEOUT_MS, 120_000),
    openAiModel: env.VOICE_OPENAI_MODEL?.trim() || "gpt-4o-mini-transcribe",
  };
}

function buildMediaConfig(env: NodeJS.ProcessEnv): MediaConfig {
  const pexelsApiKey = env.PEXELS_API_KEY?.trim() || undefined;
  const pexelsEnabled = parseBoolean(env.PEXELS_ENABLED, Boolean(pexelsApiKey));
  const falApiKey = env.FAL_API_KEY?.trim() || undefined;
  const falEnabled = parseBoolean(env.FAL_ENABLED, Boolean(falApiKey));
  const klingAccessKey = env.KLING_ACCESS_KEY?.trim() || undefined;
  const klingSecretKey = env.KLING_SECRET_KEY?.trim() || undefined;
  const klingEnabled = parseBoolean(
    env.KLING_ENABLED,
    Boolean(klingAccessKey && klingSecretKey),
  );
  const providerStrategy = (env.MEDIA_PROVIDER_STRATEGY?.trim().toLowerCase() ?? "balanced");
  const premiumSceneProvider = (env.MEDIA_PREMIUM_SCENE_PROVIDER?.trim().toLowerCase() ?? "fal");
  return {
    enabled: pexelsEnabled || falEnabled || klingEnabled,
    providerStrategy:
      providerStrategy === "premium" || providerStrategy === "cost"
        ? providerStrategy
        : "balanced",
    premiumSceneProvider: premiumSceneProvider === "kling" ? "kling" : "fal",
    pexelsEnabled,
    pexelsApiKey,
    pexelsMaxResultsPerScene: parsePositiveInteger(env.PEXELS_MAX_RESULTS_PER_SCENE, 1),
    pexelsMaxScenesPerRequest: parsePositiveInteger(env.PEXELS_MAX_SCENES_PER_REQUEST, 5),
    pexelsMinDurationSeconds: parsePositiveInteger(env.PEXELS_MIN_DURATION_SECONDS, 4),
    pexelsCacheTtlSeconds: parsePositiveInteger(env.PEXELS_CACHE_TTL_SECONDS, 86400),
    falEnabled,
    falApiKey,
    falTextToVideoModel: env.FAL_TEXT_TO_VIDEO_MODEL?.trim() || "fal-ai/wan/v2.7/text-to-video",
    falRequestTimeoutSeconds: parsePositiveInteger(env.FAL_REQUEST_TIMEOUT_SECONDS, 45),
    falMaxPollSeconds: parsePositiveInteger(env.FAL_MAX_POLL_SECONDS, 300),
    falDefaultResolution:
      env.FAL_DEFAULT_RESOLUTION?.trim() === "1080p"
        ? "1080p"
        : "720p",
    klingEnabled,
    klingAccessKey,
    klingSecretKey,
    klingApiBaseUrl: env.KLING_API_BASE_URL?.trim() || "https://api.klingai.com",
    klingTextToVideoModel: env.KLING_TEXT_TO_VIDEO_MODEL?.trim() || "kling-v1",
    klingDirectGenerationEnabled: parseBoolean(env.KLING_DIRECT_GENERATION_ENABLED, false),
    klingRequestTimeoutSeconds: parsePositiveInteger(env.KLING_REQUEST_TIMEOUT_SECONDS, 90),
    klingMaxPollSeconds: parsePositiveInteger(env.KLING_MAX_POLL_SECONDS, 300),
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  env = mergeEnvWithFiles(env);
  const appHome = path.resolve(env.APP_HOME ?? process.cwd());
  const workspaceDir = path.resolve(env.WORKSPACE_DIR ?? env.HOST_AGENT_WORKSPACE ?? path.join(appHome, "workspace"));
  const pluginsDir = path.resolve(env.PLUGINS_DIR ?? env.HOST_AGENT_PLUGINS ?? path.join(appHome, "plugins"));
  const logsDir = path.resolve(env.LOGS_DIR ?? env.HOST_AGENT_LOGS ?? path.join(appHome, "logs"));
  const authorizedProjectsDir = path.resolve(
    env.AUTHORIZED_PROJECTS_DIR ?? env.HOST_AUTHORIZED_PROJECTS_DIR ?? path.join(appHome, "authorized-projects"),
  );
  const builtInPluginsDir = existsSync(path.join(appHome, "dist", "plugins"))
    ? path.join(appHome, "dist", "plugins")
    : path.join(appHome, "src", "plugins");
  const googleOauthPort = parsePositiveInteger(env.GOOGLE_OAUTH_PORT, 8787);
  const defaultSafeExecCommands = [
    ["git", "status", "--short"],
    ["git", "branch", "--show-current"],
    ["git", "diff", "--stat"],
    ["npm", "ci"],
    ["npm", "install"],
    ["npm", "run", "build"],
    ["npm", "test"],
    ["pnpm", "install"],
    ["pnpm", "build"],
    ["pnpm", "test"],
    ["yarn", "install"],
    ["yarn", "build"],
    ["yarn", "test"],
  ];
  const defaultMacWorkerCommands = [
    ["open", "-a"],
    ["open", "-g"],
    ["open"],
    ["code"],
    ["git", "status"],
    ["git", "branch", "--show-current"],
    ["npm", "run", "build"],
    ["npm", "run", "dev"],
    ["npm", "test"],
    ["pnpm", "build"],
    ["pnpm", "dev"],
    ["pnpm", "test"],
    ["yarn", "build"],
    ["yarn", "dev"],
    ["yarn", "test"],
    ["osascript", "-e"],
  ];
  const baseEmailConfig = buildEmailConfig(env, "EMAIL_");
  const emailAccounts: Record<string, EmailConfig> = {
    primary: baseEmailConfig,
  };
  for (const alias of parseAccountAliases(env.EMAIL_ACCOUNTS)) {
    if (alias === "primary") {
      continue;
    }
    const prefix = `EMAIL_ACCOUNT_${alias.toUpperCase()}_`;
    if (!parseBoolean(env[`${prefix}ENABLED`], false)) {
      continue;
    }
    if (!hasExplicitSecondaryEmailConfig(env, prefix)) {
      continue;
    }
    emailAccounts[alias] = buildEmailConfig(env, prefix, buildSecondaryEmailFallback(baseEmailConfig));
  }
  const baseGoogleConfig = buildGoogleConfig(env, {
    prefix: "GOOGLE_",
    workspaceDir,
    defaultOauthPort: googleOauthPort,
    alias: "primary",
  });
  const googleAccounts: Record<string, GoogleWorkspaceConfig> = {
    primary: baseGoogleConfig,
  };
  for (const alias of parseAccountAliases(env.GOOGLE_ACCOUNTS)) {
    if (alias === "primary") {
      continue;
    }
    const prefix = `GOOGLE_ACCOUNT_${alias.toUpperCase()}_`;
    if (!parseBoolean(env[`${prefix}ENABLED`], false)) {
      continue;
    }
    googleAccounts[alias] = buildGoogleConfig(env, {
      prefix,
      fallback: baseGoogleConfig,
      workspaceDir,
      defaultOauthPort: googleOauthPort,
      alias,
    });
  }
  const telegramAllowedUserIds = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
  const telegramOperatorChatIdRaw = env.TELEGRAM_OPERATOR_CHAT_ID?.trim();
  const telegramOperatorChatId = telegramOperatorChatIdRaw
    ? Number.parseInt(telegramOperatorChatIdRaw, 10)
    : telegramAllowedUserIds[0];
  const operatorId = normalizeAccountAlias(env.OPERATOR_ID ?? "operator") || "operator";
  const operatorName = env.OPERATOR_NAME?.trim() || "Operator";
  const operatorChannels: OperatorChannelBinding[] = [];

  if (Number.isFinite(telegramOperatorChatId)) {
    operatorChannels.push({
      channelId: "telegram_operator",
      operatorId,
      provider: "telegram",
      externalId: String(telegramOperatorChatId),
      mode: parseOperatorChannelMode(env.TELEGRAM_OPERATOR_MODE, "backup_operator"),
      enabled: true,
      displayName: env.TELEGRAM_OPERATOR_DISPLAY_NAME?.trim() || "Telegram operador",
    });
  }

  const whatsappOperatorNumber = normalizeDigits(env.WHATSAPP_OPERATOR_NUMBER);
  if (whatsappOperatorNumber) {
    operatorChannels.push({
      channelId: "whatsapp_operator",
      operatorId,
      provider: "whatsapp",
      externalId: whatsappOperatorNumber,
      mode: parseOperatorChannelMode(env.WHATSAPP_OPERATOR_MODE, "direct_operator"),
      enabled: true,
      displayName: env.WHATSAPP_OPERATOR_DISPLAY_NAME?.trim() || "WhatsApp operador",
    });
  }

  const monitoredInstances = parseStringList(
    env.WHATSAPP_MONITORED_INSTANCES?.trim()
      || env.EVOLUTION_INSTANCE_NAME?.trim()
      || undefined,
  );
  for (const instanceName of monitoredInstances) {
    operatorChannels.push({
      channelId: `whatsapp_monitored_${instanceName}`,
      operatorId,
      provider: "whatsapp",
      externalId: instanceName,
      mode: "monitored",
      enabled: true,
      displayName: `WhatsApp monitorado ${instanceName}`,
      metadata: {
        instanceName,
      },
    });
  }

  const preferredAlertChannelId = env.OPERATOR_ALERT_CHANNEL?.trim()
    || operatorChannels.find((item) => item.provider === "telegram")?.channelId
    || operatorChannels.find((item) => item.mode === "direct_operator")?.channelId
    || undefined;

  return {
    paths: {
      appHome,
      workspaceDir,
      pluginsDir,
      logsDir,
      authorizedProjectsDir,
      builtInPluginsDir,
      memoryDbPath: path.join(workspaceDir, ".agent-state", "operational-memory.sqlite"),
      goalDbPath: path.join(workspaceDir, ".agent-state", "active-goals.sqlite"),
      preferencesDbPath: path.join(workspaceDir, ".agent-state", "user-preferences.sqlite"),
      growthDbPath: path.join(workspaceDir, ".agent-state", "growth-ops.sqlite"),
      contentDbPath: path.join(workspaceDir, ".agent-state", "content-ops.sqlite"),
      socialAssistantDbPath: path.join(workspaceDir, ".agent-state", "social-assistant.sqlite"),
      workflowDbPath: path.join(workspaceDir, ".agent-state", "workflow-orchestrator.sqlite"),
      memoryEntityDbPath: path.join(workspaceDir, ".agent-state", "memory-entities.sqlite"),
      contactIntelligenceDbPath: path.join(workspaceDir, ".agent-state", "contact-intelligence.sqlite"),
      approvalInboxDbPath: path.join(workspaceDir, ".agent-state", "approval-inbox.sqlite"),
      clarificationInboxDbPath: path.join(workspaceDir, ".agent-state", "clarification-inbox.sqlite"),
      whatsappMessagesDbPath: path.join(workspaceDir, ".agent-state", "whatsapp-messages.sqlite"),
      userBehaviorModelDbPath: path.join(workspaceDir, ".agent-state", "user-behavior-model.sqlite"),
    },
    llm: buildLlmConfig(env),
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
      allowedUserIds: telegramAllowedUserIds,
      pollTimeoutSeconds: parsePositiveInteger(env.TELEGRAM_POLL_TIMEOUT_SECONDS, 30),
      morningBriefEnabled: parseBoolean(env.TELEGRAM_MORNING_BRIEF_ENABLED, true),
      dailyEditorialAutomationEnabled: parseBoolean(env.TELEGRAM_DAILY_EDITORIAL_AUTOMATION_ENABLED, false),
      operationalModeHours: parsePositiveInteger(env.TELEGRAM_OPERATIONAL_MODE_HOURS, 18),
      typingEnabled: parseBoolean(env.TELEGRAM_TYPING_ENABLED, true),
    },
    presence: buildPresenceConfig(env),
    voice: buildVoiceConfig(env, workspaceDir),
    briefing: buildBriefingConfig(env),
    externalReasoning: buildExternalReasoningConfig(env),
    email: baseEmailConfig,
    emailAccounts,
    google: baseGoogleConfig,
    googleAccounts,
    googleMaps: buildGoogleMapsConfig(env),
    altiva: buildAltivaConfig(env, env.GOOGLE_DEFAULT_TIMEZONE?.trim() || "America/Sao_Paulo"),
    media: buildMediaConfig(env),
    safeExec: {
      enabled: parseBoolean(env.SAFE_EXEC_ENABLED, true),
      allowedCommands: parseCommandMatrix(env.SAFE_EXEC_ALLOWED_COMMANDS, defaultSafeExecCommands),
      maxOutputChars: parsePositiveInteger(env.SAFE_EXEC_MAX_OUTPUT_CHARS, 8000),
      auditLogPath: path.join(logsDir, "safe-exec-audit.jsonl"),
    },
    supabaseMacQueue: {
      enabled: parseBoolean(env.SUPABASE_MAC_QUEUE_ENABLED, false),
      url: env.SUPABASE_URL?.trim() || undefined,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined,
      commandsTable: env.SUPABASE_MAC_COMMANDS_TABLE?.trim() || "mac_commands",
      workersTable: env.SUPABASE_MAC_WORKERS_TABLE?.trim() || "mac_workers",
      targetHost: env.SUPABASE_MAC_TARGET_HOST?.trim() || "atlas_mac",
      pollIntervalSeconds: parsePositiveInteger(env.SUPABASE_MAC_POLL_SECONDS, 15),
      maxExecutionSeconds: parsePositiveInteger(env.SUPABASE_MAC_MAX_EXEC_SECONDS, 300),
      allowedCommands: parseCommandMatrix(env.SUPABASE_MAC_ALLOWED_COMMANDS, defaultMacWorkerCommands),
      allowedCwds: parseStringList(env.SUPABASE_MAC_ALLOWED_CWDS ?? `${workspaceDir},${appHome}`),
    },
    operator: {
      operatorId,
      name: operatorName,
      preferredAlertChannelId,
      channels: operatorChannels,
    },
    whatsapp: {
      enabled: parseBoolean(env.WHATSAPP_ENABLED, true)
        && Boolean(
          (env.EVOLUTION_API_URL ?? env.EVOLUTION_SERVER_URL)?.trim()
          && env.EVOLUTION_API_KEY?.trim(),
        ),
      apiUrl: (env.EVOLUTION_API_URL ?? env.EVOLUTION_SERVER_URL)?.trim() || undefined,
      apiKey: env.EVOLUTION_API_KEY?.trim() || undefined,
      defaultInstanceName: env.EVOLUTION_INSTANCE_NAME?.trim() || undefined,
      defaultAccountAlias: normalizeAccountAlias(env.WHATSAPP_DEFAULT_ACCOUNT ?? "primary") || "primary",
      instanceAccounts: parsePlainMap(
        env.WHATSAPP_INSTANCE_ACCOUNTS,
        env.EVOLUTION_INSTANCE_NAME?.trim()
          ? { [env.EVOLUTION_INSTANCE_NAME.trim()]: normalizeAccountAlias(env.WHATSAPP_DEFAULT_ACCOUNT ?? "primary") || "primary" }
          : undefined,
      ),
      sidecarEnabled: parseBoolean(env.WHATSAPP_SIDECAR_ENABLED, false),
      conversationEnabled: parseBoolean(env.WHATSAPP_CONVERSATION_ENABLED, false),
      allowedNumbers: parseStringList(env.WHATSAPP_ALLOWED_NUMBERS),
      unauthorizedMode: parseWhatsAppUnauthorizedMode(env.WHATSAPP_UNAUTHORIZED_MODE),
      ignoreGroups: parseBoolean(env.WHATSAPP_IGNORE_GROUPS, true),
      sidecarPort: parsePositiveInteger(env.WHATSAPP_SIDECAR_PORT, 8790),
      webhookPath: env.WHATSAPP_SIDECAR_WEBHOOK_PATH?.trim() || "/webhooks/evolution",
      notifyTelegramChatId: (() => {
        const raw = env.WHATSAPP_NOTIFY_TELEGRAM_CHAT_ID?.trim();
        if (!raw) {
          return undefined;
        }
        const parsed = Number.parseInt(raw, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
      })(),
    },
    runtime: {
      nodeEnv: env.NODE_ENV?.trim() || "development",
      logLevel: parseLogLevel(env.LOG_LEVEL),
      maxToolIterations: DEFAULT_MAX_TOOL_ITERATIONS,
    },
  };
}
