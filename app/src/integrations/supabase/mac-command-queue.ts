import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { SupabaseMacQueueConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";

export type MacCommandStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface MacCommandQueueStatus {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  url?: string;
  targetHost: string;
  commandsTable: string;
  workersTable: string;
  message: string;
}

export interface MacCommandRecord {
  id: string;
  summary: string;
  argv: string[];
  cwd?: string;
  status: MacCommandStatus;
  requestedBy?: string;
  targetHost?: string;
  workerId?: string;
  resultText?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface EnqueueMacCommandInput {
  summary: string;
  argv: string[];
  cwd?: string;
  requestedBy?: string;
  targetHost?: string;
}

function mapMacCommand(row: Record<string, unknown>): MacCommandRecord {
  return {
    id: String(row.id),
    summary: String(row.summary),
    argv: Array.isArray(row.argv_json) ? (row.argv_json as string[]) : [],
    cwd: typeof row.cwd === "string" ? row.cwd : undefined,
    status: String(row.status) as MacCommandStatus,
    requestedBy: typeof row.requested_by === "string" ? row.requested_by : undefined,
    targetHost: typeof row.target_host === "string" ? row.target_host : undefined,
    workerId: typeof row.worker_id === "string" ? row.worker_id : undefined,
    resultText: typeof row.result_text === "string" ? row.result_text : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: typeof row.started_at === "string" ? row.started_at : undefined,
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : undefined,
  };
}

export class SupabaseMacCommandQueue {
  private readonly client?: SupabaseClient;

  constructor(
    private readonly config: SupabaseMacQueueConfig,
    private readonly logger: Logger,
  ) {
    if (this.isConfigured()) {
      this.client = createClient(this.config.url as string, this.config.serviceRoleKey as string, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
    }
  }

  getStatus(): MacCommandQueueStatus {
    if (!this.config.enabled) {
      return {
        enabled: false,
        configured: false,
        ready: false,
        targetHost: this.config.targetHost,
        commandsTable: this.config.commandsTable,
        workersTable: this.config.workersTable,
        message: "Fila remota do Mac desativada. Defina SUPABASE_MAC_QUEUE_ENABLED=true para habilitar.",
      };
    }

    if (!this.isConfigured()) {
      return {
        enabled: true,
        configured: false,
        ready: false,
        url: this.config.url,
        targetHost: this.config.targetHost,
        commandsTable: this.config.commandsTable,
        workersTable: this.config.workersTable,
        message: "Fila remota do Mac habilitada, mas faltam SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.",
      };
    }

    return {
      enabled: true,
      configured: true,
      ready: true,
      url: this.config.url,
      targetHost: this.config.targetHost,
      commandsTable: this.config.commandsTable,
      workersTable: this.config.workersTable,
      message: "Fila remota do Mac pronta.",
    };
  }

  async enqueueCommand(input: EnqueueMacCommandInput): Promise<MacCommandRecord> {
    this.assertReady();
    const now = new Date().toISOString();
    const payload = {
      id: randomUUID(),
      summary: input.summary.trim(),
      argv_json: input.argv.map((part) => part.trim()).filter(Boolean),
      cwd: input.cwd?.trim() || null,
      status: "pending",
      requested_by: input.requestedBy?.trim() || null,
      target_host: input.targetHost?.trim() || this.config.targetHost,
      worker_id: null,
      result_text: null,
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    };

    const { data, error } = await this.client!
      .from(this.config.commandsTable)
      .insert(payload)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to enqueue Mac command: ${error?.message ?? "unknown error"}`);
    }

    return mapMacCommand(data as Record<string, unknown>);
  }

  async listPending(limit = 10): Promise<MacCommandRecord[]> {
    this.assertReady();
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
    const { data, error } = await this.client!
      .from(this.config.commandsTable)
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(safeLimit);

    if (error) {
      throw new Error(`Failed to list pending Mac commands: ${error.message}`);
    }

    return (data ?? []).map((row) => mapMacCommand(row as Record<string, unknown>));
  }

  async claimNext(workerId: string): Promise<MacCommandRecord | null> {
    this.assertReady();
    const candidates = await this.listPending(10);
    const now = new Date().toISOString();

    for (const candidate of candidates) {
      if (candidate.targetHost && candidate.targetHost !== this.config.targetHost) {
        continue;
      }

      const { data, error } = await this.client!
        .from(this.config.commandsTable)
        .update({
          status: "running",
          worker_id: workerId,
          started_at: now,
          updated_at: now,
        })
        .eq("id", candidate.id)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (error) {
        this.logger.warn("Failed to claim Mac command candidate", {
          id: candidate.id,
          workerId,
          error: error.message,
        });
        continue;
      }

      if (data) {
        return mapMacCommand(data as Record<string, unknown>);
      }
    }

    return null;
  }

  async markCompleted(id: string, resultText: string): Promise<void> {
    await this.updateCommand(id, "completed", resultText);
  }

  async markFailed(id: string, resultText: string): Promise<void> {
    await this.updateCommand(id, "failed", resultText);
  }

  async heartbeat(workerId: string): Promise<void> {
    this.assertReady();
    const now = new Date().toISOString();
    const payload = {
      worker_id: workerId,
      target_host: this.config.targetHost,
      status: "online",
      last_seen_at: now,
      updated_at: now,
    };
    const { error } = await this.client!
      .from(this.config.workersTable)
      .upsert(payload, { onConflict: "worker_id" });
    if (error) {
      throw new Error(`Failed to update Mac worker heartbeat: ${error.message}`);
    }
  }

  private async updateCommand(
    id: string,
    status: Extract<MacCommandStatus, "completed" | "failed">,
    resultText: string,
  ): Promise<void> {
    this.assertReady();
    const now = new Date().toISOString();
    const { error } = await this.client!
      .from(this.config.commandsTable)
      .update({
        status,
        result_text: resultText,
        finished_at: now,
        updated_at: now,
      })
      .eq("id", id);
    if (error) {
      throw new Error(`Failed to update Mac command ${id}: ${error.message}`);
    }
  }

  private isConfigured(): boolean {
    return Boolean(this.config.enabled && this.config.url?.trim() && this.config.serviceRoleKey?.trim());
  }

  private assertReady(): void {
    const status = this.getStatus();
    if (!status.ready || !this.client) {
      throw new Error(status.message);
    }
  }
}
