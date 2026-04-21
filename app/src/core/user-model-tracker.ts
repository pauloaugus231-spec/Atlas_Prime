import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";

export interface UserBehaviorModel {
  energyPeaks: number[];
  decisionWindows: number[];
  procrastinationPatterns: string[];
  avoidanceTopics: string[];
  responseToOverload: "pushes_through" | "asks_for_help" | "goes_silent";
  preferredWorkStyle: "sprints" | "steady" | "mixed";
  strongestDomain: string;
  weakestDomain: string;
  lastUpdated: string;
}

interface UserBehaviorMetrics {
  hourCounts: Record<string, number>;
  decisionHourCounts: Record<string, number>;
  domainCounts: Record<string, number>;
  simpleHelpCounts: Record<string, number>;
  unresolvedInsightCounts: Record<string, number>;
  overloadPushCount: number;
  overloadHelpCount: number;
  overloadSilentCount: number;
  totalInteractions: number;
}

const DEFAULT_MODEL: UserBehaviorModel = {
  energyPeaks: [],
  decisionWindows: [],
  procrastinationPatterns: [],
  avoidanceTopics: [],
  responseToOverload: "pushes_through",
  preferredWorkStyle: "mixed",
  strongestDomain: "unknown",
  weakestDomain: "unknown",
  lastUpdated: new Date(0).toISOString(),
};

const DEFAULT_METRICS: UserBehaviorMetrics = {
  hourCounts: {},
  decisionHourCounts: {},
  domainCounts: {},
  simpleHelpCounts: {},
  unresolvedInsightCounts: {},
  overloadPushCount: 0,
  overloadHelpCount: 0,
  overloadSilentCount: 0,
  totalInteractions: 0,
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function increment(map: Record<string, number>, key: string): void {
  const normalized = key.trim() || "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function topNumberKeys(map: Record<string, number>, limit: number): number[] {
  return Object.entries(map)
    .map(([key, count]) => ({ key: Number(key), count }))
    .filter((item) => Number.isInteger(item.key) && item.key >= 0 && item.key <= 23)
    .sort((left, right) => right.count - left.count || left.key - right.key)
    .slice(0, limit)
    .map((item) => item.key);
}

function topStringKeys(map: Record<string, number>, limit: number): string[] {
  return Object.entries(map)
    .filter(([key]) => key !== "unknown")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function resolveWorkStyle(energyPeaks: number[]): UserBehaviorModel["preferredWorkStyle"] {
  if (energyPeaks.length <= 1) {
    return energyPeaks.length === 1 ? "sprints" : "mixed";
  }
  const sorted = [...energyPeaks].sort((left, right) => left - right);
  const spread = sorted[sorted.length - 1] - sorted[0];
  return spread <= 3 ? "sprints" : spread >= 8 ? "steady" : "mixed";
}

function leastSupportedDomain(metrics: UserBehaviorMetrics): string {
  const candidates = Object.entries(metrics.simpleHelpCounts)
    .filter(([domain]) => domain !== "unknown")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return candidates[0]?.[0] ?? "unknown";
}

function strongestDomain(metrics: UserBehaviorMetrics): string {
  const candidates = Object.entries(metrics.domainCounts)
    .filter(([domain]) => domain !== "unknown")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return candidates[0]?.[0] ?? "unknown";
}

function resolveOverloadResponse(metrics: UserBehaviorMetrics): UserBehaviorModel["responseToOverload"] {
  const entries: Array<[UserBehaviorModel["responseToOverload"], number]> = [
    ["pushes_through", metrics.overloadPushCount],
    ["asks_for_help", metrics.overloadHelpCount],
    ["goes_silent", metrics.overloadSilentCount],
  ];
  return entries.sort((left, right) => right[1] - left[1])[0]?.[0] ?? "pushes_through";
}

export class UserModelTracker {
  constructor(
    private readonly db: DatabaseSync,
    private readonly logger: Logger,
  ) {
    this.initialize();
  }

  static open(dbPath: string, logger: Logger): UserModelTracker {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return new UserModelTracker(new DatabaseSync(dbPath), logger);
  }

  getModel(): UserBehaviorModel | undefined {
    const row = this.db.prepare(`
      SELECT model_json
      FROM user_behavior_model
      WHERE id = 'default'
      LIMIT 1
    `).get() as { model_json?: string } | undefined;
    if (!row?.model_json) {
      return undefined;
    }
    return parseJson<UserBehaviorModel>(row.model_json, DEFAULT_MODEL);
  }

  updateFromInteraction(input: {
    hour: number;
    domain: string;
    promptComplexity: "simple" | "complex" | "strategic";
    hadProactiveInsight: boolean;
    userReacted: boolean;
  }): void {
    const now = new Date().toISOString();
    const current = this.readState();
    const hour = Number.isInteger(input.hour) ? Math.max(0, Math.min(23, input.hour)) : new Date().getHours();
    const domain = input.domain.trim() || "unknown";

    increment(current.metrics.hourCounts, String(hour));
    increment(current.metrics.domainCounts, domain);
    current.metrics.totalInteractions += 1;

    if (input.promptComplexity === "strategic" || input.userReacted) {
      increment(current.metrics.decisionHourCounts, String(hour));
    }
    if (input.promptComplexity === "simple") {
      increment(current.metrics.simpleHelpCounts, domain);
    }
    if (input.hadProactiveInsight && !input.userReacted) {
      increment(current.metrics.unresolvedInsightCounts, domain);
      current.metrics.overloadSilentCount += 1;
    } else if (input.hadProactiveInsight && input.userReacted) {
      current.metrics.overloadHelpCount += 1;
    } else {
      current.metrics.overloadPushCount += 1;
    }

    const energyPeaks = topNumberKeys(current.metrics.hourCounts, 3);
    const decisionWindows = topNumberKeys(current.metrics.decisionHourCounts, 3);
    const procrastinationPatterns = topStringKeys(current.metrics.unresolvedInsightCounts, 5);
    const avoidanceTopics = topStringKeys(current.metrics.unresolvedInsightCounts, 3);

    const model: UserBehaviorModel = {
      energyPeaks,
      decisionWindows,
      procrastinationPatterns,
      avoidanceTopics,
      responseToOverload: resolveOverloadResponse(current.metrics),
      preferredWorkStyle: resolveWorkStyle(energyPeaks),
      strongestDomain: strongestDomain(current.metrics),
      weakestDomain: leastSupportedDomain(current.metrics),
      lastUpdated: now,
    };

    this.writeState(model, current.metrics, now);
    this.logger.debug("User behavior model updated", {
      domain,
      hour,
      complexity: input.promptComplexity,
      hadProactiveInsight: input.hadProactiveInsight,
      userReacted: input.userReacted,
    });
  }

  summarize(): string {
    const model = this.getModel();
    if (!model) {
      return "Modelo comportamental ainda sem dados suficientes.";
    }

    const parts = [
      model.energyPeaks.length ? `picos de energia: ${model.energyPeaks.join("h, ")}h` : undefined,
      model.decisionWindows.length ? `janelas de decisão: ${model.decisionWindows.join("h, ")}h` : undefined,
      model.strongestDomain !== "unknown" ? `domínio mais forte: ${model.strongestDomain}` : undefined,
      model.weakestDomain !== "unknown" ? `maior apoio necessário: ${model.weakestDomain}` : undefined,
      model.procrastinationPatterns.length ? `padrões de adiamento: ${model.procrastinationPatterns.join(", ")}` : undefined,
      `estilo de trabalho: ${model.preferredWorkStyle}`,
    ].filter(Boolean);

    return `Modelo comportamental: ${parts.join("; ")}.`;
  }

  private initialize(): void {
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 30000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_behavior_model (
        id TEXT PRIMARY KEY,
        model_json TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private readState(): { model: UserBehaviorModel; metrics: UserBehaviorMetrics } {
    const row = this.db.prepare(`
      SELECT model_json, metrics_json
      FROM user_behavior_model
      WHERE id = 'default'
      LIMIT 1
    `).get() as { model_json?: string; metrics_json?: string } | undefined;

    return {
      model: parseJson<UserBehaviorModel>(row?.model_json, DEFAULT_MODEL),
      metrics: parseJson<UserBehaviorMetrics>(row?.metrics_json, DEFAULT_METRICS),
    };
  }

  private writeState(model: UserBehaviorModel, metrics: UserBehaviorMetrics, updatedAt: string): void {
    this.db.prepare(`
      INSERT INTO user_behavior_model (id, model_json, metrics_json, updated_at)
      VALUES ('default', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        model_json = excluded.model_json,
        metrics_json = excluded.metrics_json,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(model), JSON.stringify(metrics), updatedAt);
  }
}
