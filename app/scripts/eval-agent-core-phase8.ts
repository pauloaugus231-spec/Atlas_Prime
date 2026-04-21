import process from "node:process";
import { AgentCore } from "../src/core/agent-core.js";
import type { Logger } from "../src/types/logger.js";
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
      confidence: 0.93,
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
    listEventsInWindow: async (request: {
      query?: string;
    }) => {
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
    events: [
      {
        id: "primary-event-1",
        status: "confirmed",
        summary: "Consulta pessoal",
        start: "2026-04-21T15:00:00-03:00",
        end: "2026-04-21T16:00:00-03:00",
        location: "Clínica Centro",
      },
    ],
    calendars: [
      {
        id: "primary",
        summary: "Calendário principal",
        primary: true,
        selected: true,
        accessRole: "owner",
      },
    ],
    configuredCalendars: [
      {
        id: "primary",
        summary: "Calendário principal",
        primary: true,
        selected: true,
        accessRole: "configured",
      },
    ],
  });

  const workWorkspace = makeWorkspace({
    events: [
      {
        id: "work-event-1",
        status: "confirmed",
        summary: "Paulo - Reunião CAPS",
        start: "2026-04-21T09:00:00-03:00",
        end: "2026-04-21T10:00:00-03:00",
        location: "CAPS Restinga",
      },
      {
        id: "work-event-2",
        status: "confirmed",
        summary: "Paulo e Juliana - CREAS",
        start: "2026-04-21T09:30:00-03:00",
        end: "2026-04-21T10:30:00-03:00",
        location: "CREAS Restinga",
      },
      {
        id: "work-event-3",
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
    lookupPlace: async () => null,
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
    buildCalendarConflictReviewReply: (payload: {
      scopeLabel: string;
      totalEvents: number;
      overlapCount: number;
      duplicateCount: number;
      namingCount: number;
    }) => `${payload.scopeLabel} :: ${payload.totalEvents} :: ${payload.overlapCount} :: ${payload.duplicateCount} :: ${payload.namingCount}`,
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
    const result = await (core as any).tryRunDirectCalendarConflictReview(
      "conflitos da agenda",
      "req-conflicts",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_calendar_conflict_review_wrapper_uses_extracted_service",
        result?.reply === "próximos 7 dias :: 3 :: 1 :: 0 :: 0",
        result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventMove(
      "mova o evento reunião caps amanhã para às 11h",
      "req-move",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_move_wrapper_returns_update_draft",
      Boolean(
        result?.reply?.includes("Rascunho de atualização de evento Google pronto.") &&
        result.reply.includes("- Atual: Paulo - Reunião CAPS") &&
        result.reply.includes("- Título: Paulo - Reunião CAPS") &&
        result.reply.includes("- Conta: abordagem"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventMove(
      "altere meu evento reunião caps amanhã para às 11h",
      "req-move-natural",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_move_wrapper_accepts_more_natural_prompt",
      Boolean(
        result?.reply?.includes("Rascunho de atualização de evento Google pronto.") &&
        result.reply.includes("- Atual: Paulo - Reunião CAPS") &&
        result.reply.includes("- Conta: abordagem"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventMove(
      "altere meu evento reunião caps amanhã",
      "req-move-clarify",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_move_wrapper_asks_for_adjustment_when_missing",
      Boolean(
        result?.reply?.includes("Agora me diga só o ajuste") &&
        result.reply.includes("para às 11h"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventDelete(
      "cancele o evento reunião caps amanhã",
      "req-delete-single",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_delete_wrapper_returns_delete_draft",
      Boolean(
        result?.reply?.includes("Rascunho de exclusão de evento Google pronto.") &&
        result.reply.includes("- Atual: Paulo - Reunião CAPS") &&
        result.reply.includes("- Conta: abordagem"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventDelete(
      "tire da minha agenda a reunião caps amanhã",
      "req-delete-natural",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_delete_wrapper_accepts_more_natural_prompt",
      Boolean(
        result?.reply?.includes("Rascunho de exclusão de evento Google pronto.") &&
        result.reply.includes("- Atual: Paulo - Reunião CAPS") &&
        result.reply.includes("- Conta: abordagem"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventDelete(
      "cancele meu evento",
      "req-delete-clarify",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_delete_wrapper_asks_for_reference_when_missing",
      Boolean(
        result?.reply?.includes("Consigo cancelar o evento, mas preciso saber qual é.") &&
        result.reply.includes("reunião CAPS amanhã"),
      ),
      result?.reply,
    ));
  }

  {
    const result = await (core as any).tryRunDirectGoogleEventDelete(
      "cancele meus compromissos amanhã",
      "req-delete-batch",
      logger,
      orchestration,
    );
    results.push(assert(
      "agent_core_google_event_delete_wrapper_supports_batch_delete",
      Boolean(
        result?.reply?.includes("Rascunho de exclusão em lote pronto. Eventos encontrados: 4.") &&
        result.reply.includes("Reunião CAPS") &&
        result.reply.includes("Consulta pessoal"),
      ),
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

  console.log(`\nAgent core phase 8 evals ok: ${results.length}/${results.length}`);
}

void run();
