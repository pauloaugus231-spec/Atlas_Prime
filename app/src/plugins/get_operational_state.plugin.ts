import { defineToolPlugin } from "../types/plugin.js";

export default defineToolPlugin<Record<string, never>>({
  name: "get_operational_state",
  description: "Returns the current operational state snapshot for the operator.",
  exposeToModel: false,
  parameters: {
    type: "object",
    additionalProperties: false,
  },
  execute(_parameters, context) {
    return {
      ok: true,
      state: context.personalMemory.getOperationalState(),
    };
  },
});
