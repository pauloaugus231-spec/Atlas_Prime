import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ApprovalInboxStore } from "../src/core/approval-inbox.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";
import { CommitmentStore } from "../src/core/autonomy/commitment-store.js";
import { CommandCenterService } from "../src/core/command-center/command-center-service.js";
import { GrowthOpsStore } from "../src/core/growth-ops.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult { name: string; passed: boolean; detail?: string; }
class SilentLogger implements Logger { debug(): void {} info(): void {} warn(): void {} error(): void {} child(): Logger { return this; } }

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-command-center-"));
  const dbPath = path.join(sandboxDir, "state.sqlite");
  const approvals = new ApprovalInboxStore(dbPath, logger);
  const suggestions = new SuggestionStore(dbPath, logger);
  const commitments = new CommitmentStore(dbPath, logger);
  const growthOps = new GrowthOpsStore(dbPath, logger);
  const personalMemory = new PersonalOperationalMemoryStore(dbPath, logger);
  const results: EvalResult[] = [];

  try {
    approvals.createPending({ chatId: 123, channel: "telegram", actionKind: "send_message", subject: "Aprovar follow-up", draftPayload: "{}" });
    suggestions.upsert({ id: "sug-1", observationId: "obs-1", fingerprint: "pending_reply:maria", title: "Follow-up parado", body: "", explanation: "", status: "queued", priority: 0.8, requiresApproval: true });
    commitments.upsert({ id: "commit-1", sourceKind: "telegram", sourceTrust: "operator", statement: "Retornar para Maria", normalizedAction: "Retornar para Maria", confidence: 0.8, evidence: ["chat"], status: "confirmed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    growthOps.createRevenueEntry({ title: "Proposta ativa", amount: 1500, referenceMonth: new Date().toISOString().slice(0, 7), status: "projected" });
    growthOps.createLead({ name: "Maria", status: "proposal", estimatedOneOffValue: 900, nextFollowUpAt: new Date().toISOString() });
    const brief: ExecutiveMorningBrief = {
      timezone: "America/Sao_Paulo",
      events: [{ account: "primary", summary: "Reunião com Maria", start: "2026-04-22T10:00:00-03:00", hasConflict: false }],
      taskBuckets: { today: [], overdue: [], stale: [], actionableCount: 0 },
      emails: [{ subject: "Resposta urgente", from: ["Cliente <x@y.com>"], priority: "alta", summary: "" }],
      approvals: [], workflows: [], focus: [], memoryEntities: { total: 0, byKind: {}, recent: [] },
      motivation: { text: "Foco." }, founderSnapshot: { executiveLine: "", sections: [], trackedMetrics: [] }, nextAction: "Responder Maria.", personalFocus: [], overloadLevel: "leve", mobilityAlerts: [], operationalSignals: [], conflictSummary: { overlaps: 0, duplicates: 0, naming: 0 }, weather: { locationLabel: "Porto Alegre", current: { description: "tempo firme", temperatureC: 20 }, days: [] },
    };
    const service = new CommandCenterService({
      logger,
      approvals,
      suggestions,
      commitments,
      growthOps,
      personalMemory,
      personalOs: { getExecutiveMorningBrief: async () => brief },
      googleWorkspace: { getStatus: () => ({ ready: true, message: "ok" }) } as any,
      email: { getStatus: async () => ({ ready: true, message: "ok" }) } as any,
      whatsappConfig: { enabled: false } as any,
    }, logger);

    const reply = await service.render();
    results.push({
      name: "command_center_renders_operational_snapshot",
      passed: reply.includes("Painel Atlas") && reply.includes("Sugestões proativas: 1") && reply.includes("Pipeline aberto"),
      detail: reply,
    });
  } finally {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }
  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\nCommand center evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
