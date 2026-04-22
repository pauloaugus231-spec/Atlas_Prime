import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";

export interface GraphRelationship {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: string;
  evidence: string[];
  createdAt: string;
}

interface RelationshipRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  type: string;
  evidence_json: string;
  created_at: string;
}

function parseJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapRow(row: RelationshipRow | undefined): GraphRelationship | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    fromEntityId: row.from_entity_id,
    toEntityId: row.to_entity_id,
    type: row.type,
    evidence: parseJson(row.evidence_json),
    createdAt: row.created_at,
  };
}

export class RelationshipStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS kg_relationships (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        type TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  upsert(relationship: GraphRelationship): GraphRelationship {
    const row = this.db.prepare(`
      INSERT INTO kg_relationships (id, from_entity_id, to_entity_id, type, evidence_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        from_entity_id = excluded.from_entity_id,
        to_entity_id = excluded.to_entity_id,
        type = excluded.type,
        evidence_json = excluded.evidence_json
      RETURNING *
    `).get(
      relationship.id,
      relationship.fromEntityId,
      relationship.toEntityId,
      relationship.type,
      JSON.stringify(relationship.evidence),
      relationship.createdAt,
    ) as RelationshipRow | undefined;
    return mapRow(row)!;
  }

  listForEntity(entityId: string): GraphRelationship[] {
    const rows = this.db.prepare(`SELECT * FROM kg_relationships WHERE from_entity_id = ? OR to_entity_id = ? ORDER BY created_at DESC`).all(entityId, entityId) as unknown as RelationshipRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
