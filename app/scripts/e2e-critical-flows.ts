import process from "node:process";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { AgentCore } from "../src/core/agent-core.js";
import { IntentRouter } from "../src/core/intent-router.js";
import { CapabilityPlanner } from "../src/core/capability-planner.js";
import { ToolPluginRegistry } from "../src/core/plugin-registry.js";
import { CapabilityRegistry } from "../src/core/capability-registry.js";
import { createBuiltInCapabilities } from "../src/core/capabilities/index.js";
import { createDeclaredCapabilityCatalog } from "../src/core/capabilities/catalog.js";
import type { Logger } from "../src/types/logger.js";
import type { ActiveGoal } from "../src/core/goal-store.js";
import type {
  CalendarEventSummary,
  CalendarListSummary,
  ContactSummary,
  TaskSummary,
} from "../src/integrations/google/google-workspace.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  child(): Logger {
    return this;
  }
}

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function makeWorkspace(input: {
  ready?: boolean;
  writeReady?: boolean;
  tasks?: TaskSummary[];
  contacts?: ContactSummary[];
  calendars?: CalendarListSummary[];
  configuredCalendars?: CalendarListSummary[];
  events?: CalendarEventSummary[];
  calendarAliases?: Record<string, string>;
}) {
  const tasks = input.tasks ?? [];
  const contacts = input.contacts ?? [];
  const calendars = input.calendars ?? [];
  const configuredCalendars = input.configuredCalendars ?? [];
  const events = input.events ?? [];
  const calendarAliases = input.calendarAliases ?? { abordagem: "abordagem" };

  return {
    getStatus: () => ({
      ready: input.ready !== false,
      writeReady: input.writeReady !== false,
      message: input.ready === false ? "indisponível" : "ready",
    }),
    getCalendarAliases: () => calendarAliases,
    resolveCalendarId: (calendarIdOrAlias?: string) => {
      if (!calendarIdOrAlias?.trim()) {
        return Object.values(calendarAliases)[0] ?? "abordagem";
      }
      return calendarAliases[calendarIdOrAlias] ?? calendarIdOrAlias;
    },
    listTasks: async () => tasks,
    listEventsInWindow: async (request: { query?: string }) => {
      if (!request.query?.trim()) {
        return events;
      }
      const query = request.query.toLowerCase();
      return events.filter((event) => {
        const haystack = [event.summary, event.description, event.location]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
    },
    searchContacts: async () => contacts,
    listCalendars: async () => calendars,
    listConfiguredCalendars: () => configuredCalendars,
  };
}

class InMemoryGoalStore {
  private readonly items: ActiveGoal[] = [];

  list(): ActiveGoal[] {
    return [...this.items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(id: string): ActiveGoal | undefined {
    return this.items.find((item) => item.id === id);
  }

  upsert(goal: Omit<ActiveGoal, "id" | "createdAt" | "updatedAt"> & { id?: string }): ActiveGoal {
    const now = new Date().toISOString();
    const existing = goal.id ? this.get(goal.id) : undefined;
    const record: ActiveGoal = {
      id: existing?.id ?? goal.id ?? `goal-${this.items.length + 1}`,
      title: goal.title.trim(),
      ...(goal.description ? { description: goal.description.trim() } : {}),
      ...(goal.metric ? { metric: goal.metric.trim() } : {}),
      ...(goal.deadline ? { deadline: goal.deadline.trim() } : {}),
      ...(typeof goal.progress === "number" ? { progress: Math.max(0, Math.min(1, goal.progress)) } : {}),
      domain: goal.domain,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const index = this.items.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      this.items[index] = record;
    } else {
      this.items.push(record);
    }
    return record;
  }

  updateProgress(id: string, progress: number): ActiveGoal | undefined {
    const existing = this.get(id);
    if (!existing) {
      return undefined;
    }
    return this.upsert({
      id: existing.id,
      title: existing.title,
      description: existing.description,
      metric: existing.metric,
      deadline: existing.deadline,
      progress,
      domain: existing.domain,
    });
  }

  remove(id: string): boolean {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) {
      return false;
    }
    this.items.splice(index, 1);
    return true;
  }

  summarize(): string {
    const goals = this.list();
    if (goals.length === 0) {
      return "Objetivos: nenhum ativo.";
    }
    return `Objetivos: ${goals.map((goal, index) => {
      const parts = [`(${index + 1}) ${goal.title}`, goal.domain];
      if (goal.deadline) parts.push(`prazo: ${goal.deadline}`);
      if (typeof goal.progress === "number") parts.push(`${Math.round(goal.progress * 100)}%`);
      return parts.join(" — ");
    }).join("; ")}`;
  }
}

function buildCapabilityPlanner(input: {
  logger: Logger;
  goalStore: InMemoryGoalStore;
  googleWorkspaces: any;
  googleMaps: any;
}) {
  const toolRegistry = new ToolPluginRegistry([], input.logger);
  const capabilityRegistry = new CapabilityRegistry(
    toolRegistry,
    createBuiltInCapabilities(),
    createDeclaredCapabilityCatalog(),
    input.logger,
  );

  const config = {
    llm: {
      provider: "ollama",
    },
    whatsapp: {
      enabled: true,
      sidecarEnabled: true,
    },
  } as any;

  const planner = new CapabilityPlanner(
    config,
    capabilityRegistry,
    input.googleWorkspaces,
    input.googleMaps,
    {} as any,
    input.logger,
    () => {
      const activeGoals = input.goalStore.list();
      return {
        goalSummary: activeGoals.length > 0 ? input.goalStore.summarize() : undefined,
        activeGoals: activeGoals.slice(0, 4).map((goal) => ({
          title: goal.title,
          description: goal.description,
          domain: goal.domain,
          deadline: goal.deadline,
          progress: goal.progress,
        })),
      };
    },
  );

  return { planner, capabilityRegistry };
}

function buildMorningBrief(goalStore: InMemoryGoalStore) {
  const goals = goalStore.list();
  return {
    timezone: "America/Sao_Paulo",
    events: [
      {
        account: "abordagem",
        calendarId: "abordagem",
        owner: "paulo",
        summary: "Reunião CAPS",
        start: "2026-04-21T09:00:00-03:00",
        end: "2026-04-21T10:00:00-03:00",
        location: "CAPS Restinga",
        hasConflict: false,
        prepHint: "confirmar endereço e material",
      },
    ],
    taskBuckets: {
      overdue: [],
      today: [
        {
          title: "Fechar follow-up comercial",
          due: "2026-04-21T12:00:00-03:00",
          status: "needsAction",
        },
      ],
      upcoming: [],
      actionableCount: 1,
    },
    emails: [],
    approvals: [],
    workflows: [],
    focus: [],
    memoryEntities: {
      people: 0,
      places: 0,
      projects: 0,
      organizations: 0,
    },
    motivation: {
      text: "Foco primeiro, dispersão depois.",
    },
    founderSnapshot: {
      executiveLine: "Altiva aguardando integração de dados no Founder Brief.",
      trackedMetrics: ["mrr", "tickets_open"],
      sections: [
        {
          key: "altiva",
          title: "Altiva",
          status: "prepared",
          summary: "Métricas prontas para entrar no resumo executivo.",
          requiredInputs: ["daily summary"],
        },
      ],
    },
    nextAction: "Confirmar a agenda da manhã antes de abrir novas frentes.",
    personalFocus: ["Fechar 2 clientes SaaS"],
    overloadLevel: "moderado",
    mobilityAlerts: ["Dia estável para deslocamento na Restinga."],
    operationalSignals: [],
    activeGoals: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      domain: goal.domain,
      deadline: goal.deadline,
      progress: goal.progress,
    })),
    goalSummary: goalStore.summarize(),
    conflictSummary: {
      overlaps: 0,
      duplicates: 0,
      naming: 0,
    },
    dayRecommendation: "Proteger a manhã para fechar o que empurra receita.",
    weather: {
      locationLabel: "Porto Alegre",
      current: {
        description: "tempo firme",
        temperatureC: 22,
      },
      days: [
        {
          label: "Hoje",
          description: "sem chuva forte",
          minTempC: 17,
          maxTempC: 27,
          precipitationProbabilityMax: 10,
          tip: "Vale sair com casaco leve.",
        },
      ],
    },
  } as any;
}

function buildCoreHarness(input?: {
  mapsReady?: boolean;
  goals?: Array<{
    title: string;
    description?: string;
    domain: "revenue" | "product" | "personal" | "content" | "ops" | "other";
    deadline?: string;
    progress?: number;
  }>;
}) {
  const logger = new SilentLogger();
  const tempDir = mkdtempSync(path.join(tmpdir(), "atlas-e2e-critical-"));
  const goalStore = new InMemoryGoalStore();
  for (const goal of input?.goals ?? []) {
    goalStore.upsert(goal);
  }

  const searchCalls: Array<{ query: string; mode?: string }> = [];
  const gapRecords: Array<{ id: number; description: string; inferredObjective: string; missingCapabilities: string[] }> = [];

  const workspace = makeWorkspace({
    ready: true,
    writeReady: true,
    events: [
      {
        id: "work-event-1",
        status: "confirmed",
        summary: "Paulo - Reunião CAPS",
        start: "2026-04-22T09:00:00-03:00",
        end: "2026-04-22T10:00:00-03:00",
        location: "CAPS Restinga",
      },
      {
        id: "work-event-2",
        status: "confirmed",
        summary: "Paulo e Juliana - CREAS",
        start: "2026-04-22T13:30:00-03:00",
        end: "2026-04-22T14:30:00-03:00",
        location: "CREAS Restinga",
      },
    ],
    calendars: [
      {
        id: "abordagem",
        summary: "Agenda da abordagem",
        primary: false,
        selected: true,
        accessRole: "owner",
      },
    ],
    configuredCalendars: [
      {
        id: "abordagem",
        summary: "Agenda da abordagem",
        primary: false,
        selected: true,
        accessRole: "configured",
      },
    ],
    calendarAliases: { abordagem: "abordagem" },
  });

  const googleWorkspaces = {
    getAliases: () => ["abordagem"],
    getWorkspace: () => workspace,
  };

  const googleMaps = {
    getStatus: () => ({
      enabled: input?.mapsReady === true,
      configured: input?.mapsReady === true,
      ready: input?.mapsReady === true,
      message: input?.mapsReady === true ? "Google Maps ready" : "Google Maps unavailable",
      defaultRegionCode: "BR",
      defaultLanguageCode: "pt-BR",
    }),
    lookupPlace: async (query: string) => {
      if (/caps girassol/i.test(query)) {
        return {
          query,
          name: "CAPS Girassol",
          formattedAddress: "Av. João Antônio da Silveira, 440 - Restinga, Porto Alegre - RS",
          shortFormattedAddress: "Av. João Antônio da Silveira, 440 - Restinga",
          mapsUrl: "https://maps.google.com/?q=CAPS+Girassol+Restinga",
        };
      }
      return null;
    },
    computeRoute: async () => ({
      originQuery: "Porto Alegre",
      destinationQuery: "Torres",
      origin: {
        formattedAddress: "Porto Alegre - RS",
      },
      destination: {
        formattedAddress: "Torres - RS",
      },
      distanceMeters: 190000,
      durationSeconds: 10800,
      hasTolls: true,
      tolls: [{ currencyCode: "BRL", amount: 23.5 }],
      tollPriceKnown: true,
      localizedDistanceText: "190 km",
      localizedDurationText: "3 h",
      mapsUrl: "https://maps.google.com/?saddr=Porto+Alegre&daddr=Torres",
      warnings: [],
    }),
    searchPlaces: async () => ({
      query: "restaurantes na restinga",
      results: [],
    }),
  };

  const { planner, capabilityRegistry } = buildCapabilityPlanner({
    logger,
    goalStore,
    googleWorkspaces,
    googleMaps,
  });

  const core = Object.create(AgentCore.prototype) as AgentCore;
  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
    llm: {
      provider: "ollama",
    },
    whatsapp: {
      enabled: true,
      sidecarEnabled: true,
    },
    externalReasoning: {
      mode: "off",
    },
    media: {
      pexelsMaxScenesPerRequest: 6,
    },
    runtime: {
      maxToolIterations: 3,
    },
  };
  (core as any).intentRouter = new IntentRouter();
  (core as any).preferences = {
    get: () => ({
      responseStyle: "executive",
      responseLength: "medium",
      proactiveNextStep: true,
      autoSourceFallback: false,
      preferredAgentName: "Atlas",
    }),
    update: (input: Record<string, unknown>) => ({
      responseStyle: "executive",
      responseLength: "medium",
      proactiveNextStep: true,
      autoSourceFallback: false,
      preferredAgentName: "Atlas",
      ...input,
    }),
  };
  (core as any).goalStore = goalStore;
  (core as any).memory = {
    getDailyFocus: () => [
      {
        item: { title: "Fechar 2 clientes SaaS" },
        whyNow: "impacta receita",
        nextAction: "Mandar os follow-ups pendentes",
      },
    ],
    getContextSummary: () => undefined,
  };
  (core as any).personalMemory = {
    getProfile: () => ({
      displayName: "Paulo",
      primaryRole: "operador",
      routineSummary: [],
      timezone: "America/Sao_Paulo",
      preferredChannels: ["telegram"],
      priorityAreas: [],
      defaultAgendaScope: "both",
      workCalendarAliases: ["abordagem"],
      responseStyle: "direto",
      briefingPreference: "executivo",
      detailLevel: "equilibrado",
      tonePreference: "objetivo",
      defaultOperationalMode: "normal",
      mobilityPreferences: [],
      autonomyPreferences: [],
      savedFocus: ["Fechar 2 clientes SaaS"],
      routineAnchors: [],
      operationalRules: [],
      attire: {
        umbrellaProbabilityThreshold: 40,
        coldTemperatureC: 14,
        lightClothingTemperatureC: 24,
        carryItems: ["carregador"],
      },
      fieldModeHours: 6,
    }),
    getOperationalState: () => ({
      mode: "normal",
      focus: ["receita"],
      weeklyPriorities: ["Fechar 2 clientes SaaS"],
      pendingAlerts: [],
      criticalTasks: [],
      upcomingCommitments: [],
      riskOfDay: undefined,
      focusHint: undefined,
      pendingApprovals: [],
      recentContext: [],
      briefingState: undefined,
      preferredAlertChannel: "telegram",
      updatedAt: new Date().toISOString(),
    }),
    findLearnedPreferences: () => [],
    findItems: () => [],
    listProductGaps: () => gapRecords,
    recordProductGapObservation: (payload: {
      description: string;
      inferredObjective: string;
      missingCapabilities: string[];
      signature: string;
    }) => {
      const record = {
        id: gapRecords.length + 1,
        description: payload.description,
        inferredObjective: payload.inferredObjective,
        missingCapabilities: payload.missingCapabilities,
        signature: payload.signature,
        missingRequirementKinds: [],
        contextSummary: undefined,
        relatedSkill: undefined,
        impact: "medium",
        recurrence: 1,
        status: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastObservedAt: new Date().toISOString(),
      };
      gapRecords.push(record as any);
      return record as any;
    },
  };
  (core as any).googleWorkspace = {
    getStatus: () => ({ ready: true, message: "ready" }),
    getDailyBrief: async () => ({
      dateLabel: "21/04",
      priorities: [],
      schedule: [],
      alerts: [],
      attentionSummary: "Sem alerta extra.",
    }),
  };
  (core as any).googleWorkspaces = googleWorkspaces;
  (core as any).googleMaps = googleMaps;
  (core as any).emailAccounts = {
    getAliases: () => [],
    getReader: () => ({
      getStatus: async () => ({ ready: false, message: "disabled" }),
      scanRecentMessages: async () => [],
    }),
  };
  (core as any).responseOs = {
    buildTaskReviewReply: (payload: { scopeLabel: string; items: unknown[] }) => `${payload.scopeLabel} :: ${payload.items.length}`,
    buildScheduleLookupReply: (payload: { targetLabel: string; events: unknown[]; emailFallbackCount: number }) => `${payload.targetLabel} :: ${payload.events.length} :: ${payload.emailFallbackCount}`,
    buildCalendarConflictReviewReply: (payload: { scopeLabel: string; totalEvents: number; overlapCount: number; duplicateCount: number; namingCount: number }) => `${payload.scopeLabel} :: ${payload.totalEvents} :: ${payload.overlapCount} :: ${payload.duplicateCount} :: ${payload.namingCount}`,
  };
  (core as any).personalOs = {
    getExecutiveMorningBrief: async () => buildMorningBrief(goalStore),
  };
  (core as any).capabilityRegistry = capabilityRegistry;
  (core as any).capabilityPlanner = planner;
  (core as any).externalReasoning = {};
  (core as any).createWebResearchService = () => ({
    search: async (payload: { query: string; mode?: string }) => {
      searchCalls.push({ query: payload.query, mode: payload.mode });
      return [
        {
          title: "Passagens para Recife em dezembro",
          url: "https://example.com/passagens-recife",
          sourceHost: "example.com",
          snippet: `Resultados para ${payload.query}`,
          excerpt: `Resultados para ${payload.query}`,
          publishedAt: "2026-04-21",
          score: 95,
        },
      ];
    },
    fetchPageExcerpt: async () => "Resumo executivo da pesquisa.",
  });

  const googleWorkspaceDirectService = (core as any).createGoogleWorkspaceDirectService();
  const externalIntelligenceDirectService = (core as any).createExternalIntelligenceDirectService();
  const capabilityActionService = (core as any).createCapabilityActionService();
  const operationalContextDirectService = (core as any).createOperationalContextDirectService();

  (core as any).getGoogleWorkspaceDirectService = () => googleWorkspaceDirectService;
  (core as any).getExternalIntelligenceDirectService = () => externalIntelligenceDirectService;
  (core as any).getCapabilityActionService = () => capabilityActionService;
  (core as any).getOperationalContextDirectService = () => operationalContextDirectService;
  (core as any).tryRunPreLocalExternalReasoning = async () => null;
  (core as any).tryRunDirectRoutes = async (routeInput: {
    activeUserPrompt: string;
    requestId: string;
    requestLogger: Logger;
    orchestration: any;
    preferences: any;
    options?: any;
  }) => {
    const prompt = routeInput.activeUserPrompt;
    return await (core as any).tryRunDirectMorningBrief(
      prompt,
      routeInput.requestId,
      routeInput.requestLogger,
      routeInput.orchestration,
    )
      ?? await (core as any).tryRunDirectGoogleEventMove(
        prompt,
        routeInput.requestId,
        routeInput.requestLogger,
        routeInput.orchestration,
      )
      ?? await (core as any).tryRunDirectGoogleEventDelete(
        prompt,
        routeInput.requestId,
        routeInput.requestLogger,
        routeInput.orchestration,
      )
      ?? await (core as any).tryRunDirectGoogleEventDraft(
        prompt,
        routeInput.requestId,
        routeInput.requestLogger,
        routeInput.orchestration,
      )
      ?? await (core as any).tryRunDirectCapabilityAwarePlanning(
        prompt,
        routeInput.requestId,
        routeInput.requestLogger,
        routeInput.orchestration,
        routeInput.preferences,
        routeInput.options,
      )
      ?? null;
  };
  (core as any).contextAssembler = {
    assemble: () => {
      throw new Error("Unexpected fallback to generic synthesis path");
    },
  };
  (core as any).responseSynthesizer = {
    synthesize: async () => {
      throw new Error("Unexpected synthesize call in deterministic E2E");
    },
  };
  (core as any).turnPlanner = {
    plan: async () => {
      throw new Error("Unexpected turn planner call in deterministic E2E");
    },
  };

  return {
    core,
    goalStore,
    searchCalls,
    gapRecords,
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];

  {
    const harness = buildCoreHarness({
      mapsReady: true,
      goals: [
        {
          title: "Fechar 2 clientes SaaS",
          domain: "revenue",
          deadline: "2026-05-31",
          progress: 0.3,
        },
      ],
    });
    try {
      const result = await harness.core.runUserPrompt("briefing da manhã");
      results.push(assert(
        "e2e_morning_brief_uses_direct_route_and_goal_context",
        result.reply.includes("Bom dia")
          && result.reply.includes("*Objetivos ativos*")
          && result.reply.includes("Fechar 2 clientes SaaS"),
        result.reply,
      ));
    } finally {
      harness.cleanup();
    }
  }

  {
    const harness = buildCoreHarness({ mapsReady: true });
    try {
      const result = await harness.core.runUserPrompt(
        "Amanhã terei uma reunião no Caps Girassol, às 9h da manhã.",
      );
      results.push(assert(
        "e2e_event_create_natural_prompt_returns_google_draft",
        result.reply.includes("Rascunho de evento Google pronto.")
          && result.reply.includes("- Título: Reunião no CAPS Girassol")
          && result.reply.includes("- Conta: abordagem"),
        result.reply,
      ));
    } finally {
      harness.cleanup();
    }
  }

  {
    const harness = buildCoreHarness({ mapsReady: true });
    try {
      const result = await harness.core.runUserPrompt(
        "altere meu evento reunião caps amanhã para às 11h",
      );
      results.push(assert(
        "e2e_event_move_natural_prompt_returns_update_draft",
        result.reply.includes("Rascunho de atualização de evento Google pronto.")
          && result.reply.includes("- Atual: Paulo - Reunião CAPS")
          && result.reply.includes("- Conta: abordagem"),
        result.reply,
      ));
    } finally {
      harness.cleanup();
    }
  }

  {
    const harness = buildCoreHarness({ mapsReady: true });
    try {
      const result = await harness.core.runUserPrompt(
        "tire da minha agenda a reunião caps amanhã",
      );
      results.push(assert(
        "e2e_event_delete_natural_prompt_returns_delete_draft",
        result.reply.includes("Rascunho de exclusão de evento Google pronto.")
          && result.reply.includes("- Atual: Paulo - Reunião CAPS")
          && result.reply.includes("- Conta: abordagem"),
        result.reply,
      ));
    } finally {
      harness.cleanup();
    }
  }

  {
    const harness = buildCoreHarness({ mapsReady: false });
    try {
      const result = await harness.core.runUserPrompt(
        "quanto vou gastar de Porto Alegre até Torres com meu JAC T40?",
      );
      results.push(assert(
        "e2e_travel_gap_returns_honest_capability_reply_and_logs_gap",
        result.reply.includes("Hoje eu ainda não consigo fechar isso sozinho no Atlas")
          && result.reply.includes("maps.route")
          && result.toolExecutions[0]?.toolName === "capability_planner"
          && harness.gapRecords.length === 1,
        JSON.stringify({ reply: result.reply, gaps: harness.gapRecords }, null, 2),
      ));
    } finally {
      harness.cleanup();
    }
  }

  {
    const harness = buildCoreHarness({
      mapsReady: true,
      goals: [
        {
          title: "Planejar palestra em Recife em dezembro",
          description: "Comparar passagens e hospedagem para o evento.",
          domain: "ops",
          deadline: "2026-12-01",
          progress: 0.2,
        },
      ],
    });
    try {
      const result = await harness.core.runUserPrompt(
        "compare preços de passagens aéreas de Porto Alegre para Recife em dezembro",
      );
      const searchQuery = harness.searchCalls[0]?.query ?? "";
      results.push(assert(
        "e2e_goal_aware_flight_search_shapes_query_and_executes_web_search",
        result.toolExecutions[0]?.toolName === "web_search"
          && result.reply.includes("Passagens para Recife em dezembro")
          && searchQuery.includes("palestra"),
        JSON.stringify({ reply: result.reply, searchQuery }, null, 2),
      ));
    } finally {
      harness.cleanup();
    }
  }

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nCritical E2E flows ok: ${results.length}/${results.length}`);
}

void run();
