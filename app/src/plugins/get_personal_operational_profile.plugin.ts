import { defineToolPlugin } from "../types/plugin.js";

export default defineToolPlugin<Record<string, never>>({
  name: "get_personal_operational_profile",
  description: "Returns the user's personal operational base profile.",
  exposeToModel: false,
  parameters: {
    type: "object",
    additionalProperties: false,
  },
  execute(_parameters, context) {
    return {
      ok: true,
      profile: context.personalMemory.getProfile(),
    };
  },
});
