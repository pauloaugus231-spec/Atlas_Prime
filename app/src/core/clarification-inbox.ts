import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  ClarificationInboxItemRecord,
  ClarificationStatus,
  CreateClarificationInboxItemInput,
} from "../types/clarification.js";

function mapClarificationItem(row: Record<string, unknown>): ClarificationInboxItemRecord {
  return {
    id: Number(row.id),
    chatId: Number(row.chat_id),
    channel: String(row.channel),
    originalPrompt: String(row.original_prompt),
    objectiveSummary: String(row.objective_summary),
    rationale: String(row.rationale),
    questionsJson: String(row.questions_json),
    answerText: typeof row.answer_text === "string" ? row.answer_text : null,
    confirmationText: typeof row.confirmation_text === "string" ? row.confirmation_text : null,
    executionPrompt: typeof row.execution_prompt === "string" ? row.execution_prompt : null,
    status: String(row.status) as ClarificationStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ClarificationInboxStore {
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
      CREATE TABLE IF NOT EXISTS clarification_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        original_prompt TEXT NOT NULL,
        objective_summary TEXT NOT NULL,
        rationale TEXT NOT NULL,
        questions_json TEXT NOT NULL,
        answer_text TEXT,
        confirmation_text TEXT,
        execution_prompt TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.logger.info("Clarification inbox ready", { dbPath });
  }

  createPending(input: CreateClarificationInboxItemInput): ClarificationInboxItemRecord {
    this.markPendingAsSuperseded(input.chatId, input.channel);
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO clarification_inbox (
        chat_id, channel, original_prompt, objective_summary, rationale, questions_json,
        answer_text, confirmation_text, execution_prompt, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'pending_answer', ?, ?)
      RETURNING *
    `).get(
      input.chatId,
      input.channel.trim(),
      input.originalPrompt.trim(),
      input.objectiveSummary.trim(),
      input.rationale.trim(),
      input.questionsJson,
      now,
      now,
    ) as Record<string, unknown>;

    return mapClarificationItem(row);
  }

  getLatestPending(chatId: number): ClarificationInboxItemRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM clarification_inbox
      WHERE chat_id = ? AND status IN ('pending_answer', 'pending_confirmation')
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(chatId) as Record<string, unknown> | undefined;
    return row ? mapClarificationItem(row) : null;
  }

  updateForConfirmation(
    id: number,
    answerText: string,
    confirmationText: string,
    executionPrompt: string,
  ): ClarificationInboxItemRecord | null {
    const row = this.db.prepare(`
      UPDATE clarification_inbox
      SET answer_text = ?, confirmation_text = ?, execution_prompt = ?, status = 'pending_confirmation', updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      answerText,
      confirmationText,
      executionPrompt,
      new Date().toISOString(),
      id,
    ) as Record<string, unknown> | undefined;
    return row ? mapClarificationItem(row) : null;
  }

  updateStatus(id: number, status: ClarificationStatus): ClarificationInboxItemRecord | null {
    const row = this.db.prepare(`
      UPDATE clarification_inbox
      SET status = ?, updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(
      status,
      new Date().toISOString(),
      id,
    ) as Record<string, unknown> | undefined;
    return row ? mapClarificationItem(row) : null;
  }

  private markPendingAsSuperseded(chatId: number, channel: string): void {
    this.db.prepare(`
      UPDATE clarification_inbox
      SET status = 'superseded', updated_at = ?
      WHERE chat_id = ?
        AND channel = ?
        AND status IN ('pending_answer', 'pending_confirmation')
    `).run(
      new Date().toISOString(),
      chatId,
      channel.trim(),
    );
  }
}
