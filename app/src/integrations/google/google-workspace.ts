import type { GoogleWorkspaceConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import {
  GOOGLE_WORKSPACE_WRITE_SCOPES,
  GoogleWorkspaceAuthService,
  type GoogleAuthStatus,
} from "./google-auth.js";

export interface CalendarEventSummary {
  id: string;
  status: string;
  summary: string;
  description?: string;
  location?: string;
  start: string | null;
  end: string | null;
  htmlLink?: string;
}

export interface CalendarListSummary {
  id: string;
  summary: string;
  description?: string;
  primary: boolean;
  selected: boolean;
  accessRole?: string;
}

export interface TaskSummary {
  id: string;
  taskListId: string;
  taskListTitle: string;
  title: string;
  notes?: string;
  status: string;
  due: string | null;
  updated: string | null;
}

export interface ContactSummary {
  resourceName: string;
  displayName: string;
  emailAddresses: string[];
  phoneNumbers: string[];
  organizations: string[];
}

export interface CreatedGoogleTask {
  id: string;
  title: string;
  notes?: string;
  due: string | null;
  status: string;
  taskListId: string;
  taskListTitle?: string;
  updated?: string | null;
}

export interface DeletedGoogleTask {
  id: string;
  taskListId: string;
  status: "deleted";
}

export interface CreatedCalendarEvent {
  id: string;
  status: string;
  summary: string;
  description?: string;
  location?: string;
  start: string | null;
  end: string | null;
  htmlLink?: string;
  calendarId: string;
  meetLink?: string;
  reminderMinutes?: number;
  attendees?: string[];
}

export interface DeletedCalendarEvent {
  id: string;
  calendarId: string;
  status: "cancelled";
}

export interface UpdatedCalendarEvent extends CreatedCalendarEvent {}

export interface DailyOperationalBrief {
  timezone: string;
  windowStart: string;
  windowEnd: string;
  events: CalendarEventSummary[];
  tasks: TaskSummary[];
}

interface GoogleCalendarEventsResponse {
  items?: Array<{
    id?: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }>;
}

interface GoogleCalendarListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    description?: string;
    primary?: boolean;
    selected?: boolean;
    accessRole?: string;
  }>;
}

interface GoogleTaskListsResponse {
  items?: Array<{ id?: string; title?: string }>;
}

interface GoogleTasksResponse {
  items?: Array<{
    id?: string;
    title?: string;
    notes?: string;
    status?: string;
    due?: string;
    updated?: string;
  }>;
}

interface GoogleContactsResponse {
  results?: Array<{
    person?: {
      resourceName?: string;
      names?: Array<{ displayName?: string }>;
      emailAddresses?: Array<{ value?: string }>;
      phoneNumbers?: Array<{ value?: string }>;
      organizations?: Array<{ name?: string; title?: string }>;
    };
  }>;
}

interface GoogleTaskCreateResponse {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  updated?: string;
}

interface GoogleCalendarEventCreateResponse {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
    }>;
  };
}

export class GoogleWorkspaceService {
  constructor(
    private readonly config: GoogleWorkspaceConfig,
    private readonly auth: GoogleWorkspaceAuthService,
    private readonly logger: Logger,
  ) {}

  getStatus(): GoogleAuthStatus {
    return this.auth.getStatus();
  }

  getCalendarAliases(): Record<string, string> {
    return { ...this.config.calendarAliases };
  }

  listConfiguredCalendars(): CalendarListSummary[] {
    const known = new Map<string, CalendarListSummary>();
    known.set(this.config.calendarId, {
      id: this.config.calendarId,
      summary: this.config.calendarId === "primary" ? "Calendário principal" : this.config.calendarId,
      primary: this.config.calendarId === "primary",
      selected: true,
      accessRole: "owner",
    });

    for (const [alias, calendarId] of Object.entries(this.config.calendarAliases)) {
      if (!calendarId?.trim()) {
        continue;
      }
      known.set(calendarId, {
        id: calendarId,
        summary: alias.replace(/_/g, " "),
        primary: calendarId === this.config.calendarId || calendarId === "primary",
        selected: true,
        accessRole: "configured",
      });
    }

    return [...known.values()].sort((left, right) => {
      if (left.primary && !right.primary) {
        return -1;
      }
      if (!left.primary && right.primary) {
        return 1;
      }
      return left.summary.localeCompare(right.summary);
    });
  }

  resolveCalendarId(calendarIdOrAlias?: string): string {
    const normalized = calendarIdOrAlias?.trim();
    if (!normalized) {
      return this.config.calendarId;
    }

    const normalizedAlias = normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return this.config.calendarAliases[normalizedAlias] ?? normalized;
  }

  canWrite(): boolean {
    return this.auth.hasGrantedScopes(GOOGLE_WORKSPACE_WRITE_SCOPES);
  }

  async listUpcomingEvents(input?: {
    maxResults?: number;
    hoursAhead?: number;
    calendarId?: string;
  }): Promise<CalendarEventSummary[]> {
    const maxResults = Math.min(Math.max(input?.maxResults ?? this.config.maxEvents, 1), 25);
    const hoursAhead = Math.min(Math.max(input?.hoursAhead ?? 24, 1), 24 * 30);
    const now = new Date();
    const timeMax = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    const calendarId = this.resolveCalendarId(input?.calendarId);
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", now.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");

    const response = await this.fetchJson<GoogleCalendarEventsResponse>(url.toString());
    return (response.items ?? []).map((item) => ({
      id: item.id ?? "",
      status: item.status ?? "unknown",
      summary: item.summary ?? "(sem titulo)",
      description: item.description ?? undefined,
      location: item.location ?? undefined,
      start: item.start?.dateTime ?? item.start?.date ?? null,
      end: item.end?.dateTime ?? item.end?.date ?? null,
      htmlLink: item.htmlLink ?? undefined,
    }));
  }

  async listCalendars(): Promise<CalendarListSummary[]> {
    const response = await this.fetchJson<GoogleCalendarListResponse>(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100",
    );

    return (response.items ?? [])
      .map((item) => ({
        id: item.id ?? "",
        summary: item.summary ?? "(sem titulo)",
        description: item.description ?? undefined,
        primary: Boolean(item.primary),
        selected: item.selected !== false,
        accessRole: item.accessRole ?? undefined,
      }))
      .filter((item) => Boolean(item.id))
      .sort((left, right) => {
        if (left.primary && !right.primary) {
          return -1;
        }
        if (!left.primary && right.primary) {
          return 1;
        }
        return left.summary.localeCompare(right.summary);
      });
  }

  async listEventsInWindow(input: {
    timeMin: string;
    timeMax: string;
    maxResults?: number;
    calendarId?: string;
    query?: string;
  }): Promise<CalendarEventSummary[]> {
    const maxResults = Math.min(Math.max(input.maxResults ?? this.config.maxEvents, 1), 25);
    const calendarId = this.resolveCalendarId(input.calendarId);
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", input.timeMin);
    url.searchParams.set("timeMax", input.timeMax);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    if (input.query?.trim()) {
      url.searchParams.set("q", input.query.trim());
    }

    const response = await this.fetchJson<GoogleCalendarEventsResponse>(url.toString());
    return (response.items ?? []).map((item) => ({
      id: item.id ?? "",
      status: item.status ?? "unknown",
      summary: item.summary ?? "(sem titulo)",
      description: item.description ?? undefined,
      location: item.location ?? undefined,
      start: item.start?.dateTime ?? item.start?.date ?? null,
      end: item.end?.dateTime ?? item.end?.date ?? null,
      htmlLink: item.htmlLink ?? undefined,
    }));
  }

  async listTaskLists(): Promise<Array<{ id: string; title: string }>> {
    const response = await this.fetchJson<GoogleTaskListsResponse>(
      "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20",
    );

    return (response.items ?? []).map((item) => ({
      id: item.id ?? "",
      title: item.title ?? "(sem titulo)",
    }));
  }

  async listTasks(input?: {
    maxResults?: number;
    showCompleted?: boolean;
    dueBefore?: string;
    dueAfter?: string;
    taskListId?: string;
  }): Promise<TaskSummary[]> {
    const maxResults = Math.min(Math.max(input?.maxResults ?? this.config.maxTasks, 1), 50);
    const taskLists = input?.taskListId
      ? [{ id: input.taskListId, title: input.taskListId }]
      : await this.listTaskLists();
    const collected: TaskSummary[] = [];

    for (const taskList of taskLists) {
      if (collected.length >= maxResults) {
        break;
      }

      const url = new URL(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskList.id)}/tasks`,
      );
      url.searchParams.set("showCompleted", String(input?.showCompleted ?? false));
      url.searchParams.set("showHidden", "false");
      url.searchParams.set("maxResults", String(Math.min(maxResults, 100)));
      if (input?.dueBefore) {
        url.searchParams.set("dueMax", input.dueBefore);
      }
      if (input?.dueAfter) {
        url.searchParams.set("dueMin", input.dueAfter);
      }

      const response = await this.fetchJson<GoogleTasksResponse>(url.toString());
      for (const item of response.items ?? []) {
        collected.push({
          id: item.id ?? "",
          taskListId: taskList.id,
          taskListTitle: taskList.title,
          title: item.title ?? "(sem titulo)",
          notes: item.notes ?? undefined,
          status: item.status ?? "needsAction",
          due: item.due ?? null,
          updated: item.updated ?? null,
        });

        if (collected.length >= maxResults) {
          break;
        }
      }
    }

    return collected.sort((left, right) => {
      const leftDue = left.due ?? left.updated ?? "";
      const rightDue = right.due ?? right.updated ?? "";
      return leftDue.localeCompare(rightDue);
    });
  }

  async searchContacts(query: string, limit?: number): Promise<ContactSummary[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const maxResults = Math.min(Math.max(limit ?? this.config.maxContacts, 1), 30);
    const url = new URL("https://people.googleapis.com/v1/people:searchContacts");
    url.searchParams.set("query", normalizedQuery);
    url.searchParams.set("pageSize", String(maxResults));
    url.searchParams.set("readMask", "names,emailAddresses,phoneNumbers,organizations");

    const response = await this.fetchJson<GoogleContactsResponse>(url.toString());
    return (response.results ?? []).map((result) => {
      const person = result.person;
      return {
        resourceName: person?.resourceName ?? "",
        displayName: person?.names?.[0]?.displayName ?? normalizedQuery,
        emailAddresses: (person?.emailAddresses ?? []).map((item) => item.value ?? "").filter(Boolean),
        phoneNumbers: (person?.phoneNumbers ?? []).map((item) => item.value ?? "").filter(Boolean),
        organizations: (person?.organizations ?? [])
          .map((item) => item.name ?? item.title ?? "")
          .filter(Boolean),
      };
    });
  }

  async getDailyBrief(): Promise<DailyOperationalBrief> {
    const now = new Date();
    const dayEnd = new Date(now);
    dayEnd.setHours(23, 59, 59, 999);
    const events = await this.listUpcomingEvents({
      maxResults: this.config.maxEvents,
      hoursAhead: Math.max(1, Math.ceil((dayEnd.getTime() - now.getTime()) / (60 * 60 * 1000))),
    });
    const tasks = await this.listTasks({
      maxResults: this.config.maxTasks,
      showCompleted: false,
      dueBefore: dayEnd.toISOString(),
    });

    this.logger.info("Generated daily operational brief", {
      events: events.length,
      tasks: tasks.length,
      timezone: this.config.defaultTimezone,
    });

    return {
      timezone: this.config.defaultTimezone,
      windowStart: now.toISOString(),
      windowEnd: dayEnd.toISOString(),
      events,
      tasks,
    };
  }

  async createTask(input: {
    title: string;
    notes?: string;
    due?: string;
    taskListId?: string;
  }): Promise<CreatedGoogleTask> {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Task title is required.");
    }
    this.assertWriteReady();

    const taskLists = input.taskListId ? [{ id: input.taskListId, title: input.taskListId }] : await this.listTaskLists();
    const taskList = taskLists[0];
    if (!taskList?.id) {
      throw new Error("No Google Task list is available for task creation.");
    }

    const payload = {
      title,
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
      ...(input.due?.trim() ? { due: input.due.trim() } : {}),
    };

    const response = await this.fetchJson<GoogleTaskCreateResponse>(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskList.id)}/tasks`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    return {
      id: response.id ?? "",
      title: response.title ?? title,
      notes: response.notes ?? (input.notes?.trim() || undefined),
      due: response.due ?? (input.due?.trim() || null),
      status: response.status ?? "needsAction",
      taskListId: taskList.id,
      taskListTitle: taskList.title,
      updated: response.updated ?? null,
    };
  }

  async deleteTask(input: {
    taskId: string;
    taskListId: string;
  }): Promise<DeletedGoogleTask> {
    const taskId = input.taskId.trim();
    const taskListId = input.taskListId.trim();
    if (!taskId || !taskListId) {
      throw new Error("Task id and task list id are required.");
    }
    this.assertWriteReady();

    await this.fetchJson<unknown>(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
      {
        method: "DELETE",
      },
    );

    return {
      id: taskId,
      taskListId,
      status: "deleted",
    };
  }

  async createCalendarEvent(input: {
    summary: string;
    description?: string;
    location?: string;
    attendees?: string[];
    start: string;
    end: string;
    timezone?: string;
    calendarId?: string;
    reminderMinutes?: number;
    createMeet?: boolean;
  }): Promise<CreatedCalendarEvent> {
    const summary = input.summary.trim();
    const start = input.start.trim();
    const end = input.end.trim();
    if (!summary) {
      throw new Error("Event summary is required.");
    }
    if (!start || !end) {
      throw new Error("Event start and end are required.");
    }
    this.assertWriteReady();

    const calendarId = this.resolveCalendarId(input.calendarId);
    const timezone = input.timezone?.trim() || this.config.defaultTimezone;
    const payload = {
      summary,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.location?.trim() ? { location: input.location.trim() } : {}),
      ...(input.attendees?.length
        ? {
            attendees: input.attendees
              .map((item) => item.trim())
              .filter(Boolean)
              .map((email) => ({ email })),
          }
        : {}),
      start: {
        dateTime: start,
        timeZone: timezone,
      },
      end: {
        dateTime: end,
        timeZone: timezone,
      },
      reminders: {
        useDefault: false,
        overrides: [
          {
            method: "popup",
            minutes: input.reminderMinutes ?? 30,
          },
        ],
      },
      ...(input.createMeet
        ? {
            conferenceData: {
              createRequest: {
                requestId: `atlas-${Date.now()}`,
                conferenceSolutionKey: {
                  type: "hangoutsMeet",
                },
              },
            },
          }
        : {}),
    };

    const response = await this.fetchJson<GoogleCalendarEventCreateResponse>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${
        input.createMeet ? "?conferenceDataVersion=1" : ""
      }`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    return {
      id: response.id ?? "",
      status: response.status ?? "confirmed",
      summary: response.summary ?? summary,
      description: response.description ?? (input.description?.trim() || undefined),
      location: response.location ?? (input.location?.trim() || undefined),
      start: response.start?.dateTime ?? response.start?.date ?? start,
      end: response.end?.dateTime ?? response.end?.date ?? end,
      htmlLink: response.htmlLink ?? undefined,
      calendarId,
      meetLink: response.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === "video")?.uri,
      reminderMinutes: input.reminderMinutes ?? 30,
      attendees: input.attendees?.map((item) => item.trim()).filter(Boolean),
    };
  }

  async deleteCalendarEvent(input: {
    eventId: string;
    calendarId?: string;
  }): Promise<DeletedCalendarEvent> {
    const eventId = input.eventId.trim();
    if (!eventId) {
      throw new Error("Event id is required.");
    }
    this.assertWriteReady();

    const calendarId = this.resolveCalendarId(input.calendarId);
    await this.fetchJson<unknown>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
      },
    );

    return {
      id: eventId,
      calendarId,
      status: "cancelled",
    };
  }

  async updateCalendarEvent(input: {
    eventId: string;
    summary?: string;
    description?: string;
    location?: string;
    attendees?: string[];
    start?: string;
    end?: string;
    timezone?: string;
    calendarId?: string;
    reminderMinutes?: number;
    createMeet?: boolean;
  }): Promise<UpdatedCalendarEvent> {
    const eventId = input.eventId.trim();
    if (!eventId) {
      throw new Error("Event id is required.");
    }
    this.assertWriteReady();

    const calendarId = this.resolveCalendarId(input.calendarId);
    const timezone = input.timezone?.trim() || this.config.defaultTimezone;
    const payload = {
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || undefined } : {}),
      ...(input.location !== undefined ? { location: input.location.trim() || undefined } : {}),
      ...(input.attendees
        ? {
            attendees: input.attendees
              .map((item) => item.trim())
              .filter(Boolean)
              .map((email) => ({ email })),
          }
        : {}),
      ...(input.start
        ? {
            start: {
              dateTime: input.start.trim(),
              timeZone: timezone,
            },
          }
        : {}),
      ...(input.end
        ? {
            end: {
              dateTime: input.end.trim(),
              timeZone: timezone,
            },
          }
        : {}),
      ...(input.reminderMinutes !== undefined
        ? {
            reminders: {
              useDefault: false,
              overrides: [
                {
                  method: "popup",
                  minutes: input.reminderMinutes,
                },
              ],
            },
          }
        : {}),
      ...(input.createMeet
        ? {
            conferenceData: {
              createRequest: {
                requestId: `atlas-update-${Date.now()}`,
                conferenceSolutionKey: {
                  type: "hangoutsMeet",
                },
              },
            },
          }
        : {}),
    };

    const response = await this.fetchJson<GoogleCalendarEventCreateResponse>(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${
        input.createMeet ? "?conferenceDataVersion=1" : ""
      }`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    );

    return {
      id: response.id ?? eventId,
      status: response.status ?? "confirmed",
      summary: response.summary ?? input.summary?.trim() ?? "(sem titulo)",
      description: response.description ?? (input.description?.trim() || undefined),
      location: response.location ?? (input.location?.trim() || undefined),
      start: response.start?.dateTime ?? response.start?.date ?? input.start?.trim() ?? null,
      end: response.end?.dateTime ?? response.end?.date ?? input.end?.trim() ?? null,
      htmlLink: response.htmlLink ?? undefined,
      calendarId,
      meetLink: response.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === "video")?.uri,
      reminderMinutes: input.reminderMinutes,
      attendees: input.attendees?.map((item) => item.trim()).filter(Boolean),
    };
  }

  private assertWriteReady(): void {
    if (this.canWrite()) {
      return;
    }

    throw new Error(
      "Google write scopes are not granted. Re-run npm run google:auth to grant calendar.events and tasks scopes.",
    );
  }

  private async fetchJson<T>(
    url: string,
    input?: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: string;
    },
  ): Promise<T> {
    const accessToken = await this.auth.getAccessToken();
    const response = await fetch(url, {
      method: input?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(input?.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(input?.body ? { body: input.body } : {}),
    });

    if (response.status === 204) {
      return {} as T;
    }

    const payload = (await response.json()) as T & { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(payload.error?.message || `Google request failed with status ${response.status}`);
    }

    return payload as T;
  }
}
