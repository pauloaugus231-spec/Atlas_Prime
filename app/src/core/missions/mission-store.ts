import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { Mission } from "../../types/mission.js";

interface MissionRow {
  id: string;
  title: string;
  domain: string;
  outcome: string;
  status: string;
  priority: string;
  owner: string;
  deadline: string | null;
  context: string;
  success_criteria_json: string;
  current_plan_json: string;
  artifacts_json: string;
  open_questions_json: string;
  risks_json: string;
  next_action: string | null;
  supporting_commitment_ids_json: string;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: MissionRow | undefined): Mission | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    title: row.title,
    domain: row.domain as Mission["domain"],
    outcome: row.outcome,
    status: row.status as Mission["status"],
    priority: row.priority as Mission["priority"],
    owner: row.owner as Mission["owner"],
    ...(row.deadline ? { deadline: row.deadline } : {}),
    context: row.context,
    successCriteria: parseJson(row.success_criteria_json, []),
    currentPlan: parseJson(row.current_plan_json, []),
    artifacts: parseJson(row.artifacts_json, []),
    openQuestions: parseJson(row.open_questions_json, []),
    risks: parseJson(row.risks_json, []),
    ...(row.next_action ? { nextAction: row.next_action } : {}),
    supportingCommitmentIds: parseJson(row.supporting_commitment_ids_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MissionStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domain TEXT NOT NULL,
        outcome TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        owner TEXT NOT NULL,
        deadline TEXT,
        context TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        current_plan_json TEXT NOT NULL,
        artifacts_json TEXT NOT NULL,
        open_questions_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        next_action TEXT,
        supporting_commitment_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  upsert(mission: Mission): Mission {
    const row = this.db.prepare(`
      INSERT INTO missions (
        id, title, domain, outcome, status, priority, owner, deadline, context,
        success_criteria_json, current_plan_json, artifacts_json, open_questions_json, risks_json,
        next_action, supporting_commitment_ids_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        domain = excluded.domain,
        outcome = excluded.outcome,
        status = excluded.status,
        priority = excluded.priority,
        owner = excluded.owner,
        deadline = excluded.deadline,
        context = excluded.context,
        success_criteria_json = excluded.success_criteria_json,
        current_plan_json = excluded.current_plan_json,
        artifacts_json = excluded.artifacts_json,
        open_questions_json = excluded.open_questions_json,
        risks_json = excluded.risks_json,
        next_action = excluded.next_action,
        supporting_commitment_ids_json = excluded.supporting_commitment_ids_json,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      mission.id,
      mission.title,
      mission.domain,
      mission.outcome,
      mission.status,
      mission.priority,
      mission.owner,
      mission.deadline ?? null,
      mission.context,
      JSON.stringify(mission.successCriteria),
      JSON.stringify(mission.currentPlan),
      JSON.stringify(mission.artifacts),
      JSON.stringify(mission.openQuestions),
      JSON.stringify(mission.risks),
      mission.nextAction ?? null,
      JSON.stringify(mission.supportingCommitmentIds),
      mission.createdAt,
      mission.updatedAt,
    ) as MissionRow | undefined;
    return mapRow(row)!;
  }

  list(statuses?: Mission["status"][], limit = 50): Mission[] {
    const rows = statuses && statuses.length > 0
      ? this.db.prepare(`SELECT * FROM missions WHERE status IN (${statuses.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT ?`).all(...statuses, limit)
      : this.db.prepare(`SELECT * FROM missions ORDER BY updated_at DESC LIMIT ?`).all(limit);
    return (rows as unknown as MissionRow[]).map((row) => mapRow(row)!).filter(Boolean);
  }

  findByTitle(query: string): Mission | undefined {
    const like = `%${query.trim().toLowerCase()}%`;
    const row = this.db.prepare(`SELECT * FROM missions WHERE lower(title) LIKE ? ORDER BY updated_at DESC LIMIT 1`).get(like) as MissionRow | undefined;
    return mapRow(row);
  }
}
