import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CreateSocialCaseNoteInput,
  ListSocialCaseNotesFilters,
  SocialCaseNoteRecord,
} from "../types/social-assistant.js";

type SqlValue = string | number | bigint | Uint8Array | null;

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeTags(value: string[] | undefined): string {
  return JSON.stringify((value ?? []).map((item) => item.trim()).filter(Boolean));
}

function parseTags(value: unknown): string[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
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

function mapNote(row: Record<string, unknown>): SocialCaseNoteRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    noteType: String(row.note_type) as SocialCaseNoteRecord["noteType"],
    sensitivity: String(row.sensitivity) as SocialCaseNoteRecord["sensitivity"],
    personLabel: row.person_label == null ? null : String(row.person_label),
    summary: String(row.summary),
    details: row.details == null ? null : String(row.details),
    nextAction: row.next_action == null ? null : String(row.next_action),
    followUpDate: row.follow_up_date == null ? null : String(row.follow_up_date),
    tags: parseTags(row.tags),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SocialAssistantStore {
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
      PRAGMA busy_timeout = 30000;

      CREATE TABLE IF NOT EXISTS social_case_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        note_type TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        person_label TEXT,
        summary TEXT NOT NULL,
        details TEXT,
        next_action TEXT,
        follow_up_date TEXT,
        tags TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.logger.info("Social assistant store ready", { dbPath });
  }

  createNote(input: CreateSocialCaseNoteInput): SocialCaseNoteRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO social_case_notes (
        title, note_type, sensitivity, person_label, summary,
        details, next_action, follow_up_date, tags, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.title.trim(),
      input.noteType,
      input.sensitivity ?? "restricted",
      normalizeOptionalText(input.personLabel),
      input.summary.trim(),
      normalizeOptionalText(input.details),
      normalizeOptionalText(input.nextAction),
      normalizeOptionalText(input.followUpDate),
      normalizeTags(input.tags),
      now,
      now,
    ) as Record<string, unknown>;

    return mapNote(row);
  }

  listNotes(filters: ListSocialCaseNotesFilters = {}): SocialCaseNoteRecord[] {
    const whereClauses: string[] = [];
    const params: SqlValue[] = [];

    if (filters.noteType) {
      whereClauses.push("note_type = ?");
      params.push(filters.noteType);
    }
    if (filters.sensitivity) {
      whereClauses.push("sensitivity = ?");
      params.push(filters.sensitivity);
    }
    if (filters.search?.trim()) {
      whereClauses.push("(title LIKE ? OR person_label LIKE ? OR summary LIKE ? OR details LIKE ?)");
      const searchValue = `%${filters.search.trim()}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM social_case_notes
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY
        CASE sensitivity
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'restricted' THEN 2
          ELSE 3
        END,
        COALESCE(follow_up_date, updated_at) ASC,
        updated_at DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;

    return rows.map((row) => mapNote(row));
  }
}
