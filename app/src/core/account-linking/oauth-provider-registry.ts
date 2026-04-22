import type { GoogleWorkspaceAuthService } from "../../integrations/google/google-auth.js";
import type { IntegrationProvider, IntegrationProviderId } from "../../types/integration-provider.js";
import { ProviderPermissions } from "./provider-permissions.js";

export interface ProviderAuthorizationResult {
  providerAccountId: string;
  providerEmail?: string;
  grantedScopes: string[];
  tokenPayload: unknown;
}

export interface ProviderRuntimeStatus {
  ready: boolean;
  configured: boolean;
  authenticated: boolean;
  message: string;
  grantedScopes: string[];
}

export class OauthProviderRegistry {
  constructor(
    private readonly googleAuth: GoogleWorkspaceAuthService,
    private readonly permissions: ProviderPermissions,
  ) {}

  listProviders(): IntegrationProvider[] {
    return [
      {
        id: "google",
        displayName: "Google",
        authType: "oauth2",
        supportsIncrementalScopes: true,
        defaultScopes: this.permissions.resolveScopes("google"),
        sensitiveScopes: this.permissions.resolveScopes("google", ["calendar_tasks_write"]),
        restrictedScopes: this.permissions.resolveScopes("google", ["gmail_read", "gmail_send"]),
      },
    ];
  }

  getProvider(provider: IntegrationProviderId): IntegrationProvider | undefined {
    return this.listProviders().find((item) => item.id === provider);
  }

  getStatus(provider: IntegrationProviderId): ProviderRuntimeStatus {
    switch (provider) {
      case "google": {
        const status = this.googleAuth.getStatus();
        return {
          ready: status.ready,
          configured: status.configured,
          authenticated: status.authenticated,
          message: status.message,
          grantedScopes: status.grantedScopes ?? [],
        };
      }
      default:
        return {
          ready: false,
          configured: false,
          authenticated: false,
          message: "Provider não suportado.",
          grantedScopes: [],
        };
    }
  }

  createAuthUrl(provider: IntegrationProviderId, scopes: string[]): string | undefined {
    switch (provider) {
      case "google":
        return this.googleAuth.createAuthUrl(scopes);
      default:
        return undefined;
    }
  }

  async exchangeCode(provider: IntegrationProviderId, code: string): Promise<ProviderAuthorizationResult> {
    switch (provider) {
      case "google": {
        const tokens = await this.googleAuth.exchangeCodeForTokens(code);
        const grantedScopes = typeof tokens.scope === "string"
          ? tokens.scope.split(/\s+/).map((item) => item.trim()).filter(Boolean)
          : [];
        return {
          providerAccountId: "google-primary",
          grantedScopes,
          tokenPayload: tokens,
        };
      }
      default:
        throw new Error("Provider não suportado.");
    }
  }
}
