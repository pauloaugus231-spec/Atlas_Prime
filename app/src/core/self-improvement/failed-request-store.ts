import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { FailedRequestRecord } from "../../types/self-improvement.js";

interface FailedRequestRow {
  id: number;
  signature: string;
  channel: string;
  prompt: string;
  error_message: string;
  error_kind: string;
  recurrence: number;
  created_at: string;
  updated_at: string;
  last_observed_at: string;
}

function mapRow(row: FailedRequestRow | undefined): FailedRequestRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    signature: row.signature,
    channel: row.channel,
    prompt: row.prompt,
    errorMessage: row.error_message,
    errorKind: row.error_kind,
    recurrence: row.recurrence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastObservedAt: row.last_observed_at,
  };
}

function signatureFor(prompt: string, errorKind: string): string {
  return createHash("sha1").update(`${prompt.trim().toLowerCase()}|${errorKind.trim().toLowerCase()}`).digest("hex");
}

export class FailedRequestStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS failed_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signature TEXT NOT NULL UNIQUE,
        channel TEXT NOT NULL,
        prompt TEXT NOT NULL,
        error_message TEXT NOT NULL,
        error_kind TEXT NOT NULL,
        recurrence INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL
      );
    `);
  }

  record(input: { channel: string; prompt: string; errorMessage: string; errorKind: string }): FailedRequestRecord {
    const signature = signatureFor(input.prompt, input.errorKind);
    const existing = this.db.prepare(`SELECT * FROM failed_requests WHERE signature = ? LIMIT 1`).get(signature) as FailedRequestRow | undefined;
    if (!existing) {
      const now = new Date().toISOString();
      const row = this.db.prepare(`
        INSERT INTO failed_requests (signature, channel, prompt, error_message, error_kind, recurrence, created_at, updated_at, last_observed_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
        RETURNING *
      `).get(signature, input.channel, input.prompt.trim(), input.errorMessage.trim(), input.errorKind.trim(), now, now, now) as FailedRequestRow | undefined;
      return mapRow(row)!;
    }

    const row = this.db.prepare(`
      UPDATE failed_requests
      SET channel = ?, prompt = ?, error_message = ?, error_kind = ?, recurrence = recurrence + 1, updated_at = ?, last_observed_at = ?
      WHERE signature = ?
      RETURNING *
    `).get(
      input.channel,
      input.prompt.trim(),
      input.errorMessage.trim(),
      input.errorKind.trim(),
      new Date().toISOString(),
      new Date().toISOString(),
      signature,
    ) as FailedRequestRow | undefined;
    return mapRow(row)!;
  }

  list(limit = 20): FailedRequestRecord[] {
    const rows = this.db.prepare(`SELECT * FROM failed_requests ORDER BY recurrence DESC, updated_at DESC LIMIT ?`).all(limit) as unknown as FailedRequestRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
