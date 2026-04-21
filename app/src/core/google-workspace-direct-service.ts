import type { IdentityProfile } from "../types/identity-profile.js";
import type { ConversationMessage } from "../types/llm.js";
import type { Logger } from "../types/logger.js";
import type { OrchestrationContext } from "../types/orchestration.js";
import type { UserPreferences } from "../types/user-preferences.js";
import type { AgentRunResult } from "./agent-core.js";
import {
  buildEventDraftFromPrompt,
  buildGoogleEventDraftReply,
  buildGoogleTaskDraftReply,
  buildTaskDraftFromPrompt,
  isGoogleEventCreatePrompt,
  isGoogleTaskCreatePrompt,
  type PendingGoogleEventDraft,
} from "./google-draft-utils.js";
import type { ResponseOS } from "./response-os.js";
import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { EmailAccountsService } from "../integrations/email/email-accounts.js";
import type { GoogleMapsService, GooglePlaceLookupResult } from "../integrations/google/google-maps.js";
import { isPersonallyRelevantCalendarEvent } from "./calendar-relevance.js";
import type {
  CalendarEventSummary,
  CalendarListSummary,
  ContactSummary,
  GoogleWorkspaceService,
  TaskSummary,
} from "../integrations/google/google-workspace.js";
import type { GoogleWorkspaceAccountsService } from "../integrations/google/google-workspace-accounts.js";

interface CalendarLookupRequest {
  topic?: string;
  targetDate?: {
    isoDate: string;
    startIso: string;
    endIso: string;
    label: string;
  };
}

interface CalendarPeriodWindow {
  startIso: string;
  endIso: string;
  label: string;
}

interface GoogleTaskReviewInput {
  scopeLabel: string;
  items: Array<{
    title: string;
    taskListTitle: string;
    account: string;
    status: string;
    dueLabel: string;
  }>;
  recommendedNextStep?: string;
}

interface ScheduleLookupReplyInput {
  targetLabel: string;
  topicLabel?: string;
  events: Array<{
    account: string;
    summary: string;
    start: string | null;
    location?: string;
  }>;
  emailFallbackCount: number;
  recommendedNextStep?: string;
}

interface GoogleWorkspaceDirectHelpers {
  isGoogleTasksPrompt: (prompt: string) => boolean;
  extractCalendarLookupRequest: (prompt: string, timezone: string) => CalendarLookupRequest | undefined;
  extractExplicitAccountAlias: (prompt: string, aliases: string[]) => string | undefined;
  resolvePromptAccountAliases: (
    prompt: string,
    aliases: string[],
    defaultScope?: IdentityProfile["defaultAgendaScope"],
  ) => string[];
  resolveCalendarTargets: (workspace: GoogleWorkspaceService, prompt: string) => string[];
  extractExplicitCalendarAlias: (prompt: string, aliases: string[]) => string | undefined;
  formatTaskDue: (task: TaskSummary, timezone: string) => string;
  formatBriefDateTime: (value: string, timezone: string) => string;
  summarizeCalendarLocation: (value: string | undefined) => string | undefined;
  buildGoogleContactsReply: (input: {
    query: string;
    contacts: Array<{
      account: string;
      displayName: string;
      emailAddresses: string[];
      phoneNumbers: string[];
      organizations: string[];
    }>;
  }) => string;
  buildGoogleCalendarsReply: (input: {
    calendars: Array<{ account: string; calendars: CalendarListSummary[] }>;
  }) => string;
  buildCalendarPeriodReply: (input: {
    label: string;
    timezone: string;
    compact?: boolean;
    events: Array<{ account: string; event: CalendarEventSummary }>;
  }) => string;
  buildPlaceLookupReply: (result: GooglePlaceLookupResult) => string;
  looksLikePostalAddress: (value: string | undefined) => boolean;
  lookupVenueAddress: (location: string, prompt: string, logger: Logger) => Promise<string | undefined>;
  shouldAutoCreateGoogleEvent: (prompt: string, draft: PendingGoogleEventDraft, writeReady: boolean) => boolean;
  buildDirectGoogleEventCreateReply: (rawResult: unknown, timezone: string) => string;
  isGoogleContactsPrompt: (prompt: string) => boolean;
  extractGoogleContactsQuery: (prompt: string) => string | undefined;
  isGoogleCalendarsListPrompt: (prompt: string) => boolean;
  isPlaceLookupPrompt: (prompt: string) => boolean;
  extractPlaceLookupQuery: (prompt: string) => string | undefined;
  isCalendarPeriodListPrompt: (prompt: string) => boolean;
  parseCalendarPeriodWindow: (prompt: string, timezone: string) => CalendarPeriodWindow | undefined;
  resolveActionAutonomyKey: (prompt: string) => string;
  resolveEffectiveOperationalMode: (prompt: string, profile?: IdentityProfile) => "field" | null;
}

export interface GoogleWorkspaceDirectServiceDependencies {
  logger: Logger;
  defaultTimezone: string;
  googleWorkspaces: Pick<GoogleWorkspaceAccountsService, "getAliases" | "getWorkspace">;
  googleMaps: Pick<GoogleMapsService, "getStatus" | "lookupPlace">;
  emailAccounts: Pick<EmailAccountsService, "getAliases" | "getReader">;
  responseOs: Pick<ResponseOS, "buildTaskReviewReply" | "buildScheduleLookupReply">;
  getPreferences: () => UserPreferences;
  getProfile: () => IdentityProfile;
  buildBaseMessages: (
    userPrompt: string,
    orchestration: OrchestrationContext,
    preferences?: UserPreferences,
  ) => ConversationMessage[];
  executeToolDirect: (toolName: string, rawArguments: unknown) => Promise<{
    requestId: string;
    content: string;
    rawResult: unknown;
  }>;
  helpers: GoogleWorkspaceDirectHelpers;
}

interface GoogleWorkspaceDirectInput {
  userPrompt: string;
  requestId: string;
  requestLogger: Logger;
  orchestration: OrchestrationContext;
}

export class GoogleWorkspaceDirectService {
  constructor(private readonly deps: GoogleWorkspaceDirectServiceDependencies) {}

  async tryRunGoogleTasks(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isGoogleTasksPrompt(input.userPrompt)) {
      return null;
    }

    const preferences = this.deps.getPreferences();
    const profile = this.deps.getProfile();
    const candidateAliases = this.deps.helpers.resolvePromptAccountAliases(
      input.userPrompt,
      this.deps.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );
    const explicitAccount = candidateAliases.length === 1 ? candidateAliases[0] : undefined;

    input.requestLogger.info("Using direct Google Tasks route", {
      domain: input.orchestration.route.primaryDomain,
      account: explicitAccount ?? (candidateAliases.length > 1 ? candidateAliases.join(",") : "all"),
      autonomy: this.deps.helpers.resolveActionAutonomyKey(input.userPrompt),
    });

    const tasks: Array<TaskSummary & { account: string }> = [];
    for (const alias of candidateAliases) {
      const workspace = this.deps.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const accountTasks = await workspace.listTasks({
        maxResults: 15,
        showCompleted: false,
      });
      tasks.push(...accountTasks.map((task) => ({ ...task, account: alias })));
    }

    if (tasks.length === 0) {
      return {
        requestId: input.requestId,
        reply: explicitAccount
          ? `Não encontrei tarefas abertas na conta Google ${explicitAccount}.`
          : "Não encontrei tarefas abertas nas contas Google conectadas.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.responseOs.buildTaskReviewReply({
        scopeLabel: explicitAccount ? `Google Tasks da conta ${explicitAccount}` : "Google Tasks das contas conectadas",
        items: tasks.map((task) => ({
          title: task.title || "(sem titulo)",
          taskListTitle: task.taskListTitle,
          account: task.account,
          status: task.status,
          dueLabel: this.deps.helpers.formatTaskDue(task, this.deps.defaultTimezone),
        })),
        recommendedNextStep: tasks[0]
          ? `Revisar a primeira tarefa aberta: ${tasks[0].title || "(sem titulo)"}.`
          : undefined,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
      toolExecutions: [
        {
          toolName: "list_google_tasks",
          resultPreview: JSON.stringify(
            {
              total: tasks.length,
              account: explicitAccount ?? "all",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunCalendarLookup(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    const lookup = this.deps.helpers.extractCalendarLookupRequest(
      input.userPrompt,
      this.deps.defaultTimezone,
    );
    if (!lookup?.targetDate) {
      return null;
    }

    const preferences = this.deps.getPreferences();
    input.requestLogger.info("Using direct calendar multi-source lookup route", {
      targetDate: lookup.targetDate.isoDate,
      topic: lookup.topic,
      autonomy: this.deps.helpers.resolveActionAutonomyKey(input.userPrompt),
    });
    const profile = this.deps.getProfile();
    const candidateAliases = this.deps.helpers.resolvePromptAccountAliases(
      input.userPrompt,
      this.deps.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );

    const eventMatches: Array<{
      account: string;
      summary: string;
      start: string | null;
      location?: string;
      htmlLink?: string;
    }> = [];

    for (const alias of candidateAliases) {
      const workspace = this.deps.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const calendarTargets = this.deps.helpers.resolveCalendarTargets(workspace, input.userPrompt);
      for (const calendarId of calendarTargets) {
        const events = await workspace.listEventsInWindow({
          timeMin: lookup.targetDate.startIso,
          timeMax: lookup.targetDate.endIso,
          maxResults: 10,
          calendarId,
          ...(lookup.topic ? { query: lookup.topic } : {}),
        });

        for (const event of events) {
          if (!isPersonallyRelevantCalendarEvent({
            account: alias,
            summary: event.summary,
            description: event.description,
            location: event.location,
          })) {
            continue;
          }
          eventMatches.push({
            account: alias,
            summary: event.summary,
            start: event.start,
            location: event.location,
            htmlLink: event.htmlLink,
          });
        }
      }
    }

    const emailMatches: Array<{
      account: string;
      uid: string;
      subject: string;
      from: string[];
      date: string | null;
    }> = [];

    if (eventMatches.length === 0 && preferences.autoSourceFallback) {
      const topic = lookup.topic?.trim();
      if (topic) {
        for (const alias of this.deps.emailAccounts.getAliases()) {
          const reader = this.deps.emailAccounts.getReader(alias);
          const status = await reader.getStatus();
          if (!status.ready) {
            continue;
          }

          const messages = await reader.scanRecentMessages({
            scanLimit: 120,
            unreadOnly: false,
            sinceHours: 24 * 45,
          });

          const tokens = normalizeEmailAnalysisText(topic)
            .split(/\s+/)
            .filter((token) => token.length >= 3);

          for (const message of messages) {
            const haystack = normalizeEmailAnalysisText(
              `${message.subject}\n${message.from.join(" ")}\n${message.preview}`,
            );
            if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) {
              emailMatches.push({
                account: alias,
                uid: message.uid,
                subject: message.subject,
                from: message.from,
                date: message.date,
              });
            }
          }
        }

        emailMatches.sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""));
      }
    }

    return {
      requestId: input.requestId,
      reply: this.deps.responseOs.buildScheduleLookupReply({
        targetLabel: lookup.targetDate.label,
        topicLabel: lookup.topic,
        events: eventMatches.map((item) => ({
          account: item.account,
          summary: item.summary,
          start: item.start
            ? this.deps.helpers.formatBriefDateTime(item.start, this.deps.defaultTimezone)
            : null,
          location: item.location ? this.deps.helpers.summarizeCalendarLocation(item.location) : undefined,
        })),
        emailFallbackCount: emailMatches.length,
        recommendedNextStep: preferences.proactiveNextStep
          ? eventMatches.length > 1
            ? "Revisar os demais eventos do mesmo dia para confirmar conflito ou contexto."
            : emailMatches.length > 0
              ? "Abrir o email mais recente para confirmar data, horário ou convite."
              : "Verificar outras contas ou calendários se a busca precisar ser ampliada."
          : undefined,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
      toolExecutions: [
        {
          toolName: "calendar_email_lookup",
          resultPreview: JSON.stringify(
            {
              targetDate: lookup.targetDate.isoDate,
              topic: lookup.topic ?? null,
              events: eventMatches.length,
              emails: emailMatches.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunGoogleTaskDraft(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!isGoogleTaskCreatePrompt(input.userPrompt)) {
      return null;
    }

    const explicitAccount = this.deps.helpers.extractExplicitAccountAlias(
      input.userPrompt,
      this.deps.googleWorkspaces.getAliases(),
    );
    const workspace = this.deps.googleWorkspaces.getWorkspace(explicitAccount);
    const status = workspace.getStatus();
    if (!status.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração do Google Workspace não está pronta. ${status.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    input.requestLogger.info("Using direct Google Task draft route", {
      domain: input.orchestration.route.primaryDomain,
    });

    const draftResult = buildTaskDraftFromPrompt(input.userPrompt, this.deps.defaultTimezone);
    if (!draftResult.draft) {
      return {
        requestId: input.requestId,
        reply: draftResult.reason ?? "Não consegui preparar a tarefa com os dados informados.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    if (explicitAccount) {
      draftResult.draft.account = explicitAccount;
    }

    const scopeNotice = status.writeReady
      ? undefined
      : "Observação: a conta Google atual ainda está somente leitura. Antes de confirmar a criação, reautorize com `npm run google:auth` para liberar escopo de escrita.";
    const reply = [
      buildGoogleTaskDraftReply(draftResult.draft, this.deps.defaultTimezone),
      scopeNotice,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      requestId: input.requestId,
      reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  async tryRunGoogleEventDraft(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!isGoogleEventCreatePrompt(input.userPrompt)) {
      return null;
    }

    const availableAliases = this.deps.googleWorkspaces.getAliases();
    const explicitAccount = this.deps.helpers.extractExplicitAccountAlias(input.userPrompt, availableAliases);
    const readyAliases = availableAliases.filter((alias) => this.deps.googleWorkspaces.getWorkspace(alias).getStatus().ready);
    const selectedAccount = explicitAccount ?? (readyAliases.length === 1 ? readyAliases[0] : undefined);
    const workspace = selectedAccount ? this.deps.googleWorkspaces.getWorkspace(selectedAccount) : undefined;
    const status = workspace?.getStatus();

    if (selectedAccount && !status?.ready) {
      return {
        requestId: input.requestId,
        reply: `A integração do Google Workspace não está pronta. ${status?.message ?? "Conta indisponível no momento."}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    if (!selectedAccount && readyAliases.length === 0) {
      const fallbackStatus = this.deps.googleWorkspaces.getWorkspace(explicitAccount).getStatus();
      return {
        requestId: input.requestId,
        reply: `A integração do Google Workspace não está pronta. ${fallbackStatus.message}`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    input.requestLogger.info("Using direct Google Calendar event draft route", {
      domain: input.orchestration.route.primaryDomain,
      account: selectedAccount ?? (readyAliases.length > 1 ? "clarify_account" : "default"),
    });

    const draftResult = buildEventDraftFromPrompt(input.userPrompt, this.deps.defaultTimezone);
    if (!draftResult.draft) {
      return {
        requestId: input.requestId,
        reply: draftResult.reason ?? "Não consegui preparar o evento com os dados informados.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    if (selectedAccount) {
      draftResult.draft.account = selectedAccount;
    }

    const explicitCalendar = this.deps.helpers.extractExplicitCalendarAlias(
      input.userPrompt,
      Object.keys((workspace ?? this.deps.googleWorkspaces.getWorkspace(explicitAccount)).getCalendarAliases()),
    );
    if (explicitCalendar) {
      draftResult.draft.calendarId = explicitCalendar;
    }

    if (!selectedAccount && readyAliases.length > 1) {
      return {
        requestId: input.requestId,
        reply: [
          "Preciso saber em qual agenda salvar: pessoal ou abordagem?",
          buildGoogleEventDraftReply(draftResult.draft),
        ].join("\n\n"),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    if (draftResult.draft.location && !this.deps.helpers.looksLikePostalAddress(draftResult.draft.location)) {
      const addressCandidate = await this.deps.helpers.lookupVenueAddress(
        draftResult.draft.location,
        input.userPrompt,
        input.requestLogger.child({ scope: "event-location-lookup" }),
      );
      if (addressCandidate) {
        draftResult.draft.location = `${draftResult.draft.location} - ${addressCandidate}`;
      }
    }

    if (this.deps.helpers.shouldAutoCreateGoogleEvent(input.userPrompt, draftResult.draft, Boolean(status?.writeReady))) {
      input.requestLogger.info("Using direct Google Calendar auto-create route", {
        account: draftResult.draft.account ?? "primary",
        calendarId: draftResult.draft.calendarId ?? "default",
      });
      const execution = await this.deps.executeToolDirect("create_calendar_event", {
        summary: draftResult.draft.summary,
        start: draftResult.draft.start,
        end: draftResult.draft.end,
        ...(draftResult.draft.description ? { description: draftResult.draft.description } : {}),
        ...(draftResult.draft.location ? { location: draftResult.draft.location } : {}),
        ...(draftResult.draft.attendees?.length ? { attendees: draftResult.draft.attendees } : {}),
        ...(draftResult.draft.timezone ? { timezone: draftResult.draft.timezone } : {}),
        ...(draftResult.draft.calendarId ? { calendar_id: draftResult.draft.calendarId } : {}),
        ...(draftResult.draft.account ? { account: draftResult.draft.account } : {}),
        ...(typeof draftResult.draft.reminderMinutes === "number"
          ? { reminder_minutes: draftResult.draft.reminderMinutes }
          : {}),
        ...(draftResult.draft.createMeet ? { create_meet: true } : {}),
      });

      return {
        requestId: input.requestId,
        reply: this.deps.helpers.buildDirectGoogleEventCreateReply(
          execution.rawResult,
          this.deps.defaultTimezone,
        ),
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [
          {
            toolName: "create_calendar_event",
            resultPreview: execution.content.slice(0, 240),
          },
        ],
      };
    }

    const scopeNotice = status?.writeReady
      ? undefined
      : "Observação: a conta Google atual ainda está somente leitura. Antes de confirmar a criação, reautorize com `npm run google:auth` para liberar escopo de escrita.";
    const reply = [
      buildGoogleEventDraftReply(draftResult.draft),
      scopeNotice,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      requestId: input.requestId,
      reply,
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  async tryRunCalendarPeriodList(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isCalendarPeriodListPrompt(input.userPrompt)) {
      return null;
    }

    const window = this.deps.helpers.parseCalendarPeriodWindow(input.userPrompt, this.deps.defaultTimezone);
    if (!window) {
      return null;
    }

    const profile = this.deps.getProfile();
    const operationalMode = this.deps.helpers.resolveEffectiveOperationalMode(
      input.userPrompt,
      profile,
    );
    const aliases = this.deps.helpers.resolvePromptAccountAliases(
      input.userPrompt,
      this.deps.googleWorkspaces.getAliases(),
      profile.defaultAgendaScope,
    );
    const explicitAccount = aliases.length === 1 ? aliases[0] : undefined;
    const events: Array<{ account: string; event: CalendarEventSummary }> = [];

    for (const alias of aliases) {
      const workspace = this.deps.googleWorkspaces.getWorkspace(alias);
      if (!workspace.getStatus().ready) {
        continue;
      }
      const calendarTargets = this.deps.helpers.resolveCalendarTargets(workspace, input.userPrompt);
      for (const calendarId of calendarTargets) {
        const items = await workspace.listEventsInWindow({
          timeMin: window.startIso,
          timeMax: window.endIso,
          maxResults: 20,
          calendarId,
        });
        for (const event of items) {
          events.push({ account: alias, event });
        }
      }
    }

    input.requestLogger.info("Using direct calendar period list route", {
      period: window.label,
      account: explicitAccount ?? "all",
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildCalendarPeriodReply({
        label: window.label,
        timezone: this.deps.defaultTimezone,
        compact: operationalMode === "field",
        events,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [],
    };
  }

  async tryRunGoogleContacts(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isGoogleContactsPrompt(input.userPrompt)) {
      return null;
    }

    const query = this.deps.helpers.extractGoogleContactsQuery(input.userPrompt);
    if (!query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual contato devo procurar no Google Contacts.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const preferences = this.deps.getPreferences();
    const explicitAccount = this.deps.helpers.extractExplicitAccountAlias(
      input.userPrompt,
      this.deps.googleWorkspaces.getAliases(),
    );
    const candidateAliases = explicitAccount ? [explicitAccount] : this.deps.googleWorkspaces.getAliases();

    input.requestLogger.info("Using direct Google Contacts route", {
      query,
      account: explicitAccount ?? "all",
    });

    const contacts: Array<ContactSummary & { account: string }> = [];
    for (const alias of candidateAliases) {
      const workspace = this.deps.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      const accountContacts = await workspace.searchContacts(query, 10);
      contacts.push(...accountContacts.map((contact) => ({ ...contact, account: alias })));
    }

    if (contacts.length === 0) {
      return {
        requestId: input.requestId,
        reply: explicitAccount
          ? `Não encontrei contatos na conta Google ${explicitAccount} para a busca: ${query}.`
          : `Não encontrei contatos nas contas Google conectadas para a busca: ${query}.`,
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildGoogleContactsReply({
        query,
        contacts: contacts.map((contact) => ({
          account: contact.account,
          displayName: contact.displayName,
          emailAddresses: contact.emailAddresses,
          phoneNumbers: contact.phoneNumbers,
          organizations: contact.organizations,
        })),
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
      toolExecutions: [
        {
          toolName: "search_google_contacts",
          resultPreview: JSON.stringify(
            {
              query,
              total: contacts.length,
              account: explicitAccount ?? "all",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunGoogleCalendarsList(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isGoogleCalendarsListPrompt(input.userPrompt)) {
      return null;
    }

    const preferences = this.deps.getPreferences();
    const explicitAccount = this.deps.helpers.extractExplicitAccountAlias(
      input.userPrompt,
      this.deps.googleWorkspaces.getAliases(),
    );
    const candidateAliases = explicitAccount ? [explicitAccount] : this.deps.googleWorkspaces.getAliases();

    input.requestLogger.info("Using direct Google calendars list route", {
      account: explicitAccount ?? "all",
    });

    const calendarsByAccount: Array<{ account: string; calendars: CalendarListSummary[] }> = [];
    for (const alias of candidateAliases) {
      const workspace = this.deps.googleWorkspaces.getWorkspace(alias);
      const status = workspace.getStatus();
      if (!status.ready) {
        continue;
      }

      let calendars: CalendarListSummary[];
      try {
        calendars = await workspace.listCalendars();
      } catch (error) {
        input.requestLogger.warn("Falling back to configured calendars list", {
          account: alias,
          error: error instanceof Error ? error.message : String(error),
        });
        calendars = workspace.listConfiguredCalendars();
      }
      calendarsByAccount.push({
        account: alias,
        calendars,
      });
    }

    if (calendarsByAccount.length === 0 || calendarsByAccount.every((item) => item.calendars.length === 0)) {
      return {
        requestId: input.requestId,
        reply: explicitAccount
          ? `Não encontrei calendários disponíveis na conta Google ${explicitAccount}.`
          : "Não encontrei calendários disponíveis nas contas Google conectadas.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
        toolExecutions: [],
      };
    }

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildGoogleCalendarsReply({
        calendars: calendarsByAccount,
      }),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration, preferences),
      toolExecutions: [
        {
          toolName: "list_google_calendars",
          resultPreview: JSON.stringify(
            calendarsByAccount.map((item) => ({
              account: item.account,
              total: item.calendars.length,
            })),
            null,
            2,
          ),
        },
      ],
    };
  }

  async tryRunPlaceLookup(input: GoogleWorkspaceDirectInput): Promise<AgentRunResult | null> {
    if (!this.deps.helpers.isPlaceLookupPrompt(input.userPrompt)) {
      return null;
    }

    const query = this.deps.helpers.extractPlaceLookupQuery(input.userPrompt);
    if (!query) {
      return {
        requestId: input.requestId,
        reply: "Diga qual lugar devo localizar no Google Maps.",
        messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
        toolExecutions: [],
      };
    }

    const status = this.deps.googleMaps.getStatus();
    if (!status.ready) {
      return null;
    }

    const result = await this.deps.googleMaps.lookupPlace(query);
    if (!result) {
      return null;
    }

    input.requestLogger.info("Using direct Google Maps place lookup route", {
      query,
      source: result.source,
      placeId: result.placeId,
    });

    return {
      requestId: input.requestId,
      reply: this.deps.helpers.buildPlaceLookupReply(result),
      messages: this.deps.buildBaseMessages(input.userPrompt, input.orchestration),
      toolExecutions: [
        {
          toolName: "google_maps_lookup",
          resultPreview: JSON.stringify(result, null, 2).slice(0, 240),
        },
      ],
    };
  }
}
