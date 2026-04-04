import { defineToolPlugin } from "../types/plugin.js";

interface ListCalendarEventsParameters {
  account?: string;
  max_results?: number;
  hours_ahead?: number;
  calendar_id?: string;
}

export default defineToolPlugin<ListCalendarEventsParameters>({
  name: "list_calendar_events",
  description:
    "Lists upcoming Google Calendar events in read-only mode for secretary and planning workflows.",
  parameters: {
    type: "object",
    properties: {
      max_results: {
        type: "integer",
        default: 10,
        minimum: 1,
        maximum: 25,
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
      hours_ahead: {
        type: "integer",
        default: 24,
        minimum: 1,
        maximum: 720,
      },
      calendar_id: {
        type: "string",
      },
    },
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
        events: [],
      };
    }

    const events = await workspace.listUpcomingEvents({
      maxResults: parameters.max_results,
      hoursAhead: parameters.hours_ahead,
      calendarId: parameters.calendar_id,
    });

    return {
      ok: true,
      account,
      status,
      total: events.length,
      events,
    };
  },
});
