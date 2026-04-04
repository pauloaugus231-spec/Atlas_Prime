import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { GoogleWorkspaceConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export interface GoogleAuthStatus {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  ready: boolean;
  writeReady?: boolean;
  extraScopesReady?: boolean;
  grantedScopes?: string[];
  requiredScopes?: string[];
  redirectUri?: string;
  credentialsPath: string;
  tokenPath: string;
  message: string;
}

export interface GoogleTokenPayload {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  expires_in?: number;
}

export const GOOGLE_WORKSPACE_READ_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/tasks.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
];

export const GOOGLE_WORKSPACE_WRITE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/contacts.readonly",
];

export const GOOGLE_GMAIL_READ_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export const GOOGLE_GMAIL_SEND_SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export const GOOGLE_YOUTUBE_UPLOAD_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"];

function uniqueScopes(scopes: string[]): string[] {
  return [...new Set(scopes)];
}

export const GOOGLE_WORKSPACE_SCOPES = uniqueScopes([
  ...GOOGLE_WORKSPACE_WRITE_SCOPES,
  ...GOOGLE_GMAIL_READ_SCOPES,
  ...GOOGLE_GMAIL_SEND_SCOPES,
]);

interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function formBody(data: Record<string, string>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) {
    params.set(key, value);
  }
  return params;
}

export class GoogleWorkspaceAuthService {
  constructor(
    private readonly config: GoogleWorkspaceConfig,
    private readonly logger: Logger,
  ) {}

  getRequestedScopes(): string[] {
    return uniqueScopes([
      ...GOOGLE_WORKSPACE_SCOPES,
      ...this.config.extraScopes,
    ]);
  }

  getStatus(): GoogleAuthStatus {
    if (!this.config.enabled) {
      return {
        enabled: false,
        configured: false,
        authenticated: false,
        ready: false,
        credentialsPath: this.config.credentialsPath,
        tokenPath: this.config.tokenPath,
        message: "Google Workspace integration is disabled. Set GOOGLE_ENABLED=true to enable it.",
      };
    }

    const clientConfig = this.resolveClientConfig();
    if (!clientConfig) {
      return {
        enabled: true,
        configured: false,
        authenticated: false,
        ready: false,
        redirectUri: this.config.redirectUri,
        credentialsPath: this.config.credentialsPath,
        tokenPath: this.config.tokenPath,
        message:
          "Google integration is enabled but missing OAuth credentials. Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or provide GOOGLE_CREDENTIALS_PATH.",
      };
    }

    const tokens = this.readTokenPayload();
    if (!tokens?.refresh_token && !tokens?.access_token) {
      return {
        enabled: true,
        configured: true,
        authenticated: false,
        ready: false,
        redirectUri: clientConfig.redirectUri,
        credentialsPath: this.config.credentialsPath,
        tokenPath: this.config.tokenPath,
        message:
          "Google integration is configured but not authenticated. Run npm run google:auth after exposing the local callback port.",
      };
    }

    const grantedScopes = this.getGrantedScopes(tokens);
    const writeReady = this.hasGrantedScopes(GOOGLE_WORKSPACE_WRITE_SCOPES, tokens);
    const extraScopesReady = this.hasGrantedScopes(this.config.extraScopes, tokens);

    return {
      enabled: true,
      configured: true,
      authenticated: true,
      ready: true,
      writeReady,
      extraScopesReady,
      grantedScopes,
      requiredScopes: this.getRequestedScopes(),
      redirectUri: clientConfig.redirectUri,
      credentialsPath: this.config.credentialsPath,
      tokenPath: this.config.tokenPath,
      message: !writeReady
        ? "Google Workspace integration ready in read-only secretary mode. Re-run npm run google:auth to grant write scopes for task and event creation."
        : extraScopesReady
          ? "Google Workspace integration ready with requested extra scopes."
          : "Google Workspace integration ready, but configured extra scopes are still missing. Re-run npm run google:auth.",
    };
  }

  createAuthUrl(scopes = this.getRequestedScopes()): string {
    const clientConfig = this.requireClientConfig();
    const params = new URLSearchParams({
      client_id: clientConfig.clientId,
      redirect_uri: clientConfig.redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<GoogleTokenPayload> {
    const clientConfig = this.requireClientConfig();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody({
        code,
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        redirect_uri: clientConfig.redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const payload = (await response.json()) as GoogleTokenPayload & { error?: string; error_description?: string };
    if (!response.ok) {
      throw new Error(
        payload.error_description || payload.error || `Google token exchange failed with status ${response.status}`,
      );
    }

    const normalized = this.normalizeTokens(payload);
    this.persistTokens(normalized);
    return normalized;
  }

  async getAccessToken(): Promise<string> {
    const current = this.readTokenPayload();
    if (!current?.access_token && !current?.refresh_token) {
      throw new Error(
        "Google integration is not authenticated. Run npm run google:auth after configuring OAuth credentials.",
      );
    }

    if (current.access_token && current.expiry_date && current.expiry_date > Date.now() + 60_000) {
      return current.access_token;
    }

    if (current.access_token && !current.expiry_date) {
      return current.access_token;
    }

    if (!current.refresh_token) {
      throw new Error("Google refresh token is missing. Re-run npm run google:auth.");
    }

    const refreshed = await this.refreshAccessToken(current.refresh_token, current);
    return refreshed.access_token as string;
  }

  hasGrantedScopes(requiredScopes: string[], tokens?: GoogleTokenPayload | null): boolean {
    const grantedScopes = new Set(this.getGrantedScopes(tokens));
    return requiredScopes.every((scope) => grantedScopes.has(scope));
  }

  getGrantedScopes(tokens?: GoogleTokenPayload | null): string[] {
    const payload = tokens ?? this.readTokenPayload();
    const scopeString = payload?.scope?.trim();
    if (!scopeString) {
      return [];
    }

    return scopeString
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  private async refreshAccessToken(
    refreshToken: string,
    current: GoogleTokenPayload,
  ): Promise<GoogleTokenPayload> {
    const clientConfig = this.requireClientConfig();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody({
        client_id: clientConfig.clientId,
        client_secret: clientConfig.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const payload = (await response.json()) as GoogleTokenPayload & { error?: string; error_description?: string };
    if (!response.ok) {
      throw new Error(
        payload.error_description || payload.error || `Google token refresh failed with status ${response.status}`,
      );
    }

    const normalized = this.normalizeTokens({
      ...current,
      ...payload,
      refresh_token: current.refresh_token,
    });
    this.persistTokens(normalized);
    return normalized;
  }

  private normalizeTokens(tokens: GoogleTokenPayload): GoogleTokenPayload {
    const normalized: GoogleTokenPayload = {
      ...tokens,
    };
    if (tokens.expires_in) {
      normalized.expiry_date = Date.now() + tokens.expires_in * 1000;
    }
    return normalized;
  }

  private requireClientConfig(): OAuthClientConfig {
    const clientConfig = this.resolveClientConfig();
    if (!clientConfig) {
      throw new Error(
        "Google OAuth client is not configured. Provide GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or GOOGLE_CREDENTIALS_PATH.",
      );
    }

    return clientConfig;
  }

  private resolveClientConfig(): OAuthClientConfig | null {
    const clientId = this.config.clientId?.trim();
    const clientSecret = this.config.clientSecret?.trim();
    const redirectUri = this.config.redirectUri?.trim();
    if (!clientId || !clientSecret || !redirectUri) {
      return null;
    }

    return {
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  private readTokenPayload(): GoogleTokenPayload | null {
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
    if (refreshToken) {
      return {
        refresh_token: refreshToken,
      };
    }

    if (!existsSync(this.config.tokenPath)) {
      return null;
    }

    try {
      const raw = readFileSync(this.config.tokenPath, "utf8");
      return JSON.parse(raw) as GoogleTokenPayload;
    } catch (error) {
      this.logger.warn("Failed to read Google token file", {
        tokenPath: this.config.tokenPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private persistTokens(tokens: GoogleTokenPayload): void {
    mkdirSync(path.dirname(this.config.tokenPath), { recursive: true });
    writeFileSync(this.config.tokenPath, JSON.stringify(tokens, null, 2), "utf8");
  }
}
