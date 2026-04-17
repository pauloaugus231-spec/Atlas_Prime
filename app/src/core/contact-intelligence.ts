import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CommunicationClassification,
  ContactPersona,
  ContactPriority,
  ContactProfileRecord,
  ContactRelationship,
  UpsertContactProfileInput,
} from "../types/contact-intelligence.js";

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapContactProfile(row: Record<string, unknown>): ContactProfileRecord {
  return {
    id: Number(row.id),
    channel: String(row.channel),
    identifier: String(row.identifier),
    displayName: row.display_name == null ? null : String(row.display_name),
    relationship: String(row.relationship) as ContactRelationship,
    persona: String(row.persona) as ContactPersona,
    priority: String(row.priority) as ContactPriority,
    company: row.company == null ? null : String(row.company),
    preferredTone: row.preferred_tone == null ? null : String(row.preferred_tone),
    notes: row.notes == null ? null : String(row.notes),
    tags: parseJsonArray(row.tags_json),
    source: row.source == null ? null : String(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class ContactIntelligenceStore {
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
      CREATE TABLE IF NOT EXISTS contact_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        identifier TEXT NOT NULL,
        display_name TEXT,
        relationship TEXT NOT NULL,
        persona TEXT NOT NULL,
        priority TEXT NOT NULL,
        company TEXT,
        preferred_tone TEXT,
        notes TEXT,
        tags_json TEXT NOT NULL,
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel, identifier)
      );
    `);
    this.logger.info("Contact intelligence ready", { dbPath });
  }

  upsertContact(input: UpsertContactProfileInput): ContactProfileRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO contact_profiles (
        channel, identifier, display_name, relationship, persona, priority, company,
        preferred_tone, notes, tags_json, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, identifier) DO UPDATE SET
        display_name = excluded.display_name,
        relationship = excluded.relationship,
        persona = excluded.persona,
        priority = excluded.priority,
        company = excluded.company,
        preferred_tone = excluded.preferred_tone,
        notes = excluded.notes,
        tags_json = excluded.tags_json,
        source = excluded.source,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      normalizeKey(input.channel),
      normalizeKey(input.identifier),
      normalizeText(input.displayName),
      input.relationship,
      input.persona,
      input.priority ?? "media",
      normalizeText(input.company),
      normalizeText(input.preferredTone),
      normalizeText(input.notes),
      JSON.stringify(input.tags ?? []),
      normalizeText(input.source),
      now,
      now,
    ) as Record<string, unknown>;

    return mapContactProfile(row);
  }

  findContact(channel: string, identifier: string): ContactProfileRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM contact_profiles
      WHERE channel = ? AND identifier = ?
      LIMIT 1
    `).get(
      normalizeKey(channel),
      normalizeKey(identifier),
    ) as Record<string, unknown> | undefined;

    return row ? mapContactProfile(row) : null;
  }

  searchContacts(query: string, limit = 10): ContactProfileRecord[] {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const normalized = `%${query.trim().toLowerCase()}%`;
    const rows = this.db.prepare(`
      SELECT * FROM contact_profiles
      WHERE lower(identifier) LIKE ?
         OR lower(coalesce(display_name, '')) LIKE ?
         OR lower(coalesce(company, '')) LIKE ?
         OR lower(coalesce(notes, '')) LIKE ?
      ORDER BY
        CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
        updated_at DESC,
        id DESC
      LIMIT ?
    `).all(
      normalized,
      normalized,
      normalized,
      normalized,
      safeLimit,
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => mapContactProfile(row));
  }

  listContacts(limit = 20): ContactProfileRecord[] {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = this.db.prepare(`
      SELECT * FROM contact_profiles
      ORDER BY
        CASE priority WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END,
        updated_at DESC,
        id DESC
      LIMIT ?
    `).all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => mapContactProfile(row));
  }
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

function normalizeAnalysisText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function profileToClassification(profile: ContactProfileRecord, reason: string): CommunicationClassification {
  return {
    channel: profile.channel,
    identifier: profile.identifier,
    displayName: profile.displayName,
    relationship: profile.relationship,
    persona: profile.persona,
    priority: profile.priority,
    actionPolicy:
      profile.relationship === "partner" || profile.relationship === "family" || profile.relationship === "friend"
        ? "draft_first"
        : profile.relationship === "spam"
          ? "ignore"
          : profile.relationship === "social_case"
            ? "manual_review"
            : "draft_first",
    confidence: 0.98,
    reason,
    matchedProfileId: profile.id,
  };
}

export class CommunicationRouter {
  constructor(private readonly contacts: ContactIntelligenceStore) {}

  classify(input: {
    channel: string;
    identifier?: string | null;
    displayName?: string | null;
    subject?: string;
    text?: string;
  }): CommunicationClassification {
    const channel = normalizeKey(input.channel);
    const identifier = normalizeText(input.identifier)?.toLowerCase() ?? null;
    const displayName = normalizeText(input.displayName);

    if (identifier) {
      const profile = this.contacts.findContact(channel, identifier);
      if (profile) {
        return profileToClassification(profile, "Perfil conhecido na base de contatos.");
      }
    }

    const normalized = normalizeAnalysisText(
      [input.subject, input.displayName, input.text].filter(Boolean).join("\n"),
    );

    if (includesAny(normalized, ["esposa", "namorada", "amor", "jantar", "familia", "mãe", "mae", "pai", "irma", "irmão", "irmao"])) {
      return {
        channel,
        identifier,
        displayName,
        relationship: "family",
        persona: "pessoal_afetivo",
        priority: "alta",
        actionPolicy: "draft_first",
        confidence: 0.72,
        reason: "Sinais de contexto pessoal/familiar detectados na mensagem.",
      };
    }

    if (includesAny(normalized, ["cliente", "orcamento", "orçamento", "proposta", "contrato", "suporte", "pagamento", "freela"])) {
      return {
        channel,
        identifier,
        displayName,
        relationship: "client",
        persona: "profissional_comercial",
        priority: "alta",
        actionPolicy: "draft_first",
        confidence: 0.78,
        reason: "Sinais de cliente ou negociação comercial detectados.",
      };
    }

    if (includesAny(normalized, ["lead", "quero saber mais", "quero contratar", "fiquei interessado", "marcar uma conversa"])) {
      return {
        channel,
        identifier,
        displayName,
        relationship: "lead",
        persona: "profissional_comercial",
        priority: "alta",
        actionPolicy: "draft_first",
        confidence: 0.75,
        reason: "Mensagem com sinais de lead comercial.",
      };
    }

    if (includesAny(normalized, [
      "abrigo",
      "encaminhamento",
      "familia referenciada",
      "paefi",
      "cadunico",
      "cadúnico",
      "vulnerabilidade",
      "abordagem",
      "creas",
      "caps",
      "acolhida",
      "banho",
      "espaco de cuidados",
      "espaço de cuidados",
      "casa da sopa",
      "amurt",
      "muralismo",
      "extremo sul",
      "restinga",
      "equipe adulto",
      "adulto",
    ])) {
      return {
        channel,
        identifier,
        displayName,
        relationship: "social_case",
        persona: "social_humanizado",
        priority: "alta",
        actionPolicy: "manual_review",
        confidence: 0.82,
        reason: "Mensagem com contexto da área social/vulnerabilidade.",
      };
    }

    if (includesAny(normalized, ["github", "deploy", "bug", "api", "sistema", "build", "pull request", "infra"])) {
      return {
        channel,
        identifier,
        displayName,
        relationship: "colleague",
        persona: "profissional_tecnico",
        priority: "media",
        actionPolicy: "draft_first",
        confidence: 0.7,
        reason: "Mensagem com contexto técnico/profissional.",
      };
    }

    if (includesAny(normalized, ["desconto", "promo", "cupom", "sale", "oferta imperdivel", "liquidacao", "liquidação"])) {
      return {
        channel,
        identifier,
        displayName,
        relationship: "spam",
        persona: "operacional_neutro",
        priority: "baixa",
        actionPolicy: "ignore",
        confidence: 0.84,
        reason: "Mensagem promocional sem contexto operacional relevante.",
      };
    }

    return {
      channel,
      identifier,
      displayName,
      relationship: "unknown",
      persona: "operacional_neutro",
      priority: "media",
      actionPolicy: "read_only",
      confidence: 0.35,
      reason: "Sem sinais suficientes para classificação forte; manter análise conservadora.",
    };
  }
}
