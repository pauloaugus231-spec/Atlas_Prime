import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CreatePersonalOperationalMemoryItemInput,
  PersonalOperationalProfile,
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  UpdatePersonalOperationalMemoryItemInput,
  UpdatePersonalOperationalProfileInput as UpdateIdentityProfileInput,
} from "../types/personal-operational-memory.js";
import type {
  CreateLearnedPreferenceInput,
  LearnedPreference,
  LearnedPreferenceType,
  UpdateLearnedPreferenceInput,
} from "../types/learned-preferences.js";
import type {
  OperationalState,
  UpdateOperationalStateInput,
} from "../types/operational-state.js";

const DEFAULT_PROFILE: PersonalOperationalProfile = {
  displayName: "Operador",
  primaryRole: "rotina operacional pessoal",
  routineSummary: [],
  timezone: "America/Sao_Paulo",
  preferredChannels: ["telegram"],
  preferredAlertChannel: "telegram",
  priorityAreas: [],
  defaultAgendaScope: "both",
  workCalendarAliases: ["abordagem"],
  responseStyle: "direto e objetivo",
  briefingPreference: "executivo",
  detailLevel: "resumo",
  tonePreference: "executivo",
  defaultOperationalMode: "normal",
  mobilityPreferences: [
    "priorizar deslocamento e contexto externo quando houver rua",
  ],
  autonomyPreferences: [
    "leituras simples executam direto",
    "confirmação curta para escrita comum",
    "confirmação forte para exclusões e ações destrutivas",
  ],
  savedFocus: [],
  routineAnchors: [
    "agenda simples deve vir em modo resumo por padrão",
    "reunião com horário isolado assume duração de 1h",
    "não incluir participantes, sala ou meet sem pedido explícito",
  ],
  operationalRules: [
    "leituras simples executam direto quando o contexto já basta",
    "ações destrutivas exigem confirmação forte",
    "deslocamento e clima pesam mais em rotina externa",
  ],
  attire: {
    umbrellaProbabilityThreshold: 40,
    coldTemperatureC: 18,
    lightClothingTemperatureC: 24,
    carryItems: ["carregador", "documentos essenciais"],
  },
  fieldModeHours: 18,
};

const DEFAULT_OPERATIONAL_STATE: OperationalState = {
  mode: "normal",
  focus: [],
  weeklyPriorities: [],
  pendingAlerts: [],
  criticalTasks: [],
  upcomingCommitments: [],
  briefing: {},
  recentContext: [],
  pendingApprovals: 0,
  updatedAt: new Date(0).toISOString(),
};

function normalizeStringList(value: string[] | undefined, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < 1) {
    return fallback;
  }
  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeResponseStyle(value: string | undefined, fallback: string): string {
  return normalizeOptionalString(value) ?? fallback;
}

function normalizeString(value: string | undefined, fallback: string): string {
  return normalizeOptionalString(value) ?? fallback;
}

function normalizeBriefingPreference(
  value: PersonalOperationalProfile["briefingPreference"] | undefined,
  fallback: PersonalOperationalProfile["briefingPreference"],
): PersonalOperationalProfile["briefingPreference"] {
  return value === "curto" || value === "detalhado"
    ? value
    : value === "executivo"
      ? value
      : fallback;
}

function normalizeDetailLevel(
  value: PersonalOperationalProfile["detailLevel"] | undefined,
  fallback: PersonalOperationalProfile["detailLevel"],
): PersonalOperationalProfile["detailLevel"] {
  return value === "resumo" || value === "detalhado"
    ? value
    : value === "equilibrado"
      ? value
      : fallback;
}

function normalizeTonePreference(
  value: PersonalOperationalProfile["tonePreference"] | undefined,
  fallback: PersonalOperationalProfile["tonePreference"],
): PersonalOperationalProfile["tonePreference"] {
  return value === "objetivo"
    || value === "humano"
    || value === "firme"
    || value === "acolhedor"
    || value === "executivo"
    ? value
    : fallback;
}

function normalizeOperationalMode(
  value: PersonalOperationalProfile["defaultOperationalMode"] | undefined,
  fallback: PersonalOperationalProfile["defaultOperationalMode"],
): PersonalOperationalProfile["defaultOperationalMode"] {
  return value === "field" || value === "normal" ? value : fallback;
}

function normalizeConfidence(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeUpcomingCommitments(
  value: UpdateOperationalStateInput["upcomingCommitments"] | OperationalState["upcomingCommitments"] | undefined,
  fallback: OperationalState["upcomingCommitments"],
): OperationalState["upcomingCommitments"] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value
    .map((item) => ({
      summary: normalizeOptionalString(item.summary) ?? "",
      ...(normalizeOptionalString(item.start) ? { start: normalizeOptionalString(item.start) } : {}),
      ...(normalizeOptionalString(item.account) ? { account: normalizeOptionalString(item.account) } : {}),
      ...(normalizeOptionalString(item.location) ? { location: normalizeOptionalString(item.location) } : {}),
    }))
    .filter((item) => item.summary)
    .slice(0, 8);
}

function mapItemRow(row: {
  id: number;
  kind: string;
  title: string;
  content: string;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
}): PersonalOperationalMemoryItem {
  let tags: string[] = [];
  if (row.tags_json) {
    try {
      const parsed = JSON.parse(row.tags_json) as unknown;
      if (Array.isArray(parsed)) {
        tags = [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))];
      }
    } catch {
      tags = [];
    }
  }

  return {
    id: row.id,
    kind: row.kind as PersonalOperationalMemoryItemKind,
    title: row.title,
    content: row.content,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLearnedPreferenceRow(row: {
  id: number;
  type: string;
  key_name: string;
  description: string;
  value_text: string;
  source: string;
  confidence: number;
  confirmations: number;
  active: number;
  created_at: string;
  updated_at: string;
  last_observed_at: string;
}): LearnedPreference {
  return {
    id: row.id,
    type: row.type as LearnedPreferenceType,
    key: row.key_name,
    description: row.description,
    value: row.value_text,
    source: row.source as CreateLearnedPreferenceInput["source"],
    confidence: normalizeConfidence(row.confidence, 0.6),
    confirmations: normalizePositiveInteger(row.confirmations, 1),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastObservedAt: row.last_observed_at,
  };
}

function normalizeOperationalState(
  value: Partial<OperationalState> | undefined,
  fallback: OperationalState,
): OperationalState {
  return {
    mode: value?.mode === "field" ? "field" : value?.mode === "normal" ? "normal" : fallback.mode,
    ...(normalizeOptionalString(value?.modeReason) ? { modeReason: normalizeOptionalString(value?.modeReason) } : {}),
    focus: normalizeStringList(value?.focus, fallback.focus),
    weeklyPriorities: normalizeStringList(value?.weeklyPriorities, fallback.weeklyPriorities),
    pendingAlerts: normalizeStringList(value?.pendingAlerts, fallback.pendingAlerts),
    criticalTasks: normalizeStringList(value?.criticalTasks, fallback.criticalTasks),
    upcomingCommitments: normalizeUpcomingCommitments(value?.upcomingCommitments, fallback.upcomingCommitments),
    ...(normalizeOptionalString(value?.primaryRisk) ? { primaryRisk: normalizeOptionalString(value?.primaryRisk) } : {}),
    briefing: {
      ...(normalizeOptionalString(value?.briefing?.lastGeneratedAt) ? { lastGeneratedAt: normalizeOptionalString(value?.briefing?.lastGeneratedAt) } : fallback.briefing.lastGeneratedAt ? { lastGeneratedAt: fallback.briefing.lastGeneratedAt } : {}),
      ...(normalizeOptionalString(value?.briefing?.nextAction) ? { nextAction: normalizeOptionalString(value?.briefing?.nextAction) } : fallback.briefing.nextAction ? { nextAction: fallback.briefing.nextAction } : {}),
      ...(value?.briefing?.overloadLevel === "leve" || value?.briefing?.overloadLevel === "moderado" || value?.briefing?.overloadLevel === "pesado"
        ? { overloadLevel: value.briefing.overloadLevel }
        : fallback.briefing.overloadLevel ? { overloadLevel: fallback.briefing.overloadLevel } : {}),
    },
    recentContext: normalizeStringList(value?.recentContext, fallback.recentContext),
    ...(normalizeOptionalString(value?.activeChannel) ? { activeChannel: normalizeOptionalString(value?.activeChannel) } : fallback.activeChannel ? { activeChannel: fallback.activeChannel } : {}),
    ...(normalizeOptionalString(value?.preferredAlertChannel) ? { preferredAlertChannel: normalizeOptionalString(value?.preferredAlertChannel) } : fallback.preferredAlertChannel ? { preferredAlertChannel: fallback.preferredAlertChannel } : {}),
    pendingApprovals: Math.max(0, Math.floor(value?.pendingApprovals ?? fallback.pendingApprovals)),
    updatedAt: normalizeOptionalString(value?.updatedAt) ?? fallback.updatedAt,
  };
}

function extractCarryItems(text: string): string[] {
  const normalized = text
    .replace(/^.*?\b(?:levar|leve|levo)\b\s*/i, "")
    .replace(/[.;]+$/g, "")
    .trim();
  if (!normalized) {
    return [];
  }

  return [...new Set(normalized
    .split(/,|\se\s|\s\+\s/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2))];
}

function mergeProfileWithItems(
  profile: PersonalOperationalProfile,
  items: PersonalOperationalMemoryItem[],
): PersonalOperationalProfile {
  const savedFocus = [...profile.savedFocus];
  const routineAnchors = [...profile.routineAnchors];
  const operationalRules = [...profile.operationalRules];
  const carryItems = [...profile.attire.carryItems];

  for (const item of items) {
    const text = item.content.trim() || item.title.trim();
    if (!text) {
      continue;
    }

    if (item.kind === "focus") {
      savedFocus.push(text);
      continue;
    }

    if (item.kind === "routine") {
      routineAnchors.push(text);
      continue;
    }

    if (item.kind === "packing") {
      carryItems.push(...extractCarryItems(text));
      operationalRules.push(text);
      continue;
    }

    if (item.kind === "mobility" || item.kind === "context") {
      routineAnchors.push(text);
      continue;
    }

    operationalRules.push(text);
  }

  return {
    ...profile,
    displayName: normalizeString(profile.displayName, DEFAULT_PROFILE.displayName),
    primaryRole: normalizeString(profile.primaryRole, DEFAULT_PROFILE.primaryRole),
    routineSummary: normalizeStringList(profile.routineSummary, DEFAULT_PROFILE.routineSummary),
    timezone: normalizeString(profile.timezone, DEFAULT_PROFILE.timezone),
    preferredChannels: normalizeStringList(profile.preferredChannels, DEFAULT_PROFILE.preferredChannels),
    preferredAlertChannel: normalizeString(profile.preferredAlertChannel, DEFAULT_PROFILE.preferredAlertChannel ?? DEFAULT_PROFILE.preferredChannels[0]),
    priorityAreas: normalizeStringList(profile.priorityAreas, DEFAULT_PROFILE.priorityAreas),
    responseStyle: normalizeResponseStyle(profile.responseStyle, DEFAULT_PROFILE.responseStyle),
    briefingPreference: normalizeBriefingPreference(profile.briefingPreference, DEFAULT_PROFILE.briefingPreference),
    detailLevel: normalizeDetailLevel(profile.detailLevel, DEFAULT_PROFILE.detailLevel),
    tonePreference: normalizeTonePreference(profile.tonePreference, DEFAULT_PROFILE.tonePreference),
    defaultOperationalMode: normalizeOperationalMode(profile.defaultOperationalMode, DEFAULT_PROFILE.defaultOperationalMode),
    mobilityPreferences: normalizeStringList(profile.mobilityPreferences, DEFAULT_PROFILE.mobilityPreferences),
    autonomyPreferences: normalizeStringList(profile.autonomyPreferences, DEFAULT_PROFILE.autonomyPreferences),
    savedFocus: normalizeStringList(savedFocus, profile.savedFocus),
    routineAnchors: normalizeStringList(routineAnchors, profile.routineAnchors),
    operationalRules: normalizeStringList(operationalRules, profile.operationalRules),
    attire: {
      ...profile.attire,
      carryItems: normalizeStringList(carryItems, profile.attire.carryItems),
    },
  };
}

export class PersonalOperationalMemoryStore {
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
      CREATE TABLE IF NOT EXISTS personal_operational_memory (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_operational_memory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_learned_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        key_name TEXT NOT NULL,
        description TEXT NOT NULL,
        value_text TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.6,
        confirmations INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_personal_learned_preferences_lookup
      ON personal_learned_preferences (type, key_name, active, confirmations DESC, updated_at DESC);
    `);
    this.ensureDefaultProfile();
    this.logger.info("Personal operational memory ready", {
      dbPath: this.dbPath,
    });
  }

  getProfile(): PersonalOperationalProfile {
    return mergeProfileWithItems(this.readStoredProfile(), this.listItems({ limit: 50 }));
  }

  getIdentityProfile(): PersonalOperationalProfile {
    return this.getProfile();
  }

  updateProfile(input: UpdateIdentityProfileInput): PersonalOperationalProfile {
    const current = this.readStoredProfile();
    const next: PersonalOperationalProfile = {
      displayName: normalizeString(input.displayName, current.displayName),
      primaryRole: normalizeString(input.primaryRole, current.primaryRole),
      routineSummary: normalizeStringList(input.routineSummary, current.routineSummary),
      timezone: normalizeString(input.timezone, current.timezone),
      preferredChannels: normalizeStringList(input.preferredChannels, current.preferredChannels),
      preferredAlertChannel: normalizeOptionalString(input.preferredAlertChannel) ?? current.preferredAlertChannel,
      priorityAreas: normalizeStringList(input.priorityAreas, current.priorityAreas),
      defaultAgendaScope: input.defaultAgendaScope ?? current.defaultAgendaScope,
      workCalendarAliases: normalizeStringList(input.workCalendarAliases, current.workCalendarAliases),
      responseStyle: normalizeResponseStyle(input.responseStyle, current.responseStyle),
      briefingPreference: normalizeBriefingPreference(input.briefingPreference, current.briefingPreference),
      detailLevel: normalizeDetailLevel(input.detailLevel, current.detailLevel),
      tonePreference: normalizeTonePreference(input.tonePreference, current.tonePreference),
      defaultOperationalMode: normalizeOperationalMode(input.defaultOperationalMode, current.defaultOperationalMode),
      mobilityPreferences: normalizeStringList(input.mobilityPreferences, current.mobilityPreferences),
      autonomyPreferences: normalizeStringList(input.autonomyPreferences, current.autonomyPreferences),
      savedFocus: normalizeStringList(input.savedFocus, current.savedFocus),
      routineAnchors: normalizeStringList(input.routineAnchors, current.routineAnchors),
      operationalRules: normalizeStringList(input.operationalRules, current.operationalRules),
      attire: {
        umbrellaProbabilityThreshold: normalizePositiveInteger(
          input.attire?.umbrellaProbabilityThreshold,
          current.attire.umbrellaProbabilityThreshold,
        ),
        coldTemperatureC: normalizePositiveInteger(
          input.attire?.coldTemperatureC,
          current.attire.coldTemperatureC,
        ),
        lightClothingTemperatureC: normalizePositiveInteger(
          input.attire?.lightClothingTemperatureC,
          current.attire.lightClothingTemperatureC,
        ),
        carryItems: normalizeStringList(input.attire?.carryItems, current.attire.carryItems),
      },
      fieldModeHours: normalizePositiveInteger(input.fieldModeHours, current.fieldModeHours),
    };

    this.db
      .prepare(`
        INSERT INTO personal_operational_memory (key, value_json, updated_at)
        VALUES ('profile', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(JSON.stringify(next));

    return next;
  }

  updateIdentityProfile(input: UpdateIdentityProfileInput): PersonalOperationalProfile {
    return this.updateProfile(input);
  }

  getOperationalState(): OperationalState {
    const row = this.db
      .prepare("SELECT value_json FROM personal_operational_memory WHERE key = 'operational_state'")
      .get() as { value_json?: string } | undefined;
    if (!row?.value_json) {
      return {
        ...DEFAULT_OPERATIONAL_STATE,
        updatedAt: new Date().toISOString(),
      };
    }

    try {
      const parsed = JSON.parse(row.value_json) as Partial<OperationalState>;
      return normalizeOperationalState(parsed, {
        ...DEFAULT_OPERATIONAL_STATE,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      return {
        ...DEFAULT_OPERATIONAL_STATE,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  updateOperationalState(input: UpdateOperationalStateInput): OperationalState {
    const current = this.getOperationalState();
    const next = normalizeOperationalState({
      ...current,
      ...input,
      briefing: {
        ...current.briefing,
        ...(input.briefing ?? {}),
      },
      updatedAt: new Date().toISOString(),
    }, current);

    this.db
      .prepare(`
        INSERT INTO personal_operational_memory (key, value_json, updated_at)
        VALUES ('operational_state', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = CURRENT_TIMESTAMP
      `)
      .run(JSON.stringify(next));

    return next;
  }

  listItems(input?: {
    kind?: PersonalOperationalMemoryItemKind;
    search?: string;
    limit?: number;
  }): PersonalOperationalMemoryItem[] {
    const filters: string[] = [];
    const args: Array<string | number> = [];

    if (input?.kind) {
      filters.push("kind = ?");
      args.push(input.kind);
    }

    const search = normalizeOptionalString(input?.search);
    if (search) {
      filters.push("(LOWER(title) LIKE ? OR LOWER(content) LIKE ?)");
      const pattern = `%${search.toLowerCase()}%`;
      args.push(pattern, pattern);
    }

    const limit = Math.max(1, Math.min(50, Math.floor(input?.limit ?? 20)));
    args.push(limit);

    const rows = this.db
      .prepare(`
        SELECT id, kind, title, content, tags_json, created_at, updated_at
        FROM personal_operational_memory_items
        ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(...args) as Array<{
        id: number;
        kind: string;
        title: string;
        content: string;
        tags_json: string | null;
        created_at: string;
        updated_at: string;
      }>;

    return rows.map(mapItemRow);
  }

  saveItem(input: CreatePersonalOperationalMemoryItemInput): PersonalOperationalMemoryItem {
    const title = normalizeOptionalString(input.title);
    const content = normalizeOptionalString(input.content);
    if (!title || !content) {
      throw new Error("Personal memory items require title and content.");
    }

    const kind = input.kind ?? "note";
    const tags = normalizeStringList(input.tags, []);
    const result = this.db
      .prepare(`
        INSERT INTO personal_operational_memory_items (kind, title, content, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .run(kind, title, content, JSON.stringify(tags));

    const row = this.db
      .prepare(`
        SELECT id, kind, title, content, tags_json, created_at, updated_at
        FROM personal_operational_memory_items
        WHERE id = ?
      `)
      .get(Number(result.lastInsertRowid)) as {
        id: number;
        kind: string;
        title: string;
        content: string;
        tags_json: string | null;
        created_at: string;
        updated_at: string;
      } | undefined;

    if (!row) {
      throw new Error("Failed to reload saved personal memory item.");
    }

    return mapItemRow(row);
  }

  updateItem(input: UpdatePersonalOperationalMemoryItemInput): PersonalOperationalMemoryItem {
    const current = this.getItem(input.id);
    if (!current) {
      throw new Error(`Personal memory item ${input.id} was not found.`);
    }

    const title = normalizeOptionalString(input.title) ?? current.title;
    const content = normalizeOptionalString(input.content) ?? current.content;
    const kind = input.kind ?? current.kind;
    const tags = input.tags ? normalizeStringList(input.tags, current.tags) : current.tags;

    this.db
      .prepare(`
        UPDATE personal_operational_memory_items
        SET kind = ?, title = ?, content = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(kind, title, content, JSON.stringify(tags), input.id);

    const updated = this.getItem(input.id);
    if (!updated) {
      throw new Error(`Personal memory item ${input.id} could not be reloaded after update.`);
    }

    return updated;
  }

  deleteItem(id: number): PersonalOperationalMemoryItem {
    const current = this.getItem(id);
    if (!current) {
      throw new Error(`Personal memory item ${id} was not found.`);
    }

    this.db
      .prepare("DELETE FROM personal_operational_memory_items WHERE id = ?")
      .run(id);

    return current;
  }

  findItems(query: string, limit = 5): PersonalOperationalMemoryItem[] {
    return this.listItems({
      search: query,
      limit,
    });
  }

  listLearnedPreferences(input?: {
    type?: LearnedPreferenceType;
    search?: string;
    activeOnly?: boolean;
    limit?: number;
  }): LearnedPreference[] {
    const filters: string[] = [];
    const args: Array<string | number> = [];
    if (input?.type) {
      filters.push("type = ?");
      args.push(input.type);
    }
    if (input?.activeOnly !== false) {
      filters.push("active = 1");
    }
    const search = normalizeOptionalString(input?.search);
    if (search) {
      filters.push("(LOWER(description) LIKE ? OR LOWER(value_text) LIKE ? OR LOWER(key_name) LIKE ?)");
      const pattern = `%${search.toLowerCase()}%`;
      args.push(pattern, pattern, pattern);
    }
    const limit = Math.max(1, Math.min(50, Math.floor(input?.limit ?? 20)));
    args.push(limit);

    const rows = this.db
      .prepare(`
        SELECT id, type, key_name, description, value_text, source, confidence, confirmations, active, created_at, updated_at, last_observed_at
        FROM personal_learned_preferences
        ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY active DESC, confirmations DESC, confidence DESC, updated_at DESC, id DESC
        LIMIT ?
      `)
      .all(...args) as Array<{
        id: number;
        type: string;
        key_name: string;
        description: string;
        value_text: string;
        source: string;
        confidence: number;
        confirmations: number;
        active: number;
        created_at: string;
        updated_at: string;
        last_observed_at: string;
      }>;

    return rows.map(mapLearnedPreferenceRow);
  }

  findLearnedPreferences(query: string, limit = 5): LearnedPreference[] {
    return this.listLearnedPreferences({
      search: query,
      activeOnly: false,
      limit,
    });
  }

  saveLearnedPreference(input: CreateLearnedPreferenceInput): LearnedPreference {
    const type = input.type;
    const key = normalizeOptionalString(input.key);
    const description = normalizeOptionalString(input.description);
    const value = normalizeOptionalString(input.value);
    if (!key || !description || !value) {
      throw new Error("Learned preferences require type, key, description and value.");
    }

    const result = this.db
      .prepare(`
        INSERT INTO personal_learned_preferences (
          type, key_name, description, value_text, source, confidence, confirmations, active, created_at, updated_at, last_observed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .run(type, key, description, value, input.source, normalizeConfidence(input.confidence, 0.65));

    const row = this.db
      .prepare(`
        SELECT id, type, key_name, description, value_text, source, confidence, confirmations, active, created_at, updated_at, last_observed_at
        FROM personal_learned_preferences
        WHERE id = ?
      `)
      .get(Number(result.lastInsertRowid)) as {
        id: number;
        type: string;
        key_name: string;
        description: string;
        value_text: string;
        source: string;
        confidence: number;
        confirmations: number;
        active: number;
        created_at: string;
        updated_at: string;
        last_observed_at: string;
      } | undefined;

    if (!row) {
      throw new Error("Failed to reload learned preference after save.");
    }

    return mapLearnedPreferenceRow(row);
  }

  recordLearnedPreferenceObservation(input: CreateLearnedPreferenceInput): LearnedPreference {
    const key = normalizeOptionalString(input.key);
    const description = normalizeOptionalString(input.description);
    const value = normalizeOptionalString(input.value);
    if (!key || !description || !value) {
      throw new Error("Learned preference observation requires key, description and value.");
    }

    const existing = this.db
      .prepare(`
        SELECT id, type, key_name, description, value_text, source, confidence, confirmations, active, created_at, updated_at, last_observed_at
        FROM personal_learned_preferences
        WHERE type = ? AND key_name = ? AND value_text = ? AND active = 1
        ORDER BY confirmations DESC, updated_at DESC, id DESC
        LIMIT 1
      `)
      .get(input.type, key, value) as {
        id: number;
        type: string;
        key_name: string;
        description: string;
        value_text: string;
        source: string;
        confidence: number;
        confirmations: number;
        active: number;
        created_at: string;
        updated_at: string;
        last_observed_at: string;
      } | undefined;

    if (!existing) {
      return this.saveLearnedPreference(input);
    }

    const confirmations = normalizePositiveInteger(existing.confirmations + 1, 1);
    const confidence = Math.max(existing.confidence, normalizeConfidence(input.confidence, existing.confidence));
    this.db
      .prepare(`
        UPDATE personal_learned_preferences
        SET description = ?, source = ?, confidence = ?, confirmations = ?, updated_at = CURRENT_TIMESTAMP, last_observed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(description, input.source, confidence, confirmations, existing.id);

    return this.getLearnedPreference(existing.id) ?? mapLearnedPreferenceRow(existing);
  }

  updateLearnedPreference(input: UpdateLearnedPreferenceInput): LearnedPreference {
    const current = this.getLearnedPreference(input.id);
    if (!current) {
      throw new Error(`Learned preference ${input.id} was not found.`);
    }

    const description = normalizeOptionalString(input.description) ?? current.description;
    const value = normalizeOptionalString(input.value) ?? current.value;
    const confidence = normalizeConfidence(input.confidence, current.confidence);
    const confirmations = normalizePositiveInteger(input.confirmations, current.confirmations);
    const active = typeof input.active === "boolean" ? input.active : current.active;

    this.db
      .prepare(`
        UPDATE personal_learned_preferences
        SET description = ?, value_text = ?, confidence = ?, confirmations = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(description, value, confidence, confirmations, active ? 1 : 0, input.id);

    const updated = this.getLearnedPreference(input.id);
    if (!updated) {
      throw new Error(`Learned preference ${input.id} could not be reloaded after update.`);
    }
    return updated;
  }

  deactivateLearnedPreference(id: number): LearnedPreference {
    return this.updateLearnedPreference({
      id,
      active: false,
    });
  }

  getLearnedPreferenceValue(type: LearnedPreferenceType, key: string): string | undefined {
    const learned = this.listLearnedPreferences({
      type,
      search: key,
      activeOnly: true,
      limit: 1,
    })[0];
    if (!learned || learned.key !== key) {
      return undefined;
    }
    return learned.value;
  }

  private readStoredProfile(): PersonalOperationalProfile {
    const row = this.db
      .prepare("SELECT value_json FROM personal_operational_memory WHERE key = 'profile'")
      .get() as { value_json?: string } | undefined;

    if (!row?.value_json) {
      return { ...DEFAULT_PROFILE };
    }

    try {
      const parsed = JSON.parse(row.value_json) as Partial<PersonalOperationalProfile>;
      return {
        displayName: normalizeString(parsed.displayName, DEFAULT_PROFILE.displayName),
        primaryRole: normalizeString(parsed.primaryRole, DEFAULT_PROFILE.primaryRole),
        routineSummary: normalizeStringList(parsed.routineSummary, DEFAULT_PROFILE.routineSummary),
        timezone: normalizeString(parsed.timezone, DEFAULT_PROFILE.timezone),
        preferredChannels: normalizeStringList(parsed.preferredChannels, DEFAULT_PROFILE.preferredChannels),
        preferredAlertChannel: normalizeOptionalString(parsed.preferredAlertChannel) ?? DEFAULT_PROFILE.preferredAlertChannel,
        priorityAreas: normalizeStringList(parsed.priorityAreas, DEFAULT_PROFILE.priorityAreas),
        defaultAgendaScope:
          parsed.defaultAgendaScope === "primary" || parsed.defaultAgendaScope === "work"
            ? parsed.defaultAgendaScope
            : "both",
        workCalendarAliases: normalizeStringList(parsed.workCalendarAliases, DEFAULT_PROFILE.workCalendarAliases),
        responseStyle: normalizeResponseStyle(parsed.responseStyle, DEFAULT_PROFILE.responseStyle),
        briefingPreference: normalizeBriefingPreference(parsed.briefingPreference, DEFAULT_PROFILE.briefingPreference),
        detailLevel: normalizeDetailLevel(parsed.detailLevel, DEFAULT_PROFILE.detailLevel),
        tonePreference: normalizeTonePreference(parsed.tonePreference, DEFAULT_PROFILE.tonePreference),
        defaultOperationalMode: normalizeOperationalMode(
          parsed.defaultOperationalMode,
          DEFAULT_PROFILE.defaultOperationalMode,
        ),
        mobilityPreferences: normalizeStringList(parsed.mobilityPreferences, DEFAULT_PROFILE.mobilityPreferences),
        autonomyPreferences: normalizeStringList(parsed.autonomyPreferences, DEFAULT_PROFILE.autonomyPreferences),
        savedFocus: normalizeStringList(parsed.savedFocus, DEFAULT_PROFILE.savedFocus),
        routineAnchors: normalizeStringList(parsed.routineAnchors, DEFAULT_PROFILE.routineAnchors),
        operationalRules: normalizeStringList(parsed.operationalRules, DEFAULT_PROFILE.operationalRules),
        attire: {
          umbrellaProbabilityThreshold: normalizePositiveInteger(
            parsed.attire?.umbrellaProbabilityThreshold,
            DEFAULT_PROFILE.attire.umbrellaProbabilityThreshold,
          ),
          coldTemperatureC: normalizePositiveInteger(
            parsed.attire?.coldTemperatureC,
            DEFAULT_PROFILE.attire.coldTemperatureC,
          ),
          lightClothingTemperatureC: normalizePositiveInteger(
            parsed.attire?.lightClothingTemperatureC,
            DEFAULT_PROFILE.attire.lightClothingTemperatureC,
          ),
          carryItems: normalizeStringList(parsed.attire?.carryItems, DEFAULT_PROFILE.attire.carryItems),
        },
        fieldModeHours: normalizePositiveInteger(parsed.fieldModeHours, DEFAULT_PROFILE.fieldModeHours),
      };
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }

  private getLearnedPreference(id: number): LearnedPreference | undefined {
    const row = this.db
      .prepare(`
        SELECT id, type, key_name, description, value_text, source, confidence, confirmations, active, created_at, updated_at, last_observed_at
        FROM personal_learned_preferences
        WHERE id = ?
      `)
      .get(id) as {
        id: number;
        type: string;
        key_name: string;
        description: string;
        value_text: string;
        source: string;
        confidence: number;
        confirmations: number;
        active: number;
        created_at: string;
        updated_at: string;
        last_observed_at: string;
      } | undefined;

    return row ? mapLearnedPreferenceRow(row) : undefined;
  }

  private getItem(id: number): PersonalOperationalMemoryItem | undefined {
    const row = this.db
      .prepare(`
        SELECT id, kind, title, content, tags_json, created_at, updated_at
        FROM personal_operational_memory_items
        WHERE id = ?
      `)
      .get(id) as {
        id: number;
        kind: string;
        title: string;
        content: string;
        tags_json: string | null;
        created_at: string;
        updated_at: string;
      } | undefined;

    return row ? mapItemRow(row) : undefined;
  }

  private ensureDefaultProfile(): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO personal_operational_memory (key, value_json, updated_at)
        VALUES ('profile', ?, CURRENT_TIMESTAMP)
      `)
      .run(JSON.stringify(DEFAULT_PROFILE));
    this.db
      .prepare(`
        INSERT OR IGNORE INTO personal_operational_memory (key, value_json, updated_at)
        VALUES ('operational_state', ?, CURRENT_TIMESTAMP)
      `)
      .run(JSON.stringify({
        ...DEFAULT_OPERATIONAL_STATE,
        updatedAt: new Date().toISOString(),
      }));
  }
}
