import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";

export interface RouteDecisionAuditRecord {
  id: number;
  requestId: string;
  prompt: string;
  primaryIntent: string;
  mode: "legacy" | "shadow" | "intent_first";
  selectedRoute?: string;
  legacyRoute?: string;
  executedRoute?: string;
  confidence: number;
  divergence: boolean;
  reasons?: string[];
  createdAt: string;
}

interface RouteDecisionAuditRow {
  id: number;
  request_id: string;
  prompt: string;
  primary_intent: string;
  mode: string;
  selected_route: string | null;
  legacy_route: string | null;
  executed_route: string | null;
  confidence: number;
  divergence: number;
  reasons_json: string | null;
  created_at: string;
}

function parseReasons(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return undefined;
  }
}

function mapRow(row: RouteDecisionAuditRow | undefined): RouteDecisionAuditRecord | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    requestId: row.request_id,
    prompt: row.prompt,
    primaryIntent: row.primary_intent,
    mode: row.mode as RouteDecisionAuditRecord["mode"],
    ...(row.selected_route ? { selectedRoute: row.selected_route } : {}),
    ...(row.legacy_route ? { legacyRoute: row.legacy_route } : {}),
    ...(row.executed_route ? { executedRoute: row.executed_route } : {}),
    confidence: row.confidence,
    divergence: row.divergence === 1,
    ...(parseReasons(row.reasons_json)?.length ? { reasons: parseReasons(row.reasons_json) } : {}),
    createdAt: row.created_at,
  };
}

export class RouteDecisionAuditStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS route_decision_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        primary_intent TEXT NOT NULL,
        mode TEXT NOT NULL,
        selected_route TEXT,
        legacy_route TEXT,
        executed_route TEXT,
        confidence REAL NOT NULL,
        divergence INTEGER NOT NULL,
        reasons_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_route_decision_audit_request_id
      ON route_decision_audit(request_id, id DESC);
    `);
  }

  record(input: Omit<RouteDecisionAuditRecord, "id" | "createdAt">): RouteDecisionAuditRecord {
    const createdAt = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO route_decision_audit (
        request_id, prompt, primary_intent, mode, selected_route, legacy_route, executed_route,
        confidence, divergence, reasons_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.requestId,
      input.prompt,
      input.primaryIntent,
      input.mode,
      input.selectedRoute ?? null,
      input.legacyRoute ?? null,
      input.executedRoute ?? null,
      input.confidence,
      input.divergence ? 1 : 0,
      input.reasons?.length ? JSON.stringify(input.reasons) : null,
      createdAt,
    ) as RouteDecisionAuditRow | undefined;
    return mapRow(row)!;
  }

  listRecent(limit = 20): RouteDecisionAuditRecord[] {
    const rows = this.db.prepare(`SELECT * FROM route_decision_audit ORDER BY id DESC LIMIT ?`).all(limit) as unknown as RouteDecisionAuditRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
