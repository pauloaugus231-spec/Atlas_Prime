import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import { DeliberativeReasoningRuntime } from "../src/core/deliberative-reasoning-runtime.js";
import { ReasoningEngine, type ProactiveInsight } from "../src/core/reasoning-engine.js";
import { UserModelTracker } from "../src/core/user-model-tracker.js";
import type { ActiveGoal } from "../src/core/goal-store.js";
import type { ContextBundle } from "../src/core/context-assembler.js";
import type { Logger } from "../src/types/logger.js";

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

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function makeReasoningEngine(goals: ActiveGoal[] = []): ReasoningEngine {
  const logger = makeLogger();
  return new ReasoningEngine(
    { list: () => goals, summarize: () => "Objetivos ativos" },
    { getProfile: () => defaultProfile() },
    {
      listItems: () => [],
      getContextSummary: () => undefined,
    },
    logger,
  );
}

function defaultProfile() {
  return {
    displayName: "Paulo",
    primaryRole: "operador",
    routineSummary: [],
    timezone: "America/Sao_Paulo",
    preferredChannels: ["telegram"],
    priorityAreas: [],
    defaultAgendaScope: "primary",
    workCalendarAliases: [],
    responseStyle: "direto",
    briefingPreference: "executivo",
    detailLevel: "equilibrado",
    tonePreference: "objetivo",
    defaultOperationalMode: "normal",
    mobilityPreferences: [],
    autonomyPreferences: [],
    savedFocus: [],
    routineAnchors: [],
    operationalRules: [],
    attire: {
      umbrellaProbabilityThreshold: 60,
      coldTemperatureC: 15,
      lightClothingTemperatureC: 24,
      carryItems: [],
    },
    fieldModeHours: 4,
  } as const;
}

function defaultOperationalState(overloadLevel: "leve" | "moderado" | "pesado" = "leve") {
  return {
    mode: "normal",
    focus: [],
    weeklyPriorities: [],
    pendingAlerts: [],
    criticalTasks: [],
    upcomingCommitments: [],
    briefing: { overloadLevel },
    recentContext: [],
    signals: [],
    pendingApprovals: 0,
    updatedAt: new Date().toISOString(),
  } as const;
}

function hasInsight(insights: ProactiveInsight[], type: ProactiveInsight["type"], urgency?: ProactiveInsight["urgency"]): boolean {
  return insights.some((insight) => insight.type === type && (!urgency || insight.urgency === urgency));
}

async function run(): Promise<void> {
  const logger = makeLogger();
  const results: EvalResult[] = [];
  const revenueGoal: ActiveGoal = {
    id: "goal-1",
    title: "Fechar 2 clientes SaaS",
    domain: "revenue",
    deadline: daysFromNow(3),
    progress: 0.1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  {
    const engine = makeReasoningEngine([revenueGoal]);
    const trace = engine.analyze({
      userPrompt: "preparar follow-up para cliente",
      operationalState: defaultOperationalState(),
      profile: defaultProfile(),
      recentMessages: [],
      currentHour: 9,
    });
    results.push(assert(
      "reasoning_detects_deadline_approaching_high_urgency",
      hasInsight(trace.proactiveInsights, "deadline_approaching", "high"),
      JSON.stringify(trace.proactiveInsights, null, 2),
    ));
  }

  {
    const engine = makeReasoningEngine();
    const trace = engine.analyze({
      userPrompt: "vamos resolver proposta",
      operationalState: defaultOperationalState(),
      profile: defaultProfile(),
      recentMessages: [
        "me ajuda com precificação",
        "precificação do serviço",
        "qual preço cobrar",
      ],
      currentHour: 11,
    });
    results.push(assert(
      "reasoning_detects_repeated_pricing_pattern",
      hasInsight(trace.proactiveInsights, "pattern_detected"),
      JSON.stringify(trace.proactiveInsights, null, 2),
    ));
  }

  {
    const engine = makeReasoningEngine();
    const trace = engine.analyze({
      userPrompt: "organize meu dia",
      operationalState: defaultOperationalState("pesado"),
      profile: defaultProfile(),
      recentMessages: [],
      currentHour: 8,
    });
    results.push(assert(
      "reasoning_detects_morning_overload_warning",
      hasInsight(trace.proactiveInsights, "overload_warning"),
      JSON.stringify(trace.proactiveInsights, null, 2),
    ));
  }

  {
    const engine = makeReasoningEngine();
    results.push(assert(
      "reasoning_does_not_surface_low_urgency_insight",
      !engine.shouldSurfaceInsight({
        type: "goal_misalignment",
        urgency: "low",
        domain: "ops",
        message: "baixa urgência",
      }),
    ));
  }

  {
    const dir = mkdtempSync(path.join(tmpdir(), "atlas-user-model-"));
    try {
      const tracker = new UserModelTracker(
        new DatabaseSync(path.join(dir, "user-behavior-model.sqlite")),
        logger,
      );
      tracker.updateFromInteraction({
        hour: 9,
        domain: "revenue",
        promptComplexity: "strategic",
        hadProactiveInsight: true,
        userReacted: true,
      });
      const model = tracker.getModel();
      results.push(assert(
        "user_model_tracker_persists_and_returns_model",
        model?.energyPeaks.includes(9) === true
          && model.decisionWindows.includes(9)
          && model.strongestDomain === "revenue",
        JSON.stringify(model, null, 2),
      ));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  {
    const engine = makeReasoningEngine([revenueGoal]);
    const runtime = new DeliberativeReasoningRuntime({ reasoningEngine: engine });
    const context: ContextBundle = {
      requestId: "reasoning-pipeline-1",
      userPrompt: "falar com cliente amanhã",
      activeUserPrompt: "falar com cliente amanhã",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "answer",
          confidence: 0.9,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
      preferences: {
        responseStyle: "concise",
        responseLength: "short",
        proactiveNextStep: true,
        preferredAgentName: "Atlas",
      },
      recentMessages: [],
      profile: defaultProfile(),
      operationalState: defaultOperationalState(),
      messages: [
        { role: "system", content: "system-base" },
        { role: "user", content: "falar com cliente amanhã" },
      ],
      tools: [],
      maxToolIterations: 1,
    } as ContextBundle;
    const enriched = runtime.enrichContext({
      context,
      intent: { compoundIntent: false } as any,
      requestLogger: logger,
    });

    results.push(assert(
      "pipeline_enriches_context_bundle_with_reasoning_trace",
      Boolean(enriched.reasoningTrace)
        && enriched.messages.some((message) => message.role === "system" && message.content.includes("Percepção proativa")),
      JSON.stringify({ reasoningTrace: enriched.reasoningTrace, messages: enriched.messages }, null, 2),
    ));
  }

  const failures = results.filter((result) => !result.passed);
  for (const result of results.filter((item) => item.passed)) {
    console.log(`PASS ${result.name}`);
  }
  for (const failure of failures) {
    console.error(`FAIL ${failure.name}`);
    if (failure.detail) {
      console.error(failure.detail);
    }
  }

  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("PASS eval-reasoning-engine");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
