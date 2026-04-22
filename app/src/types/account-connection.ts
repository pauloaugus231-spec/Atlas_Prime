import type { IntegrationProviderId } from "./integration-provider.js";

export type AccountConnectionStatus = "active" | "revoked" | "expired" | "error" | "pending";

export interface AccountConnection {
  id: string;
  userId: string;
  provider: IntegrationProviderId;
  providerAccountId: string;
  providerEmail?: string;
  scopes: string[];
  tokenVaultRef?: string;
  status: AccountConnectionStatus;
  connectedAt: string;
  lastRefreshAt?: string;
  lastUsedAt?: string;
  metadata?: Record<string, string>;
}
