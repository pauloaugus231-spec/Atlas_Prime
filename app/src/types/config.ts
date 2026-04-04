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
  contactIntelligenceDbPath: string;
  approvalInboxDbPath: string;
  whatsappMessagesDbPath: string;
}

export interface LlmConfig {
  provider: "ollama" | "openai";
  baseUrl: string;
  model: string;
  timeoutMs: number;
  apiKey?: string;
}

export interface TelegramConfig {
  botToken?: string;
  allowedUserIds: number[];
  pollTimeoutSeconds: number;
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
  email: EmailConfig;
  emailAccounts: Record<string, EmailConfig>;
  google: GoogleWorkspaceConfig;
  googleAccounts: Record<string, GoogleWorkspaceConfig>;
  googleMaps: GoogleMapsConfig;
  safeExec: SafeExecConfig;
  supabaseMacQueue: SupabaseMacQueueConfig;
  whatsapp: WhatsAppConfig;
  runtime: RuntimeConfig;
}
