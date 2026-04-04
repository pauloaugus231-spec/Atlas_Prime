import { defineToolPlugin } from "../types/plugin.js";

interface MonthlyRevenueScoreboardParameters {
  reference_month?: string;
}

export default defineToolPlugin<MonthlyRevenueScoreboardParameters>({
  name: "monthly_revenue_scoreboard",
  description:
    "Builds a monthly revenue scoreboard with projected, won and received totals plus pipeline and follow-ups.",
  parameters: {
    type: "object",
    properties: {
      reference_month: {
        type: "string",
        pattern: "^\\d{4}-\\d{2}$",
        description: "Month in YYYY-MM format. Defaults to current month.",
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const scoreboard = context.growthOps.getMonthlyScoreboard(parameters.reference_month);
    return {
      ok: true,
      scoreboard,
    };
  },
});
