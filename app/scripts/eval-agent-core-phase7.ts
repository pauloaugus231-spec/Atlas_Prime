import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
import type { CalendarEventSummary, CalendarListSummary, ContactSummary, TaskSummary } from "../src/integrations/google/google-workspace.js";

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
      confidence: 0.92,
      actionMode: "assist",
      reasons: ["eval"],
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: ["confirmar antes de escrever"],
      requiresApprovalFor: ["calendar.write"],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: false,
        canModifyCalendar: true,
        canPublishContent: false,
      },
    },
  };
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
  listCalendarsThrows?: boolean;
}) {
  const tasks = input.tasks ?? [];
  const contacts = input.contacts ?? [];
  const calendars = input.calendars ?? [];
  const configuredCalendars = input.configuredCalendars ?? [];
  const events = input.events ?? [];
  const calendarAliases = input.calendarAliases ?? { primary: "primary" };

  return {
    getStatus: () => ({
      ready: input.ready !== false,
      writeReady: input.writeReady !== false,
      message: input.ready === false ? "indisponível" : "ready",
    }),
    getCalendarAliases: () => calendarAliases,
    resolveCalendarId: (calendarIdOrAlias?: string) => {
      if (!calendarIdOrAlias?.trim()) {
        return Object.values(calendarAliases)[0] ?? "primary";
      }
      return calendarAliases[calendarIdOrAlias] ?? calendarIdOrAlias;
    },
    listTasks: async () => tasks,
    listEventsInWindow: async () => events,
    searchContacts: async () => contacts,
    listCalendars: async () => {
      if (input.listCalendarsThrows) {
        throw new Error("calendar api unavailable");
      }
      return calendars;
    },
    listConfiguredCalendars: () => configuredCalendars,
  };
}

function buildCoreStub() {
  const core = Object.create(AgentCore.prototype) as AgentCore;
  const logger = makeLogger();
  const primaryWorkspace = makeWorkspace({
    tasks: [
      {
        id: "task-primary-1",
        taskListId: "primary-list",
        taskListTitle: "Pessoal",
        title: "Pagar conta",
        status: "needsAction",
        due: null,
        updated: "2026-04-20T08:00:00.000Z",
      },
    ],
    contacts: [
      {
        resourceName: "people/1",
        displayName: "Joana Silva",
        emailAddresses: ["joana@example.com"],
        phoneNumbers: ["5551999999999"],
        organizations: ["Equipe Atlas"],
      },
    ],
    listCalendarsThrows: true,
    configuredCalendars: [
      {
        id: "primary",
        summary: "Calendário principal",
        primary: true,
        selected: true,
        accessRole: "owner",
      },
    ],
  });

  const workWorkspace = makeWorkspace({
    tasks: [
      {
        id: "task-work-1",
        taskListId: "work-list",
        taskListTitle: "Abordagem",
        title: "Entregar relatório",
        status: "needsAction",
        due: null,
        updated: "2026-04-20T08:00:00.000Z",
      },
    ],
    events: [
      {
        id: "event-1",
        status: "confirmed",
        summary: "Paulo e Juliana - CREAS",
        start: "2026-04-21T09:00:00-03:00",
        end: "2026-04-21T10:00:00-03:00",
        location: "CREAS Restinga",
      },
      {
        id: "event-2",
        status: "confirmed",
        summary: "Simone - Férias",
        start: "2026-04-21T11:00:00-03:00",
        end: "2026-04-21T12:00:00-03:00",
        location: "Porto Alegre",
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

  const workspaces = new Map<string, any>([
    ["primary", primaryWorkspace],
    ["abordagem", workWorkspace],
  ]);

  (core as any).logger = logger;
  (core as any).config = {
    google: {
      defaultTimezone: "America/Sao_Paulo",
    },
  };
  (core as any).preferences = {
    get: () => ({
      responseStyle: "executive",
      responseLength: "medium",
      proactiveNextStep: true,
      autoSourceFallback: false,
      preferredAgentName: "Atlas",
    }),
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
  };
  (core as any).googleWorkspaces = {
    getAliases: () => ["primary", "abordagem"],
    getWorkspace: (alias?: string) => workspaces.get(alias ?? "primary") ?? primaryWorkspace,
  };
  (core as any).googleMaps = {
    getStatus: () => ({
      ready: true,
      message: "maps ready",
    }),
    lookupPlace: async () => ({
      placeId: "caps-girassol-poa",
      name: "CAPS Girassol",
      formattedAddress: "Av. João Antônio da Silveira, 440 - Restinga, Porto Alegre - RS",
      shortFormattedAddress: "Restinga, Porto Alegre - RS",
      mapsUrl: "https://maps.google.com/?q=CAPS+Girassol+Restinga",
      source: "places",
    }),
  };
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
  };
  (core as any).executeToolDirect = async () => ({
    requestId: "tool-1",
    content: "ok",
    rawResult: {},
  });

  return core;
}

async function run(): Promise<void> {
  const results: EvalResult[] = [];
  const core = buildCoreStub();
  const orchestration = buildOrchestration();
  const logger = makeLogger();

  {
    const result = await (core as any).tryRunDirectGoogleTasks(
      "me mostra minhas tarefas",
      "req-tasks",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_tasks_wrapper_uses_extracted_service",
      result?.reply === "Google Tasks das contas conectadas :: 2",
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectCalendarLookup(
      "tenho algo agendado amanhã?",
      "req-calendar-lookup",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_calendar_lookup_wrapper_preserves_relevance_filter",
      typeof result?.reply === "string" && result.reply.endsWith(":: 1 :: 0"),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleContacts(
      "procure o contato Joana",
      "req-contacts",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_contacts_wrapper_uses_extracted_service",
      Boolean(result?.reply?.includes("Joana Silva") && result.reply.includes("joana@example.com")),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleCalendarsList(
      "liste meus calendários",
      "req-calendars",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_calendars_wrapper_falls_back_to_configured_list",
      Boolean(result?.reply?.includes("Calendário principal") && result.reply.includes("Agenda da abordagem")),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectPlaceLookup(
      "qual endereço do CAPS Girassol?",
      "req-place",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_place_lookup_wrapper_uses_extracted_service",
      Boolean(result?.reply?.includes("CAPS Girassol") && result.reply.includes("Restinga")),
      result?.reply,
    ));
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

  console.log(`\nAgent core phase 7 evals ok: ${results.length}/${results.length}`);
}

void run();
