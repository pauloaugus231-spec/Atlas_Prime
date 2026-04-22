import process from "node:process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { CommitmentStore } from "../src/core/autonomy/commitment-store.js";
import { ContactIntelligenceStore } from "../src/core/contact-intelligence.js";
import { FinanceReviewService } from "../src/core/finance/finance-review-service.js";
import { FinanceStore } from "../src/core/finance/finance-store.js";
import { GrowthOpsStore } from "../src/core/growth-ops.js";
import { LifeManagementDirectService } from "../src/core/life-management-direct-service.js";
import { RelationshipService } from "../src/core/relationship/relationship-service.js";
import { RelationshipStore } from "../src/core/relationship/relationship-store.js";
import { TimeOsService } from "../src/core/time-os-service.js";
import type { ExecutiveMorningBrief } from "../src/core/personal-os.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

function makeBrief(): ExecutiveMorningBrief {
  return {
    timezone: "America/Sao_Paulo",
    events: [
      {
        account: "primary",
        summary: "Reunião com cliente às 10h",
        start: "2026-04-22T10:00:00-03:00",
        hasConflict: true,
      },
    ],
    taskBuckets: {
      today: [{ text: "Responder Maria", source: "manual" }],
      overdue: [{ text: "Enviar proposta", source: "manual" }],
      stale: [],
      actionableCount: 2,
    },
    emails: [],
    approvals: [],
    workflows: [],
    focus: [],
    memoryEntities: { total: 0, byKind: {}, recent: [] },
    motivation: { text: "Foco no essencial." },
    founderSnapshot: { executiveLine: "", sections: [], trackedMetrics: [] },
    nextAction: "Confirmar horário com o cliente.",
    personalFocus: [],
    overloadLevel: "moderado",
    mobilityAlerts: ["Saia 20 minutos antes por trânsito."],
    operationalSignals: [],
    conflictSummary: { overlaps: 1, duplicates: 0, naming: 0 },
    weather: {
      locationLabel: "Porto Alegre",
      current: { description: "tempo firme", temperatureC: 22 },
      days: [],
    },
  };
}

async function run(): Promise<void> {
  const logger = new SilentLogger();
  const sandboxDir = mkdtempSync(path.join(tmpdir(), "atlas-life-domains-"));
  const dbPath = path.join(sandboxDir, "life-domains.sqlite");
  const results: EvalResult[] = [];

  try {
    const timeOs = new TimeOsService({ getExecutiveMorningBrief: async () => makeBrief() }, logger);
    const financeStore = new FinanceStore(dbPath, logger);
    const financeReview = new FinanceReviewService(financeStore, logger);
    const growthOps = new GrowthOpsStore(dbPath, logger);
    const contacts = new ContactIntelligenceStore(dbPath, logger);
    const commitments = new CommitmentStore(dbPath, logger);
    const relationships = new RelationshipService(
      new RelationshipStore(dbPath, logger),
      growthOps,
      contacts,
      commitments,
      logger,
    );
    const direct = new LifeManagementDirectService({
      logger,
      timeOs,
      financeStore,
      financeReview,
      relationships,
      buildBaseMessages: () => [],
    });

    const timeReply = await timeOs.renderOverview();
    results.push({
      name: "life_domains_time_os_summarizes_day",
      passed: timeReply.includes("Compromissos hoje: 1") && timeReply.includes("Conflitos: 2") && timeReply.includes("Carga do dia: moderado"),
      detail: timeReply,
    });

    const financeReply = await direct.tryRun({
      userPrompt: "registre conta de agua 120 vence amanhã",
      requestId: "life-finance-1",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    financeStore.createEntry({
      title: "Combustível atrasado",
      amount: 80,
      kind: "expense",
      status: "due",
      dueAt: "2026-04-20T12:00:00.000Z",
      sourceKind: "manual",
    });
    const financeOverview = financeReview.renderOverview(new Date("2026-04-22T12:00:00.000Z"));
    results.push({
      name: "life_domains_finance_parser_and_review_work_together",
      passed:
        financeReply?.reply.includes("Lançamento financeiro salvo") === true
        && financeOverview.includes("Vencidas: 1")
        && financeOverview.includes("A vencer: conta agua"),
      detail: JSON.stringify({ financeReply, financeOverview }, null, 2),
    });

    commitments.upsert({
      sourceKind: "telegram",
      sourceTrust: "operator",
      statement: "Retornar para Maria com a proposta.",
      normalizedAction: "Retornar para Maria com a proposta",
      confidence: 0.9,
      evidence: ["chat"],
      status: "confirmed",
    });
    relationships.saveManual({
      displayName: "Maria",
      kind: "client",
      nextFollowUpAt: "2026-04-22T09:00:00.000Z",
      notes: ["Cliente aguardando proposta."],
    });
    const followUpReply = await direct.tryRun({
      userPrompt: "quem precisa de follow-up?",
      requestId: "life-relationship-1",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    const profileReply = await direct.tryRun({
      userPrompt: "o que eu prometi para Maria?",
      requestId: "life-relationship-2",
      orchestration: { channel: "telegram", recentMessages: [] },
    });
    results.push({
      name: "life_domains_relationships_surface_follow_up_and_commitments",
      passed:
        followUpReply?.reply.includes("Maria") === true
        && profileReply?.reply.includes("Retornar para Maria com a proposta") === true,
      detail: JSON.stringify({ followUpReply, profileReply }, null, 2),
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

  console.log(`\nLife domains evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
