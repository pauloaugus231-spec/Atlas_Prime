import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { AutonomyObservation } from "../../types/autonomy.js";

function mapObservation(row: Record<string, unknown>): AutonomyObservation {
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    kind: String(row.kind) as AutonomyObservation["kind"],
    sourceKind: String(row.source_kind) as AutonomyObservation["sourceKind"],
    ...(row.source_id ? { sourceId: String(row.source_id) } : {}),
    sourceTrust: String(row.source_trust) as AutonomyObservation["sourceTrust"],
    title: String(row.title),
    summary: String(row.summary),
    evidence: JSON.parse(String(row.evidence_json)) as string[],
    observedAt: String(row.observed_at),
    ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
  };
}

export class ObservationStore {
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
      CREATE TABLE IF NOT EXISTS autonomy_observations (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT,
        source_trust TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_autonomy_observations_kind
        ON autonomy_observations(kind, observed_at DESC);
    `);
  }

  upsert(input: Omit<AutonomyObservation, "id"> & { id?: string }): AutonomyObservation {
    const existing = this.getByFingerprint(input.fingerprint);
    const record: AutonomyObservation = {
      id: input.id?.trim() || existing?.id || randomUUID(),
      fingerprint: input.fingerprint.trim(),
      kind: input.kind,
      sourceKind: input.sourceKind,
      ...(input.sourceId ? { sourceId: input.sourceId.trim() } : {}),
      sourceTrust: input.sourceTrust,
      title: input.title.trim(),
      summary: input.summary.trim(),
      evidence: input.evidence,
      observedAt: input.observedAt,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };

    this.db.prepare(`
      INSERT INTO autonomy_observations (
        id, fingerprint, kind, source_kind, source_id, source_trust, title, summary, evidence_json, observed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        kind = excluded.kind,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        source_trust = excluded.source_trust,
        title = excluded.title,
        summary = excluded.summary,
        evidence_json = excluded.evidence_json,
        observed_at = excluded.observed_at,
        expires_at = excluded.expires_at
    `).run(
      record.id,
      record.fingerprint,
      record.kind,
      record.sourceKind,
      record.sourceId ?? null,
      record.sourceTrust,
      record.title,
      record.summary,
      JSON.stringify(record.evidence),
      record.observedAt,
      record.expiresAt ?? null,
    );

    this.logger.debug("Autonomy observation upserted", {
      observationId: record.id,
      fingerprint: record.fingerprint,
      kind: record.kind,
    });
    return record;
  }

  getByFingerprint(fingerprint: string): AutonomyObservation | undefined {
    const row = this.db.prepare(`
      SELECT * FROM autonomy_observations
      WHERE fingerprint = ?
      LIMIT 1
    `).get(fingerprint.trim()) as Record<string, unknown> | undefined;
    return row ? mapObservation(row) : undefined;
  }

  listRecent(limit = 20): AutonomyObservation[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM autonomy_observations
      ORDER BY observed_at DESC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapObservation);
  }
}
