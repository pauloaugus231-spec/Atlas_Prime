import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  ContentChannelRecord,
  ContentFormatTemplateRecord,
  ContentHookTemplateRecord,
  ContentItemRecord,
  ContentPerformanceRecord,
  ContentResearchRunRecord,
  ContentSeriesRecord,
  CreateContentHookTemplateInput,
  CreateContentItemInput,
  CreateContentPerformanceInput,
  CreateContentResearchRunInput,
  ListContentItemsFilters,
  UpdateContentItemInput,
  UpsertContentChannelInput,
  UpsertContentFormatTemplateInput,
  UpsertContentSeriesInput,
} from "../types/content-ops.js";

type SqlValue = string | number | bigint | Uint8Array | null;

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return 20;
  }
  const normalized = Math.floor(limit as number);
  if (normalized < 1) {
    return 1;
  }
  if (normalized > 100) {
    return 100;
  }
  return normalized;
}

function normalizeInteger(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

function normalizeScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeDecimal(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function analyzeIdeaScore(input: {
  title: string;
  hook?: string | null;
  pillar?: string | null;
  notes?: string | null;
}): { score: number; reason: string } {
  const title = input.title.trim();
  const hook = normalizeOptionalText(input.hook) ?? "";
  const pillar = normalizeOptionalText(input.pillar) ?? "";
  const notes = normalizeOptionalText(input.notes) ?? "";
  const combined = `${title}\n${hook}\n${pillar}\n${notes}`.toLowerCase();

  let score = 35;
  const reasons: string[] = [];

  if (hook) {
    score += 18;
    reasons.push("hook definido");
  }
  const titleWords = title.split(/\s+/).filter(Boolean).length;
  if (titleWords >= 4 && titleWords <= 12) {
    score += 8;
    reasons.push("título enxuto");
  }
  if (pillar) {
    score += 8;
    reasons.push("pilar definido");
  }
  if (/(erro|mentira|nunca|ninguem te conta|ninguém te conta|pare de|como)/.test(combined)) {
    score += 10;
    reasons.push("gancho forte");
  }
  if (/(historia|história|caso|exemplo|aconteceu|narrativa)/.test(combined)) {
    score += 8;
    reasons.push("material narrável");
  }
  if (/(serie|série|parte 1|parte 2|continua|sequencia|sequência)/.test(combined)) {
    score += 8;
    reasons.push("potencial de série");
  }
  if (/(lista|3 |4 |5 |passos|formas|erros|motivos)/.test(combined)) {
    score += 7;
    reasons.push("formato escalável");
  }
  if (title.length > 90) {
    score -= 8;
    reasons.push("título longo");
  }
  if (!hook && !notes) {
    score -= 6;
    reasons.push("pouco contexto operacional");
  }

  return {
    score: clampScore(score),
    reason: reasons.length > 0 ? reasons.join(", ") : "score base",
  };
}

function mapContentItem(row: Record<string, unknown>): ContentItemRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    platform: String(row.platform) as ContentItemRecord["platform"],
    format: String(row.format) as ContentItemRecord["format"],
    status: String(row.status) as ContentItemRecord["status"],
    pillar: row.pillar == null ? null : String(row.pillar),
    audience: row.audience == null ? null : String(row.audience),
    hook: row.hook == null ? null : String(row.hook),
    callToAction: row.call_to_action == null ? null : String(row.call_to_action),
    notes: row.notes == null ? null : String(row.notes),
    targetDate: row.target_date == null ? null : String(row.target_date),
    assetPath: row.asset_path == null ? null : String(row.asset_path),
    channelKey: row.channel_key == null ? null : String(row.channel_key),
    seriesKey: row.series_key == null ? null : String(row.series_key),
    formatTemplateKey: row.format_template_key == null ? null : String(row.format_template_key),
    ideaScore: row.idea_score == null ? null : Number(row.idea_score),
    scoreReason: row.score_reason == null ? null : String(row.score_reason),
    queuePriority: row.queue_priority == null ? null : Number(row.queue_priority),
    reviewFeedbackCategory:
      row.review_feedback_category == null ? null : String(row.review_feedback_category),
    reviewFeedbackReason:
      row.review_feedback_reason == null ? null : String(row.review_feedback_reason),
    lastReviewedAt: row.last_reviewed_at == null ? null : String(row.last_reviewed_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapChannel(row: Record<string, unknown>): ContentChannelRecord {
  return {
    id: Number(row.id),
    key: String(row.key),
    name: String(row.name),
    platform: String(row.platform) as ContentChannelRecord["platform"],
    niche: row.niche == null ? null : String(row.niche),
    persona: row.persona == null ? null : String(row.persona),
    frequencyPerWeek: row.frequency_per_week == null ? null : Number(row.frequency_per_week),
    status: String(row.status) as ContentChannelRecord["status"],
    primaryGoal: row.primary_goal == null ? null : String(row.primary_goal),
    styleNotes: row.style_notes == null ? null : String(row.style_notes),
    voiceProfile: row.voice_profile == null ? null : String(row.voice_profile),
    language: row.language == null ? null : String(row.language),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapFormatTemplate(row: Record<string, unknown>): ContentFormatTemplateRecord {
  return {
    id: Number(row.id),
    key: String(row.key),
    label: String(row.label),
    description: row.description == null ? null : String(row.description),
    structure: String(row.structure),
    active: Number(row.active) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapHookTemplate(row: Record<string, unknown>): ContentHookTemplateRecord {
  return {
    id: Number(row.id),
    label: String(row.label),
    template: String(row.template),
    category: row.category == null ? null : String(row.category),
    effectivenessScore: row.effectiveness_score == null ? null : Number(row.effectiveness_score),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSeries(row: Record<string, unknown>): ContentSeriesRecord {
  return {
    id: Number(row.id),
    key: String(row.key),
    channelKey: String(row.channel_key),
    title: String(row.title),
    premise: row.premise == null ? null : String(row.premise),
    cadence: row.cadence == null ? null : String(row.cadence),
    status: String(row.status) as ContentSeriesRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPerformance(row: Record<string, unknown>): ContentPerformanceRecord {
  return {
    id: Number(row.id),
    contentItemId: row.content_item_id == null ? null : Number(row.content_item_id),
    channelKey: row.channel_key == null ? null : String(row.channel_key),
    platform: String(row.platform) as ContentPerformanceRecord["platform"],
    publishedAt: row.published_at == null ? null : String(row.published_at),
    views: row.views == null ? null : Number(row.views),
    retention3s: row.retention_3s == null ? null : Number(row.retention_3s),
    avgRetention: row.avg_retention == null ? null : Number(row.avg_retention),
    avgWatchSeconds: row.avg_watch_seconds == null ? null : Number(row.avg_watch_seconds),
    replayRate: row.replay_rate == null ? null : Number(row.replay_rate),
    comments: row.comments == null ? null : Number(row.comments),
    saves: row.saves == null ? null : Number(row.saves),
    shares: row.shares == null ? null : Number(row.shares),
    score: row.score == null ? null : Number(row.score),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: String(row.created_at),
  };
}

function mapResearchRun(row: Record<string, unknown>): ContentResearchRunRecord {
  return {
    id: Number(row.id),
    channelKey: String(row.channel_key),
    runType: String(row.run_type),
    runDate: String(row.run_date),
    status: String(row.status) as ContentResearchRunRecord["status"],
    primaryTrend: row.primary_trend == null ? null : String(row.primary_trend),
    summary: row.summary == null ? null : String(row.summary),
    payloadJson: row.payload_json == null ? null : String(row.payload_json),
    createdAt: String(row.created_at),
  };
}

export class ContentOpsStore {
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
      CREATE TABLE IF NOT EXISTS content_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        platform TEXT NOT NULL,
        format TEXT NOT NULL,
        status TEXT NOT NULL,
        pillar TEXT,
        audience TEXT,
        hook TEXT,
        call_to_action TEXT,
        notes TEXT,
        target_date TEXT,
        asset_path TEXT,
        channel_key TEXT,
        series_key TEXT,
        format_template_key TEXT,
        idea_score REAL,
        score_reason TEXT,
        queue_priority INTEGER,
        review_feedback_category TEXT,
        review_feedback_reason TEXT,
        last_reviewed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        niche TEXT,
        persona TEXT,
        frequency_per_week INTEGER,
        status TEXT NOT NULL,
        primary_goal TEXT,
        style_notes TEXT,
        voice_profile TEXT,
        language TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_format_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        description TEXT,
        structure TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_hook_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        template TEXT NOT NULL,
        category TEXT,
        effectiveness_score REAL,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        channel_key TEXT NOT NULL,
        title TEXT NOT NULL,
        premise TEXT,
        cadence TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_item_id INTEGER,
        channel_key TEXT,
        platform TEXT NOT NULL,
        published_at TEXT,
        views REAL,
        retention_3s REAL,
        avg_retention REAL,
        avg_watch_seconds REAL,
        replay_rate REAL,
        comments REAL,
        saves REAL,
        shares REAL,
        score REAL,
        notes TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS content_research_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_key TEXT NOT NULL,
        run_type TEXT NOT NULL,
        run_date TEXT NOT NULL,
        status TEXT NOT NULL,
        primary_trend TEXT,
        summary TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.ensureContentItemColumns();
    this.ensureEditorialScaffold();
    this.logger.info("Content ops store ready", { dbPath });
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<Record<string, unknown>>;
    return rows.some((row) => String(row.name) === columnName);
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    if (!this.hasColumn(tableName, columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  private ensureContentItemColumns(): void {
    this.ensureColumn("content_items", "channel_key", "TEXT");
    this.ensureColumn("content_items", "series_key", "TEXT");
    this.ensureColumn("content_items", "format_template_key", "TEXT");
    this.ensureColumn("content_items", "idea_score", "REAL");
    this.ensureColumn("content_items", "score_reason", "TEXT");
    this.ensureColumn("content_items", "queue_priority", "INTEGER");
    this.ensureColumn("content_items", "review_feedback_category", "TEXT");
    this.ensureColumn("content_items", "review_feedback_reason", "TEXT");
    this.ensureColumn("content_items", "last_reviewed_at", "TEXT");
  }

  private ensureEditorialScaffold(): void {
    this.upsertChannel({
      key: "riqueza_despertada_youtube",
      name: "Riqueza Despertada",
      platform: "youtube",
      niche: "riqueza, negocios e renda",
      persona: "pragmático, direto e orientado a execução",
      frequencyPerWeek: 5,
      status: "active",
      primaryGoal: "crescimento editorial e retenção",
      styleNotes: "canal faceless com clareza, tensão e explicação simples",
      voiceProfile: "masculina firme em pt-BR",
      language: "pt-BR",
    });
    this.upsertChannel({
      key: "riqueza_despertada_tiktok",
      name: "Riqueza Despertada",
      platform: "tiktok",
      niche: "riqueza, negocios e renda",
      persona: "pragmático, direto e orientado a execução",
      frequencyPerWeek: 5,
      status: "active",
      primaryGoal: "distribuição e descoberta",
      styleNotes: "versão curta, ritmo mais rápido e cortes mais agressivos",
      voiceProfile: "masculina firme em pt-BR",
      language: "pt-BR",
    });

    this.upsertFormatTemplate({
      key: "direct_educational",
      label: "Direto / Educacional",
      description: "Hook forte, lista curta de pontos e fechamento com insight prático.",
      structure: "Hook direto -> 3 a 5 pontos objetivos -> fechamento com insight acionável.",
      active: true,
    });
    this.upsertFormatTemplate({
      key: "belief_breaker",
      label: "Quebra de Crença",
      description: "Abre contra a crença comum e reencaixa o tema com exemplo.",
      structure: "Afirmação contraintuitiva -> explicação -> exemplo -> conclusão.",
      active: true,
    });
    this.upsertFormatTemplate({
      key: "short_narrative",
      label: "Narrativa Curta",
      description: "História breve com tensão e aprendizado final.",
      structure: "Situação -> tensão -> virada -> aprendizado.",
      active: true,
    });

    const existingHooks = this.listHookTemplates({ limit: 5 });
    if (existingHooks.length === 0) {
      this.createHookTemplate({
        label: "Erro comum",
        template: "O erro que mantém muita gente sem dinheiro é este:",
        category: "mistake",
        effectivenessScore: 72,
      });
      this.createHookTemplate({
        label: "Quebra de crença",
        template: "Se você acha que [crença], está olhando do jeito errado.",
        category: "contrarian",
        effectivenessScore: 78,
      });
      this.createHookTemplate({
        label: "Mecanismo",
        template: "A maioria quer enriquecer, mas quase ninguém entende este mecanismo:",
        category: "mechanism",
        effectivenessScore: 75,
      });
    }

    this.upsertSeries({
      key: "riqueza_despertada_mentiras",
      channelKey: "riqueza_despertada_youtube",
      title: "Mentiras sobre Dinheiro",
      premise: "Quebrar crenças populares sobre riqueza com tom direto.",
      cadence: "2x por semana",
      status: "testing",
    });
    this.upsertSeries({
      key: "riqueza_despertada_erros",
      channelKey: "riqueza_despertada_tiktok",
      title: "Erros que te Mantêm Pobre",
      premise: "Erros de comportamento, aquisição e execução.",
      cadence: "3x por semana",
      status: "testing",
    });
  }

  createItem(input: CreateContentItemInput): ContentItemRecord {
    const now = new Date().toISOString();
    const score = input.ideaScore == null
      ? analyzeIdeaScore({
          title: input.title,
          hook: input.hook,
          pillar: input.pillar,
          notes: input.notes,
        })
      : null;
    const row = this.db.prepare(`
      INSERT INTO content_items (
        title, platform, format, status, pillar, audience, hook,
        call_to_action, notes, target_date, asset_path, channel_key,
        series_key, format_template_key, idea_score, score_reason,
        queue_priority, review_feedback_category, review_feedback_reason,
        last_reviewed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.title.trim(),
      input.platform,
      input.format,
      input.status ?? "idea",
      normalizeOptionalText(input.pillar),
      normalizeOptionalText(input.audience),
      normalizeOptionalText(input.hook),
      normalizeOptionalText(input.callToAction),
      normalizeOptionalText(input.notes),
      normalizeOptionalText(input.targetDate),
      normalizeOptionalText(input.assetPath),
      normalizeOptionalText(input.channelKey),
      normalizeOptionalText(input.seriesKey),
      normalizeOptionalText(input.formatTemplateKey),
      normalizeScore(input.ideaScore ?? score?.score),
      normalizeOptionalText(input.scoreReason ?? score?.reason),
      normalizeInteger(input.queuePriority ?? input.ideaScore ?? score?.score),
      normalizeOptionalText(input.reviewFeedbackCategory),
      normalizeOptionalText(input.reviewFeedbackReason),
      normalizeOptionalText(input.lastReviewedAt),
      now,
      now,
    ) as Record<string, unknown>;

    return mapContentItem(row);
  }

  getItemById(id: number): ContentItemRecord | null {
    const row = this.db.prepare(`SELECT * FROM content_items WHERE id = ? LIMIT 1`).get(id) as Record<string, unknown> | undefined;
    return row ? mapContentItem(row) : null;
  }

  listItems(filters: ListContentItemsFilters = {}): ContentItemRecord[] {
    const whereClauses: string[] = [];
    const params: SqlValue[] = [];

    if (filters.platform) {
      whereClauses.push("platform = ?");
      params.push(filters.platform);
    }
    if (filters.status) {
      whereClauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.channelKey?.trim()) {
      whereClauses.push("channel_key = ?");
      params.push(filters.channelKey.trim());
    }
    if (filters.seriesKey?.trim()) {
      whereClauses.push("series_key = ?");
      params.push(filters.seriesKey.trim());
    }
    if (filters.search?.trim()) {
      whereClauses.push("(title LIKE ? OR pillar LIKE ? OR notes LIKE ? OR audience LIKE ? OR channel_key LIKE ? OR series_key LIKE ?)");
      const searchValue = `%${filters.search.trim()}%`;
      params.push(searchValue, searchValue, searchValue, searchValue, searchValue, searchValue);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM content_items
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY
        CASE status
          WHEN 'scheduled' THEN 0
          WHEN 'draft' THEN 1
          WHEN 'idea' THEN 2
          WHEN 'published' THEN 3
          WHEN 'archived' THEN 4
          ELSE 5
        END,
        COALESCE(queue_priority, -1) DESC,
        COALESCE(target_date, updated_at) ASC,
        updated_at DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;

    return rows.map((row) => mapContentItem(row));
  }

  updateItem(input: UpdateContentItemInput): ContentItemRecord {
    const current = this.db.prepare(`SELECT * FROM content_items WHERE id = ? LIMIT 1`).get(input.id) as Record<string, unknown> | undefined;
    if (!current) {
      throw new Error(`Content item not found: ${input.id}`);
    }

    const nextTitle = input.title?.trim() ?? String(current.title);
    const nextHook = input.hook !== undefined ? normalizeOptionalText(input.hook) : (current.hook == null ? null : String(current.hook));
    const nextPillar = input.pillar !== undefined ? normalizeOptionalText(input.pillar) : (current.pillar == null ? null : String(current.pillar));
    const nextNotes = input.notes !== undefined ? normalizeOptionalText(input.notes) : (current.notes == null ? null : String(current.notes));
    const recomputedScore = input.ideaScore === undefined && (
      input.title !== undefined ||
      input.hook !== undefined ||
      input.pillar !== undefined ||
      input.notes !== undefined
    )
      ? analyzeIdeaScore({
          title: nextTitle,
          hook: nextHook,
          pillar: nextPillar,
          notes: nextNotes,
        })
      : null;

    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const patch = <T extends SqlValue>(field: string, value: T | undefined) => {
      if (value !== undefined) {
        assignments.push(`${field} = ?`);
        params.push(value);
      }
    };

    patch("title", input.title?.trim());
    patch("platform", input.platform);
    patch("format", input.format);
    patch("status", input.status);
    patch("pillar", normalizeOptionalText(input.pillar));
    patch("audience", normalizeOptionalText(input.audience));
    patch("hook", normalizeOptionalText(input.hook));
    patch("call_to_action", normalizeOptionalText(input.callToAction));
    patch("notes", normalizeOptionalText(input.notes));
    patch("target_date", normalizeOptionalText(input.targetDate));
    patch("asset_path", normalizeOptionalText(input.assetPath));
    patch("channel_key", normalizeOptionalText(input.channelKey));
    patch("series_key", normalizeOptionalText(input.seriesKey));
    patch("format_template_key", normalizeOptionalText(input.formatTemplateKey));
    patch("idea_score", normalizeScore(input.ideaScore ?? recomputedScore?.score));
    patch("score_reason", normalizeOptionalText(input.scoreReason ?? recomputedScore?.reason));
    patch("queue_priority", normalizeInteger(input.queuePriority ?? input.ideaScore ?? recomputedScore?.score));
    patch("review_feedback_category", normalizeOptionalText(input.reviewFeedbackCategory));
    patch("review_feedback_reason", normalizeOptionalText(input.reviewFeedbackReason));
    patch("last_reviewed_at", normalizeOptionalText(input.lastReviewedAt));

    if (!assignments.length) {
      throw new Error("No content fields were provided for update.");
    }

    assignments.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(input.id);

    const row = this.db.prepare(`
      UPDATE content_items
      SET ${assignments.join(", ")}
      WHERE id = ?
      RETURNING *
    `).get(...params) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Content item not found: ${input.id}`);
    }

    return mapContentItem(row);
  }

  upsertChannel(input: UpsertContentChannelInput): ContentChannelRecord {
    const existing = this.db.prepare(`SELECT * FROM content_channels WHERE key = ? LIMIT 1`).get(input.key.trim()) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    if (existing) {
      const row = this.db.prepare(`
        UPDATE content_channels
        SET name = ?, platform = ?, niche = ?, persona = ?, frequency_per_week = ?, status = ?,
            primary_goal = ?, style_notes = ?, voice_profile = ?, language = ?, updated_at = ?
        WHERE key = ?
        RETURNING *
      `).get(
        input.name.trim(),
        input.platform,
        normalizeOptionalText(input.niche),
        normalizeOptionalText(input.persona),
        normalizeInteger(input.frequencyPerWeek),
        input.status ?? "active",
        normalizeOptionalText(input.primaryGoal),
        normalizeOptionalText(input.styleNotes),
        normalizeOptionalText(input.voiceProfile),
        normalizeOptionalText(input.language),
        now,
        input.key.trim(),
      ) as Record<string, unknown>;
      return mapChannel(row);
    }

    const row = this.db.prepare(`
      INSERT INTO content_channels (
        key, name, platform, niche, persona, frequency_per_week, status,
        primary_goal, style_notes, voice_profile, language, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.key.trim(),
      input.name.trim(),
      input.platform,
      normalizeOptionalText(input.niche),
      normalizeOptionalText(input.persona),
      normalizeInteger(input.frequencyPerWeek),
      input.status ?? "active",
      normalizeOptionalText(input.primaryGoal),
      normalizeOptionalText(input.styleNotes),
      normalizeOptionalText(input.voiceProfile),
      normalizeOptionalText(input.language),
      now,
      now,
    ) as Record<string, unknown>;
    return mapChannel(row);
  }

  listChannels(filters: { platform?: string; status?: string; limit?: number } = {}): ContentChannelRecord[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filters.platform) {
      where.push("platform = ?");
      params.push(filters.platform);
    }
    if (filters.status) {
      where.push("status = ?");
      params.push(filters.status);
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM content_channels
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY status = 'active' DESC, updated_at DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;
    return rows.map((row) => mapChannel(row));
  }

  upsertFormatTemplate(input: UpsertContentFormatTemplateInput): ContentFormatTemplateRecord {
    const existing = this.db.prepare(`SELECT * FROM content_format_templates WHERE key = ? LIMIT 1`).get(input.key.trim()) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    if (existing) {
      const row = this.db.prepare(`
        UPDATE content_format_templates
        SET label = ?, description = ?, structure = ?, active = ?, updated_at = ?
        WHERE key = ?
        RETURNING *
      `).get(
        input.label.trim(),
        normalizeOptionalText(input.description),
        input.structure.trim(),
        input.active === false ? 0 : 1,
        now,
        input.key.trim(),
      ) as Record<string, unknown>;
      return mapFormatTemplate(row);
    }

    const row = this.db.prepare(`
      INSERT INTO content_format_templates (
        key, label, description, structure, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.key.trim(),
      input.label.trim(),
      normalizeOptionalText(input.description),
      input.structure.trim(),
      input.active === false ? 0 : 1,
      now,
      now,
    ) as Record<string, unknown>;
    return mapFormatTemplate(row);
  }

  listFormatTemplates(filters: { activeOnly?: boolean; limit?: number } = {}): ContentFormatTemplateRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM content_format_templates
      ${filters.activeOnly === false ? "" : "WHERE active = 1"}
      ORDER BY active DESC, updated_at DESC
      LIMIT ?
    `).all(normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;
    return rows.map((row) => mapFormatTemplate(row));
  }

  createHookTemplate(input: CreateContentHookTemplateInput): ContentHookTemplateRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO content_hook_templates (
        label, template, category, effectiveness_score, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.label.trim(),
      input.template.trim(),
      normalizeOptionalText(input.category),
      normalizeScore(input.effectivenessScore),
      normalizeOptionalText(input.notes),
      now,
      now,
    ) as Record<string, unknown>;
    return mapHookTemplate(row);
  }

  listHookTemplates(filters: { category?: string; limit?: number } = {}): ContentHookTemplateRecord[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filters.category) {
      where.push("category = ?");
      params.push(filters.category.trim());
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM content_hook_templates
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(effectiveness_score, 0) DESC, updated_at DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;
    return rows.map((row) => mapHookTemplate(row));
  }

  upsertSeries(input: UpsertContentSeriesInput): ContentSeriesRecord {
    const existing = this.db.prepare(`SELECT * FROM content_series WHERE key = ? LIMIT 1`).get(input.key.trim()) as Record<string, unknown> | undefined;
    const now = new Date().toISOString();
    if (existing) {
      const row = this.db.prepare(`
        UPDATE content_series
        SET channel_key = ?, title = ?, premise = ?, cadence = ?, status = ?, updated_at = ?
        WHERE key = ?
        RETURNING *
      `).get(
        input.channelKey.trim(),
        input.title.trim(),
        normalizeOptionalText(input.premise),
        normalizeOptionalText(input.cadence),
        input.status ?? "testing",
        now,
        input.key.trim(),
      ) as Record<string, unknown>;
      return mapSeries(row);
    }

    const row = this.db.prepare(`
      INSERT INTO content_series (
        key, channel_key, title, premise, cadence, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.key.trim(),
      input.channelKey.trim(),
      input.title.trim(),
      normalizeOptionalText(input.premise),
      normalizeOptionalText(input.cadence),
      input.status ?? "testing",
      now,
      now,
    ) as Record<string, unknown>;
    return mapSeries(row);
  }

  listSeries(filters: { channelKey?: string; status?: string; limit?: number } = {}): ContentSeriesRecord[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filters.channelKey) {
      where.push("channel_key = ?");
      params.push(filters.channelKey.trim());
    }
    if (filters.status) {
      where.push("status = ?");
      params.push(filters.status.trim());
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM content_series
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;
    return rows.map((row) => mapSeries(row));
  }

  createPerformanceEntry(input: CreateContentPerformanceInput): ContentPerformanceRecord {
    const score = input.score == null
      ? normalizeScore(
          (input.retention3s ?? 0) * 0.25 +
          (input.avgRetention ?? 0) * 0.25 +
          Math.min((input.views ?? 0) / 100, 25) +
          Math.min((input.comments ?? 0) * 2, 10) +
          Math.min((input.saves ?? 0) * 2, 10) +
          Math.min((input.shares ?? 0) * 2, 10),
        )
      : normalizeScore(input.score);
    const row = this.db.prepare(`
      INSERT INTO content_performance (
        content_item_id, channel_key, platform, published_at, views, retention_3s,
        avg_retention, avg_watch_seconds, replay_rate, comments, saves, shares, score, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.contentItemId ?? null,
      normalizeOptionalText(input.channelKey),
      input.platform,
      normalizeOptionalText(input.publishedAt),
      normalizeDecimal(input.views),
      normalizeDecimal(input.retention3s),
      normalizeDecimal(input.avgRetention),
      normalizeDecimal(input.avgWatchSeconds),
      normalizeDecimal(input.replayRate),
      normalizeDecimal(input.comments),
      normalizeDecimal(input.saves),
      normalizeDecimal(input.shares),
      score,
      normalizeOptionalText(input.notes),
      new Date().toISOString(),
    ) as Record<string, unknown>;
    return mapPerformance(row);
  }

  listPerformance(filters: { channelKey?: string; platform?: string; limit?: number } = {}): ContentPerformanceRecord[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filters.channelKey) {
      where.push("channel_key = ?");
      params.push(filters.channelKey.trim());
    }
    if (filters.platform) {
      where.push("platform = ?");
      params.push(filters.platform.trim());
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM content_performance
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY COALESCE(published_at, created_at) DESC, id DESC
      LIMIT ?
    `).all(...params, normalizeLimit(filters.limit)) as Array<Record<string, unknown>>;
    return rows.map((row) => mapPerformance(row));
  }

  createResearchRun(input: CreateContentResearchRunInput): ContentResearchRunRecord {
    const row = this.db.prepare(`
      INSERT INTO content_research_runs (
        channel_key, run_type, run_date, status, primary_trend, summary, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.channelKey.trim(),
      input.runType.trim(),
      input.runDate.trim(),
      input.status,
      normalizeOptionalText(input.primaryTrend),
      normalizeOptionalText(input.summary),
      normalizeOptionalText(input.payloadJson),
      new Date().toISOString(),
    ) as Record<string, unknown>;

    return mapResearchRun(row);
  }

  getLatestResearchRun(channelKey: string, runType: string, runDate: string): ContentResearchRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM content_research_runs
      WHERE channel_key = ? AND run_type = ? AND run_date = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(channelKey.trim(), runType.trim(), runDate.trim()) as Record<string, unknown> | undefined;
    return row ? mapResearchRun(row) : null;
  }
}
