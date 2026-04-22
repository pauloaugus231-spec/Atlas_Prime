import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { ConnectionSession, ConnectionSessionChannel, ConnectionSessionStatus } from "../../types/connection-session.js";

interface SessionRow {
  id: string;
  user_id: string;
  channel: string;
  channel_user_id: string;
  provider: string;
  requested_scopes_json: string;
  state: string;
  status: string;
  auth_url: string | null;
  created_at: string;
  expires_at: string;
}

function parseJsonList(value: string | null | undefined): string[] {
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

function mapRow(row: SessionRow | undefined): ConnectionSession | undefined {
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    userId: row.user_id,
    channel: row.channel as ConnectionSessionChannel,
    channelUserId: row.channel_user_id,
    provider: row.provider as ConnectionSession["provider"],
    requestedScopes: parseJsonList(row.requested_scopes_json),
    state: row.state,
    status: row.status as ConnectionSessionStatus,
    ...(row.auth_url ? { authUrl: row.auth_url } : {}),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class ConnectionSessionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS account_connection_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        channel_user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        requested_scopes_json TEXT NOT NULL,
        state TEXT NOT NULL,
        status TEXT NOT NULL,
        auth_url TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_connection_sessions_user_provider
      ON account_connection_sessions(user_id, provider, created_at DESC);
    `);
  }

  create(input: ConnectionSession): ConnectionSession {
    this.db.prepare(`
      INSERT INTO account_connection_sessions (
        id, user_id, channel, channel_user_id, provider, requested_scopes_json, state, status, auth_url, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.userId,
      input.channel,
      input.channelUserId,
      input.provider,
      JSON.stringify(input.requestedScopes),
      input.state,
      input.status,
      input.authUrl ?? null,
      input.createdAt,
      input.expiresAt,
    );
    return input;
  }

  markStatus(id: string, status: ConnectionSessionStatus): ConnectionSession | undefined {
    const row = this.db.prepare(`
      UPDATE account_connection_sessions
      SET status = ?
      WHERE id = ?
      RETURNING *
    `).get(status, id) as SessionRow | undefined;
    return mapRow(row);
  }

  getById(id: string): ConnectionSession | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM account_connection_sessions
      WHERE id = ?
      LIMIT 1
    `).get(id) as SessionRow | undefined;
    return mapRow(row);
  }

  listRecent(userId: string, limit = 10): ConnectionSession[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM account_connection_sessions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit) as unknown as SessionRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }

  getLatestOpen(userId: string, provider: ConnectionSession["provider"]): ConnectionSession | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM account_connection_sessions
      WHERE user_id = ?
        AND provider = ?
        AND status IN ('created', 'opened')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(userId, provider) as SessionRow | undefined;
    return mapRow(row);
  }
}
