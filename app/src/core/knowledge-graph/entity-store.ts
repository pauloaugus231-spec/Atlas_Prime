import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";

export interface GraphEntity {
  id: string;
  kind: string;
  label: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface EntityRow {
  id: string;
  kind: string;
  label: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

function parseJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapRow(row: EntityRow | undefined): GraphEntity | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    payload: parseJson(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class EntityStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kg_entities (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  upsert(entity: GraphEntity): GraphEntity {
    const row = this.db.prepare(`
      INSERT INTO kg_entities (id, kind, label, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        label = excluded.label,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(entity.id, entity.kind, entity.label, JSON.stringify(entity.payload), entity.createdAt, entity.updatedAt) as EntityRow | undefined;
    return mapRow(row)!;
  }

  search(query: string, limit = 10): GraphEntity[] {
    const like = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`SELECT * FROM kg_entities WHERE lower(label) LIKE ? ORDER BY updated_at DESC LIMIT ?`).all(like, limit) as unknown as EntityRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }

  get(id: string): GraphEntity | undefined {
    const row = this.db.prepare(`SELECT * FROM kg_entities WHERE id = ? LIMIT 1`).get(id) as EntityRow | undefined;
    return mapRow(row);
  }
}
