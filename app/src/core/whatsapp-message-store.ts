import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";

export interface WhatsAppMessageRecord {
  id: number;
  instanceName: string | null;
  remoteJid: string;
  number: string | null;
  pushName: string | null;
  direction: "inbound" | "outbound";
  text: string;
  createdAt: string;
}

export interface WhatsAppContactRecord {
  remoteJid: string;
  number: string | null;
  pushName: string | null;
  lastMessageAt: string;
}

export interface SaveWhatsAppMessageInput {
  instanceName?: string | null;
  remoteJid: string;
  number?: string | null;
  pushName?: string | null;
  direction: "inbound" | "outbound";
  text: string;
  createdAt?: string;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D+/g, "") ?? "";
  return digits ? digits : null;
}

function mapRecord(row: Record<string, unknown>): WhatsAppMessageRecord {
  return {
    id: Number(row.id),
    instanceName: row.instance_name == null ? null : String(row.instance_name),
    remoteJid: String(row.remote_jid),
    number: row.number == null ? null : String(row.number),
    pushName: row.push_name == null ? null : String(row.push_name),
    direction: String(row.direction) as "inbound" | "outbound",
    text: String(row.text),
    createdAt: String(row.created_at),
  };
}

export class WhatsAppMessageStore {
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
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_name TEXT,
        remote_jid TEXT NOT NULL,
        number TEXT,
        push_name TEXT,
        direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_remote_jid
        ON whatsapp_messages(remote_jid, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_number
        ON whatsapp_messages(number, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_push_name
        ON whatsapp_messages(push_name, created_at DESC);
    `);
    this.logger.info("WhatsApp message store ready", { dbPath });
  }

  saveMessage(input: SaveWhatsAppMessageInput): WhatsAppMessageRecord {
    const row = this.db.prepare(`
      INSERT INTO whatsapp_messages (
        instance_name,
        remote_jid,
        number,
        push_name,
        direction,
        text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      normalizeText(input.instanceName),
      input.remoteJid.trim(),
      normalizeNumber(input.number),
      normalizeText(input.pushName),
      input.direction,
      input.text.trim(),
      input.createdAt?.trim() || new Date().toISOString(),
    ) as Record<string, unknown>;

    return mapRecord(row);
  }

  searchRecent(query: string, limit = 10): WhatsAppMessageRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const normalized = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT *
      FROM whatsapp_messages
      WHERE lower(coalesce(push_name, '')) LIKE ?
         OR lower(coalesce(number, '')) LIKE ?
         OR lower(remote_jid) LIKE ?
         OR lower(text) LIKE ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(
      normalized,
      normalized,
      normalized,
      normalized,
      safeLimit,
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => mapRecord(row));
  }

  listRecent(limit = 10): WhatsAppMessageRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT *
      FROM whatsapp_messages
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => mapRecord(row));
  }

  listRecentByInstance(instanceName: string, limit = 10): WhatsAppMessageRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const normalizedInstance = normalizeText(instanceName);
    if (!normalizedInstance) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM whatsapp_messages
      WHERE instance_name = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(normalizedInstance, safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => mapRecord(row));
  }

  searchContacts(query: string, limit = 10): WhatsAppContactRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const normalized = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT
        remote_jid,
        number,
        push_name,
        MAX(created_at) AS last_message_at
      FROM whatsapp_messages
      WHERE lower(coalesce(push_name, '')) LIKE ?
         OR lower(coalesce(number, '')) LIKE ?
         OR lower(remote_jid) LIKE ?
      GROUP BY remote_jid, number, push_name
      ORDER BY last_message_at DESC
      LIMIT ?
    `).all(
      normalized,
      normalized,
      normalized,
      safeLimit,
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      remoteJid: String(row.remote_jid),
      number: row.number == null ? null : String(row.number),
      pushName: row.push_name == null ? null : String(row.push_name),
      lastMessageAt: String(row.last_message_at),
    }));
  }
}
