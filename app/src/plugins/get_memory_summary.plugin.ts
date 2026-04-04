import { defineToolPlugin } from "../types/plugin.js";

export default defineToolPlugin({
  name: "get_memory_summary",
  description:
    "Returns a concise summary of the user's current operational memory for review and planning.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute(_parameters, context) {
    const summary = context.memory.getContextSummary();

    return {
      ok: true,
      summary: summary || "Nenhum item salvo na memória operacional.",
    };
  },
});
