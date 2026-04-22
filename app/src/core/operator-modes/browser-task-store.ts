import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BrowserTaskRecord } from "../../types/browser-task.js";
import type { Logger } from "../../types/logger.js";

interface BrowserTaskRow {
  id: string;
  url: string;
  intent: string;
  mode: string;
  status: string;
  requires_approval: number;
  source_channel: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: BrowserTaskRow | undefined): BrowserTaskRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    url: row.url,
    intent: row.intent,
    mode: row.mode as BrowserTaskRecord["mode"],
    status: row.status as BrowserTaskRecord["status"],
    requiresApproval: row.requires_approval === 1,
    sourceChannel: row.source_channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BrowserTaskStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS browser_tasks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        intent TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        requires_approval INTEGER NOT NULL,
        source_channel TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  create(input: Omit<BrowserTaskRecord, "id" | "createdAt" | "updatedAt" | "status"> & { status?: BrowserTaskRecord["status"] }): BrowserTaskRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO browser_tasks (id, url, intent, mode, status, requires_approval, source_channel, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      randomUUID(),
      input.url,
      input.intent,
      input.mode,
      input.status ?? "queued",
      input.requiresApproval ? 1 : 0,
      input.sourceChannel,
      now,
      now,
    ) as BrowserTaskRow | undefined;
    return mapRow(row)!;
  }

  list(limit = 20): BrowserTaskRecord[] {
    const rows = this.db.prepare(`SELECT * FROM browser_tasks ORDER BY updated_at DESC LIMIT ?`).all(limit) as unknown as BrowserTaskRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
