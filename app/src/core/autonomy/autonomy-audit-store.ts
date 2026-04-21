import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { AutonomyAuditRecord } from "../../types/autonomy.js";

function mapAudit(row: Record<string, unknown>): AutonomyAuditRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as AutonomyAuditRecord["kind"],
    ...(row.observation_id ? { observationId: String(row.observation_id) } : {}),
    ...(row.suggestion_id ? { suggestionId: String(row.suggestion_id) } : {}),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

export class AutonomyAuditStore {
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
      CREATE TABLE IF NOT EXISTS autonomy_audit (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        observation_id TEXT,
        suggestion_id TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autonomy_audit_created_at
        ON autonomy_audit(created_at DESC);
    `);
  }

  record(input: Omit<AutonomyAuditRecord, "id" | "createdAt"> & { id?: string; createdAt?: string }): AutonomyAuditRecord {
    const record: AutonomyAuditRecord = {
      id: input.id?.trim() || randomUUID(),
      kind: input.kind,
      ...(input.observationId ? { observationId: input.observationId } : {}),
      ...(input.suggestionId ? { suggestionId: input.suggestionId } : {}),
      payload: input.payload,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    this.db.prepare(`
      INSERT INTO autonomy_audit (id, kind, observation_id, suggestion_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.kind,
      record.observationId ?? null,
      record.suggestionId ?? null,
      JSON.stringify(record.payload),
      record.createdAt,
    );

    this.logger.debug("Autonomy audit recorded", {
      auditId: record.id,
      kind: record.kind,
    });
    return record;
  }

  listRecent(limit = 20): AutonomyAuditRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM autonomy_audit
      ORDER BY created_at DESC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapAudit);
  }
}
