import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DeliveryAuditRecord, DeliveryChannel, DeliveryDisposition } from "../../types/delivery-message.js";
import type { BriefingAudience } from "../../types/briefing-profile.js";
import type { Logger } from "../../types/logger.js";

interface DeliveryAuditRow {
  id: number;
  profile_id: string;
  channel: string;
  audience: string;
  disposition: string;
  recipient_count: number;
  status: string;
  subject: string | null;
  metadata_json: string | null;
  created_at: string;
}

function parseMetadata(value: string | null): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(([, item]) => typeof item === "string");
    return entries.length > 0 ? Object.fromEntries(entries as Array<[string, string]>) : undefined;
  } catch {
    return undefined;
  }
}

function mapRow(row: DeliveryAuditRow | undefined): DeliveryAuditRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel as DeliveryChannel,
    audience: row.audience as BriefingAudience,
    disposition: row.disposition as DeliveryDisposition,
    recipientCount: row.recipient_count,
    status: row.status as DeliveryAuditRecord["status"],
    ...(row.subject ? { subject: row.subject } : {}),
    createdAt: row.created_at,
    ...(parseMetadata(row.metadata_json) ? { metadata: parseMetadata(row.metadata_json)! } : {}),
  };
}

export class DeliveryAuditStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS delivery_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        audience TEXT NOT NULL,
        disposition TEXT NOT NULL,
        recipient_count INTEGER NOT NULL,
        status TEXT NOT NULL,
        subject TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  record(input: Omit<DeliveryAuditRecord, "id" | "createdAt">): DeliveryAuditRecord {
    const createdAt = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO delivery_audit (
        profile_id, channel, audience, disposition, recipient_count, status, subject, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.profileId,
      input.channel,
      input.audience,
      input.disposition,
      input.recipientCount,
      input.status,
      input.subject ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt,
    ) as DeliveryAuditRow | undefined;
    return mapRow(row)!;
  }

  listRecent(limit = 20): DeliveryAuditRecord[] {
    const rows = this.db.prepare(`SELECT * FROM delivery_audit ORDER BY id DESC LIMIT ?`).all(limit) as unknown as DeliveryAuditRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
