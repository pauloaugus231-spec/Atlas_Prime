import { defineToolPlugin } from "../types/plugin.js";

export default defineToolPlugin({
  name: "get_user_preferences",
  description: "Returns the persisted user preferences that shape response style, next-step behavior and agent naming.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_parameters, context) {
    return {
      ok: true,
      preferences: context.preferences.get(),
    };
  },
});
