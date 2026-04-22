import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../types/config.js";
import type { AccountConnection } from "../../types/account-connection.js";
import type { ConnectionSession, ConnectionSessionChannel } from "../../types/connection-session.js";
import type { IntegrationProviderId } from "../../types/integration-provider.js";
import type { Logger } from "../../types/logger.js";
import { AccountConnectionStore } from "./account-connection-store.js";
import { AccountLinkingRenderer } from "./account-linking-renderer.js";
import { ConnectionSessionStore } from "./connection-session-store.js";
import { OauthProviderRegistry } from "./oauth-provider-registry.js";
import { ProviderPermissions } from "./provider-permissions.js";
import { TokenVault } from "./token-vault.js";

export class AccountLinkingService {
  private readonly renderer = new AccountLinkingRenderer();

  constructor(
    private readonly config: AppConfig,
    private readonly sessions: ConnectionSessionStore,
    private readonly connections: AccountConnectionStore,
    private readonly providers: OauthProviderRegistry,
    private readonly permissions: ProviderPermissions,
    private readonly tokenVault: TokenVault,
    private readonly logger: Logger,
  ) {}

  getCurrentUserId(): string {
    return this.config.operator.operatorId;
  }

  private syncGoogleConnection(userId: string): AccountConnection | undefined {
    const status = this.providers.getStatus("google");
    const existing = this.connections.getByProvider(userId, "google");
    if (!status.authenticated) {
      return existing;
    }
    return this.connections.upsert({
      id: existing?.id ?? randomUUID(),
      userId,
      provider: "google",
      providerAccountId: existing?.providerAccountId ?? "google-primary",
      ...(existing?.providerEmail ? { providerEmail: existing.providerEmail } : {}),
      scopes: status.grantedScopes,
      ...(existing?.tokenVaultRef ? { tokenVaultRef: existing.tokenVaultRef } : {}),
      status: "active",
      connectedAt: existing?.connectedAt ?? new Date().toISOString(),
      metadata: {
        ...(existing?.metadata ?? {}),
        mode: status.ready ? "ready" : "partial",
      },
    });
  }

  listConnections(userId = this.getCurrentUserId()): AccountConnection[] {
    this.syncGoogleConnection(userId);
    return this.connections.listByUser(userId);
  }

  listRecentSessions(userId = this.getCurrentUserId(), limit = 5): ConnectionSession[] {
    return this.sessions.listRecent(userId, limit);
  }

  renderOverview(userId = this.getCurrentUserId()): string {
    const providers = this.providers.listProviders();
    return this.renderer.renderOverview({
      providers,
      permissions: Object.fromEntries(providers.map((provider) => [provider.id, this.permissions.list(provider.id)])),
      connections: this.listConnections(userId),
      sessions: this.listRecentSessions(userId),
    });
  }

  startConnection(input?: {
    userId?: string;
    provider?: IntegrationProviderId;
    permissionKeys?: string[];
    channel?: ConnectionSessionChannel;
    channelUserId?: string;
  }): { reply: string; session?: ConnectionSession; connection?: AccountConnection } {
    const userId = input?.userId ?? this.getCurrentUserId();
    const providerId = input?.provider ?? "google";
    const provider = this.providers.getProvider(providerId);
    if (!provider) {
      return { reply: "Provider de conexão não suportado." };
    }

    const existing = this.connections.getByProvider(userId, providerId);
    const currentStatus = this.providers.getStatus(providerId);
    if (currentStatus.authenticated) {
      const synced = this.syncGoogleConnection(userId);
      return {
        reply: this.renderer.renderStart({
          provider,
          alreadyConnected: true,
          message: currentStatus.message,
        }),
        connection: synced,
      };
    }

    const requestedScopes = this.permissions.resolveScopes(providerId, input?.permissionKeys);
    const authUrl = this.providers.createAuthUrl(providerId, requestedScopes);
    const session: ConnectionSession = {
      id: randomUUID(),
      userId,
      channel: input?.channel ?? "telegram",
      channelUserId: input?.channelUserId ?? userId,
      provider: providerId,
      requestedScopes,
      state: randomUUID(),
      status: "created",
      ...(authUrl ? { authUrl } : {}),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (30 * 60_000)).toISOString(),
    };
    this.sessions.create(session);
    return {
      reply: this.renderer.renderStart({
        provider,
        alreadyConnected: false,
        authUrl,
        message: currentStatus.message,
      }),
      session,
      connection: existing,
    };
  }

  revokeConnection(providerId: IntegrationProviderId, userId = this.getCurrentUserId()): string {
    const provider = this.providers.getProvider(providerId);
    if (!provider) {
      return "Provider de conexão não suportado.";
    }
    const existing = this.connections.getByProvider(userId, providerId);
    if (existing?.tokenVaultRef) {
      this.tokenVault.deleteSecret(existing.tokenVaultRef);
    }
    const updated = this.connections.setStatus(userId, providerId, "revoked");
    return this.renderer.renderRevoke(provider, Boolean(updated));
  }

  async completeConnection(input: {
    sessionId: string;
    code: string;
  }): Promise<{ reply: string; connection?: AccountConnection }> {
    const session = this.sessions.getById(input.sessionId);
    if (!session) {
      return { reply: "Sessão de conexão não encontrada." };
    }
    const provider = this.providers.getProvider(session.provider);
    if (!provider) {
      return { reply: "Provider de conexão não suportado." };
    }
    this.sessions.markStatus(session.id, "opened");
    const authorization = await this.providers.exchangeCode(session.provider, input.code);
    const tokenVaultRef = this.tokenVault.storeSecret(authorization.tokenPayload);
    const connection = this.connections.upsert({
      id: randomUUID(),
      userId: session.userId,
      provider: session.provider,
      providerAccountId: authorization.providerAccountId,
      ...(authorization.providerEmail ? { providerEmail: authorization.providerEmail } : {}),
      scopes: authorization.grantedScopes,
      tokenVaultRef,
      status: "active",
      connectedAt: new Date().toISOString(),
      metadata: {
        source: "oauth_session",
        sessionId: session.id,
      },
    });
    this.sessions.markStatus(session.id, "authorized");
    this.logger.info("Completed account connection", {
      provider: session.provider,
      sessionId: session.id,
      userId: session.userId,
      scopes: authorization.grantedScopes.length,
    });
    return {
      reply: this.renderer.renderAuthorized({
        provider,
        providerAccountId: connection.providerAccountId,
        grantedScopes: connection.scopes,
      }),
      connection,
    };
  }
}
