import { defineToolPlugin } from "../types/plugin.js";

interface DeleteCalendarEventParameters {
  event_id: string;
  calendar_id?: string;
  account?: string;
}

export default defineToolPlugin<DeleteCalendarEventParameters>({
  name: "delete_calendar_event",
  description:
    "Deletes a Google Calendar event only after explicit user confirmation. Hidden from the model by default.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      event_id: {
        type: "string",
        description: "Google Calendar event id.",
      },
      calendar_id: {
        type: "string",
        description: "Optional explicit calendar id.",
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
    },
    required: ["event_id"],
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
      };
    }

    const event = await workspace.deleteCalendarEvent({
      eventId: parameters.event_id,
      calendarId: parameters.calendar_id,
    });

    return {
      ok: true,
      account,
      status: workspace.getStatus(),
      event,
    };
  },
});
