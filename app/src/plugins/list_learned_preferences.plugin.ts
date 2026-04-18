import { LEARNED_PREFERENCE_TYPES } from "../types/learned-preferences.js";
import { defineToolPlugin } from "../types/plugin.js";

interface ListLearnedPreferencesParameters {
  type?: (typeof LEARNED_PREFERENCE_TYPES)[number];
  search?: string;
  activeOnly?: boolean;
  limit?: number;
}

export default defineToolPlugin<ListLearnedPreferencesParameters>({
  name: "list_learned_preferences",
  description: "Lists learned operational preferences and corrections observed by the Atlas.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...LEARNED_PREFERENCE_TYPES],
      },
      search: {
        type: "string",
      },
      activeOnly: {
        type: "boolean",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
      },
    },
    additionalProperties: false,
  },
  execute(parameters, context) {
    const items = context.personalMemory.listLearnedPreferences(parameters);
    return {
      ok: true,
      items,
      total: items.length,
    };
  },
});
