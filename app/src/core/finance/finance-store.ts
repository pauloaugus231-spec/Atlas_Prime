import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { CreateFinanceEntryInput, FinanceEntry, FinanceEntryStatus } from "../../types/finance-entry.js";
import type { CreateFinanceGoalInput, FinanceGoal } from "../../types/finance-goal.js";

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function mapEntry(row: Record<string, unknown>): FinanceEntry {
  return {
    id: Number(row.id),
    title: String(row.title),
    amount: Number(row.amount),
    kind: String(row.kind) as FinanceEntry["kind"],
    status: String(row.status) as FinanceEntryStatus,
    ...(row.category ? { category: String(row.category) } : {}),
    ...(row.due_at ? { dueAt: String(row.due_at) } : {}),
    ...(row.paid_at ? { paidAt: String(row.paid_at) } : {}),
    sourceKind: String(row.source_kind) as FinanceEntry["sourceKind"],
    ...(row.notes ? { notes: String(row.notes) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapGoal(row: Record<string, unknown>): FinanceGoal {
  return {
    id: Number(row.id),
    title: String(row.title),
    targetAmount: Number(row.target_amount),
    referenceMonth: String(row.reference_month),
    ...(row.notes ? { notes: String(row.notes) } : {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class FinanceStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS finance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        category TEXT,
        due_at TEXT,
        paid_at TEXT,
        source_kind TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS finance_goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        target_amount REAL NOT NULL,
        reference_month TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  createEntry(input: CreateFinanceEntryInput): FinanceEntry {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO finance_entries (
        title, amount, kind, status, category, due_at, paid_at, source_kind, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.title.trim(),
      Math.round(input.amount * 100) / 100,
      input.kind ?? "expense",
      input.status ?? "planned",
      normalizeOptionalText(input.category),
      normalizeOptionalText(input.dueAt),
      normalizeOptionalText(input.paidAt),
      input.sourceKind ?? "manual",
      normalizeOptionalText(input.notes),
      now,
      now,
    ) as Record<string, unknown>;
    return mapEntry(row);
  }

  listEntries(filters: { status?: FinanceEntryStatus; from?: string; to?: string; limit?: number } = {}): FinanceEntry[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.from) {
      clauses.push("coalesce(due_at, created_at) >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push("coalesce(due_at, created_at) <= ?");
      params.push(filters.to);
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM finance_entries
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY coalesce(due_at, created_at) ASC, id DESC
      LIMIT ?
    `).all(...params, Math.max(1, Math.min(filters.limit ?? 50, 200))) as Array<Record<string, unknown>>;
    return rows.map((row) => mapEntry(row));
  }

  updateEntryStatus(id: number, status: FinanceEntryStatus, paidAt?: string): FinanceEntry | undefined {
    const row = this.db.prepare(`
      UPDATE finance_entries
      SET status = ?, paid_at = ?, updated_at = ?
      WHERE id = ?
      RETURNING *
    `).get(status, normalizeOptionalText(paidAt), new Date().toISOString(), id) as Record<string, unknown> | undefined;
    return row ? mapEntry(row) : undefined;
  }

  createGoal(input: CreateFinanceGoalInput): FinanceGoal {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO finance_goals (title, target_amount, reference_month, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.title.trim(),
      Math.round(input.targetAmount * 100) / 100,
      input.referenceMonth.trim(),
      normalizeOptionalText(input.notes),
      now,
      now,
    ) as Record<string, unknown>;
    return mapGoal(row);
  }

  listGoals(referenceMonth?: string): FinanceGoal[] {
    const rows = referenceMonth
      ? this.db.prepare(`SELECT * FROM finance_goals WHERE reference_month = ? ORDER BY created_at DESC`).all(referenceMonth)
      : this.db.prepare(`SELECT * FROM finance_goals ORDER BY created_at DESC`).all();
    return (rows as Array<Record<string, unknown>>).map((row) => mapGoal(row));
  }
}
