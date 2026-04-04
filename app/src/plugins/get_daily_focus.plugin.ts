import { defineToolPlugin } from "../types/plugin.js";

interface GetDailyFocusParameters {
  limit?: number;
}

export default defineToolPlugin<GetDailyFocusParameters>({
  name: "get_daily_focus",
  description:
    "Builds a daily focus list from the operational memory using impact and urgency scoring.",
  parameters: {
    type: "object",
    properties: {
      limit: {
        type: "integer",
        default: 3,
        description: "Maximum number of focus items to return.",
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const focus = context.memory.getDailyFocus(parameters.limit ?? 3);

    return {
      ok: true,
      total: focus.length,
      focus,
    };
  },
});
