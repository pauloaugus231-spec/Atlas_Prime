import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { RelationshipProfile } from "../../types/relationship-profile.js";

interface RelationshipRow {
  id: string;
  display_name: string;
  kind: string;
  channels_json: string;
  business_context_json: string | null;
  last_interaction_at: string | null;
  next_follow_up_at: string | null;
  open_commitments_json: string;
  notes_json: string;
  trust_level: string;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: RelationshipRow | undefined): RelationshipProfile | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    displayName: row.display_name,
    kind: row.kind as RelationshipProfile["kind"],
    channels: parseJson(row.channels_json, []),
    ...(row.business_context_json ? { businessContext: parseJson(row.business_context_json, {}) } : {}),
    ...(row.last_interaction_at ? { lastInteractionAt: row.last_interaction_at } : {}),
    ...(row.next_follow_up_at ? { nextFollowUpAt: row.next_follow_up_at } : {}),
    openCommitments: parseJson(row.open_commitments_json, []),
    notes: parseJson(row.notes_json, []),
    trustLevel: row.trust_level as RelationshipProfile["trustLevel"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RelationshipStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS relationship_profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        channels_json TEXT NOT NULL,
        business_context_json TEXT,
        last_interaction_at TEXT,
        next_follow_up_at TEXT,
        open_commitments_json TEXT NOT NULL,
        notes_json TEXT NOT NULL,
        trust_level TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  upsert(profile: RelationshipProfile): RelationshipProfile {
    const row = this.db.prepare(`
      INSERT INTO relationship_profiles (
        id, display_name, kind, channels_json, business_context_json, last_interaction_at, next_follow_up_at,
        open_commitments_json, notes_json, trust_level, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        kind = excluded.kind,
        channels_json = excluded.channels_json,
        business_context_json = excluded.business_context_json,
        last_interaction_at = excluded.last_interaction_at,
        next_follow_up_at = excluded.next_follow_up_at,
        open_commitments_json = excluded.open_commitments_json,
        notes_json = excluded.notes_json,
        trust_level = excluded.trust_level,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      profile.id,
      profile.displayName,
      profile.kind,
      JSON.stringify(profile.channels),
      profile.businessContext ? JSON.stringify(profile.businessContext) : null,
      profile.lastInteractionAt ?? null,
      profile.nextFollowUpAt ?? null,
      JSON.stringify(profile.openCommitments),
      JSON.stringify(profile.notes),
      profile.trustLevel,
      profile.createdAt,
      profile.updatedAt,
    ) as RelationshipRow | undefined;
    return mapRow(row)!;
  }

  list(limit = 50): RelationshipProfile[] {
    const rows = this.db.prepare(`SELECT * FROM relationship_profiles ORDER BY coalesce(next_follow_up_at, updated_at) ASC LIMIT ?`).all(limit) as unknown as RelationshipRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }

  search(query: string, limit = 20): RelationshipProfile[] {
    const like = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT * FROM relationship_profiles
      WHERE lower(display_name) LIKE ? OR lower(coalesce(notes_json, '')) LIKE ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(like, like, limit) as unknown as RelationshipRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
