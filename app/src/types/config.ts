import type { LogLevel } from "./logger.js";

export interface AppPathsConfig {
  appHome: string;
  workspaceDir: string;
  pluginsDir: string;
  logsDir: string;
  authorizedProjectsDir: string;
  builtInPluginsDir: string;
  memoryDbPath: string;
  preferencesDbPath: string;
  growthDbPath: string;
  contentDbPath: string;
  socialAssistantDbPath: string;
  workflowDbPath: string;
  memoryEntityDbPath: string;
  contactIntelligenceDbPath: string;
  approvalInboxDbPath: string;
  clarificationInboxDbPath: string;
  whatsappMessagesDbPath: string;
}

export type LlmProvider = "ollama" | "openai";
export type LlmProviderMode = LlmProvider | "fallback";

export interface LlmProviderConfig {
  provider: LlmProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
}

export interface LlmConfig {
  provider: LlmProviderMode;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
  ollama?: LlmProviderConfig;
  openai?: LlmProviderConfig;
  fallback?: {
    primary: LlmProviderConfig;
    secondary: LlmProviderConfig;
  };
}

export interface TelegramConfig {
  botToken?: string;
  allowedUserIds: number[];
  pollTimeoutSeconds: number;
  morningBriefEnabled: boolean;
  dailyEditorialAutomationEnabled: boolean;
  operationalModeHours: number;
}

export type VoiceSttProvider = "openai" | "command";

export interface VoiceConfig {
  enabled: boolean;
  sttProvider: VoiceSttProvider;
  maxAudioSeconds: number;
  maxAudioBytes: number;
  tempDir: string;
  sttCommand?: string;
  sttArgs: string[];
  sttTimeoutMs: number;
  openAiModel: string;
}

export interface BriefingConfig {
  weatherEnabled: boolean;
  weatherLocation: string;
  weatherDays: number;
}

export type ExternalReasoningMode = "off" | "smart" | "always";
export type WhatsAppUnauthorizedMode = "ignore" | "monitor";
export type OperatorChannelProvider = "telegram" | "whatsapp";
export type OperatorChannelMode = "direct_operator" | "backup_operator" | "monitored";

export interface OperatorChannelBinding {
  channelId: string;
  operatorId: string;
  provider: OperatorChannelProvider;
  externalId: string;
  mode: OperatorChannelMode;
  enabled: boolean;
  displayName: string;
  metadata?: Record<string, string>;
}

export interface OperatorConfig {
  operatorId: string;
  name: string;
  preferredAlertChannelId?: string;
  channels: OperatorChannelBinding[];
}

export interface ExternalReasoningConfig {
  mode: ExternalReasoningMode;
  enabled: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  routeSimpleReads: boolean;
}

export interface EmailConfig {
  enabled: boolean;
  host?: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
  mailbox: string;
  lookbackHours: number;
  maxMessages: number;
  maxSourceBytes: number;
  maxTextChars: number;
  writeEnabled: boolean;
  smtpHost?: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername?: string;
  smtpPassword?: string;
  fromName?: string;
  fromAddress?: string;
  replyAllowedSenders: string[];
  replyAllowedDomains: string[];
}

export interface GoogleWorkspaceConfig {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  oauthPort: number;
  credentialsPath: string;
  tokenPath: string;
  extraScopes: string[];
  calendarId: string;
  calendarAliases: Record<string, string>;
  defaultTimezone: string;
  maxEvents: number;
  maxTasks: number;
  maxContacts: number;
}

export interface GoogleMapsConfig {
  enabled: boolean;
  apiKey?: string;
  defaultRegionCode: string;
  defaultLanguageCode: string;
}

export interface AltivaConfig {
  enabled: boolean;
  companyName: string;
  siteUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  snapshotPath?: string;
  timezone: string;
  trackedMetrics: string[];
}

export interface MediaConfig {
  enabled: boolean;
  providerStrategy: "balanced" | "premium" | "cost";
  premiumSceneProvider: "kling" | "fal";
  pexelsEnabled: boolean;
  pexelsApiKey?: string;
  pexelsMaxResultsPerScene: number;
  pexelsMaxScenesPerRequest: number;
  pexelsMinDurationSeconds: number;
  pexelsCacheTtlSeconds: number;
  falEnabled: boolean;
  falApiKey?: string;
  falTextToVideoModel: string;
  falRequestTimeoutSeconds: number;
  falMaxPollSeconds: number;
  falDefaultResolution: "720p" | "1080p";
  klingEnabled: boolean;
  klingAccessKey?: string;
  klingSecretKey?: string;
  klingApiBaseUrl: string;
  klingTextToVideoModel: string;
  klingDirectGenerationEnabled: boolean;
  klingRequestTimeoutSeconds: number;
  klingMaxPollSeconds: number;
}

export interface SafeExecConfig {
  enabled: boolean;
  allowedCommands: string[][];
  maxOutputChars: number;
  auditLogPath: string;
}

export interface SupabaseMacQueueConfig {
  enabled: boolean;
  url?: string;
  serviceRoleKey?: string;
  commandsTable: string;
  workersTable: string;
  targetHost: string;
  pollIntervalSeconds: number;
  maxExecutionSeconds: number;
  allowedCommands: string[][];
  allowedCwds: string[];
}

export interface WhatsAppConfig {
  enabled: boolean;
  apiUrl?: string;
  apiKey?: string;
  defaultInstanceName?: string;
  defaultAccountAlias: string;
  instanceAccounts: Record<string, string>;
  sidecarEnabled: boolean;
  conversationEnabled: boolean;
  allowedNumbers: string[];
  unauthorizedMode: WhatsAppUnauthorizedMode;
  ignoreGroups: boolean;
  sidecarPort: number;
  webhookPath: string;
  notifyTelegramChatId?: number;
}

export interface RuntimeConfig {
  nodeEnv: string;
  logLevel: LogLevel;
  maxToolIterations: number;
}

export interface AppConfig {
  paths: AppPathsConfig;
  llm: LlmConfig;
  telegram: TelegramConfig;
  voice: VoiceConfig;
  briefing: BriefingConfig;
  externalReasoning: ExternalReasoningConfig;
  email: EmailConfig;
  emailAccounts: Record<string, EmailConfig>;
  google: GoogleWorkspaceConfig;
  googleAccounts: Record<string, GoogleWorkspaceConfig>;
  googleMaps: GoogleMapsConfig;
  altiva: AltivaConfig;
  media: MediaConfig;
  safeExec: SafeExecConfig;
  supabaseMacQueue: SupabaseMacQueueConfig;
  operator: OperatorConfig;
  whatsapp: WhatsAppConfig;
  runtime: RuntimeConfig;
}
