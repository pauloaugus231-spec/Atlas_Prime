import {
  LEARNED_PREFERENCE_SOURCES,
  LEARNED_PREFERENCE_TYPES,
} from "../types/learned-preferences.js";
import { defineToolPlugin } from "../types/plugin.js";

interface SaveLearnedPreferenceParameters {
  type: (typeof LEARNED_PREFERENCE_TYPES)[number];
  key: string;
  description: string;
  value: string;
  source: (typeof LEARNED_PREFERENCE_SOURCES)[number];
  confidence?: number;
  observe?: boolean;
}

export default defineToolPlugin<SaveLearnedPreferenceParameters>({
  name: "save_learned_preference",
  description: "Registers or reinforces a learned operational preference.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: [...LEARNED_PREFERENCE_TYPES],
      },
      key: { type: "string" },
      description: { type: "string" },
      value: { type: "string" },
      source: {
        type: "string",
        enum: [...LEARNED_PREFERENCE_SOURCES],
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      observe: {
        type: "boolean",
      },
    },
    required: ["type", "key", "description", "value", "source"],
    additionalProperties: false,
  },
  execute(parameters, context) {
    const item = parameters.observe === false
      ? context.personalMemory.saveLearnedPreference(parameters)
      : context.personalMemory.recordLearnedPreferenceObservation(parameters);

    return {
      ok: true,
      item,
    };
  },
});
