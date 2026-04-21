import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
import type { UserPreferences } from "../src/types/user-preferences.js";
import type { PersonalOperationalProfile } from "../src/types/personal-operational-memory.js";
import type { OperationalState } from "../src/types/operational-state.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
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

function buildOrchestration(): any {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.9,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: true,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
}

function buildProfile(): PersonalOperationalProfile {
  return {
    displayName: "Paulo",
    primaryRole: "Operador",
    routineSummary: ["Rua", "Abordagem"],
    timezone: "America/Sao_Paulo",
    preferredChannels: ["telegram"],
    preferredAlertChannel: "telegram",
    priorityAreas: ["agenda", "tasks"],
    defaultAgendaScope: "both",
    workCalendarAliases: ["abordagem"],
    responseStyle: "direto",
    briefingPreference: "executivo",
    detailLevel: "equilibrado",
    tonePreference: "objetivo",
    defaultOperationalMode: "normal",
    mobilityPreferences: ["carro"],
    autonomyPreferences: ["confirmar antes de enviar"],
    savedFocus: ["evitar conflito de agenda"],
    routineAnchors: ["briefing da manhã"],
    operationalRules: ["resolver conflitos antes de aceitar novas demandas"],
    attire: {
      umbrellaProbabilityThreshold: 40,
      coldTemperatureC: 14,
      lightClothingTemperatureC: 24,
      carryItems: ["carregador"],
    },
    fieldModeHours: 6,
  };
}

function buildOperationalState(): OperationalState {
  return {
    mode: "normal",
    focus: ["agenda da abordagem"],
    weeklyPriorities: ["fechar pendências"],
    pendingAlerts: ["reunião institucional"],
    criticalTasks: ["entregar relatório"],
    upcomingCommitments: [
      {
        summary: "Reunião no CAPS Girassol",
        start: "2026-04-20T12:00:00.000Z",
      },
    ],
    primaryRisk: "conflito de agenda",
    briefing: {
      nextAction: "revisar agenda",
      overloadLevel: "moderado",
    },
    recentContext: ["institucional monitorado"],
    signals: [],
    activeChannel: "telegram",
    preferredAlertChannel: "telegram",
    pendingApprovals: 1,
    updatedAt: "2026-04-20T09:00:00.000Z",
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  let currentPreferences: UserPreferences = {
    responseStyle: "executive",
    responseLength: "medium",
    proactiveNextStep: false,
    autoSourceFallback: false,
    preferredAgentName: "Atlas",
  };
  const toolCalls: Array<{ toolName: string; rawArguments: unknown }> = [];
  const learnedPreferenceQueries: string[] = [];

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).googleWorkspace = {
    getStatus: () => ({
      ready: true,
      message: "ok",
    }),
    getDailyBrief: async () => ({
      timezone: "America/Sao_Paulo",
      windowStart: "2026-04-20T08:00:00.000Z",
      windowEnd: "2026-04-21T08:00:00.000Z",
      events: [
        {
          id: "evt-1",
          status: "confirmed",
          summary: "Reunião no CAPS Girassol",
          location: "Porto Alegre",
          start: "2026-04-20T12:00:00.000Z",
          end: "2026-04-20T13:00:00.000Z",
        },
      ],
      tasks: [
        {
          id: "task-1",
          taskListId: "primary",
          taskListTitle: "Pessoal",
          title: "Entregar relatório",
          status: "needsAction",
          due: "2026-04-20T18:00:00.000Z",
          updated: "2026-04-20T09:00:00.000Z",
        },
      ],
    }),
  };
  (core as any).memory = {
    getDailyFocus: () => [
      {
        item: { title: "Agenda da abordagem" },
        whyNow: "há conflito potencial",
        nextAction: "revisar blocos da tarde",
      },
    ],
  };
  (core as any).personalOs = {
    getExecutiveMorningBrief: async () => ({
      timezone: "America/Sao_Paulo",
      events: [
        {
          account: "abordagem",
          summary: "Reunião no CAPS Girassol",
          start: "2026-04-20T12:00:00.000Z",
          end: "2026-04-20T13:00:00.000Z",
          location: "Porto Alegre",
          owner: "paulo",
          context: "externo",
          hasConflict: false,
          prepHint: "levar anotações",
        },
      ],
      taskBuckets: {
        today: [],
        overdue: [
          {
            id: "task-2",
            taskListId: "primary",
            taskListTitle: "Pessoal",
            title: "Responder institucional",
            status: "needsAction",
            due: "2026-04-20T15:00:00.000Z",
            updated: "2026-04-20T08:00:00.000Z",
            account: "primary",
          },
        ],
        stale: [],
        actionableCount: 1,
      },
      emails: [],
      approvals: [],
      workflows: [],
      focus: [],
      memoryEntities: {
        total: 0,
        byKind: {},
        recent: [],
      },
      motivation: {
        text: "Segue o dia.",
      },
      founderSnapshot: {
        executiveLine: "Sem founder ops hoje.",
        sections: [],
        trackedMetrics: [],
      },
      nextAction: "revisar agenda",
      personalFocus: ["evitar conflito"],
      overloadLevel: "moderado",
      mobilityAlerts: [],
      operationalSignals: [],
      conflictSummary: {
        overlaps: 0,
        duplicates: 0,
        naming: 0,
      },
    }),
  };
  (core as any).preferences = {
    get: () => currentPreferences,
    update: (input: Partial<UserPreferences>) => {
      currentPreferences = {
        ...currentPreferences,
        ...input,
      };
      return currentPreferences;
    },
  };
  (core as any).personalMemory = {
    getProfile: () => buildProfile(),
    getOperationalState: () => buildOperationalState(),
    findLearnedPreferences: (query: string) => {
      learnedPreferenceQueries.push(query);
      return [
        {
          id: 7,
          type: "response_style",
          key: "short_direct_replies",
          description: "Responder curto e direto",
          value: "responder curto",
          source: "correction",
          confidence: 0.8,
          confirmations: 3,
          active: true,
          createdAt: "2026-04-19T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z",
          lastObservedAt: "2026-04-20T00:00:00.000Z",
        },
      ];
    },
    findItems: () => [
      {
        id: 3,
        kind: "preference",
        title: "Respostas curtas em plantão",
        content: "Em dias de plantão quero respostas curtas.",
        tags: [],
        createdAt: "2026-04-19T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
      },
    ],
  };
  (core as any).executeToolDirect = async (toolName: string, rawArguments: unknown) => {
    toolCalls.push({ toolName, rawArguments });
    if (toolName === "get_personal_operational_profile") {
      return {
        requestId: "req-profile-show",
        content: '{"profile":"ok"}',
        rawResult: {
          profile: buildProfile(),
        },
      };
    }
    if (toolName === "update_personal_operational_profile") {
      return {
        requestId: "req-profile-update",
        content: '{"profile":"updated"}',
        rawResult: {
          profile: {
            ...buildProfile(),
            responseStyle: "direto e objetivo",
          },
        },
      };
    }
    if (toolName === "save_personal_memory_item") {
      return {
        requestId: "req-memory-save",
        content: '{"item":"saved"}',
        rawResult: {
          item: {
            id: 44,
            kind: "preference",
            title: "Em dias de plantão quero respostas curtas",
            content: "em dias de plantão quero respostas curtas",
            tags: [],
            createdAt: "2026-04-20T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
          },
        },
      };
    }
    if (toolName === "deactivate_learned_preference") {
      return {
        requestId: "req-pref-delete",
        content: '{"item":"deactivated"}',
        rawResult: {
          item: {
            id: 7,
            type: "response_style",
            key: "short_direct_replies",
            description: "Responder curto e direto",
            value: "responder curto",
            source: "correction",
            confidence: 0.8,
            confirmations: 3,
            active: false,
            createdAt: "2026-04-19T00:00:00.000Z",
            updatedAt: "2026-04-20T00:00:00.000Z",
            lastObservedAt: "2026-04-20T00:00:00.000Z",
          },
        },
      };
    }
    return {
      requestId: "req-generic",
      content: "{}",
      rawResult: {},
    };
  };

  return {
    core,
    toolCalls,
    learnedPreferenceQueries,
    getPreferences: () => currentPreferences,
  };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const { core, toolCalls, learnedPreferenceQueries, getPreferences } = buildCoreStub();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectOperationalBrief(
      "como está meu dia?",
      "req-phase14-operational-brief",
      logger,
      buildOrchestration(),
    );

    results.push(assert(
      "agent_core_operational_brief_wrapper_uses_operational_context_service",
      Boolean(
        result?.reply?.includes("Hoje teu dia tem 1 compromisso") &&
        result.reply.includes("Agenda mais próxima:") &&
        result.toolExecutions[0]?.toolName === "daily_operational_brief",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectMorningBrief(
      "briefing da manhã",
      "req-phase14-morning-brief",
      logger,
      buildOrchestration(),
    );

    results.push(assert(
      "agent_core_morning_brief_wrapper_uses_operational_context_service",
      Boolean(
        result?.reply?.includes("Hoje teu dia") &&
        result.toolExecutions[0]?.toolName === "morning_brief",
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectPersonalOperationalProfileShow(
      "mostre meu perfil",
      "req-phase14-profile-show",
      buildOrchestration(),
      getPreferences(),
    );

    results.push(assert(
      "agent_core_profile_show_wrapper_uses_operational_context_service",
      Boolean(
        result?.reply?.includes("Perfil operacional base:") &&
        result.reply.includes("- Nome: Paulo") &&
        toolCalls.some((call) => call.toolName === "get_personal_operational_profile"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectPersonalOperationalProfileUpdate(
      "defina meu estilo de resposta como direto e objetivo",
      "req-phase14-profile-update",
      buildOrchestration(),
      getPreferences(),
    );

    const lastUpdateCall = [...toolCalls].reverse().find((call) => call.toolName === "update_personal_operational_profile");
    results.push(assert(
      "agent_core_profile_update_wrapper_uses_operational_context_service_and_updates_preferences",
      Boolean(
        result?.reply?.includes("Perfil operacional atualizado.") &&
        (lastUpdateCall?.rawArguments as Record<string, unknown> | undefined)?.responseStyle === "direto e objetivo" &&
        getPreferences().responseStyle === "executive",
      ),
      JSON.stringify({
        rawArguments: lastUpdateCall?.rawArguments,
        preferences: getPreferences(),
      }),
    ));
  }

  {
    const result = await (core as any).tryRunDirectPersonalMemorySave(
      "salve na minha memória pessoal que em dias de plantão quero respostas curtas",
      "req-phase14-memory-save",
      buildOrchestration(),
      getPreferences(),
    );

    const lastSaveCall = [...toolCalls].reverse().find((call) => call.toolName === "save_personal_memory_item");
    results.push(assert(
      "agent_core_personal_memory_save_wrapper_uses_operational_context_service",
      Boolean(
        result?.reply?.includes("Memória pessoal salva.") &&
        result.reply.includes("#44") &&
        (lastSaveCall?.rawArguments as Record<string, unknown> | undefined)?.kind === "routine",
      ),
      JSON.stringify(lastSaveCall?.rawArguments),
    ));
  }

  {
    const result = await (core as any).tryRunDirectLearnedPreferencesDelete(
      "desative a preferência aprendida resposta curta",
      "req-phase14-pref-delete",
      buildOrchestration(),
      getPreferences(),
    );

    const lastDeactivateCall = [...toolCalls].reverse().find((call) => call.toolName === "deactivate_learned_preference");
    results.push(assert(
      "agent_core_learned_preference_delete_wrapper_uses_operational_context_service",
      Boolean(
        result?.reply?.includes("Preferência aprendida desativada.") &&
        learnedPreferenceQueries.includes("resposta curta") &&
        (lastDeactivateCall?.rawArguments as Record<string, unknown> | undefined)?.id === 7,
      ),
      JSON.stringify({
        learnedPreferenceQueries,
        rawArguments: lastDeactivateCall?.rawArguments,
      }),
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase14 failed", error);
  process.exitCode = 1;
});
