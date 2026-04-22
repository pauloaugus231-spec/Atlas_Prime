import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ImprovementBacklogItem } from "../../types/self-improvement.js";
import type { Logger } from "../../types/logger.js";

interface BacklogRow {
  id: string;
  kind: string;
  title: string;
  detail: string;
  priority: string;
  source_ref: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: BacklogRow | undefined): ImprovementBacklogItem | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    kind: row.kind as ImprovementBacklogItem["kind"],
    title: row.title,
    detail: row.detail,
    priority: row.priority as ImprovementBacklogItem["priority"],
    ...(row.source_ref ? { sourceRef: row.source_ref } : {}),
    status: row.status as ImprovementBacklogItem["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ImprovementBacklogStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS improvement_backlog (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        priority TEXT NOT NULL,
        source_ref TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  upsert(item: ImprovementBacklogItem): ImprovementBacklogItem {
    const row = this.db.prepare(`
      INSERT INTO improvement_backlog (id, kind, title, detail, priority, source_ref, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        title = excluded.title,
        detail = excluded.detail,
        priority = excluded.priority,
        source_ref = excluded.source_ref,
        status = excluded.status,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      item.id,
      item.kind,
      item.title,
      item.detail,
      item.priority,
      item.sourceRef ?? null,
      item.status,
      item.createdAt,
      item.updatedAt,
    ) as BacklogRow | undefined;
    return mapRow(row)!;
  }

  list(limit = 20): ImprovementBacklogItem[] {
    const rows = this.db.prepare(`SELECT * FROM improvement_backlog ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as BacklogRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
