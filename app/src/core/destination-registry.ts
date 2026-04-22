import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppConfig } from "../types/config.js";
import type {
  DeliveryDestination,
  DeliveryDestinationAudience,
  DeliveryDestinationKind,
  DeliveryDestinationPrivacyLevel,
} from "../types/delivery-destination.js";
import type { Logger } from "../types/logger.js";

interface DestinationRow {
  id: string;
  user_id: string;
  label: string;
  aliases_json: string;
  kind: string;
  channel: string;
  address: string;
  audience: string;
  max_privacy_level: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseAliases(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function mapRow(row: DestinationRow | undefined): DeliveryDestination | undefined {
  if (!row) {
    return undefined;
  }
  return {
    id: row.id,
    userId: row.user_id,
    label: row.label,
    aliases: parseAliases(row.aliases_json),
    kind: row.kind as DeliveryDestinationKind,
    channel: row.channel as DeliveryDestination["channel"],
    address: row.address,
    audience: row.audience as DeliveryDestinationAudience,
    maxPrivacyLevel: row.max_privacy_level as DeliveryDestinationPrivacyLevel,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DestinationRegistry {
  private readonly db: DatabaseSync;

  constructor(
    dbPath: string,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_destinations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        aliases_json TEXT NOT NULL,
        kind TEXT NOT NULL,
        channel TEXT NOT NULL,
        address TEXT NOT NULL,
        audience TEXT NOT NULL,
        max_privacy_level TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_destinations_user_label
      ON delivery_destinations(user_id, label);
    `);
    this.seedOperatorDestinations();
  }

  private seedOperatorDestinations(): void {
    const userId = this.config.operator.operatorId;
    for (const channel of this.config.operator.channels.filter((item) => item.enabled)) {
      if (channel.provider === "telegram") {
        this.upsert({
          userId,
          label: channel.mode === "direct_operator" ? "meu telegram" : channel.displayName,
          aliases: channel.mode === "direct_operator" ? ["eu", "me", "meu chat", "meu telegram"] : [channel.displayName],
          kind: "telegram_chat",
          channel: "telegram",
          address: channel.externalId,
          audience: "self",
          maxPrivacyLevel: "private",
        });
      }
      if (channel.provider === "whatsapp") {
        this.upsert({
          userId,
          label: channel.mode === "direct_operator" ? "meu whatsapp" : channel.displayName,
          aliases: channel.mode === "direct_operator" ? ["meu whatsapp"] : [channel.displayName],
          kind: "whatsapp_chat",
          channel: "whatsapp",
          address: channel.externalId,
          audience: channel.mode === "monitored" ? "team" : "self",
          maxPrivacyLevel: channel.mode === "monitored" ? "team_shareable" : "private",
        });
      }
    }
  }

  getCurrentUserId(): string {
    return this.config.operator.operatorId;
  }

  upsert(input: {
    userId?: string;
    label: string;
    aliases?: string[];
    kind: DeliveryDestinationKind;
    channel: DeliveryDestination["channel"];
    address: string;
    audience: DeliveryDestinationAudience;
    maxPrivacyLevel: DeliveryDestinationPrivacyLevel;
    enabled?: boolean;
  }): DeliveryDestination {
    const userId = input.userId ?? this.getCurrentUserId();
    const now = new Date().toISOString();
    const aliases = [...new Set([input.label, ...(input.aliases ?? [])].map((item) => item.trim()).filter(Boolean))];
    const existing = this.db.prepare(`
      SELECT *
      FROM delivery_destinations
      WHERE user_id = ?
        AND label = ?
      LIMIT 1
    `).get(userId, input.label.trim()) as DestinationRow | undefined;
    const row = this.db.prepare(`
      INSERT INTO delivery_destinations (
        id, user_id, label, aliases_json, kind, channel, address, audience, max_privacy_level, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, label)
      DO UPDATE SET
        aliases_json = excluded.aliases_json,
        kind = excluded.kind,
        channel = excluded.channel,
        address = excluded.address,
        audience = excluded.audience,
        max_privacy_level = excluded.max_privacy_level,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
      RETURNING *
    `).get(
      existing?.id ?? randomUUID(),
      userId,
      input.label.trim(),
      JSON.stringify(aliases),
      input.kind,
      input.channel,
      input.address.trim(),
      input.audience,
      input.maxPrivacyLevel,
      input.enabled === false ? 0 : 1,
      existing?.created_at ?? now,
      now,
    ) as DestinationRow | undefined;
    return mapRow(row)!;
  }

  list(userId = this.getCurrentUserId()): DeliveryDestination[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM delivery_destinations
      WHERE user_id = ?
      ORDER BY audience ASC, label ASC
    `).all(userId) as unknown as DestinationRow[];
    return rows.map((row) => mapRow(row)!).filter(Boolean);
  }

  resolve(query: string, userId = this.getCurrentUserId()): DeliveryDestination | undefined {
    const normalized = normalize(query);
    return this.list(userId).find((item) => {
      const candidates = [item.label, ...item.aliases].map((entry) => normalize(entry));
      return candidates.some((entry) => entry === normalized || normalized.includes(entry) || entry.includes(normalized));
    });
  }

  renderList(userId = this.getCurrentUserId()): string {
    const items = this.list(userId);
    if (items.length === 0) {
      return "Nenhum destino de entrega foi cadastrado ainda.";
    }
    return [
      "Destinos cadastrados:",
      ...items.map((item) => `- ${item.label} | ${item.channel}/${item.audience} | ${item.address}`),
    ].join("\n");
  }
}
