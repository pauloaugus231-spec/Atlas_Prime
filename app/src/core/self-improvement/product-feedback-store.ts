import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { ProductFeedbackRecord } from "../../types/self-improvement.js";

interface ProductFeedbackRow {
  id: number;
  channel: string;
  feedback: string;
  created_at: string;
}

function mapRow(row: ProductFeedbackRow | undefined): ProductFeedbackRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    channel: row.channel,
    feedback: row.feedback,
    createdAt: row.created_at,
  };
}

export class ProductFeedbackStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS product_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        feedback TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  create(input: { channel: string; feedback: string }): ProductFeedbackRecord {
    const row = this.db.prepare(`
      INSERT INTO product_feedback (channel, feedback, created_at)
      VALUES (?, ?, ?)
      RETURNING *
    `).get(input.channel, input.feedback.trim(), new Date().toISOString()) as ProductFeedbackRow | undefined;
    return mapRow(row)!;
  }

  list(limit = 20): ProductFeedbackRecord[] {
    const rows = this.db.prepare(`SELECT * FROM product_feedback ORDER BY id DESC LIMIT ?`).all(limit) as unknown as ProductFeedbackRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
