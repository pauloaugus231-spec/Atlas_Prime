import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountConnection, AccountConnectionStatus } from "../../types/account-connection.js";
import type { IntegrationProviderId } from "../../types/integration-provider.js";
import type { Logger } from "../../types/logger.js";

interface ConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  provider_email: string | null;
  scopes_json: string;
  token_vault_ref: string | null;
  status: string;
  connected_at: string;
  last_refresh_at: string | null;
  last_used_at: string | null;
  metadata_json: string | null;
}

function parseStringList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: string | null | undefined): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(([, item]) => typeof item === "string");
    return entries.length > 0 ? Object.fromEntries(entries as Array<[string, string]>) : undefined;
  } catch {
    return undefined;
  }
}

function mapRow(row: ConnectionRow | undefined): AccountConnection | undefined {
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider as IntegrationProviderId,
    providerAccountId: row.provider_account_id,
    ...(row.provider_email ? { providerEmail: row.provider_email } : {}),
    scopes: parseStringList(row.scopes_json),
    ...(row.token_vault_ref ? { tokenVaultRef: row.token_vault_ref } : {}),
    status: row.status as AccountConnectionStatus,
    connectedAt: row.connected_at,
    ...(row.last_refresh_at ? { lastRefreshAt: row.last_refresh_at } : {}),
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

export class AccountConnectionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_connections (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        provider_email TEXT,
        scopes_json TEXT NOT NULL,
        token_vault_ref TEXT,
        status TEXT NOT NULL,
        connected_at TEXT NOT NULL,
        last_refresh_at TEXT,
        last_used_at TEXT,
        metadata_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_account_connections_user_provider_account
      ON account_connections(user_id, provider, provider_account_id);
    `);
  }

  upsert(input: AccountConnection): AccountConnection {
    const row = this.db.prepare(`
      INSERT INTO account_connections (
        id, user_id, provider, provider_account_id, provider_email, scopes_json, token_vault_ref, status, connected_at, last_refresh_at, last_used_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider, provider_account_id)
      DO UPDATE SET
        provider_email = excluded.provider_email,
        scopes_json = excluded.scopes_json,
        token_vault_ref = excluded.token_vault_ref,
        status = excluded.status,
        connected_at = excluded.connected_at,
        last_refresh_at = excluded.last_refresh_at,
        last_used_at = excluded.last_used_at,
        metadata_json = excluded.metadata_json
      RETURNING *
    `).get(
      input.id,
      input.userId,
      input.provider,
      input.providerAccountId,
      input.providerEmail ?? null,
      JSON.stringify(input.scopes),
      input.tokenVaultRef ?? null,
      input.status,
      input.connectedAt,
      input.lastRefreshAt ?? null,
      input.lastUsedAt ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ) as ConnectionRow | undefined;
    return mapRow(row)!;
  }

  listByUser(userId: string): AccountConnection[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM account_connections
      WHERE user_id = ?
      ORDER BY connected_at DESC
    `).all(userId) as unknown as ConnectionRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }

  getByProvider(userId: string, provider: IntegrationProviderId): AccountConnection | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM account_connections
      WHERE user_id = ?
        AND provider = ?
      ORDER BY connected_at DESC
      LIMIT 1
    `).get(userId, provider) as ConnectionRow | undefined;
    return mapRow(row);
  }

  setStatus(userId: string, provider: IntegrationProviderId, status: AccountConnectionStatus): AccountConnection | undefined {
    const row = this.db.prepare(`
      UPDATE account_connections
      SET status = ?
      WHERE user_id = ?
        AND provider = ?
      RETURNING *
    `).get(status, userId, provider) as ConnectionRow | undefined;
    return mapRow(row);
  }
}
