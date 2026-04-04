import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  ApprovalInboxItemRecord,
  ApprovalItemStatus,
  CreateApprovalInboxItemInput,
} from "../types/approval-inbox.js";

function mapApprovalItem(row: Record<string, unknown>): ApprovalInboxItemRecord {
  return {
    id: Number(row.id),
    chatId: Number(row.chat_id),
    channel: String(row.channel),
    actionKind: String(row.action_kind),
    subject: String(row.subject),
    draftPayload: String(row.draft_payload),
    status: String(row.status) as ApprovalItemStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ApprovalInboxStore {
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
      CREATE TABLE IF NOT EXISTS approval_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        action_kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        draft_payload TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.logger.info("Approval inbox ready", { dbPath });
  }

  createPending(input: CreateApprovalInboxItemInput): ApprovalInboxItemRecord {
    this.markPendingAsSuperseded(input.chatId, input.channel, input.actionKind, input.subject);
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO approval_inbox (
        chat_id, channel, action_kind, subject, draft_payload, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      RETURNING *
    `).get(
      input.chatId,
      input.channel.trim(),
      input.actionKind.trim(),
      input.subject.trim(),
      input.draftPayload,
      now,
      now,
    ) as Record<string, unknown>;

    return mapApprovalItem(row);
  }

  getLatestPending(chatId: number): ApprovalInboxItemRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM approval_inbox
      WHERE chat_id = ? AND status = 'pending'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(chatId) as Record<string, unknown> | undefined;
    return row ? mapApprovalItem(row) : null;
  }

  getById(id: number): ApprovalInboxItemRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM approval_inbox
      WHERE id = ?
      LIMIT 1
    `).get(id) as Record<string, unknown> | undefined;
    return row ? mapApprovalItem(row) : null;
  }

  listPending(chatId: number, limit = 10): ApprovalInboxItemRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM approval_inbox
      WHERE chat_id = ? AND status = 'pending'
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(chatId, safeLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => mapApprovalItem(row));
  }

  listPendingAll(limit = 10): ApprovalInboxItemRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM approval_inbox
      WHERE status = 'pending'
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => mapApprovalItem(row));
  }

  updateStatus(id: number, status: ApprovalItemStatus): ApprovalInboxItemRecord | null {
    const row = this.db.prepare(`
      UPDATE approval_inbox
      SET status = ?, updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      status,
      new Date().toISOString(),
      id,
    ) as Record<string, unknown> | undefined;
    return row ? mapApprovalItem(row) : null;
  }

  updateDraftPayload(id: number, draftPayload: string): ApprovalInboxItemRecord | null {
    const row = this.db.prepare(`
      UPDATE approval_inbox
      SET draft_payload = ?, updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      draftPayload,
      new Date().toISOString(),
      id,
    ) as Record<string, unknown> | undefined;
    return row ? mapApprovalItem(row) : null;
  }

  private markPendingAsSuperseded(chatId: number, channel: string, actionKind: string, subject: string): void {
    this.db.prepare(`
      UPDATE approval_inbox
      SET status = 'superseded', updated_at = ?
      WHERE chat_id = ?
        AND channel = ?
        AND action_kind = ?
        AND subject = ?
        AND status = 'pending'
    `).run(
      new Date().toISOString(),
      chatId,
      channel.trim(),
      actionKind.trim(),
      subject.trim(),
    );
  }
}
