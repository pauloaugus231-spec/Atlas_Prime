import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";

export interface ActiveGoal {
  id: string;
  title: string;
  description?: string;
  metric?: string;
  deadline?: string;
  progress?: number;
  domain: "revenue" | "product" | "personal" | "content" | "ops" | "other";
  createdAt: string;
  updatedAt: string;
}

type SqlValue = string | number | bigint | Uint8Array | null;

const VALID_DOMAINS = new Set<ActiveGoal["domain"]>([
  "revenue",
  "product",
  "personal",
  "content",
  "ops",
  "other",
]);

const DOMAIN_LABELS: Record<ActiveGoal["domain"], string> = {
  revenue: "receita",
  product: "produto",
  personal: "pessoal",
  content: "conteúdo",
  ops: "operações",
  other: "outro",
};

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeProgress(value: number | undefined): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeDomain(value: ActiveGoal["domain"] | undefined): ActiveGoal["domain"] {
  return value && VALID_DOMAINS.has(value) ? value : "other";
}

function mapRow(row: Record<string, unknown>): ActiveGoal {
  return {
    id: String(row.id),
    title: String(row.title),
    ...(row.description ? { description: String(row.description) } : {}),
    ...(row.metric ? { metric: String(row.metric) } : {}),
    ...(row.deadline ? { deadline: String(row.deadline) } : {}),
    ...(row.progress != null ? { progress: Number(row.progress) } : {}),
    domain: normalizeDomain(row.domain as ActiveGoal["domain"]),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class GoalStore {
  private readonly db: DatabaseSync;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 30000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS active_goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        metric TEXT,
        deadline TEXT,
        progress REAL,
        domain TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_active_goals_updated_at
        ON active_goals(updated_at DESC);
    `);
  }

  list(): ActiveGoal[] {
    const stmt = this.db.prepare(`
      SELECT id, title, description, metric, deadline, progress, domain, created_at, updated_at
      FROM active_goals
      ORDER BY updated_at DESC, created_at DESC, title COLLATE NOCASE ASC
    `);
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  get(id: string): ActiveGoal | undefined {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return undefined;
    }

    const stmt = this.db.prepare(`
      SELECT id, title, description, metric, deadline, progress, domain, created_at, updated_at
      FROM active_goals
      WHERE id = ?
      LIMIT 1
    `);
    const row = stmt.get(normalizedId) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  upsert(goal: Omit<ActiveGoal, "id" | "createdAt" | "updatedAt"> & { id?: string }): ActiveGoal {
    const now = new Date().toISOString();
    const title = goal.title.trim();
    if (!title) {
      throw new Error("Goal title is required.");
    }

    const existing = goal.id ? this.get(goal.id) : undefined;
    const description = normalizeOptionalText(goal.description ?? undefined) ?? undefined;
    const metric = normalizeOptionalText(goal.metric ?? undefined) ?? undefined;
    const deadline = normalizeOptionalText(goal.deadline ?? undefined) ?? undefined;
    const progress = normalizeProgress(goal.progress) ?? undefined;
    const record: ActiveGoal = {
      id: existing?.id ?? normalizeOptionalText(goal.id) ?? randomUUID(),
      title,
      ...(description ? { description } : {}),
      ...(metric ? { metric } : {}),
      ...(deadline ? { deadline } : {}),
      ...(progress != null ? { progress } : {}),
      domain: normalizeDomain(goal.domain),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO active_goals (
        id, title, description, metric, deadline, progress, domain, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        metric = excluded.metric,
        deadline = excluded.deadline,
        progress = excluded.progress,
        domain = excluded.domain,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      record.id,
      record.title,
      record.description ?? null,
      record.metric ?? null,
      record.deadline ?? null,
      record.progress ?? null,
      record.domain,
      record.createdAt,
      record.updatedAt,
    );

    this.logger.info("Active goal upserted", {
      goalId: record.id,
      domain: record.domain,
      title: record.title,
    });

    return record;
  }

  updateProgress(id: string, progress: number): ActiveGoal | undefined {
    const existing = this.get(id);
    if (!existing) {
      return undefined;
    }

    return this.upsert({
      id: existing.id,
      title: existing.title,
      description: existing.description,
      metric: existing.metric,
      deadline: existing.deadline,
      progress,
      domain: existing.domain,
    });
  }

  remove(id: string): boolean {
    const normalizedId = id.trim();
    if (!normalizedId) {
      return false;
    }

    const stmt = this.db.prepare("DELETE FROM active_goals WHERE id = ?");
    const result = stmt.run(normalizedId) as unknown as { changes?: number };
    const removed = Number(result?.changes ?? 0) > 0;
    if (removed) {
      this.logger.info("Active goal removed", { goalId: normalizedId });
    }
    return removed;
  }

  summarize(): string {
    const goals = this.list();
    if (goals.length === 0) {
      return "Objetivos: nenhum ativo.";
    }

    return `Objetivos: ${goals.map((goal, index) => {
      const parts = [`(${index + 1}) ${goal.title}`, DOMAIN_LABELS[goal.domain]];
      if (goal.deadline) {
        parts.push(`prazo: ${goal.deadline}`);
      }
      if (goal.progress != null) {
        parts.push(`${Math.round(goal.progress * 100)}%`);
      }
      return parts.join(" — ");
    }).join("; ")}`;
  }
}
