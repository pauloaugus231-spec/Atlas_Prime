import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CreatePersonalOperationalMemoryItemInput,
  PersonalOperationalMemoryItem,
  PersonalOperationalMemoryItemKind,
  PersonalOperationalProfile,
  UpdatePersonalOperationalMemoryItemInput,
  UpdatePersonalOperationalProfileInput,
} from "../types/personal-operational-memory.js";

const DEFAULT_PROFILE: PersonalOperationalProfile = {
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
    this.ensureDefaultProfile();
    this.logger.info("Personal operational memory ready", {
      dbPath: this.dbPath,
    });
  }

  getProfile(): PersonalOperationalProfile {
    return mergeProfileWithItems(this.readStoredProfile(), this.listItems({ limit: 50 }));
  }

  updateProfile(input: UpdatePersonalOperationalProfileInput): PersonalOperationalProfile {
    const current = this.readStoredProfile();
    const next: PersonalOperationalProfile = {
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
  }
}
