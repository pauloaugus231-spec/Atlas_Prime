import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentRunResult } from "../src/core/agent-core.js";
import { buildMorningBriefReply } from "../src/core/agent-core.js";
import { DecisionsLoader } from "../src/core/decisions-loader.js";
import { FileAccessPolicy } from "../src/core/file-access-policy.js";
import { GoalStore } from "../src/core/goal-store.js";
import { OperationalContextDirectService } from "../src/core/operational-context-direct-service.js";
import { WorkflowPlanBuilderService } from "../src/core/plan-builder.js";
import { createLogger } from "../src/utils/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function assert(name: string, condition: boolean, detail?: string): EvalResult {
  return { name, passed: condition, detail };
}

function noMatch(): never {
  throw new Error("Helper should not be called in this eval.");
}

async function run(): Promise<void> {
  const logger = createLogger("error");
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "atlas-goal-runtime-"));
  const results: EvalResult[] = [];

  try {
    const workspaceDir = path.join(tempRoot, "workspace");
    const authorizedProjectsDir = path.join(tempRoot, "authorized_projects");
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(authorizedProjectsDir, { recursive: true });

    const goalStore = new GoalStore(path.join(tempRoot, "state", "goals.sqlite"), logger);
    const fileAccess = new FileAccessPolicy(workspaceDir, authorizedProjectsDir);
    const decisionsPath = path.join(tempRoot, "DECISIONS.md");
    writeFileSync(
      decisionsPath,
      [
        "# Decisões",
        "",
        "## 2026-04-21 — Primeira decisão",
        "Contexto inicial.",
      ].join("\n"),
      "utf8",
    );

    const decisionsLoader = new DecisionsLoader(fileAccess, logger, decisionsPath);
    const firstSummary = decisionsLoader.summarizeSync();
    writeFileSync(
      decisionsPath,
      [
        "# Decisões",
        "",
        "## 2026-04-21 — Decisão atualizada",
        "Novo contexto arquitetural.",
      ].join("\n"),
      "utf8",
    );
    const secondSummary = decisionsLoader.summarizeSync();
    results.push(assert(
      "decisions_loader_sync_reflects_file_changes_without_restart",
      firstSummary !== secondSummary
        && secondSummary?.includes("Decisão atualizada") === true,
      JSON.stringify({ firstSummary, secondSummary }, null, 2),
    ));

    const service = new OperationalContextDirectService({
      logger,
      googleWorkspace: {
        getStatus: () => ({ ready: false, message: "indisponível" }),
        getDailyBrief: async () => ({
          timezone: "America/Sao_Paulo",
          windowStart: new Date(0).toISOString(),
          windowEnd: new Date(0).toISOString(),
          events: [],
          tasks: [],
        }),
      },
      memory: {
        getDailyFocus: () => [],
      },
      personalOs: {
        getExecutiveMorningBrief: async () => ({
          timezone: "America/Sao_Paulo",
          events: [],
          taskBuckets: { today: [], overdue: [], stale: [], actionableCount: 0 },
          emails: [],
          approvals: [],
          workflows: [],
          focus: [],
          memoryEntities: { total: 0, byKind: {}, recent: [] },
          motivation: { text: "fallback" },
          founderSnapshot: { sections: [] },
          personalFocus: [],
          overloadLevel: "leve",
          mobilityAlerts: [],
          operationalSignals: [],
          conflictSummary: { overlaps: 0, duplicates: 0, naming: 0 },
        }),
      },
      preferences: {
        get: () => ({
          responseStyle: "executive",
          responseLength: "medium",
          proactiveNextStep: false,
          autoSourceFallback: false,
          preferredAgentName: "Atlas",
        }),
        update: (input) => ({
          responseStyle: input.responseStyle ?? "executive",
          responseLength: input.responseLength ?? "medium",
          proactiveNextStep: input.proactiveNextStep ?? false,
          autoSourceFallback: input.autoSourceFallback ?? false,
          preferredAgentName: input.preferredAgentName ?? "Atlas",
        }),
      },
      personalMemory: {
        getProfile: () => ({
          displayName: "Usuário",
          primaryRole: "operador",
          routineSummary: [],
          timezone: "America/Sao_Paulo",
          preferredChannels: ["telegram"],
          priorityAreas: [],
          defaultAgendaScope: "both",
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
            umbrellaProbabilityThreshold: 40,
            coldTemperatureC: 14,
            lightClothingTemperatureC: 24,
            carryItems: [],
          },
          fieldModeHours: 6,
        }),
        getOperationalState: () => ({
          mode: "normal",
          focus: [],
          weeklyPriorities: [],
          pendingAlerts: [],
          criticalTasks: [],
          upcomingCommitments: [],
          briefing: {},
          recentContext: [],
          signals: [],
          pendingApprovals: 0,
          updatedAt: new Date(0).toISOString(),
        }),
        findLearnedPreferences: () => [],
        findItems: () => [],
      },
      goalStore,
      executeToolDirect: async () => ({
        requestId: "noop",
        content: "",
        rawResult: {},
      }),
      buildBaseMessages: () => [],
      helpers: {
        isOperationalBriefPrompt: noMatch,
        buildOperationalBriefReply: noMatch,
        isMorningBriefPrompt: noMatch,
        buildMorningBriefReply: noMatch,
        resolveEffectiveOperationalMode: () => null,
        isPersonalOperationalProfileShowPrompt: noMatch,
        buildPersonalOperationalProfileReply: noMatch,
        isOperationalStateShowPrompt: noMatch,
        buildOperationalStateReply: noMatch,
        isLearnedPreferencesListPrompt: noMatch,
        resolveLearnedPreferencesListFilter: noMatch,
        buildLearnedPreferencesReply: noMatch,
        isLearnedPreferencesDeletePrompt: noMatch,
        extractLearnedPreferenceId: noMatch,
        extractLearnedPreferenceDeleteTarget: noMatch,
        buildLearnedPreferenceDeactivatedReply: noMatch,
        isPersonalOperationalProfileUpdatePrompt: noMatch,
        extractPersonalOperationalProfileUpdate: noMatch,
        buildPersonalOperationalProfileUpdatedReply: noMatch,
        isPersonalOperationalProfileDeletePrompt: noMatch,
        extractPersonalOperationalProfileRemoveQuery: noMatch,
        removeFromPersonalOperationalProfile: noMatch,
        buildPersonalOperationalProfileRemovedReply: noMatch,
        isPersonalMemoryListPrompt: noMatch,
        buildPersonalMemoryListReply: noMatch,
        isPersonalMemorySavePrompt: noMatch,
        extractPersonalMemoryStatement: noMatch,
        inferPersonalMemoryKind: noMatch,
        buildPersonalMemoryTitle: noMatch,
        buildPersonalMemorySavedReply: noMatch,
        isPersonalMemoryUpdatePrompt: noMatch,
        extractPersonalMemoryId: noMatch,
        extractPersonalMemoryUpdateTarget: noMatch,
        extractPersonalMemoryUpdateContent: noMatch,
        buildPersonalMemoryAmbiguousReply: noMatch,
        buildPersonalMemoryUpdatedReply: noMatch,
        isPersonalMemoryDeletePrompt: noMatch,
        extractPersonalMemoryDeleteTarget: noMatch,
        buildPersonalMemoryDeletedReply: noMatch,
      },
    });

    const baseInput = {
      requestId: "req-1",
      orchestration: { route: { primaryDomain: "secretario_operacional", secondaryDomains: [] } } as any,
      preferences: undefined,
    };

    const saveResult = await service.tryRunGoalSave({
      ...baseInput,
      userPrompt: "salve meu objetivo de fechar 2 clientes SaaS até 2026-05-31",
    });
    results.push(assert(
      "goal_save_route_persists_active_goal",
      saveResult?.reply.includes("Objetivo ativo salvo.") === true
        && goalStore.list().length === 1,
      JSON.stringify({ saveReply: saveResult?.reply, goals: goalStore.list() }, null, 2),
    ));

    const listResult = await service.tryRunGoalList({
      ...baseInput,
      userPrompt: "mostre meus objetivos",
    });
    results.push(assert(
      "goal_list_route_reads_saved_goals",
      listResult?.reply.includes("Objetivos ativos:") === true
        && listResult.reply.toLowerCase().includes("fechar 2 clientes saas"),
      listResult?.reply,
    ));

    const progressResult = await service.tryRunGoalProgressUpdate({
      ...baseInput,
      userPrompt: "atualize meu objetivo fechar 2 clientes para 40%",
    });
    results.push(assert(
      "goal_progress_route_updates_saved_goal",
      progressResult?.reply.includes("40%") === true
        && goalStore.list()[0]?.progress === 0.4,
      JSON.stringify({ reply: progressResult?.reply, goals: goalStore.list() }, null, 2),
    ));

    const deleteResult = await service.tryRunGoalDelete({
      ...baseInput,
      userPrompt: "remova meu objetivo fechar 2 clientes",
    });
    results.push(assert(
      "goal_delete_route_removes_goal",
      deleteResult?.reply.includes("Objetivo removido.") === true
        && goalStore.list().length === 0,
      JSON.stringify({ reply: deleteResult?.reply, goals: goalStore.list() }, null, 2),
    ));

    const morningBriefReply = buildMorningBriefReply({
      timezone: "America/Sao_Paulo",
      events: [],
      taskBuckets: { today: [], overdue: [], stale: [], actionableCount: 0 },
      emails: [],
      approvals: [],
      workflows: [],
      focus: [],
      memoryEntities: { total: 0, byKind: {}, recent: [] },
      motivation: { text: "Hoje é dia de manter clareza." },
      founderSnapshot: { sections: [] },
      personalFocus: [],
      overloadLevel: "leve",
      mobilityAlerts: [],
      operationalSignals: [],
      conflictSummary: { overlaps: 0, duplicates: 0, naming: 0 },
      activeGoals: [
        {
          id: "goal-1",
          title: "Fechar 2 clientes SaaS",
          domain: "revenue",
          deadline: "2026-05-31",
          progress: 0.4,
        },
      ],
      goalSummary: "Objetivos: (1) Fechar 2 clientes SaaS — receita, prazo: 2026-05-31, 40%",
      nextAction: "Reservar bloco comercial hoje.",
    });
    results.push(assert(
      "morning_brief_mentions_active_goal",
      morningBriefReply.includes("*Objetivos ativos*")
        && morningBriefReply.includes("Fechar 2 clientes SaaS")
        && morningBriefReply.includes("*Próxima ação*"),
      morningBriefReply,
    ));

    let capturedPrompt = "";
    const workflowStore = {
      createPlan: (input: any) => ({
        id: 1,
        ...input,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        steps: (input.steps ?? []).map((step: any, index: number) => ({
          ...step,
          planId: 1,
          stepNumber: index + 1,
        })),
      }),
    };
    const planBuilder = new WorkflowPlanBuilderService(
      {
        chat: async (input: any) => {
          const userMessage = input.messages.find((message: any) => message.role === "user");
          capturedPrompt = String(userMessage?.content ?? "");
          return {
            model: "fake",
            done: true,
            message: {
              role: "assistant",
              content: JSON.stringify({
                title: "Plano comercial",
                executiveSummary: "Plano alinhado a fechar clientes.",
                primaryDomain: "analista_negocios_growth",
                secondaryDomains: [],
                deliverables: ["pipeline", "roteiro"],
                nextAction: "Abrir frente comercial.",
                steps: [
                  {
                    title: "Mapear pipeline",
                    ownerDomain: "analista_negocios_growth",
                    taskType: "planning",
                    objective: "Organizar pipeline",
                    deliverable: "pipeline claro",
                    successCriteria: "pipeline visível",
                    dependsOn: [],
                    suggestedTools: [],
                  },
                ],
              }),
            },
          };
        },
      } as any,
      workflowStore as any,
      logger,
      () => "Objetivos: (1) Fechar 2 clientes SaaS — receita, prazo: 2026-05-31, 40%",
    );
    await planBuilder.createPlanFromPrompt(
      "organize um workflow comercial para esta semana",
      {
        route: {
          primaryDomain: "analista_negocios_growth",
          secondaryDomains: [],
          confidence: 1,
          actionMode: "plan",
          reasons: [],
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "observe_only",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: false,
            canDraftExternalReplies: false,
            canSendExternalReplies: false,
            canWriteWorkspace: false,
            canPersistMemory: false,
            canRunProjectTools: false,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      } as any,
    );
    results.push(assert(
      "workflow_plan_builder_injects_goal_summary",
      capturedPrompt.includes("Objetivos ativos do usuário")
        && capturedPrompt.includes("Fechar 2 clientes SaaS"),
      capturedPrompt,
    ));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    for (const item of failed) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
    }
    process.exit(1);
  }

  console.log(`\nGoal runtime evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
