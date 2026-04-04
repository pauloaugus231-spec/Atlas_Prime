import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../types/logger.js";
import type {
  CreateLeadInput,
  CreateRevenueEntryInput,
  LeadRecord,
  LeadStatus,
  ListLeadsFilters,
  MonthlyRevenueScoreboard,
  RevenueEntryRecord,
  UpdateLeadInput,
} from "../types/growth-ops.js";

type SqlValue = string | number | bigint | Uint8Array | null;

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeCurrency(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 100) / 100;
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

function currentMonthReference(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function mapLead(row: Record<string, unknown>): LeadRecord {
  return {
    id: Number(row.id),
    name: String(row.name),
    company: row.company == null ? null : String(row.company),
    email: row.email == null ? null : String(row.email),
    phone: row.phone == null ? null : String(row.phone),
    source: row.source == null ? null : String(row.source),
    status: String(row.status) as LeadStatus,
    domain: row.domain == null ? null : String(row.domain),
    estimatedMonthlyValue: row.estimated_monthly_value == null ? null : Number(row.estimated_monthly_value),
    estimatedOneOffValue: row.estimated_one_off_value == null ? null : Number(row.estimated_one_off_value),
    notes: row.notes == null ? null : String(row.notes),
    nextFollowUpAt: row.next_follow_up_at == null ? null : String(row.next_follow_up_at),
    lastContactAt: row.last_contact_at == null ? null : String(row.last_contact_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRevenueEntry(row: Record<string, unknown>): RevenueEntryRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    amount: Number(row.amount),
    kind: String(row.kind) as RevenueEntryRecord["kind"],
    status: String(row.status) as RevenueEntryRecord["status"],
    channel: row.channel == null ? null : String(row.channel),
    referenceMonth: String(row.reference_month),
    receivedAt: row.received_at == null ? null : String(row.received_at),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class GrowthOpsStore {
  private readonly db: DatabaseSync;

  constructor(
    private readonly dbPath: string,
    private readonly logger: Logger,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        company TEXT,
        email TEXT,
        phone TEXT,
        source TEXT,
        status TEXT NOT NULL,
        domain TEXT,
        estimated_monthly_value REAL,
        estimated_one_off_value REAL,
        notes TEXT,
        next_follow_up_at TEXT,
        last_contact_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revenue_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        channel TEXT,
        reference_month TEXT NOT NULL,
        received_at TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.logger.info("Growth ops store ready", {
      dbPath,
    });
  }

  createLead(input: CreateLeadInput): LeadRecord {
    const now = new Date().toISOString();
    const statement = this.db.prepare(`
      INSERT INTO leads (
        name, company, email, phone, source, status, domain,
        estimated_monthly_value, estimated_one_off_value, notes,
        next_follow_up_at, last_contact_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    const row = statement.get(
      input.name.trim(),
      normalizeOptionalText(input.company),
      normalizeOptionalText(input.email),
      normalizeOptionalText(input.phone),
      normalizeOptionalText(input.source),
      input.status ?? "new",
      normalizeOptionalText(input.domain),
      normalizeCurrency(input.estimatedMonthlyValue),
      normalizeCurrency(input.estimatedOneOffValue),
      normalizeOptionalText(input.notes),
      normalizeOptionalText(input.nextFollowUpAt),
      normalizeOptionalText(input.lastContactAt),
      now,
      now,
    ) as Record<string, unknown>;
    return mapLead(row);
  }

  listLeads(filters: ListLeadsFilters = {}): LeadRecord[] {
    const whereClauses: string[] = [];
    const params: SqlValue[] = [];

    if (filters.status) {
      whereClauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters.domain?.trim()) {
      whereClauses.push("domain = ?");
      params.push(filters.domain.trim());
    }
    if (filters.search?.trim()) {
      whereClauses.push("(name LIKE ? OR company LIKE ? OR email LIKE ? OR notes LIKE ?)");
      const searchValue = `%${filters.search.trim()}%`;
      params.push(searchValue, searchValue, searchValue, searchValue);
    }

    const query = `
      SELECT *
      FROM leads
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY
        CASE status
          WHEN 'proposal' THEN 0
          WHEN 'qualified' THEN 1
          WHEN 'contacted' THEN 2
          WHEN 'new' THEN 3
          WHEN 'won' THEN 4
          WHEN 'dormant' THEN 5
          WHEN 'lost' THEN 6
          ELSE 7
        END,
        COALESCE(next_follow_up_at, updated_at) ASC,
        updated_at DESC
      LIMIT ?
    `;

    params.push(normalizeLimit(filters.limit));
    const rows = this.db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => mapLead(row));
  }

  updateLead(input: UpdateLeadInput): LeadRecord {
    const assignments: string[] = [];
    const params: SqlValue[] = [];

    const patch = <T extends SqlValue>(field: string, value: T | undefined) => {
      if (value !== undefined) {
        assignments.push(`${field} = ?`);
        params.push(value);
      }
    };

    patch("name", input.name?.trim());
    patch("company", normalizeOptionalText(input.company));
    patch("email", normalizeOptionalText(input.email));
    patch("phone", normalizeOptionalText(input.phone));
    patch("source", normalizeOptionalText(input.source));
    patch("status", input.status);
    patch("domain", normalizeOptionalText(input.domain));
    patch("estimated_monthly_value", normalizeCurrency(input.estimatedMonthlyValue));
    patch("estimated_one_off_value", normalizeCurrency(input.estimatedOneOffValue));
    patch("notes", normalizeOptionalText(input.notes));
    patch("next_follow_up_at", normalizeOptionalText(input.nextFollowUpAt));
    patch("last_contact_at", normalizeOptionalText(input.lastContactAt));

    if (assignments.length === 0) {
      throw new Error("No lead fields were provided for update.");
    }

    assignments.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(input.id);

    const row = this.db.prepare(`
      UPDATE leads
      SET ${assignments.join(", ")}
      WHERE id = ?
      RETURNING *
    `).get(...params) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Lead not found: ${input.id}`);
    }

    return mapLead(row);
  }

  createRevenueEntry(input: CreateRevenueEntryInput): RevenueEntryRecord {
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO revenue_entries (
        title, amount, kind, status, channel, reference_month, received_at, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      input.title.trim(),
      normalizeCurrency(input.amount) ?? 0,
      input.kind ?? "one_off",
      input.status ?? "projected",
      normalizeOptionalText(input.channel),
      input.referenceMonth.trim(),
      normalizeOptionalText(input.receivedAt),
      normalizeOptionalText(input.notes),
      now,
      now,
    ) as Record<string, unknown>;
    return mapRevenueEntry(row);
  }

  getMonthlyScoreboard(referenceMonth = currentMonthReference()): MonthlyRevenueScoreboard {
    const revenueRows = this.db.prepare(`
      SELECT *
      FROM revenue_entries
      WHERE reference_month = ?
      ORDER BY created_at DESC
    `).all(referenceMonth) as Array<Record<string, unknown>>;
    const revenueEntries = revenueRows.map((row) => mapRevenueEntry(row));

    const leadStatusRows = this.db.prepare(`
      SELECT status, COUNT(*) AS total
      FROM leads
      GROUP BY status
    `).all() as Array<Record<string, unknown>>;

    const upcomingFollowUps = this.db.prepare(`
      SELECT *
      FROM leads
      WHERE next_follow_up_at IS NOT NULL
        AND status NOT IN ('won', 'lost')
      ORDER BY next_follow_up_at ASC
      LIMIT 8
    `).all() as Array<Record<string, unknown>>;

    const totalProjected = revenueEntries
      .filter((entry) => entry.status === "projected" || entry.status === "won" || entry.status === "received")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const totalWon = revenueEntries
      .filter((entry) => entry.status === "won" || entry.status === "received")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const totalReceived = revenueEntries
      .filter((entry) => entry.status === "received")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const recurringProjected = revenueEntries
      .filter((entry) => entry.kind === "recurring" && (entry.status === "projected" || entry.status === "won" || entry.status === "received"))
      .reduce((sum, entry) => sum + entry.amount, 0);
    const recurringReceived = revenueEntries
      .filter((entry) => entry.kind === "recurring" && entry.status === "received")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const oneOffReceived = revenueEntries
      .filter((entry) => entry.kind === "one_off" && entry.status === "received")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const pipelineOpenValue = this.listLeads({
      limit: 100,
    })
      .filter((lead) => ["new", "contacted", "qualified", "proposal"].includes(lead.status))
      .reduce((sum, lead) => sum + (lead.estimatedMonthlyValue ?? 0) + (lead.estimatedOneOffValue ?? 0), 0);

    return {
      referenceMonth,
      totalProjected,
      totalWon,
      totalReceived,
      recurringProjected,
      recurringReceived,
      oneOffReceived,
      pipelineOpenValue,
      leadsByStatus: leadStatusRows.map((row) => ({
        status: String(row.status) as LeadStatus,
        total: Number(row.total),
      })),
      upcomingFollowUps: upcomingFollowUps.map((row) => mapLead(row)),
    };
  }
}
