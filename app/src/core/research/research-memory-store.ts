import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../types/logger.js";
import type { ResearchBrief } from "../../types/research-brief.js";

interface ResearchRow {
  id: string;
  topic: string;
  question: string;
  collected_at: string;
  sources_json: string;
  facts_json: string;
  inferences_json: string;
  opportunities_json: string;
  risks_json: string;
  recommended_actions_json: string;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapRow(row: ResearchRow | undefined): ResearchBrief | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    topic: row.topic,
    question: row.question,
    collectedAt: row.collected_at,
    sources: parseJson(row.sources_json, []),
    facts: parseJson(row.facts_json, []),
    inferences: parseJson(row.inferences_json, []),
    opportunities: parseJson(row.opportunities_json, []),
    risks: parseJson(row.risks_json, []),
    recommendedActions: parseJson(row.recommended_actions_json, []),
  };
}

export class ResearchMemoryStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string, private readonly logger: Logger) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS research_briefs (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        question TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        facts_json TEXT NOT NULL,
        inferences_json TEXT NOT NULL,
        opportunities_json TEXT NOT NULL,
        risks_json TEXT NOT NULL,
        recommended_actions_json TEXT NOT NULL
      );
    `);
  }

  upsert(brief: ResearchBrief): ResearchBrief {
    const row = this.db.prepare(`
      INSERT INTO research_briefs (
        id, topic, question, collected_at, sources_json, facts_json, inferences_json, opportunities_json, risks_json, recommended_actions_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        question = excluded.question,
        collected_at = excluded.collected_at,
        sources_json = excluded.sources_json,
        facts_json = excluded.facts_json,
        inferences_json = excluded.inferences_json,
        opportunities_json = excluded.opportunities_json,
        risks_json = excluded.risks_json,
        recommended_actions_json = excluded.recommended_actions_json
      RETURNING *
    `).get(
      brief.id,
      brief.topic,
      brief.question,
      brief.collectedAt,
      JSON.stringify(brief.sources),
      JSON.stringify(brief.facts),
      JSON.stringify(brief.inferences),
      JSON.stringify(brief.opportunities),
      JSON.stringify(brief.risks),
      JSON.stringify(brief.recommendedActions),
    ) as ResearchRow | undefined;
    return mapRow(row)!;
  }

  findByTopic(query: string): ResearchBrief[] {
    const like = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`SELECT * FROM research_briefs WHERE lower(topic) LIKE ? OR lower(question) LIKE ? ORDER BY collected_at DESC LIMIT 10`).all(like, like) as unknown as ResearchRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }

  list(limit = 20): ResearchBrief[] {
    const rows = this.db.prepare(`SELECT * FROM research_briefs ORDER BY collected_at DESC LIMIT ?`).all(limit) as unknown as ResearchRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }
}
