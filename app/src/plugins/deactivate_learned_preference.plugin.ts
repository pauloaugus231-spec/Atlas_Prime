import { defineToolPlugin } from "../types/plugin.js";

interface DeactivateLearnedPreferenceParameters {
  id: number;
}

export default defineToolPlugin<DeactivateLearnedPreferenceParameters>({
  name: "deactivate_learned_preference",
  description: "Deactivates a learned operational preference without deleting history.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "integer",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    return {
      ok: true,
      item: context.personalMemory.deactivateLearnedPreference(parameters.id),
    };
  },
});
