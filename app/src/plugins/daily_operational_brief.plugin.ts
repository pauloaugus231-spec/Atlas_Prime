import { defineToolPlugin } from "../types/plugin.js";

interface DailyOperationalBriefParameters {
  account?: string;
}

export default defineToolPlugin<DailyOperationalBriefParameters>({
  name: "daily_operational_brief",
  description:
    "Builds a secretary-style daily brief by combining Google Calendar, Google Tasks and the agent's operational memory.",
  parameters: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
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
        calendar: [],
        tasks: [],
        focus: [],
      };
    }

    const brief = await workspace.getDailyBrief();
    const focus = context.memory.getDailyFocus(5);

    return {
      ok: true,
      account,
      status,
      brief,
      focus: focus.map((item) => ({
        id: item.item.id,
        category: item.item.category,
        title: item.item.title,
        whyNow: item.whyNow,
        nextAction: item.nextAction,
        score: item.score,
      })),
    };
  },
});
