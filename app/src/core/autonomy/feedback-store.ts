import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { AutonomyFeedbackRecord } from "../../types/autonomy.js";

function mapFeedback(row: Record<string, unknown>): AutonomyFeedbackRecord {
  return {
    id: String(row.id),
    suggestionId: String(row.suggestion_id),
    feedbackKind: String(row.feedback_kind) as AutonomyFeedbackRecord["feedbackKind"],
    ...(row.note ? { note: String(row.note) } : {}),
    createdAt: String(row.created_at),
  };
}

export class FeedbackStore {
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
      CREATE TABLE IF NOT EXISTS autonomy_feedback (
        id TEXT PRIMARY KEY,
        suggestion_id TEXT NOT NULL,
        feedback_kind TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autonomy_feedback_suggestion_id
        ON autonomy_feedback(suggestion_id, created_at DESC);
    `);
  }

  record(input: Omit<AutonomyFeedbackRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): AutonomyFeedbackRecord {
    const record: AutonomyFeedbackRecord = {
      id: input.id?.trim() || randomUUID(),
      suggestionId: input.suggestionId,
      feedbackKind: input.feedbackKind,
      ...(input.note ? { note: input.note.trim() } : {}),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO autonomy_feedback (id, suggestion_id, feedback_kind, note, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.suggestionId,
      record.feedbackKind,
      record.note ?? null,
      record.createdAt,
    );

    this.logger.debug("Autonomy feedback recorded", {
      feedbackId: record.id,
      suggestionId: record.suggestionId,
      feedbackKind: record.feedbackKind,
    });
    return record;
  }

  listBySuggestion(suggestionId: string): AutonomyFeedbackRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM autonomy_feedback
      WHERE suggestion_id = ?
      ORDER BY created_at DESC
    `).all(suggestionId) as Array<Record<string, unknown>>;
    return rows.map(mapFeedback);
  }

  listRecent(limit = 50): AutonomyFeedbackRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM autonomy_feedback
      ORDER BY created_at DESC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapFeedback);
  }
}
