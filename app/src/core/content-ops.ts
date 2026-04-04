import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  ContentItemRecord,
  CreateContentItemInput,
  ListContentItemsFilters,
  UpdateContentItemInput,
} from "../types/content-ops.js";

type SqlValue = string | number | bigint | Uint8Array | null;

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return 20;
  }
  const normalized = Math.floor(limit as number);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > 100) {
    return 100;
  }
  return normalized;
}

function mapContentItem(row: Record<string, unknown>): ContentItemRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    platform: String(row.platform) as ContentItemRecord["platform"],
    format: String(row.format) as ContentItemRecord["format"],
    status: String(row.status) as ContentItemRecord["status"],
    pillar: row.pillar == null ? null : String(row.pillar),
    audience: row.audience == null ? null : String(row.audience),
    hook: row.hook == null ? null : String(row.hook),
    callToAction: row.call_to_action == null ? null : String(row.call_to_action),
    notes: row.notes == null ? null : String(row.notes),
    targetDate: row.target_date == null ? null : String(row.target_date),
    assetPath: row.asset_path == null ? null : String(row.asset_path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ContentOpsStore {
  private readonly db: DatabaseSync;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        platform TEXT NOT NULL,
        format TEXT NOT NULL,
        status TEXT NOT NULL,
        pillar TEXT,
        audience TEXT,
        hook TEXT,
        call_to_action TEXT,
        notes TEXT,
        target_date TEXT,
        asset_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.logger.info("Content ops store ready", { dbPath });
  }

  createItem(input: CreateContentItemInput): ContentItemRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO content_items (
        title, platform, format, status, pillar, audience, hook,
        call_to_action, notes, target_date, asset_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.title.trim(),
      input.platform,
      input.format,
      input.status ?? "idea",
      normalizeOptionalText(input.pillar),
      normalizeOptionalText(input.audience),
      normalizeOptionalText(input.hook),
      normalizeOptionalText(input.callToAction),
      normalizeOptionalText(input.notes),
      normalizeOptionalText(input.targetDate),
      normalizeOptionalText(input.assetPath),
      now,
      now,
    ) as Record<string, unknown>;

    return mapContentItem(row);
  }

  listItems(filters: ListContentItemsFilters = {}): ContentItemRecord[] {
    const whereClauses: string[] = [];
    const params: SqlValue[] = [];

    if (filters.platform) {
      whereClauses.push("platform = ?");
      params.push(filters.platform);
    }
    if (filters.status) {
      whereClauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.search?.trim()) {
      whereClauses.push("(title LIKE ? OR pillar LIKE ? OR notes LIKE ? OR audience LIKE ?)");
      const searchValue = `%${filters.search.trim()}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM content_items
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY
        CASE status
          WHEN 'scheduled' THEN 0
          WHEN 'draft' THEN 1
          WHEN 'idea' THEN 2
          WHEN 'published' THEN 3
          WHEN 'archived' THEN 4
          ELSE 5
        END,
        COALESCE(target_date, updated_at) ASC,
        updated_at DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;

    return rows.map((row) => mapContentItem(row));
  }

  updateItem(input: UpdateContentItemInput): ContentItemRecord {
    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const patch = <T extends SqlValue>(field: string, value: T | undefined) => {
      if (value !== undefined) {
        assignments.push(`${field} = ?`);
        params.push(value);
      }
    };

    patch("title", input.title?.trim());
    patch("platform", input.platform);
    patch("format", input.format);
    patch("status", input.status);
    patch("pillar", normalizeOptionalText(input.pillar));
    patch("audience", normalizeOptionalText(input.audience));
    patch("hook", normalizeOptionalText(input.hook));
    patch("call_to_action", normalizeOptionalText(input.callToAction));
    patch("notes", normalizeOptionalText(input.notes));
    patch("target_date", normalizeOptionalText(input.targetDate));
    patch("asset_path", normalizeOptionalText(input.assetPath));

    if (!assignments.length) {
      throw new Error("No content fields were provided for update.");
    }

    assignments.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(input.id);

    const row = this.db.prepare(`
      UPDATE content_items
      SET ${assignments.join(", ")}
      WHERE id = ?
      RETURNING *
    `).get(...params) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Content item not found: ${input.id}`);
    }

    return mapContentItem(row);
  }
}
