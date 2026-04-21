import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { AutonomyCollector, AutonomyObservation } from "../src/types/autonomy.js";
import type { Logger } from "../src/types/logger.js";
import { AutonomyAssessor } from "../src/core/autonomy/autonomy-assessor.js";
import { AutonomyAuditStore } from "../src/core/autonomy/autonomy-audit-store.js";
import { ApprovalCollector } from "../src/core/autonomy/collectors/approval-collector.js";
import { GoalRiskCollector } from "../src/core/autonomy/collectors/goal-risk-collector.js";
import { OperationalStateCollector } from "../src/core/autonomy/collectors/operational-state-collector.js";
import { StaleWorkCollector } from "../src/core/autonomy/collectors/stale-work-collector.js";
import { FeedbackStore } from "../src/core/autonomy/feedback-store.js";
import { ObservationStore } from "../src/core/autonomy/observation-store.js";
import { AutonomyLoop } from "../src/core/autonomy/autonomy-loop.js";
import { AutonomyPolicy } from "../src/core/autonomy/autonomy-policy.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function assert(name: string, condition: boolean, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function makeObservation(partial: Partial<AutonomyObservation> = {}): AutonomyObservation {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? "obs-1",
    fingerprint: partial.fingerprint ?? "goal_at_risk:goal-1",
    kind: partial.kind ?? "goal_at_risk",
    sourceKind: partial.sourceKind ?? "system",
    sourceTrust: partial.sourceTrust ?? "owned_account",
    title: partial.title ?? "Meta em risco",
    summary: partial.summary ?? "A meta de receita está perto do prazo e com progresso baixo.",
    evidence: partial.evidence ?? ["goal: receita", "deadline: 2026-05-01"],
    observedAt: partial.observedAt ?? now,
    expiresAt: partial.expiresAt,
    sourceId: partial.sourceId,
  };
}

function makeOperationalState() {
  return {
    mode: "normal",
    focus: [],
    weeklyPriorities: [],
    pendingAlerts: [],
    criticalTasks: [],
    upcomingCommitments: [],
    primaryRisk: "Prazo apertado para fechar objetivo de receita",
    briefing: {},
    recentContext: [],
    signals: [
      {
        key: "sig-1",
        source: "monitored_whatsapp",
        kind: "reply_needed",
        summary: "Responder retorno do CREAS hoje",
        priority: "high",
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    pendingApprovals: 2,
    updatedAt: new Date().toISOString(),
  } as const;
}

async function run(): Promise<void> {
  const logger = makeLogger();
  const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-autonomy-"));
  const dbPath = path.join(tempDir, "autonomy.sqlite");
  const observationStore = new ObservationStore(dbPath, logger);
  const suggestionStore = new SuggestionStore(dbPath, logger);
  const auditStore = new AutonomyAuditStore(dbPath, logger);
  const feedbackStore = new FeedbackStore(dbPath, logger);
  const assessor = new AutonomyAssessor();
  const policy = new AutonomyPolicy();
  const results: EvalResult[] = [];

  const collectors: AutonomyCollector[] = [
    {
      name: "goal-risk",
      collect: () => [makeObservation()],
    },
  ];

  try {
    {
      const loop = new AutonomyLoop({
        collectors,
        assessor,
        policy,
        observations: observationStore,
        suggestions: suggestionStore,
        audit: auditStore,
        feedback: feedbackStore,
        logger,
      });
      const runResult = await loop.runOnce();
      results.push(assert(
        "autonomy_loop_persists_observation_and_suggestion",
        runResult.observations.length === 1
          && runResult.suggestions.length === 1
          && observationStore.listRecent(5).length === 1
          && suggestionStore.listByStatus(["queued"], 5).length === 1,
        JSON.stringify(runResult, null, 2),
      ));
    }

    {
      const lowSignalCollector: AutonomyCollector = {
        name: "memory-low-signal",
        collect: () => [makeObservation({
          id: "obs-2",
          fingerprint: "memory_candidate:1",
          kind: "memory_candidate",
          sourceTrust: "web",
          title: "Talvez seja preferência",
          summary: "Hipótese frágil observada uma vez.",
          evidence: [],
        })],
      };
      const loop = new AutonomyLoop({
        collectors: [lowSignalCollector],
        assessor,
        policy,
        observations: observationStore,
        suggestions: suggestionStore,
        audit: auditStore,
        logger,
      });
      const runResult = await loop.runOnce();
      results.push(assert(
        "autonomy_loop_discards_low_confidence_low_importance_signal",
        runResult.suggestions.length === 0,
        JSON.stringify(runResult, null, 2),
      ));
    }

    {
      const loop = new AutonomyLoop({
        collectors,
        assessor,
        policy,
        observations: observationStore,
        suggestions: suggestionStore,
        audit: auditStore,
        logger,
      });
      const runResult = await loop.runOnce();
      results.push(assert(
        "autonomy_loop_dedupes_existing_suggestion_by_fingerprint",
        runResult.suggestions.length === 1 && suggestionStore.listByStatus(["queued"], 10).length === 1,
        JSON.stringify({ runResult, queued: suggestionStore.listByStatus(["queued"], 10) }, null, 2),
      ));
    }

    {
      const audits = auditStore.listRecent(20);
      results.push(assert(
        "autonomy_loop_records_audit_entries",
        audits.some((entry) => entry.kind === "autonomy_loop_run")
          && audits.some((entry) => entry.kind === "suggestion_upserted"),
        JSON.stringify(audits, null, 2),
      ));
    }

    {
      const suggestion = suggestionStore.listByStatus(["queued"], 1)[0];
      feedbackStore.record({
        suggestionId: suggestion.id,
        feedbackKind: "accepted",
        note: "faz sentido",
      });
      const feedback = feedbackStore.listBySuggestion(suggestion.id);
      results.push(assert(
        "feedback_store_records_feedback_by_suggestion",
        feedback.length === 1 && feedback[0].feedbackKind === "accepted",
        JSON.stringify(feedback, null, 2),
      ));
    }

    {
      const collector = new OperationalStateCollector({
        getOperationalState: () => makeOperationalState(),
      });
      const observations = collector.collect({ now: new Date().toISOString() });
      results.push(assert(
        "operational_state_collector_maps_state_to_observations",
        observations.some((item) => item.kind === "approval_waiting")
          && observations.some((item) => item.kind === "pending_reply")
          && observations.some((item) => item.kind === "goal_at_risk"),
        JSON.stringify(observations, null, 2),
      ));
    }

    {
      const collector = new ApprovalCollector({
        listPendingAll: () => [{
          id: 12,
          chatId: 1,
          channel: "telegram",
          actionKind: "whatsapp_reply",
          subject: "Responder mensagem do institucional",
          draftPayload: "{}",
          status: "pending",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      });
      const observations = collector.collect({ now: new Date().toISOString() });
      results.push(assert(
        "approval_collector_detects_pending_approvals",
        observations.length === 1 && observations[0].kind === "approval_waiting",
        JSON.stringify(observations, null, 2),
      ));
    }

    {
      const collector = new GoalRiskCollector({
        list: () => [{
          id: "goal-42",
          title: "Fechar 2 clientes",
          domain: "revenue",
          deadline: new Date(Date.now() + (3 * 86_400_000)).toISOString().slice(0, 10),
          progress: 0.2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      });
      const observations = collector.collect({ now: new Date().toISOString() });
      results.push(assert(
        "goal_risk_collector_detects_deadline_risk",
        observations.length === 1 && observations[0].kind === "goal_at_risk",
        JSON.stringify(observations, null, 2),
      ));
    }

    {
      const staleDate = new Date(Date.now() - (6 * 86_400_000)).toISOString();
      const collector = new StaleWorkCollector({
        listItems: () => [{
          id: 7,
          category: "opportunity",
          title: "Lead parado",
          details: null,
          status: "open",
          priority: "high",
          horizon: "short",
          stage: "build",
          project: null,
          tags: [],
          source: null,
          cashPotential: null,
          assetValue: null,
          automationValue: null,
          scaleValue: null,
          authorityValue: null,
          effort: null,
          confidence: null,
          priorityScore: 0,
          createdAt: staleDate,
          updatedAt: staleDate,
        }],
      });
      const observations = collector.collect({ now: new Date().toISOString() });
      results.push(assert(
        "stale_work_collector_detects_old_build_item",
        observations.length === 1 && observations[0].kind === "stale_lead",
        JSON.stringify(observations, null, 2),
      ));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const failures = results.filter((result) => !result.passed);
  for (const result of results.filter((item) => item.passed)) {
    console.log(`PASS ${result.name}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
    }
    process.exit(1);
  }

  console.log(`\nAutonomy loop evals ok: ${results.length}/${results.length}`);
}

void run();
