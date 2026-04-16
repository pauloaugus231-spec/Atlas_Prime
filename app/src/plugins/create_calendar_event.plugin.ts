import { defineToolPlugin } from "../types/plugin.js";

interface CreateCalendarEventParameters {
  summary: string;
  description?: string;
  location?: string;
  attendees?: string[];
  start: string;
  end: string;
  timezone?: string;
  calendar_id?: string;
  account?: string;
  reminder_minutes?: number;
  create_meet?: boolean;
}

export default defineToolPlugin<CreateCalendarEventParameters>({
  name: "create_calendar_event",
  description:
    "Creates a Google Calendar event in the selected account and calendar when write scopes are enabled.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Event title/summary.",
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
        description: "RFC3339 event start timestamp.",
      },
      end: {
        type: "string",
        description: "RFC3339 event end timestamp.",
      },
      timezone: {
        type: "string",
        description: "IANA timezone, for example America/Sao_Paulo.",
      },
      calendar_id: {
        type: "string",
        description: "Optional explicit calendar id.",
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
      reminder_minutes: {
        type: "integer",
        description: "Popup reminder lead time in minutes. Defaults to 30.",
        minimum: 0,
        maximum: 40320,
      },
      create_meet: {
        type: "boolean",
        description: "When true, request a Google Meet link for the event.",
      },
    },
    required: ["summary", "start", "end"],
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
        status,
        error: "Google workspace is not ready.",
      };
    }

    if (!status.writeReady) {
      return {
        ok: false,
        account,
        status,
        error: "Google workspace is authenticated but missing write scopes.",
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
      status: workspace.getStatus(),
      event,
    };
  },
});
