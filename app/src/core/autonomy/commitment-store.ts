import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { CommitmentCandidate } from "../../types/commitments.js";

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

function mapCommitment(row: Record<string, unknown>): CommitmentCandidate {
  return {
    id: String(row.id),
    sourceKind: String(row.source_kind) as CommitmentCandidate["sourceKind"],
    ...(row.source_id ? { sourceId: String(row.source_id) } : {}),
    sourceTrust: String(row.source_trust) as CommitmentCandidate["sourceTrust"],
    ...(row.counterparty ? { counterparty: String(row.counterparty) } : {}),
    statement: String(row.statement),
    normalizedAction: String(row.normalized_action),
    ...(row.due_at ? { dueAt: String(row.due_at) } : {}),
    confidence: Number(row.confidence),
    evidence: parseEvidence(row.evidence_json),
    status: String(row.status) as CommitmentCandidate["status"],
    ...(row.snoozed_until ? { snoozedUntil: String(row.snoozed_until) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function buildFingerprint(input: Pick<CommitmentCandidate, "sourceKind" | "sourceId" | "statement" | "normalizedAction" | "dueAt">): string {
  const normalized = [
    input.sourceKind,
    input.sourceId?.trim() || "no-source",
    input.normalizedAction.trim().toLowerCase(),
    input.dueAt?.trim() || "no-due",
    input.statement.trim().toLowerCase(),
  ].join("|");
  return createHash("sha1").update(normalized).digest("hex");
}

export class CommitmentStore {
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
      CREATE TABLE IF NOT EXISTS commitments (
        id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL UNIQUE,
        source_kind TEXT NOT NULL,
        source_id TEXT,
        source_trust TEXT NOT NULL,
        counterparty TEXT,
        statement TEXT NOT NULL,
        normalized_action TEXT NOT NULL,
        due_at TEXT,
        confidence REAL NOT NULL,
        evidence_json TEXT NOT NULL,
        status TEXT NOT NULL,
        snoozed_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_commitments_status_updated
        ON commitments(status, updated_at DESC);
    `);
  }

  upsert(input: Omit<CommitmentCandidate, "id" | "createdAt" | "updatedAt"> & { id?: string }): CommitmentCandidate {
    const fingerprint = buildFingerprint(input);
    const existing = this.getByFingerprint(fingerprint);
    const now = new Date().toISOString();
    const record: CommitmentCandidate = {
      id: input.id?.trim() || existing?.id || randomUUID(),
      sourceKind: input.sourceKind,
      ...(input.sourceId ? { sourceId: input.sourceId.trim() } : {}),
      sourceTrust: input.sourceTrust,
      ...(input.counterparty ? { counterparty: input.counterparty.trim() } : {}),
      statement: input.statement.trim(),
      normalizedAction: input.normalizedAction.trim(),
      ...(input.dueAt ? { dueAt: input.dueAt } : {}),
      confidence: Math.max(0, Math.min(1, Number(input.confidence))),
      evidence: [...new Set((input.evidence ?? []).map((item) => item.trim()).filter(Boolean))].slice(0, 6),
      status: input.status,
      ...(input.snoozedUntil ? { snoozedUntil: input.snoozedUntil } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO commitments (
        id, fingerprint, source_kind, source_id, source_trust, counterparty, statement,
        normalized_action, due_at, confidence, evidence_json, status, snoozed_until,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        source_kind = excluded.source_kind,
        source_id = excluded.source_id,
        source_trust = excluded.source_trust,
        counterparty = excluded.counterparty,
        statement = excluded.statement,
        normalized_action = excluded.normalized_action,
        due_at = excluded.due_at,
        confidence = excluded.confidence,
        evidence_json = excluded.evidence_json,
        status = excluded.status,
        snoozed_until = excluded.snoozed_until,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      fingerprint,
      record.sourceKind,
      record.sourceId ?? null,
      record.sourceTrust,
      record.counterparty ?? null,
      record.statement,
      record.normalizedAction,
      record.dueAt ?? null,
      record.confidence,
      JSON.stringify(record.evidence),
      record.status,
      record.snoozedUntil ?? null,
      record.createdAt,
      record.updatedAt,
    );

    this.logger.debug("Commitment candidate upserted", {
      commitmentId: record.id,
      sourceKind: record.sourceKind,
      status: record.status,
      confidence: record.confidence,
    });
    return record;
  }

  getById(id: string): CommitmentCandidate | undefined {
    const row = this.db.prepare(`
      SELECT * FROM commitments
      WHERE id = ?
      LIMIT 1
    `).get(id.trim()) as Record<string, unknown> | undefined;
    return row ? mapCommitment(row) : undefined;
  }

  listByStatus(statuses: CommitmentCandidate["status"][], limit = 20): CommitmentCandidate[] {
    if (statuses.length === 0) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM commitments
      WHERE status IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...statuses, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapCommitment);
  }

  update(input: {
    id: string;
    status?: CommitmentCandidate["status"];
    dueAt?: string | null;
    snoozedUntil?: string | null;
    normalizedAction?: string;
    counterparty?: string | null;
  }): CommitmentCandidate | undefined {
    const existing = this.getById(input.id);
    if (!existing) {
      return undefined;
    }

    const next: CommitmentCandidate = {
      ...existing,
      ...(typeof input.status === "string" ? { status: input.status } : {}),
      ...(typeof input.normalizedAction === "string" ? { normalizedAction: input.normalizedAction.trim() } : {}),
      ...(input.counterparty === null ? { counterparty: undefined } : typeof input.counterparty === "string" ? { counterparty: input.counterparty.trim() } : {}),
      ...(input.dueAt === null ? { dueAt: undefined } : typeof input.dueAt === "string" ? { dueAt: input.dueAt } : {}),
      ...(input.snoozedUntil === null ? { snoozedUntil: undefined } : typeof input.snoozedUntil === "string" ? { snoozedUntil: input.snoozedUntil } : {}),
      updatedAt: new Date().toISOString(),
    };

    const row = this.db.prepare(`
      UPDATE commitments
      SET status = ?,
          normalized_action = ?,
          counterparty = ?,
          due_at = ?,
          snoozed_until = ?,
          updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      next.status,
      next.normalizedAction,
      next.counterparty ?? null,
      next.dueAt ?? null,
      next.snoozedUntil ?? null,
      next.updatedAt,
      next.id,
    ) as Record<string, unknown> | undefined;
    return row ? mapCommitment(row) : undefined;
  }

  private getByFingerprint(fingerprint: string): CommitmentCandidate | undefined {
    const row = this.db.prepare(`
      SELECT * FROM commitments
      WHERE fingerprint = ?
      LIMIT 1
    `).get(fingerprint) as Record<string, unknown> | undefined;
    return row ? mapCommitment(row) : undefined;
  }
}
