import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { AutonomySuggestion } from "../../types/autonomy.js";

function mapSuggestion(row: Record<string, unknown>): AutonomySuggestion {
  return {
    id: String(row.id),
    observationId: String(row.observation_id),
    fingerprint: String(row.fingerprint),
    title: String(row.title),
    body: String(row.body),
    explanation: String(row.explanation),
    ...(row.suggested_action_json
      ? { suggestedAction: JSON.parse(String(row.suggested_action_json)) as AutonomySuggestion["suggestedAction"] }
      : {}),
    status: String(row.status) as AutonomySuggestion["status"],
    priority: Number(row.priority),
    requiresApproval: Number(row.requires_approval) === 1,
    ...(row.due_at ? { dueAt: String(row.due_at) } : {}),
    ...(row.snoozed_until ? { snoozedUntil: String(row.snoozed_until) } : {}),
    ...(row.last_notified_at ? { lastNotifiedAt: String(row.last_notified_at) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SuggestionStore {
  private readonly db: DatabaseSync;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 30000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autonomy_suggestions (
        id TEXT PRIMARY KEY,
        observation_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        explanation TEXT NOT NULL,
        suggested_action_json TEXT,
        status TEXT NOT NULL,
        priority REAL NOT NULL,
        requires_approval INTEGER NOT NULL,
        due_at TEXT,
        snoozed_until TEXT,
        last_notified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autonomy_suggestions_status_priority
        ON autonomy_suggestions(status, priority DESC, updated_at DESC);
    `);
  }

  upsert(input: Omit<AutonomySuggestion, "id" | "createdAt" | "updatedAt"> & { id?: string }): AutonomySuggestion {
    const existing = this.getByFingerprint(input.fingerprint);
    const now = new Date().toISOString();
    const record: AutonomySuggestion = {
      id: input.id?.trim() || existing?.id || randomUUID(),
      observationId: input.observationId,
      fingerprint: input.fingerprint,
      title: input.title.trim(),
      body: input.body.trim(),
      explanation: input.explanation.trim(),
      ...(input.suggestedAction ? { suggestedAction: input.suggestedAction } : {}),
      status: input.status,
      priority: Math.max(0, Math.min(1, Number(input.priority))),
      requiresApproval: input.requiresApproval,
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      ...(input.snoozedUntil ? { snoozedUntil: input.snoozedUntil } : {}),
      ...(input.lastNotifiedAt ? { lastNotifiedAt: input.lastNotifiedAt } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO autonomy_suggestions (
        id, observation_id, fingerprint, title, body, explanation, suggested_action_json,
        status, priority, requires_approval, due_at, snoozed_until, last_notified_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        observation_id = excluded.observation_id,
        title = excluded.title,
        body = excluded.body,
        explanation = excluded.explanation,
        suggested_action_json = excluded.suggested_action_json,
        status = excluded.status,
        priority = excluded.priority,
        requires_approval = excluded.requires_approval,
        due_at = excluded.due_at,
        snoozed_until = excluded.snoozed_until,
        last_notified_at = excluded.last_notified_at,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.observationId,
      record.fingerprint,
      record.title,
      record.body,
      record.explanation,
      record.suggestedAction ? JSON.stringify(record.suggestedAction) : null,
      record.status,
      record.priority,
      record.requiresApproval ? 1 : 0,
      record.dueAt ?? null,
      record.snoozedUntil ?? null,
      record.lastNotifiedAt ?? null,
      record.createdAt,
      record.updatedAt,
    );

    this.logger.debug("Autonomy suggestion upserted", {
      suggestionId: record.id,
      fingerprint: record.fingerprint,
      status: record.status,
      priority: record.priority,
    });
    return record;
  }

  getByFingerprint(fingerprint: string): AutonomySuggestion | undefined {
    const row = this.db.prepare(`
      SELECT * FROM autonomy_suggestions
      WHERE fingerprint = ?
      LIMIT 1
    `).get(fingerprint.trim()) as Record<string, unknown> | undefined;
    return row ? mapSuggestion(row) : undefined;
  }

  getById(id: string): AutonomySuggestion | undefined {
    const row = this.db.prepare(`
      SELECT * FROM autonomy_suggestions
      WHERE id = ?
      LIMIT 1
    `).get(id.trim()) as Record<string, unknown> | undefined;
    return row ? mapSuggestion(row) : undefined;
  }

  listByStatus(statuses: AutonomySuggestion["status"][], limit = 20): AutonomySuggestion[] {
    if (statuses.length === 0) {
      return [];
    }
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM autonomy_suggestions
      WHERE status IN (${placeholders})
      ORDER BY priority DESC, updated_at DESC
      LIMIT ?
    `).all(...statuses, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapSuggestion);
  }

  updateStatus(input: {
    id: string;
    status: AutonomySuggestion["status"];
    snoozedUntil?: string;
    lastNotifiedAt?: string;
  }): AutonomySuggestion | undefined {
    const row = this.db.prepare(`
      UPDATE autonomy_suggestions
      SET status = ?,
          snoozed_until = ?,
          last_notified_at = COALESCE(?, last_notified_at),
          updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      input.status,
      input.snoozedUntil ?? null,
      input.lastNotifiedAt ?? null,
      new Date().toISOString(),
      input.id,
    ) as Record<string, unknown> | undefined;
    return row ? mapSuggestion(row) : undefined;
  }
}
