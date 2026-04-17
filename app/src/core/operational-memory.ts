import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CreateMemoryItemInput,
  DailyFocusItem,
  ListMemoryItemsFilters,
  MemoryCategory,
  MemoryStage,
  OperationalMemoryItem,
  RankedMemoryItem,
  UpdateMemoryItemInput,
} from "../types/operational-memory.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
type SqlValue = string | number | bigint | Uint8Array | null;

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  objective: "Objetivos",
  initiative: "Iniciativas",
  task: "Tarefas",
  opportunity: "Oportunidades",
  note: "Notas",
};

const STAGE_ACTION_HINTS: Record<MemoryStage, string> = {
  capture: "transformar a ideia em uma proposta clara e mensurável",
  validate: "validar demanda com oferta simples, landing page ou contato com potenciais clientes",
  build: "construir a entrega mínima com prazo curto e escopo controlado",
  launch: "publicar, divulgar e abrir o canal de aquisição imediatamente",
  sell: "aumentar volume de vendas e melhorar argumento comercial",
  automate: "reduzir esforço manual com processos, templates e automações",
  scale: "ampliar distribuição e fortalecer recorrência",
};

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12);
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeScoreFactor(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.floor(value);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > 5) {
    return 5;
  }
  return normalized;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  const normalized = Math.floor(limit as number);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > MAX_LIMIT) {
    return MAX_LIMIT;
  }
  return normalized;
}

function parseTags(rawValue: unknown): string[] {
  if (typeof rawValue !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function priorityBaseScore(priority: OperationalMemoryItem["priority"]): number {
  if (priority === "high") {
    return 8;
  }
  if (priority === "medium") {
    return 4;
  }
  return 1;
}

function horizonScore(horizon: OperationalMemoryItem["horizon"]): number {
  if (horizon === "today") {
    return 8;
  }
  if (horizon === "short") {
    return 4;
  }
  if (horizon === "medium") {
    return 2;
  }
  return 0;
}

function statusScore(status: OperationalMemoryItem["status"]): number {
  if (status === "active") {
    return 6;
  }
  if (status === "open") {
    return 2;
  }
  if (status === "blocked") {
    return -6;
  }
  if (status === "done") {
    return -20;
  }
  return -30;
}

function stageScore(stage: MemoryStage): number {
  if (stage === "validate" || stage === "sell" || stage === "launch") {
    return 6;
  }
  if (stage === "automate" || stage === "build") {
    return 3;
  }
  if (stage === "scale") {
    return 4;
  }
  return 0;
}

function factorOrDefault(value: number | null): number {
  return value ?? 3;
}

function computePriorityScore(item: Omit<OperationalMemoryItem, "priorityScore">): number {
  const cash = factorOrDefault(item.cashPotential);
  const asset = factorOrDefault(item.assetValue);
  const automation = factorOrDefault(item.automationValue);
  const scale = factorOrDefault(item.scaleValue);
  const authority = factorOrDefault(item.authorityValue);
  const effort = factorOrDefault(item.effort);
  const confidence = factorOrDefault(item.confidence);

  return (
    cash * 5 +
    asset * 4 +
    automation * 3 +
    scale * 4 +
    authority * 2 +
    confidence * 2 -
    effort * 3 +
    priorityBaseScore(item.priority) +
    horizonScore(item.horizon) +
    statusScore(item.status) +
    stageScore(item.stage)
  );
}

function buildRankReason(item: OperationalMemoryItem): string {
  const reasons: string[] = [];

  if ((item.cashPotential ?? 3) >= 4) {
    reasons.push("alto potencial de caixa");
  }
  if ((item.assetValue ?? 3) >= 4) {
    reasons.push("fortalece ativo de longo prazo");
  }
  if ((item.automationValue ?? 3) >= 4) {
    reasons.push("reduz trabalho manual");
  }
  if ((item.scaleValue ?? 3) >= 4) {
    reasons.push("aumenta capacidade de vender ou escalar");
  }
  if ((item.authorityValue ?? 3) >= 4) {
    reasons.push("eleva autoridade e distribuição");
  }
  if ((item.confidence ?? 3) >= 4) {
    reasons.push("boa chance de execução");
  }
  if ((item.effort ?? 3) <= 2) {
    reasons.push("baixo esforço relativo");
  }

  if (reasons.length === 0) {
    reasons.push("combina valor prático e executabilidade");
  }

  return reasons.slice(0, 3).join(", ");
}

function buildRecommendedAction(item: OperationalMemoryItem): string {
  const hint = STAGE_ACTION_HINTS[item.stage];
  if (item.details) {
    return `${hint}. Base atual: ${item.details.slice(0, 140)}`;
  }
  return hint;
}

function mapRow(row: Record<string, unknown>): OperationalMemoryItem {
  const baseItem = {
    id: Number(row.id),
    category: row.category as MemoryCategory,
    title: String(row.title),
    details: row.details == null ? null : String(row.details),
    status: row.status as OperationalMemoryItem["status"],
    priority: row.priority as OperationalMemoryItem["priority"],
    horizon: row.horizon as OperationalMemoryItem["horizon"],
    stage: (row.stage == null ? "capture" : String(row.stage)) as MemoryStage,
    project: row.project == null ? null : String(row.project),
    tags: parseTags(row.tags_json),
    source: row.source == null ? null : String(row.source),
    cashPotential: row.cash_potential == null ? null : Number(row.cash_potential),
    assetValue: row.asset_value == null ? null : Number(row.asset_value),
    automationValue: row.automation_value == null ? null : Number(row.automation_value),
    scaleValue: row.scale_value == null ? null : Number(row.scale_value),
    authorityValue: row.authority_value == null ? null : Number(row.authority_value),
    effort: row.effort == null ? null : Number(row.effort),
    confidence: row.confidence == null ? null : Number(row.confidence),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  } satisfies Omit<OperationalMemoryItem, "priorityScore">;

  return {
    ...baseItem,
    priorityScore: computePriorityScore(baseItem),
  };
}

export class OperationalMemoryStore {
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
      CREATE TABLE IF NOT EXISTS memory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        horizon TEXT NOT NULL,
        project TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memory_items_category_status
        ON memory_items(category, status);

      CREATE INDEX IF NOT EXISTS idx_memory_items_updated_at
        ON memory_items(updated_at DESC);
    `);
    this.ensureColumn("stage", "TEXT NOT NULL DEFAULT 'capture'");
    this.ensureColumn("cash_potential", "INTEGER");
    this.ensureColumn("asset_value", "INTEGER");
    this.ensureColumn("automation_value", "INTEGER");
    this.ensureColumn("scale_value", "INTEGER");
    this.ensureColumn("authority_value", "INTEGER");
    this.ensureColumn("effort", "INTEGER");
    this.ensureColumn("confidence", "INTEGER");
    this.logger.info("Operational memory ready", {
      dbPath,
    });
  }

  addItem(input: CreateMemoryItemInput): OperationalMemoryItem {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO memory_items (
        category,
        title,
        details,
        status,
        priority,
        horizon,
        stage,
        project,
        tags_json,
        source,
        cash_potential,
        asset_value,
        automation_value,
        scale_value,
        authority_value,
        effort,
        confidence,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = statement.run(
      input.category,
      input.title.trim(),
      normalizeOptionalText(input.details),
      input.status ?? "open",
      input.priority ?? "medium",
      input.horizon ?? "short",
      input.stage ?? "capture",
      normalizeOptionalText(input.project),
      JSON.stringify(normalizeTags(input.tags)),
      normalizeOptionalText(input.source),
      normalizeScoreFactor(input.cashPotential),
      normalizeScoreFactor(input.assetValue),
      normalizeScoreFactor(input.automationValue),
      normalizeScoreFactor(input.scaleValue),
      normalizeScoreFactor(input.authorityValue),
      normalizeScoreFactor(input.effort),
      normalizeScoreFactor(input.confidence),
      now,
      now,
    );

    const inserted = this.getItemById(Number(result.lastInsertRowid));
    this.logger.info("Memory item created", {
      id: inserted.id,
      category: inserted.category,
      title: inserted.title,
      priorityScore: inserted.priorityScore,
    });
    return inserted;
  }

  listItems(filters: ListMemoryItemsFilters = {}): OperationalMemoryItem[] {
    const whereClauses: string[] = [];
    const params: SqlValue[] = [];

    if (filters.category) {
      whereClauses.push("category = ?");
      params.push(filters.category);
    }
    if (filters.status) {
      whereClauses.push("status = ?");
      params.push(filters.status);
    } else if (!filters.includeDone) {
      whereClauses.push("status NOT IN ('done', 'archived')");
    }
    if (filters.priority) {
      whereClauses.push("priority = ?");
      params.push(filters.priority);
    }
    if (filters.horizon) {
      whereClauses.push("horizon = ?");
      params.push(filters.horizon);
    }
    if (filters.stage) {
      whereClauses.push("stage = ?");
      params.push(filters.stage);
    }
    if (filters.project?.trim()) {
      whereClauses.push("project = ?");
      params.push(filters.project.trim());
    }
    if (filters.search?.trim()) {
      whereClauses.push("(title LIKE ? OR details LIKE ?)");
      const searchValue = `%${filters.search.trim()}%`;
      params.push(searchValue, searchValue);
    }

    const query = `
      SELECT *
      FROM memory_items
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
    `;

    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    const items = rows.map((row) => mapRow(row));
    const limit = normalizeLimit(filters.limit);

    return items
      .sort((left, right) => {
        if (right.priorityScore !== left.priorityScore) {
          return right.priorityScore - left.priorityScore;
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      })
      .slice(0, limit);
  }

  rankItems(filters: ListMemoryItemsFilters = {}): RankedMemoryItem[] {
    return this.listItems(filters).map((item) => ({
      item,
      score: item.priorityScore,
      reason: buildRankReason(item),
      recommendedAction: buildRecommendedAction(item),
    }));
  }

  getDailyFocus(limit = 3): DailyFocusItem[] {
    const candidates = this.rankItems({
      includeDone: false,
      limit: Math.max(limit * 3, 12),
    }).filter(({ item }) => item.status !== "blocked" && item.status !== "archived");

    return candidates.slice(0, normalizeLimit(limit)).map((candidate) => ({
      item: candidate.item,
      score: candidate.score,
      whyNow: candidate.reason,
      nextAction: candidate.recommendedAction,
    }));
  }

  updateItem(input: UpdateMemoryItemInput): OperationalMemoryItem {
    const existing = this.getItemById(input.id);
    const assignments: string[] = [];
    const params: SqlValue[] = [];

    if (typeof input.title === "string") {
      assignments.push("title = ?");
      params.push(input.title.trim());
    }
    if (input.details !== undefined) {
      assignments.push("details = ?");
      params.push(normalizeOptionalText(input.details));
    }
    if (input.status) {
      assignments.push("status = ?");
      params.push(input.status);
    }
    if (input.priority) {
      assignments.push("priority = ?");
      params.push(input.priority);
    }
    if (input.horizon) {
      assignments.push("horizon = ?");
      params.push(input.horizon);
    }
    if (input.stage) {
      assignments.push("stage = ?");
      params.push(input.stage);
    }
    if (input.project !== undefined) {
      assignments.push("project = ?");
      params.push(normalizeOptionalText(input.project));
    }
    if (input.tags) {
      assignments.push("tags_json = ?");
      params.push(JSON.stringify(normalizeTags(input.tags)));
    }
    if (input.cashPotential !== undefined) {
      assignments.push("cash_potential = ?");
      params.push(normalizeScoreFactor(input.cashPotential));
    }
    if (input.assetValue !== undefined) {
      assignments.push("asset_value = ?");
      params.push(normalizeScoreFactor(input.assetValue));
    }
    if (input.automationValue !== undefined) {
      assignments.push("automation_value = ?");
      params.push(normalizeScoreFactor(input.automationValue));
    }
    if (input.scaleValue !== undefined) {
      assignments.push("scale_value = ?");
      params.push(normalizeScoreFactor(input.scaleValue));
    }
    if (input.authorityValue !== undefined) {
      assignments.push("authority_value = ?");
      params.push(normalizeScoreFactor(input.authorityValue));
    }
    if (input.effort !== undefined) {
      assignments.push("effort = ?");
      params.push(normalizeScoreFactor(input.effort));
    }
    if (input.confidence !== undefined) {
      assignments.push("confidence = ?");
      params.push(normalizeScoreFactor(input.confidence));
    }

    if (assignments.length === 0) {
      return existing;
    }

    assignments.push("updated_at = ?");
    params.push(new Date().toISOString(), input.id);

    this.db
      .prepare(`UPDATE memory_items SET ${assignments.join(", ")} WHERE id = ?`)
      .run(...params);

    const updated = this.getItemById(input.id);
    this.logger.info("Memory item updated", {
      id: updated.id,
      status: updated.status,
      priority: updated.priority,
      priorityScore: updated.priorityScore,
    });
    return updated;
  }

  getContextSummary(): string {
    const ranked = this.rankItems({
      limit: 16,
      includeDone: false,
    });

    if (ranked.length === 0) {
      return "";
    }

    const grouped = new Map<string, RankedMemoryItem[]>();
    for (const item of ranked) {
      const bucket = grouped.get(item.item.category) ?? [];
      bucket.push(item);
      grouped.set(item.item.category, bucket);
    }

    const sections: string[] = [];
    for (const category of ["objective", "initiative", "task", "opportunity", "note"] as const) {
      const categoryItems = grouped.get(category);
      if (!categoryItems?.length) {
        continue;
      }

      const lines = categoryItems.slice(0, 3).map(({ item, score }) => {
        const markers: string[] = [item.status, item.priority, item.horizon, item.stage, `score:${score}`];
        if (item.project) {
          markers.push(`projeto:${item.project}`);
        }
        return `- [${markers.join(" | ")}] ${item.title}`;
      });
      sections.push(`${CATEGORY_LABELS[category]}:\n${lines.join("\n")}`);
    }

    return sections.join("\n\n").slice(0, 2200);
  }

  private ensureColumn(columnName: string, declaration: string): void {
    const columns = this.db.prepare("PRAGMA table_info(memory_items)").all() as Array<Record<string, unknown>>;
    const hasColumn = columns.some((column) => String(column.name) === columnName);
    if (hasColumn) {
      return;
    }

    this.db.exec(`ALTER TABLE memory_items ADD COLUMN ${columnName} ${declaration}`);
  }

  private getItemById(id: number): OperationalMemoryItem {
    const row = this.db.prepare("SELECT * FROM memory_items WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      throw new Error(`Memory item not found: ${id}`);
    }

    return mapRow(row);
  }
}
