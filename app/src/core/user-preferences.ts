import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type { UpdateUserPreferencesInput, UserPreferences } from "../types/user-preferences.js";

const DEFAULT_PREFERENCES: UserPreferences = {
  responseStyle: "executive",
  responseLength: "short",
  proactiveNextStep: true,
  autoSourceFallback: true,
  preferredAgentName: "Atlas",
};

function normalizeBoolean(value: boolean | null | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export class UserPreferencesStore {
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
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.ensureDefaultPreferences();

    this.logger.info("User preferences ready", {
      dbPath: this.dbPath,
    });
  }

  get(): UserPreferences {
    const row = this.db
      .prepare("SELECT value_json FROM user_preferences WHERE key = 'preferences'")
      .get() as { value_json?: string } | undefined;

    if (!row?.value_json) {
      return { ...DEFAULT_PREFERENCES };
    }

    try {
      const parsed = JSON.parse(row.value_json) as Partial<UserPreferences>;
      return {
        responseStyle:
          parsed.responseStyle === "detailed" ||
          parsed.responseStyle === "investigative" ||
          parsed.responseStyle === "secretary"
            ? parsed.responseStyle
            : "executive",
        responseLength: parsed.responseLength === "medium" ? "medium" : "short",
        proactiveNextStep: normalizeBoolean(parsed.proactiveNextStep, DEFAULT_PREFERENCES.proactiveNextStep),
        autoSourceFallback: normalizeBoolean(parsed.autoSourceFallback, DEFAULT_PREFERENCES.autoSourceFallback),
        preferredAgentName: normalizeOptionalText(parsed.preferredAgentName) ?? DEFAULT_PREFERENCES.preferredAgentName,
      };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  update(input: UpdateUserPreferencesInput): UserPreferences {
    const current = this.get();
    const next: UserPreferences = {
      responseStyle: input.responseStyle ?? current.responseStyle,
      responseLength: input.responseLength ?? current.responseLength,
      proactiveNextStep: input.proactiveNextStep ?? current.proactiveNextStep,
      autoSourceFallback: input.autoSourceFallback ?? current.autoSourceFallback,
      preferredAgentName: normalizeOptionalText(input.preferredAgentName) ?? current.preferredAgentName,
    };
    this.persist(next);
    return next;
  }

  getSystemSummary(): string {
    const preferences = this.get();
    return [
      `Estilo de resposta preferido: ${preferences.responseStyle}`,
      `Tamanho preferido de resposta: ${preferences.responseLength}`,
      `Sugerir próxima ação por padrão: ${preferences.proactiveNextStep ? "sim" : "não"}`,
      `Buscar fontes alternativas automaticamente: ${preferences.autoSourceFallback ? "sim" : "não"}`,
      `Nome preferido do agente: ${preferences.preferredAgentName}`,
    ].join("\n");
  }

  private persist(preferences: UserPreferences): void {
    this.db
      .prepare(`
        INSERT INTO user_preferences (key, value_json, updated_at)
        VALUES ('preferences', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(JSON.stringify(preferences));
  }

  private ensureDefaultPreferences(): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO user_preferences (key, value_json, updated_at)
        VALUES ('preferences', ?, CURRENT_TIMESTAMP)
      `)
      .run(JSON.stringify(DEFAULT_PREFERENCES));
  }
}
