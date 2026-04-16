import { defineToolPlugin } from "../types/plugin.js";

interface ExecuteCalendarOperationParameters {
  action: "create" | "update" | "delete";
  account?: string;
  calendar_id?: string;
  event_id?: string;
  summary?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  start?: string;
  end?: string;
  timezone?: string;
  reminder_minutes?: number;
  create_meet?: boolean;
}

export default defineToolPlugin<ExecuteCalendarOperationParameters>({
  name: "execute_calendar_operation",
  description:
    "Executes a structured calendar operation for Google Calendar after explicit confirmation in an external orchestration flow.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "Calendar operation to execute.",
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
      calendar_id: {
        type: "string",
        description: "Optional explicit calendar id.",
      },
      event_id: {
        type: "string",
        description: "Google Calendar event id. Required for update and delete.",
      },
      summary: {
        type: "string",
        description: "Event title/summary. Required for create.",
      },
      description: {
        type: "string",
        description: "Optional event description.",
      },
      location: {
        type: "string",
        description: "Optional event location.",
      },
      attendees: {
        type: "array",
        description: "Optional attendee email addresses.",
        items: {
          type: "string",
        },
      },
      start: {
        type: "string",
        description: "RFC3339 event start timestamp. Required for create.",
      },
      end: {
        type: "string",
        description: "RFC3339 event end timestamp. Required for create.",
      },
      timezone: {
        type: "string",
        description: "IANA timezone, for example America/Sao_Paulo.",
      },
      reminder_minutes: {
        type: "integer",
        description: "Popup reminder lead time in minutes.",
        minimum: 0,
        maximum: 40320,
      },
      create_meet: {
        type: "boolean",
        description: "When true, request a Google Meet link for the event.",
      },
    },
    required: ["action"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.googleWorkspaces.resolveAlias(parameters.account);
    const workspace = context.googleWorkspaces.getWorkspace(account);
    const status = workspace.getStatus();

    if (!status.ready) {
      return {
        ok: false,
        account,
        action: parameters.action,
        status,
        error: "Google workspace is not ready.",
      };
    }

    if (!status.writeReady) {
      return {
        ok: false,
        account,
        action: parameters.action,
        status,
        error: "Google workspace is authenticated but missing write scopes.",
      };
    }

    if (parameters.action === "create") {
      if (!parameters.summary?.trim() || !parameters.start?.trim() || !parameters.end?.trim()) {
        return {
          ok: false,
          account,
          action: parameters.action,
          status,
          error: "Create operations require summary, start and end.",
        };
      }

      const event = await workspace.createCalendarEvent({
        summary: parameters.summary,
        description: parameters.description,
        location: parameters.location,
        attendees: parameters.attendees,
        start: parameters.start,
        end: parameters.end,
        timezone: parameters.timezone,
        calendarId: parameters.calendar_id,
        reminderMinutes: parameters.reminder_minutes,
        createMeet: parameters.create_meet,
      });

      return {
        ok: true,
        account,
        action: parameters.action,
        status: workspace.getStatus(),
        event,
      };
    }

    if (!parameters.event_id?.trim()) {
      return {
        ok: false,
        account,
        action: parameters.action,
        status,
        error: `${parameters.action === "update" ? "Update" : "Delete"} operations require event_id.`,
      };
    }

    if (parameters.action === "update") {
      const event = await workspace.updateCalendarEvent({
        eventId: parameters.event_id,
        summary: parameters.summary,
        description: parameters.description,
        location: parameters.location,
        attendees: parameters.attendees,
        start: parameters.start,
        end: parameters.end,
        timezone: parameters.timezone,
        calendarId: parameters.calendar_id,
        reminderMinutes: parameters.reminder_minutes,
        createMeet: parameters.create_meet,
      });

      return {
        ok: true,
        account,
        action: parameters.action,
        status: workspace.getStatus(),
        event,
      };
    }

    const event = await workspace.deleteCalendarEvent({
      eventId: parameters.event_id,
      calendarId: parameters.calendar_id,
    });

    return {
      ok: true,
      account,
      action: parameters.action,
      status: workspace.getStatus(),
      event,
    };
  },
});
