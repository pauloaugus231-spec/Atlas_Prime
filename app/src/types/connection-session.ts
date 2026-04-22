import type { IntegrationProviderId } from "./integration-provider.js";

export type ConnectionSessionChannel = "telegram" | "whatsapp" | "web" | "cli";
export type ConnectionSessionStatus = "created" | "opened" | "authorized" | "failed" | "expired";

export interface ConnectionSession {
  id: string;
  userId: string;
  channel: ConnectionSessionChannel;
  channelUserId: string;
  provider: IntegrationProviderId;
  requestedScopes: string[];
  state: string;
  status: ConnectionSessionStatus;
  authUrl?: string;
  createdAt: string;
  expiresAt: string;
}
