import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type { MemoryEntityKind, MemoryEntityRecord } from "../types/memory-entities.js";

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

function normalizeLimit(limit = 20, max = 100): number {
  if (!Number.isFinite(limit)) {
    return 20;
  }
  const normalized = Math.floor(limit);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function mapEntity(row: Record<string, unknown>): MemoryEntityRecord {
  return {
    id: String(row.entity_id),
    kind: String(row.kind) as MemoryEntityKind,
    title: String(row.title),
    tags: parseJsonArray(row.tags_json),
    state: parseJsonRecord(row.state_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export interface UpsertMemoryEntityInput {
  id: string;
  kind: MemoryEntityKind;
  title: string;
  tags?: string[];
  state?: Record<string, unknown>;
}

export class MemoryEntityStore {
  private readonly db: DatabaseSync;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entities (
        entity_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.logger.info("Memory entity store ready", { dbPath });
  }

  upsert(input: UpsertMemoryEntityInput): MemoryEntityRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO memory_entities (
        entity_id, kind, title, tags_json, state_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        tags_json = excluded.tags_json,
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      input.id.trim(),
      input.kind,
      input.title.trim(),
      JSON.stringify(normalizeTags(input.tags)),
      JSON.stringify(input.state ?? {}),
      now,
      now,
    ) as Record<string, unknown>;

    return mapEntity(row);
  }

  get(id: string): MemoryEntityRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM memory_entities
      WHERE entity_id = ?
      LIMIT 1
    `).get(id.trim()) as Record<string, unknown> | undefined;
    return row ? mapEntity(row) : null;
  }

  list(limit = 20, kind?: MemoryEntityKind): MemoryEntityRecord[] {
    const safeLimit = normalizeLimit(limit);
    const rows = kind
      ? this.db.prepare(`
          SELECT * FROM memory_entities
          WHERE kind = ?
          ORDER BY updated_at DESC, entity_id ASC
          LIMIT ?
        `).all(kind, safeLimit)
      : this.db.prepare(`
          SELECT * FROM memory_entities
          ORDER BY updated_at DESC, entity_id ASC
          LIMIT ?
        `).all(safeLimit);

    return (rows as Array<Record<string, unknown>>).map((row) => mapEntity(row));
  }

  search(query: string, limit = 20, kind?: MemoryEntityKind): MemoryEntityRecord[] {
    const safeLimit = normalizeLimit(limit);
    const normalized = `%${query.trim().toLowerCase()}%`;
    const rows = kind
      ? this.db.prepare(`
          SELECT * FROM memory_entities
          WHERE kind = ?
            AND (
              lower(title) LIKE ?
              OR lower(tags_json) LIKE ?
              OR lower(state_json) LIKE ?
            )
          ORDER BY updated_at DESC, entity_id ASC
          LIMIT ?
        `).all(kind, normalized, normalized, normalized, safeLimit)
      : this.db.prepare(`
          SELECT * FROM memory_entities
          WHERE lower(title) LIKE ?
             OR lower(tags_json) LIKE ?
             OR lower(state_json) LIKE ?
          ORDER BY updated_at DESC, entity_id ASC
          LIMIT ?
        `).all(normalized, normalized, normalized, safeLimit);

    return (rows as Array<Record<string, unknown>>).map((row) => mapEntity(row));
  }
}
