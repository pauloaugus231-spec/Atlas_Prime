import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { MemoryCandidate } from "../../types/memory-candidates.js";

function parseEvidence(raw: unknown): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function mapCandidate(row: Record<string, unknown>): MemoryCandidate {
  return {
    id: String(row.id),
    kind: String(row.kind) as MemoryCandidate["kind"],
    statement: String(row.statement),
    sourceKind: String(row.source_kind) as MemoryCandidate["sourceKind"],
    ...(row.source_id ? { sourceId: String(row.source_id) } : {}),
    evidence: parseEvidence(row.evidence_json),
    confidence: Number(row.confidence),
    sensitivity: String(row.sensitivity) as MemoryCandidate["sensitivity"],
    status: String(row.status) as MemoryCandidate["status"],
    reviewStatus: String(row.review_status) as MemoryCandidate["reviewStatus"],
    ...(row.snoozed_until ? { snoozedUntil: String(row.snoozed_until) } : {}),
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
    ...(row.confirmed_at ? { confirmedAt: String(row.confirmed_at) } : {}),
    ...(row.expires_at ? { expiresAt: String(row.expires_at) } : {}),
  };
}

function buildFingerprint(input: Pick<MemoryCandidate, "kind" | "statement" | "sourceKind" | "sourceId">): string {
  return createHash("sha1")
    .update([input.kind, input.sourceKind, input.sourceId?.trim() || "no-source", input.statement.trim().toLowerCase()].join("|"))
    .digest("hex");
}

export class MemoryCandidateStore {
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
      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        statement TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_id TEXT,
        evidence_json TEXT NOT NULL,
        confidence REAL NOT NULL,
        sensitivity TEXT NOT NULL,
        status TEXT NOT NULL,
        review_status TEXT NOT NULL,
        snoozed_until TEXT,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        confirmed_at TEXT,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memory_candidates_status_review
        ON memory_candidates(status, review_status, last_seen_at DESC);
    `);
  }

  upsert(input: Omit<MemoryCandidate, "id" | "createdAt" | "lastSeenAt"> & { id?: string }): MemoryCandidate {
    const fingerprint = buildFingerprint(input);
    const existing = this.getByFingerprint(fingerprint);
    const now = new Date().toISOString();
    const record: MemoryCandidate = {
      id: input.id?.trim() || existing?.id || randomUUID(),
      kind: input.kind,
      statement: input.statement.trim(),
      sourceKind: input.sourceKind,
      ...(input.sourceId ? { sourceId: input.sourceId.trim() } : {}),
      evidence: [...new Set((input.evidence ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 6),
      confidence: Math.max(0, Math.min(1, Number(input.confidence))),
      sensitivity: input.sensitivity,
      status: input.status,
      reviewStatus: input.reviewStatus,
      ...(input.snoozedUntil ? { snoozedUntil: input.snoozedUntil } : {}),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      ...(input.confirmedAt ? { confirmedAt: input.confirmedAt } : existing?.confirmedAt ? { confirmedAt: existing.confirmedAt } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };

    this.db.prepare(`
      INSERT INTO memory_candidates (
        id, fingerprint, kind, statement, source_kind, source_id, evidence_json, confidence,
        sensitivity, status, review_status, snoozed_until, created_at, last_seen_at, confirmed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        kind = excluded.kind,
        statement = excluded.statement,
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        evidence_json = excluded.evidence_json,
        confidence = excluded.confidence,
        sensitivity = excluded.sensitivity,
        status = excluded.status,
        review_status = excluded.review_status,
        snoozed_until = excluded.snoozed_until,
        last_seen_at = excluded.last_seen_at,
        confirmed_at = COALESCE(excluded.confirmed_at, memory_candidates.confirmed_at),
        expires_at = excluded.expires_at
    `).run(
      record.id,
      fingerprint,
      record.kind,
      record.statement,
      record.sourceKind,
      record.sourceId ?? null,
      JSON.stringify(record.evidence),
      record.confidence,
      record.sensitivity,
      record.status,
      record.reviewStatus,
      record.snoozedUntil ?? null,
      record.createdAt,
      record.lastSeenAt,
      record.confirmedAt ?? null,
      record.expiresAt ?? null,
    );

    this.logger.debug("Memory candidate upserted", {
      candidateId: record.id,
      kind: record.kind,
      status: record.status,
      reviewStatus: record.reviewStatus,
    });
    return record;
  }

  getById(id: string): MemoryCandidate | undefined {
    const row = this.db.prepare(`
      SELECT * FROM memory_candidates
      WHERE id = ?
      LIMIT 1
    `).get(id.trim()) as Record<string, unknown> | undefined;
    return row ? mapCandidate(row) : undefined;
  }

  listByStatus(statuses: MemoryCandidate["status"][], limit = 20): MemoryCandidate[] {
    if (statuses.length === 0) {
      return [];
    }
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM memory_candidates
      WHERE status IN (${placeholders})
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(...statuses, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapCandidate);
  }

  update(input: {
    id: string;
    status?: MemoryCandidate["status"];
    reviewStatus?: MemoryCandidate["reviewStatus"];
    confidence?: number;
    snoozedUntil?: string | null;
    confirmedAt?: string | null;
  }): MemoryCandidate | undefined {
    const current = this.getById(input.id);
    if (!current) {
      return undefined;
    }

    const next: MemoryCandidate = {
      ...current,
      ...(typeof input.status === "string" ? { status: input.status } : {}),
      ...(typeof input.reviewStatus === "string" ? { reviewStatus: input.reviewStatus } : {}),
      ...(typeof input.confidence === "number" ? { confidence: Math.max(0, Math.min(1, input.confidence)) } : {}),
      ...(input.snoozedUntil === null ? { snoozedUntil: undefined } : typeof input.snoozedUntil === "string" ? { snoozedUntil: input.snoozedUntil } : {}),
      ...(input.confirmedAt === null ? { confirmedAt: undefined } : typeof input.confirmedAt === "string" ? { confirmedAt: input.confirmedAt } : {}),
      lastSeenAt: new Date().toISOString(),
    };

    const row = this.db.prepare(`
      UPDATE memory_candidates
      SET status = ?, review_status = ?, confidence = ?, snoozed_until = ?, confirmed_at = ?, last_seen_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      next.status,
      next.reviewStatus,
      next.confidence,
      next.snoozedUntil ?? null,
      next.confirmedAt ?? null,
      next.lastSeenAt,
      next.id,
    ) as Record<string, unknown> | undefined;
    return row ? mapCandidate(row) : undefined;
  }

  private getByFingerprint(fingerprint: string): MemoryCandidate | undefined {
    const row = this.db.prepare(`
      SELECT * FROM memory_candidates
      WHERE fingerprint = ?
      LIMIT 1
    `).get(fingerprint) as Record<string, unknown> | undefined;
    return row ? mapCandidate(row) : undefined;
  }
}
